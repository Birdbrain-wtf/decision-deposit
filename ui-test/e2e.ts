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
const PAGE = process.env.PAGE ?? "/home/workspace/birdbrain/deposit/index.html";
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
// The hash picks the wallets: "#<addr>" fills only window.ethereum and announces nothing;
// "#<mode>:<a>:<b>" sets up wallet A in window.ethereum and announces wallets (EIP-6963).
// Providers are frozen because a real wallet's may be, so the page cannot write on them.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  (() => {
    window.__calls = [];
    const parts = location.hash.slice(1).split(":");
    const make = (acct, label, reject) => Object.freeze({ on() {}, async request({ method, params }) {
      window.__calls.push(label + ":" + method);
      if (method === "eth_requestAccounts" && reject.left > 0) { reject.left--; throw Object.assign(new Error("User rejected the request."), { code: 4001 }); }
      if (method === "eth_requestAccounts" && reject.hang) return new Promise(() => {});
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct];
      if (method.startsWith("wallet_")) return null;
      const r = await fetch("http://127.0.0.1:8545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
      return j.result;
    } });
    if (parts.length === 1) { window.ethereum = make(parts[0], "slot", { left: 0 }); return; }
    const [mode, a, b] = parts;
    const A = make(a, "A", { left: mode === "reject" ? 1 : 0, hang: mode === "hang" }), B = make(b, "B", { left: 0 });
    window.ethereum = A;
    const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#8b5cf6"/></svg>');
    const list = mode === "one" ? [["B", "Wallet B", B, icon]]
      : mode === "evil" ? [["A", '<img src=x onerror="window.__pwned=1">', A, "https://evil.invalid/x.png"], ["B", "Wallet B", B, icon]]
      : [["A", "Wallet A", A, icon], ["B", "Wallet B", B, icon]];
    const announce = () => { for (const [uuid, name, provider, ic] of list)
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: Object.freeze({ uuid, name, icon: ic, rdns: "test." + uuid }), provider }) })); };
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  })();` }, S);

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
async function setup(hash: string) {
  await send("Page.navigate", { url: URL0 + "#" + hash }, S);
  await sleep(300); await send("Page.reload", {}, S);
  await until(`!document.getElementById('poolview').hidden && document.getElementById('state').textContent !== '…'`, "pool to load");
}
const pickerNames = () => js(`[...document.querySelectorAll('#walletList button')].map(b => b.textContent)`) as Promise<string[]>;
const pick = (label: string) => js(`[...document.querySelectorAll('#walletList button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
const calls = () => js(`window.__calls`) as Promise<string[]>;
const connected = (addr: string) => until(`document.getElementById('walletline').textContent.startsWith('Connected as ${addr.slice(0, 6)}')`, "wallet to connect as " + addr);
const contributed = async (x: Hex) => (await read(api, pool, "contributed", [x])) as bigint;
const ksmWei = (k: bigint) => k * KSM * WEI_PER_PLANCK;

try {
  say("\n# opening the page with no address");
  await send("Page.navigate", { url: "http://localhost:8787/deposit" }, S);
  await until(`document.readyState === 'complete'`, "load");
  await until(`!document.getElementById('poolview').hidden && document.getElementById('state').textContent !== '…'`, "the listed pool to load from the live network");
  check("with no address, the page opens on the listed Kusama pool for #676, without the unlisted warning", (await text("refline")).includes("#676") && !(await text("trust")).includes("not one Birdbrain lists"));

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

  say("\n# more than one wallet installed");
  const A = w.bob.address.toLowerCase(), B = w.eve.address.toLowerCase();
  await setup(`two:${A}:${B}`);
  await js(`document.getElementById('connect').click()`);
  await until(`!document.getElementById('walletPick').hidden`, "the wallet list");
  check("two wallets: Connect shows both and asks neither for accounts yet", JSON.stringify(await pickerNames()) === '["Wallet A","Wallet B"]' && !(await calls()).some((c) => c.endsWith("eth_requestAccounts")));
  await shot("wallet-picker-mobile", 390); await shot("wallet-picker-desktop");
  await pick("Wallet B");
  await connected(B);
  check("choosing the wallet that does not hold window.ethereum connects that wallet, and A is never asked", (await text("walletline")).includes(B.slice(0, 6)) && !(await calls()).some((c) => c.startsWith("A:")));
  check("the list closes and offers a change of wallet", await js(`document.getElementById('walletPick').hidden && !document.getElementById('changeWallet').hidden`));
  await js(`document.getElementById('ack').click(); document.getElementById('amt').value = '20'; document.getElementById('contribute').click()`);
  await msgIs("Paid in");
  check("the payment goes through the chosen wallet: B's address pays, A's does not", (await contributed(w.eve.address)) === ksmWei(20n) && (await contributed(w.bob.address)) === 0n);
  check("the wallet in window.ethereum saw no transaction", (await calls()).includes("B:eth_sendTransaction") && !(await calls()).some((c) => c.startsWith("A:") || c.startsWith("slot:")));
  await clickText("Take my KSM back");
  await msgIs("on its way back");
  check("taking it back also goes through the chosen wallet", (await contributed(w.eve.address)) === 0n && (await calls()).filter((c) => c === "B:eth_sendTransaction").length === 2);
  await js(`document.getElementById('changeWallet').click()`);
  await until(`document.getElementById('walletline').textContent.startsWith('Connect an Ethereum')`, "the page to show no wallet connected");
  check("Use a different wallet disconnects and reopens the list", !(await js(`document.getElementById('walletPick').hidden`)));
  await pick("Wallet A");
  await connected(A);
  check("the second wallet can then be chosen", (await calls()).includes("A:eth_requestAccounts"));

  await setup(`one:${A}:${B}`);
  await js(`document.getElementById('connect').click()`);
  await connected(B);
  check("one announced wallet connects straight away, without a list", await js(`document.getElementById('walletPick').hidden && document.getElementById('changeWallet').hidden`));

  await setup(`reject:${A}:${B}`);
  await js(`document.getElementById('connect').click()`);
  await until(`!document.getElementById('walletPick').hidden`, "the wallet list");
  await pick("Wallet A");
  await until(`document.getElementById('msg').className === 'bad'`, "the refusal message");
  check("refusing in one wallet keeps the list open", !(await js(`document.getElementById('walletPick').hidden`)));
  await pick("Wallet B");
  await connected(B);
  check("and the other wallet can still be chosen", (await calls()).includes("B:eth_requestAccounts"));

  await setup(`hang:${A}:${B}`);
  await js(`document.getElementById('connect').click()`);
  await until(`!document.getElementById('walletPick').hidden`, "the wallet list");
  await pick("Wallet A");
  await sleep(300);
  await pick("Wallet B");
  await connected(B);
  check("a wallet popup left unanswered does not block choosing another", (await calls()).includes("A:eth_requestAccounts"));

  await setup(`evil:${A}:${B}`);
  await js(`document.getElementById('connect').click()`);
  await until(`!document.getElementById('walletPick').hidden`, "the wallet list");
  await sleep(300);
  check("a wallet's name shows as text and its icon only from a data: URL", !(await js(`window.__pwned === 1`)) && (await js(`document.querySelector('#walletList button').textContent.startsWith('<img')`)) && (await js(`document.querySelectorAll('#walletList img').length`)) === 1);

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
  check("the page moves to Refunding", (await text("state")) === "Refunding");
  const listed = Number(await read(api, pool, "contributorCount", []));
  check("Eve paid in twice and withdrew twice, so the contract lists more addresses than the page shows", listed > (await js(`document.querySelectorAll('#contribs tbody tr').length`)), `${listed} entries`);
  await clickText("Refund everyone");
  await msgIs("Everyone who could be paid");
  check("the page says everyone has been refunded", (await text("next")) === "Everyone has been refunded.");
  check("the page moves to Refunded", (await text("state")) === "Refunded");
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
