// scripts/deploy-zylogenjob-sepolia.js
// Deploy ZylogenJob (ERC-8183 kernel V3) to Base Sepolia.
//
// Reads from contracts/.env:
//   DEPLOYER_PRIVATE_KEY   — required, EOA with >= 0.005 ETH on Base Sepolia
//   BASESCAN_API_KEY       — recommended, enables auto-verify
//   USDC_ADDRESS           — optional, defaults to Circle USDC Sepolia
//   KERNEL_PAUSER_ADDRESS  — optional, defaults to deployer EOA
//   KERNEL_FORWARDER       — optional, defaults to address(0) (no meta-tx)
//
// Run:
//   cd contracts && npx hardhat run scripts/deploy-zylogenjob-sepolia.js --network baseSepolia

const hre = require("hardhat");
const { ethers } = hre;

const MIN_ETH       = ethers.parseEther("0.005");
const USDC_DEFAULT  = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC
const CONFIRMATIONS = 5;
const ABORT_WINDOW  = 5_000; // ms — countdown before broadcasting tx

function explorerUrl(addressOrTx, kind /* "address" | "tx" */) {
  return `https://sepolia.basescan.org/${kind}/${addressOrTx}`;
}

async function countdown(ms) {
  const start = Date.now();
  process.stdout.write("  abort with Ctrl+C — broadcasting in ");
  while (Date.now() - start < ms) {
    const left = Math.ceil((ms - (Date.now() - start)) / 1000);
    process.stdout.write(`\r  abort with Ctrl+C — broadcasting in ${left}s ...`);
    await new Promise((r) => setTimeout(r, 250));
  }
  process.stdout.write("\r  abort window closed — broadcasting tx now    \n\n");
}

async function main() {
  console.log("========================================");
  console.log("  ZylogenJob — Base Sepolia Deploy");
  console.log("========================================\n");

  // ── 1. Deployer + balance check ────────────────────────────────────────
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:       ", deployer.address);
  console.log("Balance:        ", ethers.formatEther(balance), "ETH");

  if (balance < MIN_ETH) {
    console.error(
      `\n❌ Deployer balance is below the required ${ethers.formatEther(MIN_ETH)} ETH.\n` +
      `   Fund ${deployer.address} on Base Sepolia and retry.\n` +
      `   Public faucet: https://www.alchemy.com/faucets/base-sepolia`
    );
    process.exit(1);
  }

  // ── 2. Constructor args ────────────────────────────────────────────────
  const paymentToken = process.env.USDC_ADDRESS         || USDC_DEFAULT;
  const pauser       = process.env.KERNEL_PAUSER_ADDRESS || deployer.address;
  const forwarder    = process.env.KERNEL_FORWARDER     || ethers.ZeroAddress;

  if (!ethers.isAddress(paymentToken) || !ethers.isAddress(pauser) || !ethers.isAddress(forwarder)) {
    console.error("\n❌ One of the env addresses is not a valid 0x address. Check your .env file.");
    process.exit(1);
  }

  console.log("\nConstructor args:");
  console.log("  paymentToken_:    ", paymentToken,
    paymentToken.toLowerCase() === USDC_DEFAULT.toLowerCase() ? "(USDC Sepolia, default)" : "(env override)");
  console.log("  pauser_:          ", pauser,
    pauser.toLowerCase() === deployer.address.toLowerCase() ? "(deployer, default)" : "(env override)");
  console.log("  trustedForwarder_:", forwarder,
    forwarder === ethers.ZeroAddress ? "(none — no meta-tx)" : "(env override)");

  // ── 3. Confirmation window ─────────────────────────────────────────────
  console.log("");
  await countdown(ABORT_WINDOW);

  // ── 4. Deploy ──────────────────────────────────────────────────────────
  console.log("Deploying ZylogenJob ...");
  const Kernel = await ethers.getContractFactory("ZylogenJob");
  const kernel = await Kernel.deploy(paymentToken, pauser, forwarder);

  const deployTx = kernel.deploymentTransaction();
  console.log("  tx submitted:   ", deployTx.hash);
  console.log("  awaiting deploy ...");
  await kernel.waitForDeployment();
  const address = await kernel.getAddress();
  console.log("  deployed at:    ", address);

  // Wait extra confirmations before verifying — Basescan needs the block to settle.
  console.log(`\nWaiting ${CONFIRMATIONS} block confirmations before verification ...`);
  await deployTx.wait(CONFIRMATIONS);
  const receipt = await ethers.provider.getTransactionReceipt(deployTx.hash);
  const gasUsed = receipt.gasUsed.toString();
  const blockNumber = receipt.blockNumber;

  // ── 5. Verify ──────────────────────────────────────────────────────────
  console.log("\nVerifying on Basescan Sepolia ...");
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments: [paymentToken, pauser, forwarder],
    });
    console.log("✅ Verified on Basescan Sepolia");
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes("already verified")) {
      console.log("ℹ️  Already verified");
    } else {
      console.log("⚠️  Verification failed (can retry manually):");
      console.log("   ", err.message);
    }
  }

  // ── 6. Output summary + DEPLOYMENTS.md snippet ─────────────────────────
  console.log("\n========================================");
  console.log("  DEPLOYMENT SUMMARY");
  console.log("========================================");
  console.log("Network:        Base Sepolia (chainId 84532)");
  console.log("Contract:       ZylogenJob (ERC-8183 kernel)");
  console.log("Address:        " + address);
  console.log("Deploy tx:      " + deployTx.hash);
  console.log("Block:          " + blockNumber);
  console.log("Gas used:       " + gasUsed);
  console.log("paymentToken:   " + paymentToken);
  console.log("pauser:         " + pauser);
  console.log("forwarder:      " + forwarder);
  console.log("Basescan:       " + explorerUrl(address, "address"));
  console.log("Deploy tx URL:  " + explorerUrl(deployTx.hash, "tx"));
  console.log("========================================\n");

  console.log("── Paste into DEPLOYMENTS.md under 'Base Sepolia' ──────────");
  console.log(`### 🟢 Beta — ZylogenJob (ERC-8183 kernel V3)

| Campo | Valor |
|-------|-------|
| Dirección | \`${address}\` |
| Source | \`contracts/contracts/v3/ZylogenJob.sol\` |
| Network | Base Sepolia (chainId 84532) |
| Deploy tx | \`${deployTx.hash}\` |
| Block | ${blockNumber} |
| Gas used | ${gasUsed} |
| Constructor | paymentToken=\`${paymentToken}\` · pauser=\`${pauser}\` · forwarder=\`${forwarder}\` |
| Basescan | https://sepolia.basescan.org/address/${address} |
| Estado | Beta en Sepolia. Pendiente audit interno + slither/mythril antes de promover a mainnet. |
`);
  console.log("────────────────────────────────────────────────────────────");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
