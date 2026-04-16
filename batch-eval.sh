#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# ZYLOGEN ORACLE — Batch Task Evaluator
# Creates tasks, submits work, waits for AI evaluation
# ═══════════════════════════════════════════════════════════════════════

API="https://zylogen-protocol-production.up.railway.app"
WALLET="0x24A400E17d2b9fd9C7eDd99f358A34Fe7751D849"

# Task definitions: title | description | submission | expected result
# Mix of GOOD submissions (should approve) and BAD submissions (should reject)

tasks=(
# --- GOOD SUBMISSIONS (should APPROVE) ---
"Write a tagline for a DeFi protocol|Write a short, memorable tagline (under 15 words) for a decentralized finance protocol focused on lending.|Lend fearlessly. Borrow instantly. DeFi without limits."
"Explain blockchain in one paragraph|Write a single paragraph explaining blockchain technology to a 12-year-old. Keep it simple and use an analogy.|Imagine a notebook that everyone in your class shares. Every time someone trades a Pokemon card, it gets written in the notebook. But here is the cool part — everyone has their own copy of the notebook, and once something is written, nobody can erase it. That is basically what a blockchain is: a shared digital notebook that keeps track of transactions and cannot be changed by any single person."
"Write 3 benefits of smart contracts|List exactly 3 benefits of using smart contracts in business. Each benefit should be 1-2 sentences.|1. Automation: Smart contracts execute automatically when conditions are met, eliminating the need for intermediaries and reducing processing time from days to seconds. 2. Trust: Because the code is transparent and immutable on the blockchain, all parties can verify the terms without relying on a third party. 3. Cost savings: By removing lawyers, brokers, and other middlemen from routine transactions, businesses can save 30-50% on administrative costs."
"Name 5 Layer 2 networks|List 5 Ethereum Layer 2 scaling solutions with a one-line description of each.|1. Optimism — Uses optimistic rollups to batch transactions off-chain with fraud proofs for security. 2. Arbitrum — An optimistic rollup solution offering lower fees and high EVM compatibility. 3. Base — Coinbase-incubated L2 built on the OP Stack for mainstream crypto adoption. 4. zkSync — Uses zero-knowledge proofs to validate transactions with mathematical certainty. 5. Polygon zkEVM — Combines Polygon ecosystem with zk-rollup technology for fast, cheap transactions."
"Write a tweet about AI agents|Write a single tweet (under 280 characters) about AI agents transforming the future of work.|AI agents are not replacing workers — they are becoming workers. Hiring, negotiating, delivering, getting paid. All on-chain. The future of work is autonomous."
"Explain what an oracle does in crypto|Write 2-3 sentences explaining what a blockchain oracle does and why it matters.|A blockchain oracle is a bridge between the real world and smart contracts. It feeds external data — like prices, weather, or task completion status — into the blockchain so smart contracts can make decisions based on real-world events. Without oracles, smart contracts would be isolated and unable to interact with anything outside their own chain."
"Write a project README intro|Write the first paragraph of a GitHub README for an open-source AI payment protocol.|ZyloPayments is an open-source protocol for autonomous AI-to-AI payments on Ethereum Layer 2. It enables AI agents to hire each other, submit work, and receive payment through trustless escrow contracts — all validated by an AI oracle. Built for developers who want to integrate machine-to-machine payments into their agent frameworks without centralized intermediaries."
"Compare ETH and USDC for payments|Write 2-3 sentences comparing ETH and USDC as payment methods for AI agent transactions.|ETH is the native currency of Ethereum and fluctuates in value, making it better for speculation but risky for fixed-price work. USDC is a stablecoin pegged to the US dollar, providing predictable pricing that both AI agents and humans can rely on for consistent task payouts. For settlement layers like Zylogen, USDC reduces the risk of price volatility between task creation and payment release."
"Write a bug report template|Create a short bug report template with 4 sections that a developer can fill in.|## Bug Report\n\n**Description:** [Clear description of the bug]\n\n**Steps to Reproduce:**\n1. [Step 1]\n2. [Step 2]\n3. [Step 3]\n\n**Expected Behavior:** [What should happen]\n\n**Actual Behavior:** [What actually happens]\n\n**Environment:** [OS, browser, version, etc.]"
"Explain gas fees to a beginner|Write a simple 3-sentence explanation of what gas fees are on Ethereum.|Gas fees are small payments you make to use the Ethereum network, similar to paying postage to send a letter. Every transaction or smart contract interaction requires computational work from the network validators, and gas is how you compensate them for that work. When the network is busy, gas fees go up because more people are competing to get their transactions processed."
"Write a value proposition for Zylogen|Write a 2-sentence value proposition for Zylogen Protocol targeting AI developers.|Zylogen Protocol lets your AI agents hire, pay, and evaluate other agents autonomously through trustless on-chain escrow. Stop building custom payment logic — plug into the settlement layer purpose-built for machine-to-machine economies."
"Describe the escrow flow in 4 steps|Describe a typical escrow payment flow in exactly 4 numbered steps.|1. The client locks funds in the escrow smart contract along with the task requirements and the worker's wallet address. 2. The worker completes the task and submits their deliverable for review. 3. The AI oracle evaluates the submission against the original task specification and issues an approval or rejection. 4. If approved, funds are automatically released to the worker minus the protocol fee; if rejected, the client can reclaim after the deadline."
"Write a Farcaster cast about building on Base|Write a short Farcaster post (under 320 characters) about building a project on Base network.|Just shipped on @base — trustless AI oracle that evaluates work and settles payments in under 5 minutes. Smart contracts verified. Oracle live. Zero middlemen. Building the settlement layer for the agent economy. zylogen.xyz"
"List 3 risks of centralized escrow|List 3 risks of using centralized escrow services compared to smart contract escrow.|1. Single point of failure: If the centralized provider goes down, gets hacked, or goes bankrupt, all escrowed funds may be lost or frozen indefinitely. 2. Censorship risk: A centralized provider can freeze funds, block certain users, or reverse transactions at their discretion without the consent of both parties. 3. Opacity: Users must trust the provider's internal processes for dispute resolution with no way to independently verify that decisions are fair or consistent."
"Write an elevator pitch for AI settlement|Write a 30-second elevator pitch for an AI agent settlement protocol.|Right now, AI agents can browse the web, write code, and analyze data — but they can't pay each other. There's no Venmo for bots. Zylogen fixes this. We built a trustless settlement layer on Base where AI agents lock funds in escrow, an AI oracle validates the work, and payment releases automatically. No humans needed. We've already processed transactions with 100% oracle accuracy and we're open source."
"Summarize how ZK rollups work|Write a 3-sentence summary of how zero-knowledge rollups work.|ZK rollups bundle hundreds of transactions off the main Ethereum chain into a single batch, then generate a cryptographic proof that all transactions in the batch are valid. This proof is posted to Ethereum mainnet where it can be verified by anyone in milliseconds, without needing to re-execute each transaction individually. The result is dramatically lower gas fees and higher throughput while inheriting Ethereum's full security guarantees."
"Write a Discord welcome message|Write a short welcome message for a new Discord server focused on AI and crypto.|Welcome to the intersection of AI and crypto. This server is for builders, researchers, and explorers working on autonomous agent economies, on-chain settlement, and AI-native infrastructure. Share what you are building, ask questions, and connect with others who believe machines will be economic actors. Rules are simple: be respectful, share knowledge, no spam."
"Explain why Base was chosen over other L2s|Write 2-3 sentences explaining why a project might choose Base over other L2 networks.|Base offers the lowest transaction fees among major L2s while maintaining full EVM compatibility, making it ideal for high-frequency micro-transactions that AI agents perform. Backed by Coinbase, Base provides a clear path to mainstream adoption with built-in fiat on-ramps and a growing developer ecosystem. The OP Stack foundation ensures battle-tested security while the Coinbase brand brings institutional credibility that other L2s lack."
# --- BAD SUBMISSIONS (should REJECT) ---
"Write a technical whitepaper abstract|Write a 200-word technical abstract for a whitepaper about decentralized AI arbitration systems.|I like pizza and football. The weather is nice today."
"Create a marketing plan for a Web3 startup|Write a detailed marketing plan with at least 5 strategies for launching a Web3 startup.|Buy ads on Google."
"Write a Solidity function for token transfer|Write a Solidity function that transfers ERC20 tokens from one address to another with proper checks.|function hello() { return true; }"
"Analyze the competitive landscape of AI payment protocols|Write a competitive analysis comparing at least 3 AI payment protocols and their approaches.|I dont know any protocols lol"
"Write a security audit checklist|Create a security audit checklist with at least 8 items for smart contract review.|1. Check the code."
)

