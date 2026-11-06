// Publish version 2's source on the network's Blockscout. Same compiler input as compile-v2.ts.
//   bun verify-v2.ts <kusama|polkadot|paseo> factory            the factory from deployments/<net>-v2.json
//   bun verify-v2.ts <kusama|polkadot|paseo> pool <address>     a pool it opened (constructor args read from its PoolOpened event)
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { NETWORKS, type Net } from "./networks";
const [net, what, addr] = process.argv.slice(2) as [Net, string, string?];
const N = NETWORKS[net];
const rec = JSON.parse(readFileSync(new URL(`./deployments/${net}-v2.json`, import.meta.url), "utf8"));
const read = (f: string) => readFileSync(new URL("./contracts/" + f, import.meta.url), "utf8");
const input = {
  language: "Solidity",
  sources: {
    "v2/DecisionDepositPool.sol": { content: read("v2/DecisionDepositPool.sol") },
    "v2/DecisionDepositPoolFactory.sol": { content: read("v2/DecisionDepositPoolFactory.sol") },
  },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
let address: string, name: string, args: string;
if (what === "factory") { address = rec.factory.address; name = "DecisionDepositPoolFactory"; args = rec.factory.constructorArgs; }
else {
  const p = rec.pools.find((x: any) => x.address.toLowerCase() === addr!.toLowerCase());
  if (!p) throw new Error("pool not in deployments/" + net + "-v2.json");
  address = p.address; name = "DecisionDepositPool";
  args = encodeAbiParameters(parseAbiParameters("uint32,uint256,uint256,uint64,uint8,uint8,uint8,uint256,address"),
    [p.referendum, BigInt(p.depositPlanck), BigInt(p.minPlanck), BigInt(p.fundingDeadline), N.referendaPallet, N.place, N.refund, N.weiPerPlanck, p.sweepTo]).slice(2);
}
const file = `/tmp/dd-verify-v2-${address}.json`;
writeFileSync(file, JSON.stringify(input));
const out = execFileSync("curl", ["-s", "-m", "60", "-X", "POST", `${N.explorer}/api/v2/smart-contracts/${address}/verification/via/standard-input`,
  "-F", "compiler_version=v0.8.30+commit.73712a01", "-F", "license_type=apache_2_0", "-F", `contract_name=${name}`,
  "-F", "autodetect_constructor_args=false", "-F", `constructor_args=${args}`, "-F", `files[0]=@${file};type=application/json`]).toString();
console.log(out);
for (let i = 0; i < 24; i++) {
  await new Promise((s) => setTimeout(s, 5000));
  const c = await (await fetch(`${N.explorer}/api/v2/smart-contracts/${address}`)).json();
  if (c.is_verified) { console.log("verified:", N.explorer + "/address/" + address + "?tab=contract"); process.exit(0); }
}
console.log("not verified yet"); process.exit(1);
