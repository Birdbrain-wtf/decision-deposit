// The contribute page, end to end, in real Chromium against the chopsticks fork.
// Wallets are injected as an EIP-1193 provider that forwards to ui-test/eth-shim.ts,
// which signs with the fixed test wallets. Everything the page does is real: it reads
// the pool over the RPC, simulates, sends, waits for the receipt and re-reads.
//
//   ./fork/restart.sh && bun ui-test/e2e.ts        writes results/ui-e2e.txt and shots
import { connect, wallets, fund, nativeOf, deploy, read, freeOf, asRoot, KSM, WEI_PER_PLANCK } from "../lib";
import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { Hex } from "viem";

const HERE = new URL(".", import.meta.url).pathname;
const PAGE = process.env.PAGE ?? HERE + "../page/index.html";
const DEPOSIT = 666_666_666_660_000n;
const api = await connect();
const w = wallets();
const log: string[] = [];
let pass = 0, fail = 0;
const say = (s: string) => { console.log(s); log.push(s); };
const check = (name: string, ok: any, detail = "") => { ok ? pass++ : fail++; say(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- chain
await fund(api, Object.values(w).map((x) => nativeOf(api, x.address)), 10_000n);
const now = BigInt(((await api.query.timestamp.now()) as any).toBigInt() / 1000n);
const pool = await deploy(api, w.dave, [676, DEPOSIT, 10n * KSM, now + 30n * 86400n, 92, 1, 2, WEI_PER_PLANCK]);
say(`pool ${pool} for #676 on the fork`);

// ---------------------------------------------------------------- servers
const shim = spawn("bun", [HERE + "eth-shim.ts"], { stdio: ["ignore", "inherit", "inherit"] });
Bun.serve({ hostname: "127.0.0.1", port: 8787, fetch: () => new Response(readFileSync(PAGE), { headers: { "content-type": "text/html; charset=utf-8" } }) });
for (let i = 0; i < 60; i++) { try { await fetch("http://127.0.0.1:8545", { method: "POST", body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' }); break; } catch { await sleep(500); } }

// ---------------------------------------------------------------- browser (CDP, as birdbrain/app-link/test/decent-carry-e2e.ts)
process.env.AGENT_BROWSER_SESSION ||= "decision-deposit-ui";
execSync("agent-browser open about:blank");
const ws = new WebSocket(execSync("agent-browser get cdp-url").toString().trim());
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map<number, (v: any) => void>();
ws.onmessage = (m) => { const j = JSON.parse(String(m.data)); if (j.id && waiting.has(j.id)) { waiting.get(j.id)!(j); waiting.delete(j.id); } };
const send = (method: string, params: any = {}, sessionId?: string) => new Promise<any>((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); })
  .then((j: any) => { if (j.error) throw new Error(`${method}: ${j.error.message}`); return j.result; });
const target = (await send("Target.getTargets")).targetInfos.find((t: any) => t.type === "page");
const { sessionId: S } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
await send("Page.enable", {}, S); await send("Runtime.enable", {}, S);
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.ethereum = { on() {}, async request({ method, params }) {
    const acct = location.hash.slice(1);
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct];
    if (method.startsWith("wallet_")) return null;
    const r = await fetch("http://127.0.0.1:8545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  } };` }, S);

const js = async (expr: string) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, S)).result.value;
async function until(expr: string, what: string, ms = 60000) {
  for (let t = 0; t < ms; t += 500) { if (await js(expr)) return true; await sleep(500); }
  throw new Error("timed out waiting for " + what + "; msg=" + (await js(`document.getElementById('msg')?.textContent`)));
}
const text = (id: string) => js(`document.getElementById(${JSON.stringify(id)}).textContent`);
const clickText = (label: string) => js(`[...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)} && !b.hidden)?.click() ?? "missing"`);
const msgIs = (frag: string) => until(`document.getElementById('msg').textContent.includes(${JSON.stringify(frag)})`, `message "${frag}"`, 120000);
const URL0 = `http://localhost:8787/deposit?pool=${pool}&rpc=http://127.0.0.1:8545`;
async function shot(name: string, width = 1280) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }, S);
  const { data } = await send("Page.captureScreenshot", { captureBeyondViewport: true, format: "png" }, S);
  mkdirSync(HERE + "../results/ui", { recursive: true });
  writeFileSync(HERE + `../results/ui/${name}.png`, Buffer.from(data, "base64"));
}
async function as(who: keyof typeof w) {
  await send("Page.navigate", { url: URL0 + "#" + w[who].address.toLowerCase() }, S);
  await sleep(300); await send("Page.reload", {}, S);
  await until(`!document.getElementById('poolview').hidden && document.getElementById('state').textContent !== '…'`, "pool to load");
  await js(`document.getElementById('connect').click()`);
  await until(`document.getElementById('walletline').textContent.startsWith('Connected')`, "wallet to connect");
}
const contributed = async (x: Hex) => (await read(api, pool, "contributed", [x])) as bigint;
const ksmWei = (k: bigint) => k * KSM * WEI_PER_PLANCK;

try {
  say("\n# empty state");
  await send("Page.navigate", { url: "http://localhost:8787/deposit" }, S);
  await until(`document.readyState === 'complete'`, "load");
  check("with no pool listed, the page says no pool is open", await js(`!document.getElementById('nopool').hidden && document.getElementById('poolview').hidden`));

  say("\n# Eve pays in and takes it back");
  await as("eve");
  check("an unlisted pool carries the warning", (await text("trust")).includes("not one Birdbrain lists"));
  check("the page reads the pool: #676, 0 of 666.6666 KSM, Open", (await text("refline")).includes("#676") && (await text("deposit")) === "666.6666" && (await text("state")) === "Open", `${await text("total")} of ${await text("deposit")}`);
  await js(`document.getElementById('amt').value = '20'`);
  check("Pay in is disabled until the kill risk is acknowledged", await js(`document.getElementById('contribute').disabled`));
  await js(`document.getElementById('ack').click()`);
  await js(`document.getElementById('contribute').click()`);
  await msgIs("Paid in");
  check("Eve's 20 KSM is recorded on the chain", (await contributed(w.eve.address)) === ksmWei(20n));
  await until(`document.getElementById('total').textContent === '20'`, "the page to re-read the pool").catch(() => {});
  check("the page shows 20 KSM in and Eve marked as you", (await text("total")) === "20" && (await js(`document.getElementById('contribs').textContent`)).includes("(you)"));
  await shot("open-desktop"); await shot("open-mobile", 390); await shot("open-desktop");
  await clickText("Take my KSM back");
  await msgIs("on its way back");
  check("Eve's withdrawal clears her share on the chain", (await contributed(w.eve.address)) === 0n);

  say("\n# Alice, Bob, then Carol fills it");
  await as("alice");
  await js(`document.getElementById('ack').click(); document.getElementById('amt').value = '5'; document.getElementById('contribute').click()`);
  check("5 KSM is refused on the page before anything is sent", (await text("msg")).includes("smallest payment"));
  await js(`document.getElementById('amt').value = '700'; document.getElementById('contribute').click()`);
  check("more than the pool needs is refused on the page", (await text("msg")).includes("more than the pool still needs"));
  await js(`document.getElementById('amt').value = '300'; document.getElementById('contribute').click()`);
  await msgIs("Paid in");
  await as("bob");
  await js(`document.getElementById('ack').click(); document.getElementById('amt').value = '300'; document.getElementById('contribute').click()`);
  await msgIs("Paid in");
  await as("carol");
  check("the page says 66.6666 KSM still needed", (await text("remaining")).startsWith("66.6666"));
  await js(`document.getElementById('rest').click()`);
  check("Fill the rest puts in exactly the remainder", (await js(`document.getElementById('amt').value`)) === "66.66666666");
  await js(`document.getElementById('ack').click(); document.getElementById('contribute').click()`);
  await msgIs("Paid in");
  check("Carol's payment placed the deposit: the page shows Deposit placed", (await text("state")) === "Deposit placed");
  const on = ((await api.query.referenda.referendumInfoFor(676)) as any).unwrap().asOngoing;
  check("on the chain #676 is deciding with the pool's account as depositor", on.deciding.isSome && on.decisionDeposit.unwrap().who.toString() === nativeOf(api, pool));
  await shot("placed-desktop");

  say("\n# Dave, with no stake, brings it back");
  await as("dave");
  await clickText("Bring the deposit back");
  await msgIs("Not yet");
  check("bringing it back while #676 runs is stopped before the wallet, in plain words", (await text("state")) === "Deposit placed");
  say("root cancel: " + (await asRoot(api, api.tx.referenda.cancel(676))));
  const before = new Map(await Promise.all((["alice", "bob", "carol"] as const).map(async (k) => [k, await freeOf(api, nativeOf(api, w[k].address))] as const)));
  await as("dave");
  await clickText("Bring the deposit back");
  await msgIs("deposit is back in the pool");
  check("the page moves to Paying back", (await text("state")) === "Paying back");
  await clickText("Pay everyone back");
  await msgIs("Everyone who could be paid");
  check("the page says everyone has been paid back", (await text("next")) === "Everyone has been paid back.");
  const paid = { alice: 300n * KSM, bob: 300n * KSM, carol: DEPOSIT - 600n * KSM };
  for (const k of ["alice", "bob", "carol"] as const) {
    const delta = (await freeOf(api, nativeOf(api, w[k].address))) - before.get(k)!;
    check(`${k} got exactly what they paid in back`, delta === paid[k], `${Number(delta) / 1e12} KSM`);
  }
  await shot("returned-desktop");
} catch (e: any) {
  fail++; say("FAIL  " + e.message);
  await shot("failure").catch(() => {});
}

say(`\n${pass} passed, ${fail} failed`);
writeFileSync(HERE + "../results/ui-e2e.txt", log.join("\n") + "\n");
shim.kill(); ws.close(); await api.disconnect();
process.exit(fail ? 1 : 0);
