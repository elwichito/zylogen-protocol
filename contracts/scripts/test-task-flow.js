const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  // Addresses
  const ZYL_ADDR = '0x426608a34227b6edc61b2ced47ba235b4f747c4a';
  const ESCROW_ADDR = '0x9b1516C79855F8E01A5Eb4B4E3A34430041Ae254';
  const USDC_ADDR = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  
  // Check USDC balance
  const usdc = await hre.ethers.getContractAt('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20', USDC_ADDR);
  const usdcBalance = await usdc.balanceOf(deployer.address);
  
  console.log('\n─── Checking Balances ───');
  console.log('Your wallet:', deployer.address);
  console.log('USDC balance:', hre.ethers.formatUnits(usdcBalance, 6), 'USDC');
  
  if (usdcBalance < 1000000n) { // Less than 1 USDC
    console.log('\n⚠️  Necesitas USDC de testnet!');
    console.log('   Faucet: https://faucet.circle.com/');
    console.log('   Selecciona "Base Sepolia" y pega tu wallet address');
    return;
  }
  
  console.log('\n✅ Tienes suficiente USDC para probar');
}

main().catch(console.error);
