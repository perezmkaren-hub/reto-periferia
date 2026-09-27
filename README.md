# Agente de Registro de Contratos Vigentes — Reto 02 · Periferia IT Group

Agente conversacional que actúa como **punto único de recepción de contratos**: lee el buzón, extrae los datos con nivel de confianza, detecta nuevos / actualizaciones / duplicados / rechazados, archiva en un SharePoint simulado, alimenta el maestro y genera alertas de vencimiento y pólizas. Nada dudoso se registra sin confirmación humana.

- **Link de prueba:** _(se completa al desplegar en Render)_
- **Documento de solución:** [SOLUCION.md](SOLUCION.md)

## Levantar en local (un comando)

Requisitos: Node 20 o superior.

```bash
cp .env.example .env      # y pega tu GEMINI_API_KEY
npm install && npm run dev
```

Abre http://localhost:3000 y usa el botón **"▶ Procesar buzón (demo)"**.

## Verificación sin modelo

```bash
npm install && npm run demo
```

Procesa los 6 mensajes llamando directamente a las herramientas (sin clave, sin modelo). Limpia `out/` al inicio, así que es determinista. Muestra la primera pasada (msg-006 queda sin registrar por revisión) y una segunda llamada con `confirmado: true`.

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `GEMINI_API_KEY` | Sí (solo el chat) | Clave de Google Gemini. Solo vive en el backend. |
| `GEMINI_MODEL` | No | Modelo principal. Por defecto `gemini-3.8-flash`. |
| `GEMINI_MODEL_RESPALDO` | No | Modelo si el principal está saturado. |
| `MAX_ITERACIONES` | No | Tope de pasos herramienta→modelo por turno (25). |
| `MAX_TOKENS_SESION` | No | Tope de tokens por sesión (400.000). |
| `LLM_TIMEOUT_MS` | No | Timeout por llamada al modelo (60.000 ms). |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, pendientes[], tokensUsados }` |
| `GET` | `/api/sessions/:id` | Historial completo (mensajes, llamadas a herramientas, errores) |
| `GET` | `/api/health` | `{ ok, provider, model, llave_configurada }` (nunca la clave) |
| `POST` | `/api/reset` | Borra `out/` para repetir la demo desde el maestro original |
| `GET` | `/api/out/<ruta>` | Lee un artefacto generado (`alertas.md`, `sharepoint/maestro-contratos.csv`) |

## Estructura

```
agent/prompt.md                   comportamiento (system prompt)
src/knowledge/registro-contratos.md  conocimiento del proceso
src/tools/contratos.ts            ejecución: herramientas tipadas con zod
src/agente.ts                     ciclo del agente (independiente del proveedor)
src/llm/adapter.ts, gemini.ts     adaptador del modelo
src/server.ts                     API HTTP
web/index.html                    chat
demo.ts                           verificación sin modelo
fixtures/                         insumos (solo lectura)
out/                              generado en ejecución (no se versiona)
```
