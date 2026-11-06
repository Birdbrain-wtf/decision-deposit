// What the page needs from Asset Hub's Substrate side, published as JSON on Birdbrain's box.
//
// 1. Every pool's full event history. The page lists payments with eth_getLogs, but Asset
//    Hub's Ethereum RPC only indexes Ethereum transactions, so a payment made with
//    `revive.call` from a Polkadot account (Birdbrain's 200 KSM into #676) never appears
//    there. This walks every block since a pool was deployed, keeps the blocks whose events
//    mention it, decodes those, and writes `<pool>.json`.
// 2. Every pool a version 2 factory opens, found from the factory's own `PoolOpened`
//    events (whichever side opened it), each checked against its referendum:
//    `<net>-pools.json`. A new pool is followed from the block it was opened in.
// 3. Every ongoing referendum with the terms a pool needs (track, deposit, timeout, a
//    funding close an hour after the timeout) and whether it already has a decision
//    deposit, plus the status of any referendum a pool is for: `<net>-referenda.json`.
//    A contract cannot read governance, so this is how the page knows.
//
//   bun run indexer.ts                 catch up, then follow finalised blocks (the service)
//   bun run indexer.ts --once          catch up, write everything once, and exit
//   OUT=/var/lib/cdd-indexer/events    where the JSON goes (served at birdbrain.wtf/tools/cdd/events/)
//   NETS=paseo                         only these networks (comma-separated)
//
// Runs on Birdbrain's box as cdd-indexer.service (ADR 0076). Reads only; holds no key.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";

type Cfg = {
  ws: string; http: string; subsquare: string; symbol: string; decimals: number;
  pools: { address: string; from: number }[]; // version 1 pools, deployed on their own
  factories: { address: string; from: number }[];
};
const ALL: Record<string, Cfg> = {
  kusama: {
    ws: "wss://kusama-asset-hub-rpc.polkadot.io",
    http: "https://kusama-asset-hub-rpc.polkadot.io",
    subsquare: "https://kusama-api.subsquare.io/gov2/referendums/", symbol: "KSM", decimals: 12,
    pools: [
      { address: "0x4d8b316355ee2d334ef3494be1fa3ef8c7114c87", from: 23200570 },
      { address: "0xfcd8058e46b8ac6f02f1cc71e2912c5ffdc095ce", from: 23354884 },
    ],
    factories: [],
  },
  paseo: {
    ws: "wss://asset-hub-paseo-rpc.n.dwellir.com",
    http: "https://asset-hub-paseo-rpc.n.dwellir.com",
    subsquare: "https://paseo-api.subsquare.io/gov2/referendums/", symbol: "PAS", decimals: 10,
    pools: [],
    factories: [{ address: "0x5cd50558f126f2b83d040cc38a7002984097173d", from: 15398884 }],
  },
};
const ONLY = (process.env.NETS || "").split(",").filter(Boolean);
const NETS = Object.fromEntries(Object.entries(ALL).filter(([k]) => !ONLY.length || ONLY.includes(k)));
const OUT = process.env.OUT || "./out";
const ONCE = process.argv.includes("--once");
const EVENTS_KEY = "0x26aa394eea5630e07c48ae0c9558cef780d41e5e16056765bc8461851072c9d7";
const POOL_OPENED = "0xf9185e346a9291eb4ba573c465e6592f5f8871a230452aac4d39b6dc13b7c3db";
const BATCH = 100;
const RELAY_BLOCK_SECONDS = 6;
const MARGIN_SECONDS = 3600; // the funding close: an hour after the estimated timeout, never before it
const REFERENDA_EVERY_MS = 120_000;

type Row = { block: number; time: number | null; ext: string; method: string; origin: "eth" | "substrate"; topics: string[]; data: string };
type File = { pool: string; net: string; from: number; scannedTo: number; updated: string; events: Row[] };
type Opened = {
  address: string; factory: string; version: 2; referendum: number; by: string; depositPlanck: string; minPlanck: string;
  fundingDeadline: number; sweepTo: string; block: number; time: number | null; ext: string;
  check?: { v?: number; ok: boolean; reasons: string[]; at: string; frozen?: boolean };
};

