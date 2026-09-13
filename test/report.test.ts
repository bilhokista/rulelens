import { describe, expect, it } from 'vitest';
import { formatAuthPaths, formatReport } from '../src/report.js';
import { snapshot, rule } from './fixtures.js';

describe('formatReport', () => {
  it('says clearly when nothing was found', () => {
    expect(formatReport(snapshot([rule()]), [])).toContain('No configuration issues');
  });

  it('prints severity, rule, message and fix for each finding', () => {
    const out = formatReport(snapshot([rule()]), [
      { check: 'threshold-shape', severity: 'critical', ruleId: 4, message: 'Broken.', fix: 'Repair.' },
    ]);
    expect(out).toContain('[CRITICAL] rule 4');
    expect(out).toContain('Fix: Repair.');
  });

  it('names the weakest path and blocked rules', () => {
    const out = formatAuthPaths({ kind: 'call', contract: 'CTOKEN', fn: 'transfer', amount: 5n }, [
      { ruleId: 2, ruleName: 'hot', usable: true, minSigners: 1, summary: 'any 1 of [a]', notes: ['bypasses rule 1'] },
      { ruleId: 1, ruleName: 'cold', usable: false, minSigners: null, summary: 'threshold 3 exceeds 2', notes: [] },
    ]);
    expect(out).toContain('CTOKEN.transfer() amount 5');
    expect(out).toContain('rule 1 "cold": BLOCKED');
    expect(out).toContain('Weakest path: rule 2 with 1 signer(s)');
  });

  it('explains when no rule matches', () => {
    expect(formatAuthPaths({ kind: 'create', wasmHashHex: 'ab' }, [])).toContain('cannot authorize');
  });
});
