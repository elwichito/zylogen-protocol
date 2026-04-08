// scripts/deployV2.js
const hre = require("hardhat");

async function main() {
  // ─── Base Mainnet addresses ─────────────────────────────────────────────
  // USDC on Base: https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  // Your oracle wallet (Zylogen Oracle in MetaMask)
  const ORACLE    = "0x24A400E17d2b9fd9C7eDd99f358A34Fe7751D849";

  // Your deployer/treasury wallet (first MetaMask account)
  const [deployer] = await hre.ethers.getSigners();
  const TREASURY  = deployer.address;

  console.log("Deploying TaskEscrowV2...");
  console.log("  Network:  ", hre.network.name);
  console.log("  Deployer: ", deployer.address);
  console.log("  Oracle:   ", ORACLE);
  console.log("  Treasury: ", TREASURY);
  console.log("  USDC:     ", USDC_BASE);

  const Factory = await hre.ethers.getContractFactory("TaskEscrowV2");
  const escrow  = await Factory.deploy(ORACLE, TREASURY, USDC_BASE);
  await escrow.waitForDeployment();

  const addr = await escrow.getAddress();
  console.log("\n  TaskEscrowV2 deployed to:", addr);
  console.log("\n  Verify on Basescan:");
  console.log(`  npx hardhat verify --network base ${addr} ${ORACLE} ${TREASURY} ${USDC_BASE}`);

  // Wait for a few blocks before verifying
  console.log("\n  Waiting 30s for block confirmations...");
  await new Promise(r => setTimeout(r, 30_000));

  try {
    await hre.run("verify:verify", {
      address: addr,
      constructorArguments: [ORACLE, TREASURY, USDC_BASE],
    });
    console.log("  Contract verified on Basescan!");
  } catch (e) {
    console.log("  Auto-verify failed (run manually):", e.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
