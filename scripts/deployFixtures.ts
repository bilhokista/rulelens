/**
 * Deploys deliberately misconfigured OpenZeppelin multisig smart accounts on
 * testnet so every RuleLens check can be reproduced against real contracts.
 *
 * Env: FIXTURE_SECRET (funded testnet key), ACCOUNT_WASM_HASH, SIMPLE_POLICY,
 * WEIGHTED_POLICY, SIGNER_1..3 (G-addresses).
 */
import {
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const addr = (a: string) => new Address(a).toScVal();
const delegated = (g: string) => xdr.ScVal.scvVec([sym('Delegated'), addr(g)]);

/** Host maps must be sorted; delegated G-signers sort by raw ed25519 key bytes. */
const byPubkey = (a: string, b: string) =>
  Buffer.compare(StrKey.decodeEd25519PublicKey(a), StrKey.decodeEd25519PublicKey(b));

function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map(k => new xdr.ScMapEntry({ key: sym(k), val: fields[k] }))
  );
}

function constructorArgs(signers: string[], policy: string, params: xdr.ScVal): xdr.ScVal[] {
  return [
    xdr.ScVal.scvVec(signers.map(delegated)),
    xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: addr(policy), val: params })]),
  ];
}

async function deploy(server: rpc.Server, source: Keypair, wasmHash: string, args: xdr.ScVal[]) {
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(source.publicKey()),
        wasmHash: Buffer.from(wasmHash, 'hex'),
        constructorArgs: args,
        salt: Buffer.from(Keypair.random().rawPublicKey()),
      })
    )
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  const done = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (done.status !== 'SUCCESS' || !('returnValue' in done) || !done.returnValue) {
    throw new Error(`deploy ${sent.hash} ended with ${done.status}`);
  }
  return Address.fromScVal(done.returnValue).toString();
}

async function main() {
  const server = new rpc.Server(RPC_URL);
  const source = Keypair.fromSecret(env('FIXTURE_SECRET'));
  const wasmHash = env('ACCOUNT_WASM_HASH');
  const [s1, s2, s3] = ['SIGNER_1', 'SIGNER_2', 'SIGNER_3'].map(env);

  const weights = [s1, s2, s3].sort(byPubkey).map(
    g => new xdr.ScMapEntry({ key: delegated(g), val: u32(g === s3 ? 5 : 1) })
  );

  const fixtures = {
    // Rule signers s1,s2 (weight 1 each) but s3 holds weight 5 without being a signer; threshold 3 unreachable.
    staleWeights: constructorArgs(
      [s1, s2],
      env('WEIGHTED_POLICY'),
      struct({ signer_weights: xdr.ScVal.scvMap(weights), threshold: u32(3) })
    ),
    // Default rule, 1-of-3.
    oneOfN: constructorArgs([s1, s2, s3], env('SIMPLE_POLICY'), struct({ threshold: u32(1) })),
    // Control: 2-of-2.
    clean: constructorArgs([s1, s2], env('SIMPLE_POLICY'), struct({ threshold: u32(2) })),
  };

  for (const [name, args] of Object.entries(fixtures)) {
    const id = await deploy(server, source, wasmHash, args);
    console.log(`${name} ${id}`);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
