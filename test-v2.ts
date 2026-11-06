// Version 2 on a fork of today's Kusama Asset Hub: the factory, a Root-track pool, and the three fixes.
//
//   ./fork/restart-v2.sh && bun compile-v2.ts && bun test-v2.ts
//
// Same rules as test.ts: real signed transactions in real blocks of a copy of the live chain.
// Simulated: balances written into storage, Root cancel put on the scheduler.
import {
  connect, wallets, fund, nativeOf, dryRun, ethSend, KSM, WEI_PER_PLANCK, freeOf, reservedOf, names,
  asRoot, advancePast, newBlock, substrateKey, sendSubstrate, evmBalance, type Wallet,
} from "./lib";
import { encodeDeployData, encodeFunctionData, decodeFunctionResult, decodeErrorResult, decodeEventLog, type Abi, type Hex } from "viem";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const art = (n: string) => JSON.parse(readFileSync(new URL(`./build/${n}.json`, import.meta.url), "utf8"));
const POOL = art("v2/DecisionDepositPool"), FACTORY = art("v2/DecisionDepositPoolFactory"), V1 = art("DecisionDepositPool");
const REFERENDA = 92, PLACE = 1, REFUND = 2;

const api = await connect("ws://127.0.0.1:8011");
const { alice, bob, carol, dave, eve } = wallets();
const ferdie = substrateKey("//Ferdie");
const results: { name: string; ok: boolean }[] = [];
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };
const check = (name: string, ok: boolean, detail = "") => { results.push({ name, ok }); say(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };
const ksm = (p: bigint) => (Number(p) / 1e12).toFixed(8) + " KSM";
const wei = (p: bigint) => p * WEI_PER_PLANCK;
const now = async () => BigInt(((await api.query.timestamp.now()) as any).toBigInt() / 1000n);
const info = async (i: number) => (await api.query.referenda.referendumInfoFor(i)) as any;
const free = (who: Wallet | Hex) => freeOf(api, nativeOf(api, typeof who === "string" ? who : who.address));

function errName(abi: Abi, e: string | undefined) {
  if (!e?.startsWith("revert 0x")) return e;
  try { return decodeErrorResult({ abi, data: e.slice(7) as Hex }).errorName; } catch { return e; }
}
async function read(abi: Abi, to: Hex, fn: string, args: readonly unknown[] = []): Promise<any> {
  const r = await dryRun(api, dave.address, to, encodeFunctionData({ abi, functionName: fn, args } as any));
  if (!r.ok) throw new Error(`${fn}: ${errName(abi, r.error)}`);
  return decodeFunctionResult({ abi, functionName: fn, data: r.data } as any);
}
async function send(abi: Abi, w: Wallet, to: Hex, fn: string, args: readonly unknown[] = [], value = 0n) {
  const r = await ethSend(api, w, to, encodeFunctionData({ abi, functionName: fn, args } as any), value);
  return { ...r, error: errName(abi, r.error) };
}
async function deployRaw(a: any, args: readonly unknown[]) {
  const r = await ethSend(api, dave, null, encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args }));
  if (!r.ok) throw new Error("deploy failed: " + r.error);
  return r.events.find((e: any) => e.event.section === "revive" && e.event.method === "Instantiated").event.data[1].toHex() as Hex;
}
function poolEvents(events: any[], abi: Abi = POOL.abi) {
  return events.filter((e: any) => e.event.section === "revive" && e.event.method === "ContractEmitted").map((e: any) => {
    try { return decodeEventLog({ abi, data: e.event.data.data.toHex(), topics: e.event.data.topics.map((t: any) => t.toHex()) }) as any; } catch { return { eventName: "?" }; }
  });
}
const state = async (p: Hex) => ["Open", "Placed", "Returning"][Number(await read(POOL.abi, p, "state"))];
async function submit(origin: any, label: string) {
  const r = await sendSubstrate(api, api.tx.referenda.submit(origin, { Inline: api.tx.system.remark(label).method.toHex() } as any, { After: 100 } as any), ferdie);
  if (r.error) throw new Error("submit: " + r.error);
  return r.events.find((e: any) => e.event.method === "Submitted" && e.event.section === "referenda").event.data[0].toNumber() as number;
}
const trackDeposit = (id: number) => [...(api.consts.referenda.tracks as any)].find(([i]: any) => i.toNumber() === id)[1].decisionDeposit.toBigInt() as bigint;