async function rpcBatch(url: string, calls: [string, unknown[]][]): Promise<any[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params }))) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const out: any[] = await r.json();
      out.sort((a, b) => a.id - b.id);
      if (out.some((x) => x.error)) throw new Error(JSON.stringify(out.find((x) => x.error).error));
      return out.map((x) => x.result);
    } catch (e) {
      if (attempt >= 6) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
  }
}

function writeJson(name: string, value: unknown) {
  mkdirSync(OUT, { recursive: true });
  const p = `${OUT}/${name}`;
  writeFileSync(p + ".tmp", JSON.stringify(value));
  renameSync(p + ".tmp", p);
}
function readJson<T>(name: string): T | null {
  const p = `${OUT}/${name}`;
  try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; }
}
function load(net: string, address: string, from: number): File {
  const f = readJson<File>(`${address}.json`);
  if (f && f.from === from) return f;
  return { pool: address, net, from, scannedTo: from - 1, updated: "", events: [] };
}
function save(f: File) { f.updated = new Date().toISOString(); writeJson(`${f.pool}.json`, f); }

async function decode(api: ApiPromise, hash: string, number: number, watch: Set<string>): Promise<Map<string, Row[]>> {
  const at = await api.at(hash);
  const [events, block, now] = await Promise.all([at.query.system.events(), api.rpc.chain.getBlock(hash), at.query.timestamp.now()]);
  const out = new Map<string, Row[]>();
  for (const { event, phase } of events as any) {
    if (event.section !== "revive" || event.method !== "ContractEmitted") continue;
    const contract = event.data[0].toHex().toLowerCase();
    if (!watch.has(contract)) continue;
    const idx = phase.isApplyExtrinsic ? phase.asApplyExtrinsic.toNumber() : -1;
    const x = idx >= 0 ? block.block.extrinsics[idx] : null;
    const method = x ? `${x.method.section}.${x.method.method}` : "system";
    const row: Row = {
      block: number, time: Number((now as any).toBigInt()), ext: idx >= 0 ? `${number}-${idx}` : String(number), method,
      origin: method === "revive.ethTransact" ? "eth" : "substrate",
      data: event.data[1].toHex(), topics: event.data[2].map((t: any) => t.toHex()),
    };
    if (!out.has(contract)) out.set(contract, []);
    out.get(contract)!.push(row);
  }
  return out;
}

const word = (h: string, i: number) => BigInt("0x" + h.slice(2 + i * 64, 2 + (i + 1) * 64));
const addrOf = (h: string) => "0x" + h.slice(-40).toLowerCase();

class Net {
  files: File[] = [];
  opened: Opened[] = [];
  referenda: any = null;
  lastReferenda = 0;
  titles = new Map<number, string | null>();
  constructor(public name: string, public cfg: Cfg, public api: ApiPromise) {
    const prev = readJson<{ pools: Opened[] }>(`${name}-pools.json`);
    this.opened = prev?.pools || [];
    for (const p of [...cfg.pools, ...cfg.factories]) this.files.push(load(name, p.address.toLowerCase(), p.from));
    for (const o of this.opened) this.files.push(load(name, o.address, o.block));
  }
  get factories() { return new Set(this.cfg.factories.map((f) => f.address.toLowerCase())); }

