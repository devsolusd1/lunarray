require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PK = process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [];

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: false },
  },
  networks: {
    localhost: { url: "http://127.0.0.1:8546" },
    hardhat: {
      // Robinhood Chain is unknown to Hardhat: declare its hardfork so forked calls can execute at the fork block
      chains: { 4663: { hardforkHistory: { cancun: 0 } } },
      // set FORK=1 to run fork tests against Robinhood Chain mainnet (FORK_BLOCK pins the block; RH_RPC picks the RPC)
      ...(process.env.FORK ? { forking: { url: process.env.RH_RPC || "https://rpc.ordofi.network", ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}) } } : {}),
    },
    robinhood: {
      url: process.env.RH_RPC || "https://robinhood-rpc.publicnode.com",
      chainId: 4663,
      accounts: PK,
    },
    robinhoodTestnet: {
      url: process.env.RH_TESTNET_RPC || "https://robinhood-sepolia-rpc.publicnode.com",
      chainId: 46630,
      accounts: PK,
    },
  },
  etherscan: {
    apiKey: { robinhood: "blockscout", robinhoodTestnet: "blockscout" },
    customChains: [
      { network: "robinhood", chainId: 4663, urls: { apiURL: "https://robinhoodchain.blockscout.com/api", browserURL: "https://robinhoodchain.blockscout.com" } },
      { network: "robinhoodTestnet", chainId: 46630, urls: { apiURL: "https://explorer.testnet.chain.robinhood.com/api", browserURL: "https://explorer.testnet.chain.robinhood.com" } },
    ],
  },
  mocha: { timeout: 120000 },
};
