// Production config (Robinhood Chain mainnet). Fill in after deploying (empty = "not deployed yet" on the site).
window.BOND_CONFIG = {
  name: "LUNARRAY",
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpc: "https://robinhood-mainnet.g.alchemy.com/v2/alch_Jc-vuH82QY1MfoyAsugxP",
  rpcs: [
    "https://robinhood-mainnet.g.alchemy.com/v2/alch_Jc-vuH82QY1MfoyAsugxP", // Alchemy (read key; restrict it to the site domain in the Alchemy dashboard)
    "https://rpc.mainnet.chain.robinhood.com",                              // official
    "https://robinhood-rpc.publicnode.com",                                  // publicnode
  ],
  multicall: "0xcA11bde05977b3631167028862bE2a173976CA11", // Multicall3 (verified deployed on chain 4663)
  explorer: "https://robinhoodchain.blockscout.com",
  engine: "",       // BondEngine
  splitter: "",     // FeeSplitter (creatorFeeRecipient on Pons)
  token: "",        // LUNARRAY token created by Pons v2
  staked: "",       // StakedLunarray (sLUNARRAY, liquid staking receipt)
  tokenSymbol: "LUNARRAY",
  x: "",            // https://x.com/... once the account exists
  github: "https://github.com/devsolusd1/lunarray",
  treasuryBps: 6000, // creator tax 5%: 3% treasury (60% of every harvest) + 2% protocol
};
