import { type AccountSnapshot, type ContextRule, type Policy, type Signer, signerKey } from './types.js';

/**
 * Off-chain model of `smart_account::do_check_auth` (stellar-contracts v0.7.2).
 *
 * The transaction author chooses which context rule authorizes each context,
 * so an account is only as strict as the weakest rule that matches a call.
 * This lists every matching rule and the smallest signer set it accepts.
 */

export type AuthTarget =
  | { kind: 'call'; contract: string; fn: string; amount?: bigint }
  | { kind: 'create'; wasmHashHex: string };

export interface AuthPath {
  ruleId: number;
  ruleName: string;
  /** true: satisfiable, false: can never pass for this target, null: depends on logic RuleLens cannot model. */
  usable: boolean | null;
  minSigners: number | null;
  /** Distinct keys behind those signers; lower when one key is registered under several verifiers. */
  minKeys: number | null;
  summary: string;
  notes: string[];
}

interface Requirement {
  usable: boolean | null;
  minSigners: number | null;
  minKeys: number | null;
  summary: string;
  notes: string[];
}

const SPENDING_FN = 'transfer';

function matchesTarget(rule: ContextRule, target: AuthTarget): boolean {
  const type = rule.contextType;
  if (type.kind === 'default') return true;
  if (target.kind === 'call') return type.kind === 'callContract' && type.contract === target.contract;
  return type.kind === 'createContract' && type.wasmHashHex.toLowerCase() === target.wasmHashHex.toLowerCase();
}

const names = (signers: ReadonlyArray<Signer>) => signers.map(signerKey).join(', ');

/** The device behind a signer: an external key is the same device under any verifier. */
const keyIdentity = (signer: Signer) =>
  signer.kind === 'external' ? `key:${signer.keyHex.toLowerCase()}` : `address:${signer.address}`;

/** Smallest number of distinct keys whose grouped values reach `target`. */
function fewestKeys(values: Array<{ signer: Signer; value: number }>, target: number): number | null {
  const byKey = new Map<string, number>();
  for (const { signer, value } of values) byKey.set(keyIdentity(signer), (byKey.get(keyIdentity(signer)) ?? 0) + value);
  let total = 0;
  let keys = 0;
  for (const value of [...byKey.values()].sort((a, b) => b - a)) {
    if (total >= target) break;
    total += value;
    keys++;
  }
  return total >= target ? Math.max(keys, 1) : null;
}

function thresholdRequirement(rule: ContextRule, policy: Extract<Policy, { kind: 'simpleThreshold' }>): Requirement {
  const n = rule.signers.length;
  if (policy.threshold > n) {
    return {
      usable: false,
      minSigners: null,
      minKeys: null,
      summary: `threshold ${policy.threshold} exceeds ${n} signer(s)`,
      notes: [],
    };
  }
  return {
    usable: true,
    minSigners: policy.threshold,
    minKeys: fewestKeys(rule.signers.map(signer => ({ signer, value: 1 })), policy.threshold),
    summary: `any ${policy.threshold} of [${names(rule.signers)}]`,
    notes: [],
  };
}

function weightedRequirement(rule: ContextRule, policy: Extract<Policy, { kind: 'weightedThreshold' }>): Requirement {
  const members = new Set(rule.signers.map(signerKey));
  // Heaviest first: the greedy prefix is the smallest signer set reaching the threshold.
  const ranked = policy.weights
    .filter(w => members.has(signerKey(w.signer)) && w.weight > 0)
    .slice()
    .sort((a, b) => b.weight - a.weight);

  let total = 0;
  const chosen: Signer[] = [];
  for (const entry of ranked) {
    if (total >= policy.threshold) break;
    total += entry.weight;
    chosen.push(entry.signer);
  }
  if (total < policy.threshold) {
    return {
      usable: false,
      minSigners: null,
      minKeys: null,
      summary: `signers reach weight ${total} of ${policy.threshold}`,
      notes: [],
    };
  }
  return {
    usable: true,
    minSigners: chosen.length,
    minKeys: fewestKeys(ranked.map(w => ({ signer: w.signer, value: w.weight })), policy.threshold),
    summary: `weight ${policy.threshold} reachable with [${names(chosen)}]`,
    notes: [],
  };
}

