// Publish a tender's source on Blockscout from the demo's standard input.  bun verify-tender.ts <net> <slug>
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { NETWORKS, type Net } from "../../networks";
const [net, slug] = process.argv.slice(2) as [Net, string]; const N = NETWORKS[net];
const here = (p: string) => new URL(p, import.meta.url).pathname;
const rec = JSON.parse(readFileSync(here(`${slug}-${net}.json`), "utf8")); const t = rec.tender;
const args = encodeAbiParameters(parseAbiParameters("address,address,address,bytes32,uint256,uint64,uint64,uint64"),
  [rec.asset, t.reviewer, t.resolver, t.specification, BigInt(t.ceiling), BigInt(t.bidClose), BigInt(t.activationClose), BigInt(t.reviewPeriod)]).slice(2);
console.log(execFileSync("curl", ["-s", "-m", "60", "-X", "POST", `${N.explorer}/api/v2/smart-contracts/${t.address}/verification/via/standard-input`,
  "-F", "compiler_version=v0.8.30+commit.73712a01", "-F", "license_type=mit", "-F", "contract_name=Procurement",
  "-F", "autodetect_constructor_args=false", "-F", `constructor_args=${args}`, "-F", `files[0]=@${here("../demo/standard-input.json")};type=application/json`]).toString());
for (let i = 0; i < 36; i++) {
  await new Promise((s) => setTimeout(s, 5000));
  if ((await (await fetch(`${N.explorer}/api/v2/smart-contracts/${t.address}`)).json()).is_verified) { console.log("verified:", `${N.explorer}/address/${t.address}?tab=contract`); process.exit(0); }
}
console.log("not verified yet"); process.exit(1);
