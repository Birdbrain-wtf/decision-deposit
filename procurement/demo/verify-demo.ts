// Publish the demo contracts' source on the network's Blockscout, from the exact standard input used to deploy.
//   bun verify-demo.ts <paseo|kusama>
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { NETWORKS, type Net } from "../../networks";
const net = process.argv[2] as Net; const N = NETWORKS[net];
const here = (p: string) => new URL(p, import.meta.url).pathname;
const rec = JSON.parse(readFileSync(here(`${net}.json`), "utf8"));
const t = rec.tender;
const tenderArgs = encodeAbiParameters(parseAbiParameters("address,address,address,bytes32,uint256,uint64,uint64,uint64"),
  [rec.asset.address, t.reviewer, t.resolver, t.specification, BigInt(t.ceiling), BigInt(t.bidClose), BigInt(t.activationClose), BigInt(t.reviewPeriod)]).slice(2);
const jobs = [
  { address: rec.asset.address, name: "DemoPlaceholderAsset", args: "" },
  { address: t.address, name: "Procurement", args: tenderArgs },
];
for (const j of jobs) {
  const out = execFileSync("curl", ["-s", "-m", "60", "-X", "POST", `${N.explorer}/api/v2/smart-contracts/${j.address}/verification/via/standard-input`,
    "-F", "compiler_version=v0.8.30+commit.73712a01", "-F", "license_type=mit", "-F", `contract_name=${j.name}`,
    "-F", "autodetect_constructor_args=false", "-F", `constructor_args=${j.args}`, "-F", `files[0]=@${here("standard-input.json")};type=application/json`]).toString();
  console.log(j.name, out);
}
for (let i = 0; i < 36; i++) {
  await new Promise((s) => setTimeout(s, 5000));
  const s = await Promise.all(jobs.map(async (j) => (await (await fetch(`${N.explorer}/api/v2/smart-contracts/${j.address}`)).json()).is_verified));
  if (s.every(Boolean)) { for (const j of jobs) console.log("verified:", `${N.explorer}/address/${j.address}?tab=contract`); process.exit(0); }
}
console.log("not verified yet"); process.exit(1);
