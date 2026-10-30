# Collaborative decision deposits

A contract that lets several groups share one referendum's decision deposit on Kusama Asset Hub, and pays every group back when the referendum ends.

A Kusama referendum cannot be voted on until someone places its decision deposit. On the Wish for Change track that is 666.67 KSM, which is a lot for one group to lock up. The pool is fixed to one referendum when it is created. Groups pay in from their own addresses, and the payment that fills the pool places the deposit through the XCM precompile, from the contract's own account. When the referendum ends, anyone can call `reclaim` and then `payout`, and each group is paid back to the address it paid from.

There is no owner, no admin key and no upgrade path. Every parameter is set when the pool is deployed and can be read on the contract.

Contribute page: https://birdbrain.wtf/deposit (practice pool: https://birdbrain.wtf/deposit?net=paseo)

## Before you pay in

- **A killed referendum loses the deposit.** Approved, rejected, cancelled and timed out all refund. Killed does not, and the pool cannot recover it.
- **Nothing fires by itself.** A referendum ending writes a record on the chain, and a record cannot call a contract. Someone has to send `reclaim` and `payout`. Anyone can.
- **It has not been reviewed by anyone outside Birdbrain.** Reviews are welcome: open an issue.

## Deployments

| Network | Pool | Referendum | Code |
| --- | --- | --- | --- |
| Paseo Asset Hub (test) | practice, 200 PAS, open until 2 November 2026 02:00 UTC | [#146](https://paseo.subsquare.io/referenda/146) | [`0x023f…f151`](https://blockscout-testnet.polkadot.io/address/0x023f8bf3acc31cee9990a7d9a198c53b2ac3f151?tab=contract) |
| Paseo Asset Hub (test) | proof run, 1 PAS, placed | [#145](https://paseo.subsquare.io/referenda/145) | [`0xc87b…ffb1`](https://blockscout-testnet.polkadot.io/address/0xc87bb5fff76a0ae3544150e9f75dd11e2a6dffb1?tab=contract) |
| Kusama Asset Hub | none yet | | |

Each deployment's constructor arguments and transaction are in `deployments/paseo.json`. The source is verified on Blockscout with solc 0.8.30, optimiser on at 200 runs, EVM version cancun.

## How it reaches governance

Asset Hub has no governance precompile, so the contract calls the XCM precompile at `0xA0000` with a one-instruction message, `Transact { origin_kind: SovereignAccount, call }`. That dispatches `Referenda.place_decision_deposit` or `refund_decision_deposit` signed by the contract's own account, so the deposit is the pool's and the refund comes back to it. The contract does not trust the XCM reply. It checks its own balance: placing must lower it by exactly the deposit, and a refund must raise it by the same amount.

EVM amounts have 18 decimals. KSM has 12 on the chain and PAS has 10, so each pool is created with the chain's ratio (`weiPerPlanck`: 10^6 on Kusama, 10^8 on Paseo) and refuses any amount that is not a whole number of planck.

## What has been tested

- `test.ts`: 88 checks on a chopsticks fork of Kusama Asset Hub, using Ethereum-signed transactions. It covers filling, auto-placing on the real #676, refusing an early reclaim, settling after cancel and after rejection, losing the deposit on a kill, abandoning a pool that never fills, someone else placing first, a contributor that refuses payment, and a plain Polkadot account paying through `Revive.call`. Log: `results/fork-test.txt`.
- `ui-test/e2e.ts`: the contribute page in Chromium against the same fork. Log: `results/ui-e2e.txt`.
- `paseo/proof.ts`: the same contract on Paseo Asset Hub. Two wallets filled a 1 PAS pool, the filling payment placed the decision deposit on referendum #145 through XCM, and the chain shows the pool's own account as depositor. Log: `results/paseo-proof.txt`. The refund side runs when #145 ends.

On the fork, balances were written straight into storage, Root's cancel and kill were put on the scheduler directly, and one rejection was written as the record the pallet writes.

## Run it

```
bun install
bun compile.ts                                  # build/DecisionDepositPool.json
./fork/restart.sh && bun test.ts                # fork suite, about 15 minutes
./fork/restart.sh && bun ui-test/e2e.ts         # the page in a browser
```

Paseo scripts (`paseo/`) read keys from `KEYS` (default `keys/`) and `PASEO_MNEMONIC` (default `keys/paseo-mnemonic`), both ignored by git. Test money only. The contribute page is `page/index.html`.

Birdbrain is a Decent initiative that tests, learns and educates in public. Apache-2.0.
