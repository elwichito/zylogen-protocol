const { ethers } = require("hardhat");

async function main() {
  const CONTRACT = "0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f";
  
  const abi = [
    "function lock(bytes32 taskHash, address provider) external payable",
    "event TaskCreated(bytes32 indexed taskHash, address indexed sender, address indexed provider, uint96 amount, uint40 deadline)"
  ];

  const [signer] = await ethers.getSigners();
  const contract = new ethers.Contract(CONTRACT, abi, signer);

  // Generate unique task hash
  const taskHash = ethers.keccak256(ethers.toUtf8Bytes("test-task-" + Date.now()));
  
  // Use the Oracle wallet as provider (sending funds to yourself for testing)
  const provider = "0x24A400E17d2b9fd9C7eDd99f358A34Fe7751D849";
  
  // Lock 0.0001 ETH (~$0.25)
  const amount = ethers.parseEther("0.0001");

  console.log("Creating test task...");
  console.log("  taskHash:", taskHash);
  console.log("  sender:", signer.address);
  console.log("  provider:", provider);
  console.log("  amount: 0.0001 ETH");

  const tx = await contract.lock(taskHash, provider, { value: amount });
  console.log("  tx hash:", tx.hash);
  
  const receipt = await tx.wait();
  console.log("  confirmed in block:", receipt.blockNumber);
  console.log("");
  console.log("Task created. Oracle should detect and validate within 60 seconds.");
  console.log("Watch Railway logs for the oracle response.");
}

main().catch(console.error);
