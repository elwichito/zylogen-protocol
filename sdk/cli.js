#!/usr/bin/env node
// zylogen-cli
// Command-line interface for Zylogen Protocol
//
// Usage:
//   npx zylogen-sdk info
//   npx zylogen-sdk stats
//   npx zylogen-sdk tasks
//   npx zylogen-sdk get <taskHash>
//   npx zylogen-sdk submit <taskHash> "<work content>"

const API = 'https://zylogen-protocol-production.up.railway.app';
const ORACLE_URL = 'https://zylogen.xyz/oracle.html';
const CONTRACT_V1 = '0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f';
const CONTRACT_V2 = '0xC10D9b263612733C1752eFDe9CD617887216832c';
const BASESCAN_V1 = `https://basescan.org/address/${CONTRACT_V1}`;
const BASESCAN_V2 = `https://basescan.org/address/${CONTRACT_V2}`;

// ANSI colors
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  orange: '\x1b[33m',
  red: '\x1b[31m',
  purple: '\x1b[35m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function box(title, lines) {
  const width = 64;
  console.log(c.green + '╔' + '═'.repeat(width - 2) + '╗' + c.reset);
  console.log(c.green + '║ ' + c.bold + title.padEnd(width - 4) + c.reset + c.green + ' ║' + c.reset);
  console.log(c.green + '╠' + '═'.repeat(width - 2) + '╣' + c.reset);
  lines.forEach(line => {
    console.log(c.green + '║ ' + c.reset + line.padEnd(width - 4) + c.green + ' ║' + c.reset);
  });
  console.log(c.green + '╚' + '═'.repeat(width - 2) + '╝' + c.reset);
}

