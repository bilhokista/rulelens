# RuleLens

Configuration checker for [OpenZeppelin Stellar smart accounts](https://github.com/OpenZeppelin/stellar-contracts/tree/main/packages/accounts).

Smart accounts move security from code into configuration: context rules, signers, threshold and spending-limit
policies, and verifier contracts. The library is audited, but a deployed account can still be configured into a state
that is unsafe or unusable. RuleLens reads a live account over Soroban RPC and reports those states with the exact call
that fixes them. It reads only; it never signs or submits anything.

## Usage

```sh
npm install
npx tsx src/cli.ts <smart-account C-address> --network testnet   # or mainnet, or --rpc <url>
npx tsx src/cli.ts <C-address> --json                            # machine-readable output
```

Exit code `0` means no critical or high findings, `1` means at least one, `2` means a usage or network error.

## Checks

| Check | Severity | What it detects |
|---|---|---|
| `stale-weights` | critical / medium | Weighted threshold that current rule signers cannot reach; weights held by addresses that are not rule signers. |
| `threshold-shape` | critical / high / info | Simple threshold above the signer count; 1-of-N on a Default rule. |
| `cross-verifier-duplicates` | high | The same key registered under two verifier contracts, which counts as two signers. |
| `spending-history-pressure` | medium / low | Spending-limit history near its 1000-entry cap; zero-amount transfers filling it. |
| `rule-hygiene` | high / medium / info | Expired rules still stored; single-signer Default rule without policy; policies without signers. |

Policies are identified by the getters the OpenZeppelin example contracts expose (`get_spending_limit_data`,
`get_threshold`, `get_signer_weights`). Custom policies show up as `unknown` and are not analysed.

## Live testnet fixtures

Deployed from the unmodified `examples/multisig-smart-account` contracts of stellar-contracts v0.7.2 with
`scripts/deployFixtures.ts`:

| Fixture | Contract | Expected |
|---|---|---|
| Weighted rule, threshold 3, signers reach 2, non-signer holds weight 5 | `CASLFL4M7SKKPFO3FOJWRKJR62LPMYITCFNFQVLCXEEAU2DNTVECKMPY` | critical + medium |
| Default rule 1-of-3 | `CA3VOWHPC4GK7SHEME4QJYVXP3PY4LVBKPXOUMZI5KY53I6J3IF6LSYD` | high |
| Control 2-of-2 | `CDWM7QXUM6TSKOTUEOUAKSO33GMAMWSIQ5HEFYU5ZISYAYCOX64GI7F3` | no findings |

The first fixture also shows that `weighted_threshold::install` accepts weights for addresses that are not rule
signers, so an unreachable threshold can be created at deployment, not only after `remove_signer`.

## Development

```sh
npm test          # unit tests for checks, XDR decoding, snapshot reader, report
npm run typecheck
npm run coverage
```

## Not yet covered

- Cross-verifier check compares raw key bytes; canonical comparison through `batch_canonicalize_key` is not done.
- Spending-limit and cross-verifier checks have unit tests but no testnet fixture yet.
- Simulation of `__check_auth` for a given context is planned, not implemented.

License: Apache-2.0
