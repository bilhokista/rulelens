// Public library entry point for RuleLens.
// Read a deployed OpenZeppelin Stellar smart account over Soroban RPC and run
// the configuration checks. This module never signs or submits anything.

export { runChecks, CHECKS } from './checks/index.js';
export { rpcReader, readSnapshot, readPolicy, type ContractReader } from './reader.js';
export * from './types.js';
