// Publish a pool's source on the network's Blockscout, so its address shows readable,
// checked code. Same compiler input as compile.ts.
//   bun verify.ts <paseo|kusama> <address> <constructorArgsHex>
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { NETWORKS, type Net } from "./networks";
const [net, address, args] = process.argv.slice(2) as [Net, string, string];
const input = {
  language: "Solidity",
  sources: { "DecisionDepositPool.sol": { content: readFileSync(new URL("./contracts/DecisionDepositPool.sol", import.meta.url), "utf8") } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
// Bun's multipart upload is not read as a file by Blockscout; curl's is.
const file = `/tmp/dd-verify-${address}.json`;
writeFileSync(file, JSON.stringify(input));
const base = NETWORKS[net].explorer;
const out = execFileSync("curl", ["-s", "-m", "60", "-X", "POST", `${base}/api/v2/smart-contracts/${address}/verification/via/standard-input`,
  "-F", "compiler_version=v0.8.30+commit.73712a01", "-F", "license_type=apache_2_0", "-F", "contract_name=DecisionDepositPool",
  "-F", "autodetect_constructor_args=false", "-F", `constructor_args=${args}`, "-F", `files[0]=@${file};type=application/json`]).toString();
console.log(out);
for (let i = 0; i < 20; i++) {
  await new Promise((s) => setTimeout(s, 5000));
  const c = await (await fetch(`${base}/api/v2/smart-contracts/${address}`)).json();
  if (c.is_verified) { console.log("verified:", base + "/address/" + address + "?tab=contract"); process.exit(0); }
}
console.log("not verified yet"); process.exit(1);
