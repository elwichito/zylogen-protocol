# `_archived/`

Code that was once part of the active project but is no longer used.
Kept on disk (rather than deleted) because it documents prior intent
and is referenced from older runbooks. Nothing here is imported or
executed by the live system.

| File | Was | Why archived |
|------|-----|--------------|
| `oracle.js` | A long-running Node process at `scripts/oracle.js` that bridged on-chain `Locked` events to Claude/OpenAI completions and writeback. | Per the Honest Manifest in `CLAUDE.md`, the oracle layer (PostgreSQL store, OpenAI router, sybil/graph analysis) is **deferred** for the Phase 2 MVP. The current Stripe → `TaskEscrowV2.lock()` flow runs synchronously inside the Express webhook handler (`backend/src/services/paymentRelay.js`); no oracle process is needed. |

To resurrect any of this, copy it back into its original location and
restore the dependencies it needs (e.g. `pg`, `openai`).
