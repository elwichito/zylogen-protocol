---
name: ZYL Score Chart + Telemetry Modal
description: Chart y modal de telemetría añadidos a la landing pública en frontend/public/index.html
type: project
---

La landing pública (`zylogen.xyz`) es un archivo HTML estático en `frontend/public/index.html`, NO una página Next.js. El app router de Next.js solo cubre `/nova` y `/nova/dashboard`.

Se añadió en **PASO 5 (completo)**:

**Archivos creados:**
- `frontend/public/zyl-scores.json` — 30 puntos diarios 2026-03-29 → 2026-04-27, score 300→610
- `frontend/public/zyl-telemetry.json` — score breakdown, telemetría real, milestones confirmados, next targets

**Cambios en index.html:**
- Chart.js CDN en `<head>` (cdn.jsdelivr.net)
- Sección `#zyl-score` entre el hero y `#how` con Chart.js line chart (neon green, glow plugin, no puntos, tension 0.4)
- Botón `ACCESS FULL TELEMETRY →` debajo del chart
- Modal `.telem-modal` con: scanline sweep, entrada scale+blur, glitch en título, borde HUD animado, CRT scanlines en fondo
- 4 secciones: Score Breakdown (barras animadas), On-Chain Telemetry (count-up), Milestones (timeline), Next Targets
- Cierre con `[ DISCONNECT ]`, click fuera, o Escape

**Telemetría real (2026-04-28):**
- TVL: 0 USDC, Escrows: 4, Workers: 1 (Nova), Fees: 0.18 USDC

**Why:** Wichi quiso mantener la landing como HTML estático (cambio mínimo), Chart.js via CDN, todo vanilla JS.
