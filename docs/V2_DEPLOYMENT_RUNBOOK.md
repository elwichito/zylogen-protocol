# TaskEscrowV2 — Deployment Runbook

**Version:** 1.0  
**Author:** Zyl  
**Date:** 2026-04-18  
**Scope:** Base Sepolia (testnet) → Base Mainnet

---

## Prerequisites Checklist

Before starting, confirm all of these. Do not proceed with any item unchecked.

```
[ ] DEPLOYER_PRIVATE_KEY added to backend/.env
      → Should derive to: 0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e
[ ] BASESCAN_API_KEY added to backend/.env
      → Register at: basescan.org/register
[ ] Sepolia ETH ≥ 0.05 ETH at 0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e
      → Faucet: coinbase.com/faucets/base-ethereum-sepolia-faucet
[ ] Mainnet ETH ≥ 0.005 ETH at 0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e
      → Current balance: 0.00739 ETH ✅
[ ] Relayer USDC ≥ 9 USDC at 0x24A400E17d2b9fd9C7eDd99f358A34Fe7751D849
      → Current balance: ~10.21 USDC ✅ (after approve() residual)
[ ] CTO GO confirmed for Sepolia deploy
[ ] CTO + Logen + Wichi unanimous GO for Mainnet deploy (Type 4)
```

---

## Phase 3 — Deploy to Base Sepolia

### Step 3.0 — Verify DEPLOYER_PRIVATE_KEY derives correct address

```bash
cd /Users/wich/zylogen-protocol
node -e "
require('dotenv').config({path:'backend/.env'});
const {ethers} = require('ethers');
const pk = process.env.DEPLOYER_PRIVATE_KEY;
const addr = new ethers.Wallet(pk).address;
console.log('Derived:', addr);
console.log('Expected: 0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e');
console.log('Match:', addr.toLowerCase() === '0x8bcb4935fc0aeaf5733d96a8a72a2ac79bd3693e');
"
```

**Expected output:**
```
Derived: 0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e
Expected: 0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e
Match: true
```

**If Match: false — STOP. Do not deploy. Report to CTO.**

---

### Step 3.1 — Verify Sepolia ETH balance

```bash
node -e "
const {ethers} = require('ethers');
async function main() {
  const p = new ethers.JsonRpcProvider('https://sepolia.base.org');
  const bal = await p.getBalance('0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e');
  console.log('Sepolia ETH:', ethers.formatEther(bal));
  if (bal < ethers.parseEther('0.005')) console.log('⚠️  INSUFFICIENT — top up before deploy');
  else console.log('✅ Sufficient');
}
main();
"
```

**Minimum required:** 0.005 ETH  
**Recommended:** 0.05 ETH (leaves margin for multiple test interactions)

---

### Step 3.2 — Write deploy script

Create `contracts/scripts/deploy-v2-sepolia.js`:

