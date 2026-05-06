/**
 * ZYL Genesis — Base Sepolia testnet deployment.
 *
 * Uses deployer address for all roles (multisig, oracles, etc.) for testing.
 * Run: npx hardhat run scripts/deploy-zyl-testnet.js --network baseSepolia
 */

const hre = require("hardhat");

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 84532) {
    throw new Error(`Expected Base Sepolia (84532), got chainId=${chainId}`);
  }

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`\n─── ZYL Genesis Testnet Deploy ───`);
  console.log(`  Network:  Base Sepolia (${chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance:  ${hre.ethers.formatEther(balance)} ETH\n`);

  if (balance < hre.ethers.parseEther("0.01")) {
    throw new Error("Deployer needs at least 0.01 ETH for gas");
  }

  // For testnet, deployer acts as all roles
  const testParams = {
    multisig: deployer.address,
    stakingPool: deployer.address,
    lpReserve: deployer.address,
    grantsMultisig: deployer.address,
    teamBeneficiaries: [deployer.address],
    teamAmounts: [hre.ethers.parseEther("150000000")], // 150M to deployer
    vestStart: BigInt(Math.floor(Date.now() / 1000)),
  };

  // 1. Deploy ZylogenDeployer factory
  console.log("[1/5] Deploying ZylogenDeployer factory...");
  const Factory = await hre.ethers.getContractFactory(
    "contracts/zyl/ZylogenDeployer.sol:ZylogenDeployer"
  );
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log(`      Factory: ${factoryAddr}`);

  // 2. Atomic deploy: ZYL + TeamVesting + 1B distribution
  console.log("\n[2/5] Atomic deploy: ZYL + TeamVesting + distribution...");
  const tx = await factory.deploy(testParams);
  const receipt = await tx.wait();
  const zylAddr = await factory.deployedZYL();
  const vestingAddr = await factory.deployedVesting();
  console.log(`      ZYL:         ${zylAddr}`);
  console.log(`      TeamVesting: ${vestingAddr}`);
  console.log(`      Gas used:    ${receipt.gasUsed.toString()}`);

  // 3. Deploy TaskEscrowV2 (ZYL Genesis)
  console.log("\n[3/5] Deploying TaskEscrowV2...");
  const TaskEscrowV2 = await hre.ethers.getContractFactory(
    "contracts/zyl/TaskEscrowV2.sol:TaskEscrowV2"
  );
  const escrow = await TaskEscrowV2.deploy(
    zylAddr,
    deployer.address, // treasury
    deployer.address, // oracle
    deployer.address  // owner
  );
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log(`      TaskEscrowV2: ${escrowAddr}`);

  // 4. Deploy SparkStaking
  console.log("\n[4/5] Deploying SparkStaking...");
  const SparkStaking = await hre.ethers.getContractFactory(
    "contracts/zyl/SparkStaking.sol:SparkStaking"
  );
  const spark = await SparkStaking.deploy(zylAddr, deployer.address);
  await spark.waitForDeployment();
  const sparkAddr = await spark.getAddress();
  console.log(`      SparkStaking: ${sparkAddr}`);

  // 5. Wire up contracts (normally multisig does this)
  console.log("\n[5/5] Wiring contracts (testnet auto-config)...");
  const ZYL = await hre.ethers.getContractAt(
    "contracts/zyl/ZYL.sol:ZYL",
    zylAddr
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
  console.log(`─── Deployed Addresses ───`);
  console.log(`  ZylogenDeployer: ${factoryAddr}`);
  console.log(`  ZYL:             ${zylAddr}`);
  console.log(`  TeamVesting:     ${vestingAddr}`);
  console.log(`  TaskEscrowV2:    ${escrowAddr}`);
  console.log(`  SparkStaking:    ${sparkAddr}`);
  console.log(`\n─── Verification Commands ───`);
  console.log(`npx hardhat verify --network baseSepolia ${zylAddr} ${deployer.address} ${factoryAddr}`);
  console.log(`npx hardhat verify --network baseSepolia ${escrowAddr} ${zylAddr} ${deployer.address} ${deployer.address} ${deployer.address}`);
  console.log(`npx hardhat verify --network baseSepolia ${sparkAddr} ${zylAddr} ${deployer.address}`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
