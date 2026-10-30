// A minimal stand-in for Asset Hub's Ethereum RPC server, over the chopsticks fork,
// so the contribute page can be driven in a real browser. Only the methods the page
// and the injected test wallet use. eth_sendTransaction signs with the fixed test
// wallets from lib.ts (a real wallet signs itself and sends eth_sendRawTransaction).
//
//   bun ui-test/eth-shim.ts            listens on 127.0.0.1:8545, fork on :8010
import { connect, wallets, evmBalance, ethSend, type Wallet } from "../lib";
import type { Hex } from "viem";

const api = await connect();
const CHAIN_ID = 420420418;
const byAddr = new Map<string, Wallet>(Object.values(wallets()).map((w) => [w.address.toLowerCase(), w]));
const receipts = new Map<string, any>();
let n = 0;

function generic(t: any) {
  return { from: t.from ?? wallets().dave.address, to: t.to ?? null, input: { input: t.data ?? t.input ?? "0x", data: null },
    value: BigInt(t.value ?? 0), authorizationList: [], blobVersionedHashes: [], blobs: [] };
}

class Revert extends Error { constructor(public data: string, msg = "execution reverted") { super(msg); } }

async function dry(t: any) {
  const res: any = await (api.call as any).reviveApi.ethTransact(generic(t));
  if (res.isErr) {
    const e = res.asErr;
    if (e.isData) throw new Revert(e.asData.toHex());
    throw new Error(e.asMessage.toString());
  }
  return res.asOk;
}

const methods: Record<string, (p: any[]) => Promise<any>> = {
  eth_chainId: async () => "0x" + CHAIN_ID.toString(16),
  net_version: async () => String(CHAIN_ID),
  eth_blockNumber: async () => "0x" + ((await api.rpc.chain.getHeader()) as any).number.toNumber().toString(16),
  eth_getBlockByNumber: async () => {
    const t = ((await api.query.timestamp.now()) as any).toBigInt() / 1000n;
    return { number: await methods.eth_blockNumber([]), timestamp: "0x" + t.toString(16) };
  },
  eth_gasPrice: async () => "0x" + ((await (api.call as any).reviveApi.gasPrice()) as any).toBigInt().toString(16),
  eth_getBalance: async ([a]) => "0x" + (await evmBalance(api, a)).toString(16),
  eth_getTransactionCount: async ([a]) => "0x" + ((await (api.call as any).reviveApi.nonce(a)) as any).toNumber().toString(16),
  eth_getCode: async ([a]) => {
    // A cheap existence check: a contract answers a dry-run call to a view.
    const ok: any = await (api.call as any).reviveApi.ethTransact(generic({ to: a, data: "0xc19d93fb" }));
    return ok.isOk && ok.asOk.data.toHex() !== "0x" ? "0x01" : "0x";
  },
  eth_call: async ([t]) => (await dry(t)).data.toHex(),
  eth_estimateGas: async ([t]) => "0x" + ((await dry(t)).ethGas.toBigInt() * 13n / 10n).toString(16),
  eth_sendTransaction: async ([t]) => {
    const w = byAddr.get(String(t.from).toLowerCase());
    if (!w) throw new Error("unknown test account " + t.from);
    const r = await ethSend(api, w, t.to as Hex, (t.data ?? "0x") as Hex, BigInt(t.value ?? 0));
    const hash = "0x" + (++n).toString(16).padStart(64, "0");
    receipts.set(hash, { transactionHash: hash, status: r.ok ? "0x1" : "0x0", blockNumber: await methods.eth_blockNumber([]), logs: [], error: r.ok ? undefined : r.error });
    if (!r.ok) console.log("tx failed", t.data?.slice(0, 10), r.error);
    return hash;
  },
  eth_getTransactionReceipt: async ([h]) => receipts.get(h) ?? null,
};

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 8545),
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const j: any = await req.json();
    const reply = (body: any) => Response.json({ jsonrpc: "2.0", id: j.id, ...body }, { headers: cors });
    const f = methods[j.method];
    if (!f) return reply({ error: { code: -32601, message: "method not found: " + j.method } });
    try { return reply({ result: await f(j.params ?? []) }); }
    catch (e: any) { return reply({ error: { code: e instanceof Revert ? 3 : -32000, message: e.message, data: e.data } }); }
  },
});
console.log("eth shim on 127.0.0.1:" + (process.env.PORT ?? 8545));
