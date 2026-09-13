import { type Check, type Finding, signerKey } from '../types.js';

/**
 * Weighted threshold policies store weights independently of rule membership.
 * Weights of removed signers still count in the policy's own total, which can
 * hide a threshold that current signers can no longer reach.
 */
export const staleWeights: Check = snapshot => {
  const findings: Finding[] = [];
  for (const rule of snapshot.rules) {
    const members = new Set(rule.signers.map(signerKey));
    for (const policy of rule.policies) {
      if (policy.kind !== 'weightedThreshold') continue;

      const stale = policy.weights.filter(w => !members.has(signerKey(w.signer)));
      const reachable = policy.weights
        .filter(w => members.has(signerKey(w.signer)))
        .reduce((sum, w) => sum + w.weight, 0);

      if (reachable < policy.threshold) {
        findings.push({
          check: 'stale-weights',
          severity: 'critical',
          ruleId: rule.id,
          message: `Current signers reach weight ${reachable} of ${policy.threshold} required. The rule cannot authorize anything.`,
          fix: `Call set_threshold(${reachable || 1}) on ${policy.address}, or add weighted signers.`,
        });
      }
      if (stale.length > 0) {
        const names = stale.map(w => signerKey(w.signer)).join(', ');
        findings.push({
          check: 'stale-weights',
          severity: 'medium',
          ruleId: rule.id,
          message: `Weights kept for signers not in the rule: ${names}. They inflate the total that set_threshold validates against.`,
          fix: `Call set_signer_weight(signer, 0) on ${policy.address} for each removed signer.`,
        });
      }
    }
  }
  return findings;
};
