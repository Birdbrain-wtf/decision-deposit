// Sealed tenders: sealed bids, a sealed budget, quality scores fixed on chain before any price opens.
//   bun sealed.ts deploy <paseo|kusama> <slug> --spec <file> --budget <whole US$> --bid-close <ISO> --score-by <ISO> --reveal-by <ISO> --award-by <ISO> [--review-days 7] [--mainnet]
//   bun sealed.ts verify <net> <slug>
//   bun sealed.ts scores <net> <slug> <scores-file>      fix keccak-256 of the scores file on chain (once, inside the scoring window)
//   bun sealed.ts budget <net> <slug>                     open the sealed budget (after prices close)
//   bun sealed.ts award <net> <slug> <bidder> <reasoning-file>   record the award (after the budget is open)
//   bun sealed.ts status <net> <slug>
// Reuses demo/<net>.json's placeholder asset ("NOT dUSD", zero supply): bids and award on chain, never money.
// The budget and its salt live only in keys/tenders/<slug>-<net>.json (KEYS overrides keys/), written before the deploy.
import { createPublicClient, createWalletClient, http, defineChain, keccak256, toHex, encodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, chmodSync } from "fs";
import { execFileSync } from "child_process";
import { createHash, randomBytes } from "crypto";
import { NETWORKS, type Net } from "../../networks";

const [cmd, net, slug, ...rest] = process.argv.slice(2) as [string, Net, string, ...string[]];
const opt = (k: string, d?: string) => { const i = rest.indexOf("--" + k); if (i < 0) { if (d === undefined) throw new Error("missing --" + k); return d; } return rest[i + 1]; };
const N = NETWORKS[net];
if (!N || net === "polkadot") throw new Error("network: paseo | kusama");
if (!/^[a-z0-9-]+$/.test(slug || "")) throw new Error("slug: lowercase letters, digits, hyphens");
const here = (p: string) => new URL(p, import.meta.url).pathname;
const RECORD = here(`${slug}-${net}.json`);
const SECRET_DIR = `${process.env.KEYS ?? "keys"}/tenders`, SECRET = `${SECRET_DIR}/${slug}-${net}.json`;
const UNITS = 1_000_000n; // the placeholder asset has 6 decimals

const input = readFileSync(here("sealed-input.json"), "utf8");
const solc = (await import("solc")).default;
const out = JSON.parse(solc.compile(input));
for (const e of out.errors ?? []) if (e.severity === "error") throw new Error(e.formattedMessage);
const C = out.contracts["SealedProcurement.sol"].SealedProcurement;
const abi = C.abi, bytecode = ("0x" + C.evm.bytecode.object) as Hex;
const sha = createHash("sha256").update(bytecode).digest("hex");

const chain = defineChain({ id: N.chainId, name: N.name, nativeCurrency: { name: N.symbol, symbol: N.symbol, decimals: 18 }, rpcUrls: { default: { http: [N.eth] } } });
const pub = createPublicClient({ chain, transport: http() });
const account = privateKeyToAccount(readFileSync(`${process.env.KEYS ?? "keys"}/${net}-deployer.key`, "utf8").trim() as Hex);
const wallet = createWalletClient({ account, chain, transport: http() });
const ts = (k: string) => BigInt(Math.floor(Date.parse(opt(k)) / 1000));
async function send(fn: string, args: unknown[]) {
  const rec = JSON.parse(readFileSync(RECORD, "utf8"));
  const hash = await wallet.writeContract({ address: rec.tender.address, abi, functionName: fn, args });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
  if (rc.status !== "success") throw new Error(fn + " failed " + hash);
  console.log(fn, "ok", hash, "block", Number(rc.blockNumber));
}

