// scripts/deploy-v2-mainnet.js
// Deploy TaskEscrowV2 to Base Mainnet

const hre = require("hardhat");

async function main() {
  console.log("========================================");
  console.log("  TaskEscrowV2 — Base MAINNET Deploy");
  console.log("========================================\n");

  // Base Mainnet addresses
  const USDC_MAINNET  = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const ORACLE_ADDRESS = "0x24A400E17d2b9fd9C7eDd99f358A34Fe7751D849";

  // Verify deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer address:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance < hre.ethers.parseEther("0.001")) {
    throw new Error("Insufficient balance for deploy. Need at least 0.001 ETH.");
  }

  console.log("Constructor args:");
  console.log("  USDC:  ", USDC_MAINNET);
  console.log("  Oracle:", ORACLE_ADDRESS);
  console.log("");

  // Deploy — constructor: (address _usdc, address _oracle)
  console.log("Deploying TaskEscrowV2...");
  const TaskEscrowV2 = await hre.ethers.getContractFactory("TaskEscrowV2");
  const contract = await TaskEscrowV2.deploy(USDC_MAINNET, ORACLE_ADDRESS);

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();

  console.log("\n✅ TaskEscrowV2 deployed!");
  console.log("Contract address:", contractAddress);
  console.log("Deploy tx hash:  ", deployTx.hash);
  console.log("BaseScan:        ", `https://basescan.org/address/${contractAddress}`);
  console.log("");

  // Wait for confirmations before verifying
  console.log("Waiting 30 seconds for block confirmations before verification...");
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Verify on BaseScan Mainnet
  console.log("\nVerifying on BaseScan Mainnet...");
  try {
    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: [USDC_MAINNET, ORACLE_ADDRESS],
    });
    console.log("✅ Contract verified on BaseScan Mainnet");
  } catch (err) {
    if (err.message.toLowerCase().includes("already verified")) {
      console.log("ℹ️  Already verified");
    } else {
      console.log("⚠️  Verification failed (can retry manually):", err.message);
    }
  }

  // Summary
  console.log("\n========================================");
  console.log("  DEPLOYMENT SUMMARY");
  console.log("========================================");
  console.log("Network:       Base Mainnet (chainId 8453)");
  console.log("Contract:      TaskEscrowV2");
  console.log("Address:      ", contractAddress);
  console.log("Deploy tx:    ", deployTx.hash);
  console.log("USDC:         ", USDC_MAINNET);
  console.log("Oracle:       ", ORACLE_ADDRESS);
  console.log("Owner:        ", deployer.address);
  console.log("BaseScan:     ", `https://basescan.org/address/${contractAddress}`);
  console.log("========================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
