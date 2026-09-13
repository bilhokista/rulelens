import { describe, expect, it } from 'vitest';
import { staleWeights } from '../src/checks/staleWeights.js';
import { thresholdShape } from '../src/checks/thresholdShape.js';
import { crossVerifierDuplicates } from '../src/checks/crossVerifierDuplicates.js';
import { spendingHistoryPressure } from '../src/checks/spendingHistoryPressure.js';
import { ruleHygiene } from '../src/checks/ruleHygiene.js';
import { runChecks } from '../src/checks/index.js';
import { alice, bob, carol, passkey, rule, snapshot } from './fixtures.js';

describe('staleWeights', () => {
  it('flags weights for signers no longer in the rule', () => {
    const findings = staleWeights(
      snapshot([
        rule({
          signers: [alice, bob],
          policies: [
            {
              kind: 'weightedThreshold',
              address: 'CWEIGHT',
              threshold: 2,
              weights: [
                { signer: alice, weight: 1 },
                { signer: bob, weight: 1 },
                { signer: carol, weight: 5 },
              ],
            },
          ],
        }),
      ])
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].message).toContain('GCAROL');
  });

  it('reports critical when threshold is unreachable with current signers', () => {
    const findings = staleWeights(
      snapshot([
        rule({
          signers: [alice],
          policies: [
            {
              kind: 'weightedThreshold',
              address: 'CWEIGHT',
              threshold: 3,
              weights: [
                { signer: alice, weight: 1 },
                { signer: bob, weight: 2 },
              ],
            },
          ],
        }),
      ])
    );
    expect(findings.map(f => f.severity)).toEqual(['critical', 'medium']);
    expect(findings[0].message).toContain('1 of 3');
  });

  it('is silent for a consistent weighted rule', () => {
    const findings = staleWeights(
      snapshot([
        rule({
          policies: [
            {
              kind: 'weightedThreshold',
              address: 'CWEIGHT',
              threshold: 2,
              weights: [
                { signer: alice, weight: 1 },
                { signer: bob, weight: 1 },
              ],
            },
          ],
        }),
      ])
    );
    expect(findings).toEqual([]);
  });
});

describe('thresholdShape', () => {
  it('flags unreachable simple threshold', () => {
    const findings = thresholdShape(
      snapshot([rule({ policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 3 }] })])
    );
    expect(findings[0].severity).toBe('critical');
  });

  it('flags 1-of-N on a default rule as high', () => {
    const findings = thresholdShape(
      snapshot([
        rule({
          signers: [alice, bob, carol],
          policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 1 }],
        }),
      ])
    );
    expect(findings[0].severity).toBe('high');
  });

  it('reports 1-of-N on a scoped rule only as info', () => {
    const findings = thresholdShape(
      snapshot([
        rule({
          contextType: { kind: 'callContract', contract: 'CTOKEN' },
          policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 1 }],
        }),
      ])
    );
    expect(findings[0].severity).toBe('info');
  });

  it('is silent for 2-of-2', () => {
    expect(
      thresholdShape(
        snapshot([rule({ policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 2 }] })])
      )
    ).toEqual([]);
  });
});

describe('crossVerifierDuplicates', () => {
  it('flags the same key registered under two verifier contracts', () => {
    const findings = crossVerifierDuplicates(
      snapshot([rule({ signers: [passkey('CVERIFIER1', '04AA'), passkey('CVERIFIER2', '04aa')] })])
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
  });

  it('ignores different keys', () => {
    expect(
      crossVerifierDuplicates(
        snapshot([rule({ signers: [passkey('CV1', '04aa'), passkey('CV2', '04bb')] })])
      )
    ).toEqual([]);
  });
});

describe('spendingHistoryPressure', () => {
  const spending = (historyLength: number, zeroAmountEntries = 0) =>
    snapshot([
      rule({
        contextType: { kind: 'callContract', contract: 'CTOKEN' },
        policies: [
          {
            kind: 'spendingLimit',
            address: 'CSPEND',
            spendingLimit: 100n,
            periodLedgers: 17280,
            historyLength,
            zeroAmountEntries,
            history: [],
          },
        ],
      }),
    ]);

  it('is silent when history is small', () => {
    expect(spendingHistoryPressure(spending(10))).toEqual([]);
  });

  it('warns when history passes 80% of capacity', () => {
    expect(spendingHistoryPressure(spending(850))[0].severity).toBe('medium');
  });

  it('flags zero-amount entries as griefing evidence', () => {
    const findings = spendingHistoryPressure(spending(20, 12));
    expect(findings[0].severity).toBe('low');
    expect(findings[0].message).toContain('12');
  });
});

describe('ruleHygiene', () => {
  it('flags expired rules', () => {
    const findings = ruleHygiene(snapshot([rule({ validUntil: 500 })], 1000));
    expect(findings.some(f => f.check === 'rule-hygiene' && f.message.includes('expired'))).toBe(
      true
    );
  });

  it('flags a default rule with a single signer and no policy', () => {
    const findings = ruleHygiene(snapshot([rule({ signers: [alice] })]));
    expect(findings[0].severity).toBe('high');
  });

  it('flags a rule with policies but no signers', () => {
    const findings = ruleHygiene(
      snapshot([rule({ signers: [], policies: [{ kind: 'unknown', address: 'CX' }] })])
    );
    expect(findings.some(f => f.message.includes('no signers'))).toBe(true);
  });
});

describe('runChecks', () => {
  it('sorts findings by severity', () => {
    const findings = runChecks(
      snapshot([
        rule({ id: 1, validUntil: 1 }),
        rule({ id: 2, policies: [{ kind: 'simpleThreshold', address: 'CT', threshold: 9 }] }),
      ])
    );
    expect(findings[0].severity).toBe('critical');
  });
});
