import { Address, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { ContextType, Signer, SpendingEntry } from './types.js';

/**
 * Soroban `contracttype` enums encode as ScVec [Symbol(variant), ...fields];
 * structs encode as ScMap keyed by Symbol(field name).
 */

type ScVal = xdr.ScVal;

function vecOf(val: ScVal): ScVal[] {
  if (val.type !== 'scvVec') throw new Error(`Expected ScVec, got ${val.type}`);
  return (val as unknown as { vec: ScVal[] | null }).vec ?? [];
}

function mapOf(val: ScVal): Array<{ key: ScVal; val: ScVal }> {
  if (val.type !== 'scvMap') throw new Error(`Expected ScMap, got ${val.type}`);
  return (val as unknown as { map: Array<{ key: ScVal; val: ScVal }> | null }).map ?? [];
}

const hexOf = (val: ScVal): string => Buffer.from(scValToNative(val) as Uint8Array).toString('hex');
const addressOf = (val: ScVal): string => Address.fromScVal(val).toString();

function enumParts(val: ScVal): { variant: string; fields: ScVal[] } {
  const vec = vecOf(val);
  if (vec.length === 0 || vec[0].type !== 'scvSymbol') {
    throw new Error('Expected enum ScVec starting with a Symbol');
  }
  return { variant: String(scValToNative(vec[0])), fields: vec.slice(1) };
}

export function structField(val: ScVal, name: string): ScVal {
  const entry = mapOf(val).find(
    e => e.key.type === 'scvSymbol' && String(scValToNative(e.key)) === name
  );
  if (!entry) throw new Error(`Struct field "${name}" not found`);
  return entry.val;
}

export function decodeSigner(val: xdr.ScVal): Signer {
  const { variant, fields } = enumParts(val);
  if (variant === 'Delegated') {
    return { kind: 'delegated', address: addressOf(fields[0]) };
  }
  if (variant === 'External') {
    return {
      kind: 'external',
      verifier: addressOf(fields[0]),
      keyHex: hexOf(fields[1]),
    };
  }
  throw new Error(`Unknown Signer variant "${variant}"`);
}

export function decodeContextType(val: xdr.ScVal): ContextType {
  const { variant, fields } = enumParts(val);
  switch (variant) {
    case 'Default':
      return { kind: 'default' };
    case 'CallContract':
      return { kind: 'callContract', contract: addressOf(fields[0]) };
    case 'CreateContract':
      return { kind: 'createContract', wasmHashHex: hexOf(fields[0]) };
    default:
      throw new Error(`Unknown ContextRuleType variant "${variant}"`);
  }
}

export interface RawContextRule {
  id: number;
  name: string;
  contextType: ContextType;
  validUntil: number | null;
  signers: Signer[];
  policyAddresses: string[];
  /** Original value, passed back to policies such as get_signer_weights. */
  scVal: xdr.ScVal;
}

export function decodeContextRule(val: xdr.ScVal): RawContextRule {
  const validUntil = structField(val, 'valid_until');
  return {
    id: Number(scValToNative(structField(val, 'id'))),
    name: String(scValToNative(structField(val, 'name'))),
    contextType: decodeContextType(structField(val, 'context_type')),
    validUntil: validUntil.type === 'scvVoid' ? null : Number(scValToNative(validUntil)),
    signers: vecOf(structField(val, 'signers')).map(decodeSigner),
    policyAddresses: vecOf(structField(val, 'policies')).map(addressOf),
    scVal: val,
  };
}

export function decodeSignerWeights(val: xdr.ScVal): Array<{ signer: Signer; weight: number }> {
  return mapOf(val).map(entry => ({
    signer: decodeSigner(entry.key),
    weight: Number(scValToNative(entry.val)),
  }));
}

export interface SpendingData {
  spendingLimit: bigint;
  periodLedgers: number;
  historyLength: number;
  zeroAmountEntries: number;
  history: SpendingEntry[];
}

export function decodeSpendingData(val: xdr.ScVal): SpendingData {
  const history = vecOf(structField(val, 'spending_history'));
  const entries = history.map(entry => ({
    amount: BigInt(scValToNative(structField(entry, 'amount'))),
    ledger: Number(scValToNative(structField(entry, 'ledger_sequence'))),
  }));
  const zeroAmountEntries = entries.filter(entry => entry.amount === 0n).length;
  return {
    spendingLimit: BigInt(scValToNative(structField(val, 'spending_limit'))),
    periodLedgers: Number(scValToNative(structField(val, 'period_ledgers'))),
    historyLength: history.length,
    zeroAmountEntries,
    history: entries,
  };
}
