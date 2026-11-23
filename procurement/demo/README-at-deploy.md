# Procurement prototype

Status: local prototype, not deployed or independently reviewed.

One contract per tender. Open priced bids bind a terms hash. The buyer awards after bidding closes, specifying up to 32 milestones. The contractor accepts and triggers full funding from the buyer's approved token balance. A fixed reviewer approves evidence, and a fixed resolver divides disputed milestone funds between buyer and contractor. Payments are pulled by each recipient. Roles can be contract addresses, allowing later governance integration.

Run `forge test` in this directory. Seven tests cover payment, duplicate claims and approval, unauthorised approval, transfer failure, overdue delivery, reviewer timeout and fuzzed dispute allocation conservation.

The token interface is an ERC-20-shaped assumption. Kusama dUSD asset 50000002 integration has NOT been verified. The mock does not enforce allowances. No live dUSD compatibility or chain rehearsal is claimed.

Prototype limitations: no correction cycle, mutual cancellation, bid withdrawal, amendments, bonds, retention, resolver timeout or replacement. Resolver inactivity can strand disputed funds. Awarded milestone dates and amounts must be inspected by the contractor before acceptance. Terms hashes require separately available documents. Timestamp boundaries require realistic margins. Unsolicited tokens cannot be recovered. The buyer supplies funding and award authority in this prototype, not an approved governance model.

Next: complete those lifecycle choices, verify native dUSD access on a Kusama fork, add a production asset adapter if required, and expand adversarial tests before review or deployment. Existing decision deposit pools are separate.
