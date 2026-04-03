'use strict';

require('dotenv').config();
const { ethers } = require('ethers');
const Anthropic = require('@anthropic-ai/sdk');

// ── Config ────────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = '0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f';
const BASE_MAINNET_RPC  = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;

// Minimal ABI — only what the oracle needs
const ABI = [
  'event TaskCreated(bytes32 indexed taskHash, address indexed sender, address indexed provider, uint96 amount, uint40 deadline)',
  'function release(bytes32 taskHash)',
];

// ── Validation ────────────────────────────────────────────────────────────────

if (!ORACLE_PRIVATE_KEY) {
  console.error('[oracle] ORACLE_PRIVATE_KEY is not set');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('[oracle] ANTHROPIC_API_KEY is not set');
  process.exit(1);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(BASE_MAINNET_RPC);
const wallet   = new ethers.Wallet(ORACLE_PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
const claude   = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ── Claude validation ─────────────────────────────────────────────────────────

/**
 * Ask Claude whether the task should be released.
 * Returns true if approved, false otherwise.
 */
async function validateWithClaude(taskHash, sender, provider_, amount, deadline) {
  const deadlineDate = new Date(Number(deadline) * 1000).toISOString();
  const amountEth    = ethers.formatEther(amount);

  const prompt = `You are a validation oracle for a smart-contract escrow system on Base Mainnet.
A new task has been submitted and requires your approval before funds are released.

Task details:
  taskHash : ${taskHash}
  sender   : ${sender}
  provider : ${provider_}
  amount   : ${amountEth} ETH (${amount.toString()} wei)
  deadline : ${deadlineDate}

Validation rules:
1. The amount must be greater than 0.
2. The deadline must be in the future (current time: ${new Date().toISOString()}).
3. The sender and provider addresses must be distinct, non-zero addresses.
4. The taskHash must be a valid 32-byte hex string (0x-prefixed, 66 chars).

Based solely on these rules, should this task's escrow be released to the provider?

Respond with exactly one word: APPROVE or REJECT, followed by a brief reason on the same line.
Example: APPROVE - all fields are valid and deadline is in the future.`;

  const response = await claude.messages.create({
    model     : 'claude-sonnet-4-20250514',
    max_tokens: 256,
    messages  : [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  console.log(`[oracle] Claude response for ${taskHash}: ${text}`);
  return text.toUpperCase().startsWith('APPROVE');
}

// ── Release ───────────────────────────────────────────────────────────────────

async function releaseTask(taskHash) {
  console.log(`[oracle] Sending release(${taskHash}) …`);
  try {
    const tx      = await contract.release(taskHash);
    console.log(`[oracle] TX submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[oracle] TX confirmed in block ${receipt.blockNumber}`);
  } catch (err) {
    console.error(`[oracle] release() failed for ${taskHash}:`, err.shortMessage ?? err.message);
  }
}

// ── Event handler ─────────────────────────────────────────────────────────────

async function handleTaskCreated(taskHash, sender, provider_, amount, deadline, event) {
  console.log(`[oracle] TaskCreated detected`);
  console.log(`         taskHash : ${taskHash}`);
  console.log(`         sender   : ${sender}`);
  console.log(`         provider : ${provider_}`);
  console.log(`         amount   : ${ethers.formatEther(amount)} ETH`);
  console.log(`         deadline : ${new Date(Number(deadline) * 1000).toISOString()}`);
  console.log(`         block    : ${event.log?.blockNumber ?? 'unknown'}`);

  let approved;
  try {
    approved = await validateWithClaude(taskHash, sender, provider_, amount, deadline);
  } catch (err) {
    console.error(`[oracle] Claude validation error for ${taskHash}:`, err.message);
    return;
  }

  if (approved) {
    await releaseTask(taskHash);
  } else {
    console.log(`[oracle] Task ${taskHash} rejected — skipping release`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Verify connectivity
  const network = await provider.getNetwork();
  console.log(`[oracle] Connected to network: ${network.name} (chainId ${network.chainId})`);

  const oracleAddress = await wallet.getAddress();
  console.log(`[oracle] Oracle wallet  : ${oracleAddress}`);
  console.log(`[oracle] Contract       : ${CONTRACT_ADDRESS}`);
  console.log(`[oracle] Listening for TaskCreated events …`);

  contract.on('TaskCreated', handleTaskCreated);

  // Keep process alive; log heartbeat every 60 s
  setInterval(() => {
    console.log(`[oracle] Heartbeat — ${new Date().toISOString()}`);
  }, 60_000);
}

main().catch(err => {
  console.error('[oracle] Fatal error:', err);
  process.exit(1);
});
