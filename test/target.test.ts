import { StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { parseTarget } from '../src/target.js';

const C = StrKey.encodeContract(Buffer.alloc(32, 5));

describe('parseTarget', () => {
  it('parses a call with and without amount', () => {
    expect(parseTarget(`${C}:approve`)).toEqual({ kind: 'call', contract: C, fn: 'approve' });
    expect(parseTarget(`${C}:transfer:250`)).toEqual({ kind: 'call', contract: C, fn: 'transfer', amount: 250n });
  });

  it('parses a create target and normalizes the hash', () => {
    expect(parseTarget(`create:${'AB'.repeat(32)}`)).toEqual({ kind: 'create', wasmHashHex: 'ab'.repeat(32) });
  });

  it.each([
    ['GABC:transfer', 'Invalid contract address'],
    [`${C}`, 'Invalid function name'],
    [`${C}:transfer:-5`, 'Invalid amount'],
    ['create:1234', 'Invalid wasm hash'],
  ])('rejects %s', (value, message) => {
    expect(() => parseTarget(value)).toThrow(message);
  });
});
