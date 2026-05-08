/**
 * Continue ZYL Genesis deployment from existing ZYL token.
 * Run: npx hardhat run scripts/continue-deploy.js --network baseSepolia
 */

const hre = require("hardhat");

// Already deployed addresses from previous tx
const ZYL_ADDRESS = "0x426608a34227b6edc61b2ced47ba235b4f747c4a";
const VESTING_ADDRESS = "0xf10ea18599e3767cfb9f07f40763d22564f8ffed";
const FACTORY_ADDRESS = "0x2Db1CBf792836A121268814569b1f1FE07eE193c";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`\n─── Continue ZYL Genesis Deploy ───`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance:  ${hre.ethers.formatEther(balance)} ETH`);
  console.log(`  ZYL:      ${ZYL_ADDRESS}`);
  console.log(`  Vesting:  ${VESTING_ADDRESS}\n`);

  // 1. Deploy TaskEscrowV2
  console.log("[1/3] Deploying TaskEscrowV2...");
  const TaskEscrowV2 = await hre.ethers.getContractFactory(
    "contracts/zyl/TaskEscrowV2.sol:TaskEscrowV2"
  );
  const escrow = await TaskEscrowV2.deploy(
    ZYL_ADDRESS,
    deployer.address, // treasury
    deployer.address, // oracle
    deployer.address  // owner
  );
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log(`      TaskEscrowV2: ${escrowAddr}`);

  // 2. Deploy SparkStaking
  console.log("\n[2/3] Deploying SparkStaking...");
  const SparkStaking = await hre.ethers.getContractFactory(
    "contracts/zyl/SparkStaking.sol:SparkStaking"
  );
  const spark = await SparkStaking.deploy(ZYL_ADDRESS, deployer.address);
  await spark.waitForDeployment();
  const sparkAddr = await spark.getAddress();
  console.log(`      SparkStaking: ${sparkAddr}`);

  // 3. Wire up contracts
  console.log("\n[3/3] Wiring contracts...");
  const ZYL = await hre.ethers.getContractAt(
    "contracts/zyl/ZYL.sol:ZYL",
    ZYL_ADDRESS
  );

  await ZYL.setBurnWhitelist(escrowAddr, true);
  console.log(`      ZYL.setBurnWhitelist(escrow, true)`);

  await escrow.setSparkStaking(sparkAddr);
  console.log(`      escrow.setSparkStaking(spark)`);

  await escrow.setRepOracle(deployer.address);
  console.log(`      escrow.setRepOracle(deployer)`);

  // Set USDC rate (Base Sepolia USDC)
  const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  await escrow.setZylRatePerToken(USDC_SEPOLIA, 100n);
  console.log(`      escrow.setZylRatePerToken(USDC, 100)`);

  await spark.setRewardDistributor(escrowAddr, true);
  console.log(`      spark.setRewardDistributor(escrow, true)`);

  // Transfer some ZYL to escrow reserve for burns
  await ZYL.transfer(escrowAddr, hre.ethers.parseEther("1000000")); // 1M ZYL
  console.log(`      Transferred 1M ZYL to escrow reserve`);

  console.log(`\n✅ ZYL Genesis testnet deploy complete!\n`);
  console.log(`─── All Deployed Addresses ───`);
  console.log(`  ZylogenDeployer: ${FACTORY_ADDRESS}`);
  console.log(`  ZYL:             ${ZYL_ADDRESS}`);
  console.log(`  TeamVesting:     ${VESTING_ADDRESS}`);
  console.log(`  TaskEscrowV2:    ${escrowAddr}`);
  console.log(`  SparkStaking:    ${sparkAddr}`);
  console.log(`\n─── Verification Commands ───`);
  console.log(`npx hardhat verify --network baseSepolia ${ZYL_ADDRESS} ${deployer.address} ${FACTORY_ADDRESS}`);
  console.log(`npx hardhat verify --network baseSepolia ${escrowAddr} ${ZYL_ADDRESS} ${deployer.address} ${deployer.address} ${deployer.address}`);
  console.log(`npx hardhat verify --network baseSepolia ${sparkAddr} ${ZYL_ADDRESS} ${deployer.address}`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
