# Zylogen Protocol — Claude Code Context

## Operator / Roles
- **Wichi** — Operator. Gives directives, holds keys, makes final calls.
- **Logen** — Web3 Architect. Designs systems, approves architectural decisions.
- **Zyl** — Engine (Claude Code). Builds, fixes, reports. Never assumes approval.

---

## The Honest Manifest (Phase 2 MVP — locked)

This is the source of truth. Do not build anything outside this scope without Logen approval.

### What IS the stack
| Layer | Tech |
|-------|------|
| Smart contract | `TaskEscrowV2.sol` (see Contract Addresses below) |
| Backend | Node.js / Express on Railway |
| Database | **SQLite** (`nova.db`) — local file, mapped to Railway `/data` volume in prod |
| AI | **Claude Sonnet only** — single model, no routing |
| Payments | Stripe Checkout → webhook → `TaskEscrowV2.lock()` |
| Auth | Email collected at Stripe checkout. MetaMask address passed as `client_reference_id`. No JWT, no sessions. |
| Frontend | Next.js on Vercel Hobby (`zylogen.xyz`) |
| Chain | **Base** (Sepolia for testing, Mainnet for prod) |
| Token | **USDC** (6 decimals). Lock amount: `$9.00` = `9000000` |

### Contract Addresses (canonical)

There are two `TaskEscrowV2.sol` source files in the repo — they implement different protocols. Do not confuse them.

| Deployment | Source | Network | Address | Status |
|------------|--------|---------|---------|--------|
| **TaskEscrow V1** (legacy reference) | `contracts/contracts/TaskEscrow.sol` | Base Mainnet | `0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f` | Verified, 34/34 tests, **not consumed by current backend** |
| **TaskEscrowV2 (Nova)** | `contracts/contracts/TaskEscrowV2.sol` | Base Mainnet | `0xBE464859Fb6f09fa93b6212f616F3AD19ebe48B1` | **Live production** target of `paymentRelay.js` |
| **TaskEscrowV2 (ZYL Genesis)** | `contracts/contracts/zyl/TaskEscrowV2.sol` | Base Sepolia | `0x9b1516C79855F8E01A5Eb4B4E3A34430041Ae254` | Beta — adds ZYL burn + Spark rewards on top of V2. Not yet on mainnet. |

The Stripe → on-chain relayer (`backend/src/services/paymentRelay.js`) reads `TASK_ESCROW_ADDRESS` from env. Local Sepolia testing uses the ZYL Genesis address; Railway prod uses the Nova V2 address.

### What is DEFERRED (do not build until Logen approves Phase 3)
- ❌ Privy embedded wallets — use MetaMask first
- ❌ Paymaster / Gas Relayer — relayer wallet pays gas from margin
- ❌ Dual-model routing (GPT-4o-mini) — Claude Sonnet only for v1
- ❌ Sybil / graph analysis — skip until >50 paying users
- ❌ 24h timelock — contract already deployed without it; do not redeploy
- ❌ PostgreSQL — SQLite only

---

## Repo Structure

```
zylogen-protocol/
├── CLAUDE.md                          ← this file
├── .env.example                       ← all required vars documented
├── backend/
│   ├── nova.db                        ← SQLite database (gitignored)
│   ├── scripts/test-webhook.js        ← dry-run + live Sepolia test
│   └── src/
│       ├── index.js                   ← Express entry point
│       ├── agents/novaBrain.js        ← Claude Sonnet branding consultant
│       ├── db/sqlite.js               ← SQLite client + schema init
│       ├── routes/
│       │   ├── nova.js                ← /api/nova/* routes
│       │   └── webhook.js             ← /webhooks/stripe
│       └── services/
│           └── paymentRelay.js        ← Stripe → TaskEscrow.lock()
├── contracts/
│   ├── contracts/Zylogen.sol          ← reference only; do not redeploy
│   └── scripts/deploy.js
└── frontend/
    └── src/app/nova/
        ├── page.tsx                   ← /nova landing: MetaMask + email + pay
        └── dashboard/page.tsx         ← /nova/dashboard: kit display + Nova chat
```

---

## API Routes

```
GET  /health
GET  /api/nova/scarcity               — public, no auth
POST /api/nova/checkout               — body: { walletAddress, email }
POST /api/nova/message                — body: { email, message } — gated by escrow_records
GET  /api/nova/status?email=          — returns { stage, kit }
POST /webhooks/stripe                 — raw body, Stripe signature verified
```

---

## Environment Variables (required to run)

```bash
# Server
PORT=3001

# SQLite (optional override)
DB_PATH=./nova.db                    # Railway: /data/nova.db

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Base chain
BASE_RPC_URL=https://sepolia.base.org   # → mainnet.base.org for prod
RELAYER_PRIVATE_KEY=0x...               # Oracle wallet 0x24A4...D849
TASK_ESCROW_ADDRESS=0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Sepolia
USDC_LOCK_AMOUNT=9000000                # $9.00 in USDC

# Claude
ANTHROPIC_API_KEY=sk-ant-...

# Frontend
FRONTEND_URL=https://zylogen.xyz
```

## Known Blockers (must be resolved before first live transaction)

1. **Oracle wallet `0x24A4...D849` needs ETH** on Base Sepolia (gas for `approve` + `lock` calls)
2. **Anthropic API credits depleted** — Nova chat will return 401 until topped up

---

## Reporting Protocol — [TO LOGEN]

After every completed task, blocker, or decision point, Zyl appends:

```
[TO LOGEN]

Status: <1-2 sentences on what was just built/fixed>

Blockers: <missing keys, errors, decisions needed — or "None">

Next Action: <what Zyl plans to do next, pending approval>
```

---

## Verification Gate (before mainnet)

1. Fund relayer wallet with ETH on Base Sepolia
2. Set `BASE_RPC_URL=https://sepolia.base.org` and Base Sepolia USDC address
3. Run `stripe listen --forward-to localhost:3001/webhooks/stripe`
4. Pay with Stripe test card `4242 4242 4242 4242`
5. Confirm `lock()` tx appears on Basescan (Sepolia)
6. Only after confirmed → flip to mainnet RPC + USDC address