// ---------------------------------------------------------------- setup
say(`fork of Kusama Asset Hub at #${((await api.rpc.chain.getHeader()) as any).number.toNumber()}, spec ${api.runtimeVersion.specVersion}`);
const ROOT = trackDeposit(0), WFC = trackDeposit(2);
check("Root decision deposit on chain is 3,333.3333333 KSM", ROOT === 3_333_333_333_300_000n, ksm(ROOT));
await fund(api, [alice, bob, carol, dave, eve].map((x) => nativeOf(api, x.address)), 10_000n);
await fund(api, [ferdie.address], 20_000n);
await newBlock(api);

say("\n# 1. One factory, anyone opens a pool");
const factory = await deployRaw(FACTORY, [REFERENDA, PLACE, REFUND, WEI_PER_PLANCK]);
say(`factory ${factory}`);
check("factory fixes the chain settings", Number(await read(FACTORY.abi, factory, "referendaPallet")) === 92 && (await read(FACTORY.abi, factory, "weiPerPlanck")) === WEI_PER_PLANCK);
const rootRef = await submit({ system: "Root" }, "decision-deposit v2: a Root referendum");
say(`Root referendum #${rootRef} submitted, no decision deposit`);
const deadline = (await now()) + 3600n;
const opened = await send(FACTORY.abi, carol, factory, "open", [rootRef, ROOT, 100n * KSM, deadline, eve.address]);
check("Carol, a stranger to the factory, opens a pool through it", opened.ok, opened.error ?? "");
const ev = poolEvents(opened.events, FACTORY.abi).find((e) => e.eventName === "PoolOpened");
const pool = ev.args.pool as Hex;
say(`pool ${pool}, account ${nativeOf(api, pool)}`);
check("PoolOpened names the referendum, opener, deposit and sweep address", ev.args.referendum === rootRef && ev.args.by.toLowerCase() === carol.address.toLowerCase() && ev.args.depositPlanck === ROOT && ev.args.sweepTo.toLowerCase() === eve.address.toLowerCase());
check("poolsFor(referendum) lists it", ((await read(FACTORY.abi, factory, "poolsFor", [rootRef])) as Hex[])[0]?.toLowerCase() === pool.toLowerCase());
check("pool inherits the chain settings from the factory", Number(await read(POOL.abi, pool, "referendaPallet")) === 92 && Number(await read(POOL.abi, pool, "refundCallIndex")) === 2);
const chainMsg = "0x0504060100185c01" + api.createType("u32", rootRef).toHex(true).slice(2);
check("pool builds the place message the chain encodes", (await read(POOL.abi, pool, "placeMessage")) === chainMsg, chainMsg);

say("\n# 2. A Root deposit (3,333.33 KSM) from three payers, with a withdraw and repay");
check("sweep while open is refused", (await send(POOL.abi, dave, pool, "sweep")).error === "WrongState");
await send(POOL.abi, alice, pool, "contribute", [], wei(1000n * KSM));
await send(POOL.abi, alice, pool, "withdraw");
const a2 = await send(POOL.abi, alice, pool, "contribute", [], wei(1000n * KSM));
check("Alice pays, withdraws and pays again", a2.ok, a2.error ?? "");
check("Alice is listed once (version 1 listed her twice)", (await read(POOL.abi, pool, "contributorCount")) === 1n);
await send(POOL.abi, bob, pool, "contribute", [], wei(2000n * KSM));
const fill = await send(POOL.abi, carol, pool, "contribute", [], wei(ROOT - 3000n * KSM));
const fe = poolEvents(fill.events).map((e) => e.eventName);
check("Carol's 333.33 top-up fills the pool and places the deposit in the same transaction", fe.includes("Placed") && !fe.includes("AutoPlaceFailed"), fe.join(" "));
check("that transaction put the Root referendum into its decision phase", names(fill.events).includes("referenda.DecisionDepositPlaced"));
const on = (await info(rootRef)).unwrap().asOngoing;
check("the deposit is held by the pool's own account", on.decisionDeposit.unwrap().who.toString() === nativeOf(api, pool) && on.decisionDeposit.unwrap().amount.toBigInt() === ROOT);
check("pool is Placed, 3,333.33 KSM reserved on its account", (await state(pool)) === "Placed" && (await reservedOf(api, nativeOf(api, pool))) >= ROOT);
check("three contributors", (await read(POOL.abi, pool, "contributorCount")) === 3n);

