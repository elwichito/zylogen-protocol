# SESSIONS — Bitácora operativa Zylogen Protocol

> Cada entrada es una sesión de trabajo. Formato corto, en español natural.
> Cuando una sesión continúa otra (mismo día o continuación temática),
> se amplía la entrada existente en lugar de crear una nueva.
>
> Campos por entrada: **fecha**, **operator + asistente**, **qué se hizo**,
> **qué quedó pendiente**, **blockers**, **commits/PRs**, **decisiones**.
> Lo demás es ruido y se omite.

---

## 2026-05-10 — Régimen operativo (Fase 0)

**Operator:** Wichi · **Asistente:** Zyl (Claude Code)

### Decisión grande de la sesión

Se cerró el **norte estratégico**: Zylogen es el toolkit que permite a un
founder solo desplegar un protocolo agentic completo en Base en una
semana, sin equipo. Se descartaron las opciones de red descentralizada
con $ZYL (sin comunidad no hay protocolo) y de estándar silencioso (no
sostenible vs equipos grandes). Norte cerrado, no se vuelve a debatir.

### Qué se hizo

- Norte persistido en memoria estratégica (`norte_estrategico.md`).
- Snapshot del estado actual de `main` antes del cleanup (para referencia
  histórica del "antes" — captura abajo).
- Creados los 3 documentos operativos: `WORKFLOW.md`, `ROADMAP.md`,
  `SESSIONS.md` (este archivo) sobre rama `claude/fase-0-ops`.

### Snapshot del repo en `main` (antes de mergear PR #2)

```
ROOT /src/  →  agents/, db/, jobs/, middleware/, routes/, services/, index.js (2483 bytes)
/backend/src/  →  agents/, db/, jobs/, lib/, middleware/, routes/, services/, index.js (6508 bytes)
package.json (root):    main = "src/index.js", start = "node src/index.js"
backend/package.json:   main = "src/index.js", start = "node src/index.js"
```

Confirma la duplicación que PR #2 resuelve: `/src` raíz es una copia
divergente más vieja, le falta `lib/`, y la `package.json` raíz apunta
a un entrypoint que en producción no se usa (Railway corre desde `backend/`).

### Cierre de la sesión (continuación 2026-05-10)

Mismo día, segunda mitad — Wichi ejecutó la secuencia de merge:

- PR #3 (régimen operativo) **mergeado** con squash → `WORKFLOW.md` + `ROADMAP.md` + `SESSIONS.md` viven en `main`.
- PR #2 (dotenv fix + cleanup estructural) **mergeado** con squash. Verificación post-merge:
  - `/src/` eliminado del root (las dirs vacías `jobs/` y `middleware/` que git no trackea se barrieron a mano con `rm -rf src/`).
  - `package.json` y `package-lock.json` raíz eliminados.
  - `backend/src/` intacto y canónico.
- `gh auth refresh -s workflow` completado (scope `workflow` activo en el token).
- Workflow de CI (`.github/workflows/test.yml`) movido desde `.pending-workflow/` y empujado vía esta misma rama → PR #4.

### Pendientes después de la sesión

- Mergear PR #4 (CI workflow + cierre de sesión).
- Decidir destino de Railway `strong-enthusiasm` (staging oficial o eliminar).

### Blockers

- Ninguno. Las tres acciones de hoy quedaron cerradas.

### Decisiones (refuerzo)

- Norte ratificado y cerrado: SDK para founders solos en Base. No se vuelve a debatir.
- Las tres decisiones de producción (fondear relayer mainnet, V2 migration, Stripe live) **no se tocaron en esta sesión**, quedan para una sesión separada cuando el repo estuviera limpio. Hoy se cumplió la condición.

### Commits / PRs de la sesión

- PR #2 (`claude/funny-galileo-e285a2`) → mergeado con squash el 2026-05-10
- PR #3 (`claude/fase-0-ops`) → mergeado con squash el 2026-05-10 (dejó en `main` los 3 documentos operativos)
- PR #4 (`claude/ci-and-session-close`) → CI workflow + este cierre de SESSIONS
- PR #5 (`claude/close-session-2026-05-10`) → este append con el resumen ejecutivo

### Cierre de sesión

**3 PRs mergeados:**
- PR #2 — dotenv fix + structural cleanup
- PR #3 — operational system (WORKFLOW + ROADMAP + SESSIONS)
- PR #4 — CI workflow + session close

**Fase 0: sustancialmente cerrada.** Pendiente residual: Railway `strong-enthusiasm`.

**Próxima sesión: arrancar Fase 1.**
1. Auditar `sdk/index.js` actual
2. Definir interfaz mínima `ZylogenAgent.deploy()`
3. Leer ERC-8183 spec completa

