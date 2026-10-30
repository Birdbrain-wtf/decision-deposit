// Deploy a pool from Birdbrain's EVM deployer, and record it in deployments/<net>.json.
// The deployer only pays the fee: the pool has no owner, so the key has no power over it.
//
//   bun deploy.ts <net> key
//   bun deploy.ts <net> pool <referendum> <deposit> <min> <deadline ISO> <label> [--mainnet]
//
// Amounts in whole units (KSM or PAS). Kusama needs --mainnet. Then: bun verify.ts.
import { createPublicClient, createWalletClient, http, defineChain, encodeDeployData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { NETWORKS, type Net } from "./networks";

const [net, cmd, ...a] = process.argv.slice(2) as [Net, string, ...string[]];
const N = NETWORKS[net];
if (!N) throw new Error("network: kusama | paseo");
const KEYS = (process.env.KEYS ?? "keys") + "/";
const RECORD = new URL(`./deployments/${net}.json`, import.meta.url).pathname;
const chain = defineChain({ id: N.chainId, name: N.name, nativeCurrency: { name: N.symbol, symbol: N.symbol, decimals: 18 }, rpcUrls: { default: { http: [N.eth] } } });
const pub = createPublicClient({ chain, transport: http() });
const art = JSON.parse(readFileSync(new URL("./build/DecisionDepositPool.json", import.meta.url), "utf8"));

function key(name: string) {
  const f = KEYS + `${net}-${name}.key`;
  if (!existsSync(f)) writeFileSync(f, generatePrivateKey() + "\n", { mode: 0o600 });
  return privateKeyToAccount(readFileSync(f, "utf8").trim() as Hex);
}
const units = (x: string) => {
  const [w, f = ""] = x.split(".");
  return BigInt(w) * N.planckPerUnit + BigInt(f.padEnd(String(N.planckPerUnit).length - 1, "0"));
};

if (cmd === "key") {
  const names = net === "paseo" ? ["deployer", "alice", "bob"] : ["deployer"];
  for (const n of names) { const k = key(n); console.log(n, k.address, Number(await pub.getBalance({ address: k.address })) / 1e18, N.symbol); }
} else if (cmd === "pool") {
  const [ref, dep, min, deadlineIso, label] = a;
  if (net === "kusama" && !a.includes("--mainnet")) throw new Error("Kusama is real money: add --mainnet");
  const deadline = BigInt(Math.floor(Date.parse(deadlineIso) / 1000));
  if (!deadline) throw new Error("deadline must be an ISO date");
  const args = [Number(ref), units(dep), units(min), deadline, N.referendaPallet, N.place, N.refund, N.weiPerPlanck] as const;
  console.log(`${N.name}: pool for #${ref}, deposit ${args[1]} planck, min ${args[2]}, deadline ${new Date(Number(deadline) * 1000).toISOString()}`);
  const deployer = key("deployer");
  const wallet = createWalletClient({ account: deployer, chain, transport: http() });
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error("deploy failed " + hash);
  const r = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : { network: net, pools: [], referenda: [] };
  r.pools.push({ label, address: rc.contractAddress, referendum: Number(ref), depositPlanck: String(args[1]), minPlanck: String(args[2]),
    fundingDeadline: Number(deadline), deployTx: hash, deployer: deployer.address, compiler: art.compiler,
    constructorArgs: encodeDeployData({ abi: art.abi, bytecode: "0x", args }).slice(2), at: new Date().toISOString() });
  writeFileSync(RECORD, JSON.stringify(r, null, 2) + "\n");
  console.log("pool", rc.contractAddress, "tx", hash);
  console.log(`next: bun verify.ts ${net} ${rc.contractAddress} ${r.pools.at(-1).constructorArgs}`);
} else console.log("usage: bun deploy.ts <kusama|paseo> key | pool <ref> <deposit> <min> <deadlineISO> <label> [--mainnet]");
