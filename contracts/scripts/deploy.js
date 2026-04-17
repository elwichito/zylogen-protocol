const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Zylogen = await ethers.getContractFactory("Zylogen");
  const zylogen = await Zylogen.deploy(deployer.address);
  await zylogen.waitForDeployment();

  const address = await zylogen.getAddress();
  console.log("Zylogen deployed to:", address);
  console.log("Set ZYLOGEN_CONTRACT_ADDRESS=" + address + " in your .env");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
