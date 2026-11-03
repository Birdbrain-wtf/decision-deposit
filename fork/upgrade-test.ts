// Usage: bun upgrade-test.ts <wsUrl> <wasmPath|none> <cancel|direct-refund|broken-call>
// Runs the live Pool 2 through a runtime upgrade on a fork, then settles it.
// Fork: chopsticks on Kusama Asset Hub at block 23369146. Runtime: asset-hub-kusama_runtime-v2005002.compact.compressed.wasm from polkadot-fellows/runtimes v2.5.2.
import { readFileSync } from "fs";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { blake2AsHex } from "@polkadot/util-crypto";
import { encodeFunctionData, decodeFunctionResult, parseAbi, type Hex } from "viem";
import { abi, asRoot, dryRun, evmBalance, fund, nativeOf, newBlock, read, tx, wallets, substrateKey, sendSubstrate, names, connect } from "../lib.ts";

const POOL = "0xfcd8058e46b8ac6f02f1cc71e2912c5ffdc095ce" as Hex;
const XCM = "0x00000000000000000000000000000000000a0000" as Hex;
const xcmAbi = parseAbi(["function weighMessage(bytes message) view returns ((uint64 refTime, uint64 proofSize) weight)"]);
const [url, wasmPath, mode] = process.argv.slice(2);
const log = (...a: any[]) => console.log(...a);
let fails = 0;
const check = (ok: boolean, what: string) => { log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) fails++; };

let api: ApiPromise = await connect(url);
const { dave } = wallets();
const spec = () => api.runtimeVersion.specVersion.toNumber();
log("fork head", (await api.rpc.chain.getHeader()).number.toNumber(), "spec", spec());

async function weigh(msg: Hex) {
  const data = encodeFunctionData({ abi: xcmAbi, functionName: "weighMessage", args: [msg] });
  const r = await dryRun(api, dave.address, XCM, data);
  if (!r.ok) return { ok: false as const, error: r.error };
  const w: any = decodeFunctionResult({ abi: xcmAbi, functionName: "weighMessage", data: r.data });
  return { ok: true as const, refTime: w.refTime, proofSize: w.proofSize };
}
async function snapshot(tag: string) {
  const state = await read(api, POOL, "state");
  const msg = (await read(api, POOL, "refundMessage")) as Hex;
  const w = await weigh(msg);
  const m = api.registry.findMetaCall(new Uint8Array([92, 2]));
  log(`[${tag}] spec ${spec()} state ${state} refundMessage ${msg} decodes-to ${m.section}.${m.method} weigh ${JSON.stringify(w, (_, v) => typeof v === "bigint" ? v.toString() : v)}`);
  return { state, msg, w };
}

await fund(api, [nativeOf(api, dave.address)], 100n);
await newBlock(api);
const before = await snapshot("before");
check(Number(before.state) === 1, "pool is Placed on the fork");
if (wasmPath !== "none") check(spec() === 2005001, "fork starts on the live runtime, 2005001");
const early = await dryRun(api, dave.address, POOL, encodeFunctionData({ abi, functionName: "reclaim" }));
log("reclaim while live:", JSON.stringify(early, (_, v) => typeof v === "bigint" ? v.toString() : v));
check(!early.ok, "reclaim refused while #676 is live");

if (wasmPath !== "none") {
  const raw = readFileSync(wasmPath);
  const code = "0x" + raw.toString("hex");
  const hash = blake2AsHex(raw, 256);
  log("authorising", hash);
  const a = await asRoot(api, api.tx.system.authorizeUpgrade(hash));
  log("authorize_upgrade via Root:", a);
  check(a === "Ok", "upgrade authorised by Root");
  // Unsigned, the way anyone applies an authorised upgrade on the live chain.
  const up = api.tx.system.applyAuthorizedUpgrade(code);
  log("dry run", (await (api.rpc as any).system.dryRun(up.toHex())).toString());
  log("submitted", (await api.rpc.author.submitExtrinsic(up.toHex())).toHex());
  await newBlock(api);
  { const b = await api.rpc.chain.getBlock(); log("apply block extrinsics", b.block.extrinsics.map((x: any) => `${x.method.section}.${x.method.method}`).join(" ")); }
  const evn = () => (api.query.system.events() as any).then((evs: any[]) => evs.map((e) => `${e.event.section}.${e.event.method}`).filter((n: string) => /system\.|parachainSystem\./.test(n) && !/ExtrinsicSuccess/.test(n)));
  const first = await evn();
  log("apply_authorized_upgrade events:", first.join(" "));
  check(first.includes("parachainSystem.ValidationFunctionStored") || first.includes("system.CodeUpdated"), "apply_authorized_upgrade stored the new code");
  log("pendingValidationCode bytes", ((await (api.query.parachainSystem as any).pendingValidationCode()) as any).length);
  let upgraded = false;
  for (let i = 0; i < 12 && !upgraded; i++) {
    await newBlock(api);
    const v: any = await (api.rpc as any).state.getRuntimeVersion();
    log(` block +${i + 1} spec ${v.specVersion.toNumber()} events ${(await evn()).join(" ")}`);
    upgraded = v.specVersion.toNumber() === 2005002;
  }
  check(upgraded, "chain runs spec 2005002 through the real upgrade path");
  await api.disconnect();
  api = await ApiPromise.create({ provider: new WsProvider(url), noInitWarn: true });
  const last: any = await api.query.system.lastRuntimeUpgrade();
  log("LastRuntimeUpgrade", JSON.stringify(last.toHuman()));
  await newBlock(api, 2);
  const after = await snapshot("after-upgrade");
  check(after.w.ok === true, "weighMessage(refundMessage()) succeeds after the upgrade");
  check(after.msg === before.msg, "refund message bytes unchanged");
  if (before.w.ok && after.w.ok) log("weight before→after", before.w.refTime.toString(), "→", after.w.refTime.toString());
  const live = await dryRun(api, dave.address, POOL, encodeFunctionData({ abi, functionName: "reclaim" }));
  check(!live.ok && (live as any).error === "NothingCameBack", `reclaim still refused cleanly while live (${(live as any).error})`);
}

