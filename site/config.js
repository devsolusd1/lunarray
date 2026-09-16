// Production config (Robinhood Chain mainnet). Deployed 2026-09-15.
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
  engine: "0x7382f1bB63d53E52AB12e7Cc32C7DE8C77A26Dcb",   // BondEngine
  splitter: "0x56638B0d2139Cf39B0C75beAc4a224B8471aD941", // FeeSplitter (creatorFeeRecipient on Pons)
  token: "0x7340685A52e6dC3a8a99f40E856a9C2909227b8C",    // LUNARRAY token created by Pons v2 (curve 0x356DEEbFEf740EC4c182413d36920f8d9EF4f7F6)
  staked: "0x1EFd5B9CE223562073d53F917c52Ae4F7a3e3463",   // StakedLunarray (sLUNARRAY, liquid staking receipt)
  devWallet: "0xCc1Cb626F9DceA57cdA5C00b503d979d86e9d9F1", // dev wallet (launcher, keeper)
  devlock: "0x9aD147663A1E11A36c07763c7F590757a2312Eea",  // DevLock: dev allocation locked until 2027-09-15, beneficiary = treasury
  tokenSymbol: "LUNARRAY",
  x: "https://x.com/Lunarray_fun",
  treasuryBps: 6000, // creator tax 5%: 3% treasury (60% of every harvest) + 2% protocol
};
