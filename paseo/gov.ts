// Funding and referenda on Paseo Asset Hub, from Birdbrain's Paseo account.
//
//   bun paseo/gov.ts fund <pas> <0xaddr…>          PAS from Birdbrain's Paseo account to EVM addresses
//   bun paseo/gov.ts referendum <Origin> <text…>    submit a remark referendum on that origin's track
import { connect, deployer, send, nativeOf } from "./substrate";
import { Binary } from "polkadot-api";
import { readFileSync, writeFileSync, existsSync } from "fs";

const RECORD = new URL("../deployments/paseo.json", import.meta.url).pathname;
const { client, api } = connect();
const me = deployer();
const [cmd, ...a] = process.argv.slice(2);

if (cmd === "fund") {
  const value = BigInt(Math.round(Number(a[0]) * 1e4)) * 1_000_000n;
  await send(`${a[0]} PAS to ${a.slice(1).length} addresses`, api.tx.Utility.batch_all({
    calls: a.slice(1).map((h) => api.tx.Balances.transfer_keep_alive({ dest: { type: "Id", value: nativeOf(h) }, value }).decodedCall),
  }), me.signer);
} else if (cmd === "referendum") {
  const text = a.slice(1).join(" ");
  const remark = await api.tx.System.remark_with_event({ remark: Binary.fromText(text) }).getEncodedData();
  const r = await send("referendum", api.tx.Referenda.submit({
    proposal_origin: { type: "Origins", value: { type: a[0] } },
    proposal: { type: "Inline", value: remark },
    enactment_moment: { type: "After", value: 10 },
  }), me.signer);
  const ev = r.events.find((e: any) => e.type === "Referenda" && e.value.type === "Submitted");
  const index = ev.value.value.index, track = ev.value.value.track;
  const rec = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : { network: "paseo", pools: [], referenda: [] };
  rec.referenda.push({ index, track, origin: a[0], text, block: r.block.number, at: new Date().toISOString() });
  writeFileSync(RECORD, JSON.stringify(rec, null, 2) + "\n");
  console.log("referendum", index, "track", track);
} else console.log("usage: fund <pas> <0x…> | referendum <Origin> <text>");
client.destroy();
process.exit(0);
