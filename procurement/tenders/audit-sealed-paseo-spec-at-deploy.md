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
| Sealed bids close | {{BID_CLOSE}} |
| Quality scores fixed on chain by | {{SCORE_BY}} |
| Prices opened by | {{REVEAL_BY}} |
| Award recorded on chain by | {{AWARD_BY}} |

## Price and budget

Bid in US dollars, as a fixed price for the whole review. The tender records prices in a six-decimal unit, so 12,500 means US$12,500.

We have set a budget and sealed it on chain at the start, as a hash of the figure and a secret. Nobody can see it while bids are open, and we cannot change it afterwards. It is opened once prices are open. A bid above it cannot be awarded. We keep it sealed so that the figure does not become the price.

## How bids will be judged

In two stages, quality first and price second.

**Stage one, before any price is seen.** Each offer is scored out of 75:

| | |
| --- | --- |
| Relevant experience: Solidity on `pallet-revive`, XCM, or EVM contracts on Polkadot or Kusama | 30 |
| Proposed coverage and method, against the list above | 30 |
| Availability and proposed dates | 15 |

An offer needs at least 36 of the 60 points for experience and method to go on to stage two. Birdbrain records a hash of every stage-one score, with its reasons, on chain before the scoring window closes. The contract allows this once, and opens no price until the window has closed, so the scores cannot move once the prices are known.

**Stage two, price.** Among offers that pass stage one and are within the budget, the lowest price gets 25 points and every other offer gets 25 × the lowest price ÷ its own price. The highest total out of 100 wins. A tie goes to the earlier proposed date for the first report.

These rules do not change after the first bid. When the award is made, Birdbrain publishes every offer, every price, both stages of scoring with their reasons and the budget, so the result can be checked against the hashes on chain.

## Funding and payment

This work is not yet funded. The tender exists to find the right reviewer and a fair price first. Once a bid is chosen, we will ask for that amount through a Kusama Treasury proposal or another funder, and name the source publicly. Work starts only when the money is secured, and the winning bidder is free to withdraw if it is not secured within 30 days of the award.

The winner is paid directly by the funder, in US dollar stablecoin or KSM at the day's rate as agreed with the winner, against the two milestones above. Nothing is paid through the tender contract.

## How to bid

1. **Write your offer** covering experience, method, dates and both milestones. **Leave the price out of it.** An offer that states a price is scored as if it had none in stage one, and may be set aside.
2. **Seal your bid** on the tender page at https://birdbrain.wtf/tools/tender before bids close. The page takes your price and your offer, and records only a seal on chain: a hash of the tender, your address, the price, the offer's hash and a secret the page makes for you. Nobody, including us, can see your price. A later seal from the same address replaces the earlier one. **Keep the file the page gives you.** It holds your secret, and without it the bid cannot be opened.
3. **Publish your offer** where anyone can read it, such as a GitHub gist or the forum thread, as soon as bids close and before the scoring window ends. Its keccak-256 hash must match the one in your seal.
4. **Open your bid** on the same page, with your saved file, after the scoring window closes and before prices close. A bid that is never opened is not a bid.

Bidding needs an Ethereum-style wallet connected to Kusama Asset Hub and a small amount of KSM for the network fee. Questions go to the forum thread above.

## What this tender does not do

The tender contract records bids and the award on Kusama Asset Hub. It is tied to a placeholder token named "NOT dUSD" with no supply, so it cannot hold or pay money, and the acceptance and payment steps in the contract will always fail. Payment happens outside it, as set out above.

The contracts under review and the tender contract itself have not been independently reviewed.
