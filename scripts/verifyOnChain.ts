/**
 * Ground-truth check for the auth path model: submits real XLM transfers out of
 * the testnet fixture smart accounts, signed by a chosen signer set, and
 * compares the on-chain result of `__check_auth` with RuleLens's prediction.
 *
 * Env: FIXTURE_SECRET, SIGNER_1_SECRET, SIGNER_2_SECRET (signer G-accounts must be funded),
 *      STALE_ACCOUNT, ONE_OF_N_ACCOUNT, CLEAN_ACCOUNT.
 */
import {
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  authorizeInvocation,
  hash,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { resolveAuthPaths } from '../src/authPaths.js';
import { readSnapshot, rpcReader } from '../src/reader.js';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const PASSPHRASE = Networks.TESTNET;
const RULE_ID = 0;
const TRANSFER_STROOPS = 1n;
const FUND_STROOPS = 20_000_000n;
const AUTH_VALID_LEDGERS = 100;

const server = new rpc.Server(RPC_URL);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const delegated = (g: string) => xdr.ScVal.scvVec([sym('Delegated'), new Address(g).toScVal()]);

async function nativeTokenId(): Promise<string> {
  const { Asset } = await import('@stellar/stellar-sdk');
  return Asset.native().contractId(PASSPHRASE);
}

async function submit(source: Keypair, op: xdr.Operation): Promise<{ ok: boolean; detail: string }> {
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(60)
    .build();
  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    const contractError = message.match(/Error\(Contract, #\d+\)/g)?.pop();
    return { ok: false, detail: `rejected in simulation: ${contractError ?? message.split('
')[0]}` };
  }
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') return { ok: false, detail: 'rejected by RPC' };
  const done = await server.pollTransaction(sent.hash, { attempts: 30 });
  return { ok: done.status === 'SUCCESS', detail: `${done.status} ${sent.hash}` };
}

async function fund(source: Keypair, token: string, account: string) {
  const result = await submit(
    source,
    Operation.invokeContractFunction({
      contract: token,
      function: 'transfer',
      args: [
        new Address(source.publicKey()).toScVal(),
        new Address(account).toScVal(),
        nativeToScVal(FUND_STROOPS, { type: 'i128' }),
      ],
    })
  );
  if (!result.ok) throw new Error(`funding ${account} failed: ${result.detail}`);
}

/** Transfer out of `account`, authorized by `signers` through rule 0. */
async function attempt(source: Keypair, token: string, account: string, signers: Keypair[]) {
  const args = [
    new Address(account).toScVal(),
    new Address(source.publicKey()).toScVal(),
    nativeToScVal(TRANSFER_STROOPS, { type: 'i128' }),
  ];
  const unsigned = new TransactionBuilder(await server.getAccount(source.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.invokeContractFunction({ contract: token, function: 'transfer', args }))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(unsigned);
  if (rpc.Api.isSimulationError(sim) || !sim.result) throw new Error(`simulation failed: ${JSON.stringify(sim).slice(0, 200)}`);

  const validUntil = sim.latestLedger + AUTH_VALID_LEDGERS;
  const ruleIds = xdr.ScVal.scvVec([u32(RULE_ID)]);
  let digest: Buffer | null = null;

  const accountEntry = await authorizeEntry(
    sim.result.auth[0],
    async (_preimage, payload) => {
      digest = hash(Buffer.concat([Buffer.from(payload), Buffer.from(ruleIds.toXDR())]));
      const sorted = signers
        .map(k => k.publicKey())
        .sort((a, b) => Buffer.compare(StrKey.decodeEd25519PublicKey(a), StrKey.decodeEd25519PublicKey(b)));
      const signatureScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: sym('context_rule_ids'), val: ruleIds }),
        new xdr.ScMapEntry({
          key: sym('signers'),
          val: xdr.ScVal.scvMap(sorted.map(g => new xdr.ScMapEntry({ key: delegated(g), val: xdr.ScVal.scvBytes(Buffer.alloc(0)) }))),
        }),
      ]);
      return { signatureScVal };
    },
    validUntil,
    PASSPHRASE
  );
  if (!digest) throw new Error('signing callback was not called');

  // Each delegated signer authorizes `__check_auth(auth_digest)` on the smart account.
  const signerEntries = await Promise.all(
    signers.map(k =>
      authorizeInvocation({
        signer: k,
        validUntilLedgerSeq: validUntil,
        networkPassphrase: PASSPHRASE,
        invocation: new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
              contractAddress: new Address(account).toScAddress(),
              functionName: '__check_auth',
              args: [xdr.ScVal.scvBytes(digest as Buffer)],
            })
          ),
          subInvocations: [],
        }),
      })
    )
  );

  return submit(
    source,
    Operation.invokeContractFunction({ contract: token, function: 'transfer', args, auth: [accountEntry, ...signerEntries] })
  );
}

async function main() {
  const source = Keypair.fromSecret(env('FIXTURE_SECRET'));
  const [k1, k2] = ['SIGNER_1_SECRET', 'SIGNER_2_SECRET'].map(n => Keypair.fromSecret(env(n)));
  const token = await nativeTokenId();
  const latest = await server.getLatestLedger();

  const cases = [
    { name: 'one-of-n, 1 signer', account: env('ONE_OF_N_ACCOUNT'), signers: [k1] },
    { name: 'clean 2-of-2, 1 signer', account: env('CLEAN_ACCOUNT'), signers: [k1] },
    { name: 'clean 2-of-2, 2 signers', account: env('CLEAN_ACCOUNT'), signers: [k1, k2] },
    { name: 'stale weights, 2 signers', account: env('STALE_ACCOUNT'), signers: [k1, k2] },
  ];

  const funded = new Set<string>();
  let mismatches = 0;
  for (const c of cases) {
    if (!funded.has(c.account)) {
      await fund(source, token, c.account);
      funded.add(c.account);
    }
    const snapshot = await readSnapshot(rpcReader(RPC_URL, PASSPHRASE), c.account, latest.sequence);
    const path = resolveAuthPaths(snapshot, { kind: 'call', contract: token, fn: 'transfer', amount: TRANSFER_STROOPS }).find(
      p => p.ruleId === RULE_ID
    );
    const predicted = path?.usable === true && c.signers.length >= (path.minSigners ?? Infinity);
    const actual = await attempt(source, token, c.account, c.signers);
    const match = predicted === actual.ok;
    if (!match) mismatches++;
    console.log(`${match ? 'MATCH   ' : 'MISMATCH'} ${c.name}: predicted ${predicted ? 'pass' : 'fail'}, chain ${actual.ok ? 'pass' : 'fail'} (${actual.detail})`);
  }
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(2);
});
