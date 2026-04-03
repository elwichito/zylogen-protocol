require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const DEPLOYER_PRIVATE_KEY  = process.env.DEPLOYER_PRIVATE_KEY  || "0x" + "0".repeat(64);
const ALCHEMY_BASE_URL      = process.env.ALCHEMY_BASE_URL      || "";
const ALCHEMY_SEPOLIA_URL   = process.env.ALCHEMY_SEPOLIA_URL   || "";
const BASESCAN_API_KEY      = process.env.BASESCAN_API_KEY      || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1_000_000, // maximise for a simple contract deployed once
      },
    },
  },

  networks: {
    // ── Base Mainnet ──────────────────────────────────────────────────────────
    base: {
      url:      ALCHEMY_BASE_URL,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId:  8453,
    },

    // ── Base Sepolia (testnet) ────────────────────────────────────────────────
    baseSepolia: {
      url:      ALCHEMY_SEPOLIA_URL,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId:  84532,
    },
  },

  // ── Basescan contract verification ─────────────────────────────────────────
  etherscan: {
    apiKey: BASESCAN_API_KEY,
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL:     "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL:     "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};
