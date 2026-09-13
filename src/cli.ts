#!/usr/bin/env node
import { Networks, StrKey, rpc } from '@stellar/stellar-sdk';
import { runChecks } from './checks/index.js';
import { rpcReader, readSnapshot } from './reader.js';
import { formatReport } from './report.js';

const NETWORKS: Record<string, { rpcUrl: string; passphrase: string }> = {
  testnet: { rpcUrl: 'https://soroban-testnet.stellar.org', passphrase: Networks.TESTNET },
  mainnet: { rpcUrl: 'https://mainnet.sorobanrpc.com', passphrase: Networks.PUBLIC },
};

const USAGE = `Usage: rulelens <smart-account C-address> [--network testnet|mainnet] [--rpc <url>] [--json]

Exit codes: 0 no critical/high findings, 1 critical or high findings, 2 usage or network error.`;

function parseArgs(argv: string[]) {
  const args = { account: '', network: 'testnet', rpcUrl: '', json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--network') args.network = argv[++i] ?? '';
    else if (arg === '--rpc') args.rpcUrl = argv[++i] ?? '';
    else if (arg === '--json') args.json = true;
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

  const latest = await new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') }).getLatestLedger();
  const snapshot = await readSnapshot(rpcReader(rpcUrl, network.passphrase), args.account, latest.sequence);
  const findings = runChecks(snapshot);

  if (args.json) {
    console.log(JSON.stringify({ snapshot, findings }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  } else {
    console.log(formatReport(snapshot, findings));
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
