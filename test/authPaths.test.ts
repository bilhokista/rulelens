import { describe, expect, it } from 'vitest';
import { resolveAuthPaths } from '../src/authPaths.js';
import type { Policy } from '../src/types.js';
import { alice, bob, carol, passkey, rule, snapshot } from './fixtures.js';

const TOKEN = 'CTOKEN';
const call = (fn = 'transfer', amount?: bigint) => ({ kind: 'call' as const, contract: TOKEN, fn, amount });

const spendingPolicy = (overrides: Partial<Extract<Policy, { kind: 'spendingLimit' }>> = {}): Policy => ({
  kind: 'spendingLimit',
  address: 'CSPEND',
  spendingLimit: 100n,
  periodLedgers: 100,
  historyLength: 0,
  zeroAmountEntries: 0,
  history: [],
  ...overrides,
});

describe('resolveAuthPaths', () => {
  it('requires every signer on a rule without policies', () => {
    const paths = resolveAuthPaths(snapshot([rule({ signers: [alice, bob] })]), call());
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ ruleId: 0, minSigners: 2, usable: true });
  });

  it('ignores rules scoped to other contracts and expired rules', () => {
    const paths = resolveAuthPaths(
      snapshot(
        [
          rule({ id: 1, contextType: { kind: 'callContract', contract: 'COTHER' } }),
          rule({ id: 2, validUntil: 10 }),
          rule({ id: 3, contextType: { kind: 'callContract', contract: TOKEN } }),
        ],
        1000
      ),
      call()
    );
    expect(paths.map(p => p.ruleId)).toEqual([3]);
  });

  it('uses the simple threshold count', () => {
    const paths = resolveAuthPaths(
      snapshot([
        rule({ signers: [alice, bob, carol], policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 2 }] }),
      ]),
      call()
    );
    expect(paths[0].minSigners).toBe(2);
  });

  it('marks a simple threshold above signer count as unusable', () => {
    const paths = resolveAuthPaths(
      snapshot([rule({ signers: [alice], policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 2 }] })]),
      call()
    );
    expect(paths[0]).toMatchObject({ usable: false, minSigners: null });
  });

  it('picks the fewest heaviest signers for a weighted threshold, ignoring non-members', () => {
    const paths = resolveAuthPaths(
      snapshot([
        rule({
          signers: [alice, bob, carol],
          policies: [
            {
              kind: 'weightedThreshold',
              address: 'CW',
              threshold: 5,
              weights: [
                { signer: alice, weight: 1 },
                { signer: bob, weight: 2 },
                { signer: carol, weight: 3 },
                { signer: { kind: 'delegated', address: 'GOUTSIDER' }, weight: 10 },
              ],
            },
          ],
        }),
      ]),
      call()
    );
    expect(paths[0].minSigners).toBe(2);
    expect(paths[0].summary).toContain('GCAROL');
  });

  it('allows a spending-limited transfer within the remaining allowance', () => {
    const paths = resolveAuthPaths(
      snapshot(
        [
          rule({
            contextType: { kind: 'callContract', contract: TOKEN },
            signers: [alice],
            policies: [spendingPolicy({ history: [{ amount: 70n, ledger: 950 }, { amount: 90n, ledger: 850 }] })],
          }),
        ],
        1000
      ),
      call('transfer', 30n)
    );
    expect(paths[0]).toMatchObject({ usable: true, minSigners: 1 });
    expect(paths[0].notes.join(' ')).toContain('remaining 30');
  });

  it('rejects a spending-limited transfer above the remaining allowance', () => {
    const paths = resolveAuthPaths(
      snapshot(
        [
          rule({
            contextType: { kind: 'callContract', contract: TOKEN },
            signers: [alice],
            policies: [spendingPolicy({ history: [{ amount: 70n, ledger: 950 }] })],
          }),
        ],
        1000
      ),
      call('transfer', 31n)
    );
    expect(paths[0].usable).toBe(false);
  });

  it('rejects non-transfer functions under a spending limit', () => {
    const paths = resolveAuthPaths(
      snapshot([
        rule({ contextType: { kind: 'callContract', contract: TOKEN }, signers: [alice], policies: [spendingPolicy()] }),
      ]),
      call('approve')
    );
    expect(paths[0].usable).toBe(false);
  });

  it('does not decide rules with unknown policies', () => {
    const paths = resolveAuthPaths(
      snapshot([rule({ policies: [{ kind: 'unknown', address: 'CX' }] })]),
      call()
    );
    expect(paths[0]).toMatchObject({ usable: null, minSigners: null });
  });

  it('sorts the weakest usable path first and flags it when it undercuts a scoped rule', () => {
    const paths = resolveAuthPaths(
      snapshot([
        rule({
          id: 1,
          contextType: { kind: 'callContract', contract: TOKEN },
          signers: [alice, bob, carol],
          policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 3 }],
        }),
        rule({
          id: 2,
          signers: [alice, bob],
          policies: [{ kind: 'simpleThreshold', address: 'CT2', threshold: 1 }],
        }),
      ]),
      call()
    );
    expect(paths.map(p => p.ruleId)).toEqual([2, 1]);
    expect(paths[0].notes.join(' ')).toContain('bypasses rule 1');
  });

  it('matches create-contract targets by wasm hash', () => {
    const paths = resolveAuthPaths(
      snapshot([
        rule({ id: 1, contextType: { kind: 'createContract', wasmHashHex: 'ab' } }),
        rule({ id: 2, contextType: { kind: 'createContract', wasmHashHex: 'cd' } }),
      ]),
      { kind: 'create', wasmHashHex: 'AB' }
    );
    expect(paths.map(p => p.ruleId)).toEqual([1]);
  });

  it('counts distinct keys when one key is registered under two verifiers', () => {
    const paths = resolveAuthPaths(
      snapshot([
        rule({
          signers: [passkey('CV1', '04aa'), passkey('CV2', '04AA'), alice],
          policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 2 }],
        }),
      ]),
      call()
    );
    expect(paths[0]).toMatchObject({ minSigners: 2, minKeys: 1 });
  });

  it('counts distinct keys for weighted thresholds', () => {
    const paths = resolveAuthPaths(
      snapshot([
        rule({
          signers: [passkey('CV1', '04aa'), passkey('CV2', '04aa'), alice],
          policies: [
            {
              kind: 'weightedThreshold',
              address: 'CW',
              threshold: 4,
              weights: [
                { signer: passkey('CV1', '04aa'), weight: 2 },
                { signer: passkey('CV2', '04aa'), weight: 2 },
                { signer: alice, weight: 3 },
              ],
            },
          ],
        }),
      ]),
      call()
    );
    expect(paths[0]).toMatchObject({ minKeys: 1 });
  });

  it('ranks by distinct keys so a duplicated key rule is weaker than a real 2-of-2', () => {
    const paths = resolveAuthPaths(
      snapshot([
        rule({ id: 1, signers: [alice, bob], policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 2 }] }),
        rule({
          id: 2,
          signers: [passkey('CV1'), passkey('CV2')],
          policies: [{ kind: 'simpleThreshold', address: 'CT2', threshold: 2 }],
        }),
      ]),
      call()
    );
    expect(paths.map(p => p.ruleId)).toEqual([2, 1]);
  });
});
