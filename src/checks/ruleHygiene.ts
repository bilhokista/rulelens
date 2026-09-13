import type { Check, Finding } from '../types.js';

/** Structural issues visible from rule metadata alone. */
export const ruleHygiene: Check = snapshot => {
  const findings: Finding[] = [];
  for (const rule of snapshot.rules) {
    if (rule.validUntil !== null && rule.validUntil < snapshot.currentLedger) {
      findings.push({
        check: 'rule-hygiene',
        severity: 'info',
        ruleId: rule.id,
        message: `Rule "${rule.name}" expired at ledger ${rule.validUntil} but is still stored.`,
        fix: `Call remove_context_rule(${rule.id}) to clean it up.`,
      });
    }
    if (
      rule.contextType.kind === 'default' &&
      rule.policies.length === 0 &&
      rule.signers.length === 1
    ) {
      findings.push({
        check: 'rule-hygiene',
        severity: 'high',
        ruleId: rule.id,
        message: 'Default rule with one signer and no policy: that signer alone controls the account.',
        fix: 'Add a second signer with a threshold policy, or scope the rule.',
      });
    }
    if (rule.signers.length === 0 && rule.policies.length > 0) {
      findings.push({
        check: 'rule-hygiene',
        severity: 'medium',
        ruleId: rule.id,
        message: 'Rule has policies but no signers. Authorization depends entirely on policy logic.',
        fix: 'Confirm each policy enforces its own authorization.',
      });
    }
  }
  return findings;
};