echo "═══════════════════════════════════════════════════"
echo " ZYLOGEN ORACLE — BATCH EVALUATOR"
echo " Running ${#tasks[@]} tasks..."
echo "═══════════════════════════════════════════════════"
echo ""

approved=0
rejected=0
errors=0

for i in "${!tasks[@]}"; do
  IFS='|' read -r title description submission <<< "${tasks[$i]}"
  
  HASH="0x$(openssl rand -hex 32)"
  NUM=$((i + 1))
  
  echo "[$NUM/${#tasks[@]}] $title"
  echo "  → Creating task..."
  
  # Create task
  CREATE_RESULT=$(curl -s -X POST "$API/api/tasks" \
    -H "Content-Type: application/json" \
    -d "{\"taskHash\":\"$HASH\",\"title\":\"$title\",\"description\":\"$description\",\"sender\":\"$WALLET\",\"provider\":\"$WALLET\"}")
  
  if echo "$CREATE_RESULT" | grep -q '"ok":true'; then
    echo "  → Submitting work..."
    
    # Submit work
    ESCAPED_SUBMISSION=$(echo "$submission" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")
    
    SUBMIT_RESULT=$(curl -s -X POST "$API/api/tasks/$HASH/submit" \
      -H "Content-Type: application/json" \
      -d "{\"content\":$ESCAPED_SUBMISSION,\"workerAddress\":\"$WALLET\"}")
    
    if echo "$SUBMIT_RESULT" | grep -q '"ok":true'; then
      echo "  → Waiting for Claude evaluation..."
      sleep 8
      
      # Check result
      RESULT=$(curl -s "$API/api/tasks/$HASH")
      STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('status','unknown'))" 2>/dev/null)
      REASON=$(echo "$RESULT" | python3 -c "import sys,json; e=json.loads(sys.stdin.read()).get('evaluation',{}); print(e.get('reason','no reason') if e else 'pending')" 2>/dev/null)
      
      if [ "$STATUS" = "released" ]; then
        echo "  ✅ APPROVED — $REASON"
        approved=$((approved + 1))
      elif [ "$STATUS" = "rejected" ]; then
        echo "  ❌ REJECTED — $REASON"
        rejected=$((rejected + 1))
      else
        echo "  ⏳ STATUS: $STATUS (may still be evaluating)"
        # Wait a bit more and recheck
        sleep 7
        RESULT=$(curl -s "$API/api/tasks/$HASH")
        STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('status','unknown'))" 2>/dev/null)
        REASON=$(echo "$RESULT" | python3 -c "import sys,json; e=json.loads(sys.stdin.read()).get('evaluation',{}); print(e.get('reason','no reason') if e else 'pending')" 2>/dev/null)
        if [ "$STATUS" = "released" ]; then
          echo "  ✅ APPROVED — $REASON"
          approved=$((approved + 1))
        elif [ "$STATUS" = "rejected" ]; then
          echo "  ❌ REJECTED — $REASON"
          rejected=$((rejected + 1))
        else
          echo "  ⚠️  Still pending: $STATUS"
          errors=$((errors + 1))
        fi
      fi
    else
      echo "  ⚠️  Submit failed: $SUBMIT_RESULT"
      errors=$((errors + 1))
    fi
  else
    echo "  ⚠️  Create failed: $CREATE_RESULT"
    errors=$((errors + 1))
  fi
  
  echo ""
done

echo "═══════════════════════════════════════════════════"
echo " BATCH COMPLETE"
echo " ✅ Approved: $approved"
echo " ❌ Rejected: $rejected"
echo " ⚠️  Errors:   $errors"
echo " Total:     ${#tasks[@]}"
echo "═══════════════════════════════════════════════════"
