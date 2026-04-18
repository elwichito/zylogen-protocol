# Zylogen Protocol — Refactor Plan

Items flagged for cleanup. None of these block the current sprint. Resolve post-MVP when Logen approves.

---

## Monorepo Cleanup Issues

### 1. Duplicate contracts/ directory structure

**What:** `.sol` files live at two levels inside the `contracts/` Hardhat project:
- `contracts/TaskEscrow.sol` (Hardhat root — original location)
- `contracts/contracts/TaskEscrow.sol` (copied here so Hardhat's default `sources: "./contracts"` path finds them)
- Same duplication for `MockERC20.sol`, `TaskEscrowV2.sol`

**Why it exists:** Hardhat expects sources in `./contracts` subdir. The original files were placed at the Hardhat project root instead. Rather than change `paths.sources` (which caused node_modules scanning issues), files were copied to the standard location.

**Fix:** Delete the root-level duplicates (`contracts/MockERC20.sol`, `contracts/TaskEscrow.sol`, `contracts/TaskEscrowV2.sol`, `contracts/Lock.sol`) and keep only `contracts/contracts/*.sol` as the canonical location. Update any imports accordingly.

**Risk:** Low. No backend code imports these directly.

---

### 2. Legacy `oracle.js` at repo root

**What:** `scripts/oracle.js` exists at the repo root using PostgreSQL + OpenAI — both deferred per Honest Manifest.

**Fix:** Remove or archive once V2 is live and the pipeline is validated.

**Risk:** Low. `.dockerignore` already excludes `scripts/` from Railway builds.

---

### 3. `backend/` directory structure vs flattened root

**What:** Backend was originally at `backend/src/` but was flattened to root `src/` for Railway. The `backend/` directory still exists with `scripts/` and `.env`.

**Fix:** After V2 launch, decide canonical structure: keep flat or restore `backend/` hierarchy. Update `CLAUDE.md` accordingly.

**Risk:** Low. Current setup works. Only affects DX.

---

---

## Session Checkpoint — 2026-04-18

### Completed
- Railway backend live at zylogen-protocol-production.up.railway.app (GREEN)
- Fixed: duplicate Dockerfile ambiguity (commit fc22086)
- Fixed: package-lock.json desync (commit 2635850)
- Fixed: Custom Start Command override
- Fixed: STRIPE_WEBHOOK_SECRET missing in Railway
- Identified: Contract V1 uses ETH native, relay uses USDC — architectural mismatch
- Written: TaskEscrowV2.sol with full USDC support
- Passed: 24/24 unit tests, gas limits respected
- Security posture: keys not committed, .env in .gitignore confirmed

### Pending (Next Session)
- [ ] Wichi: add DEPLOYER_PRIVATE_KEY to backend/.env (from MetaMask 0x8bcB...3693e)
- [ ] Wichi: add BASESCAN_API_KEY to backend/.env
- [ ] Wichi: top-up Sepolia ETH to 0x8bcB...3693e (~0.05 ETH via faucet)
- [ ] Zyl: write scripts/deploy-v2-sepolia.js
- [ ] Zyl: deploy V2 to Base Sepolia
- [ ] Zyl: run test:preflight against Sepolia
- [ ] CTO checkpoint review
- [ ] Zyl: deploy V2 to Base Mainnet
- [ ] Zyl: update TASK_ESCROW_ADDRESS in Railway + update paymentRelay ABI
- [ ] Execute final test:preflight against Mainnet V2

### Security Debt (P0 — before public launch)
- Migrate contract ownership from hot MetaMask to Gnosis Safe multisig
- Rotate RELAYER_PRIVATE_KEY after V2 deploy
- Audit seed phrase storage: ensure paper backup, remove digital copies

### Architecture Decision Records
- ADR-001: Token Standard — USDC (ERC-20) over ETH native. Approved unanimously Claude+Logen+Wichi.
- ADR-002: Contract V1 (0x55a8...451f) marked as deprecated proof-of-concept. V2 will be canonical.

---

## Session Checkpoint — 2026-04-18 (Late)

### Completed Today
- Railway backend live (GREEN): zylogen-protocol-production.up.railway.app
- Infrastructure fixes: duplicate Dockerfile removed, lock file synced, custom start command cleared, STRIPE_WEBHOOK_SECRET added
- Oracle wallet funded: 10.21 USDC + 0.003 ETH on Base Mainnet
- Architectural discovery: V1 contract uses ETH, relay uses USDC — mismatch identified
- TaskEscrowV2.sol written (USDC native, 1% fee, ReentrancyGuard, Pausable, Ownable)
- 24/24 unit tests passing, gas within limits (lock 138k, release 58k)
- Team workflow formalized in TEAM_WORKFLOW.md

### Partial Settlement on Mainnet
- First `approve()` of USDC executed on-chain via Relayer (0x24A4...D849)
- `lock()` reverted due to V1/V2 ABI mismatch (expected; drove the V2 decision)
- Zero funds lost

### Next Session — Resume Here

**Blocking items for Wichi (before Zyl can continue):**
1. Add `DEPLOYER_PRIVATE_KEY` (MetaMask 0x8bcB...3693e) to `backend/.env`
2. Add `BASESCAN_API_KEY` to `backend/.env` (register at basescan.org/register)
3. Top-up Sepolia ETH to 0x8bcB...3693e (~0.05 ETH via coinbase.com/faucets/base-ethereum-sepolia-faucet)

**Zyl tasks once Wichi unblocks:**
4. Write scripts/deploy-v2-sepolia.js
5. Deploy V2 to Base Sepolia, verify on BaseScan
6. Run test:preflight against Sepolia (expect tx hash)
7. CTO checkpoint review
8. Deploy V2 to Base Mainnet, verify on BaseScan
9. Update TASK_ESCROW_ADDRESS in Railway variables
10. Update paymentRelay.js ABI for new lock() signature: lock(bytes32 taskId, address worker, uint256 amount, uint256 deadline)
11. Railway redeploy verification (GREEN)
12. Execute test:preflight against Mainnet V2 → TX HASH 🎯

### Security Debt (P0 — before any public user onboarding)
- Migrate contract ownership from MetaMask hot wallet to Gnosis Safe multisig
- Audit seed phrase storage (ensure paper backup, remove digital copies)
- Consider rotating RELAYER_PRIVATE_KEY post-V2 deploy

### NOVA Product Integration (OUT OF SCOPE)
- NOVA = AI Business Worker (end product)
- Zylogen Protocol = settlement infrastructure (what we're building)
- Sequence: complete Zylogen V2 on Mainnet FIRST, then NOVA integrates on top
- Attempting both in parallel = context fragmentation, scope creep
- Architect directive (Logen): "Forget NOVA for this sprint"

### Architecture Decision Records
- ADR-001: Token standard = USDC (ERC-20). Approved unanimously.
- ADR-002: Contract V1 (0x55a8...451f) = deprecated proof-of-concept. V2 canonical.
- ADR-003: Deployer-as-owner acceptable for MVP, migrate to multisig pre-launch.

---

*Maintained by Zyl. Last updated: 2026-04-18.*
