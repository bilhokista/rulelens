# RuleLens

Configuration checker for [OpenZeppelin Stellar smart accounts](https://github.com/OpenZeppelin/stellar-contracts/tree/main/packages/accounts).

Smart accounts move security from code into configuration: context rules, signers, threshold and spending-limit
policies, and verifier contracts. The library is audited, but a deployed account can still be configured into a state
that is unsafe or unusable. RuleLens reads a live account over Soroban RPC and reports those states with the exact call
that fixes them. It reads only; it never signs or submits anything.

## How it compares

Existing Stellar/Soroban security tooling works on source code or the library, not on a deployed account's configuration:

- **CoinFabrik Scout** is a source-code linter (CLI + VSCode) for Soroban contracts — it flags issues in Rust source
  during development, not the configuration of a live account.
- **OpenZeppelin's audits and Certora's formal verification** cover the smart-account library code. An audited library
  can still be configured, at deployment or later, into an unsafe or unusable account.

RuleLens checks the layer neither covers: the configuration of an already-deployed account, read over Soroban RPC.
[OpenZeppelin/stellar-contracts#892](https://github.com/OpenZeppelin/stellar-contracts/issues/892), filed from this
work, is direct evidence the gap is real — the library accepts a configuration no source-level tool would flag.

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

`scripts/verifyOnChain.ts` asks the model whether a signer set can move XLM out of a fixture account through a given
rule, then submits the real transfer on testnet and compares. Last run (2026-09-13): **8 of 8 matched**.

| Case | Model | Chain |
|---|---|---|
| 1-of-3, 1 signer | pass | SUCCESS |
| 2-of-2, 1 signer | fail | `Error(Contract, #3202)` simple threshold NotAllowed |
| 2-of-2, 2 signers | pass | SUCCESS |
| Weighted, signers reach 2 of 3 | fail | `Error(Contract, #3213)` weighted threshold NotAllowed |
| 2-of-2 where both signers are one ed25519 key under two verifiers, 1 device | pass | SUCCESS |
| Spending-limit rule, within limit | pass | SUCCESS |
| Spending-limit rule, above remaining limit | fail | `Error(Contract, #3221)` SpendingLimitExceeded |
| Default single-signer rule, same amount above the limit | pass | SUCCESS (bypasses the spending limit) |

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
`scripts/deployFixtures.ts` and `scripts/fixturesRound2.ts`:

| Fixture | Contract | RuleLens |
|---|---|---|
| Weighted rule, threshold 3, signers reach 2, non-signer holds weight 5 | `CASLFL4M7SKKPFO3FOJWRKJR62LPMYITCFNFQVLCXEEAU2DNTVECKMPY` | critical + medium |
| Default rule 1-of-3 | `CA3VOWHPC4GK7SHEME4QJYVXP3PY4LVBKPXOUMZI5KY53I6J3IF6LSYD` | high |
| Control 2-of-2 | `CDWM7QXUM6TSKOTUEOUAKSO33GMAMWSIQ5HEFYU5ZISYAYCOX64GI7F3` | no findings |
| 2-of-2 made of one ed25519 key under two verifier contracts | `CAL34VDFZXZ7NIJLRDEREHISG5CSX6UMIBFNH36W2T5PZV5RUAUBJB65` | high; `--simulate` shows 2 signers from 1 distinct key |
| Default single-signer rule plus CallContract spending-limit rule with zero-amount history | `CDVKSXZXMYVDLE33NJ7UP4GZMERIAYY2RMP7B6SDOFYJIXRVHTCU4ETU` | high + low; `--simulate` shows the Default rule bypasses the limit |

Two library behaviours these fixtures demonstrate:

- `weighted_threshold::install` accepts weights for addresses that are not rule signers, so an unreachable threshold can
  be deployed from the constructor (reported: [OpenZeppelin/stellar-contracts#892](https://github.com/OpenZeppelin/stellar-contracts/issues/892)).
- Canonical duplicate detection is per verifier address. The same ed25519 key under two verifier deployments passes
  `validate_no_canonical_duplicates` and satisfies a 2-of-2 threshold with one device.

## Development

```sh
npm test          # unit tests for checks, XDR decoding, snapshot reader, report
npm run typecheck
npm run coverage
```

## Not yet covered

- Cross-verifier check compares raw key bytes; canonical comparison through `batch_canonicalize_key` is not done.
- `--simulate` models one context per call; multi-context transactions and policy combinations are lower bounds.
- Rules with custom (non-OpenZeppelin) policies are reported as undetermined.

License: Apache-2.0
