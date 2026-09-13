import type { Check, Finding } from '../types.js';

/** Simple threshold sanity: unreachable thresholds and 1-of-N rules. */
export const thresholdShape: Check = snapshot => {
  const findings: Finding[] = [];
  for (const rule of snapshot.rules) {
    const n = rule.signers.length;
    for (const policy of rule.policies) {
      if (policy.kind !== 'simpleThreshold') continue;
      const t = policy.threshold;

      if (t > n) {
        findings.push({
          check: 'threshold-shape',
          severity: 'critical',
          ruleId: rule.id,
          message: `Threshold ${t} is higher than the ${n} signer(s) in the rule. The rule cannot authorize anything.`,
          fix: `Call set_threshold(${n}) on ${policy.address}, or add signers first.`,
        });
      } else if (t === 1 && n > 1) {
        const isDefault = rule.contextType.kind === 'default';
        findings.push({
          check: 'threshold-shape',
          severity: isDefault ? 'high' : 'info',
          ruleId: rule.id,
          message: isDefault
            ? `Default rule is 1-of-${n}: any single signer can authorize every call.`
            : `Scoped rule is 1-of-${n}.`,
          fix: isDefault
            ? `Raise the threshold on ${policy.address}, or scope the rule to specific contracts.`
            : 'Confirm this is intended.',
        });
      }
    }
  }
  return findings;
};
