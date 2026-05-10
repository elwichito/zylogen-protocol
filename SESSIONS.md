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
