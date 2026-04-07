'use strict';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { ethers } = require('ethers');
const Anthropic  = require('@anthropic-ai/sdk');

// ── Config ────────────────────────────────────────────────────────────────────

const PORT             = process.env.PORT || 3000;
const CONTRACT_ADDRESS = '0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f';
const BASE_MAINNET_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;

const ABI = [
  'event TaskCreated(bytes32 indexed taskHash, address indexed sender, address indexed provider, uint96 amount, uint40 deadline)',
  'event TaskReleased(bytes32 indexed taskHash, address indexed provider, uint96 providerAmount, uint96 fee)',
  'function release(bytes32 taskHash)',
  'function escrows(bytes32) view returns (address sender, uint96 amount, address provider, uint40 deadline)',
];

// ── Validation ────────────────────────────────────────────────────────────────

if (!ORACLE_PRIVATE_KEY) { console.error('[oracle] ORACLE_PRIVATE_KEY not set'); process.exit(1); }
if (!ANTHROPIC_API_KEY)  { console.error('[oracle] ANTHROPIC_API_KEY not set');  process.exit(1); }

// ── Setup ─────────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(BASE_MAINNET_RPC);
const wallet   = new ethers.Wallet(ORACLE_PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
const claude   = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ── In-Memory Task Store ──────────────────────────────────────────────────────

const tasks = new Map();

// Task states: OPEN → SUBMITTED → EVALUATING → RELEASED / REJECTED
// {
//   taskHash, title, description, sender, provider, amount, deadline,
//   status: 'open' | 'submitted' | 'evaluating' | 'released' | 'rejected',
//   submission: null | { content, submittedAt },
//   evaluation: null | { approved, reason, evaluatedAt },
//   txHash: null | string
// }

// ── Express API ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', tasks: tasks.size, uptime: process.uptime() });
});

// Register task description (called by frontend after lock())
app.post('/api/tasks', (req, res) => {
  const { taskHash, title, description, sender, provider: prov } = req.body;
  if (!taskHash || !title || !description) {
    return res.status(400).json({ error: 'taskHash, title, and description required' });
  }

  if (tasks.has(taskHash)) {
    return res.status(409).json({ error: 'Task already registered' });
  }

  tasks.set(taskHash, {
    taskHash, title, description,
    sender: sender || 'unknown',
    provider: prov || 'unknown',
    amount: null, deadline: null,
    status: 'open',
    submission: null,
    evaluation: null,
    txHash: null,
    createdAt: new Date().toISOString()
  });

  console.log(`[api] Task registered: ${taskHash} — "${title}"`);
  res.json({ ok: true, taskHash });
});

// Worker submits deliverable
app.post('/api/tasks/:taskHash/submit', (req, res) => {
  const { taskHash } = req.params;
  const { content, workerAddress } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'content is required' });
  }

  const task = tasks.get(taskHash);
  if (!task) {
    return res.status(404).json({ error: 'Task not found. Post task description first.' });
  }
  if (task.status !== 'open' && task.status !== 'rejected') {
    return res.status(400).json({ error: `Task is ${task.status}, cannot submit` });
  }

  task.submission = {
    content: content.slice(0, 10000),
    workerAddress: workerAddress || task.provider,
    submittedAt: new Date().toISOString()
  };
  task.status = 'submitted';

  console.log(`[api] Submission received for ${taskHash} — evaluating with Claude...`);
  
  // Trigger async evaluation
  evaluateSubmission(taskHash).catch(err => {
    console.error(`[api] Evaluation error for ${taskHash}:`, err.message);
  });

  res.json({ ok: true, status: 'submitted', message: 'Work submitted. AI oracle is evaluating...' });
});

