#!/usr/bin/env node
"use strict";

/**
 * ONE-SHOT SCRIPT: Release 18 USDC from two test locks in TaskEscrowV2.
 * Run locally: cd backend && node scripts/recover-test-escrows.js
 * DELETE THIS FILE after successful execution.
 */

// On Railway, env vars are injected directly. Locally, load from .env.
try { require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") }); } catch {}

const { ethers } = require("ethers");

// ─── Config ─────────────────────────────────────────────────────────────────

const TASK_ESCROW_ADDRESS = "0xBE464859Fb6f09fa93b6212f616F3AD19ebe48B1";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NOVA_WORKER = "0x9e80b1aa9c7C2a8B875CC569D8E30cEfB364c9aD";
const EXPECTED_AMOUNT = BigInt(9_000_000); // 9 USDC each

const TASKS = [
  {
    label: "Task 1",
    taskId: "0xf3c8dfa4461430489327ae90ba013179cdebf5bf774298af0eeff1f3a835789c",
    sourceTx: "0xb6e637cb6c59e26acc02d7d838ccb2c899b6927e96195794ab11ac0b8651b172",
  },
  {
    label: "Task 2",
    taskId: "0xc06cb1151932c068784deb948c53e8f6f7baf01524ba9077eee384b42688399e",
    sourceTx: "0xca14f07bff8603c745d53e04daef2df63e0b8c81af785205e5c116851d21d1fc",
  },
];

const ESCROW_ABI = [
  "function release(bytes32 taskId) external",
  "function refund(bytes32 taskId) external",
  "function getTask(bytes32 taskId) external view returns (tuple(address client, address worker, uint256 amount, uint256 deadline, uint8 status))",
  "function oracle() external view returns (address)",
  "function collectedFees() external view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
];

// Task status enum from contract: 0=None, 1=Locked, 2=Released, 3=Refunded
const STATUS_NAMES = ["None", "Locked", "Released", "Refunded"];

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  ESCROW RELEASE — TaskEscrowV2 Recovery Script");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── Connect ───────────────────────────────────────────────────────────

  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let pk = process.env.RELAYER_PRIVATE_KEY || "";
  if (!pk) {
    console.error("ABORT: RELAYER_PRIVATE_KEY not set in .env");
    process.exit(1);
  }
  if (!pk.startsWith("0x")) pk = "0x" + pk;

  const relayer = new ethers.Wallet(pk, provider);
  console.log(`Oracle wallet:  ${relayer.address}`);
  console.log(`RPC:            ${rpcUrl}\n`);

  const escrow = new ethers.Contract(TASK_ESCROW_ADDRESS, ESCROW_ABI, relayer);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

  // ── Safety check 1: Oracle address matches ────────────────────────────

  const contractOracle = await escrow.oracle();
  if (contractOracle.toLowerCase() !== relayer.address.toLowerCase()) {
    console.error(`ABORT: Oracle mismatch. Contract oracle: ${contractOracle}, our wallet: ${relayer.address}`);
    process.exit(1);
  }
  console.log("✓ Oracle address verified\n");

  // ── Safety check 2: Gas balance ───────────────────────────────────────

  const ethBalance = await provider.getBalance(relayer.address);
  const ethFormatted = ethers.formatEther(ethBalance);
  console.log(`Oracle ETH balance: ${ethFormatted} ETH`);

  if (ethBalance < ethers.parseEther("0.0005")) {
    console.error(`ABORT: Insufficient gas. Need >= 0.0005 ETH, have ${ethFormatted}`);
    process.exit(1);
  }
  console.log("✓ Sufficient gas\n");

  // ── Safety check 3: Verify both tasks are Locked ──────────────────────

  console.log("─── Pre-flight task verification ───────────────────────\n");

  for (const t of TASKS) {
    const task = await escrow.getTask(t.taskId);
    const statusNum = Number(task.status ?? task[4]);
    const statusName = STATUS_NAMES[statusNum] ?? `Unknown(${statusNum})`;
    const amount = BigInt(task.amount ?? task[2]);

    console.log(`${t.label}: ${t.taskId}`);
    console.log(`  Status:   ${statusName}`);
    console.log(`  Client:   ${task.client ?? task[0]}`);
    console.log(`  Worker:   ${task.worker ?? task[1]}`);
    console.log(`  Amount:   ${amount} (${Number(amount) / 1e6} USDC)`);
    console.log(`  Deadline: ${task.deadline ?? task[3]}`);
    console.log();

    if (statusNum !== 1) {
      console.error(`ABORT: ${t.label} is not Locked (status=${statusName}). Cannot release.`);
      process.exit(1);
    }
    if (amount !== EXPECTED_AMOUNT) {
      console.error(`ABORT: ${t.label} amount mismatch. Expected ${EXPECTED_AMOUNT}, got ${amount}.`);
      process.exit(1);
    }
  }

  console.log("✓ Both tasks verified: Locked, 9 USDC each\n");

  // ── Capture balances before ───────────────────────────────────────────

  const workerBalBefore = await usdc.balanceOf(NOVA_WORKER);
  const escrowBalBefore = await usdc.balanceOf(TASK_ESCROW_ADDRESS);
  const feesBefore = await escrow.collectedFees();

  console.log("─── Balances BEFORE release ────────────────────────────");
  console.log(`  Worker (${NOVA_WORKER}):  ${Number(workerBalBefore) / 1e6} USDC`);
  console.log(`  Escrow contract:              ${Number(escrowBalBefore) / 1e6} USDC`);
  console.log(`  Collected fees:               ${Number(feesBefore) / 1e6} USDC\n`);

  // ── Execute release #1 ────────────────────────────────────────────────

  console.log("─── Releasing Task 1 ──────────────────────────────────\n");
  const tx1 = await escrow.release(TASKS[0].taskId);
  console.log(`  Tx submitted: ${tx1.hash}`);
  const receipt1 = await tx1.wait();
  console.log(`  Confirmed in block ${receipt1.blockNumber} (gas: ${receipt1.gasUsed})\n`);

  // ── Execute release #2 ────────────────────────────────────────────────

  console.log("─── Releasing Task 2 ──────────────────────────────────\n");
  const tx2 = await escrow.release(TASKS[1].taskId);
  console.log(`  Tx submitted: ${tx2.hash}`);
  const receipt2 = await tx2.wait();
  console.log(`  Confirmed in block ${receipt2.blockNumber} (gas: ${receipt2.gasUsed})\n`);

  // ── Capture balances after ────────────────────────────────────────────

  const workerBalAfter = await usdc.balanceOf(NOVA_WORKER);
  const escrowBalAfter = await usdc.balanceOf(TASK_ESCROW_ADDRESS);
  const feesAfter = await escrow.collectedFees();
  const ethBalanceAfter = await provider.getBalance(relayer.address);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  RELEASE COMPLETE — SUMMARY");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log(`  Release #1 tx: ${receipt1.hash}`);
  console.log(`  Release #2 tx: ${receipt2.hash}\n`);

  console.log(`  Worker USDC:   ${Number(workerBalBefore) / 1e6} → ${Number(workerBalAfter) / 1e6} USDC (+${Number(workerBalAfter - workerBalBefore) / 1e6})`);
  console.log(`  Escrow USDC:   ${Number(escrowBalBefore) / 1e6} → ${Number(escrowBalAfter) / 1e6} USDC (${Number(escrowBalAfter - escrowBalBefore) / 1e6})`);
  console.log(`  Fees collected: ${Number(feesBefore) / 1e6} → ${Number(feesAfter) / 1e6} USDC (+${Number(feesAfter - feesBefore) / 1e6})`);
  console.log(`  Gas spent:     ${ethFormatted} → ${ethers.formatEther(ethBalanceAfter)} ETH (${ethers.formatEther(ethBalance - ethBalanceAfter)} ETH used)\n`);

  console.log("  ⚠️  DELETE this script now: rm backend/scripts/recover-test-escrows.js");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
