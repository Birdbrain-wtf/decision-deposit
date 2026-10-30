// The chains a pool can live on. Everything a deployment needs that differs by chain.
export const NETWORKS = {
  kusama: {
    name: "Kusama Asset Hub", symbol: "KSM", chainId: 420420418,
    eth: "https://eth-rpc-kusama.polkadot.io", ws: "wss://kusama-asset-hub-rpc.polkadot.io",
    explorer: "https://blockscout-kusama.polkadot.io", subsquare: "https://kusama.subsquare.io/referenda/",
    referendaPallet: 92, place: 1, refund: 2, weiPerPlanck: 1_000_000n, planckPerUnit: 1_000_000_000_000n,
  },
  paseo: {
    name: "Paseo Asset Hub", symbol: "PAS", chainId: 420420417,
    eth: "https://eth-rpc-testnet.polkadot.io", ws: "wss://asset-hub-paseo-rpc.n.dwellir.com",
    explorer: "https://blockscout-testnet.polkadot.io", subsquare: "https://paseo.subsquare.io/referenda/",
    referendaPallet: 62, place: 1, refund: 2, weiPerPlanck: 100_000_000n, planckPerUnit: 10_000_000_000n,
  },
} as const;
export type Net = keyof typeof NETWORKS;
