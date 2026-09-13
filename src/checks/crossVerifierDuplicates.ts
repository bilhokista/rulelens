import type { Check, Finding } from '../types.js';

/**
 * The library deduplicates external signers canonically only within one
 * verifier address. The same key under two verifier contracts is two signers
 * and counts twice toward a threshold.
 */
export const crossVerifierDuplicates: Check = snapshot => {
  const findings: Finding[] = [];
  for (const rule of snapshot.rules) {
    const verifiersByKey = new Map<string, Set<string>>();
    for (const signer of rule.signers) {
      if (signer.kind !== 'external') continue;
      const key = signer.keyHex.toLowerCase();
      const verifiers = verifiersByKey.get(key) ?? new Set<string>();
      verifiers.add(signer.verifier);
      verifiersByKey.set(key, verifiers);
    }
    for (const [key, verifiers] of verifiersByKey) {
      if (verifiers.size < 2) continue;
      findings.push({
        check: 'cross-verifier-duplicates',
        severity: 'high',
        ruleId: rule.id,
        message: `Key ${key.slice(0, 16)} is registered under ${verifiers.size} verifiers (${[...verifiers].join(', ')}). One device counts as ${verifiers.size} signers.`,
        fix: 'Remove all but one of these signers with remove_signer.',
      });
    }
  }
  return findings;
};
