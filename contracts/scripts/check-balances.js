const hre = require('hardhat');

async function main() {
  const ZYL = '0x426608a34227b6edc61b2ced47ba235b4f747c4a';
  const VESTING = '0xf10ea18599e3767cfb9f07f40763d22564f8ffed';
  const ESCROW = '0x9b1516C79855F8E01A5Eb4B4E3A34430041Ae254';
  const SPARK = '0x7adBd700658264D728C5289dB093DF441Ed3Bb7d';
  const DEPLOYER = '0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e';

  const token = await hre.ethers.getContractAt('contracts/zyl/ZYL.sol:ZYL', ZYL);
  
  const format = (val) => (Number(val) / 1e18 / 1e6).toFixed(1) + 'M';
  
  console.log('\n─── ZYL Token Distribution ───');
  console.log('Total Supply:', format(await token.totalSupply()));
  console.log('');
  console.log('Your Wallet:', format(await token.balanceOf(DEPLOYER)));
  console.log('TeamVesting:', format(await token.balanceOf(VESTING)));
  console.log('TaskEscrowV2:', format(await token.balanceOf(ESCROW)));
  console.log('SparkStaking:', format(await token.balanceOf(SPARK)));
}

main();
