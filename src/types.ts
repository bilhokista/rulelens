/**
 * Normalized, network-independent view of one smart account.
 * The RPC reader builds it; every check is a pure function over it.
 */

export type Signer =
  | { kind: 'delegated'; address: string }
  | { kind: 'external'; verifier: string; keyHex: string };

export type ContextType =
  | { kind: 'default' }
  | { kind: 'callContract'; contract: string }
  | { kind: 'createContract'; wasmHashHex: string };

export interface SpendingEntry {
  amount: bigint;
  ledger: number;
}

export type Policy =
  | { kind: 'simpleThreshold'; address: string; threshold: number }
  | {
      kind: 'weightedThreshold';
      address: string;
      threshold: number;
      weights: ReadonlyArray<{ signer: Signer; weight: number }>;
    }
  | {
      kind: 'spendingLimit';
      address: string;
      spendingLimit: bigint;
      periodLedgers: number;
      historyLength: number;
      zeroAmountEntries: number;
      history: ReadonlyArray<SpendingEntry>;
    }
  | { kind: 'unknown'; address: string };

export interface ContextRule {
  id: number;
  name: string;
  contextType: ContextType;
  validUntil: number | null;
  signers: ReadonlyArray<Signer>;
  policies: ReadonlyArray<Policy>;
}

export interface AccountSnapshot {
  account: string;
  currentLedger: number;
  rules: ReadonlyArray<ContextRule>;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  check: string;
  severity: Severity;
  ruleId: number;
  message: string;
  fix: string;
}

export type Check = (snapshot: AccountSnapshot) => Finding[];

export function signerKey(signer: Signer): string {
  return signer.kind === 'delegated'
    ? `delegated:${signer.address}`
    : `external:${signer.verifier}:${signer.keyHex.toLowerCase()}`;
}
