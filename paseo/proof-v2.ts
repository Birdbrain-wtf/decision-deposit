// Version 2 on Paseo Asset Hub: real wallets, real XCM, real governance.
//
//   bun paseo/proof-v2.ts setup     fill one pool (auto-place), leave one short, fill one opened wrong
//   bun paseo/proof-v2.ts resume    6 Nov, after the reorg: finish setup from the final chain (fallback place on A)
//   bun paseo/proof-v2.ts settle    after the referenda end: reclaim / abandon, payout, sweep
//
// Pools come from deployments/paseo-v2.json (opened with deploy-v2.ts). Each phase appends
// to results/paseo-proof-v2.txt.
import { createPublicClient, createWalletClient, http, defineChain, decodeEventLog, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "fs";
import { connect, deployer, send, nativeOf, KEYS } from "./substrate";
import { NETWORKS } from "../networks";

const N = NETWORKS.paseo;
const phase = process.argv[2];
const RECORD = new URL("../deployments/paseo-v2.json", import.meta.url).pathname;
const OUT = new URL("../results/paseo-proof-v2.txt", import.meta.url).pathname;
const rec = JSON.parse(readFileSync(RECORD, "utf8"));
const chain = defineChain({ id: N.chainId, name: N.name, nativeCurrency: { name: N.symbol, symbol: N.symbol, decimals: 18 }, rpcUrls: { default: { http: [N.eth] } } });
const pub = createPublicClient({ chain, transport: http() });
const art = (n: string) => JSON.parse(readFileSync(new URL(`../build/v2/${n}.json`, import.meta.url), "utf8"));
const P = art("DecisionDepositPool"), F = art("DecisionDepositPoolFactory");
const who = (n: string) => privateKeyToAccount(readFileSync(`${KEYS}/paseo-${n}.key`, "utf8").trim() as Hex);
const alice = who("alice"), bob = who("bob"), carol = who("deployer");
const PAS = 10n ** 18n;
const log: string[] = []; let pass = 0, fail = 0;
const say = (s: string) => { console.log(s); log.push(s); };
const check = (n: string, ok: any, d = "") => { ok ? pass++ : fail++; say(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  (" + d + ")" : ""}`); };
const pool = (label: string) => rec.pools.find((p: any) => p.label === label)?.address as Hex;
const read = (addr: Hex, fn: string, args: any[] = []) => pub.readContract({ address: addr, abi: P.abi, functionName: fn, args }) as Promise<any>;
const fmt = (w: bigint) => (Number(w) / 1e18).toFixed(4) + " PAS";
// Paseo's eth RPC hands out receipts from the best block, which can be reorganised away
// (6 Nov: the first setup run read Placed from a block that did not survive). So every
// transaction waits for finality and is re-read from the final chain. Gas is set, not
// estimated: an estimate taken before another payment lands is too small for the payment
// that fills the pool, and the placement inside it then runs out of gas (AutoPlaceFailed).
const GAS = 100_000n;
async function finalReceipt(hash: Hex) {
  const first = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  for (let i = 0; i < 90; i++) {
    const fin = await pub.getBlock({ blockTag: "finalized" });
    if (fin.number >= first.blockNumber) {
      const rc = await pub.getTransactionReceipt({ hash });
      const b = await pub.getBlock({ blockNumber: rc.blockNumber });
      if (b.hash === rc.blockHash && fin.number >= rc.blockNumber) return rc;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("not finalized: " + hash);
}
async function act(acct: any, addr: Hex, fn: string, value = 0n, args: any[] = [], abi = P.abi) {
  const w = createWalletClient({ account: acct, chain, transport: http() });
  const hash = await w.writeContract({ address: addr, abi, functionName: fn, value, args, gas: GAS });
  const rc = await finalReceipt(hash);
  const evs = rc.logs.filter((l) => l.address.toLowerCase() === addr.toLowerCase()).map((l) => { try { return (decodeEventLog({ abi, data: l.data, topics: l.topics }) as any).eventName; } catch { return null; } }).filter(Boolean);
  say(`  ${fn}${value ? " " + fmt(value) : ""} from ${acct.address.slice(0, 8)} → ${rc.status} (final), block ${rc.blockNumber}, events [${evs.join(", ")}], tx ${hash}`);
  return { rc, evs };
}
async function refuses(acct: any, addr: Hex, fn: string, args: any[] = []) {
  try { await pub.simulateContract({ account: acct, address: addr, abi: P.abi, functionName: fn, args }); return ""; }
  catch (e: any) { return (e.cause?.data?.errorName ?? e.shortMessage ?? "reverted") as string; }
}
const { client, api } = connect();
const refInfo = (r: number) => api.query.Referenda.ReferendumInfoFor.getValue(r, { at: "finalized" });

say(`\n==== ${phase} ${new Date().toISOString()} · factory ${rec.factory.address}`);

if (phase === "setup") {
  const A = pool("v2-filled"), B = pool("v2-unfilled");
  const rA = Number(await read(A, "referendum")), rB = Number(await read(B, "referendum"));
  say(`pool A ${A} for #${rA} · pool B ${B} for #${rB}`);
  const fx = (fn: string) => pub.readContract({ address: rec.factory.address, abi: F.abi, functionName: fn }) as Promise<any>;
  check("factory fixes Paseo's Referenda pallet (62), place 1, refund 2", Number(await fx("referendaPallet")) === 62 && Number(await fx("placeCallIndex")) === 1 && Number(await fx("refundCallIndex")) === 2);
  check("factory fixes Paseo's weiPerPlanck (1e8)", (await fx("weiPerPlanck")) === N.weiPerPlanck);
  const listed = await pub.readContract({ address: rec.factory.address, abi: F.abi, functionName: "poolsFor", args: [rA] }) as Hex[];
  check(`factory lists pool A under #${rA}`, listed.map((x) => x.toLowerCase()).includes(A.toLowerCase()));
  check("pool A's deposit is the track's 1 PAS, read from the chain", (await read(A, "deposit")) === PAS);
  check("pool A's sweepTo is fixed at opening", (await read(A, "sweepTo")).toLowerCase() === rec.pools[0].sweepTo.toLowerCase());

  say("\n# Pool A: Alice pays, withdraws, pays again; Bob fills it and places");
  await act(alice, A, "contribute", PAS / 2n);
  await act(alice, A, "withdraw");
  await act(alice, A, "contribute", PAS / 2n);
  check("Alice is listed once after withdrawing and paying again", Number(await read(A, "contributorCount")) === 1);
  check("a payment under the minimum is refused", (await refuses(bob, A, "contribute")) !== "");
  const { evs } = await act(bob, A, "contribute", PAS / 2n);
  check("Bob's filling payment placed the deposit in the same transaction", evs.includes("Placed") && !evs.includes("AutoPlaceFailed"));
  check("pool A is Placed (state 1)", Number(await read(A, "state")) === 1);
  const info: any = await refInfo(rA);
  const dd = info?.value?.decision_deposit;
  check(`#${rA}'s decision deposit is held by pool A's own account (${nativeOf(A)})`, dd?.who === nativeOf(A), dd ? `${dd.who}, ${Number(dd.amount) / 1e10} PAS` : "none");
  check(`#${rA} is deciding`, !!info?.value?.deciding);
  check("reclaim while the referendum is live is refused", (await refuses(carol, A, "reclaim")) !== "");

  say("\n# Stray PAS sent to pool A by a plain transfer");
  const me = deployer();
  await send("0.3 PAS to pool A's account", api.tx.Balances.transfer_keep_alive({ dest: { type: "Id", value: nativeOf(A) }, value: 3_000_000_000n }), me.signer);
  check("sweep is refused before payouts open", (await refuses(carol, A, "sweep")) !== "");
  check("excess() reads 0 before payouts open", (await read(A, "excess")) === 0n);

  say("\n# Pool B: left short, so it refunds after its close");
  await act(alice, B, "contribute", PAS / 4n);
  await act(bob, B, "contribute", PAS / 4n);
  check("pool B holds 0.5 of 1 PAS and is Open", (await read(B, "total")) === PAS / 2n && Number(await read(B, "state")) === 0);
  check("abandon before the close is refused", (await refuses(carol, B, "abandon")) !== "");

  say("\n# Pool C: opened through the factory with the wrong deposit (0.5 PAS for a 1 PAS track)");
  const deadline = BigInt(await read(B, "fundingDeadline"));
  const o = await act(carol, rec.factory.address, "open", 0n, [rB, 5_000_000_000n, 2_500_000_000n, deadline, carol.address], F.abi);
  const ev = o.rc.logs.map((l) => { try { return decodeEventLog({ abi: F.abi, data: l.data, topics: l.topics }) as any; } catch { return null; } }).find((e) => e?.eventName === "PoolOpened");
  const C = ev.args.pool as Hex;
  rec.pools.push({ label: "v2-wrong-deposit", address: C, referendum: rB, depositPlanck: "5000000000", minPlanck: "2500000000", fundingDeadline: String(deadline), sweepTo: carol.address, openTx: o.rc.transactionHash, block: Number(o.rc.blockNumber), at: new Date().toISOString(), note: "deliberately wrong deposit" });
  writeFileSync(RECORD, JSON.stringify(rec, null, 2) + "\n");
  say(`  pool C ${C}`);
  const c = await act(alice, C, "contribute", PAS / 2n);
  check("pool C fills but the placement fails, and the payment stands", c.evs.includes("AutoPlaceFailed") && (await read(C, "total")) === PAS / 2n);
  check("pool C stays Open and still holds the 0.5 PAS", Number(await read(C, "state")) === 0 && (await pub.getBalance({ address: C })) >= PAS / 2n);
  check("place() by hand is refused too", (await refuses(carol, C, "place")) !== "");
  const infoB: any = await refInfo(rB);
  check(`#${rB} still has no decision deposit`, !infoB?.value?.decision_deposit);
} else if (phase === "resume") {
  const [A, B, C] = ["v2-filled", "v2-unfilled", "v2-wrong-deposit"].map(pool);
  const rA = Number(await read(A, "referendum")), rB = Number(await read(B, "referendum"));
  const D = (a: Hex) => pub.getBalance({ address: a });
  say("# What the final chain holds after the first run (logs read from finalized blocks)");
  const logsA = await pub.getLogs({ address: A, fromBlock: BigInt(rec.pools[0].block), toBlock: "finalized" });
  const namesA = logsA.map((l) => { try { return (decodeEventLog({ abi: P.abi, data: l.data, topics: l.topics }) as any).eventName; } catch { return "?"; } });
  say(`  pool A events: ${namesA.join(", ")}`);
  check("pool A: Bob's filling payment stands though its placement ran out of gas", namesA.includes("AutoPlaceFailed") && (await read(A, "total")) === PAS && Number(await read(A, "state")) === 0);
  check("pool A: Alice is listed once after withdrawing and paying again (Alice, Bob)", Number(await read(A, "contributorCount")) === 2);
  check(`#${rA} has no decision deposit yet`, !(await refInfo(rA) as any)?.value?.decision_deposit);

  say("\n# Pool A: the fallback. Anyone sends place() on a full, open pool");
  const balA = await D(A);
  const pl = await act(carol, A, "place");
  check("place() placed the deposit", pl.evs.includes("Placed") && Number(await read(A, "state")) === 1);
  check("pool A's balance fell by exactly the deposit (the 0.3 PAS stray stays)", balA - (await D(A)) === PAS, fmt(await D(A)));
  const info: any = await refInfo(rA);
  const dd = info?.value?.decision_deposit;
  check(`#${rA}'s decision deposit is held by pool A's own account (${nativeOf(A)})`, dd?.who === nativeOf(A), dd ? `${Number(dd.amount) / 1e10} PAS` : "none");
  check(`#${rA} is deciding`, !!info?.value?.deciding);
  check("reclaim while the referendum is live is refused", (await refuses(carol, A, "reclaim")) !== "");
  check("sweep is refused before payouts open", (await refuses(carol, A, "sweep")) !== "");
  check("excess() reads 0 before payouts open", (await read(A, "excess")) === 0n);

  say("\n# Pool B: Bob's payment ran out of gas on the final chain; he pays again with gas set");
  await act(bob, B, "contribute", PAS / 4n);
  check("pool B holds 0.5 of 1 PAS from two addresses and is Open", (await read(B, "total")) === PAS / 2n && Number(await read(B, "contributorCount")) === 2 && Number(await read(B, "state")) === 0);
  check("abandon before the close is refused", (await refuses(carol, B, "abandon")) !== "");

  say("\n# Pool C (wrong deposit), read from the final chain");
  const logsC = await pub.getLogs({ address: C, fromBlock: BigInt(rec.pools[0].block), toBlock: "finalized" });
  const namesC = logsC.map((l) => { try { return (decodeEventLog({ abi: P.abi, data: l.data, topics: l.topics }) as any).eventName; } catch { return "?"; } });
  say(`  pool C events: ${namesC.join(", ")}`);
  check("pool C filled, the placement failed, and the payment stands", namesC.includes("AutoPlaceFailed") && (await read(C, "total")) === PAS / 2n);
  check("pool C stays Open", Number(await read(C, "state")) === 0);
  check("place() by hand is refused on pool C", (await refuses(carol, C, "place")) !== "");
  check(`#${rB} still has no decision deposit`, !(await refInfo(rB) as any)?.value?.decision_deposit);
  const fcPools = await pub.readContract({ address: rec.factory.address, abi: F.abi, functionName: "poolsFor", args: [rB] }) as Hex[];
  check(`factory lists both pools for #${rB}`, fcPools.length === 2);
} else if (phase === "settle") {
  const [A, B, C] = ["v2-filled", "v2-unfilled", "v2-wrong-deposit"].map(pool);
  const rA = Number(await read(A, "referendum"));
  const iA: any = await refInfo(rA);
  say(`#${rA}: ${iA?.type}`);
  const bal = (a: Hex) => pub.getBalance({ address: a });
  const settleOne = async (label: string, addr: Hex, first: "reclaim" | "abandon") => {
    say(`\n# ${label} ${addr}`);
    const s = Number(await read(addr, "state"));
    if (s !== 2) { const why = await refuses(carol, addr, first); if (why) { say(`  ${first} still refused (${why}); not yet`); return; } await act(carol, addr, first); }
    const owed = [alice, bob].map((x) => x.address);
    const before = await Promise.all(owed.map((x) => read(addr, "contributed", [x])));
    const balsBefore = await Promise.all(owed.map((x) => pub.getBalance({ address: x })));
    await act(carol, addr, "payout", 0n, [0n, BigInt(await read(addr, "contributorCount"))]);
    const balsAfter = await Promise.all(owed.map((x) => pub.getBalance({ address: x })));
    owed.forEach((x, i) => check(`${label}: ${x.slice(0, 8)} repaid exactly ${fmt(before[i])}`, balsAfter[i] - balsBefore[i] === before[i]));
    check(`${label}: nothing left owed`, (await read(addr, "total")) === 0n);
    const ex = await read(addr, "excess");
    if (ex > 0n) {
      const to = await read(addr, "sweepTo") as Hex; const t0 = await bal(to);
      await act(alice, addr, "sweep");
      check(`${label}: sweep sent ${fmt(ex)} to sweepTo and nothing else`, (await bal(to)) - t0 === ex);
    }
    say(`  ${label} balance now ${fmt(await bal(addr))}`);
  };
  await settleOne("pool A", A, "reclaim");
  await settleOne("pool B", B, "abandon");
  await settleOne("pool C", C, "abandon");
} else { console.log("usage: setup | settle"); process.exit(1); }

say(`\n${phase}: ${pass} passed, ${fail} failed`);
appendFileSync(OUT, log.join("\n") + "\n");
client.destroy(); process.exit(fail ? 1 : 0);