---

## 2026-05-11 — Fase 1.A → 1.D completas (kernel V3 ERC-8183 listo para deploy)

**Operator:** Wichi · **Asistente:** Zyl (Claude Code)

### Qué se hizo

Toda la Fase 1 del roadmap salvo el deploy a Sepolia y el audit, encadenada en una sola sesión:

- **Fase 1.A — Documentación legacy** (cerrada).
  - PR #6: `DEPLOYMENTS.md` con los 3 contratos legacy + tabla canónica + sub-fases 1.A–1.E.
  - PR #7: `CLAUDE.md` con sección de Deployments apuntando a `DEPLOYMENTS.md`, y banner ⚠️ DEPRECATED al inicio de `sdk/README.md`.
- **Fase 1.B — Audit ERC-8183** (cerrada).
  - PR #8: `ERC8183_REQUIREMENTS.md` con tabla MUST/SHOULD/MAY (21+7+8 requisitos) auditando `contracts/contracts/zyl/TaskEscrowV2.sol`. 7 BLOCKERS, 4 MAJOR, 3 MINOR. Hallazgo crítico: `timeout()` actual paga al worker en vez del client — violación directa de M13.
- **Fase 1.C — Diseño del kernel** (cerrada).
  - PR #9: `ZYLOGENJOB_DESIGN.md` con arquitectura kernel + hook split, state machine, interfaces Solidity completas, 10 decisiones explícitas, lista de anti-features, y 5 open questions resueltas en el mismo PR (MAX_DURATION=365d, paymentToken immutable, hookGas=500k, FeeHook out-of-scope, Sepolia→mainnet, sin Ownable).
- **Fase 1.D — Implementación + tests** (cerrada).
  - PR #10: `contracts/contracts/v3/ZylogenJob.sol` (438 LOC) — pure ERC-8183, compila clean en 0.8.25, 49 sources totales en hardhat.
  - PR #11: 56 tests Hardhat (5 categorías A-E) + 2 mocks (`TestACPHook.sol`, `ReentrantToken.sol`). Cobertura del kernel: **statements 98.92% · branches 94.59% · functions 95% · lines 99.07%**. Sin bugs encontrados en el contrato durante el desarrollo de tests.

### Pendientes al cierre

- **Fase 1.E** (siguiente sesión): deploy Sepolia, audit interno con checklist OpenZeppelin, slither/mythril, deploy mainnet, SDK mínima apuntando al V3, publicar `@zylogen/sdk` en npm.
- Residual de Fase 0: decidir destino de Railway `strong-enthusiasm` (sin urgencia).

### Blockers

Ninguno.

### Commits / PRs

- PR #6 → mergeado (squash) — Fase 1.A.1
- PR #7 → mergeado (squash) — Fase 1.A.2 + 1.A.3
- PR #8 → mergeado (squash) — Fase 1.B
- PR #9 → mergeado (squash) — Fase 1.C
- PR #10 → mergeado (squash) — Fase 1.D impl
- PR #11 → mergeado (squash) — Fase 1.D tests
- Commit directo a `main` (`[fase-1d] close: ...`) — este housekeeping

### Decisiones

- **Opción C definitiva**: deployar V3 limpio en vez de patchear cualquiera de los 3 contratos legacy. Fase 1.A documenta legacy, Fase 1.C–D construye el V3.
- **Hard split kernel + hook**: `ZylogenJob.sol` es 100% ERC-8183 puro; features Zylogen (fees, burn, spark, reputation) van a un `ZylogenFeeHook.sol` opcional cuyo diseño se posterga.
- **Sin Ownable en el kernel**: el único rol admin es `PAUSER` (immutable, solo pause/unpause). Kernel completamente immutable, sin proxies.
- **Tests categoría por categoría (A–E)** como contrato de calidad estable para todas las futuras versiones del kernel.

---

## 2026-05-18 — Fase 1.E script + Nova product pivot

**Operator:** Wichi · **Asistente:** Zyl (Claude Code)

### Qué se hizo

Tres PRs mergeados, todos sobre `main` con CI verde:

- **PR #12 — Fase 1.E sepolia deploy script.** `contracts/scripts/deploy-zylogenjob-sepolia.js` (130 LOC), guía paso-a-paso en `contracts/scripts/README.md`. Agrega `KERNEL_PAUSER_ADDRESS` y `KERNEL_FORWARDER` a `contracts/.env.example`. Whitelist de `.env.example` en `.gitignore` (antes el patrón `.env.*` los descartaba). El comando final que Wichi corre cuando tenga la EOA fondeada: `cd contracts && npx hardhat run scripts/deploy-zylogenjob-sepolia.js --network baseSepolia`.

