// Birdbrain's backstop. If nobody else has done it, this closes a pool that never filled
// and pays everyone back, and once a placed referendum has ended it brings the deposit back
// and pays everyone back. For a version 2 pool it then returns KSM nobody is owed (sent by
// plain transfer) to the pool's sweepTo. Safe to run repeatedly, and it does nothing when
// someone else got there first. Anyone can do the same from the page.
//
//   bun settle.ts <kusama|polkadot|paseo> <pool> <key file> [--dry-run]
//   bun settle.ts <kusama|polkadot|paseo> all <key file> [--dry-run]
//
// `all` settles the pools named below (the version 1 pools, and our own Paseo test pool with
// a wrong deposit, which fails the check on purpose) plus every pool the indexer has found
// through a factory and checked against its referendum (POOLS_FILE, default
// /var/lib/cdd-indexer/events/<net>-pools.json). A pool that failed the check is not
// ours to spend fees on: its contributors can still close and refund it from the page.
// One pool's trouble never stops the others.
//
// The key only pays fees: it has no power over the pool. A full pool is never closed,
// because abandon() would still accept it and the deposit could yet be placed. A killed
// referendum sends nothing, because its deposit is gone and reclaim() can only revert.
// CDD_ETH_RPC and CDD_SUB_RPC override the endpoints, for a rehearsal against a fork.
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { blake2b } from "@noble/hashes/blake2.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const NETS = {
  kusama: { id: 420420418, rpc: "https://eth-rpc-kusama.polkadot.io", sub: "https://kusama-asset-hub-rpc.polkadot.io", symbol: "KSM",
    named: ["0x4d8b316355ee2d334ef3494be1fa3ef8c7114c87", "0xfcd8058e46b8ac6f02f1cc71e2912c5ffdc095ce"] as string[] },
  polkadot: { id: 420420419, rpc: "https://eth-rpc.polkadot.io", sub: "https://polkadot-asset-hub-rpc.polkadot.io", symbol: "DOT",
    named: [] as string[] },
  paseo: { id: 420420417, rpc: "https://eth-rpc-testnet.polkadot.io", sub: "https://asset-hub-paseo-rpc.n.dwellir.com", symbol: "PAS",
    named: ["0x184d34bde215cd345d48df7dfc89df9832317b4a"] as string[] },
} as const;

const ABI = parseAbi([
  "function state() view returns (uint8)",
  "function total() view returns (uint256)",
  "function deposit() view returns (uint256)",
  "function fundingDeadline() view returns (uint64)",
  "function contributorCount() view returns (uint256)",
  "function referendum() view returns (uint32)",
  "function abandon()",
  "function reclaim()",
  "function payout(uint256 from, uint256 to)",
  "function excess() view returns (uint256)",
  "function sweep()",
]);
const OPEN = 0, PLACED = 1, RETURNING = 2;

// Referenda.ReferendumInfoFor, whose value starts with the variant of the referendum's enum.
const REFERENDUM_INFO = "0f6738a0ee80c8e74cd2c7417c1e25569613e9bbc07e304aa9a1af9b85898e5a";
const ENDINGS = ["ongoing", "ended", "ended", "ended", "ended", "killed"] as const; // Ongoing, Approved, Rejected, Cancelled, TimedOut, Killed
export type Referendum = (typeof ENDINGS)[number] | "unknown";
export function referendumKey(index: number): string {
  const le = new Uint8Array(new Uint32Array([index]).buffer);
  const hex = (u: Uint8Array) => Array.from(u, (x) => x.toString(16).padStart(2, "0")).join("");
  return "0x" + REFERENDUM_INFO + hex(blake2b(le, { dkLen: 16 })) + hex(le);
}
export function referendumFrom(value: string | null): Referendum {
  if (!value) return "unknown";
  return ENDINGS[parseInt(value.slice(2, 4), 16)] ?? "unknown";
}

export type Read = { state: number; total: bigint; deposit: bigint; deadline: bigint; count: bigint; now: bigint; referendum?: Referendum; refused?: bigint; excess?: bigint };
export type Next = "wait" | "full-not-placed" | "abandon" | "reclaim" | "killed" | "unknown-referendum" | "payout" | "sweep" | "refused" | "nothing";
export function decide(r: Read): Next {
  if (r.state === OPEN) {
    if (r.now < r.deadline) return "wait";
    return r.total >= r.deposit ? "full-not-placed" : "abandon";
  }
  if (r.state === PLACED) {
    if (r.referendum === "ongoing") return "wait";
    if (r.referendum === "ended") return "reclaim";
    return r.referendum === "killed" ? "killed" : "unknown-referendum";
  }
  if (r.state !== RETURNING) return "nothing";
  if (r.total > 0n && r.total !== r.refused) return "payout";
  // Only after everyone who can be repaid has been: sweep never touches what is owed.
  if (r.excess && r.excess > 0n) return "sweep";
  return r.total === 0n ? "nothing" : "refused";
}

// The pools `all` settles: those named here, then version 2 pools only once the indexer has checked them.
export function poolsToSettle(named: readonly string[], file: { pools?: { address: string; check?: { ok: boolean } }[] } | null): string[] {
  const out = [...named.map((a) => a.toLowerCase())];
  for (const p of file?.pools || []) if (p.check?.ok && !out.includes(p.address.toLowerCase())) out.push(p.address.toLowerCase());
  return out;
}

