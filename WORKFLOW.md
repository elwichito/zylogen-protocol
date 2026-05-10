# WORKFLOW — Reglas operativas Zylogen Protocol

> **Norte:** Zylogen es el toolkit que permite a un founder solo desplegar
> un protocolo agentic completo (identidad, escrow, pagos) en Base en una
> semana, sin equipo. Toda decisión técnica se evalúa contra esta frase.
> Decidido el 2026-05-09. No se vuelve a debatir hasta cambio fundamental.

## Roles

- **Wichi** — Operator. Da directivas, tiene las keys, hace el call final.
- **Logen** — Web3 Architect. Diseña sistemas, aprueba arquitectura.
- **Zyl** (Claude Code) — Engine. Construye, arregla, reporta. Nunca asume aprobación.

Cualquier sesión con un asistente IA usa estos roles.

## Reglas de oro

### 1. Una acción a la vez
Un PR = una intención. Un commit = un cambio coherente. Si una "acción" requiere tocar 5 archivos no relacionados, son 5 acciones, no una.

### 2. Verificar antes de borrar
Antes de `rm` / `git rm` / `delete`, demostrar que nada importa el archivo:
```bash
grep -rn "<filename>" --include="*.js" --include="*.json" .
```
Si hay matches, primero arreglarlos. Si son solo strings en comentarios, registrar el hecho en el commit message.

### 3. No tocar core sin warning explícito
"Core" = contratos en `contracts/`, `paymentRelay.js`, `webhook.js`, schema de DB. Si una sesión va a tocar core, lo anuncia en `SESSIONS.md` antes y reporta el diff.

### 4. Commit con prefijo de fase
Formato: `[fase-N] <tipo>: <qué cambió>` o `<tipo>(scope): <qué cambió>`. Ejemplos:
- `[fase-0] add operational system: workflow, roadmap, sessions log`
- `fix(backend): load backend/.env before falling back to repo root`
- `[fase-1] sdk: scaffold ZylogenAgent.deploy() interface`

### 5. Verification gate antes de mainnet
Si un cambio afecta el flujo on-chain en mainnet, pasar primero por Sepolia con tx hash documentado en el commit/PR. Sin tx Sepolia verificable, no hay merge a `main` para cambios de relayer/escrow.

### 6. Memoria persistida en tres niveles
- **Estratégica** (`~/.claude/projects/.../memory/`): norte, decisiones grandes, hallazgos sorprendentes. Cambia raras veces.
- **Operativa** (`SESSIONS.md`): qué pasó hoy. Se actualiza al cierre de cada sesión.
- **Roadmap** (`ROADMAP.md`): qué sigue. Checklists tachables. Nunca se borra una entrada — se marca como `[done] / [skipped] / [pending]`.

### 7. No introducir lo que no se necesita
- No abstracciones especulativas para futuros usuarios imaginarios
- No fallback para escenarios que no pueden pasar (trust internal code, validar solo en bordes del sistema)
- No comentarios que solo repitan lo que el código ya dice

### 8. Cierre de sesión obligatorio
Toda sesión termina con:
1. Una entrada nueva en `SESSIONS.md` (o ampliada si la sesión continuó la del día)
2. Roadmap actualizado (qué se completó, qué quedó pendiente)
3. Commit final con mensaje claro

Sin esto, la sesión "no existió" desde el punto de vista del proyecto.

### 9. Permission scope: sensible vs reversible
- **Reversible local** (editar archivos, levantar dev server): proceder.
- **Visible a otros / cuesta plata / mueve mainnet** (push, deploy, mergear PR, fondear wallet, set live Stripe): pedir confirmación explícita aunque haya un `allow todo` general previo.

### 10. Si algo no encaja con el norte, decirlo
Si alguien (humano o IA) propone una feature que no le ahorra tiempo a un founder solo deployando en Base, marcarlo. Ej: "esta feature es para post-tracción, queda fuera de Phase 2 MVP".

## Cómo abrir y cerrar una sesión

**Apertura (1 min):**
1. Leer la última entrada de `SESSIONS.md`
2. Releer el norte (arriba en este archivo)
3. Identificar en `ROADMAP.md` la próxima acción pendiente
4. Confirmar con el operator antes de empezar si la acción toca core

**Cierre (3 min):**
1. Resumir en `SESSIONS.md` qué se hizo, qué quedó pendiente, blockers
2. Marcar checklist en `ROADMAP.md`
3. Commit + push
4. Si hubo decisión grande o hallazgo sorprendente, persistir en memoria estratégica

## Anti-patrones detectados (no repetir)

- ❌ Deployar contrato a mainnet "porque ya tiene tests" sin verification gate Sepolia
- ❌ Editar `.env` de Railway sin verificar que el container reinició y cargó la nueva var
- ❌ Crear documentación de arquitectura que describe BD inexistente (Postgres cuando hay SQLite)
- ❌ Ramas con duplicación de código (`/src` y `/backend/src` divergiendo)
- ❌ Tres archivos `.sol` con mismo nombre en distintos paths sin documentar cuál es canonical
- ❌ Promesas de features que requieren comunidad/staking antes de tener tracción

Cuando aparezca uno nuevo, agregarlo acá.
