// Mirror a Kusama referendum on Paseo: the same proposal bytes, the same track and
// origin, the same enactment. Reads everything from Kusama Asset Hub, so the copy can
// be checked against the original by anyone.
//
//   bun paseo/mirror.ts <kusama referendum>        dry run: show what would be submitted
//   bun paseo/mirror.ts <kusama referendum> --go   note the preimage and submit on Paseo
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { Binary } from "polkadot-api";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { connect, deployer, send } from "./substrate";
import { NETWORKS } from "../networks";

const RECORD = new URL("../deployments/paseo.json", import.meta.url).pathname;
const ref = Number(process.argv[2]);
const go = process.argv.includes("--go");
const j = (x: any) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? String(v) : v instanceof Binary ? v.asHex() : v));

const ksm = createClient(withPolkadotSdkCompat(getWsProvider(NETWORKS.kusama.ws)));
const k = ksm.getUnsafeApi() as any;
const info = await k.query.Referenda.ReferendumInfoFor.getValue(ref);
if (info?.type !== "Ongoing") throw new Error(`Kusama #${ref} is not ongoing: ${j(info)}`);
const o = info.value;
if (o.proposal.type !== "Lookup") throw new Error("only Lookup proposals are mirrored");
const { hash, len } = o.proposal.value;
const bytes: Binary = await k.query.Preimage.PreimageFor.getValue([hash, len]);
if (!bytes) throw new Error("preimage not on Kusama");
const hashHex = hash.asHex();
const check = "0x" + new Bun.CryptoHasher("blake2b256").update(bytes.asBytes()).digest("hex");
if (check !== hashHex) throw new Error("preimage does not hash to the referendum's hash");
ksm.destroy();

console.log(`Kusama #${ref}: track ${o.track}, origin ${j(o.origin)}, enactment ${j(o.enactment)}`);
console.log(`proposal ${hashHex}, ${len} bytes`);

const { client, api } = connect();
const me = deployer();
const tracks = await api.constants.Referenda.Tracks();
const track = tracks.find(([id]: any) => id === o.track);
if (!track) throw new Error(`Paseo has no track ${o.track}`);
console.log(`Paseo track ${o.track} ${track[1].name}: decision deposit ${track[1].decision_deposit} planck`);
const noted = !!(await api.query.Preimage.PreimageFor.getValue([hash, len]));

if (!go) { console.log(`preimage on Paseo: ${noted ? "already noted" : "not yet"}. Dry run; add --go.`); }
else {
  if (!noted) await send("preimage", api.tx.Preimage.note_preimage({ bytes }), me.signer);
  const r = await send("referendum", api.tx.Referenda.submit({
    proposal_origin: o.origin,
    proposal: { type: "Lookup", value: { hash, len } },
    enactment_moment: o.enactment,
  }), me.signer);
  const ev = r.events.find((e: any) => e.type === "Referenda" && e.value.type === "Submitted");
  const index = ev.value.value.index;
  const rec = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : { network: "paseo", pools: [], referenda: [] };
  rec.referenda.push({ index, track: o.track, origin: o.origin.value.type, mirrors: { network: "kusama", referendum: ref },
    proposal: { hash: hashHex, len }, block: r.block.number, at: new Date().toISOString() });
  writeFileSync(RECORD, JSON.stringify(rec, null, 2) + "\n");
  console.log(`Paseo referendum ${index} mirrors Kusama #${ref}`);
}
client.destroy();
process.exit(0);