  // Catch up to `to`. Returns true when it stopped early at a block that opened a new pool,
  // so the caller scans again with that pool among the addresses it looks for.
  async scan(to: number): Promise<boolean> {
    const watch = new Set(this.files.map((f) => f.pool));
    const needles = this.files.map((f) => f.pool.slice(2));
    const start = Math.min(...this.files.map((f) => f.scannedTo + 1));
    const PAR = 8;
    for (let n = start; n <= to; n += BATCH * PAR) {
      const windows: [number, number][] = [];
      for (let w = n; w <= Math.min(n + BATCH * PAR - 1, to); w += BATCH) windows.push([w, Math.min(w + BATCH - 1, to)]);
      const hits = (await Promise.all(windows.map(async ([lo, hi]) => {
        const nums = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
        const hashes = await rpcBatch(this.cfg.http, nums.map((b) => ["chain_getBlockHash", [b]]));
        const raws = await rpcBatch(this.cfg.http, hashes.map((h) => ["state_getStorage", [EVENTS_KEY, h]]));
        return nums.map((num, i) => ({ num, hash: hashes[i], raw: (raws[i] || "") as string }))
          .filter((x) => needles.some((p) => x.raw.includes(p)));
      }))).flat();
      for (const h of hits) {
        const found = await decode(this.api, h.hash, h.num, watch);
        for (const f of this.files) {
          if (h.num <= f.scannedTo) continue;
          for (const r of found.get(f.pool) || []) f.events.push(r);
        }
        const fresh: Opened[] = [];
        for (const fac of this.factories) for (const r of found.get(fac) || []) {
          if (r.topics[0] !== POOL_OPENED) continue;
          const address = addrOf(r.topics[2]);
          if (this.opened.some((o) => o.address === address) || fresh.some((o) => o.address === address)) continue;
          fresh.push({ address, factory: fac, version: 2, referendum: Number(BigInt(r.topics[1])), by: addrOf(r.topics[3]),
            depositPlanck: word(r.data, 0).toString(), minPlanck: word(r.data, 1).toString(), fundingDeadline: Number(word(r.data, 2)),
            sweepTo: addrOf("0x" + r.data.slice(2 + 3 * 64, 2 + 4 * 64)), block: h.num, time: r.time, ext: r.ext });
        }
        if (fresh.length) {
          // The new pools' own events in this block, then stop here: the blocks after it were
          // filtered without their addresses, so they are scanned again.
          const again = await decode(this.api, h.hash, h.num, new Set(fresh.map((o) => o.address)));
          for (const o of fresh) {
            const f = load(this.name, o.address, o.block);
            if (f.scannedTo < h.num) { f.events = again.get(o.address) || []; f.scannedTo = h.num; }
            this.files.push(f); this.opened.push(o);
            console.log(`${this.name}: pool ${o.address} opened for #${o.referendum} at block ${h.num}`);
          }
          for (const f of this.files) if (f.scannedTo < h.num) f.scannedTo = h.num;
          this.saveAll();
          return true;
        }
      }
      const end = windows[windows.length - 1][1];
      for (const f of this.files) if (end > f.scannedTo) f.scannedTo = end;
      this.saveAll();
      if (hits.length || (end - start) % 10000 < BATCH * PAR || end === to) console.log(`${this.name}: scanned to ${end} of ${to}, ${hits.length} hit(s)`);
    }
    return false;
  }

  saveAll() {
    for (const f of this.files) save(f);
    writeJson(`${this.name}-pools.json`, { net: this.name, updated: new Date().toISOString(), factories: this.cfg.factories, pools: this.opened });
  }

  async title(index: number): Promise<string | null> {
    if (this.titles.has(index)) return this.titles.get(index)!;
    let t: string | null = null;
    try {
      const r = await fetch(this.cfg.subsquare + index, { signal: AbortSignal.timeout(8000) });
      if (r.ok) { const j: any = await r.json(); t = typeof j?.title === "string" && j.title.trim() ? j.title.trim().slice(0, 200) : null; }
      this.titles.set(index, t);
    } catch {}
    return t;
  }

