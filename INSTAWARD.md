# RuleLens — Instaward proposal

**Request:** $3,000 USD, paid in XLM
**Scope:** 30 days from award date
**Chapter:** Indonesia
**Repository:** https://github.com/bilhokista/rulelens
**Package:** https://www.npmjs.com/package/rulelens

---

## What exists today, before any award

This is not a proposal to start. It is a proposal to finish.

| Shipped | State |
| --- | --- |
| Five configuration checks | 49 passing tests |
| On-chain verification | 8/8 against live fixtures |
| `--simulate` mode | models `do_check_auth` |
| Mainnet support | `--network mainnet`, public RPC |
| npm release | `rulelens@0.1.0`, `npx rulelens <C-address>` runs from the registry |
| Public finding | OpenZeppelin `stellar-contracts` issue [#892](https://github.com/OpenZeppelin/stellar-contracts/issues/892), filed 2026-09-14 |

## The problem

`weighted_threshold::install` in `stellar-contracts` v0.7.2 checks that a
threshold does not exceed the sum of signer weights. It does not check that the
weighted addresses are signers of the context rule.

Assign weight to a non-signer and the install-time total inflates. The
threshold passes validation and can never be reached at enforcement, because
`calculate_weight` counts only authenticated signers. The rule is bricked from
construction.

An availability failure, not a theft: it needs an owner to misconfigure, and it
costs them the rule rather than the funds.

## Prior art, and the gap that is left

Two Stellar teams reached this failure class independently. This proposal does
not claim to have discovered it.

**`3K1-Labs/latch-contracts`** documents the divergence in its own README:
weights and threshold are frozen at install and must be updated by hand when
the signer set changes, "or authorization can silently weaken or permanently
lock." The mitigation is operator discipline.

**`Osok-Labs/warden-contracts`** built a guard. `warden-smart-account` overrides
`remove_signer`, probes each attached policy for `would_remain_reachable`, and
reverts rather than leaving a rule unsatisfiable. Good work, and a better answer
than a check for the paths it covers.

**What remains.** Warden guards mutation — removing or batching signers on a
rule that already exists. Issue #892 is install-time: weight assigned to an
address that was never a signer, before any mutation happens. An account running
`warden-smart-account` can still arrive bricked at construction, because no
mutation guard reaches a rule that was wrong when it was created.

That path is the position this proposal claims.

## Solution

`npx rulelens <C-address>` reads a deployed smart account and reports
configuration states that cannot be satisfied. No install, no key, no write
access.

The thirty days put the same check where the mistake is made: in CI, before the
deploy transaction is signed.

## Unique value proposition

> An in-contract guard cannot save a rule that was unsatisfiable when it was
> installed. RuleLens catches that one before the transaction is signed.

Two lines that have to be repeated because both get confused away: **checker,
not builder**, and **construction, not mutation**.

## The thirty days

| Week | Deliverable | Success criterion |
| --- | --- | --- |
| 1 | Conversations with teams shipping Soroban smart accounts, including those who have published guards against this class | Eight recorded; threshold below resolved either way |
| 1 | GitHub Action, `uses: bilhokista/rulelens@v1` | Runs on a fixture repo and fails a deliberately bricked rule |
| 2 | Stale-weights refinement | A rule whose signer set changed after install is reported with the specific address |
| 2 | Documentation site | A stranger goes from landing page to a real check in under five minutes |
| 3 | Demo video, under three minutes | A bricked rule caught before signing, on testnet, in one take |
| 3 | `#892` follow-through | Guard patch submitted if a maintainer asks; otherwise a comment with the reproduction |
| 4 | Report to the Indonesia chapter | What the conversations said, including if they killed it |

## The threshold, written before the work starts

**5 of 8** engineers describe a specific occasion when a deployed account rule
behaved differently from what they intended — unprompted, before RuleLens is
mentioned.

- **5 or more:** the tool has a user to build for, and the roadmap past thirty
  days is justified.
- **Fewer than 5:** RuleLens is a correct answer to a question nobody is
  asking. The deliverables still ship, the finding stands, and the report to
  the chapter says so plainly.

A threshold set after the results are in is not a threshold.

## Budget

| Line | Amount |
| --- | --- |
| 30 days of engineering, solo | $2,400 |
| Docs hosting and domain, one year | $120 |
| Demo production | $180 |
| Contingency | $300 |
| **Total** | **$3,000** |

No paid infrastructure: the tool reads public RPC and runs from npm.

## Risks, named rather than managed

- **The shape may be wrong.** Warden chose enforcement inside the contract over
  a check before deploy. If the teams who live this agree, the right home for
  the finding is a patch to OpenZeppelin rather than a tool. Week one is
  designed to surface that before the build, not after.
- **The gap is narrowing.** Part of this failure class is already covered by
  code shipped this month. The install-time path is the part that is not.
- **Demand is unestablished.** No user outside the author has been observed.
  Eight conversations may kill the thesis, which is the intended outcome of a
  test rather than a failure of the plan.
- **`#892` may be declined.** A maintainer may decide misconfiguration is the
  owner's problem. The check still catches the state; the authority behind it
  weakens.
- **No moat.** A competent Rust engineer reproduces five checks in a week. This
  proposal does not claim otherwise.

## What the award buys

A checker that already works, placed on the one path an in-contract guard
cannot reach, plus the conversations that decide whether anyone should build on
it further.
