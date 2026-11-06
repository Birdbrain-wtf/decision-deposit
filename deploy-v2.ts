// Version 2: deploy the factory once per chain, then open pools through it.
//
//   bun deploy-v2.ts <net> factory [--mainnet]
//   bun deploy-v2.ts <net> open <referendum> <min> <sweepTo 0x…> <label> [--mainnet]
//
// `open` reads the deposit and funding close from the live referendum (ref-terms.ts),
// never from the command line. Records go to deployments/<net>-v2.json.
// Kusama is real money: both commands need --mainnet, and version 2 must be announced in
// the forum thread (t/19187) before anyone is asked to pay into a v2 pool.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { createPublicClient, createWalletClient, http, defineChain, encodeDeployData, decodeEventLog, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { NETWORKS, type Net } from "./networks";
import { termsFor } from "./ref-terms";

const [net, cmd, ...a] = process.argv.slice(2) as [Net, string, ...string[]];
const N = NETWORKS[net];
if (!N) throw new Error("network: kusama | paseo");
if (net === "kusama" && !a.includes("--mainnet")) throw new Error("Kusama is real money: add --mainnet");
const KEYS = (process.env.KEYS ?? "keys") + "/";
const RECORD = new URL(`./deployments/${net}-v2.json`, import.meta.url).pathname;
const chain = defineChain({ id: N.chainId, name: N.name, nativeCurrency: { name: N.symbol, symbol: N.symbol, decimals: 18 }, rpcUrls: { default: { http: [N.eth] } } });
const pub = createPublicClient({ chain, transport: http() });
const art = (n: string) => JSON.parse(readFileSync(new URL(`./build/v2/${n}.json`, import.meta.url), "utf8"));
const deployer = privateKeyToAccount(readFileSync(KEYS + `${net}-deployer.key`, "utf8").trim() as Hex);
const wallet = createWalletClient({ account: deployer, chain, transport: http() });
const rec = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : { network: net, version: 2, factory: null, pools: [] };
const save = () => writeFileSync(RECORD, JSON.stringify(rec, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");

if (cmd === "factory") {
  if (rec.factory) throw new Error("factory already deployed: " + rec.factory.address);
  const F = art("DecisionDepositPoolFactory");
  const args = [N.referendaPallet, N.place, N.refund, N.weiPerPlanck] as const;
  const hash = await wallet.deployContract({ abi: F.abi, bytecode: F.bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error("deploy failed " + hash);
  rec.factory = { address: rc.contractAddress, deployTx: hash, block: Number(rc.blockNumber), compiler: F.compiler,
    constructorArgs: encodeDeployData({ abi: F.abi, bytecode: "0x", args }).slice(2), at: new Date().toISOString() };
  save();
  console.log("factory", rc.contractAddress, "tx", hash);
} else if (cmd === "open") {
  const [ref, min, sweepTo, label] = a;
  if (!rec.factory) throw new Error("no factory on " + net);
  const api = await ApiPromise.create({ provider: new WsProvider(N.ws), noInitWarn: true });
  const t = await termsFor(api, net, Number(ref));
  await api.disconnect();
  if (t.warnings.length) throw new Error(t.warnings.join("; "));
  const minPlanck = BigInt(Math.round(Number(min) * Number(N.planckPerUnit)));
  console.log(`#${ref} track ${t.track}: deposit ${t.deposit}, closes ${t.fundingDeadlineIso} (timeout ~${t.timeoutEstimate})`);
  const F = art("DecisionDepositPoolFactory");
  const hash = await wallet.writeContract({ address: rec.factory.address, abi: F.abi, functionName: "open",
    args: [Number(ref), t.depositPlanck, minPlanck, t.fundingDeadline, sweepTo as Hex] });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rc.status !== "success") throw new Error("open failed " + hash);
  const ev = rc.logs.map((l) => { try { return decodeEventLog({ abi: F.abi, data: l.data, topics: l.topics }) as any; } catch { return null; } }).find((e) => e?.eventName === "PoolOpened");
  rec.pools.push({ label, address: ev.args.pool, referendum: Number(ref), track: t.track, depositPlanck: t.depositPlanck, minPlanck,
    fundingDeadline: t.fundingDeadline, sweepTo, openTx: hash, block: Number(rc.blockNumber), at: new Date().toISOString() });
  save();
  console.log("pool", ev.args.pool, "tx", hash);
} else console.log("usage: bun deploy-v2.ts <net> factory | open <ref> <min> <sweepTo> <label>  [--mainnet on kusama]");