say("\n# 3. KSM sent by plain transfer is no longer stranded");
const stray = await sendSubstrate(api, api.tx.balances.transferKeepAlive(nativeOf(api, pool), 5n * KSM), ferdie);
check("Ferdie sends 5 KSM to the pool's account by plain transfer (no contract code runs)", !stray.error, stray.error ?? "");
check("sweep while placed is refused", (await send(POOL.abi, dave, pool, "sweep")).error === "WrongState");
check("reclaim while the referendum is live is refused", (await send(POOL.abi, dave, pool, "reclaim")).error === "NothingCameBack");
say("root cancel: " + (await asRoot(api, api.tx.referenda.cancel(rootRef))));
const parts: [Wallet, bigint][] = [[alice, 1000n * KSM], [bob, 2000n * KSM], [carol, ROOT - 3000n * KSM]];
const before = new Map<string, bigint>();
for (const [w] of parts) before.set(w.name, await free(w));
const rc = await send(POOL.abi, dave, pool, "reclaim");
check("after the ending, a stranger reclaims", rc.ok && (await state(pool)) === "Returning", rc.error ?? "");
check("excess() shows the stray 5 KSM", (await read(POOL.abi, pool, "excess")) === wei(5n * KSM), ksm((await read(POOL.abi, pool, "excess")) / WEI_PER_PLANCK));
const po = await send(POOL.abi, dave, pool, "payout", [0n, 3n]);
check("payout runs", po.ok, po.error ?? "");
for (const [w, amt] of parts) {
  const d = (await free(w)) - before.get(w.name)!;
  check(`${w.name} got exactly ${ksm(amt)} back`, d === amt, ksm(d));
}
const eveBefore = await free(eve);
const sw = await send(POOL.abi, alice, pool, "sweep");
check("anyone sweeps; the 5 KSM goes to the sweep address fixed at opening", sw.ok && (await free(eve)) - eveBefore === 5n * KSM, sw.error ?? ksm((await free(eve)) - eveBefore));
check("a second sweep finds nothing", (await send(POOL.abi, dave, pool, "sweep")).error === "NothingToSweep");
check("pool is empty", (await evmBalance(api, pool)) === 0n, String(await evmBalance(api, pool)));

say("\n# 4. Sweep never touches a share still owed (a payer that refuses payment)");
{
  const ref = await submit({ Origins: "WishForChange" }, "decision-deposit v2: refuser");
  const p = poolEvents((await send(FACTORY.abi, dave, factory, "open", [ref, WFC, 10n * KSM, (await now()) + 3600n, eve.address])).events, FACTORY.abi)[0].args.pool as Hex;
  const refuser = await deployRaw(art("v2/Refuser"), []);
  const rr = await send(art("v2/Refuser").abi, alice, refuser, "join", [p], wei(100n * KSM));
  check("a contract that refuses payment pays 100 KSM in", rr.ok, rr.error ?? "");
  await send(POOL.abi, bob, p, "contribute", [], wei(WFC - 100n * KSM));
  check("the pool filled and placed", (await state(p)) === "Placed");
  await sendSubstrate(api, api.tx.balances.transferKeepAlive(nativeOf(api, p), 2n * KSM), ferdie);
  say("root cancel: " + (await asRoot(api, api.tx.referenda.cancel(ref))));
  check("the referendum has ended", !(await info(ref)).unwrap().isOngoing, (await info(ref)).unwrap().type);
  await send(POOL.abi, dave, p, "reclaim");
  await send(POOL.abi, dave, p, "payout", [0n, 10n]);
  check("the refuser's 100 KSM stays owed", (await read(POOL.abi, p, "contributed", [refuser])) === wei(100n * KSM));
  const e0 = await free(eve);
  await send(POOL.abi, dave, p, "sweep");
  check("sweep sends only the 2 KSM nobody is owed", (await free(eve)) - e0 === 2n * KSM, ksm((await free(eve)) - e0));
  check("the refuser's 100 KSM is still in the pool", (await evmBalance(api, p)) === wei(100n * KSM));
}

