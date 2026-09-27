# Módulo reutilizable — Agente de Registro de Contratos

Paquete para integrar el agente en otra plataforma de agentes (formato tipo OpenCode) **sin depender del servidor web** de la aplicación.

| Pieza | Contenido | Fuente única en la aplicación |
|---|---|---|
| `agent.md` | Frontmatter (`description`, `mode: primary`, `permission: {edit: deny, bash: deny}`) + system prompt | `agent/prompt.md` |
| `tools/contratos.ts` | Las 5 herramientas tipadas con zod (`contratos_leer_buzon`, `_extraer`, `_validar`, `_registrar`, `_alertas`) | `src/tools/contratos.ts` |
| `skill/registro-contratos/SKILL.md` | Conocimiento del proceso | `src/knowledge/registro-contratos.md` |

Las tres piezas se **generan** desde la aplicación (`npm run modulo`) y `npm run modulo:verificar` falla si alguna diverge. Las herramientas resuelven rutas desde `ctx.directory` (raíz del proyecto donde estén `fixtures/` y `out/`) y solo dependen de `zod`.
