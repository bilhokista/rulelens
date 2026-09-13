import { Keypair, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { type ContractReader, readSnapshot } from '../src/reader.js';

const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 1));
const WEIGHTED = StrKey.encodeContract(Buffer.alloc(32, 2));
const SIMPLE = StrKey.encodeContract(Buffer.alloc(32, 3));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 4));
const ALICE = Keypair.random().publicKey();
const BOB = Keypair.random().publicKey();

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const addr = (a: string) => nativeToScVal(a, { type: 'address' });
const delegated = (a: string) => xdr.ScVal.scvVec([sym('Delegated'), addr(a)]);
const struct = (fields: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map(k => new xdr.ScMapEntry({ key: sym(k), val: fields[k] }))
  );

function ruleVal(id: number, signers: string[], policies: string[]) {
  return struct({
    id: u32(id),
    name: xdr.ScVal.scvString(`rule-${id}`),
    context_type: xdr.ScVal.scvVec([sym('Default')]),
    signers: xdr.ScVal.scvVec(signers.map(delegated)),
    signer_ids: xdr.ScVal.scvVec(signers.map((_, i) => u32(i))),
    policies: xdr.ScVal.scvVec(policies.map(addr)),
    policy_ids: xdr.ScVal.scvVec(policies.map((_, i) => u32(i))),
    valid_until: xdr.ScVal.scvVoid(),
  });
}

/** Fake chain: rule 0 was removed, rules 1 and 2 exist. */
const fakeReader: ContractReader = async (contract, method, args) => {
  if (contract === ACCOUNT && method === 'get_context_rules_count') return u32(2);
  if (contract === ACCOUNT && method === 'get_context_rule') {
    const id = Number((args[0] as unknown as { u32: number }).u32);
    if (id === 1) return ruleVal(1, [ALICE], [WEIGHTED]);
    if (id === 2) return ruleVal(2, [ALICE, BOB], [SIMPLE, OTHER]);
    return null;
  }
  if (contract === WEIGHTED && method === 'get_threshold') return u32(2);
  if (contract === WEIGHTED && method === 'get_signer_weights') {
    return xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: delegated(ALICE), val: u32(1) }),
      new xdr.ScMapEntry({ key: delegated(BOB), val: u32(1) }),
    ]);
  }
  if (contract === SIMPLE && method === 'get_threshold') return u32(1);
  return null;
};

describe('readSnapshot', () => {
  it('skips removed rule ids and classifies policies by their getters', async () => {
    const snap = await readSnapshot(fakeReader, ACCOUNT, 100);
    expect(snap.rules.map(r => r.id)).toEqual([1, 2]);
    expect(snap.rules[0].policies[0]).toMatchObject({ kind: 'weightedThreshold', threshold: 2 });
    expect(snap.rules[1].policies.map(p => p.kind)).toEqual(['simpleThreshold', 'unknown']);
  });

  it('fails clearly for a contract that is not a smart account', async () => {
    await expect(readSnapshot(async () => null, ACCOUNT, 1)).rejects.toThrow('get_context_rules_count');
  });

  it('fails when rule ids cannot be found', async () => {
    const reader: ContractReader = async (_c, method) => (method === 'get_context_rules_count' ? u32(1) : null);
    await expect(readSnapshot(reader, ACCOUNT, 1)).rejects.toThrow('Found 0 of 1');
  });
});
