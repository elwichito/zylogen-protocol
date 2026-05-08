const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  const ZYL_ADDR = '0x426608a34227b6edc61b2ced47ba235b4f747c4a';
  const ESCROW_ADDR = '0x9b1516C79855F8E01A5Eb4B4E3A34430041Ae254';
  const SPARK_ADDR = '0x7adBd700658264D728C5289dB093DF441Ed3Bb7d';
  
  const zyl = await hre.ethers.getContractAt('contracts/zyl/ZYL.sol:ZYL', ZYL_ADDR);
  const escrow = await hre.ethers.getContractAt('contracts/zyl/TaskEscrowV2.sol:TaskEscrowV2', ESCROW_ADDR);
  
  const format = (val) => (Number(val) / 1e18).toLocaleString();
  
  console.log('\n═══ Estado Actual del Sistema ═══\n');
  
  // Balances
  console.log('📊 BALANCES ZYL:');
  console.log('   Tu Wallet:', format(await zyl.balanceOf(deployer.address)), 'ZYL');
  console.log('   Escrow:', format(await zyl.balanceOf(ESCROW_ADDR)), 'ZYL');
  console.log('   SparkStaking:', format(await zyl.balanceOf(SPARK_ADDR)), 'ZYL');
  console.log('   Total Supply:', format(await zyl.totalSupply()), 'ZYL');
  
  // Escrow config
  console.log('\n⚙️  CONFIGURACIÓN ESCROW:');
  console.log('   Treasury:', await escrow.treasury());
  console.log('   Oracle:', await escrow.oracle());
  console.log('   ZYL Rate:', (await escrow.zylRatePerToken(ZYL_ADDR)).toString());
  
  // Fee structure
  console.log('\n💰 ESTRUCTURA DE FEES (para rep=0):');
  const feeBps = await escrow.getFeeBps(0);
  console.log('   Total Fee:', feeBps.toString(), 'bps (', Number(feeBps)/100, '%)');
  
  // Burned check
  const initialSupply = hre.ethers.parseEther('1000000000'); // 1B
  const currentSupply = await zyl.totalSupply();
  const burned = initialSupply - currentSupply;
  console.log('\n🔥 TOTAL QUEMADO:', format(burned), 'ZYL');
}

main().catch(console.error);