function header() {
  console.log('');
  console.log(c.green + '  ⬡  ZYLOGEN PROTOCOL CLI' + c.reset + c.gray + ' — v2.0.0' + c.reset);
  console.log(c.gray + '     Autonomous settlement for AI agents on Base' + c.reset);
  console.log('');
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Commands ─────────────────────────────────────────────────────────────

async function cmdInfo() {
  header();
  box('PROTOCOL INFO', [
    `Network:        ${c.cyan}Base Mainnet (8453)${c.reset}`,
    `V1 Contract:    ${c.green}${CONTRACT_V1.slice(0,10)}...${CONTRACT_V1.slice(-6)}${c.reset}`,
    `V2 Contract:    ${c.green}${CONTRACT_V2.slice(0,10)}...${CONTRACT_V2.slice(-6)}${c.reset}`,
    `Protocol Fee:   ${c.green}1%${c.reset}`,
    `Oracle API:     ${c.cyan}zylogen-protocol-production.up.railway.app${c.reset}`,
    `Oracle Panel:   ${c.cyan}zylogen.xyz/oracle.html${c.reset}`,
    `Marketplace:    ${c.cyan}zylogen.xyz/marketplace.html${c.reset}`,
    `GitHub:         ${c.cyan}github.com/elwichito/zylogen-protocol${c.reset}`,
  ]);
  console.log('');
}

async function cmdStats() {
  header();
  process.stdout.write(c.gray + '  Fetching stats...' + c.reset);
  const tasks = await fetchJSON(`${API}/api/tasks`);
  const health = await fetchJSON(`${API}/health`);
  process.stdout.write('\r' + ' '.repeat(30) + '\r');

  const evaluated = tasks.filter(t => t.evaluation);
  const approved = evaluated.filter(t => t.evaluation.approved).length;
  const rejected = evaluated.filter(t => !t.evaluation.approved).length;
  const pending = tasks.filter(t => t.status === 'open' || t.status === 'submitted' || t.status === 'evaluating').length;
  const approvalRate = evaluated.length > 0 ? Math.round((approved / evaluated.length) * 100) : 0;

  box('ORACLE STATS', [
    `Total Tasks:      ${c.bold}${tasks.length}${c.reset}`,
    `Approved:         ${c.green}${approved}${c.reset}`,
    `Rejected:         ${c.red}${rejected}${c.reset}`,
    `Pending:          ${c.orange}${pending}${c.reset}`,
    `Approval Rate:    ${c.purple}${approvalRate}%${c.reset}`,
    `Oracle Status:    ${health.status === 'ok' ? c.green + 'HEALTHY' : c.red + 'DOWN'}${c.reset}`,
    `Uptime:           ${c.gray}${Math.round(health.uptime)}s${c.reset}`,
    `Database:         ${c.cyan}${health.db || 'in-memory'}${c.reset}`,
  ]);
  console.log('');
}

async function cmdTasks() {
  header();
  process.stdout.write(c.gray + '  Fetching tasks...' + c.reset);
  const tasks = await fetchJSON(`${API}/api/tasks`);
  process.stdout.write('\r' + ' '.repeat(30) + '\r');

  if (tasks.length === 0) {
    console.log(c.gray + '  No tasks found.' + c.reset);
    console.log('');
    return;
  }

  console.log(c.bold + `  RECENT TASKS (${tasks.length} total, showing last 10)` + c.reset);
  console.log('');

  tasks.slice(0, 10).forEach((t, i) => {
    const statusColor = t.status === 'released' ? c.green : t.status === 'rejected' ? c.red : t.status === 'open' ? c.cyan : c.orange;
    const statusLabel = t.status.toUpperCase().padEnd(10);
    const title = (t.title || '').slice(0, 45).padEnd(45);
    const hash = t.taskHash.slice(0, 10) + '...' + t.taskHash.slice(-4);
    console.log(`  ${statusColor}${statusLabel}${c.reset} ${title} ${c.gray}${hash}${c.reset}`);
  });
  console.log('');
  console.log(c.gray + `  → See all tasks: ${ORACLE_URL}` + c.reset);
  console.log('');
}

async function cmdGet(taskHash) {
  if (!taskHash) {
    console.log(c.red + '  Error: taskHash required' + c.reset);
    console.log(c.gray + '  Usage: npx zylogen-sdk get <taskHash>' + c.reset);
    return;
  }

  header();
  process.stdout.write(c.gray + '  Fetching task...' + c.reset);
  try {
    const task = await fetchJSON(`${API}/api/tasks/${taskHash}`);
    process.stdout.write('\r' + ' '.repeat(30) + '\r');

    const statusColor = task.status === 'released' ? c.green : task.status === 'rejected' ? c.red : c.cyan;

    console.log(c.bold + '  TASK DETAILS' + c.reset);
    console.log('');
    console.log(`  ${c.gray}Hash:${c.reset}        ${task.taskHash}`);
    console.log(`  ${c.gray}Title:${c.reset}       ${c.bold}${task.title}${c.reset}`);
    console.log(`  ${c.gray}Description:${c.reset} ${task.description}`);
    console.log(`  ${c.gray}Sender:${c.reset}      ${c.cyan}${task.sender}${c.reset}`);
    console.log(`  ${c.gray}Provider:${c.reset}    ${c.cyan}${task.provider}${c.reset}`);
    console.log(`  ${c.gray}Amount:${c.reset}      ${c.green}${task.amount || '—'} ETH${c.reset}`);
    console.log(`  ${c.gray}Status:${c.reset}      ${statusColor}${task.status.toUpperCase()}${c.reset}`);
    console.log(`  ${c.gray}Created:${c.reset}     ${task.createdAt}`);

    if (task.submission) {
      console.log('');
      console.log(c.bold + '  SUBMITTED WORK' + c.reset);
      console.log(c.gray + '  ' + '─'.repeat(60) + c.reset);
      const content = task.submission.content.split('\n').map(l => '  ' + l).join('\n');
      console.log(content);
      console.log(c.gray + '  ' + '─'.repeat(60) + c.reset);
    }

    if (task.evaluation) {
      console.log('');
      console.log(c.purple + '  🧠 ORACLE DECISION' + c.reset);
      const reasonColor = task.evaluation.approved ? c.green : c.red;
      console.log(`  ${reasonColor}${task.evaluation.reason}${c.reset}`);
      console.log(c.gray + `  Evaluated: ${task.evaluation.evaluatedAt}` + c.reset);
    }
    console.log('');
  } catch (e) {
    process.stdout.write('\r' + ' '.repeat(30) + '\r');
    console.log(c.red + `  Task not found: ${taskHash}` + c.reset);
    console.log('');
  }
}

async function cmdSubmit(taskHash, content) {
  if (!taskHash || !content) {
    console.log(c.red + '  Error: taskHash and content required' + c.reset);
    console.log(c.gray + '  Usage: npx zylogen-sdk submit <taskHash> "<your work>"' + c.reset);
    return;
  }

  header();
  console.log(c.gray + '  Submitting work to oracle...' + c.reset);

  try {
    const submit = await fetchJSON(`${API}/api/tasks/${taskHash}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, workerAddress: 'cli' })
    });

    console.log(c.green + '  ✓ Submitted' + c.reset);
    console.log(c.gray + '  Waiting for AI oracle evaluation...' + c.reset);

    // Poll for result
    let attempts = 0;
    let task;
    while (attempts < 15) {
      await new Promise(r => setTimeout(r, 2000));
      task = await fetchJSON(`${API}/api/tasks/${taskHash}`);
      if (task.status === 'released' || task.status === 'rejected') break;
      attempts++;
      process.stdout.write('\r' + c.gray + `  Evaluating... ${task.status} (${attempts * 2}s)` + c.reset);
    }
    process.stdout.write('\r' + ' '.repeat(60) + '\r');

    if (task.status === 'released') {
      console.log(c.green + '  ✓ APPROVED' + c.reset);
    } else if (task.status === 'rejected') {
      console.log(c.red + '  ✗ REJECTED' + c.reset);
    } else {
      console.log(c.orange + '  ⏳ Still evaluating — check status later with:' + c.reset);
      console.log(c.gray + `     npx zylogen-sdk get ${taskHash}` + c.reset);
      console.log('');
      return;
    }

    if (task.evaluation) {
      console.log('');
      console.log(c.purple + '  🧠 ORACLE REASONING' + c.reset);
      console.log(`  ${task.evaluation.reason}`);
    }
    console.log('');
  } catch (e) {
    console.log(c.red + `  Error: ${e.message}` + c.reset);
    console.log('');
  }
}

function cmdHelp() {
  header();
  console.log(c.bold + '  USAGE' + c.reset);
  console.log('');
  console.log(`  ${c.green}npx zylogen-sdk${c.reset} ${c.cyan}<command>${c.reset} ${c.gray}[args]${c.reset}`);
  console.log('');
  console.log(c.bold + '  COMMANDS' + c.reset);
  console.log('');
  console.log(`  ${c.cyan}info${c.reset}                        Show protocol info`);
  console.log(`  ${c.cyan}stats${c.reset}                       Show oracle statistics`);
  console.log(`  ${c.cyan}tasks${c.reset}                       List recent tasks`);
  console.log(`  ${c.cyan}get${c.reset} ${c.gray}<taskHash>${c.reset}              Get task details`);
  console.log(`  ${c.cyan}submit${c.reset} ${c.gray}<taskHash> <work>${c.reset}    Submit work for AI evaluation`);
  console.log(`  ${c.cyan}help${c.reset}                        Show this help`);
  console.log('');
  console.log(c.bold + '  EXAMPLES' + c.reset);
  console.log('');
  console.log(`  ${c.gray}# Check protocol health${c.reset}`);
  console.log(`  ${c.green}$${c.reset} npx zylogen-sdk stats`);
  console.log('');
  console.log(`  ${c.gray}# Submit work for evaluation${c.reset}`);
  console.log(`  ${c.green}$${c.reset} npx zylogen-sdk submit 0xabc123... "My completed work here"`);
  console.log('');
  console.log(c.gray + '  Learn more: zylogen.xyz' + c.reset);
  console.log('');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const [, , cmd, ...args] = process.argv;

  try {
    switch ((cmd || '').toLowerCase()) {
      case 'info':    await cmdInfo(); break;
      case 'stats':   await cmdStats(); break;
      case 'tasks':   await cmdTasks(); break;
      case 'task':    await cmdGet(args[0]); break;
      case 'get':     await cmdGet(args[0]); break;
      case 'submit':  await cmdSubmit(args[0], args.slice(1).join(' ')); break;
      case 'help':
      case '--help':
      case '-h':
      case '':
      case undefined: cmdHelp(); break;
      default:
        console.log(c.red + `\n  Unknown command: ${cmd}\n` + c.reset);
        cmdHelp();
    }
  } catch (e) {
    console.log(c.red + `\n  Error: ${e.message}\n` + c.reset);
    process.exit(1);
  }
}

main();
