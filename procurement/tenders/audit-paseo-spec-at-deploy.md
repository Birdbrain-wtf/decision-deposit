# Tender: security review of the collaborative decision deposit contracts, version 2

## What is wanted

An independent security review of two Solidity contracts that let several people fund a Kusama referendum's decision deposit together, and pay everyone back when the referendum ends.

| | |
| --- | --- |
| Repository | https://github.com/Birdbrain-wtf/decision-deposit |
| Commit | `c674a2c` |
| In scope | `contracts/v2/DecisionDepositPool.sol` (308 lines), `contracts/v2/DecisionDepositPoolFactory.sol` (76 lines) |
| Deployed | Kusama Asset Hub factory `0x222022cbc8fef11df6b3b7b906774a6923c72f3c`, verified on Blockscout. Creation code SHA-256 begins `463c0fd5` and reproduces from `compile-v2.ts` |
| Runtime | `pallet-revive` on Kusama Asset Hub, reaching governance through the XCM precompile at `0xA0000` |
| Background | https://forum.polkadot.network/t/collaborative-decision-deposits-live-on-kusama-open-for-review/19187 and the repository README |

Out of scope unless offered as an option: the web page, the indexer, the settle backstop and the version 1 contract.

## What the review should cover

1. Loss or locking of contributors' KSM in every lifecycle path: contribute, withdraw, place, reclaim, abandon, payout, claim and sweep.
2. Accounting at the planck: `weiPerPlanck`, rounding, the balance checks the pool relies on instead of XCM replies.
3. Behaviour of the XCM `Transact` path under a runtime upgrade, a renumbered call or a slashed deposit.
4. The factory: what an opener controls, and whether a pool can be opened that looks valid and is not.
5. Griefing, reentrancy and gas: including the filling payment that also places the deposit.

## What we expect back

1. A written report with severity ratings and a proof-of-concept test for each exploitable finding.
2. A responsible disclosure route for anything exploitable on live pools, before publication.
3. A review of our fixes, and a final report we can publish in the repository.

**Payment depends on completing the agreed review, never on the result.** A report with serious findings is a delivered report.

## Milestones

1. First report delivered: 60% of the price.
2. Fix review and final report delivered: 40% of the price.

Bidders propose dates for both in their offer.

## Timetable

| | |
| --- | --- |
| Bids close | 14 December 2026, 12:00 UTC |
| Award recorded on chain by | 21 December 2026, 12:00 UTC |

## Price

Bid in US dollars, as a fixed price for the whole review. The tender records prices in a six-decimal unit, so 12,500 means US$12,500. The most this tender will accept is US$15,000. That is a cap on bids, not a budget, and a lower price is not an advantage on its own.

## How bids will be judged

| | |
| --- | --- |
| Relevant experience: Solidity on `pallet-revive`, XCM, or EVM contracts on Polkadot or Kusama | 30% |
| Proposed coverage and method, against the list above | 30% |
| Price | 25% |
| Availability and proposed dates | 15% |

These weights do not change after the first bid. Birdbrain scores the bids, publishes each score with its reasons, and records the award and a hash of that reasoning on chain.

## Funding and payment

This work is not yet funded. The tender exists to find the right reviewer and a fair price first. Once a bid is chosen, we will ask for that amount through a Kusama Treasury proposal or another funder, and name the source publicly. Work starts only when the money is secured, and the winning bidder is free to withdraw if it is not secured within 30 days of the award.

The winner is paid directly by the funder, in US dollar stablecoin or KSM at the day's rate as agreed with the winner, against the two milestones above. Nothing is paid through the tender contract.

## How to bid

Write an offer covering your experience, method, price and dates, and publish it somewhere anyone can read it, such as a GitHub gist or the forum thread. Then bid on the tender page at https://birdbrain.wtf/tools/tender with your price and the keccak-256 hash of that document. The page works the hash out for you. A later bid from the same address replaces the earlier one.

Bidding needs an Ethereum-style wallet connected to Kusama Asset Hub and a small amount of KSM for the network fee. Questions go to the forum thread above.

## What this tender does not do

The tender contract records bids and the award on Kusama Asset Hub. It is tied to a placeholder token named "NOT dUSD" with no supply, so it cannot hold or pay money, and the acceptance and payment steps in the contract will always fail. Payment happens outside it, as set out above.

The contracts under review and the tender contract itself have not been independently reviewed.
