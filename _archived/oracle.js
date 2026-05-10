'use strict';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { ethers } = require('ethers');
const Anthropic  = require('@anthropic-ai/sdk');
const { OpenAI } = require('openai');
const { Pool }   = require('pg');

// ── Config ────────────────────────────────────────────────────────────────────

const PORT             = process.env.PORT || 3000;
const CONTRACT_ADDRESS = '0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f';
const BASE_MAINNET_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY     = process.env.OPENAI_API_KEY; 
const DATABASE_URL       = process.env.DATABASE_URL;

const ABI = [
  'event TaskCreated(bytes32 indexed taskHash, address indexed sender, address indexed provider, uint96 amount, uint40 deadline)',
  'event TaskReleased(bytes32 indexed taskHash, address indexed provider, uint96 providerAmount, uint96 fee)',
  'function release(bytes32 taskHash)',
  'function escrows(bytes32) view returns (address sender, uint96 amount, address provider, uint40 deadline)',
];

// ── Validation ────────────────────────────────────────────────────────────────

if (!ORACLE_PRIVATE_KEY) { console.error('[oracle] ORACLE_PRIVATE_KEY not set'); process.exit(1); }
if (!ANTHROPIC_API_KEY)  { console.error('[oracle] ANTHROPIC_API_KEY not set');  process.exit(1); }
if (!DATABASE_URL)       { console.error('[oracle] DATABASE_URL not set');       process.exit(1); }

// ── Setup ─────────────────────────────────────────────────────────────────────

const rpcProvider = new ethers.JsonRpcProvider(BASE_MAINNET_RPC);
const wallet      = new ethers.Wallet(ORACLE_PRIVATE_KEY, rpcProvider);
const contract    = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
const claude      = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const openai      = new OpenAI({ apiKey: OPENAI_API_KEY }); 

// ── PostgreSQL ────────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_hash       TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        description     TEXT NOT NULL,
        sender          TEXT,
        provider        TEXT,
        amount          TEXT,
        deadline        TEXT,
        status          TEXT NOT NULL DEFAULT 'open',
        submission      JSONB,
        evaluation      JSONB,
        tx_hash         TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[db] Tasks table ready');
  } finally {
    client.release();
  }
}

// ── DB Helpers ─────────────────────────────────────────────────────────────────

async function dbGetTask(taskHash) {
  const { rows } = await pool.query('SELECT * FROM tasks WHERE task_hash = $1', [taskHash]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    taskHash: r.task_hash,
    title: r.title,
    description: r.description,
    sender: r.sender,
    provider: r.provider,
    amount: r.amount,
    deadline: r.deadline,
    status: r.status,
    submission: r.submission,
    evaluation: r.evaluation,
    txHash: r.tx_hash,
    createdAt: r.created_at,
  };
}

async function dbCreateTask(task) {
  await pool.query(
    `INSERT INTO tasks (task_hash, title, description, sender, provider, amount, deadline, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (task_hash) DO UPDATE SET
       title = COALESCE(NULLIF(EXCLUDED.title, 'Direct Contract Task'), tasks.title),
       description = COALESCE(NULLIF(EXCLUDED.description, 'Task created directly on-chain without description'), tasks.description),
       sender = COALESCE(EXCLUDED.sender, tasks.sender),
       provider = COALESCE(EXCLUDED.provider, tasks.provider),
       amount = COALESCE(EXCLUDED.amount, tasks.amount),
       deadline = COALESCE(EXCLUDED.deadline, tasks.deadline),
       updated_at = NOW()`,
    [task.taskHash, task.title, task.description, task.sender, task.provider, task.amount, task.deadline, task.status]
  );
}

async function dbUpdateTask(taskHash, updates) {
  const fields = [];
  const values = [];
  let i = 1;

  if (updates.status !== undefined)     { fields.push(`status = $${i++}`);     values.push(updates.status); }
  if (updates.submission !== undefined)  { fields.push(`submission = $${i++}`); values.push(JSON.stringify(updates.submission)); }
  if (updates.evaluation !== undefined)  { fields.push(`evaluation = $${i++}`); values.push(JSON.stringify(updates.evaluation)); }
  if (updates.txHash !== undefined)      { fields.push(`tx_hash = $${i++}`);    values.push(updates.txHash); }
  if (updates.amount !== undefined)      { fields.push(`amount = $${i++}`);     values.push(updates.amount); }
  if (updates.deadline !== undefined)    { fields.push(`deadline = $${i++}`);   values.push(updates.deadline); }
  if (updates.sender !== undefined)      { fields.push(`sender = $${i++}`);     values.push(updates.sender); }
  if (updates.provider !== undefined)    { fields.push(`provider = $${i++}`);   values.push(updates.provider); }

  fields.push(`updated_at = NOW()`);
  values.push(taskHash);

  await pool.query(
    `UPDATE tasks SET ${fields.join(', ')} WHERE task_hash = $${i}`,
    values
  );
}

