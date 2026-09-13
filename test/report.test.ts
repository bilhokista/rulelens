import { describe, expect, it } from 'vitest';
import { formatReport } from '../src/report.js';
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
});
