import type { Check, Finding } from '../types.js';

/** Mirrors MAX_HISTORY_ENTRIES in stellar-contracts policies/spending_limit.rs. */
export const MAX_HISTORY_ENTRIES = 1000;
const WARN_RATIO = 0.8;

/**
 * Spending limit history is capped. When full, every transfer under the rule
 * fails until entries age out of the period. Zero-amount transfers are accepted
 * and consume capacity without spending anything.
 */
export const spendingHistoryPressure: Check = snapshot => {
  const findings: Finding[] = [];
  for (const rule of snapshot.rules) {
    for (const policy of rule.policies) {
      if (policy.kind !== 'spendingLimit') continue;

      if (policy.historyLength >= MAX_HISTORY_ENTRIES * WARN_RATIO) {
        findings.push({
          check: 'spending-history-pressure',
          severity: 'medium',
          ruleId: rule.id,
          message: `Spending history holds ${policy.historyLength} of ${MAX_HISTORY_ENTRIES} entries. At capacity, transfers under this rule fail for up to ${policy.periodLedgers} ledgers.`,
          fix: 'Batch payments into fewer transfers, or reinstall the policy with a shorter period_ledgers.',
        });
      } else if (policy.zeroAmountEntries > 0) {
        findings.push({
          check: 'spending-history-pressure',
          severity: 'low',
          ruleId: rule.id,
          message: `${policy.zeroAmountEntries} zero-amount transfers are in the spending history. They use capacity without spending and may indicate griefing by a rule signer.`,
          fix: 'Review which signer submitted them; rotate that signer if unexpected.',
        });
      }
    }
  }
  return findings;
};