const c = await asRoot(api, api.tx.referenda.cancel(676));
log("cancel #676 via Root:", c);
check(c === "Ok", "#676 ended by Root cancel");
const info: any = await api.query.referenda.referendumInfoFor(676);
log("#676 status", info.unwrap().type);

if (mode === "direct-refund") {
  const alice = substrateKey("//DirectRefunder");
  await fund(api, [alice.address], 10n);
  await newBlock(api);
  const r = await sendSubstrate(api, api.tx.referenda.refundDecisionDeposit(676), alice);
  log("direct refund_decision_deposit:", r.error ?? "Ok");
  check(!r.error, "someone else claimed the refund directly on governance");
}

if (mode === "broken-call") {
  // Negative control: stand in for a runtime that no longer decodes the refund
  // call. Rewrite the pool's refund index in its code on this fork only, with
  // the deposit already back by a direct refund, so only the weighing can fail.
  const alice = substrateKey("//DirectRefunder");
  await fund(api, [alice.address], 10n);
  await newBlock(api);
  const r = await sendSubstrate(api, api.tx.referenda.refundDecisionDeposit(676), alice);
  log("direct refund_decision_deposit:", r.error ?? "Ok");
  const ci: any = await api.query.revive.accountInfoOf(POOL);
  const codeHash = ci.unwrap().accountType.asContract.codeHash;
  const key = api.query.revive.pristineCode.key(codeHash);
  const stored: any = await api.rpc.state.getStorage(key);
  const hex = stored.toHex() as string;
  const needle = "7f" + "00".repeat(31) + "02";
  const patched = hex.split(needle).join("7f" + "00".repeat(31) + "63");
  log("occurrences of the immutable 2:", hex.split(needle).length - 1);
  await api.rpc("dev_setStorage" as any, [[key, patched]]);
  await newBlock(api);
  const msg = (await read(api, POOL, "refundMessage")) as Hex;
  log("patched refundMessage", msg, "weigh", JSON.stringify(await weigh(msg), (_, v) => typeof v === "bigint" ? v.toString() : v));
  const bal = await evmBalance(api, POOL);
  const bap = (await read(api, POOL, "balanceAfterPlacing")) as bigint;
  const dep = (await read(api, POOL, "deposit")) as bigint;
  log("balance", bal.toString(), "needed", (bap + dep).toString(), "money back:", bal >= bap + dep);
  const d = await dryRun(api, dave.address, POOL, encodeFunctionData({ abi, functionName: "reclaim" }));
  log("reclaim with a broken refund call:", JSON.stringify(d, (_, v) => typeof v === "bigint" ? v.toString() : v));
  check(!d.ok, "CONTROL: reclaim reverts when the refund call no longer decodes, even with the money back");
  log(`RESULT fails=${fails}`);
  process.exit(fails ? 1 : 0);
}

const n = Number(await read(api, POOL, "contributorCount"));
const people: { who: Hex; owed: bigint; start: bigint }[] = [];
for (let i = 0; i < n; i++) {
  const who = (await read(api, POOL, "contributors", [BigInt(i)])) as Hex;
  if (people.find((p) => p.who === who)) continue;
  const owed = (await read(api, POOL, "contributed", [who])) as bigint;
  people.push({ who, owed, start: await evmBalance(api, who) });
}
const totalOwed = people.reduce((s, p) => s + p.owed, 0n);
log("entries", n, "addresses", people.length, "owed KSM", Number(totalOwed / 1_000_000n) / 1e12);

const rc = await tx(api, dave, POOL, "reclaim");
log("reclaim:", rc.ok ? "Ok" : rc.error, rc.ok ? names(rc.events).filter((x: string) => /revive|referenda|polkadotXcm/.test(x)).join(" ") : "");
check(rc.ok, "reclaim by a stranger succeeds");
check(Number(await read(api, POOL, "state")) === 2, "pool moves to Returning");
const po = await tx(api, dave, POOL, "payout", [0n, BigInt(n)]);
log("payout:", po.ok ? "Ok" : po.error);
check(po.ok, "payout(0, count) succeeds");
for (const p of people) {
  const end = await evmBalance(api, p.who);
  check(end - p.start === p.owed, `${p.who} repaid ${Number(p.owed / 1_000_000n) / 1e12} KSM to the planck`);
}
check((await evmBalance(api, POOL)) === 0n, "pool balance 0");
check(((await read(api, POOL, "total")) as bigint) === 0n, "pool total 0");
log(`RESULT fails=${fails}`);
process.exit(fails ? 1 : 0);
