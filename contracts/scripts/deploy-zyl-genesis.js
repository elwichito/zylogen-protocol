/**
 * ZYL Genesis — atomic deployment script for Base Mainnet.
 *
 * Prerequisites (loaded via env, fail-loud if missing):
 *   MULTISIG_ADDRESS          — 3-of-5 Safe (treasury + ZYL owner)
 *   STAKING_POOL_ADDRESS      — recipient of 400M community/staking allocation
 *                                (typically a separate Safe controlling SparkStaking emissions)
 *   LP_RESERVE_ADDRESS        — recipient of 150M for Aerodrome LP seeding
 *                                (private mempool tx; do NOT send to Tornado-style mixer)
 *   GRANTS_MULTISIG_ADDRESS   — recipient of 100M ecosystem grants
 *   TEAM_BENEFICIARIES        — comma-separated, sums to 150M
 *   TEAM_AMOUNTS              — comma-separated, in whole ZYL
 *   ORACLE_SETTLE_ADDRESS     — settle/refund oracle key (HSM-backed in prod)
 *   ORACLE_REP_ADDRESS        — separate rep oracle key (Vector 1.4)
 *   ORACLE_SLASH_ADDRESS      — separate slash oracle (2-of-3 multisig in prod)
 *   USDC_ADDRESS              — Base USDC
 *   ZYL_RATE_USDC             — ZYL wei per smallest USDC unit (multisig calibrates post-deploy)
 *
 * Phase 0 gating:
 *   This script will REFUSE to deploy on Base mainnet (chainId 8453) unless
 *   AUDIT_PASSED=true is explicitly set in the env. This is the spec's
 *   Section VII Phase 1 gate enforced at deploy time.
 */

const hre = require("hardhat");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function parseAddrList(name) {
  return need(name).split(",").map((s) => s.trim()).filter(Boolean);
}

function parseAmountList(name) {
  return need(name).split(",").map((s) => hre.ethers.parseEther(s.trim()));
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`\n→ Deploying ZYL Genesis on chainId=${chainId}`);

  if (chainId === 8453 && process.env.AUDIT_PASSED !== "true") {
    throw new Error(
      "Mainnet deploy blocked. Set AUDIT_PASSED=true after both audits clear (spec §VII gate)."
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`  deployer EOA: ${deployer.address}`);

  const params = {
    multisig: need("MULTISIG_ADDRESS"),
    stakingPool: need("STAKING_POOL_ADDRESS"),
    lpReserve: need("LP_RESERVE_ADDRESS"),
    grantsMultisig: need("GRANTS_MULTISIG_ADDRESS"),
    teamBeneficiaries: parseAddrList("TEAM_BENEFICIARIES"),
    teamAmounts: parseAmountList("TEAM_AMOUNTS"),
    vestStart: BigInt(Math.floor(Date.now() / 1000)),
  };

  // 1. Atomic factory deploy.
  console.log("\n[1/4] Deploying ZylogenDeployer factory…");
  const Factory = await hre.ethers.getContractFactory(
    "contracts/zyl/ZylogenDeployer.sol:ZylogenDeployer"
  );
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  console.log(`      factory: ${await factory.getAddress()}`);

  console.log("\n[2/4] Atomic deploy: ZYL + TeamVesting + 1B distribution…");
  const tx = await factory.deploy(params);
  const receipt = await tx.wait();
  const zylAddr = await factory.deployedZYL();
  const vestingAddr = await factory.deployedVesting();
  console.log(`      ZYL:         ${zylAddr}`);
  console.log(`      TeamVesting: ${vestingAddr}`);
  console.log(`      tx: ${receipt.hash}`);

  // 2. Deploy TaskEscrowV2 with multisig as owner.
  console.log("\n[3/4] Deploying TaskEscrowV2 (ZYL Genesis)…");
  const TaskEscrowV2 = await hre.ethers.getContractFactory(
    "contracts/zyl/TaskEscrowV2.sol:TaskEscrowV2"
  );
  const escrow = await TaskEscrowV2.deploy(
    zylAddr,
    params.multisig,                  // treasury
    need("ORACLE_SETTLE_ADDRESS"),    // oracle (settle/refund)
    params.multisig                   // owner = multisig
  );
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log(`      TaskEscrowV2: ${escrowAddr}`);

  // 3. Deploy SparkStaking with multisig as owner.
  console.log("\n[4/4] Deploying SparkStaking…");
  const SparkStaking = await hre.ethers.getContractFactory(
    "contracts/zyl/SparkStaking.sol:SparkStaking"
  );
  const spark = await SparkStaking.deploy(zylAddr, params.multisig);
  await spark.waitForDeployment();
  const sparkAddr = await spark.getAddress();
  console.log(`      SparkStaking: ${sparkAddr}`);

  console.log(`\n✅ Atomic deploy complete.\n`);
  console.log("Post-deploy multisig actions (each via standard 7-day timelock):");
  console.log(`  1. ZYL.setBurnWhitelist(${escrowAddr}, true)`);
  console.log(`  2. TaskEscrowV2.setSparkStaking(${sparkAddr})`);
  console.log(`  3. TaskEscrowV2.setRepOracle(${need("ORACLE_REP_ADDRESS")})`);
  console.log(`  4. TaskEscrowV2.setZylRatePerToken(${need("USDC_ADDRESS")}, ${need("ZYL_RATE_USDC")})`);
  console.log(`  5. SparkStaking.setRewardDistributor(${escrowAddr}, true)`);
  console.log(`  6. (Phase 4) AgentID deploy + SparkStaking.setAgentID(<agentid>)`);
  console.log(`  7. Top up TaskEscrowV2 ZYL reserve from treasury for burn+spark crystallization`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
