# Procurement prototype

Status: prototype, not independently reviewed. **Unfunded demonstration live on Kusama Asset Hub since 2026-11-23** (below). No tender has ever held money.

## Unfunded demonstration (2026-11-23)

One tender pointed at `DemoPlaceholderAsset` (`src/DemoPlaceholderAsset.sol`): named "NOT dUSD", zero supply, every transfer reverts. The tender takes bids and an award, and `acceptAndFund` always fails, so it can never hold value. Buyer, reviewer and resolver are all Birdbrain's Kusama deployer `0x29c3…4b61`. Specification hash is the keccak of this README as it stood at deploy (`demo/README-at-deploy.md`). Ceiling 10,000 (6 decimals, nominal), bids close 7 Dec 2026 14:18 UTC, activation closes 14 Dec, review period 7 days.

| Net | Placeholder asset | Tender | Notes |
| --- | --- | --- | --- |
| Kusama | `0x602dacc6969a454c5965616bf3cbce0a07608c6f` | `0x8006674375a90d626029781c41cb163263479b70` | blocks 24,177,333-334, both verified on Blockscout, cost 0.0537 KSM |
| Paseo | `0xdd85dd5e5126383ba7413e1917e664eb5e0fff11` | `0xe738f7fad584e231bf46f4b402b9bd52ec8b78d7` | rehearsal, verified; one test bid from alice (5,000) |

Scripts in `demo/`: `deploy-demo.ts <net> [--mainnet]` (refuses if a record exists), `check-demo.ts <net> [--bid]` (bids on Paseo only), `verify-demo.ts <net>`. Records `demo/<net>.json`, compiler input `demo/standard-input.json`. Bytecode SHA-256: tender `8cd5b8bb…fc7c`, placeholder `c26a1fd2…7aa5`. Anyone can place a bid on the Kusama demo. Nothing moves if they do. Bidder page: https://birdbrain.wtf/tools/tender (`?net=paseo` for the rehearsal), source `birdbrain/tender/` (built into `index.html` by `build.py`; a copy is in the public repo at `procurement/page/index.html`). It reads the tender, checks the published specification (`/tools/tender/spec/demo.md`, the README as deployed) against the hash on chain, lists bids and the delivery record, and sends `bid(price, keccak256(terms))` from the bidder's wallet.

## Sealed tenders (2026-11-23)

`src/SealedProcurement.sol` replaces open bidding for real tenders. `Procurement.sol` stays as it is, because the Kusama demonstration is verified against it.

Why: with a published ceiling and prices visible as they arrive, a thin market bids towards the ceiling and the last bidder holds the advantage. So:

1. **Sealed bidding** until `bidClose`: `commit(keccak256(abi.encode(tender, bidder, price, terms, salt)))`, replaceable. `sealBid()` computes it. Buyer, reviewer and resolver cannot bid.
2. **Scoring** until `scoreClose`: offers (no price in them) are published, and the buyer calls `commitScores(hash)` once. No price can open before `scoreClose`.
3. **Opening** until `revealClose`: `reveal(price, terms, salt)` must match the bidder's latest seal. Unopened seals are not bids.
4. After `revealClose`, anyone with the salt opens the budget: `revealCeiling(cap, salt)` against `ceilingCommitment = keccak256(abi.encode(cap, salt))`. `award` needs the budget open, the scores fixed and the bid at or under the budget. Everything after the award is the same milestone escrow as `Procurement.sol`.

Not built: a bid bond (sealing and never opening costs nothing), and a deadline that forces the buyer to open the budget. Ten tests in `test/Sealed.t.sol`, 28 in all.

Tooling: `tenders/sealed.ts deploy|verify|scores|budget|award|status` (header has the arguments). The budget and salt are written to `keys/tenders/<slug>-<net>.json` (git-ignored, mode 600; `KEYS` overrides `keys/`) before deploying, and never into the record. `tenders/sealed-input.json` is the solc standard input used to deploy and verify.

**Paseo rehearsal, 2026-11-23**: `0xe683b5f98b1320f532e580fc8919d417f8b657cd` (block 16,129,244, verified), on the audit specification with short windows. Two test bidders sealed from the page (Bob US$7,200, Alice US$4,000), scores fixed at block 16,129,520 (`tenders/audit-sealed-paseo-scores.md`), both opened from the page with the bid file kept in the browser, budget US$9,000 opened, award to Alice at block 16,129,881 (`tenders/audit-sealed-paseo-award.md`). One trap: the chain's clock runs a few seconds behind wall time, so a call made right at a deadline can fail and should be retried.

## Second tender: the v2 security review (in preparation, 2026-11-23)

**Superseded by the sealed tender above for the real round.** The open version below stays as history. Same bytecode, same placeholder asset, committed to `audit-tender/specification.md` so bids are real bids on the audit. It only runs the sourcing half: bids and the award go on chain, and the winner is paid outside the contract once funding is found. Scripts in `tenders/`: `deploy-tender.ts <net> <slug> --spec <file> --ceiling <US$> --bid-close <ISO> --award-by <ISO> [--mainnet]` (refuses on mainnet while the spec has `{{…}}` placeholders) and `verify-tender.ts <net> <slug>`. Records `tenders/<slug>-<net>.json`, the hashed spec copied to `tenders/<slug>-<net>-spec-at-deploy.md` and published by `publish-static.sh` as `/tools/tender/spec/<slug>-<net>.md`. Paseo rehearsal: `0x4481bca62a2a54642a2538693c22cff8fa1f9508` (block 16,128,643, verified, ceiling 15,000, bids close 14 Dec 2026 12:00 UTC). Kusama: not deployed, waiting on rich for the ceiling, dates and payment terms. The bidder page lists tenders per network (`?tender=audit|demo`); Kusama's `audit` entry is `null` until deployed.

One contract per tender. Open priced bids bind a terms hash. The buyer awards after bidding closes, specifying up to 32 milestones. The contractor accepts and triggers full funding from the buyer's approved token balance. A fixed reviewer approves evidence, and a fixed resolver divides disputed milestone funds between buyer and contractor. Payments are pulled by each recipient. Roles can be contract addresses, allowing later governance integration.

Run `forge test` in this directory. Eighteen tests in three suites (`test/`) cover payment, duplicate claims and approval, unauthorised approval, transfer failure, overdue delivery, reviewer timeout, fuzzed dispute allocation conservation, the review findings (some pin known gaps rather than fixes) and the placeholder asset refusing every transfer.

The token interface is an ERC-20-shaped assumption. Kusama dUSD asset 50000002 integration has NOT been verified. The mock does not enforce allowances. No live dUSD compatibility or chain rehearsal is claimed.

Prototype limitations: no correction cycle, mutual cancellation, bid withdrawal, amendments, bonds, retention, resolver timeout or replacement. Resolver inactivity can strand disputed funds. Awarded milestone dates and amounts must be inspected by the contractor before acceptance. Terms hashes require separately available documents. Timestamp boundaries require realistic margins. Unsolicited tokens cannot be recovered. The buyer supplies funding and award authority in this prototype, not an approved governance model.

Next: complete those lifecycle choices, verify native dUSD access on a Kusama fork, add a production asset adapter if required, and expand adversarial tests before review or deployment. Existing decision deposit pools are separate.
