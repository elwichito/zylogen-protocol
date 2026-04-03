"use strict";

// Usage:
//   ORACLE_ADDRESS=0x... TREASURY_ADDRESS=0x... npx hardhat run scripts/deploy.js --network base
//   ORACLE_ADDRESS=0x... TREASURY_ADDRESS=0x... npx hardhat run scripts/deploy.js --network baseSepolia

const hre    = require("hardhat");
const { ethers } = hre;

async function main() {
  const oracle   = process.env.ORACLE_ADDRESS;
  const treasury = process.env.TREASURY_ADDRESS;

  if (!ethers.isAddress(oracle)) {
    throw new Error("ORACLE_ADDRESS is missing or not a valid address");
  }
  if (!ethers.isAddress(treasury)) {
    throw new Error("TREASURY_ADDRESS is missing or not a valid address");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deployer :", deployer.address);
  console.log("Balance  :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("Oracle   :", oracle);
  console.log("Treasury :", treasury);
  console.log("");

  const TaskEscrow = await ethers.getContractFactory("TaskEscrow");
  const escrow     = await TaskEscrow.deploy(oracle, treasury);

  console.log("Deploying TaskEscrow …");
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("TaskEscrow deployed to:", address);
  console.log("");
  console.log("Verify with:");
  console.log(
    `  npx hardhat verify --network ${hre.network.name} ${address} ${oracle} ${treasury}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
