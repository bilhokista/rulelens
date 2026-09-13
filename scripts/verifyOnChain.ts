/**
 * Ground truth for `--simulate`: for each case, asks RuleLens whether a signer
 * set can move XLM out of a fixture account through a given rule, then submits
 * the real transfer on testnet and compares.
 *
 * Env: FIXTURE_SECRET, SIGNER_1_SECRET, SIGNER_2_SECRET, DEVICE_SECRET,
 *      VERIFIER_1, VERIFIER_2, ONE_OF_N_ACCOUNT, CLEAN_ACCOUNT, STALE_ACCOUNT,
 *      CROSS_VERIFIER_ACCOUNT, SPENDING_ACCOUNT. Signer G-accounts must be funded.
 */
import { Keypair, nativeToScVal } from '@stellar/stellar-sdk';
import { resolveAuthPaths } from '../src/authPaths.js';
import { readSnapshot, rpcReader } from '../src/reader.js';
import { type SignerSpec, PASSPHRASE, RPC_URL, addr, env, fundWithXlm, invokeAsAccount, nativeTokenId, server } from './harness.js';

const FUND_STROOPS = 20_000_000n;

interface Case {
  name: string;
  account: string;
  ruleId: number;
  signers: SignerSpec[];
  amount: bigint;
}

async function main() {
  const source = Keypair.fromSecret(env('FIXTURE_SECRET'));
  const token = nativeTokenId();
  const d = (secret: string): SignerSpec => ({ kind: 'delegated', keypair: Keypair.fromSecret(env(secret)) });
  const device = Keypair.fromSecret(env('DEVICE_SECRET'));
  const viaVerifier = (v: string): SignerSpec => ({ kind: 'external', verifier: env(v), keypair: device });

  const cases: Case[] = [
    { name: '1-of-3, 1 signer', account: env('ONE_OF_N_ACCOUNT'), ruleId: 0, signers: [d('SIGNER_1_SECRET')], amount: 1n },
    { name: '2-of-2, 1 signer', account: env('CLEAN_ACCOUNT'), ruleId: 0, signers: [d('SIGNER_1_SECRET')], amount: 1n },
    { name: '2-of-2, 2 signers', account: env('CLEAN_ACCOUNT'), ruleId: 0, signers: [d('SIGNER_1_SECRET'), d('SIGNER_2_SECRET')], amount: 1n },
    { name: 'weighted 2 of 3, 2 signers', account: env('STALE_ACCOUNT'), ruleId: 0, signers: [d('SIGNER_1_SECRET'), d('SIGNER_2_SECRET')], amount: 1n },
    { name: '2-of-2 cross-verifier, 1 device', account: env('CROSS_VERIFIER_ACCOUNT'), ruleId: 0, signers: [viaVerifier('VERIFIER_1'), viaVerifier('VERIFIER_2')], amount: 1n },
    { name: 'spending rule, within limit', account: env('SPENDING_ACCOUNT'), ruleId: 1, signers: [d('SIGNER_2_SECRET')], amount: 1n },
    { name: 'spending rule, above limit', account: env('SPENDING_ACCOUNT'), ruleId: 1, signers: [d('SIGNER_2_SECRET')], amount: 5000n },
    { name: 'default rule, above spending limit', account: env('SPENDING_ACCOUNT'), ruleId: 0, signers: [d('SIGNER_1_SECRET')], amount: 5000n },
  ];

  const funded = new Set<string>();
  let mismatches = 0;
  for (const c of cases) {
    if (!funded.has(c.account)) {
      await fundWithXlm(source, c.account, FUND_STROOPS);
      funded.add(c.account);
    }
    const latest = await server.getLatestLedger();
    const snapshot = await readSnapshot(rpcReader(RPC_URL, PASSPHRASE), c.account, latest.sequence);
    const path = resolveAuthPaths(snapshot, { kind: 'call', contract: token, fn: 'transfer', amount: c.amount }).find(
      p => p.ruleId === c.ruleId
    );
    const distinctKeys = new Set(c.signers.map(s => s.keypair.publicKey())).size;
    const predicted =
      path?.usable === true && c.signers.length >= (path.minSigners ?? Infinity) && distinctKeys >= (path.minKeys ?? Infinity);

    const actual = await invokeAsAccount(
      source,
      c.account,
      token,
      'transfer',
      [addr(c.account), addr(source.publicKey()), nativeToScVal(c.amount, { type: 'i128' })],
      c.ruleId,
      c.signers
    );
    const match = predicted === actual.ok;
    if (!match) mismatches++;
    console.log(`${match ? 'MATCH   ' : 'MISMATCH'} ${c.name}: predicted ${predicted ? 'pass' : 'fail'}, chain ${actual.ok ? 'pass' : 'fail'} (${actual.detail})`);
  }
  console.log(`${cases.length - mismatches}/${cases.length} cases match`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(2);
});
