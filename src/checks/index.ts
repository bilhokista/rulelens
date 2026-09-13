import type { AccountSnapshot, Finding, Severity } from '../types.js';
import { crossVerifierDuplicates } from './crossVerifierDuplicates.js';
import { ruleHygiene } from './ruleHygiene.js';
import { spendingHistoryPressure } from './spendingHistoryPressure.js';
import { staleWeights } from './staleWeights.js';
import { thresholdShape } from './thresholdShape.js';

export const CHECKS = [
  staleWeights,
  thresholdShape,
  crossVerifierDuplicates,
  spendingHistoryPressure,
  ruleHygiene,
] as const;

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function runChecks(snapshot: AccountSnapshot): Finding[] {
  return CHECKS.flatMap(check => check(snapshot)).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId - b.ruleId
  );
}
