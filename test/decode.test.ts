import { Keypair, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  decodeContextRule,
  decodeSigner,
  decodeSignerWeights,
  decodeSpendingData,
} from '../src/decode.js';

const G = Keypair.random().publicKey();
const C = StrKey.encodeContract(Buffer.alloc(32, 7));
const C2 = StrKey.encodeContract(Buffer.alloc(32, 9));

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const addr = (a: string) => nativeToScVal(a, { type: 'address' });
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const enumVal = (variant: string, ...fields: xdr.ScVal[]) => xdr.ScVal.scvVec([sym(variant), ...fields]);
const struct = (fields: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map(k => new xdr.ScMapEntry({ key: sym(k), val: fields[k] }))
  );

const delegated = enumVal('Delegated', addr(G));
const external = enumVal('External', addr(C2), xdr.ScVal.scvBytes(Buffer.from('04abcd', 'hex')));

describe('decode', () => {
  it('decodes both signer variants', () => {
    expect(decodeSigner(delegated)).toEqual({ kind: 'delegated', address: G });
    expect(decodeSigner(external)).toEqual({ kind: 'external', verifier: C2, keyHex: '04abcd' });
  });

  it('decodes a context rule struct', () => {
    const raw = struct({
      id: u32(3),
      name: xdr.ScVal.scvString('treasury'),
      context_type: enumVal('CallContract', addr(C)),
      signers: xdr.ScVal.scvVec([delegated, external]),
      signer_ids: xdr.ScVal.scvVec([u32(0), u32(1)]),
      policies: xdr.ScVal.scvVec([addr(C2)]),
      policy_ids: xdr.ScVal.scvVec([u32(0)]),
      valid_until: xdr.ScVal.scvVoid(),
    });
    const rule = decodeContextRule(raw);
    expect(rule).toMatchObject({
      id: 3,
      name: 'treasury',
      contextType: { kind: 'callContract', contract: C },
      validUntil: null,
      policyAddresses: [C2],
    });
    expect(rule.signers).toHaveLength(2);
  });

  it('decodes valid_until when set', () => {
    const raw = struct({
      id: u32(0),
      name: xdr.ScVal.scvString('d'),
      context_type: enumVal('Default'),
      signers: xdr.ScVal.scvVec([]),
      signer_ids: xdr.ScVal.scvVec([]),
      policies: xdr.ScVal.scvVec([]),
      policy_ids: xdr.ScVal.scvVec([]),
      valid_until: u32(500),
    });
    expect(decodeContextRule(raw).validUntil).toBe(500);
  });

  it('decodes a signer weight map with enum keys', () => {
    const map = xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: delegated, val: u32(4) })]);
    expect(decodeSignerWeights(map)).toEqual([{ signer: { kind: 'delegated', address: G }, weight: 4 }]);
  });

  it('counts zero-amount spending entries', () => {
    const entry = (amount: bigint) =>
      struct({ amount: nativeToScVal(amount, { type: 'i128' }), ledger_sequence: u32(1) });
    const data = struct({
      spending_limit: nativeToScVal(100n, { type: 'i128' }),
      period_ledgers: u32(17280),
      spending_history: xdr.ScVal.scvVec([entry(0n), entry(5n), entry(0n)]),
      cached_total_spent: nativeToScVal(5n, { type: 'i128' }),
    });
    expect(decodeSpendingData(data)).toEqual({
      spendingLimit: 100n,
      periodLedgers: 17280,
      historyLength: 3,
      zeroAmountEntries: 2,
      history: [
        { amount: 0n, ledger: 1 },
        { amount: 5n, ledger: 1 },
        { amount: 0n, ledger: 1 },
      ],
    });
  });

  it('rejects unknown enum variants', () => {
    expect(() => decodeSigner(enumVal('Mystery'))).toThrow('Unknown Signer variant');
  });
});
