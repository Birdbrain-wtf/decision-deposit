// What a pool for a referendum should be opened with, read live from the chain.
//
//   bun ref-terms.ts <kusama|paseo> <referendum> [ws url]
//
// The referendum's track, its decision deposit, and the funding close: the referendum's
// own timeout (submitted + UndecidingTimeout, in relay blocks) turned into a time, plus an
// hour. Never earlier. Pool 1 for #676 closed on a hand-picked time hours before the real
// timeout and missed by 40 KSM. A close a little late costs nothing: contributors can
// withdraw while the pool is open, and a timed-out referendum just refuses the placement.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { NETWORKS, type Net } from "./networks";

const RELAY_BLOCK_SECONDS = 6;
const MARGIN_SECONDS = 3600;

export async function termsFor(api: ApiPromise, net: Net, ref: number) {
  const N = NETWORKS[net];
  const info: any = await api.query.referenda.referendumInfoFor(ref);
  if (info.isNone) throw new Error(`#${ref}: no such referendum`);
  const i = info.unwrap();
  if (!i.isOngoing) throw new Error(`#${ref}: not ongoing (${i.type}), a pool cannot place`);
  const o = i.asOngoing;
  const trackId = o.track.toNumber();
  const track = [...(api.consts.referenda.tracks as any)].find(([id]: any) => id.toNumber() === trackId)[1];
  const deposit = track.decisionDeposit.toBigInt() as bigint;
  const relayNow = ((await api.query.parachainSystem.lastRelayChainBlockNumber()) as any).toNumber();
  const timeoutRelay = o.submitted.toNumber() + (api.consts.referenda.undecidingTimeout as any).toNumber();
  const nowSec = Number(((await api.query.timestamp.now()) as any).toBigInt() / 1000n);
  const timeoutSec = nowSec + (timeoutRelay - relayNow) * RELAY_BLOCK_SECONDS;
  const fundingDeadline = timeoutSec + MARGIN_SECONDS;
  const warnings: string[] = [];
  if (o.decisionDeposit.isSome) warnings.push(`#${ref} already has a decision deposit: no pool needed`);
  if (timeoutRelay <= relayNow) warnings.push(`#${ref} is past its timeout block: it times out at its next alarm`);
  return {
    referendum: ref,
    track: `${trackId} ${String(track.name.toHuman?.() ?? track.name).replace(/\0+$/, "").trim()}`,
    hasDecisionDeposit: o.decisionDeposit.isSome as boolean,
    depositPlanck: deposit,
    deposit: (Number(deposit) / Number(N.planckPerUnit)).toFixed(8) + " " + N.symbol,
    submittedRelay: o.submitted.toNumber() as number,
    timeoutRelay,
    relayNow,
    timeoutEstimate: new Date(timeoutSec * 1000).toISOString(),
    fundingDeadline: BigInt(fundingDeadline),
    fundingDeadlineIso: new Date(fundingDeadline * 1000).toISOString(),
    warnings,
  };
}

if (import.meta.main) {
  const [net, refArg, wsArg] = process.argv.slice(2) as [Net, string, string?];
  if (!NETWORKS[net] || !refArg) { console.log("usage: bun ref-terms.ts <kusama|paseo> <referendum> [ws]"); process.exit(1); }
  const api = await ApiPromise.create({ provider: new WsProvider(wsArg ?? NETWORKS[net].ws), noInitWarn: true });
  try {
    const t = await termsFor(api, net, Number(refArg));
    console.log(JSON.stringify(t, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  } catch (e: any) { console.log(e.message); process.exitCode = 2; }
  await api.disconnect();
}