- **PR #13 — Pivot de producto Nova.** Drop del brand-kit (visual system + content strategy + voice guide) que prometíamos y no podíamos entregar. Nuevo deliverable: 1:1 chat con Claude Sonnet, gated por el escrow de $9.99. Backend: nueva función `chatWithNova(email, message, history)` stateless con system prompt bilingüe ES/EN. Frontend: dashboard reescrito como panel de chat puro con FX cyberpunk (terminal bar `nova@zylogen:~`, burbujas de Nova con glow verde pulsante, typing dots animados, scanlines, fade-in, auto-scroll, auto-focus). Landing copy actualizado: "Your founder's thinking partner".

- **PR #14 — Fix de settlement.** PR #13 dejó un agujero: removió el único call site de `releasePayment`. Cada pago futuro habría dejado 9 USDC stranded en el escrow. Fix: llamar a `releasePayment(taskId, email)` inmediatamente después de que `lock()` confirma, dentro de `relayPaymentToEscrow`. Best-effort (try/catch): si settle falla, lock ya se hizo, el chat unlock sigue funcionando, escrow queda `status='locked'` para un retry futuro.

### Pendientes al cierre

- **Webhook Stripe ausente.** Stripe sandbox no tiene ningún webhook endpoint registrado (la lista está vacía). Probablemente alguien lo borró desde la sandbox UI o Stripe lo limpió. Hasta que se recree apuntando a `https://zylogen-protocol-production.up.railway.app/webhooks/stripe`, ningún pago real triggea Railway → ningún cliente nuevo puede chatear.
- **Cron de retry para escrows stuck.** PR #14 deja `status='locked'` cuando settle falla; nada lo retoma automáticamente. Manual hoy.
- **Verificación end-to-end real.** Intenté disparar un webhook firmado contra Railway pero el container rechazaba la firma (mismo bug de "stale env" que vimos en sesiones anteriores), incluso después de redeploy fresco. La causa raíz requiere más diagnóstico; el código del chat en sí está sano (CI verde, lógica revisada). Verificación quedó parcial.
- **Cleanup de dead code de la era brand-kit.** ~150 LOC en `kitGenerator.js`, `sendKitDeliveredEmail`, columna `branding_kit`, ruta admin. Sigue en disco para no romper el panel admin que muestra kits históricos.
- **Fase 1.E real deploy.** Script listo, falta que Wichi corra el comando con su EOA fondeada en Sepolia.

### Blockers

- **Webhook Stripe borrado.** Bloquea adquisición de nuevos clientes vía pago Stripe. Para reabrir: `stripe webhook_endpoints create --url https://zylogen-protocol-production.up.railway.app/webhooks/stripe --enabled-events checkout.session.completed` y después `railway variables --set STRIPE_WEBHOOK_SECRET=whsec_xxx` con el secret nuevo.
- **Firma de webhook rechazada por Railway prod.** Container parece tener un secret stale. Workaround conocido (de sesiones previas): set la env var dos veces consecutivas, segunda vez fuerza redeploy con la nueva. No probé este workaround hoy.

### Commits / PRs

- PR #12 → mergeado (squash) — Fase 1.E deploy script
- PR #13 → mergeado (squash) — Nova chat pivot
- PR #14 → mergeado (squash) — settle on lock
- Commit directo a `main` (`[ses-2026-05-18] close`) — este housekeeping

### Decisiones

- **El chat es el deliverable.** Pivote explícito desde "brand kit promised in 24h" a "chat directo right now". El precio sigue siendo $9.99 USDC en escrow on Base.
- **Settle inmediato al lock.** No hay milestone de fulfilment separado; value se entrega al unlockear la sesión.
- **No tocar el código admin / kitGenerator todavía.** Para no romper el dashboard interno que muestra órdenes históricas. Cleanup en sesión separada.

---

## 2026-05-19 → 2026-05-20 — Fase Nova 2 (pivot a suscripción mensual)

**Operator:** Wichi · **Asistente:** Zyl (Claude Code)

### Decisión grande de la sesión

Pivote del modelo de pago: de **one-time $9.99 con escrow** a **suscripción mensual $9.99/mo (founding 100) → $29.99/mo (resto)**. La wallet pasa a ser la identidad real del producto (no más email-trust desde URL). Cancel = se pierde el founding rate. Fallo de cobro = acceso cortado inmediatamente, sin grace period.

### Qué se hizo

**PR #15** (rama `fase-nova-2-subscription-pivot`, 7 commits, ready-for-review):

