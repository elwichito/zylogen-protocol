# ERC-8183 Requirements vs `contracts/contracts/zyl/TaskEscrowV2.sol`

**Spec:** https://eips.ethereum.org/EIPS/eip-8183 — "Agentic Commerce Protocol"
**Contract audited:** `contracts/contracts/zyl/TaskEscrowV2.sol` (488 líneas, "ZYL Genesis"), deployado en Base Sepolia `0x9b1516C7…4254`.
**Auditoría:** 2026-05-11.

ERC-8183 define un protocolo mínimo para escrow de trabajo agéntico con cuatro fases lógicas (`Open → Funded → Submitted → Terminal`), un evaluator por job, y hooks opcionales. Lo que tenemos hoy en Zylogen es un escrow más opinado (con fees por tier de reputación, burn de ZYL, Spark rewards, oracle global) que **no implementa el state machine ni la división de roles del spec**.

## 1. Requisitos MUST / SHALL (normativos absolutos)

Estado: ✅ cumple · ⚠️ parcial · ❌ falta

| # | Requisito ERC-8183 | Estado | Notas |
|---|---|---|---|
| M1 | Job states: `Open, Funded, Submitted, Completed, Rejected, Expired` (6) | ❌ | El contrato tiene 5 estados (`None, Pending, Settled, Refunded, TimedOut`) — no hay `Open` ni `Submitted` |
| M2 | Evaluator MUST be set at creation | ❌ | No hay `evaluator` per-job; existe un único `oracle` global controlado por el owner |
| M3 | Provider MAY be `address(0)` at creation, MUST be set before funding | ❌ | `lock()` exige `worker != address(0)`; sin `setProvider` |
| M4 | `createJob()` separado de `fund()` | ❌ | `lock()` es atómico create+fund; no se puede crear un job sin financiar |
| M5 | `setProvider(jobId, provider)` — client only, mientras Open | ❌ | No existe |
| M6 | `setBudget(jobId, amount)` — client or provider, mientras Open | ❌ | No existe |
| M7 | `fund(jobId, expectedBudget)` SHALL revert si `budget != expectedBudget` (anti-frontrun) | ❌ | No aplica (no hay fase de setBudget separada) |
| M8 | `submit(jobId, deliverable)` — provider only, Funded → Submitted | ❌ | No existe; no hay evento on-chain de entrega de trabajo |
| M9 | `complete(jobId, reason)` — evaluator only, Submitted → Completed, transfiere a provider | ⚠️ | `settle()` cumple el pago al worker pero (a) la llama el oracle global, no un evaluator per-job; (b) no acepta `reason`; (c) no requiere haber pasado por `submit()` |
| M10 | `reject(jobId, reason)` — client si Open, evaluator si Funded/Submitted | ⚠️ | `refund()` cumple parcialmente — solo oracle puede llamarla; cliente no puede rechazar |
| M11 | Terminal Completed → escrow al provider | ⚠️ | `settle()` paga al worker pero descuenta fees crystallized (burn + treasury + spark) — neto al worker es ≤ 100% del lock; ERC-8183 permite "minus optional platform fee" así que esto es OK conceptualmente |
| M12 | Terminal Rejected → escrow al client (refund completo) | ✅ | `refund()` devuelve `e.amountToken` íntegro al `client` |
| M13 | Terminal Expired → refund al client | ❌ | **VIOLACIÓN CRÍTICA**: `timeout()` paga al **worker** (`e.amountToken - floorBurn` → worker, resto → treasury). ERC-8183 dice expired SHALL refund client |
| M14 | `claimRefund(jobId)` callable cuando expired y status era Funded/Submitted | ❌ | No existe con esa semántica; `timeout()` existe pero paga al worker, no al client |
| M15 | `claimRefund` SHALL NOT be hookable | N/A | No hay hooks en el contrato |
| M16 | SafeERC-20 para todas las transferencias ERC-20 | ✅ | `using SafeERC20 for IERC20` + uso correcto |
| M17 | ReentrancyGuard en funciones que transfieren tokens | ✅ | `lock/settle/refund/timeout` todas tienen `nonReentrant` |
| M18 | Job struct debe tener al menos: client, provider, evaluator, description, budget, expiredAt, status, hook (opt) | ⚠️ | Tiene client, worker (=provider), tokenAddr, amountToken, expiresAt, status. **Falta:** evaluator, description, hook. **Tiene además:** agent, fee tiers, ZYL/spark fields |
| M19 | `createJob` SHALL revert si `evaluator == 0` o `expiredAt` no es futuro | ❌ | No hay `createJob`; en `lock()` no se valida nada de evaluator/expiredAt explícitamente — el `expiresAt` se calcula como `now + 30 days` (no es parámetro) |
| M20 | Un solo token de pago por contrato (per-job es OPTIONAL extension) | ❌ | El contrato soporta per-token. No es violación porque la spec explicita que per-job token es MAY, pero el contrato no tiene un "token canonical" por defecto |
| M21 | MUST NOT allow hooks to modify core escrow state directly | N/A | No hay hooks |

