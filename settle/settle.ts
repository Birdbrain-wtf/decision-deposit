// Birdbrain's backstop for a pool that never filled: after the funding deadline, if nobody
// has closed the pool and paid everyone back, this does it. Safe to run repeatedly, and it
// does nothing when someone else got there first. Anyone can do the same from the page.
//
//   bun settle.ts <kusama|paseo> <pool> <key file> [--dry-run]
//
// The key only pays fees: it has no power over the pool. A full pool is never closed,
// because abandon() would still accept it and the deposit could yet be placed.
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";

const NETS = {
  kusama: { id: 420420418, rpc: "https://eth-rpc-kusama.polkadot.io", symbol: "KSM" },
  paseo: { id: 420420417, rpc: "https://eth-rpc-testnet.polkadot.io", symbol: "PAS" },
} as const;

const ABI = parseAbi([
  "function state() view returns (uint8)",
  "function total() view returns (uint256)",
  "function deposit() view returns (uint256)",
  "function fundingDeadline() view returns (uint64)",
  "function contributorCount() view returns (uint256)",
  "function abandon()",
  "function payout(uint256 from, uint256 to)",
]);
const OPEN = 0, RETURNING = 2;

export type Read = { state: number; total: bigint; deposit: bigint; deadline: bigint; count: bigint; now: bigint };
export function decide(r: Read): "wait" | "full-not-placed" | "abandon" | "payout" | "nothing" {
  if (r.state === OPEN) {
    if (r.now < r.deadline) return "wait";
    return r.total >= r.deposit ? "full-not-placed" : "abandon";
  }
  return r.state === RETURNING && r.total > 0n ? "payout" : "nothing";
}

if (import.meta.main) {
  const [netName, pool, keyFile] = process.argv.slice(2) as [keyof typeof NETS, Hex, string];
  const dry = process.argv.includes("--dry-run");
  const net = NETS[netName];
  if (!net || !pool || !keyFile) throw new Error("usage: bun settle.ts <kusama|paseo> <pool> <key file> [--dry-run]");
  const chain = defineChain({ id: net.id, name: netName, nativeCurrency: { name: net.symbol, symbol: net.symbol, decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } });
  const pub = createPublicClient({ chain, transport: http() });
  const account = privateKeyToAccount(readFileSync(keyFile, "utf8").trim() as Hex);
  const wallet = createWalletClient({ account, chain, transport: http() });
  const view = <T>(functionName: any) => pub.readContract({ address: pool, abi: ABI, functionName }) as Promise<T>;
  const log = (m: string) => console.log(new Date().toISOString(), m);
  const read = async (): Promise<Read> => ({
    state: Number(await view<number>("state")), total: await view<bigint>("total"), deposit: await view<bigint>("deposit"),
    deadline: BigInt(await view<bigint>("fundingDeadline")), count: await view<bigint>("contributorCount"),
    now: (await pub.getBlock()).timestamp,
  });
  const send = async (functionName: "abandon" | "payout", args: readonly bigint[] = []) => {
    const price = await pub.getGasPrice();
    const hash = await wallet.writeContract({ address: pool, abi: ABI, functionName: functionName as any, args: args as any });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    log(`${functionName} ${rc.status} tx ${hash} gas ${rc.gasUsed} at price ${rc.effectiveGasPrice ?? price}: ${formatEther(rc.gasUsed * (rc.effectiveGasPrice ?? price))} ${net.symbol}`);
    if (rc.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  };

  log(`${netName} pool ${pool}, fee account ${account.address} holds ${formatEther(await pub.getBalance({ address: account.address }))} ${net.symbol}`);
  for (let step = 0; step < 3; step++) {
    const r = await read();
    const next = decide(r);
    log(`state ${r.state}, owed ${formatEther(r.total)} of ${formatEther(r.deposit)} ${net.symbol}, ${r.count} entries: ${next}`);
    if (next === "wait" || next === "nothing") break;
    if (next === "full-not-placed") { log("FULL BUT NOT PLACED: needs a person, nothing sent"); process.exitCode = 2; break; }
    if (dry) { log(`dry run: would send ${next}`); break; }
    if (next === "abandon") await send("abandon"); else await send("payout", [0n, r.count]);
  }
  const end = await read();
  if (decide(end) === "payout") { log(`STILL OWED ${formatEther(end.total)} ${net.symbol} after payout: a contributor refused payment and keeps a claim`); }
}
