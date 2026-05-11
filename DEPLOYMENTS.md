# DEPLOYMENTS — Zylogen Protocol on Base

Catálogo de **todos** los contratos relacionados con Zylogen que están
desplegados en Base, en cualquier red, vigentes o legacy. Si en el repo
existe un archivo `.sol` y no aparece acá, no está desplegado (o si
lo está, es accidental y hay que borrarlo del repo).

Última actualización: **2026-05-11** (Fase 1.A — auditoría SDK).

---

## Base Mainnet (chainId 8453)

### 🟥 Legacy 1 — TaskEscrow V1 (ETH-only)

| Campo | Valor |
|-------|-------|
| Dirección | `0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f` |
| Bytecode len | 5434 bytes |
| Source | `contracts/contracts/TaskEscrow.sol` |
| Interfaz | `lock(taskHash, provider) payable`, `release`, `refund`, `getEscrow` |
| Estado | **Deprecated.** No nuevos clientes. Tasks pendientes (si las hay) se settle con sus llamadas legacy. |
| Razón de deprecación | Solo soporta ETH como token de escrow; sin fee tiers; sin nada de USDC. |

### 🟥 Legacy 2 — TaskEscrow "SDK abril" (multi-token + 5% fee)

| Campo | Valor |
|-------|-------|
| Dirección | `0xC10D9b263612733C1752eFDe9CD617887216832c` |
| Bytecode len | 12690 bytes |
| Source | **No coincide exactamente con ningún `.sol` actual del repo.** Es la iteración que la `sdk/index.js` v2.1.1 hardcodea. |
| Interfaz | `createTaskETH`, `createTaskToken`, `release`, `reclaim`, `isActive`, `getEscrow`, `FEE_BPS=500` (5%) |
| Oracle | `0x24A400E17d2b9fd9C7eDd99f358A34Fe7751D849` (mismo relayer wallet que Nova) |
| Treasury | `0x8bcB4935FC0aEAf5733d96a8a72a2Ac79bD3693e` |
| Estado | **Deprecated.** Es el contrato al que apunta el paquete npm `zylogen-sdk` v2.1.1 publicado en abril. No tiene tracción medible. |
| Razón de deprecación | Fue una iteración intermedia entre V1 y la V2 actual del backend Nova; sus tasks no fluyen al pipeline de Nova; tiene 5% fee mientras V2 Nova tiene 1%. |

### 🟢 Activo — TaskEscrowV2 ("Nova V2")

| Campo | Valor |
|-------|-------|
| Dirección | `0xBE464859Fb6f09fa93b6212f616F3AD19ebe48B1` |
| Bytecode len | 9474 bytes |
| Source | `contracts/contracts/TaskEscrowV2.sol` |
| Interfaz | `lock(taskId, worker, amount, deadline)`, `release(taskId)`, `refund(taskId)` |
| Token | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) |
| Fee | 1% al release |
| Consumido por | `backend/src/services/paymentRelay.js` (Stripe → lock) |
| Estado | **Activo en producción.** Es el contrato detrás de Nova en `zylogen.xyz`. |

### 🟢 Activo — TaskEscrow.sol V1 verified (referencia)

Mismo contrato que "Legacy 1" arriba. Se mantiene verificado en Basescan para que la auditoría histórica siga siendo legible. No se consume.

---

## Base Sepolia (chainId 84532)

### 🟡 Beta — TaskEscrowV2 (ZYL Genesis)

| Campo | Valor |
|-------|-------|
| Dirección | `0x9b1516C79855F8E01A5Eb4B4E3A34430041Ae254` |
| Source | `contracts/contracts/zyl/TaskEscrowV2.sol` |
| Interfaz | `lock(taskId, client, worker, agent, token, amount, sponsorRoot)`, `settle`, `refund` (signature **diferente** a Nova V2) |
| Extras | ZYL burn + Spark rewards, agent reputation tiers, expiresAt 30 días |
| Estado | **Beta en Sepolia.** No deployado a mainnet todavía. Es el candidato base para V3 según la decisión del 2026-05-11. |

---

## SDK published packages

| Paquete | Versión | Apunta a | Estado |
|---------|---------|----------|--------|
| `zylogen-sdk` (npm) | 2.1.1 | `0xC10D9b...832c` (Base mainnet) | **Deprecated.** Ver `sdk/README.md` para warning. No instalar. |
| `@zylogen/sdk` (npm) | — | — | **Reservado para V3.** Se publica cuando Fase 1.E cierre. |

---

## Reglas operativas

1. **Antes de crear un nuevo contrato**, agregar fila a este archivo
   con `[ ]` en estado. Cuando se deploya, marcar dirección y bytecode len.
2. **Antes de deprecar** un contrato, agregar la fila `Razón de deprecación`
   y comunicar a los consumidores (backend, SDK, frontend).
3. **Si la dirección NO está acá pero existe en el repo**, es un olor:
   o no se deployó nunca (entonces ¿por qué está el `.sol`?) o se deployó
   sin documentar (entonces hay que agregarlo).
4. **CLAUDE.md** repite las direcciones canónicas activas como referencia
   rápida pero **este archivo es la fuente de verdad** para legacy + estado.

---

## Decisión técnica 2026-05-11 — Opción C

Frente al hallazgo de los tres contratos paralelos, se decidió no migrar
ningún consumer a otro contrato existente. En su lugar:

- Los tres legacy quedan documentados acá pero no se tocan.
- Se construye un **V3** (`ZylogenJob.sol`) limpio, derivado del trabajo en
  `contracts/contracts/zyl/TaskEscrowV2.sol`, alineado a ERC-8183.
- La SDK pública nueva (`@zylogen/sdk`) apunta exclusivamente al V3.
- El paquete npm legacy `zylogen-sdk` queda deprecado con warning en su
  README, pero no se despublica (rompería a quien tenga lockfile viejo).

El plan completo está en `ROADMAP.md` sub-fases 1.A → 1.E.