**Total MUST/SHALL evaluados:** 21 (excluyendo N/A: 19)
**Cumplidos:** 3 (M12, M16, M17) — ✅
**Parciales:** 4 (M9, M10, M11, M18) — ⚠️
**Faltantes:** 12 (M1, M2, M3, M4, M5, M6, M7, M8, M13, M14, M19, M20) — ❌

## 2. Requisitos SHOULD

| # | Requisito | Estado | Notas |
|---|---|---|---|
| S1 | Emit events: `JobCreated, ProviderSet, BudgetSet, JobFunded, JobSubmitted, JobCompleted, JobRejected, JobExpired, PaymentReleased, Refunded` | ❌ | Emite `Locked, Settled, Refunded, TimedOut` — nombres y firmas diferentes |
| S2 | Events SHOULD include `reason` para indexación / reputación composable | ❌ | Ninguna función acepta `reason`; eventos no lo incluyen |
| S3 | Implementations SHOULD imponer gas limit en hook calls | N/A | No hay hooks |
| S4 | SHOULD support ERC-2771 (meta-transactions) | ❌ | No usa `ERC2771Context` ni `_msgSender()` |
| S5 | Hooks SHOULD NOT ser upgradeable después de creado el job | N/A | No hay hooks |
| S6 | RECOMMENDED permitir que cualquiera trigger refund tras expiry | ✅ | `timeout()` es permissionless — pero paga al worker (ver M13), no al client |
| S7 | Hook behavior SHOULD ser auditado (guidance) | N/A | No hay hooks |

**Total SHOULD evaluados:** 7 (excluyendo N/A: 4)
**Cumplidos:** 1 (S6 — permissionless, pero con semántica wrong) — ✅
**Faltantes:** 3 (S1, S2, S4) — ❌

## 3. Opciones MAY

| # | Opción | Estado | Notas |
|---|---|---|---|
| O1 | MAY charge platform fee on Completed | ✅ | Fee dinámico por reputación 50–200 bp (Burn + Treasury + Spark) |
| O2 | MAY support hooks (IACPHook beforeAction/afterAction) | ❌ | No implementado |
| O3 | MAY support per-job payment token | ✅ | `tokenAddr` per-escrow |
| O4 | MAY use `bytes32` reason hashed off-chain | ❌ | No hay campo reason |
| O5 | MAY maintain allowlist de hooks auditados | N/A | No hay hooks |
| O6 | MAY integrate ERC-8004 (reputation) | ⚠️ | Tiene reputation propia (`agentReputationOverride`) pero NO usa ERC-8004; las semánticas son distintas |
| O7 | MAY integrate ERC-2612 (permit) | ❌ | No implementado |
| O8 | MAY restrict caller of `claimRefund` (RECOMMENDED open) | N/A | `timeout()` es permissionless |

