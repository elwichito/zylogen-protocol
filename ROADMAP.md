# ROADMAP — Zylogen Protocol

> **Norte:** Toolkit para que un founder solo deploye un protocolo agentic
> completo (identidad + escrow + pagos) en Base en una semana, sin equipo.

Las fases no se borran cuando se completan — se marcan. Una entrada vive
en este archivo desde que se anota hasta que el proyecto muere.

Estados: `[ ]` pending · `[~]` in progress · `[x]` done · `[s]` skipped (con razón)

---

## Fase 0 — Limpieza y régimen operativo

**Objetivo:** El repo refleja la realidad. Las reglas operativas están escritas. Cualquier sesión futura puede arrancar desde acá sin arqueología.

- [x] PR #2 abierto: dotenv fix + cleanup estructural (Phases A/B/C, +156/−3586) — 2026-05-09
- [x] Mergear PR #2 — 2026-05-10 (squash, branch eliminado en remoto)
- [x] Empujar Phase D del PR #2 (`.github/workflows/test.yml`) — 2026-05-10, vía PR aparte
- [x] Memoria estratégica creada: norte, Railway projects, prod env, verification gate, structural cleanup
- [x] Documentos operativos creados: `WORKFLOW.md`, `ROADMAP.md`, `SESSIONS.md` — PR #3 mergeado 2026-05-10
- [ ] Decidir destino de Railway `strong-enthusiasm` (staging oficial o eliminar)

---

## Fase 1 — TaskEscrowV3 = ZylogenJob (ERC-8183 compliant)

**Objetivo:** Un founder solo, con `npm-i @zylogen/sdk` más una clave de Base, puede `ZylogenAgent.deploy()` y obtener: AgentID, escrow contract address, y endpoint de payments. Documentación que haga el flujo claro en 30 minutos.

**Decisión técnica (2026-05-11):** Opción C — deployar V3 limpio derivado de `contracts/contracts/zyl/TaskEscrowV2.sol`. Los 3 contratos legacy en Base mainnet (`0x55a8…`, `0xBE46…`, `0xC10D…`) no se tocan; se documentan en `DEPLOYMENTS.md`. La nueva SDK pública apunta SOLO al V3.

- [x] Auditar `sdk/index.js` actual y su API pública — 2026-05-11, hallazgo: SDK apunta a `0xC10D…` que es un tercer contrato no documentado
- [x] Auditoría completa documentada en `DEPLOYMENTS.md` con los 3 contratos legacy — 2026-05-11

### 1.A — Documentación de contratos legacy ✅ cerrada 2026-05-11
- [x] Crear `DEPLOYMENTS.md` con los 3 contratos en mainnet + sus interfaces + estado — PR #6
- [x] Actualizar `CLAUDE.md` para reflejar la realidad de 3 deployments (apunta al DEPLOYMENTS.md) — PR #7
- [x] Marcar SDK actual (`zylogen-sdk` v2.1.1 en npm) como "deprecated" en su `sdk/README.md` — PR #7

