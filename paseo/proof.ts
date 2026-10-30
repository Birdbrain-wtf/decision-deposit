// The proof run on Paseo Asset Hub: real wallets, real XCM, real governance.
//   bun paseo/proof.ts <pool>     writes results/paseo-proof.txt
import { createPublicClient, createWalletClient, http, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync } from "fs";
import { connect, nativeOf, KEYS } from "./substrate";
import { NETWORKS } from "../networks";

const N = NETWORKS.paseo;
const pool = process.argv[2] as Hex;
const chain = defineChain({ id: N.chainId, name: N.name, nativeCurrency: { name: N.symbol, symbol: N.symbol, decimals: 18 }, rpcUrls: { default: { http: [N.eth] } } });
const pub = createPublicClient({ chain, transport: http() });
const { abi } = JSON.parse(readFileSync(new URL("../build/DecisionDepositPool.json", import.meta.url), "utf8"));
const who = (n: string) => privateKeyToAccount(readFileSync(`${KEYS}/paseo-${n}.key`, "utf8").trim() as Hex);
const alice = who("alice"), bob = who("bob");
const log: string[] = []; let pass = 0, fail = 0;
const say = (s: string) => { console.log(s); log.push(s); };
const check = (n: string, ok: any, d = "") => { ok ? pass++ : fail++; say(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  (" + d + ")" : ""}`); };
const read = (fn: string, args: any[] = []) => pub.readContract({ address: pool, abi, functionName: fn, args }) as Promise<any>;
async function act(acct: any, fn: string, value = 0n) {
  const w = createWalletClient({ account: acct, chain, transport: http() });
  const hash = await w.writeContract({ address: pool, abi, functionName: fn, value });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  say(`  ${fn} from ${acct.address.slice(0, 8)} → ${rc.status}, block ${rc.blockNumber}, tx ${hash}`);
  return rc;
}
const PAS = 10n ** 18n;
const ref = Number(await read("referendum"));
say(`Paseo Asset Hub, pool ${pool}, referendum #${ref}, ${new Date().toISOString()}`);
check("weiPerPlanck on the pool is Paseo's ratio (1e8)", (await read("weiPerPlanck")) === N.weiPerPlanck);
check("deposit is 1 PAS", (await read("deposit")) === PAS);

const already = Number(await read("state")) !== 0;
if (already) say("\n(already placed: re-checking the chain only; the transactions are in the earlier run below)");
if (!already) {
say("\n# Alice pays in half and takes it back");
await act(alice, "contribute", PAS / 2n);
check("Alice's 0.5 PAS is recorded", (await read("contributed", [alice.address])) === PAS / 2n);
await act(alice, "withdraw");
check("Alice's withdrawal clears her share", (await read("contributed", [alice.address])) === 0n);

say("\n# Alice and Bob fill it; Bob's payment places the deposit through XCM");
await act(alice, "contribute", PAS / 2n);
await act(bob, "contribute", PAS / 2n);
}
check("pool is Placed (state 1)", Number(await read("state")) === 1);
check("pool's balance fell by the deposit", (await pub.getBalance({ address: pool })) < PAS / 10n);
const { client, api } = connect();
const info: any = await api.query.Referenda.ReferendumInfoFor.getValue(ref, { at: "best" });
const dd = info?.value?.decision_deposit;
const expectSs58 = nativeOf(pool);
say(`  on chain: #${ref} ${info?.type}, decision deposit ${dd ? JSON.stringify({ who: dd.who, amount: String(dd.amount) }) : "none"}`);
check(`#${ref}'s decision deposit is held by the pool's own account (${expectSs58})`, dd?.who === expectSs58);
check(`#${ref} is deciding`, !!info?.value?.deciding);
check("the deposit is 1 PAS", dd && BigInt(dd.amount) === 10_000_000_000n);
say(`\nthe refund: after #${ref} ends (its decision period, at most 7 days), anyone sends reclaim then payout.`);
say(`\n${pass} passed, ${fail} failed`);
const out = new URL("../results/paseo-proof.txt", import.meta.url);
const prev = already ? (() => { try { return readFileSync(out, "utf8").split("\n---- earlier run (the transactions) ----\n").pop(); } catch { return ""; } })() : "";
writeFileSync(out, log.join("\n") + "\n" + (prev ? "\n---- earlier run (the transactions) ----\n" + prev : ""));
client.destroy(); process.exit(fail ? 1 : 0);