**Total MAY evaluados:** 8 (excluyendo N/A: 6)
**Implementados con espíritu compatible:** 2 (O1, O3) — ✅
**Implementados con desviación:** 1 (O6 — reputation custom no-8004) — ⚠️
**No implementados:** 3 (O2, O4, O7) — ❌

## 4. Interface mismatch — funciones esperadas vs lo que existe

| ERC-8183 | TaskEscrowV2 (zyl) | Equivalencia |
|---|---|---|
| `createJob(provider, evaluator, expiredAt, description, hook)` | (no existe) | `lock()` cubre createJob+fund atómico |
| `setProvider(jobId, provider)` | (no existe) | — |
| `setBudget(jobId, amount, optParams)` | (no existe) | `amount` se pasa en `lock()` |
| `fund(jobId, expectedBudget, optParams)` | `lock(taskId, client, worker, agent, token, amount, sponsorRoot)` | Atómico, no separa fund de createJob |
| `submit(jobId, deliverable, optParams)` | (no existe) | — |
| `complete(jobId, reason, optParams)` | `settle(taskId)` (oracle only) | Sin `reason`, sin separación submit → complete |
| `reject(jobId, reason, optParams)` | `refund(taskId)` (oracle only) | Sin `reason`, no callable por client en Open |
| `claimRefund(jobId)` | `timeout(taskId)` | Permissionless ✓ pero paga al **worker** no al client |
| `getJob(jobId)` | `escrows(taskId)` mapping público | Equivalencia funcional |

## 5. Gaps vs current contract

Los gaps se agrupan por severidad: bloquean compliance ERC-8183 (BLOCKER), implican rewrite parcial (MAJOR), o se pueden adoptar como extensión opcional (MINOR).

### 🔴 BLOCKERS — sin esto no es ERC-8183 compliant

1. **State machine incompleto.** Faltan `Open` y `Submitted`. El contrato actual va directo de "no existe" → `Pending` (post-`lock()`). Sin `Open` no hay forma de crear un job y luego renegociar provider/budget. Sin `Submitted` no hay marcador on-chain de que el trabajo fue entregado, lo cual es central en ERC-8183 para que el evaluator decida.

2. **Sin separación `createJob` / `setBudget` / `fund`.** Hoy `lock()` hace todo en una transacción. ERC-8183 requiere tres pasos: crear → acordar precio → fondear. Esto permite que provider y client negocien on-chain antes del lock.

3. **Sin `submit()`.** El provider nunca declara on-chain que terminó el trabajo. ERC-8183 hace de esto un MUST porque el evaluator necesita la señal para evaluar.

4. **Evaluator vs Oracle: modelo wrong.** ERC-8183 dice "single evaluator per job, set at creation, MAY be the client". Hoy hay UN oracle global controlado por el owner del contrato. **No se puede usar el contrato para flujos donde el client es su propio evaluator** (caso de uso central del SDK para founders solos).

5. **`timeout()` paga al worker — VIOLACIÓN CRÍTICA.** ERC-8183 dice "Expired SHALL refund to client". Hoy si pasan 30 días + 7 días de oracle inactivo, el worker se queda con el dinero menos un 0.5% burn. Esto es el opuesto exacto del semantic de Expired en ERC-8183 (en 8183, expiry es la garantía del client de recuperar fondos).

6. **Sin `reason` attestation.** ERC-8183 ata cada terminal action a un `bytes32 reason` que puede commitearse on-chain como evidencia (hash de proof off-chain). Hoy no existe.

7. **Sin `description` en el job.** ERC-8183 requiere descripción al crear; sin esto, indexers y UIs no tienen contexto on-chain de qué trata el job.

### 🟡 MAJOR — implica reescribir, pero no bloquea conceptualmente

8. **Eventos no-estándar.** Renombrar y reestructurar `Locked/Settled/Refunded/TimedOut` para que matcheen `JobCreated/JobFunded/JobSubmitted/JobCompleted/JobRejected/JobExpired/PaymentReleased/Refunded`. Indexers ERC-8183-compliant no van a poder leer eventos legacy.

