# `contracts/scripts/`

Hardhat deployment scripts for the various TaskEscrow / ZylogenJob deployments.

The canonical inventory of what's actually deployed (and where) lives in
[`../../DEPLOYMENTS.md`](../../DEPLOYMENTS.md). The scripts here are how
new deployments get made.

## ZylogenJob V3 (ERC-8183 kernel) — Sepolia

This is the path for Fase 1.E of [`../../ROADMAP.md`](../../ROADMAP.md).

### Prerequisites

1. A funded EOA on Base Sepolia (≥ 0.005 ETH). Faucets:
   - https://www.alchemy.com/faucets/base-sepolia
   - https://faucet.quicknode.com/base/sepolia
2. (Recommended) a Basescan API key for auto-verify: https://basescan.org/myapikey

### Step-by-step

```bash
cd contracts/
cp .env.example .env
```

Open `contracts/.env` and fill in **at minimum**:

```bash
DEPLOYER_PRIVATE_KEY=0x<your_funded_eoa_key>
BASESCAN_API_KEY=<your_basescan_key>      # recommended; without it verify will fail
```

You can leave these as default for the V3 kernel Sepolia deploy:

```bash
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e   # Sepolia USDC (Circle)
KERNEL_PAUSER_ADDRESS=                                       # empty → defaults to deployer
KERNEL_FORWARDER=                                            # empty → address(0), no meta-tx
```

Then run the deploy:

```bash
npx hardhat run scripts/deploy-zylogenjob-sepolia.js --network baseSepolia
```

### What the script does

1. Checks the deployer wallet has ≥ 0.005 ETH on Base Sepolia. Aborts with a clear error otherwise.
2. Resolves the three constructor args from env (with sensible defaults).
3. Prints the resolved args and gives you a **5-second window to abort with Ctrl+C** before broadcasting.
4. Deploys `contracts/contracts/v3/ZylogenJob.sol`.
5. Waits 5 block confirmations.
6. Calls `hardhat verify` automatically with the same constructor args (no manual flatten needed).
7. Prints a summary block plus a pre-formatted markdown snippet you can paste into `DEPLOYMENTS.md` under "Base Sepolia".

### Expected output

```
========================================
  ZylogenJob — Base Sepolia Deploy
========================================

Deployer:        0x...
Balance:         0.05 ETH

Constructor args:
  paymentToken_:     0x036CbD53842c5426634e7929541eC2318f3dCF7e (USDC Sepolia, default)
  pauser_:           0x...                                          (deployer, default)
  trustedForwarder_: 0x0000000000000000000000000000000000000000   (none — no meta-tx)

  abort with Ctrl+C — broadcasting in 5s ...
  abort window closed — broadcasting tx now

Deploying ZylogenJob ...
  tx submitted:    0x...
  deployed at:     0x...

Waiting 5 block confirmations before verification ...
Verifying on Basescan Sepolia ...
✅ Verified on Basescan Sepolia

========================================
  DEPLOYMENT SUMMARY
========================================
...
```

### After a successful deploy

1. Copy the printed markdown snippet into [`../../DEPLOYMENTS.md`](../../DEPLOYMENTS.md) under the "Base Sepolia" section.
2. Tick the "Deploy en Base Sepolia" item in [`../../ROADMAP.md`](../../ROADMAP.md) Fase 1.D / 1.E.
3. Add a one-line entry to [`../../SESSIONS.md`](../../SESSIONS.md) referencing the deployed address and tx hash.

## Other scripts in this directory

These are kept for historical / reference purposes. Many target the legacy contracts catalogued in `DEPLOYMENTS.md`.

| Script | Target | Status |
|---|---|---|
| `deploy.js` | TaskEscrow V1 (ETH-only, legacy) | Legacy reference. The deployed V1 at `0x55a8461a…451f` was produced by this. |
| `deploy-v2-sepolia.js` | TaskEscrowV2 "Nova" (USDC, 1% fee) | Legacy V2 Sepolia variant; superseded by V3. |
| `deploy-v2-mainnet.js` | TaskEscrowV2 "Nova" on mainnet | Used for `0xBE464859…48B1`. Do not re-run. |
| `deploy-zyl-genesis.js` | TaskEscrowV2 ZYL Genesis + ZYL token + AgentID + SparkStaking | ZYL Genesis Sepolia stack. |
| `deploy-zyl-testnet.js` | Earlier ZYL Genesis testnet variant | Pre-Genesis pass. |
| `continue-deploy.js` | Resume an interrupted ZYL Genesis deploy | Recovery utility. |
| `check-balances.js` | Read-only balance probe | Diagnostic. |
| `check-escrow-detail.js` | Read-only escrow probe | Diagnostic. |
| `test-task-flow.js`, `test-task-flow-zyl.js` | One-shot integration smoke tests | Diagnostic. |
| **`deploy-zylogenjob-sepolia.js`** | **ZylogenJob V3 (current focus)** | **Active.** |
