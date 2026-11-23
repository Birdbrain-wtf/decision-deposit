// Unfunded mainnet demonstration of the procurement contract.
//   bun deploy-demo.ts <paseo|kusama> [--mainnet]
// Deploys DemoPlaceholderAsset (zero supply, transfers always fail) and one Procurement tender
// pointed at it. The tender can take bids and an award but can never be funded. Not dUSD.
import solc from "solc";
import { createPublicClient, createWalletClient, http, defineChain, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { NETWORKS, type Net } from "../../networks";

const net = process.argv[2] as Net;
const N = NETWORKS[net];
if (!N || net === "polkadot") throw new Error("network: paseo | kusama");
if (net !== "paseo" && !process.argv.includes("--mainnet")) throw new Error("real network: add --mainnet");
const here = (p: string) => new URL(p, import.meta.url).pathname;
const src = (f: string) => readFileSync(here("../src/" + f), "utf8");
const input = {
  language: "Solidity",
  sources: { "Procurement.sol": { content: src("Procurement.sol") }, "DemoPlaceholderAsset.sol": { content: src("DemoPlaceholderAsset.sol") } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: (p: string) => ({ contents: src(p.replace("./", "")) }) }));
for (const e of out.errors ?? []) if (e.severity === "error") throw new Error(e.formattedMessage);
writeFileSync(here("standard-input.json"), JSON.stringify(input));
const art = (f: string, n: string) => ({ abi: out.contracts[f][n].abi, bytecode: ("0x" + out.contracts[f][n].evm.bytecode.object) as Hex });
const A = art("DemoPlaceholderAsset.sol", "DemoPlaceholderAsset"), P = art("Procurement.sol", "Procurement");
const sha = (h: string) => createHash("sha256").update(h).digest("hex");

const RECORD = here(`${net}.json`);
if (existsSync(RECORD)) throw new Error("already deployed on " + net + ": " + RECORD);
const chain = defineChain({ id: N.chainId, name: N.name, nativeCurrency: { name: N.symbol, symbol: N.symbol, decimals: 18 }, rpcUrls: { default: { http: [N.eth] } } });
const pub = createPublicClient({ chain, transport: http() });
const account = privateKeyToAccount(readFileSync(`${process.env.KEYS ?? "keys"}/${net}-deployer.key`, "utf8").trim() as Hex);
const wallet = createWalletClient({ account, chain, transport: http() });

const spec = keccak256(toHex(readFileSync(here("../README.md"), "utf8")));
const now = BigInt(Math.floor(Date.now() / 1000));
const day = 86400n;
const ceiling = 10_000n * 1_000_000n;                         // 10,000 units at 6 decimals, nominal only
const bidClose = now + 14n * day, activationClose = now + 21n * day, review = 7n * day;

const deploy = async (c: { abi: any; bytecode: Hex }, args: any[]) => {
  const hash = await wallet.deployContract({ abi: c.abi, bytecode: c.bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error("deploy failed " + hash);
  return { address: rc.contractAddress, tx: hash, block: Number(rc.blockNumber), gasUsed: rc.gasUsed.toString(), bytecodeSha256: sha(c.bytecode) };
};
const before = await pub.getBalance({ address: account.address });
const asset = await deploy(A, []);
console.log("placeholder asset", asset.address, asset.tx);
const args = [asset.address, account.address, account.address, spec, ceiling, bidClose, activationClose, review];
const tender = await deploy(P, args);
console.log("tender", tender.address, tender.tx);
const after = await pub.getBalance({ address: account.address });
const rec = {
  network: net, purpose: "unfunded demonstration: placeholder asset, can never be funded, not dUSD",
  compiler: "solc " + solc.version(), deployer: account.address, at: new Date().toISOString(),
  costKsmOrPas: Number(before - after) / 1e18,
  asset, tender: { ...tender, buyer: account.address, reviewer: account.address, resolver: account.address, specification: spec,
    specificationSource: "lab/decision-deposit/procurement/README.md at deploy time", ceiling: ceiling.toString(),
    bidClose: Number(bidClose), activationClose: Number(activationClose), reviewPeriod: Number(review) },
};
writeFileSync(RECORD, JSON.stringify(rec, null, 2) + "\n");
console.log(JSON.stringify(rec, null, 2));