if (import.meta.main) {
  const [netName, which, keyFile] = process.argv.slice(2) as [keyof typeof NETS, string, string];
  const dry = process.argv.includes("--dry-run");
  const net = NETS[netName];
  if (!net || !which || !keyFile) throw new Error("usage: bun settle.ts <kusama|polkadot|paseo> <pool|all> <key file> [--dry-run]");
  const chain = defineChain({ id: net.id, name: netName, nativeCurrency: { name: net.symbol, symbol: net.symbol, decimals: 18 }, rpcUrls: { default: { http: [process.env.CDD_ETH_RPC || net.rpc] } } });
  const stateDir = process.env.STATE_DIRECTORY || "/var/lib/cdd-settle";
  const pub = createPublicClient({ chain, transport: http(undefined, { timeout: 60_000 }) });
  const account = privateKeyToAccount(readFileSync(keyFile, "utf8").trim() as Hex);
  const wallet = createWalletClient({ account, chain, transport: http(undefined, { timeout: 60_000 }) });
  const log = (m: string) => console.log(new Date().toISOString(), m);

  const settle = async (pool: Hex) => {
    const refusedFile = `${stateDir}/${pool.toLowerCase()}.refused`;
    const view = <T>(functionName: any) => pub.readContract({ address: pool, abi: ABI, functionName }) as Promise<T>;
    const referendum = async (): Promise<Referendum> => {
      const res = await fetch(process.env.CDD_SUB_RPC || net.sub, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "state_getStorage", params: [referendumKey(Number(await view<number>("referendum")))] }),
      });
      const j: any = await res.json();
      if (j.error) throw new Error(j.error.message);
      return referendumFrom(j.result);
    };
    const read = async (): Promise<Read> => {
      const state = Number(await view<number>("state"));
      return {
        state, total: await view<bigint>("total"), deposit: await view<bigint>("deposit"),
        deadline: BigInt(await view<bigint>("fundingDeadline")), count: await view<bigint>("contributorCount"),
        now: (await pub.getBlock()).timestamp,
        referendum: state === PLACED ? await referendum() : undefined,
        refused: existsSync(refusedFile) ? BigInt(readFileSync(refusedFile, "utf8").trim()) : undefined,
        // Version 1 has no excess(): the call reverts and the pool is treated as having none.
        excess: state === RETURNING ? await view<bigint>("excess").catch(() => undefined) : undefined,
      };
    };
    const send = async (functionName: "abandon" | "reclaim" | "payout" | "sweep", args: readonly bigint[] = []) => {
      // Same margin and transaction type as the fork rehearsal. A revert here throws before anything is sent.
      const request = { address: pool, abi: ABI, functionName: functionName as any, args: args as any, account };
      const gas = (await pub.estimateContractGas(request)) * 13n / 10n;
      const gasPrice = await pub.getGasPrice();
      const hash = await wallet.writeContract({ ...request, gas, gasPrice, type: "legacy" });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
      log(`${functionName} ${rc.status} tx ${hash} gas ${rc.gasUsed} at price ${rc.effectiveGasPrice ?? gasPrice}: ${formatEther(rc.gasUsed * (rc.effectiveGasPrice ?? gasPrice))} ${net.symbol}`);
      if (rc.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    };

    log(`${netName} pool ${pool}`);
    for (let step = 0; step < 5; step++) {
      const r = await read();
      const next = decide(r);
      log(`state ${r.state}${r.referendum ? `, referendum ${r.referendum}` : ""}, owed ${formatEther(r.total)} of ${formatEther(r.deposit)} ${net.symbol}, ${r.count} entries${r.excess ? `, ${formatEther(r.excess)} nobody is owed` : ""}: ${next}`);
      if (next === "wait" || next === "nothing") break;
      if (next === "full-not-placed") { log("FULL BUT NOT PLACED: needs a person, nothing sent"); process.exitCode = 2; break; }
      if (next === "killed") { log("REFERENDUM KILLED: the deposit is gone and reclaim cannot succeed, nothing sent"); process.exitCode = 2; break; }
      if (next === "unknown-referendum") { log("REFERENDUM NOT READABLE: needs a person if this repeats, nothing sent"); process.exitCode = 2; break; }
      if (next === "refused") { log(`STILL OWED ${formatEther(r.total)} ${net.symbol}: a contributor refused payment and keeps a claim, not paying fees to retry`); break; }
      if (dry) { log(`dry run: would send ${next}`); break; }
      if (next === "abandon") await send("abandon");
      else if (next === "reclaim") await send("reclaim");
      else if (next === "sweep") await send("sweep");
      else {
        await send("payout", [0n, r.count]);
        const owed = await view<bigint>("total");
        // An hourly job must not spend fees for ever on an address that refuses payment.
        if (owed > 0n) { mkdirSync(stateDir, { recursive: true }); writeFileSync(refusedFile, owed.toString()); }
      }
    }
  };

  log(`${netName}, fee account ${account.address} holds ${formatEther(await pub.getBalance({ address: account.address }))} ${net.symbol}`);
  let pools: string[];
  if (which === "all") {
    const file = process.env.POOLS_FILE || `/var/lib/cdd-indexer/events/${netName}-pools.json`;
    pools = poolsToSettle(net.named, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
    if (!existsSync(file)) log(`no ${file}: only the named pools`);
  } else pools = [which];
  for (const p of pools) {
    try { await settle(p as Hex); }
    catch (e) { log(`FAILED ${p}: ${(e as Error).message.split("\n")[0]}`); process.exitCode = 2; }
  }
}