async function dbListTasks() {
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100');
  return rows.map(r => ({
    taskHash: r.task_hash,
    title: r.title,
    description: r.description,
    sender: r.sender,
    provider: r.provider,
    amount: r.amount,
    deadline: r.deadline,
    status: r.status,
    submission: r.submission,
    evaluation: r.evaluation,
    txHash: r.tx_hash,
    createdAt: r.created_at,
  }));
}

async function dbCountTasks() {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM tasks');
  return parseInt(rows[0].count);
}

// ── Express API ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', async (req, res) => {
  const count = await dbCountTasks().catch(() => -1);
  res.json({ status: 'ok', tasks: count, uptime: process.uptime(), db: 'postgresql' });
});

// Register task description
app.post('/api/tasks', async (req, res) => {
  const { taskHash, title, description, sender, provider: prov } = req.body;
  if (!taskHash || !title || !description) {
    return res.status(400).json({ error: 'taskHash, title, and description required' });
  }

  const existing = await dbGetTask(taskHash);
  if (existing && existing.title !== 'Direct Contract Task') {
    return res.status(409).json({ error: 'Task already registered' });
  }

  await dbCreateTask({
    taskHash, title, description,
    sender: sender || 'unknown',
    provider: prov || 'unknown',
    amount: null, deadline: null,
    status: 'open'
  });

  console.log(`[api] Task registered: ${taskHash} — "${title}"`);
  res.json({ ok: true, taskHash });
});

// Worker submits deliverable
app.post('/api/tasks/:taskHash/submit', async (req, res) => {
  const { taskHash } = req.params;
  const { content, workerAddress } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'content is required' });
  }

  const task = await dbGetTask(taskHash);
  if (!task) {
    return res.status(404).json({ error: 'Task not found. Post task description first.' });
  }
  if (task.status !== 'open' && task.status !== 'rejected') {
    return res.status(400).json({ error: `Task is ${task.status}, cannot submit` });
  }

  const submission = {
    content: content.slice(0, 10000),
    workerAddress: workerAddress || task.provider,
    submittedAt: new Date().toISOString()
  };

  await dbUpdateTask(taskHash, { status: 'submitted', submission });
  console.log(`[api] Submission received for ${taskHash} — evaluating with 5-Agent Jury...`);

  // Trigger async evaluation
  evaluateSubmission(taskHash).catch(err => {
    console.error(`[api] Evaluation error for ${taskHash}:`, err.message);
  });

  res.json({ ok: true, status: 'submitted', message: 'Work submitted. AI oracle is evaluating...' });
});

