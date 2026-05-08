const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  // Addresses
  const ZYL_ADDR = '0x426608a34227b6edc61b2ced47ba235b4f747c4a';
  const ESCROW_ADDR = '0x9b1516C79855F8E01A5Eb4B4E3A34430041Ae254';
  
  const zyl = await hre.ethers.getContractAt('contracts/zyl/ZYL.sol:ZYL', ZYL_ADDR);
  const escrow = await hre.ethers.getContractAt('contracts/zyl/TaskEscrowV2.sol:TaskEscrowV2', ESCROW_ADDR);
  
  const format = (val) => (Number(val) / 1e18).toLocaleString() + ' ZYL';
  
  console.log('\n═══════════════════════════════════════════════');
  console.log('       🧪 TEST: Flujo Completo de Tarea');
  console.log('═══════════════════════════════════════════════\n');
  
  // Initial balances
  const initialBalance = await zyl.balanceOf(deployer.address);
  const escrowInitial = await zyl.balanceOf(ESCROW_ADDR);
  const initialSupply = await zyl.totalSupply();
  console.log('📊 BALANCES INICIALES:');
  console.log('   Tu wallet:', format(initialBalance));
  console.log('   Escrow:', format(escrowInitial));
  console.log('   Supply:', format(initialSupply));
  
  // Step 1: Set ZYL rate (owner only - we're the owner on testnet)
  console.log('\n[1/5] Configurando ZYL como token de pago...');
  const zylRate = 1n; // 1:1 rate for testing
  await escrow.setZylRatePerToken(ZYL_ADDR, zylRate);
  console.log('      ✅ ZYL rate configurado: 1:1');
  
  // Step 2: Approve escrow to spend ZYL
  console.log('\n[2/5] Aprobando ZYL para el escrow...');
  const lockAmount = hre.ethers.parseEther('1000'); // 1000 ZYL
  await zyl.approve(ESCROW_ADDR, lockAmount);
  console.log('      ✅ Aprobado:', format(lockAmount));
  
  // Step 3: Lock task (create escrow)
  console.log('\n[3/5] Creando tarea (lock en escrow)...');
  const taskId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('test-task-' + Date.now()));
  const clientAddress = deployer.address;
  const workerAddress = deployer.address;
  const agentAddress = deployer.address;
  const sponsorRoot = hre.ethers.ZeroHash;
  
  const tx = await escrow.lock(
    taskId,
    clientAddress,
    workerAddress,
    agentAddress,
    ZYL_ADDR,
    lockAmount,
    sponsorRoot
  );
  await tx.wait();
  console.log('      ✅ Tarea creada!');
  console.log('      📋 Task ID:', taskId.slice(0, 18) + '...');
  
  // Step 4: Settle task (release payment to worker)
  console.log('\n[4/5] Completando tarea (settle)...');
  const settleTx = await escrow.settle(taskId);
  await settleTx.wait();
  console.log('      ✅ Tarea completada!');
  
  // Step 5: Final balances
  console.log('\n[5/5] Verificando balances finales...');
  const finalBalance = await zyl.balanceOf(deployer.address);
  const escrowFinal = await zyl.balanceOf(ESCROW_ADDR);
  const finalSupply = await zyl.totalSupply();
  
  console.log('\n📊 BALANCES FINALES:');
  console.log('   Tu wallet:', format(finalBalance));
  console.log('   Escrow:', format(escrowFinal));
  console.log('   Supply:', format(finalSupply));
  
  // Calculate changes
  const walletChange = finalBalance - initialBalance;
  const burned = initialSupply - finalSupply;
  
  console.log('\n📈 CAMBIOS:');
  console.log('   Wallet cambio:', format(walletChange));
  console.log('   🔥 ZYL quemados:', format(burned));
  
  console.log('\n═══════════════════════════════════════════════');
  console.log('       ✅ TEST COMPLETADO EXITOSAMENTE');
  console.log('═══════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