// Get task details
app.get('/api/tasks/:taskHash', (req, res) => {
  const task = tasks.get(req.params.taskHash);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// List all tasks
app.get('/api/tasks', (req, res) => {
  const list = Array.from(tasks.values()).sort((a, b) => 
    new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json(list);
});

// ── Content Evaluation with Claude ────────────────────────────────────────────

async function evaluateSubmission(taskHash) {
  const task = tasks.get(taskHash);
  if (!task || !task.submission) return;

  task.status = 'evaluating';
  console.log(`[oracle] Evaluating submission for "${task.title}"...`);

  const prompt = `You are an AI oracle that validates task completion for an escrow payment system.

TASK POSTED BY CLIENT:
  Title: ${task.title}
  Description: ${task.description}

WORK SUBMITTED BY PROVIDER:
${task.submission.content}

EVALUATION CRITERIA:
1. Does the submitted work match what was requested in the task description?
2. Is the work substantive and not empty/placeholder content?
3. Does the quality meet a reasonable standard for the task?
4. Is the submission relevant to the task title and description?

You are protecting the client's money. Only approve if the work genuinely fulfills the task requirements.
If the submission is empty, irrelevant, low-effort, or does not match the description, reject it.

Respond with exactly one word first: APPROVE or REJECT
Then on the same line after a dash, give a brief reason (max 50 words).

Examples:
APPROVE - The blog post covers AI agents thoroughly, includes 500+ words, and addresses all requirements.
REJECT - The submission is only 2 sentences and does not meet the 500-word requirement.
REJECT - The submitted content is about cooking, not AI agents as requested.`;

  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    const approved = text.toUpperCase().startsWith('APPROVE');
    
    task.evaluation = {
      approved,
      reason: text,
      evaluatedAt: new Date().toISOString()
    };

    console.log(`[oracle] Claude evaluation for "${task.title}": ${text}`);

    if (approved) {
      // Check if escrow still exists on-chain before releasing
      try {
        const escrow = await contract.escrows(taskHash);
        if (BigInt(escrow.amount) === 0n) {
          console.log(`[oracle] Escrow already settled for ${taskHash} — skipping`);
          task.status = 'released';
          return;
        }
      } catch (e) {
        console.error(`[oracle] Error checking escrow:`, e.message);
      }

      await releaseTask(taskHash);
      task.status = 'released';
    } else {
      task.status = 'rejected';
      console.log(`[oracle] Task "${task.title}" REJECTED — funds remain in escrow`);
    }
  } catch (err) {
    console.error(`[oracle] Claude evaluation error:`, err.message);
    task.status = 'open'; // Reset to allow retry
    task.submission = null;
  }
}

// ── Release ───────────────────────────────────────────────────────────────────

async function releaseTask(taskHash) {
  console.log(`[oracle] Sending release(${taskHash})...`);
  try {
    const tx = await contract.release(taskHash);
    console.log(`[oracle] TX submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[oracle] TX confirmed in block ${receipt.blockNumber}`);
    
    const task = tasks.get(taskHash);
    if (task) task.txHash = tx.hash;
  } catch (err) {
    console.error(`[oracle] release() failed:`, err.shortMessage ?? err.message);
  }
}

// ── On-Chain Event Listener ───────────────────────────────────────────────────

async function handleTaskCreated(taskHash, sender, provider_, amount, deadline, event) {
  console.log(`[oracle] TaskCreated detected on-chain`);
  console.log(`         taskHash : ${taskHash}`);
  console.log(`         sender   : ${sender}`);
  console.log(`         provider : ${provider_}`);
  console.log(`         amount   : ${ethers.formatEther(amount)} ETH`);
  console.log(`         deadline : ${new Date(Number(deadline) * 1000).toISOString()}`);
  console.log(`         block    : ${event.log?.blockNumber ?? 'unknown'}`);

  // Update task if already registered via API, or create new entry
  if (tasks.has(taskHash)) {
    const task = tasks.get(taskHash);
    task.amount = ethers.formatEther(amount);
    task.deadline = new Date(Number(deadline) * 1000).toISOString();
    task.sender = sender;
    task.provider = provider_;
    console.log(`[oracle] Task "${task.title}" confirmed on-chain — waiting for worker submission`);
  } else {
    // Task created directly via contract (not through our UI)
    tasks.set(taskHash, {
      taskHash,
      title: 'Direct Contract Task',
      description: 'Task created directly on-chain without description',
      sender,
      provider: provider_,
      amount: ethers.formatEther(amount),
      deadline: new Date(Number(deadline) * 1000).toISOString(),
      status: 'open',
      submission: null,
      evaluation: null,
      txHash: null,
      createdAt: new Date().toISOString()
    });
    console.log(`[oracle] Waiting 5s for possible API registration...`);
    await new Promise(r => setTimeout(r, 5000));
    const updatedTask = tasks.get(taskHash);
    if (updatedTask && updatedTask.title !== "Direct Contract Task") {
      console.log(`[oracle] Task registered via API — waiting for worker submission`);
      return;
    }
    console.log(`[oracle] No API registration — treating as direct contract task`);
    
    // For direct contract tasks without descriptions, do basic validation and release
    const nowMs = Date.now();
    const deadlineMs = Number(deadline) * 1000;
    if (deadlineMs > nowMs && BigInt(amount.toString()) > 0n && sender !== provider_) {
      console.log(`[oracle] Direct task passes basic validation — auto-releasing`);
      await releaseTask(taskHash);
      const task = tasks.get(taskHash);
      if (task) task.status = 'released';
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const network = await provider.getNetwork();
  console.log(`[oracle] Connected to network: ${network.name} (chainId ${network.chainId})`);

  const oracleAddress = await wallet.getAddress();
  console.log(`[oracle] Oracle wallet  : ${oracleAddress}`);
  console.log(`[oracle] Contract       : ${CONTRACT_ADDRESS}`);
  console.log(`[oracle] API server     : port ${PORT}`);
  console.log(`[oracle] Mode           : CONTENT EVALUATION`);
  console.log(`[oracle] Listening for TaskCreated events...`);

  // Listen for on-chain events
  contract.on('TaskCreated', handleTaskCreated);

  // Start API server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[oracle] API ready at http://0.0.0.0:${PORT}`);
    console.log(`[oracle] Endpoints:`);
    console.log(`         POST /api/tasks              — register task description`);
    console.log(`         POST /api/tasks/:hash/submit  — submit work for evaluation`);
    console.log(`         GET  /api/tasks/:hash         — get task status`);
    console.log(`         GET  /api/tasks               — list all tasks`);
    console.log(`         GET  /health                  — health check`);
  });

  // Heartbeat
  setInterval(() => {
    console.log(`[oracle] Heartbeat — ${new Date().toISOString()} — ${tasks.size} tasks tracked`);
  }, 60_000);
}

main().catch(err => {
  console.error('[oracle] Fatal error:', err);
  process.exit(1);
});
