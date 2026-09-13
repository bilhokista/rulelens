import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { decodeContextRule, decodeSignerWeights, decodeSpendingData } from './decode.js';
import type { AccountSnapshot, ContextRule, Policy } from './types.js';

/** Read-only contract call. Resolves to null when the call traps (missing entry, wrong interface). */
export type ContractReader = (contractId: string, method: string, args: xdr.ScVal[]) => Promise<xdr.ScVal | null>;

/** Rule ids are monotonic and removed ids leave gaps; stop after this many misses in a row. */
const MAX_CONSECUTIVE_MISSING_IDS = 64;

export function rpcReader(rpcUrl: string, networkPassphrase: string): ContractReader {
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  // Simulation never checks the source account, so a throwaway key is enough.
  const source = new Account(Keypair.random().publicKey(), '0');

  return async (contractId, method, args) => {
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) return null;
    return sim.result?.retval ?? null;
  };
}

export async function readSnapshot(
  read: ContractReader,
  account: string,
  currentLedger: number
): Promise<AccountSnapshot> {
  const countVal = await read(account, 'get_context_rules_count', []);
  if (countVal === null) {
    throw new Error(`${account} does not expose get_context_rules_count; is it an OpenZeppelin smart account?`);
  }
  const count = Number(scValToNative(countVal));
  const accountArg = nativeToScVal(account, { type: 'address' });

  const rules: ContextRule[] = [];
  let misses = 0;
  for (let id = 0; rules.length < count && misses < MAX_CONSECUTIVE_MISSING_IDS; id++) {
    const ruleVal = await read(account, 'get_context_rule', [xdr.ScVal.scvU32(id)]);
    if (ruleVal === null) {
      misses++;
      continue;
    }
    misses = 0;
    const raw = decodeContextRule(ruleVal);
    const policies = await Promise.all(
      raw.policyAddresses.map(address => readPolicy(read, address, raw.id, raw.scVal, accountArg))
    );
    rules.push({
      id: raw.id,
      name: raw.name,
      contextType: raw.contextType,
      validUntil: raw.validUntil,
      signers: raw.signers,
      policies,
    });
  }
  if (rules.length < count) {
    throw new Error(`Found ${rules.length} of ${count} context rules; ids may be sparser than the scan limit.`);
  }
  return { account, currentLedger, rules };
}

/**
 * Policies are arbitrary contracts. Identify the OpenZeppelin ones by the
 * getters their example contracts expose, most specific first.
 */
export async function readPolicy(
  read: ContractReader,
  address: string,
  ruleId: number,
  ruleScVal: xdr.ScVal,
  accountArg: xdr.ScVal
): Promise<Policy> {
  const idArg = xdr.ScVal.scvU32(ruleId);

  const spending = await read(address, 'get_spending_limit_data', [idArg, accountArg]);
  if (spending !== null) {
    return { kind: 'spendingLimit', address, ...decodeSpendingData(spending) };
  }

  const threshold = await read(address, 'get_threshold', [idArg, accountArg]);
  if (threshold === null) return { kind: 'unknown', address };

  const weights = await read(address, 'get_signer_weights', [ruleScVal, accountArg]);
  if (weights !== null) {
    return {
      kind: 'weightedThreshold',
      address,
      threshold: Number(scValToNative(threshold)),
      weights: decodeSignerWeights(weights),
    };
  }
  return { kind: 'simpleThreshold', address, threshold: Number(scValToNative(threshold)) };
}
