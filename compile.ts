// Compile the pool with solc to plain EVM bytecode (Asset Hub runs it under pallet-revive's EVM).
import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
const read = (f: string) => readFileSync(new URL("./contracts/" + f, import.meta.url), "utf8");
const out = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "DecisionDepositPool.sol": { content: read("DecisionDepositPool.sol") }, "Refuser.sol": { content: read("Refuser.sol") } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
})));
for (const e of out.errors ?? []) console.error(e.formattedMessage);
if ((out.errors ?? []).some((e: any) => e.severity === "error")) process.exit(1);
mkdirSync(new URL("./build", import.meta.url), { recursive: true });
for (const name of ["DecisionDepositPool", "Refuser"]) {
  const c = out.contracts[name + ".sol"][name];
  writeFileSync(new URL(`./build/${name}.json`, import.meta.url),
    JSON.stringify({ compiler: "solc " + solc.version(), abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
  console.log("ok", name, solc.version(), (c.evm.bytecode.object.length / 2) + " bytes");
}
