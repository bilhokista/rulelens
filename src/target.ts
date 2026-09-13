import { StrKey } from '@stellar/stellar-sdk';
import type { AuthTarget } from './authPaths.js';

/**
 * Parses `--simulate` values:
 *   C...:fn            call to a contract function
 *   C...:transfer:100  call with the amount argument (raw token units)
 *   create:<wasmhash>  contract deployment from a wasm hash (hex)
 */
export function parseTarget(value: string): AuthTarget {
  const parts = value.split(':');

  if (parts[0] === 'create') {
    const hash = parts[1] ?? '';
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`Invalid wasm hash in "${value}"; expected 64 hex characters`);
    return { kind: 'create', wasmHashHex: hash.toLowerCase() };
  }

  const [contract, fn, amount] = parts;
  if (!StrKey.isValidContract(contract ?? '')) throw new Error(`Invalid contract address in "${value}"`);
  if (!fn || !/^[A-Za-z0-9_]{1,32}$/.test(fn)) throw new Error(`Invalid function name in "${value}"`);
  if (amount === undefined) return { kind: 'call', contract, fn };
  if (!/^\d+$/.test(amount)) throw new Error(`Invalid amount in "${value}"; expected a non-negative integer`);
  return { kind: 'call', contract, fn, amount: BigInt(amount) };
}
