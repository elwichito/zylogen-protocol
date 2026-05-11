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