1. **Meta tags + `/` → `/nova` redirect** (91d4f63). Drop del copy brand-kit en tabs/Google/Twitter previews. Root deja de 404.
2. **DB schema** (6b6d984). 5 tablas nuevas: `subscriptions` (partial unique index para enforcing 1 active por wallet), `nova_messages` (chat persistido), `auth_nonces`, `auth_sessions` (cookie hashed), `crypto_payments` (UNIQUE tx_hash).
3. **Wallet auth (SIWE-lite)** (8e72fe6). `/api/auth/nonce` + `/verify` + `/logout` + `/me`. Cookie HttpOnly 30d. `scripts/test-auth.js` — 14/14 assertions de isolation pass (cross-wallet forge, replay, tampered sig, session leak).
4. **Stripe subscriptions** (f824ac6). `scripts/setup-stripe-products.js` (idempotente), `services/subscriptions.js` (DB + atomic founding slot claim), `services/stripeWebhook.js` (4 eventos), nuevas rutas `/subscribe`, `/billing-portal`, `/subscription/status`, `/history`, `/message` ahora authed + gated por `hasActiveAccess(wallet)`.
5. **Dashboard rewrite** (43fb479). Login card (Connect → Sign → cookie), chat hidratado desde `/api/nova/history`, "Manage" → Stripe Billing Portal, "Sign out", FOUNDING badge, próxima fecha de renew. Wallet-mismatch warning como diagnóstico.
6. **Landing copy** (4778c75). Probe de `/scarcity` para mostrar precio correcto antes del click ($9.99 vs $29.99). Botón Stripe usa `/subscribe`. Crypto button deshabilitado temporal (legacy escrow no satisfacía nuevo gate).
7. **Crypto monthly** (5234d5b). `USDC.transfer(treasury, $9.99)` → `/api/nova/crypto-verify` → backend lee receipt vía JsonRpcProvider, parsea Transfer event, idempotente vía UNIQUE(tx_hash), extiende `current_period_end` 30 días. Renewals stackean desde `max(now, current_period_end)`.

Subtarea paralela: agente spawneado migró `layout.tsx` a `next/font/google` (zero-CLS, self-hosted). Bundled en commit 4778c75.

### Pendientes al cierre

Todos operator-side (Wichi-holds-keys):

- Correr `node backend/scripts/setup-stripe-products.js` y pegar los IDs (`STRIPE_PRICE_FOUNDING`, `STRIPE_PRICE_REGULAR`) en Railway env
- Recrear webhook Stripe → 4 eventos (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`), copiar `whsec_` a Railway
- Setear `NOVA_TREASURY_ADDRESS` en Railway (fallback actual = `NOVA_WORKER_ADDRESS`, funciona pero mezcla flujos)
- Verificación end-to-end real: tarjeta test `4242 4242 4242 4242` + tx USDC test
- Merge PR #15 → main

Polish que quedó para siguientes sesiones:
- Botón "Renew with USDC" dedicado en dashboard (hoy el landing flow funciona como renew vía idempotencia del `/crypto-verify`)
- Migrar endpoints legacy email-as-identity (`/status`, `/verify-payment`, `/referral/*`, `/my-referrals`, `/apply-referral`)
- Cleanup brand-kit dead code (sigue pendiente desde sesión anterior)

### Blockers

Ninguno desbloqueable por Zyl. Toda la implementación buildea limpia (tsc + `npm run build`) y los tests de isolation pasan.

### Commits / PRs

- PR [#15](https://github.com/elwichito/zylogen-protocol/pull/15) → **ready for review**, 7 commits, +1900/−400 LOC aprox
- Branch: `fase-nova-2-subscription-pivot`
- Spawned task lateral: migración `next/font` (mergeada al PR 6 commit)

### Decisiones

- **Wallet = identidad real**, email como label. La wallet ya estaba en `client_reference_id` de Stripe y firma `lock()` on-chain; reusarla evita duplicar identidad.
- **Founding rate locked while active**, no "forever". Si cancelan, re-subscribe paga $29.99. Defensible legal + reputacionalmente.
- **Sin grace period en fallos de pago**: corte inmediato. Stripe dunning emails siguen corriendo gratis para reactivación.
- **Crypto recurring = manual mensual** (descartado allowance-pull por complejidad). El landing button doubles as renew vía idempotencia.
- **Stripe Customer Portal hosteado** en lugar de UI propia de billing. Cero código mantenido.
- **PR único de 7 commits** (no 7 PRs separados). Cada commit es mergeable solo y el orden está documentado en el PR body.

---

<!--
Plantilla para nuevas entradas:

## YYYY-MM-DD — Título corto

**Operator:** ... · **Asistente:** ...

### Qué se hizo
- bullet 1
- bullet 2

### Pendientes al cierre
- ...

### Blockers
- ... (o "ninguno")

### Commits / PRs
- ...

### Decisiones (solo si las hubo)
- ...
-->
