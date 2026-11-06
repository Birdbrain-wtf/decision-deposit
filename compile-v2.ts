// Version 2: the pool plus a factory anyone uses to open one. build/v2/. Version 1 (build/) is untouched:
// its creation code is published in the forum thread and must keep reproducing.
import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
const read = (f: string) => readFileSync(new URL("./contracts/" + f, import.meta.url), "utf8");
const out = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: {
    "v2/DecisionDepositPool.sol": { content: read("v2/DecisionDepositPool.sol") },
    "v2/DecisionDepositPoolFactory.sol": { content: read("v2/DecisionDepositPoolFactory.sol") },
    "Refuser.sol": { content: read("Refuser.sol") },
  },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
}), { import: (p: string) => ({ contents: read(p) }) }));
for (const e of out.errors ?? []) console.error(e.formattedMessage);
if ((out.errors ?? []).some((e: any) => e.severity === "error")) process.exit(1);
mkdirSync(new URL("./build/v2", import.meta.url), { recursive: true });
for (const [file, name] of [["v2/DecisionDepositPool.sol", "DecisionDepositPool"], ["v2/DecisionDepositPoolFactory.sol", "DecisionDepositPoolFactory"], ["Refuser.sol", "Refuser"]]) {
  const c = out.contracts[file][name];
  writeFileSync(new URL(`./build/v2/${name}.json`, import.meta.url),
    JSON.stringify({ compiler: "solc " + solc.version(), abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
  console.log("ok", name, (c.evm.bytecode.object.length / 2) + " bytes");
}
