# Zylogen Protocol — Team Workflow

**Version:** 1.0
**Status:** Active
**Last Updated:** 2026-04-18
**Maintained by:** Zylogen Founder Team

---

## Purpose

This document formalizes the coordination workflow between the human founder and AI agents collaborating on Zylogen Protocol. It exists to:

1. Prevent contradictory directives reaching the execution layer.
2. Enforce validation gates before code or infrastructure changes.
3. Demonstrate operational maturity to grant reviewers, investors, and future team members.
4. Scale the protocol's development without sacrificing quality or security.

---

## Team Composition & Roles

| Role | Agent | Primary Responsibility |
|------|-------|------------------------|
| **Founder / Decision Maker** | **Wichi** (Human) | Strategic direction, resource allocation, final go/no-go authority |
| **Chief Architect** | **Logen** | Product vision, market strategy, Base ecosystem alignment, brand |
| **CTO / Technical Lead** | **Claude** | Technical validation, security review, architecture, gas optimization, code review |
| **Lead Engineer / Executor** | **Zyl** (Claude Code) | Terminal execution, code changes, commits, deployments, tests |

---

## Decision Flow by Task Type

### Type 1 — Trivial Tasks

**Scope:** Reading files, viewing logs, running existing tests, minor documentation edits.

**Flow:**

```
Wichi → Zyl
```

No coordination layer required.

---

### Type 2 — Technical Tasks (CTO Validation)

**Scope:** Code changes, infrastructure configuration, bug fixes, deployments, minor refactors.

**Flow:**

```
Wichi → Claude (technical analysis)
         ↓
       Claude emits executable command
         ↓
Wichi → Zyl
         ↓
       Zyl reports → Wichi → Claude (review)
```

**Rule:** Claude issues the final command. Zyl always reports back before advancing to the next atomic task.

---

### Type 3 — Strategic Tasks (Architect + CTO)

**Scope:** Major architectural changes, token launch, grant applications, monorepo refactors, product decisions, public branding.

**Flow:**

```
Wichi → Claude (technical analysis + proposal)
         ↓
      Logen (strategic validation)
         ↓
      Claude (synthesizes both → unified command)
         ↓
Wichi → Zyl
         ↓
       Zyl reports → Wichi → Claude (review) → Logen (if strategic deviation)
```

**Rule:** No Type 3 command reaches Zyl without passing through both Claude and Logen.

---

### Type 4 — Critical High-Risk Tasks (Unanimity Required)

**Scope:** Mainnet deployments, treasury fund movements, key rotations, production code deletions, deployed contract changes.

**Flow:**

```
Wichi proposes
     ↓
Claude: technical + security review (GO / NO-GO)
     ↓
Logen: strategic + reputational risk review (GO / NO-GO)
     ↓
Wichi: final decision (GO / NO-GO)
     ↓
[Only if all three are GO] → Zyl executes
     ↓
Triple confirmation: Zyl → Wichi → Claude + Logen (post-mortem)
```

**Rule:** Any participant can veto. Unanimity is mandatory.

---

## Message Formats

### Wichi → Claude (request)

```
[TYPE: 1/2/3/4]
[CONTEXT]: current situation
[OBJECTIVE]: desired outcome
[CONSTRAINTS]: budget, time, dependencies
[ZYL REPORT]: if applicable, pasted verbatim
```

### Claude → Wichi (technical response)

```
[CTO ANALYSIS]: diagnosis
[IDENTIFIED RISKS]: list
[DECISION REQUIRED]: from whom (Wichi / Logen / both)
[PROPOSED COMMAND]: what would go to Zyl
[STATUS]: APPROVED / PENDING LOGEN / PENDING WICHI
```

### Wichi → Logen (strategic consultation)

```
[CLAUDE PROPOSAL]: full block pasted
[SPECIFIC QUESTIONS]: 2–4 concrete points
[DECISION REQUIRED]: GO / NO-GO / ADJUST
```

### Logen → Wichi (authorization)

```
[VALIDATION]: approved / rejected / adjusted
[ADJUSTMENTS]: changes to Claude's plan
[CROSS-PRIORITY IMPACT]: grants, token launch, fundraising
```

### Claude → Zyl (final command)