function spendingRequirement(
  policy: Extract<Policy, { kind: 'spendingLimit' }>,
  target: AuthTarget,
  currentLedger: number
): Requirement {
  if (target.kind !== 'call' || target.fn !== SPENDING_FN) {
    return { usable: false, minSigners: null, minKeys: null, summary: `spending limit only allows ${SPENDING_FN}`, notes: [] };
  }
  const cutoff = Math.max(0, currentLedger - policy.periodLedgers);
  const spent = policy.history.filter(e => e.ledger > cutoff).reduce((sum, e) => sum + e.amount, 0n);
  const remaining = policy.spendingLimit - spent;
  const note = `spending limit ${policy.spendingLimit}, spent ${spent} in window, remaining ${remaining}`;

  if (target.amount === undefined) {
    return { usable: null, minSigners: 1, minKeys: 1, summary: 'transfer within spending limit', notes: [`${note}; pass an amount to decide`] };
  }
  if (target.amount < 0n || target.amount > remaining) {
    return { usable: false, minSigners: null, minKeys: null, summary: `amount ${target.amount} exceeds remaining ${remaining}`, notes: [note] };
  }
  return { usable: true, minSigners: 1, minKeys: 1, summary: 'transfer within spending limit', notes: [note] };
}

function policyRequirement(rule: ContextRule, policy: Policy, target: AuthTarget, currentLedger: number): Requirement {
  switch (policy.kind) {
    case 'simpleThreshold':
      return thresholdRequirement(rule, policy);
    case 'weightedThreshold':
      return weightedRequirement(rule, policy);
    case 'spendingLimit':
      return spendingRequirement(policy, target, currentLedger);
    case 'unknown':
      return {
        usable: null,
        minSigners: null,
        minKeys: null,
        summary: `custom policy ${policy.address}`,
        notes: ['custom policy logic is not modelled'],
      };
  }
}

function combine(rule: ContextRule, target: AuthTarget, currentLedger: number): Requirement {
  if (rule.policies.length === 0) {
    const n = rule.signers.length;
    const keys = new Set(rule.signers.map(keyIdentity)).size;
    return {
      usable: n > 0,
      minSigners: n > 0 ? n : null,
      minKeys: n > 0 ? keys : null,
      summary: `all of [${names(rule.signers)}]`,
      notes: [],
    };
  }

  const parts = rule.policies.map(p => policyRequirement(rule, p, target, currentLedger));
  const notes = parts.flatMap(p => p.notes);
  const summary = parts.map(p => p.summary).join(' AND ');

  if (parts.some(p => p.usable === false)) return { usable: false, minSigners: null, minKeys: null, summary, notes };
  if (parts.some(p => p.usable === null)) {
    return { usable: null, minSigners: null, minKeys: null, summary, notes };
  }
  const counted = parts.filter(p => p.minSigners !== null);
  if (counted.length > 1) notes.push('several policies: signer count is a lower bound, each policy may need different signers');
  const minSigners = Math.max(1, ...counted.map(p => p.minSigners as number));
  const minKeys = Math.max(1, ...counted.map(p => p.minKeys ?? (p.minSigners as number)));
  if (minKeys < minSigners) notes.push(`${minSigners} signer entries can be satisfied by ${minKeys} distinct key(s)`);
  return { usable: true, minSigners, minKeys, summary, notes };
}

const UNRANKED = 1_000_000;

function rank(path: AuthPath): number {
  if (path.usable === true) return (path.minKeys ?? UNRANKED) * 1000 + (path.minSigners ?? 0);
  return path.usable === null ? UNRANKED * 1000 : UNRANKED * 1000 + 1;
}

export function resolveAuthPaths(snapshot: AccountSnapshot, target: AuthTarget): AuthPath[] {
  const paths: AuthPath[] = snapshot.rules
    .filter(rule => rule.validUntil === null || rule.validUntil >= snapshot.currentLedger)
    .filter(rule => matchesTarget(rule, target))
    .map(rule => ({ ruleId: rule.id, ruleName: rule.name, ...combine(rule, target, snapshot.currentLedger) }))
    .sort((a, b) => rank(a) - rank(b) || a.ruleId - b.ruleId);

  const weakest = paths[0];
  if (weakest?.usable === true && weakest.minKeys !== null) {
    const scopedRuleIds = new Set(
      snapshot.rules.filter(r => r.contextType.kind !== 'default').map(r => r.id)
    );
    for (const other of paths.slice(1)) {
      const stricter = other.usable !== true || (other.minKeys ?? 0) > (weakest.minKeys as number);
      if (scopedRuleIds.has(other.ruleId) && !scopedRuleIds.has(weakest.ruleId) && stricter) {
        weakest.notes.push(
          `bypasses rule ${other.ruleId} ("${other.ruleName}"): the caller can choose this rule instead`
        );
      }
    }
  }
  return paths;
}