if (cmd === "deploy") {
  if (net !== "paseo" && !rest.includes("--mainnet")) throw new Error("real network: add --mainnet");
  if (existsSync(RECORD)) throw new Error("already deployed: " + RECORD);
  const specPath = opt("spec"), specText = readFileSync(specPath, "utf8");
  if (net !== "paseo" && /\{\{|TBC|to be fixed/i.test(specText)) throw new Error("specification still has unfilled placeholders");
  const spec = keccak256(toHex(specText));
  const budget = BigInt(opt("budget")) * UNITS;
  const [bidClose, scoreBy, revealBy, awardBy] = [ts("bid-close"), ts("score-by"), ts("reveal-by"), ts("award-by")];
  const review = BigInt(Number(opt("review-days", "7")) * 86400);
  const now = BigInt(Math.floor(Date.now() / 1000)), lead = net === "paseo" ? 300n : 3600n;
  if (!(bidClose > now + lead && scoreBy > bidClose && revealBy > scoreBy && awardBy > revealBy)) throw new Error("dates must run bid-close < score-by < reveal-by < award-by, with bid-close at least " + lead / 60n + " minutes away");
  const salt = toHex(randomBytes(32));
  const commitment = keccak256(encodeAbiParameters(parseAbiParameters("uint256,bytes32"), [budget, salt]));
  mkdirSync(SECRET_DIR, { recursive: true });
  if (existsSync(SECRET)) throw new Error("a budget secret already exists: " + SECRET);
  writeFileSync(SECRET, JSON.stringify({ budgetUnits: budget.toString(), salt, commitment }, null, 2) + "\n"); chmodSync(SECRET, 0o600);
  const demo = JSON.parse(readFileSync(here(`../demo/${net}.json`), "utf8"));
  const before = await pub.getBalance({ address: account.address });
  const args = [demo.asset.address, account.address, account.address, spec, commitment, bidClose, scoreBy, revealBy, awardBy, review] as const;
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error("deploy failed " + hash);
  const after = await pub.getBalance({ address: account.address });
  copyFileSync(specPath, here(`${slug}-${net}-spec-at-deploy.md`));
  const rec = { network: net, slug, kind: "sealed",
    purpose: "unfunded sealed tender: sealed bids, sealed budget and quality scores fixed before prices open, all on chain; placeholder asset so it can never hold money; winner paid separately",
    deployer: account.address, at: new Date().toISOString(), costKsmOrPas: Number(before - after) / 1e18, asset: demo.asset.address,
    tender: { address: rc.contractAddress, tx: hash, block: Number(rc.blockNumber), gasUsed: rc.gasUsed.toString(), bytecodeSha256: sha,
      buyer: account.address, reviewer: account.address, resolver: account.address, specification: spec, specificationSource: `tenders/${slug}-${net}-spec-at-deploy.md`,
      ceilingCommitment: commitment, budgetSecret: SECRET,
      bidClose: Number(bidClose), scoreClose: Number(scoreBy), revealClose: Number(revealBy), activationClose: Number(awardBy), reviewPeriod: Number(review) } };
  writeFileSync(RECORD, JSON.stringify(rec, null, 2) + "\n");
  console.log(JSON.stringify(rec, null, 2));
} else if (cmd === "verify") {
  const rec = JSON.parse(readFileSync(RECORD, "utf8")), t = rec.tender;
  const args = encodeAbiParameters(parseAbiParameters("address,address,address,bytes32,bytes32,uint64,uint64,uint64,uint64,uint64"),
    [rec.asset, t.reviewer, t.resolver, t.specification, t.ceilingCommitment, BigInt(t.bidClose), BigInt(t.scoreClose), BigInt(t.revealClose), BigInt(t.activationClose), BigInt(t.reviewPeriod)]).slice(2);
  console.log(execFileSync("curl", ["-s", "-m", "60", "-X", "POST", `${N.explorer}/api/v2/smart-contracts/${t.address}/verification/via/standard-input`,
    "-F", "compiler_version=v0.8.30+commit.73712a01", "-F", "license_type=mit", "-F", "contract_name=SealedProcurement",
    "-F", "autodetect_constructor_args=false", "-F", `constructor_args=${args}`, "-F", `files[0]=@${here("sealed-input.json")};type=application/json`]).toString());
  for (let i = 0; i < 36; i++) {
    await new Promise((s) => setTimeout(s, 5000));
    if ((await (await fetch(`${N.explorer}/api/v2/smart-contracts/${t.address}`)).json()).is_verified) { console.log("verified:", `${N.explorer}/address/${t.address}?tab=contract`); process.exit(0); }
  }
  console.log("not verified yet"); process.exit(1);
} else if (cmd === "scores") {
  const h = keccak256(new Uint8Array(readFileSync(rest[0])));
  console.log("scores file hash", h); await send("commitScores", [h]);
} else if (cmd === "budget") {
  const s = JSON.parse(readFileSync(SECRET, "utf8")); await send("revealCeiling", [BigInt(s.budgetUnits), s.salt]);
} else if (cmd === "award") {
  // award <net> <slug> <bidder> <reasoning-file>: two milestones, 60% then 40% of the opened price, due 30 and 60 days after the award deadline
  const rec = JSON.parse(readFileSync(RECORD, "utf8")), bidder = rest[0] as Hex;
  const [price] = (await pub.readContract({ address: rec.tender.address, abi, functionName: "bids", args: [bidder] })) as [bigint, Hex];
  if (!price) throw new Error("no opened bid from " + bidder);
  const first = price * 60n / 100n, due = BigInt(rec.tender.activationClose);
  const reason = keccak256(new Uint8Array(readFileSync(rest[1])));
  console.log("reasoning hash", reason);
  await send("award", [bidder, [first, price - first], [due + 30n * 86400n, due + 60n * 86400n], reason]);
} else if (cmd === "status") {
  const rec = JSON.parse(readFileSync(RECORD, "utf8"));
  const r = (fn: string) => pub.readContract({ address: rec.tender.address, abi, functionName: fn });
  for (const fn of ["state", "commitCount", "revealCount", "qualityScores", "ceiling", "contractor"]) console.log(fn, await r(fn));
} else throw new Error("command: deploy | verify | scores | budget | status");
