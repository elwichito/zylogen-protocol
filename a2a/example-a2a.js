// a2a/example-a2a.js
// ═══════════════════════════════════════════════════════════════════════════
// Zylogen Protocol — Agent-to-Agent Demo
// Two AI agents autonomously creating tasks, hiring each other, and settling.
// ═══════════════════════════════════════════════════════════════════════════
//
// To run:
//   1. Copy this file to ~/zylogen-protocol/a2a/
//   2. Set environment variables (or edit the config below)
//   3. node a2a/example-a2a.js
//
// WARNING: This uses real USDC on Base Mainnet. Start with tiny amounts.

require("dotenv").config();
const { ZylogenAgent } = require("./ZylogenAgent.js");

async function main() {
  // ─── Agent 1: "Writer" — writes content, can hire translators ─────────
  const writer = new ZylogenAgent({
    privateKey:   process.env.AGENT_WRITER_KEY,    // Wallet with USDC + ETH for gas
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    name:         "Writer-Agent",
    skills:       ["content-writing", "blog-posts", "copywriting"],
    maxBudget:    5.00,   // Max $5 USDC per task
    minPayout:    0.10,   // Accept tasks paying $0.10+
  });

  // ─── Agent 2: "Translator" — translates content ───────────────────────
  const translator = new ZylogenAgent({
    privateKey:   process.env.AGENT_TRANSLATOR_KEY, // Different wallet
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    name:         "Translator-Agent",
    skills:       ["translation", "spanish", "french", "localization"],
    maxBudget:    5.00,
    minPayout:    0.05,
  });

  // Start both agents
  await writer.start();
  await translator.start();

  // ─── Scenario: Writer hires Translator ────────────────────────────────
  console.log("\n═══ SCENARIO: Writer hires Translator ═══\n");

  const translatorAddress = await translator.signer.getAddress();

  // Writer creates a $1 USDC task for the translator
  const task = await writer.hireAgent(
    translatorAddress,
    1.00,
    "Translate the following to Spanish: 'Zylogen Protocol is the autonomic settlement layer for AI agents. No banks. No accounts. Just wallets and escrow.'"
  );

  console.log(`\nTask created: ${task.taskHash}`);
  console.log("Waiting for translator to process...\n");

  // Give the translator time to detect and process the task
  await new Promise(r => setTimeout(r, 10_000));

  // ─── Check statuses ───────────────────────────────────────────────────
  const writerStatus     = await writer.getStatus();
  const translatorStatus = await translator.getStatus();

  console.log("\n═══ AGENT STATUSES ═══");
  console.log("Writer:", JSON.stringify(writerStatus.stats, null, 2));
  console.log("Translator:", JSON.stringify(translatorStatus.stats, null, 2));

  // ─── Scenario: Task Chain ─────────────────────────────────────────────
  // Writer creates → Translator translates → (oracle validates → release)
  //
  // Uncomment to test multi-step chains:
  //
  // const chain = await writer.createTaskChain([
  //   {
  //     agent: writerAddress,
  //     amount: 0.50,
  //     description: "Write a 100-word product description for Zylogen Protocol"
  //   },
  //   {
  //     agent: translatorAddress,
  //     amount: 0.50,
  //     description: "Translate the previous step's output to Spanish"
  //   },
  // ]);
  // console.log("Chain created:", chain);

  // Clean up
  setTimeout(() => {
    writer.stop();
    translator.stop();
    process.exit(0);
  }, 30_000);
}

main().catch(console.error);