### 1.B — ERC-8183 spec audit ✅ cerrada 2026-05-11
- [x] Leer ERC-8183 spec completa (https://eips.ethereum.org/EIPS/eip-8183) — PR #8
- [x] Producir tabla de requisitos MUST/SHOULD/MAY — PR #8 (21 MUST + 7 SHOULD + 8 MAY catalogados)
- [x] Audit de `contracts/contracts/zyl/TaskEscrowV2.sol` vs requisitos → gaps documentados — PR #8 (7 BLOCKERS, 4 MAJOR, 3 MINOR)

### 1.C — Diseño y escritura doc `ZylogenJob.sol` ✅ cerrada 2026-05-11
- [x] Diseñar estados Open → Funded → Submitted → Terminal — PR #9
- [x] Implementar evaluator role separado del oracle wallet — PR #9 (decisión)
- [x] Agregar `attestationReason` hash on-chain (`bytes32 reason`) — PR #9 (decisión)
- [x] Hooks `afterAction` para composabilidad (IACPHook) — PR #9 (interfaz)
- [x] SafeERC20 + ReentrancyGuard + Pausable (sin Ownable per decisión 2026-05-11) — PR #9

### 1.D — Implementación + Testing ✅ cerrada 2026-05-11
- [x] Implementar `contracts/contracts/v3/ZylogenJob.sol` — PR #10 (438 LOC, compila clean)
- [x] Tests exhaustivos Hardhat (cobertura >90%) — PR #11 (56 tests, statements 98.92% / lines 99.07%)
- [ ] Deploy en Base Sepolia — pendiente Fase 1.E
- [ ] Tests e2e del SDK contra Sepolia — pendiente, requiere SDK V3 first
- [ ] Documentar deploy en `DEPLOYMENTS.md` — pendiente Fase 1.E

### 1.E — Audit interno + deploy Mainnet 🎯 **NEXT UP**
- [ ] Deploy en Base Sepolia
- [ ] Audit interno con checklist OpenZeppelin
- [ ] `slither` / `mythril` clean
- [ ] Deploy en Base Mainnet
- [ ] SDK V3 mínima apuntando al kernel mainnet
- [ ] Publicar como `@zylogen/sdk` en npm (verificar disponibilidad del scope)

---

## Fase 2 — Tres founders deployaron con Zylogen

**Objetivo:** No es marketing — es prueba. Tres usuarios distintos del operador deployean su propio protocolo usando el SDK. Sus protocolos están vivos en Base mainnet.

- [ ] Definir el "founder candidato" tipo — perfil, qué construye, dónde lo encuentro
- [ ] Reclutar 3 candidatos directos (LATAM/India/SEA, sin VC, sin equipo)
- [ ] Onboarding 1-a-1 con cada uno, registrando fricciones del SDK
- [ ] Cerrar gaps de SDK que aparezcan (vivir en `ROADMAP.md` cuando surjan)
- [ ] Los 3 protocolos viven en Base mainnet con uso medible

---

## Fase 3 — 100 founders + utility real para $ZYL

**Objetivo:** El SDK creció a 100 deploys orgánicos. $ZYL token tiene utility real: gas en operaciones, staking para acceso premium del SDK. NO antes, NO si la utility es vaporware.

- [ ] Métrica formal de "deploy con Zylogen" definida y medible
- [ ] Pipeline de tracking de deploys (probablemente on-chain via marker en AgentID)
- [ ] Dashboard público de N deploys / N founders activos
- [ ] Diseño de utility de $ZYL específico (qué se paga con ZYL, cuánto, cuándo)
- [ ] Audit del contrato $ZYL si se va a tokenizar

---

## Fase 4 — Token launch (cuando la tracción lo justifica)

**Objetivo:** Solo entra acá cuando Fase 3 está cerrada. Token launch sin tracción es exactamente el patrón Nova que generó los problemas anteriores.

- [ ] Pre-condición: ≥100 founders activos en Fase 3 demostrablemente
- [ ] Pre-condición: utility de $ZYL ya consumida en producción durante ≥30 días
- [ ] Token launch (TBD si LBP, fair launch, retroactive airdrop a usuarios Fase 1-3)

---

## Backlog general (sin fase asignada)

Cosas detectadas durante la sesión 2026-05-09 que no son de la fase actual:

- [ ] Fondear relayer mainnet con ≥9 USDC + 0.05 ETH antes de aceptar pagos reales
- [ ] Decidir si producción debería migrar a TaskEscrowV2 (hoy usa V1 en mainnet)
- [ ] Activar Stripe live mode (hoy `sk_test_...` en producción)
- [ ] CI para backend (no hay test suite JS hoy; agregar tests primero, después CI)
- [ ] `ignition/modules/` está vacío — definir si se usa o se borra
