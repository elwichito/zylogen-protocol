# Zylogen Protocol — Base Batches Grant Application Draft

**Program:** Base Batches  
**Category:** DeFi Infrastructure / AI × Crypto  
**Stage:** MVP — live on Base Mainnet  
**Draft Version:** 1.0 (2026-04-18)

---

## What Is Zylogen Protocol?

Zylogen Protocol is a USDC settlement layer built on Base that enables AI agents to receive, hold, and release payments autonomously — without human custodians, bank accounts, or centralized payment processors in the critical path.

The core primitive: a smart contract escrow where fiat payments (credit card via Stripe) are automatically converted to on-chain USDC locks, and released to the AI worker upon delivery verification. The entire flow — from card swipe to blockchain settlement — requires zero manual intervention.

---

## The Problem

AI-native products that deliver real work face an unsolved coordination problem: how do you pay an AI agent for a completed task in a way that is verifiable, programmable, and trustless?

Today's solutions are inadequate:
- **Stripe alone**: centralized, no programmability, funds sit in a bank
- **Crypto-native payments**: require users to already hold crypto — kills conversion
- **Traditional escrow**: slow, expensive, requires human arbitration

The result: AI services either collect payment upfront (trust the agent) or collect on delivery (trust the client). Both create adversarial dynamics that scale poorly.

---

## How Zylogen Solves It

```
User pays $9.99 with a credit card
        ↓
Stripe Checkout session created
        ↓
Webhook fires → Zylogen backend on Railway
        ↓
Relayer wallet calls approve() + lock() on Base Mainnet
        ↓
9 USDC locked in TaskEscrowV2 smart contract
        ↓
AI agent (Nova) delivers the work product
        ↓
Oracle wallet calls release() → worker receives 8.91 USDC (1% fee)
```

The client never touches crypto. The AI agent never waits for a wire transfer. The escrow is transparent, auditable, and programmable.

---

## Technical Architecture

**Smart Contract:** `TaskEscrowV2.sol` — deployed on Base Mainnet  
- USDC ERC-20 native (not ETH payable)
- 1% protocol fee on release, accumulated in contract
- Oracle-controlled release/refund with full ReentrancyGuard + Pausable safety
- Gas-optimized struct packing: 2 storage slots (lock: ~138k gas, release: ~58k gas)
- 24/24 unit tests passing

**Backend:** Node.js / Express on Railway  
- Stripe webhook verification (HMAC-SHA256)
- SQLite for idempotency and state tracking
- Relayer wallet signs all on-chain transactions
- `/health` endpoint for zero-downtime monitoring

**Frontend:** Next.js on Vercel (`zylogen.xyz`)  
- MetaMask wallet connection
- Stripe Checkout integration
- Real-time status polling after payment

**AI Layer:** Claude Sonnet via Anthropic API  
- Nova: AI branding consultant, gated by on-chain payment verification
- No payment → no access. The blockchain is the auth layer.

---

## Traction

- ✅ First `approve()` USDC transaction executed on Base Mainnet (2026-04-18)
- ✅ End-to-end Stripe → webhook → on-chain flow validated
- ✅ Railway backend live with zero downtime since deployment
- ✅ V2 smart contract written, tested (24/24), ready for Mainnet deploy
- ✅ Webhook pipeline processing real events with correct signature verification
- 🔜 First `lock()` transaction on Mainnet — imminent (V2 deploy this week)

The V1 contract mismatch (ETH vs USDC) was an architectural discovery that drove us to ship V2 — a stronger, production-ready contract with full ERC-20 support. Every failure was a test that made the system more resilient.

---

## Why Base?

Base is the natural home for Zylogen:

1. **USDC is native** — Coinbase is USDC. Base is Coinbase. Our payment token is the chain's native stablecoin.
2. **Low gas costs** — Locking $9 of USDC would be uneconomical on Ethereum L1. On Base, gas is cents.
3. **Ecosystem alignment** — Base is building the onchain economy. Zylogen is building the payment rail for AI workers within that economy.
4. **Developer tooling** — Hardhat + BaseScan verification + `https://mainnet.base.org` RPC worked day one.

---

## 90-Day Roadmap

**Month 1 — Settlement Infrastructure (current)**
- Deploy TaskEscrowV2 to Base Mainnet ← *this week*
- Execute first end-to-end `lock()` → `release()` cycle on Mainnet
- Onboard Founding 100 users to Nova product

**Month 2 — Product Validation**
- 50+ paying users through the Stripe → USDC → AI delivery pipeline
- Implement analytics: conversion rate, delivery time, release/refund ratio
- Open-source TaskEscrowV2 contract + publish technical writeup

**Month 3 — Protocol Expansion**
- Multi-agent support: any AI service can integrate Zylogen as a payment layer
- SDK draft: `zylogen-sdk` npm package for AI developers
- Apply to additional Base ecosystem programs + developer grants

---

## Grant Use of Funds

| Allocation | Amount | Purpose |
|-----------|--------|---------|
| Infrastructure | 30% | Railway scaling, Vercel Pro, RPC node |
| Security audit | 40% | Professional audit of TaskEscrowV2 before public launch |
| SDK development | 20% | `zylogen-sdk` npm package + documentation |
| Marketing | 10% | Developer community outreach on Base |

---

## Team

**Wichi** — Founder. Product vision, strategy, fundraising.  
**Logen** — Web3 Architect. Smart contract design, Base ecosystem alignment.  
**Claude (Zyl)** — Technical implementation. Contract, backend, deployment.

We are a lean, AI-augmented team that treats coordination as infrastructure. Our workflow is documented, versioned, and auditable — see `TEAM_WORKFLOW.md`.

---

## Why Now?

The convergence of:
- Cheap L2 gas (Base)
- Native USDC (Coinbase)
- Production-ready AI APIs (Anthropic)
- Consumer-friendly fiat onramps (Stripe)

...makes 2026 the first year where "credit card → AI agent → crypto settlement" is a viable product experience, not a technical curiosity.

Zylogen is building the settlement primitive that makes this work at scale. The window to establish this infrastructure layer is open now.

---

*Draft prepared by Zyl for review by Wichi and Logen. Not yet submitted.*  
*Word count: ~570 words (adjust to 500 before submission if required)*
