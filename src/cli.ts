#!/usr/bin/env node
import { Networks, StrKey, rpc } from '@stellar/stellar-sdk';
import { resolveAuthPaths } from './authPaths.js';
import { runChecks } from './checks/index.js';
import { rpcReader, readSnapshot } from './reader.js';
import { formatAuthPaths, formatReport } from './report.js';
import { parseTarget } from './target.js';

const NETWORKS: Record<string, { rpcUrl: string; passphrase: string }> = {
  testnet: { rpcUrl: 'https://soroban-testnet.stellar.org', passphrase: Networks.TESTNET },
  mainnet: { rpcUrl: 'https://mainnet.sorobanrpc.com', passphrase: Networks.PUBLIC },
};

const USAGE = `Usage: rulelens <smart-account C-address> [--network testnet|mainnet] [--rpc <url>] [--json]
       [--simulate <C-address>:<fn>[:<amount>] | --simulate create:<wasm-hash>]

Exit codes: 0 no critical/high findings, 1 critical or high findings, 2 usage or network error.`;

function parseArgs(argv: string[]) {
  const args = { account: '', network: 'testnet', rpcUrl: '', json: false, simulate: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--network') args.network = argv[++i] ?? '';
    else if (arg === '--rpc') args.rpcUrl = argv[++i] ?? '';
    else if (arg === '--json') args.json = true;
    else if (arg === '--simulate') args.simulate = argv[++i] ?? '';
    else if (!args.account) args.account = arg;
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const network = NETWORKS[args.network];
  if (!StrKey.isValidContract(args.account) || !network) {
    console.error(USAGE);
    return 2;
  }
  const rpcUrl = args.rpcUrl || network.rpcUrl;
  const target = args.simulate ? parseTarget(args.simulate) : null;

  const latest = await new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') }).getLatestLedger();
  const snapshot = await readSnapshot(rpcReader(rpcUrl, network.passphrase), args.account, latest.sequence);
  const findings = runChecks(snapshot);
  const authPaths = target ? resolveAuthPaths(snapshot, target) : undefined;

  if (args.json) {
    const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
    console.log(JSON.stringify({ snapshot, findings, target, authPaths }, replacer, 2));
  } else {
    console.log(formatReport(snapshot, findings));
    if (target && authPaths) console.log(`\n${formatAuthPaths(target, authPaths)}`);
  }
  return findings.some(f => f.severity === 'critical' || f.severity === 'high') ? 1 : 0;
}

main().then(
  code => process.exit(code),
  (err: unknown) => {
    console.error(`rulelens: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
);