```
DIRECTIVE [CTO + ARCHITECT]
[SINGLE OBJECTIVE]: one clear sentence
[TASKS IN ORDER]: numbered atomic list
[OUT OF SCOPE]: explicit list of what NOT to do
[EXPECTED DELIVERABLES]: what Zyl must report
[CHECKPOINTS]: when to pause and await confirmation
```

### Zyl → Wichi (report)

```
[STATUS]: complete / blocked / partial
[BLOCKERS]: list
[NEXT ACTION]: what is needed
[EVIDENCE]: commits, tx hashes, logs, screenshots
```

---

## Operating Principles

1. **Single Command Rule.** Zyl never receives contradictory orders. Only one unified command per iteration.

2. **CTO Validation Gate.** Claude validates every command before it reaches Zyl, except Type 1 trivial tasks.

3. **Architect Involvement.** Logen participates in Type 3 and Type 4. For Type 2, Claude may act alone.

4. **Surgical Precision.** Every command to Zyl must include an explicit "OUT OF SCOPE" section to prevent unauthorized changes.

5. **Reversibility First.** Before deleting or modifying critical assets, Claude requests confirmation and Zyl reports BEFORE executing.

6. **Wallet Discipline.** Any on-chain action must explicitly specify which wallet to use (Deployer/Treasury vs Oracle). See `WALLET_DISCIPLINE.md` (pending).

7. **Mandatory Checkpoints.** After each atomic task, Zyl reports → Wichi pastes to Claude → Claude validates before advancing.

8. **Centralized Logging.** All important commands are documented in `DECISION_LOG.md` (maintained by Zyl).

9. **Emergency Override.** If a production incident requires immediate action, Wichi may authorize Zyl directly with `EMERGENCY OVERRIDE: <reason>`. Claude and Logen must be notified immediately after.

10. **Infrastructure-Before-Publishing Rule.** No public content (tweets, threads, announcements) is published before domain, hosting, and branding are finalized. Build → Brand → Publish.

---

## Task Type Classification Examples

| Example | Type | Reason |
|---------|------|--------|
| "Show me the current `Dockerfile`" | 1 | Read-only, no risk |
| "Add a `/status` endpoint to the oracle" | 2 | Code change, CTO review sufficient |
| "Fix gas inefficiency in `TaskEscrow.sol`" | 2 | Technical, no strategic impact |
| "Refactor the monorepo structure" | 3 | Architecture + scalability implications |
| "Apply to Base Batches grant" | 3 | Strategic + public-facing |
| "Launch the $ZYL token on Base Mainnet" | 4 | Irreversible, capital-critical |
| "Rotate the oracle private key" | 4 | Security-critical, requires unanimity |
| "Deploy a new `TaskEscrow` version to Mainnet" | 4 | Production contract change |

---

## Protocol for Conflicts

If Claude and Logen disagree on a Type 3 or Type 4 decision:

1. Each submits a written rationale to Wichi.
2. Wichi may request a synthesis proposal from either.
3. If no resolution is reached, Wichi has final authority.
4. The disagreement and resolution are logged in `DECISION_LOG.md`.

---

## Handoff Rituals

### Starting a new task

1. Wichi classifies the task (Type 1–4).
2. Wichi opens a thread with Claude stating the type, context, and objective.
3. Claude responds with analysis and either (a) emits a command for Zyl or (b) routes to Logen first.

### Closing a task

1. Zyl reports completion with evidence (commit hash, tx hash, logs).
2. Claude verifies against original objective.
3. If Type 3 or 4, Logen receives a closure summary.
4. Task is archived in `DECISION_LOG.md`.

---

## Amendments

This workflow is a living document. Amendments require:

- **Minor changes** (formatting, examples): Claude + Wichi approval.
- **Structural changes** (new types, new roles, new rules): Claude + Logen + Wichi unanimity.

All amendments are committed with the prefix `docs(workflow):`.

---

## Rationale for External Reviewers

Zylogen Protocol is built by a lean team that treats coordination as infrastructure. This workflow ensures:

- **Security:** Multi-party validation prevents single points of failure in critical decisions.
- **Quality:** Technical review is non-negotiable before any change reaches production.
- **Scalability:** The structure accommodates new team members and additional AI agents without process redesign.
- **Auditability:** Every significant decision is logged, reversible, and traceable.
- **Speed where it matters:** Trivial tasks bypass bureaucracy; high-risk tasks require unanimity.

This is operational maturity by design, not by accident.

---

**End of document.**