  // The terms of every ongoing referendum, read the way ref-terms.ts reads one.
  async readReferenda() {
    const api = this.api;
    const [relay, now, entries] = await Promise.all([
      api.query.parachainSystem.lastRelayChainBlockNumber(), api.query.timestamp.now(), api.query.referenda.referendumInfoFor.entries(),
    ]);
    const relayNow = (relay as any).toNumber(), nowSec = Number((now as any).toBigInt() / 1000n);
    const undeciding = (api.consts.referenda.undecidingTimeout as any).toNumber();
    const tracks = new Map<number, { name: string; deposit: bigint }>();
    for (const [id, t] of api.consts.referenda.tracks as any)
      tracks.set(id.toNumber(), { name: String(t.name.toHuman?.() ?? t.name).replace(/\0+$/, "").trim(), deposit: t.decisionDeposit.toBigInt() });
    const pooled = new Set(this.opened.map((o) => o.referendum));
    const out: any[] = [];
    for (const [key, value] of entries as any) {
      const index = key.args[0].toNumber();
      if (value.isNone) continue;
      const i = value.unwrap();
      if (!i.isOngoing) { if (pooled.has(index)) out.push({ index, status: i.type.toLowerCase() }); continue; }
      const o = i.asOngoing, track = tracks.get(o.track.toNumber())!;
      const timeoutRelay = o.submitted.toNumber() + undeciding;
      const timeoutSec = nowSec + (timeoutRelay - relayNow) * RELAY_BLOCK_SECONDS;
      out.push({
        index, status: "ongoing", track: o.track.toNumber(), trackName: track.name, depositPlanck: track.deposit.toString(),
        hasDecisionDeposit: o.decisionDeposit.isSome, decisionDepositBy: o.decisionDeposit.isSome ? o.decisionDeposit.unwrap().who.toString() : null,
        deciding: o.deciding.isSome, submittedRelay: o.submitted.toNumber(), timeoutRelay,
        pastTimeout: !o.decisionDeposit.isSome && timeoutRelay <= relayNow,
        timeoutEstimate: timeoutSec, fundingDeadline: timeoutSec + MARGIN_SECONDS,
        title: !o.decisionDeposit.isSome || pooled.has(index) ? await this.title(index) : null,
      });
    }
    out.sort((a, b) => b.index - a.index);
    this.referenda = { net: this.name, updated: new Date().toISOString(), relayNow, chainNow: nowSec, relayBlockSeconds: RELAY_BLOCK_SECONDS,
      marginSeconds: MARGIN_SECONDS, referenda: out };
    writeJson(`${this.name}-referenda.json`, this.referenda);
    this.checkPools(tracks);
    this.saveAll();
  }

  // A factory pool is listed only if its deposit is its referendum's track deposit. The
  // contract cannot check this, and a wrong one only fills, never places, and repays. The
  // check freezes once the referendum stops being ongoing, because its track is then gone.
  checkPools(tracks: Map<number, { name: string; deposit: bigint }>) {
    const byIndex = new Map(this.referenda.referenda.map((r: any) => [r.index, r]));
    for (const o of this.opened) {
      if (o.check?.frozen && o.check.v === 2) continue;
      const r: any = byIndex.get(o.referendum);
      const reasons: string[] = [];
      if (!r) reasons.push(`#${o.referendum} does not exist on ${this.name}`);
      else if (r.status !== "ongoing") {
        if (o.check) { o.check.frozen = true; continue; }
        reasons.push(`#${o.referendum} had already ended (${r.status}) when the page first saw the pool`);
      } else {
        const units = (p: string) => `${(Number(p) / 10 ** this.cfg.decimals).toLocaleString("en-GB", { maximumFractionDigits: 4 })} ${this.cfg.symbol}`;
        if (BigInt(o.depositPlanck) !== BigInt(r.depositPlanck))
          reasons.push(`its deposit is ${units(o.depositPlanck)} but the ${r.trackName.replace(/_/g, " ")} track needs ${units(r.depositPlanck)}, so it can fill but never place`);
        if (o.fundingDeadline < r.timeoutEstimate - 6 * 3600)
          reasons.push(`funding closes more than six hours before the referendum's timeout`);
      }
      o.check = { v: 2, ok: reasons.length === 0, reasons, at: new Date().toISOString(), ...(r && r.status !== "ongoing" ? { frozen: true } : {}) };
    }
  }
}

const nets: Net[] = [];
for (const [name, cfg] of Object.entries(NETS)) {
  const api = await ApiPromise.create({ provider: new WsProvider(cfg.ws), noInitWarn: true });
  const net = new Net(name, cfg, api);
  nets.push(net);
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const head = (await api.rpc.chain.getHeader(await api.rpc.chain.getFinalizedHead())).number.toNumber();
      for (let i = 0; i < 50 && (await net.scan(head)); i++);
      net.saveAll();
      if (Date.now() - net.lastReferenda > REFERENDA_EVERY_MS) { await net.readReferenda(); net.lastReferenda = Date.now(); }
    } catch (e) { console.error(`${name}: tick failed:`, (e as Error).message); }
    busy = false;
  };
  await tick();
  if (ONCE) { await api.disconnect(); continue; }
  setInterval(tick, 12_000);
}
