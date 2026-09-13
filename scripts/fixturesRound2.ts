/**
 * Round-2 testnet fixtures, each backed by real transactions:
 *
 * 1. Cross-verifier duplicate: one ed25519 key registered under two verifier
 *    contracts in a 2-of-2 rule. A single device then authorizes a transfer.
 * 2. Spending limit bypass: Default rule with one signer and no policy, plus a
 *    CallContract rule with a spending limit. Zero-amount transfers fill the
 *    history; a transfer above the limit fails under the scoped rule but
 *    passes through the Default rule.
 *
 * Env: FIXTURE_SECRET, SIGNER_1_SECRET, SIGNER_2_SECRET, DEVICE_SECRET, ACCOUNT_WASM_HASH,
 *      SIMPLE_POLICY, SPENDING_POLICY, VERIFIER_1, VERIFIER_2.
 */
import { Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  type SignerSpec,
  addr,
  deployAccount,
  env,
  fundWithXlm,
  invokeAsAccount,
  nativeTokenId,
  signerScVal,
  sortSigners,
  struct,
  sym,
  u32,
} from './harness.js';

const FUND_STROOPS = 50_000_000n;
const SPENDING_LIMIT = 1000n;
const PERIOD_LEDGERS = 17280;
const ZERO_TRANSFERS = 3;

const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });

function constructorArgs(signers: SignerSpec[], policies: Array<[string, xdr.ScVal]>): xdr.ScVal[] {
  return [
    xdr.ScVal.scvVec(sortSigners(signers).map(signerScVal)),
    xdr.ScVal.scvMap(policies.map(([policy, params]) => new xdr.ScMapEntry({ key: addr(policy), val: params }))),
  ];
}

function log(step: string, result: { ok: boolean; detail: string }) {
  console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${step}: ${result.detail}`);
}

async function crossVerifierFixture(source: Keypair, token: string) {
  const device = Keypair.fromSecret(env('DEVICE_SECRET'));
  const signers: SignerSpec[] = [
    { kind: 'external', verifier: env('VERIFIER_1'), keypair: device },
    { kind: 'external', verifier: env('VERIFIER_2'), keypair: device },
  ];
  const account = await deployAccount(
    source,
    env('ACCOUNT_WASM_HASH'),
    constructorArgs(signers, [[env('SIMPLE_POLICY'), struct({ threshold: u32(2) })]])
  );
  console.log(`crossVerifier ${account}`);
  await fundWithXlm(source, account, FUND_STROOPS);

  const result = await invokeAsAccount(
    source,
    account,
    token,
    'transfer',
    [addr(account), addr(source.publicKey()), i128(1n)],
    0,
    signers
  );
  log('2-of-2 transfer signed by ONE ed25519 device', result);
}

async function spendingFixture(source: Keypair, token: string) {
  const owner: SignerSpec = { kind: 'delegated', keypair: Keypair.fromSecret(env('SIGNER_1_SECRET')) };
  const hotKey: SignerSpec = { kind: 'delegated', keypair: Keypair.fromSecret(env('SIGNER_2_SECRET')) };

  const account = await deployAccount(source, env('ACCOUNT_WASM_HASH'), constructorArgs([owner], []));
  console.log(`spending ${account}`);
  await fundWithXlm(source, account, FUND_STROOPS);

  const addRule = await invokeAsAccount(
    source,
    account,
    account,
    'add_context_rule',
    [
      xdr.ScVal.scvVec([sym('CallContract'), addr(token)]),
      xdr.ScVal.scvString('hot-wallet'),
      xdr.ScVal.scvVoid(),
      xdr.ScVal.scvVec([signerScVal(hotKey)]),
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: addr(env('SPENDING_POLICY')),
          val: struct({ spending_limit: i128(SPENDING_LIMIT), period_ledgers: u32(PERIOD_LEDGERS) }),
        }),
      ]),
    ],
    0,
    [owner]
  );
  log('add CallContract rule 1 with spending limit (authorized by rule 0)', addRule);
  if (!addRule.ok) return;

  const transfer = (amount: bigint, ruleId: number, signer: SignerSpec) =>
    invokeAsAccount(source, account, token, 'transfer', [addr(account), addr(source.publicKey()), i128(amount)], ruleId, [signer]);

  for (let i = 0; i < ZERO_TRANSFERS; i++) log(`zero-amount transfer #${i + 1} via rule 1`, await transfer(0n, 1, hotKey));
  log('transfer 500 via rule 1', await transfer(500n, 1, hotKey));
  log('transfer 600 via rule 1 (exceeds remaining 500)', await transfer(600n, 1, hotKey));
  log('transfer 600 via rule 0 (Default, no policy)', await transfer(600n, 0, owner));
}

async function main() {
  const source = Keypair.fromSecret(env('FIXTURE_SECRET'));
  const token = nativeTokenId();
  await crossVerifierFixture(source, token);
  await spendingFixture(source, token);
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(2);
});