```javascript
"use strict";
require("dotenv").config({ path: "../../backend/.env" });
const hre = require("hardhat");

async function main() {
  const USDC_SEPOLIA  = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const ORACLE        = "0x24A400E17d2b9fd9C7eDd99f358A34Fe7751D849";

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying from:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("ETH balance:", hre.ethers.formatEther(balance));

  const Factory = await hre.ethers.getContractFactory("TaskEscrowV2");
  const contract = await Factory.deploy(USDC_SEPOLIA, ORACLE);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✅ TaskEscrowV2 deployed to:", address);
  console.log("BaseScan Sepolia:", `https://sepolia.basescan.org/address/${address}`);

  // Verify on BaseScan (requires BASESCAN_API_KEY)
  if (process.env.BASESCAN_API_KEY) {
    console.log("\nVerifying on BaseScan Sepolia...");
    await hre.run("verify:verify", {
      address,
      constructorArguments: [USDC_SEPOLIA, ORACLE],
    });
    console.log("✅ Verified");
  } else {
    console.log("⚠️  BASESCAN_API_KEY not set — skipping verification");
    console.log("   Verify manually: npx hardhat verify --network baseSepolia", address, USDC_SEPOLIA, ORACLE);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

---

### Step 3.3 — Run deploy (Sepolia)

```bash
cd /Users/wich/zylogen-protocol/contracts
node_modules/.bin/hardhat run scripts/deploy-v2-sepolia.js --network baseSepolia 2>&1
```

**Expected output:**
```
Deploying from: 0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e
ETH balance: 0.05...
✅ TaskEscrowV2 deployed to: 0x<NEW_ADDRESS>
BaseScan Sepolia: https://sepolia.basescan.org/address/0x<NEW_ADDRESS>
✅ Verified
```

**Record the deployed address — needed for Step 3.4.**

---

### Step 3.4 — Smoke test on Sepolia

```bash
# Fund relayer with Sepolia USDC first (use Sepolia USDC faucet or transfer)
# Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e

# Run preflight against Railway, but override escrow address to Sepolia V2
# NOTE: Railway env vars must temporarily point to Sepolia:
#   BASE_RPC_URL=https://sepolia.base.org
#   USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
#   TASK_ESCROW_ADDRESS=0x<SEPOLIA_V2_ADDRESS>
# Then:
TARGET_URL=https://zylogen-protocol-production.up.railway.app \
  npm run test:preflight
```

**Expected result:**
- HTTP 200 from webhook
- `stage: "locked"` from `/api/nova/status`
- Tx hash visible on BaseScan Sepolia

**If test passes → Checkpoint. Report to CTO. Await Mainnet GO (Type 4).**

---

### Step 3.5 — Rollback (Sepolia)

Sepolia is a testnet. Rollback = deploy a new contract. No financial risk.

```bash
# Re-run deploy script to get a fresh address
node_modules/.bin/hardhat run scripts/deploy-v2-sepolia.js --network baseSepolia
```

---

## Phase 4 — Deploy to Base Mainnet

**⚠️ TYPE 4 — Requires unanimous GO: CTO + Logen + Wichi before executing any step below.**

---

### Step 4.0 — Pre-deploy checklist (repeat before Mainnet)

```bash
# Verify deployer ETH on Mainnet
node -e "
const {ethers} = require('ethers');
async function main() {
  const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
  const bal = await p.getBalance('0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e');
  console.log('Mainnet ETH:', ethers.formatEther(bal));
}
main();
"
```

**Minimum required:** 0.005 ETH  
**Current balance:** 0.00739 ETH ✅ (verify again on deploy day)

---

### Step 4.1 — Write Mainnet deploy script

Create `contracts/scripts/deploy-v2-mainnet.js`:

```javascript
"use strict";
require("dotenv").config({ path: "../../backend/.env" });
const hre = require("hardhat");

async function main() {
  const USDC_MAINNET  = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const ORACLE        = "0x24A400E17d2b9fd9C7eDd99f358A34Fe7751D849";

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying from:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("ETH balance:", hre.ethers.formatEther(balance));

  // Final confirmation prompt — safety gate
  console.log("\n⚠️  MAINNET DEPLOY — this is irreversible");
  console.log("USDC:", USDC_MAINNET);
  console.log("Oracle:", ORACLE);
  console.log("Owner will be deployer:", deployer.address);
  console.log("Proceeding in 3 seconds...\n");
  await new Promise(r => setTimeout(r, 3000));

  const Factory = await hre.ethers.getContractFactory("TaskEscrowV2");
  const contract = await Factory.deploy(USDC_MAINNET, ORACLE);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✅ TaskEscrowV2 deployed to:", address);
  console.log("BaseScan Mainnet:", `https://basescan.org/address/${address}`);

  if (process.env.BASESCAN_API_KEY) {
    console.log("\nVerifying on BaseScan Mainnet...");
    await hre.run("verify:verify", {
      address,
      constructorArguments: [USDC_MAINNET, ORACLE],
    });
    console.log("✅ Verified");
  }

  console.log("\n=== NEXT STEPS ===");
  console.log("1. Update Railway env var: TASK_ESCROW_ADDRESS =", address);
  console.log("2. Update Railway env var: BASE_RPC_URL = https://mainnet.base.org");
  console.log("3. Update Railway env var: USDC_ADDRESS =", USDC_MAINNET);
  console.log("4. Update paymentRelay.js ESCROW_ABI to V2 lock() signature");
  console.log("5. Trigger Railway redeploy");
  console.log("6. Run test:preflight against Mainnet");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

---

### Step 4.2 — Deploy to Mainnet

```bash
cd /Users/wich/zylogen-protocol/contracts
node_modules/.bin/hardhat run scripts/deploy-v2-mainnet.js --network base 2>&1
```

**Expected output:**
```
Deploying from: 0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e
ETH balance: 0.00739...
⚠️  MAINNET DEPLOY — this is irreversible
...
✅ TaskEscrowV2 deployed to: 0x<MAINNET_V2_ADDRESS>
BaseScan Mainnet: https://basescan.org/address/0x<MAINNET_V2_ADDRESS>
✅ Verified
```

**Record address immediately. Cannot be lost.**

---

### Step 4.3 — Rollback (Mainnet)

Mainnet contracts are immutable. "Rollback" = deploy a new contract and update Railway to point to it.

The V1 contract (`0x55a8...451f`) remains on-chain permanently — it is inert for our pipeline since we no longer call it.

If V2 has a critical bug post-deploy:
1. `escrow.pause()` — immediately stops new `lock()` calls (only owner can do this)
2. Deploy V3 (or patched V2)
3. Update Railway env var `TASK_ESCROW_ADDRESS`
4. Existing locked funds in buggy V2 — oracle can `refund()` them back to clients

---

## Phase 5 — Backend Update

After Mainnet deploy, update Railway without touching Railway dashboard directly first — update code and let Railway autodeploy.

### Step 5.1 — Update paymentRelay.js ESCROW_ABI

Change the `ESCROW_ABI` constant in `src/services/paymentRelay.js`:

```javascript
// OLD (V1 — remove this)
const ESCROW_ABI = [
  "function lock(address client, uint256 amount) external returns (uint256 taskId)",
  "function releaseFunds(uint256 escrowId, address worker) external",
  "event Locked(uint256 indexed taskId, address indexed client, uint256 amount)",
];

// NEW (V2)
const ESCROW_ABI = [
  "function lock(bytes32 taskId, address worker, uint256 amount, uint256 deadline) external",
  "function release(bytes32 taskId) external",
  "function refund(bytes32 taskId) external",
  "event TaskLocked(bytes32 indexed taskId, address indexed client, address indexed worker, uint256 amount, uint256 deadline)",
  "function getTask(bytes32 taskId) external view returns (address client, uint96 amount, address worker, uint40 deadline, uint8 status)",
];
```

### Step 5.2 — Update lock() call in relayPaymentToEscrow()

```javascript
// OLD
const tx = await escrow.lock(clientAddress, USDC_LOCK_AMOUNT);

// NEW — generate taskId from session ID for deterministic idempotency
const taskId = ethers.keccak256(ethers.toUtf8Bytes(stripeSessionId));
const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
const tx = await escrow.lock(taskId, relayer.address, USDC_LOCK_AMOUNT, deadline);
```

### Step 5.3 — Update Railway env vars

In Railway dashboard → your service → Variables:

| Variable | New Value |
|----------|-----------|
| `TASK_ESCROW_ADDRESS` | `0x<MAINNET_V2_ADDRESS>` |
| `BASE_RPC_URL` | `https://mainnet.base.org` |
| `USDC_ADDRESS` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Then trigger redeploy (Railway auto-deploys on env var change).

### Step 5.4 — Verify Railway is GREEN

```bash
curl -s https://zylogen-protocol-production.up.railway.app/health
# Expected: {"status":"ok","service":"zylogen-nova"}
```

---

## Phase 6 — Final test:preflight on Mainnet V2

```bash
cd /Users/wich/zylogen-protocol
TARGET_URL=https://zylogen-protocol-production.up.railway.app \
  npm run test:preflight
```

**Expected output:**
```
[1/3] POST → .../webhooks/stripe    HTTP 200 {"received":true}
[2/3] Waiting 4s...
[3/3] GET  → .../api/nova/status    HTTP 200 {"stage":"locked"}
✅ RAILWAY PRE-FLIGHT PASSED
```

Then verify on-chain:

```bash
node -e "
const {ethers} = require('ethers');
async function main() {
  const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
  const escrow = new ethers.Contract(
    '<MAINNET_V2_ADDRESS>',
    ['function getTask(bytes32) view returns (address,uint96,address,uint40,uint8)'],
    p
  );
  // Use taskId = keccak256(stripeSessionId) from the test
  const taskId = ethers.keccak256(ethers.toUtf8Bytes('<TEST_SESSION_ID>'));
  const task = await escrow.getTask(taskId);
  console.log('client:', task[0]);
  console.log('amount:', task[1].toString(), '(should be 9000000)');
  console.log('status:', task[4], '(1 = Locked)');
}
main();
"
```

**Success criteria:**
- `amount = 9000000` ✅
- `status = 1` (Locked) ✅
- Tx hash visible on basescan.org ✅

---

## Post-Deploy Actions (After Mainnet Confirmed)

```
[ ] Commit TASK_ESCROW_ADDRESS to CLAUDE.md (update "What IS the stack" table)
[ ] Archive V1 address in REFACTOR_PLAN.md as deprecated
[ ] Open PR to merge paymentRelay.js changes to main
[ ] Announce internal milestone to team (Logen, Wichi)
[ ] Schedule security debt items: multisig ownership, key rotation (see REFACTOR_PLAN.md)
```

---

## Emergency Procedures

### If Railway goes RED after env var update

1. Check Railway logs for the startup error
2. Revert `TASK_ESCROW_ADDRESS` to V1 address temporarily (service will start but lock() will fail — acceptable short-term)
3. Diagnose paymentRelay.js ABI issue
4. Fix code, push, Railway redeploys

### If lock() reverts on Mainnet after deploy

1. Check Railway logs for the revert reason
2. Call `escrow.pause()` from deployer wallet via cast or Basescan UI:
   ```bash
   cast send <V2_ADDRESS> "pause()" \
     --private-key $DEPLOYER_PRIVATE_KEY \
     --rpc-url https://mainnet.base.org
   ```
3. No funds are at risk — nothing has been locked yet if it's still in testing
4. Diagnose → fix → redeploy

### If USDC allowance is insufficient

The relay auto-approves before each lock call. But if approval was for exact amount and got consumed:

```bash
node -e "
const {ethers} = require('ethers');
async function main() {
  const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
  const usdc = new ethers.Contract(
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    ['function allowance(address,address) view returns (uint256)'],
    p
  );
  const a = await usdc.allowance(
    '0x24A400E17d2b9fd9C7eDd99f358A34Fe7751D849',
    '<V2_ADDRESS>'
  );
  console.log('allowance:', a.toString());
}
main();
"
```

The relay code already handles this — it re-approves if allowance is below lock amount.
