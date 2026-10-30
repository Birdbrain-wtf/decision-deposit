// The Substrate side of Paseo Asset Hub with polkadot-api (the older @polkadot/api used
// by the fork tests cannot sign for Paseo's current runtime).
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { entropyToMiniSecret, mnemonicToEntropy, ss58Address } from "@polkadot-labs/hdkd-helpers";
import { readFileSync } from "node:fs";
import { NETWORKS } from "../networks";

/** Test keys live outside the repo. KEYS: the EVM keys; PASEO_MNEMONIC: Birdbrain's Paseo account. */
export const KEYS = process.env.KEYS ?? "keys";
const MNEMONIC = process.env.PASEO_MNEMONIC ?? "keys/paseo-mnemonic";

export function connect() {
  const client = createClient(withPolkadotSdkCompat(getWsProvider(NETWORKS.paseo.ws)));
  return { client, api: client.getUnsafeApi() as any };
}

/** Birdbrain's Paseo account: test money only, never a mainnet key. */
export function deployer() {
  const kp = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(readFileSync(MNEMONIC, "utf8").trim())))("");
  return { address: ss58Address(kp.publicKey, 42), signer: getPolkadotSigner(kp.publicKey, "Sr25519", kp.sign) };
}

/** The native account behind an Ethereum address: its 20 bytes, then twelve 0xEE. */
export const nativeOf = (h: string) => ss58Address(Uint8Array.from(Buffer.from(h.slice(2) + "ee".repeat(12), "hex")), 42);

export async function send(label: string, tx: any, signer: any) {
  const r = await tx.signAndSubmit(signer);
  if (!r.ok) throw new Error(`${label} failed: ${JSON.stringify(r.dispatchError, (_, x) => (typeof x === "bigint" ? String(x) : x))}`);
  console.log(`${label}: block ${r.block.hash} #${r.block.number}`);
  return r;
}
