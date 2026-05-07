---
name: Whitepaper deployment — estado y blocker
description: Whitepaper HTML creado y pusheado; Vercel no deployó los commits nuevos; pendiente redeploy manual
type: project
---

## Estado actual

El whitepaper está completo y en el repo. Hay DOS commits pusheados que Vercel no deployó todavía:

| Commit | Hash | Contenido |
|---|---|---|
| whitepaper HTML | `132526d` | `frontend/public/whitepaper/index.html` (702 líneas) |
| rewrite Next.js | `813fe2b` | `frontend/next.config.ts` — agrega `rewrites()` para `/whitepaper` → `/whitepaper/index.html` |

Rama: `main`. Remote: `github.com/elwichito/zylogen-protocol`.

## Blocker actual

Vercel NO triggereó un nuevo deploy productivo después del push. El último deploy productivo es de las 13:17 UTC del 30 de abril (build anterior). Los commits nuevos están en GitHub pero no en Vercel.

**Por qué:** el `experimentalServices` en el root `vercel.json` posiblemente interfiere con la integración automática git → Vercel.

## Lo que falta hacer

1. Verificar el Vercel dashboard del proyecto `zylogen-protocol` (project ID: `prj_9qChMw3hIfnJ7xOcH7YupkaC2djP`)
2. Ver si hay builds fallidos o pendientes
3. Hacer redeploy del commit `813fe2b` a producción

**Comando CLI si está disponible:**
```bash
cd frontend && vercel --prod
```

O desde el dashboard: Deployments → buscar commit `813fe2b` → Promote to Production.

## Verificación post-deploy

Una vez deployado, correr:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://zylogen-protocol.vercel.app/whitepaper
curl -s -o /dev/null -w "%{http_code}\n" https://zylogen.xyz/whitepaper
```

Ambas deben devolver 200.

## Estructura del whitepaper

- Path: `frontend/public/whitepaper/index.html`
- URL target: `zylogen.xyz/whitepaper`
- Design: hereda landing (Orbitron/Rajdhani/Share Tech Mono, --green #00ff88, --cyan #00e5ff)
- Nav: idéntico al landing, links con `/#anchor` para volver
- 10 secciones: thesis, protocol, flywheel, design principles, threat model, why Base, roadmap, what we are not, team, closing
- OG/Twitter cards completos para X y Farcaster

**Why:** El rewrite en next.config.ts es necesario porque Next.js App Router no sirve automáticamente `/whitepaper` como index de `public/whitepaper/`. El rewrite fuerza la resolución del archivo estático.
**How to apply:** Cuando vuelva Wichi, ir directo al deploy manual. El código está correcto; solo falta que Vercel lo levante.
