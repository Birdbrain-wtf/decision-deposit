# Collaborative decision deposits

A contract that lets several groups share one referendum's decision deposit on Kusama Asset Hub, and pays every group back when the referendum ends.

A Kusama referendum cannot be voted on until someone places its decision deposit. On the Wish for Change track that is 666.67 KSM, which is a lot for one group to lock up. The pool is fixed to one referendum when it is created. Groups pay in from their own addresses, and the payment that fills the pool places the deposit through the XCM precompile, from the contract's own account. When the referendum ends, anyone can call `reclaim` and then `payout`, and each group is paid back to the address it paid from.

There is no owner, no admin key and no upgrade path. Every parameter is set when the pool is deployed and can be read on the contract.

Contribute page: https://birdbrain.wtf/tools/cdd (Paseo rehearsal: https://birdbrain.wtf/tools/cdd?net=paseo)

**The first Kusama pool is live, for referendum #676, and the code needs reviewers.** Funding closes on 3 November 2026 at 12:00 UTC. #676 times out about six hours later if its deposit is not placed. Once the deposit is on, #676 decides for up to 14 days, and the KSM comes back when it ends.

## Before you pay in

- **A killed referendum loses the deposit.** Approved, rejected, cancelled and timed out all refund. Killed does not, and the pool cannot recover it.
- **Nothing fires by itself.** A referendum ending writes a record on the chain, and a record cannot call a contract. Someone has to send `reclaim` and `payout`. Anyone can.
- **It has not been reviewed by anyone outside Birdbrain.** Please read `contracts/DecisionDepositPool.sol` (about 230 lines) and open an issue with anything you find, however small. The parts most worth a second pair of eyes are the XCM encoding, the balance checks around `place` and `reclaim`, and the batched `payout`.
- **How long the KSM is locked.** On Kusama's Wish for Change track a referendum decides for up to 14 days. Paseo's runs 28, so the Paseo rehearsal pays back later than Kusama would. The first payback on a real network is the 1 PAS proof pool on Paseo #145, due around 6 November 2026.

## Deployments