9. **Reputation system custom vs ERC-8004.** ERC-8183 recomienda integrar ERC-8004 para reputation/trust. Hoy tenemos `agentReputationOverride` propio con cap de ±200 cada 24h. Hay que decidir si migrar a ERC-8004 o mantenerse intencionalmente fuera del estándar.

10. **`expiredAt` no-parametrizable.** Hoy es `now + 30 days` hardcoded en `ESCROW_DURATION`. ERC-8183 hace `expiredAt` un parámetro del `createJob`. Cambio chico pero requiere validar bordes (ej: máximo razonable).

11. **Token canonical implícito.** ERC-8183 dice "single payment token per contract (per-job es MAY)". Si queremos compliance estricta, declarar un `paymentToken` constructor-set y exponer la elección per-job como extensión documentada. Hoy es todo opcional sin canonical.

### 🟢 MINOR — opcionales pero valiosos para el norte (founder usa el SDK)

12. **Hooks IACPHook.** Para que un founder pueda enchufar lógica custom (ej: validar deliverable contra un schema, exigir staking adicional) sin tocar el core. Es MAY pero alinea con la value prop "componible".

13. **ERC-2771 (meta-tx).** Permite que el founder pague gas del client cuando recién arranca. SHOULD según spec.

14. **ERC-2612 (permit).** Permite fund() sin approve previo. UX win para usuarios nuevos a Web3.

## 6. Recomendación de path

Dado:
- 12 BLOCKERS sobre 19 MUST evaluados (63% no-compliance).
- El contrato actual fue diseñado para Nova específicamente (Stripe → lock con fee tiers + ZYL burn), no para ser un primitivo genérico de agentic commerce.
- El norte de Fase 1 es "SDK para founder solo deploya su protocolo en una semana" — esto requiere un contrato que sea **simple, ERC-8183 compliant, y opinable solo donde agrega valor obvio**.

**Mi recomendación:** Diseñar `ZylogenJob.sol` desde cero alineado a ERC-8183 (no patchear el actual). Las features Zylogen-específicas (fee tiers por reputación, ZYL burn, Spark rewards) se mueven a un **hook contract** `ZylogenFeeHook.sol` que un founder enchufa opcionalmente al crear su job. Eso da:

- Compliance ERC-8183 puro en el core
- Founder solo deploya el job + opcionalmente el hook
- Composabilidad con el ecosystem ERC-8183 que pueda emerger (indexers, evaluators terceros)
- ZYL Genesis features siguen vivas pero como capa opt-in

Esto es coherente con Sub-fase 1.C del ROADMAP.

## 7. Checklist para Fase 1.C (diseño `ZylogenJob.sol`)

- [ ] Implementar 6 estados ERC-8183
- [ ] Funciones: `createJob, setProvider, setBudget, fund, submit, complete, reject, claimRefund`
- [ ] Per-job `evaluator` (MAY be client)
- [ ] Per-job `description` string
- [ ] Per-job `hook` (opcional, address(0))
- [ ] `expiredAt` como parámetro de creación
- [ ] `claimRefund` paga al **client** (corregir el bug de timeout)
- [ ] `bytes32 reason` en complete/reject
- [ ] Eventos con nombres ERC-8183
- [ ] Front-run protection en `fund(expectedBudget)`
- [ ] SafeERC20 + ReentrancyGuard + Pausable + Ownable
- [ ] `IACPHook` interface + invocación condicional (skip si hook==address(0))
- [ ] `claimRefund` NOT hookable (hardcoded skip)
- [ ] Test e2e completo en Hardhat ≥ 90% cobertura

Las features Zylogen (fees por tier, ZYL burn, Spark, agent registry) se diseñan en `ZylogenFeeHook.sol` separadamente — fuera del scope de este audit.
