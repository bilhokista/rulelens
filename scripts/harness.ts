/**
 * Testnet helpers shared by the fixture and verification scripts: submitting
 * transactions, deploying accounts, and signing as an OpenZeppelin smart
 * account with delegated (G-account) or external ed25519 signers.
 */
import {
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  authorizeInvocation,
  hash,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const PASSPHRASE = Networks.TESTNET;
export const server = new rpc.Server(RPC_URL);
const AUTH_VALID_LEDGERS = 100;

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export const sym = (s: string) => xdr.ScVal.scvSymbol(s);
export const u32 = (n: number) => xdr.ScVal.scvU32(n);
export const addr = (a: string) => new Address(a).toScVal();
export const nativeTokenId = () => Asset.native().contractId(PASSPHRASE);

export function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map(k => new xdr.ScMapEntry({ key: sym(k), val: fields[k] }))
  );
}

/** A signer as seen by the smart account, plus the key that produces its signature. */
export type SignerSpec =
  | { kind: 'delegated'; keypair: Keypair }
  | { kind: 'external'; verifier: string; keypair: Keypair };

export function signerScVal(spec: SignerSpec): xdr.ScVal {
  return spec.kind === 'delegated'
    ? xdr.ScVal.scvVec([sym('Delegated'), addr(spec.keypair.publicKey())])
    : xdr.ScVal.scvVec([sym('External'), addr(spec.verifier), xdr.ScVal.scvBytes(spec.keypair.rawPublicKey())]);
}

/**
 * Host maps must be sorted by ScVal order. Delegated (Symbol "Delegated") sorts
 * before External; within a variant, addresses compare by type then raw bytes.
 */
function signerSortKey(spec: SignerSpec): Buffer {
  if (spec.kind === 'delegated') {
    return Buffer.concat([Buffer.from([0, 0]), StrKey.decodeEd25519PublicKey(spec.keypair.publicKey())]);
  }
  return Buffer.concat([Buffer.from([1, 1]), StrKey.decodeContract(spec.verifier), spec.keypair.rawPublicKey()]);
}

export const sortSigners = (specs: SignerSpec[]) =>
  specs.slice().sort((a, b) => Buffer.compare(signerSortKey(a), signerSortKey(b)));

export async function submit(source: Keypair, op: xdr.Operation): Promise<{ ok: boolean; detail: string; returnValue?: xdr.ScVal }> {
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
    return { ok: false, detail: `rejected in simulation: ${contractError ?? message.split('\n')[0]}` };
  }
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') return { ok: false, detail: 'rejected by RPC' };
  const done = await server.pollTransaction(sent.hash, { attempts: 30 });
  const returnValue = done.status === 'SUCCESS' && 'returnValue' in done ? done.returnValue : undefined;
  return { ok: done.status === 'SUCCESS', detail: `${done.status} ${sent.hash}`, returnValue };
}

export async function deployAccount(source: Keypair, wasmHash: string, args: xdr.ScVal[]): Promise<string> {
  const result = await submit(
    source,
    Operation.createCustomContract({
      address: new Address(source.publicKey()),
      wasmHash: Buffer.from(wasmHash, 'hex'),
      constructorArgs: args,
      salt: Buffer.from(Keypair.random().rawPublicKey()),
    })
  );
  if (!result.ok || !result.returnValue) throw new Error(`deploy failed: ${result.detail}`);
  return Address.fromScVal(result.returnValue).toString();
}

function countInvocations(invocation: xdr.SorobanAuthorizedInvocation): number {
  const subs = (invocation as unknown as { subInvocations: xdr.SorobanAuthorizedInvocation[] }).subInvocations ?? [];
  return 1 + subs.reduce((n, sub) => n + countInvocations(sub), 0);
}

/**
 * Invokes `contract.fn(args)` where `account` (a smart account) must authorize,
 * signing through `ruleId` for every auth context with the given signers.
 */
export async function invokeAsAccount(
  source: Keypair,
  account: string,
  contract: string,
  fn: string,
  args: xdr.ScVal[],
  ruleId: number,
  signers: SignerSpec[]
) {
  const unsigned = new TransactionBuilder(await server.getAccount(source.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.invokeContractFunction({ contract, function: fn, args }))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(unsigned);
  if (rpc.Api.isSimulationError(sim) || !sim.result) {
    return { ok: false, detail: `simulation failed: ${rpc.Api.isSimulationError(sim) ? sim.error.split('\n')[0] : 'no result'}` };
  }
  const entry = sim.result.auth.find(e => {
    try {
      return JSON.stringify(e).includes(account);
    } catch {
      return false;
    }
  }) ?? sim.result.auth[0];
  const contexts = countInvocations((entry as unknown as { rootInvocation: xdr.SorobanAuthorizedInvocation }).rootInvocation);

  const validUntil = sim.latestLedger + AUTH_VALID_LEDGERS;
  const ruleIds = xdr.ScVal.scvVec(Array.from({ length: contexts }, () => u32(ruleId)));
  const sorted = sortSigners(signers);
  let digest: Buffer | null = null;

  const accountEntry = await authorizeEntry(
    entry,
    async (_preimage, payload) => {
      digest = hash(Buffer.concat([Buffer.from(payload), Buffer.from(ruleIds.toXDR())]));
      const signatureMap = sorted.map(
        spec =>
          new xdr.ScMapEntry({
            key: signerScVal(spec),
            val: xdr.ScVal.scvBytes(spec.kind === 'external' ? spec.keypair.sign(digest as Buffer) : Buffer.alloc(0)),
          })
      );
      return {
        signatureScVal: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({ key: sym('context_rule_ids'), val: ruleIds }),
          new xdr.ScMapEntry({ key: sym('signers'), val: xdr.ScVal.scvMap(signatureMap) }),
        ]),
      };
    },
    validUntil,
    PASSPHRASE
  );
  if (!digest) throw new Error('signing callback was not called');

  // Delegated signers authorize `__check_auth(auth_digest)` with their own G-account.
  const delegatedEntries = await Promise.all(
    sorted
      .filter((s): s is Extract<SignerSpec, { kind: 'delegated' }> => s.kind === 'delegated')
      .map(s =>
        authorizeInvocation({
          signer: s.keypair,
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

  const others = sim.result.auth.filter(e => e !== entry);
  return submit(
    source,
    Operation.invokeContractFunction({ contract, function: fn, args, auth: [accountEntry, ...others, ...delegatedEntries] })
  );
}

export async function fundWithXlm(source: Keypair, account: string, stroops: bigint) {
  const { nativeToScVal } = await import('@stellar/stellar-sdk');
  const result = await submit(
    source,
    Operation.invokeContractFunction({
      contract: nativeTokenId(),
      function: 'transfer',
      args: [addr(source.publicKey()), addr(account), nativeToScVal(stroops, { type: 'i128' })],
    })
  );
  if (!result.ok) throw new Error(`funding ${account} failed: ${result.detail}`);
}
