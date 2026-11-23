# Procurement prototype

Status: prototype, not independently reviewed. **Unfunded demonstration live on Kusama Asset Hub since 2026-11-23** (below). No tender has ever held money.

## Unfunded demonstration (2026-11-23)

One tender pointed at `DemoPlaceholderAsset` (`src/DemoPlaceholderAsset.sol`): named "NOT dUSD", zero supply, every transfer reverts. The tender takes bids and an award, and `acceptAndFund` always fails, so it can never hold value. Buyer, reviewer and resolver are all Birdbrain's Kusama deployer `0x29c3…4b61`. Specification hash is the keccak of this README as it stood at deploy (`demo/README-at-deploy.md`). Ceiling 10,000 (6 decimals, nominal), bids close 7 Dec 2026 14:18 UTC, activation closes 14 Dec, review period 7 days.

| Net | Placeholder asset | Tender | Notes |
| --- | --- | --- | --- |
| Kusama | `0x602dacc6969a454c5965616bf3cbce0a07608c6f` | `0x8006674375a90d626029781c41cb163263479b70` | blocks 24,177,333-334, both verified on Blockscout, cost 0.0537 KSM |
| Paseo | `0xdd85dd5e5126383ba7413e1917e664eb5e0fff11` | `0xe738f7fad584e231bf46f4b402b9bd52ec8b78d7` | rehearsal, verified; one test bid from alice (5,000) |

Scripts in `demo/`: `deploy-demo.ts <net> [--mainnet]` (refuses if a record exists), `check-demo.ts <net> [--bid]` (bids on Paseo only), `verify-demo.ts <net>`. Records `demo/<net>.json`, compiler input `demo/standard-input.json`. Bytecode SHA-256: tender `8cd5b8bb…fc7c`, placeholder `c26a1fd2…7aa5`. Anyone can place a bid on the Kusama demo. Nothing moves if they do. Bidder page: https://birdbrain.wtf/tools/tender (`?net=paseo` for the rehearsal), source `procurement/page/index.html`. It reads the tender, checks the published specification (`/tools/tender/spec/demo.md`, the README as deployed) against the hash on chain, lists bids and the delivery record, and sends `bid(price, keccak256(terms))` from the bidder's wallet.

One contract per tender. Open priced bids bind a terms hash. The buyer awards after bidding closes, specifying up to 32 milestones. The contractor accepts and triggers full funding from the buyer's approved token balance. A fixed reviewer approves evidence, and a fixed resolver divides disputed milestone funds between buyer and contractor. Payments are pulled by each recipient. Roles can be contract addresses, allowing later governance integration.

Run `forge test` in this directory. Eighteen tests in three suites (`test/`) cover payment, duplicate claims and approval, unauthorised approval, transfer failure, overdue delivery, reviewer timeout, fuzzed dispute allocation conservation, the review findings (some pin known gaps rather than fixes) and the placeholder asset refusing every transfer.

The token interface is an ERC-20-shaped assumption. Kusama dUSD asset 50000002 integration has NOT been verified. The mock does not enforce allowances. No live dUSD compatibility or chain rehearsal is claimed.

Prototype limitations: no correction cycle, mutual cancellation, bid withdrawal, amendments, bonds, retention, resolver timeout or replacement. Resolver inactivity can strand disputed funds. Awarded milestone dates and amounts must be inspected by the contractor before acceptance. Terms hashes require separately available documents. Timestamp boundaries require realistic margins. Unsolicited tokens cannot be recovered. The buyer supplies funding and award authority in this prototype, not an approved governance model.

Next: complete those lifecycle choices, verify native dUSD access on a Kusama fork, add a production asset adapter if required, and expand adversarial tests before review or deployment. Existing decision deposit pools are separate.