| Network | Pool | Referendum | Code |
| --- | --- | --- | --- |
| Paseo Asset Hub (test) | rehearsal of Kusama #676, 20,000 PAS, open until 2 November 2026 12:00 UTC | [#147](https://paseo.subsquare.io/referenda/147) | [`0x8f72…5187`](https://blockscout-testnet.polkadot.io/address/0x8f728b1edecd0786d26b9fd023039033e2f85187?tab=contract) |
| Paseo Asset Hub (test) | practice, 200 PAS, open until 2 November 2026 02:00 UTC | [#146](https://paseo.subsquare.io/referenda/146) | [`0x023f…f151`](https://blockscout-testnet.polkadot.io/address/0x023f8bf3acc31cee9990a7d9a198c53b2ac3f151?tab=contract) |
| Paseo Asset Hub (test) | proof run, 1 PAS, placed | [#145](https://paseo.subsquare.io/referenda/145) | [`0xc87b…ffb1`](https://blockscout-testnet.polkadot.io/address/0xc87bb5fff76a0ae3544150e9f75dd11e2a6dffb1?tab=contract) |
| Kusama Asset Hub | WFC-01, 666.67 KSM, smallest payment 5 KSM, open until 3 November 2026 12:00 UTC | [#676](https://kusama.subsquare.io/referenda/676) | [`0x4d8b…4c87`](https://blockscout-kusama.polkadot.io/address/0x4d8b316355ee2d334ef3494be1fa3ef8c7114c87?tab=contract) |

#147 mirrors Kusama #676: `paseo/mirror.ts` reads #676's proposal from Kusama Asset Hub, checks it hashes to #676's proposal hash, notes it on Paseo and submits it with the same origin (Wish for Change) and enactment. Proposal `0xe6abe7f11ad89116d0b1a9704db80e5ad793d39f3d351e7a412389c9a1ab8e97`, 2,731 bytes, on both chains. Paseo's Wish for Change deposit is 20,000 PAS (Kusama: 666.67 KSM), and Paseo times out a referendum with no deposit after 3 days (Kusama: 14).

Each deployment's constructor arguments and transaction are in `deployments/kusama.json` and `deployments/paseo.json`. The source is verified on Blockscout with solc 0.8.30, optimiser on at 200 runs, EVM version cancun.

## How it reaches governance

Asset Hub has no governance precompile, so the contract calls the XCM precompile at `0xA0000` with a one-instruction message, `Transact { origin_kind: SovereignAccount, call }`. That dispatches `Referenda.place_decision_deposit` or `refund_decision_deposit` signed by the contract's own account, so the deposit is the pool's and the refund comes back to it. The contract does not trust the XCM reply. It checks its own balance: placing must lower it by exactly the deposit, and a refund must raise it by the same amount.

EVM amounts have 18 decimals. KSM has 12 on the chain and PAS has 10, so each pool is created with the chain's ratio (`weiPerPlanck`: 10^6 on Kusama, 10^8 on Paseo) and refuses any amount that is not a whole number of planck.

## What has been tested

- `test.ts`: 88 checks on a chopsticks fork of Kusama Asset Hub, using Ethereum-signed transactions. It covers filling, auto-placing on the real #676, refusing an early reclaim, settling after cancel and after rejection, losing the deposit on a kill, abandoning a pool that never fills, someone else placing first, a contributor that refuses payment, and a plain Polkadot account paying through `Revive.call`. Log: `results/fork-test.txt`.
- `ui-test/e2e.ts`: the contribute page in Chromium against the same fork. Log: `results/ui-e2e.txt`.
- `paseo/mirror.ts`: copies a Kusama referendum to Paseo, byte for byte. Dry run by default, `--go` to submit.
- `paseo/proof.ts`: the same contract on Paseo Asset Hub. Two wallets filled a 1 PAS pool, the filling payment placed the decision deposit on referendum #145 through XCM, and the chain shows the pool's own account as depositor. Log: `results/paseo-proof.txt`. The refund side runs when #145 ends.

On the fork, balances were written straight into storage, Root's cancel and kill were put on the scheduler directly, and one rejection was written as the record the pallet writes.

## Version 2 (on Paseo, not on Kusama)

`contracts/v2/` adds a factory, so anyone can open a pool for any referendum on any track. The factory fixes the chain settings (Referenda pallet, place and refund call indices, `weiPerPlanck`) and holds no money. Whoever opens a pool picks the referendum, the deposit, the smallest payment, the funding close and one `sweepTo` address. Changes from version 1: `reclaim` weighs and sends the refund message inside a `try`, `sweep` returns KSM sent by plain transfer to `sweepTo`, and someone who withdraws and pays in again is listed once.

A contract cannot read governance storage, so the factory cannot check a deposit. A pool opened with the wrong one fills, fails to place and repays everyone after the close. `ref-terms.ts` reads a referendum live and prints its deposit and a funding close an hour after its timeout.

- `test-v2.ts`: 41 checks on a fork of Kusama Asset Hub, including a Root pool of 3,333.33 KSM. Log: `results/fork-test-v2.txt`.
- `paseo/proof-v2.ts`: the factory on Paseo Asset Hub, pools for #156 and #157. Log: `results/paseo-proof-v2.txt`. Deployment: `deployments/paseo-v2.json`.

```
bun compile-v2.ts                               # build/v2/
./fork/restart-v2.sh && bun test-v2.ts          # fork suite
bun ref-terms.ts kusama <referendum>           # deposit and funding close
```

Neither version has had a professional audit.

## Run it

```
bun install
bun compile.ts                                  # build/DecisionDepositPool.json
./fork/restart.sh && bun test.ts                # fork suite, about 15 minutes
./fork/restart.sh && bun ui-test/e2e.ts         # the page in a browser
```

Paseo scripts (`paseo/`) read keys from `KEYS` (default `keys/`) and `PASEO_MNEMONIC` (default `keys/paseo-mnemonic`), both ignored by git. Test money only. The contribute page is `page/index.html`.

Birdbrain is a Decent initiative that tests, learns and educates in public. Apache-2.0.
