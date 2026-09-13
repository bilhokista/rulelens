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

## Who can authorize a call

```sh
npx tsx src/cli.ts <account> --simulate <token C-address>:transfer:1000
npx tsx src/cli.ts <account> --simulate create:<wasm-hash>
```

The transaction author picks which context rule authorizes each call, so an account is only as strict as the weakest
rule that matches. `--simulate` lists every active matching rule, the smallest signer set each accepts
(`BLOCKED` when it can never pass, `UNDETERMINED` for custom policies), and flags a Default rule that bypasses a
stricter rule scoped to the same contract. It is an off-chain model of `smart_account::do_check_auth` in
stellar-contracts v0.7.2; no signing or submission happens.

### Verified against the chain

`scripts/verifyOnChain.ts` submits real testnet XLM transfers out of the fixture accounts with a chosen signer set and
compares the result of `__check_auth` with the model. Last run (2026-09-13), 4 of 4 matched:

| Case | Model | Chain |
|---|---|---|
| 1-of-3 fixture, 1 signer | pass | SUCCESS `d9c13fb7…29a5` |
| 2-of-2 control, 1 signer | fail | `Error(Contract, #3202)` simple threshold NotAllowed |
| 2-of-2 control, 2 signers | pass | SUCCESS `4926fba7…1d80` |
| Weighted fixture, 2 signers (weight 2 of 3) | fail | `Error(Contract, #3213)` weighted threshold NotAllowed |

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
- `--simulate` models one context per call; multi-context transactions and policy combinations are lower bounds.
- Rules with custom (non-OpenZeppelin) policies are reported as undetermined.

License: Apache-2.0
