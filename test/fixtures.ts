import type { AccountSnapshot, ContextRule, Signer } from '../src/types.js';

export const alice: Signer = { kind: 'delegated', address: 'GALICE' };
export const bob: Signer = { kind: 'delegated', address: 'GBOB' };
export const carol: Signer = { kind: 'delegated', address: 'GCAROL' };
export const passkey = (verifier: string, keyHex = '04aa'): Signer => ({
  kind: 'external',
  verifier,
  keyHex,
});

export function rule(overrides: Partial<ContextRule> = {}): ContextRule {
  return {
    id: 0,
    name: 'default',
    contextType: { kind: 'default' },
    validUntil: null,
    signers: [alice, bob],
    policies: [],
    ...overrides,
  };
}

export function snapshot(rules: ContextRule[], currentLedger = 1000): AccountSnapshot {
  return { account: 'CACCOUNT', currentLedger, rules };
}