say("\n# 5. reclaim survives a refund message the chain cannot weigh (Zealynx)");
{
  // Call index 99 does not exist, so weighMessage fails. The deposit comes back because
  // someone claims the refund directly on governance. Version 1 reverts; version 2 settles.
  for (const [label, a, extra] of [["version 1", V1, []], ["version 2", POOL, [eve.address]]] as const) {
    const ref = await submit({ Origins: "WishForChange" }, "decision-deposit v2: unweighable " + label);
    const p = await deployRaw(a, [ref, WFC, 10n * KSM, (await now()) + 3600n, REFERENDA, PLACE, 99, WEI_PER_PLANCK, ...extra]);
    await send(a.abi, alice, p, "contribute", [], wei(WFC));
    const st = Number(await read(a.abi, p, "state"));
    say("root cancel: " + (await asRoot(api, api.tx.referenda.cancel(ref))));
    const direct = await sendSubstrate(api, api.tx.referenda.refundDecisionDeposit(ref), ferdie);
    const r = await send(a.abi, dave, p, "reclaim");
    if (label === "version 1") check("version 1: placed, refunded directly, reclaim still reverts", st === 1 && !direct.error && !r.ok, r.error ?? "");
    else check("version 2: placed, refunded directly, reclaim settles", st === 1 && !direct.error && r.ok && Number(await read(a.abi, p, "state")) === 2, r.error ?? "");
  }
}

say("\n# 6. A wrong deposit can never place, and everyone is repaid after the close");
{
  const ref = await submit({ system: "Root" }, "decision-deposit v2: wrong deposit");
  const dl = (await now()) + 600n;
  const p = poolEvents((await send(FACTORY.abi, bob, factory, "open", [ref, WFC, 10n * KSM, dl, eve.address])).events, FACTORY.abi)[0].args.pool as Hex;
  const f = await send(POOL.abi, alice, p, "contribute", [], wei(WFC));
  const a0 = await free(alice); // after her own fee
  const names2 = poolEvents(f.events).map((e) => e.eventName);
  check("a pool opened with the WFC deposit for a Root referendum fills but cannot place", names2.includes("AutoPlaceFailed") && (await state(p)) === "Open", names2.join(" "));
  check("the fallback place is refused too", !(await send(POOL.abi, dave, p, "place")).ok);
  check("the Root referendum still has no decision deposit", (await info(ref)).unwrap().asOngoing.decisionDeposit.isNone);
  await advancePast(api, dl);
  await send(POOL.abi, dave, p, "abandon");
  await send(POOL.abi, dave, p, "payout", [0n, 1n]);
  const back = (await free(alice)) - a0;
  check("after the close, Alice is repaid in full", back === WFC, ksm(back));
}

check("the factory holds no money", (await evmBalance(api, factory)) === 0n);
check("the factory lists every pool it opened", (await read(FACTORY.abi, factory, "poolCount")) === 3n, String(await read(FACTORY.abi, factory, "poolCount")));

const passed = results.filter((r) => r.ok).length;
say(`\n${passed}/${results.length} passed`);
mkdirSync(new URL("./results", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/fork-test-v2.txt", import.meta.url), log.join("\n") + "\n");
process.exit(passed === results.length ? 0 : 1);