// Get task details
app.get('/api/tasks/:taskHash', async (req, res) => {
  const task = await dbGetTask(req.params.taskHash);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// List all tasks
app.get('/api/tasks', async (req, res) => {
  const list = await dbListTasks();
  res.json(list);
});

// ── Security Middleware ───────────────────────────────────────────────────────

function sanitizeInput(text) {
  if (!text) return "";
  
  // 1. Strip HTML/Script tags
  let cleanText = text.replace(/<(script|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, '');
  
  // 2. Neutralize known prompt injection vectors
  const injectionPatterns = [
    /ignore all previous instructions/gi,
    /ignore previous instructions/gi,
    /system prompt/gi,
    /you must output APPROVE/gi,
    /disregard/gi,
    /override/gi
  ];
  
  injectionPatterns.forEach(regex => {
    cleanText = cleanText.replace(regex, '[REDACTED_MALICIOUS_INPUT]');
  });
  
  return cleanText.trim();
}

// ── Content Evaluation with 5-Agent Jury ──────────────────────────────────────

async function evaluateSubmission(taskHash) {
  const task = await dbGetTask(taskHash);
  if (!task || !task.submission) return;

  await dbUpdateTask(taskHash, { status: 'evaluating' });
  console.log(`[oracle] Commencing 5-Agent Jury evaluation for "${task.title}"...`);

  const sanitizedContent = sanitizeInput(task.submission.content);

  const basePrompt = `You are an AI oracle that validates task completion for an escrow payment system.

TASK POSTED BY CLIENT:
  Title: ${task.title}
  Description: ${task.description}

WORK SUBMITTED BY PROVIDER:
${sanitizedContent}

EVALUATION CRITERIA:
1. Does the submitted work match what was requested?
2. Is the work substantive?
3. Does the quality meet a reasonable standard?
4. Is the submission relevant?

Respond with exactly one word first: APPROVE or REJECT.
Then on the same line after a dash, give a brief reason.`;

  try {
    const juryPromises = [
      // Agent 1: Claude Sonnet
      claude.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 256,
        messages: [{ role: 'user', content: basePrompt }]
      }).then(res => res.content[0].text),
      
      // Agent 2: Claude Haiku
      claude.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 256,
        messages: [{ role: 'user', content: basePrompt }]
      }).then(res => res.content[0].text),
      
      // Agent 3: Claude Sonnet (Strict)
      claude.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 256,
        messages: [{ role: 'user', content: basePrompt + " Be exceptionally strict." }]
      }).then(res => res.content[0].text),

      // Agent 4: GPT-4o
      openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: basePrompt }],
        max_tokens: 256
      }).then(res => res.choices[0].message.content),

      // Agent 5: GPT-4o-mini
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: basePrompt }],
        max_tokens: 256
      }).then(res => res.choices[0].message.content)
    ];

    const results = await Promise.allSettled(juryPromises);
    
    let approveVotes = 0;
    let rejectVotes = 0;
    const voteLog = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const text = result.value.trim();
        const vote = text.toUpperCase().startsWith('APPROVE') ? 'APPROVE' : 'REJECT';
        vote === 'APPROVE' ? approveVotes++ : rejectVotes++;
        voteLog.push(`Agent ${index + 1}: ${vote} - ${text.split('-')[1]?.trim() || 'No reason'}`);
      } else {
        console.error(`[oracle] Agent ${index + 1} failed:`, result.reason);
        rejectVotes++;
        voteLog.push(`Agent ${index + 1}: FAILED`);
      }
    });

    const approved = approveVotes >= 3;
    console.log(`[oracle] Jury Verdict for "${task.title}": ${approveVotes} APPROVE / ${rejectVotes} REJECT`);
    voteLog.forEach(log => console.log(`  -> ${log}`));

    const evaluation = {
      approved,
      approveVotes,
      rejectVotes,
      details: voteLog,
      evaluatedAt: new Date().toISOString()
    };

    if (approved) {
      try {
        const escrow = await contract.escrows(taskHash);
        if (BigInt(escrow.amount) === 0n) {
          console.log(`[oracle] Escrow already settled for ${taskHash} — skipping`);
          await dbUpdateTask(taskHash, { status: 'released', evaluation });
          return;
        }
      } catch (e) {
        console.error(`[oracle] Error checking escrow:`, e.message);
      }

      const txHash = await releaseTask(taskHash);
      await dbUpdateTask(taskHash, { status: 'released', evaluation, txHash });
    } else {
      await dbUpdateTask(taskHash, { status: 'rejected', evaluation });
      console.log(`[oracle] Task "${task.title}" REJECTED — funds remain in escrow`);
    }
  } catch (err) {
    console.error(`[oracle] Jury evaluation error:`, err.message);
    await dbUpdateTask(taskHash, { status: 'open', submission: null });
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
    return tx.hash;
  } catch (err) {
    console.error(`[oracle] release() failed:`, err.shortMessage ?? err.message);
    return null;
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

  const existing = await dbGetTask(taskHash);

  if (existing) {
    await dbUpdateTask(taskHash, {
      amount: ethers.formatEther(amount),
      deadline: new Date(Number(deadline) * 1000).toISOString(),
      sender,
      provider: provider_
    });
    console.log(`[oracle] Task "${existing.title}" confirmed on-chain — waiting for worker submission`);
  } else {
    await dbCreateTask({
      taskHash,
      title: 'Direct Contract Task',
      description: 'Task created directly on-chain without description',
      sender,
      provider: provider_,
      amount: ethers.formatEther(amount),
      deadline: new Date(Number(deadline) * 1000).toISOString(),
      status: 'open'
    });

    console.log(`[oracle] Waiting 5s for possible API registration...`);
    await new Promise(r => setTimeout(r, 5000));

    const updatedTask = await dbGetTask(taskHash);
    if (updatedTask && updatedTask.title !== 'Direct Contract Task') {
      console.log(`[oracle] Task registered via API — waiting for worker submission`);
      return;
    }
    
    // PATCHED: Zero-day drain exploit removed.
    console.log(`[oracle] Direct task registered. Awaiting manual API description sync before evaluation.`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await initDB();
  console.log('[oracle] PostgreSQL connected (Neon.tech)');

  const network = await rpcProvider.getNetwork();
  console.log(`[oracle] Connected to network: ${network.name} (chainId ${network.chainId})`);

  const oracleAddress = await wallet.getAddress();
  console.log(`[oracle] Oracle wallet  : ${oracleAddress}`);
  console.log(`[oracle] Contract       : ${CONTRACT_ADDRESS}`);
  console.log(`[oracle] API server     : port ${PORT}`);
  console.log(`[oracle] Mode           : MULTI-AGENT JURY + POSTGRESQL`);
  console.log(`[oracle] Listening for TaskCreated events...`);

  contract.on('TaskCreated', handleTaskCreated);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[oracle] API ready at http://0.0.0.0:${PORT}`);
  });

  setInterval(async () => {
    const count = await dbCountTasks().catch(() => '?');
    console.log(`[oracle] Heartbeat — ${new Date().toISOString()} — ${count} tasks in DB`);
  }, 60_000);
}

main().catch(err => {
  console.error('[oracle] Fatal error:', err);
  process.exit(1);
});
