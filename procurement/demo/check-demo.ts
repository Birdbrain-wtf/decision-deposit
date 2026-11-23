// Read a demo deployment back from the chain and, on Paseo only, place one test bid.
//   bun check-demo.ts <paseo|kusama> [--bid]
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { NETWORKS, type Net } from "../../networks";
const net = process.argv[2] as Net; const N = NETWORKS[net];
const rec = JSON.parse(readFileSync(new URL(`./${net}.json`, import.meta.url), "utf8"));
const chain = defineChain({ id: N.chainId, name: N.name, nativeCurrency: { name: N.symbol, symbol: N.symbol, decimals: 18 }, rpcUrls: { default: { http: [N.eth] } } });
const pub = createPublicClient({ chain, transport: http() });
const P = parseAbi(["function asset() view returns (address)","function buyer() view returns (address)","function state() view returns (uint8)","function ceiling() view returns (uint256)","function bidClose() view returns (uint64)","function specification() view returns (bytes32)","function bids(address) view returns (uint256,bytes32)","function bid(uint256,bytes32)"]);
const A = parseAbi(["function name() view returns (string)","function symbol() view returns (string)","function totalSupply() view returns (uint256)","function balanceOf(address) view returns (uint256)"]);
const t = rec.tender.address as Hex, a = rec.asset.address as Hex;
const r = async (address: Hex, abi: any, functionName: string, args: any[] = []) => pub.readContract({ address, abi, functionName, args } as any);
console.log({ asset: await r(t, P, "asset"), buyer: await r(t, P, "buyer"), state: await r(t, P, "state"), ceiling: await r(t, P, "ceiling"),
  bidClose: new Date(Number(await r(t, P, "bidClose")) * 1000).toISOString(), spec: await r(t, P, "specification"),
  assetName: await r(a, A, "name"), assetSymbol: await r(a, A, "symbol"), supply: await r(a, A, "totalSupply"), tenderBalance: await r(a, A, "balanceOf", [t]) });
if (process.argv.includes("--bid")) {
  if (net !== "paseo") throw new Error("test bids on paseo only");
  const alice = privateKeyToAccount(readFileSync(`${process.env.KEYS ?? "keys"}/paseo-alice.key`, "utf8").trim() as Hex);
  const w = createWalletClient({ account: alice, chain, transport: http() });
  const hash = await w.writeContract({ address: t, abi: P, functionName: "bid", args: [5_000_000_000n, ("0x" + "ab".repeat(32)) as Hex] });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
  console.log("bid", rc.status, hash, await r(t, P, "bids", [alice.address]));
}
