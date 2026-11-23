// Deploy one more unfunded tender on the existing placeholder asset, committed to a given specification.
//   bun deploy-tender.ts <paseo|kusama> <slug> --spec <file> --ceiling <whole units> --bid-close <ISO> --award-by <ISO> [--review-days 7] [--mainnet]
// Reuses demo/<net>.json's placeholder asset ("NOT dUSD", zero supply), so the tender can take bids and an award
// but can never be funded. Buyer, reviewer and resolver are Birdbrain's deployer. Record: tenders/<slug>-<net>.json.
import { createPublicClient, createWalletClient, http, defineChain, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { createHash } from "crypto";
import { NETWORKS, type Net } from "../../networks";

const argv = process.argv.slice(2);
const net = argv[0] as Net, slug = argv[1];
const opt = (k: string, d?: string) => { const i = argv.indexOf("--" + k); if (i < 0) { if (d === undefined) throw new Error("missing --" + k); return d; } return argv[i + 1]; };
const N = NETWORKS[net];
if (!N || net === "polkadot") throw new Error("network: paseo | kusama");
if (!/^[a-z0-9-]+$/.test(slug || "")) throw new Error("slug: lowercase letters, digits, hyphens");
if (net !== "paseo" && !argv.includes("--mainnet")) throw new Error("real network: add --mainnet");
const here = (p: string) => new URL(p, import.meta.url).pathname;
const RECORD = here(`${slug}-${net}.json`);
if (existsSync(RECORD)) throw new Error("already deployed: " + RECORD);

const specPath = opt("spec"), specText = readFileSync(specPath, "utf8");
if (net !== "paseo" && /\{\{|TBC|to be fixed/i.test(specText)) throw new Error("specification still has unfilled placeholders");
const spec = keccak256(toHex(specText));
const ceiling = BigInt(opt("ceiling")) * 1_000_000n;            // placeholder asset has 6 decimals
const bidClose = BigInt(Math.floor(Date.parse(opt("bid-close")) / 1000));
const awardBy = BigInt(Math.floor(Date.parse(opt("award-by")) / 1000));
const review = BigInt(Number(opt("review-days", "7")) * 86400);
const now = BigInt(Math.floor(Date.now() / 1000));
if (!(bidClose > now + 3600n && awardBy > bidClose)) throw new Error("dates: bid close must be over an hour away and before award-by");

const demo = JSON.parse(readFileSync(here(`../demo/${net}.json`), "utf8"));
const input = JSON.parse(readFileSync(here("../demo/standard-input.json"), "utf8"));
const solc = (await import("solc")).default;
const out = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of out.errors ?? []) if (e.severity === "error") throw new Error(e.formattedMessage);
const P = { abi: out.contracts["Procurement.sol"].Procurement.abi, bytecode: ("0x" + out.contracts["Procurement.sol"].Procurement.evm.bytecode.object) as Hex };
const sha = createHash("sha256").update(P.bytecode).digest("hex");
if (sha !== demo.tender.bytecodeSha256) throw new Error("bytecode differs from the demo tender: " + sha);

const chain = defineChain({ id: N.chainId, name: N.name, nativeCurrency: { name: N.symbol, symbol: N.symbol, decimals: 18 }, rpcUrls: { default: { http: [N.eth] } } });
const pub = createPublicClient({ chain, transport: http() });
const account = privateKeyToAccount(readFileSync(`${process.env.KEYS ?? "keys"}/${net}-deployer.key`, "utf8").trim() as Hex);
const wallet = createWalletClient({ account, chain, transport: http() });
const before = await pub.getBalance({ address: account.address });
const args = [demo.asset.address, account.address, account.address, spec, ceiling, bidClose, awardBy, review];
const hash = await wallet.deployContract({ abi: P.abi, bytecode: P.bytecode, args });
const rc = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
if (rc.status !== "success" || !rc.contractAddress) throw new Error("deploy failed " + hash);
const after = await pub.getBalance({ address: account.address });
copyFileSync(specPath, here(`${slug}-${net}-spec-at-deploy.md`));
const rec = {
  network: net, slug, purpose: "unfunded tender: real bids and award on chain, placeholder asset so it can never hold money; winner paid separately",
  deployer: account.address, at: new Date().toISOString(), costKsmOrPas: Number(before - after) / 1e18,
  asset: demo.asset.address,
  tender: { address: rc.contractAddress, tx: hash, block: Number(rc.blockNumber), gasUsed: rc.gasUsed.toString(), bytecodeSha256: sha,
    buyer: account.address, reviewer: account.address, resolver: account.address, specification: spec,
    specificationSource: `tenders/${slug}-${net}-spec-at-deploy.md`, ceiling: ceiling.toString(),
    bidClose: Number(bidClose), activationClose: Number(awardBy), reviewPeriod: Number(review) },
};
writeFileSync(RECORD, JSON.stringify(rec, null, 2) + "\n");
console.log(JSON.stringify(rec, null, 2));
