# Agente de Registro de Contratos Vigentes — Reto 02 · Periferia IT Group

![CI](https://github.com/perezmkaren-hub/reto-periferia/actions/workflows/ci.yml/badge.svg)

Agente conversacional que actúa como **punto único de recepción de contratos**: lee el buzón, extrae los datos con nivel de confianza, detecta nuevos / actualizaciones / duplicados / rechazados, archiva en un SharePoint simulado, alimenta el maestro y genera alertas de vencimiento y pólizas. Nada dudoso se registra sin confirmación humana.

- **Link de prueba:** https://reto-periferia-contratos.onrender.com (plan gratuito de Render: si estuvo inactivo, la primera carga tarda ~50 s en despertar)
- **Documento de solución:** [SOLUCION.md](SOLUCION.md)
- **Marco de gobierno de datos e IA:** [GOBIERNO.md](GOBIERNO.md)

## Levantar en local (un comando)

Requisitos: Node 20 o superior.

```bash
cp .env.example .env      # y pega tu GEMINI_API_KEY
npm install && npm run dev
```

Abre http://localhost:3000 y usa el botón **"▶ Procesar buzón (demo)"**.

**Qué probar en el link:**
1. **▶ Procesar buzón (demo)**: toma de 1 a 3 minutos. Se ven las llamadas a herramientas 🔧 y al final msg-006 queda resaltado en ámbar pidiendo confirmación.
2. **✔ Confirmar msg-006**: se registra CM-2026-03 y se actualizan las alertas.
3. **📊 Tablero**: pestañas **🏛️ Vista ejecutiva** (dinero en riesgo, pipeline de renovación, concentración, decisiones para la dirección) y **🛠️ Vista operativa** (conteos, pólizas, semáforo por contrato).
4. **📄 Leer PDF de ejemplo**: el agente lee `ejemplos/contrato-CT-2026-015.pdf` con `contratos_leer_pdf`.
5. **🔔 Banda de avisos**: arriba del chat, siempre visible. **Reiniciar demo** vuelve el maestro al 2026-05-30.

## Pruebas automáticas

```bash
npm test
```

9 pruebas con `node:test`, sin modelo ni clave, cada una sobre una copia aislada del proyecto: los 6 casos del buzón (§7.4), registro, actualización con historial y duplicados (RN1–RN3), confirmación humana (RN5/CA3), intento de colar valores inventados (CA2), alertas (HU-5), errores tipados (HU-6), fixture de solo lectura y log (RN6/RN7) y equivalencia PDF vs TXT (P1).

**Integración continua:** GitHub Actions (`.github/workflows/ci.yml`) corre en cada push los tipos, las pruebas, la demo y la verificación del módulo.

## Verificación sin modelo

```bash
npm install && npm run demo
```

Procesa los 6 mensajes llamando directamente a las herramientas (sin clave, sin modelo). Limpia `out/` al inicio, así que es determinista. Muestra la primera pasada (msg-006 queda sin registrar por revisión) y una segunda llamada con `confirmado: true`.

Incluye además: la prueba de que el modelo no puede colar valores inventados, los errores tipados (mensaje inexistente, fecha inválida, moneda desconocida) y la lectura del PDF de ejemplo (`ejemplos/contrato-CT-2026-015.pdf`), que debe dar los mismos 11 campos que el `.txt` de msg-001. El PDF se regenera con `npm run pdf:ejemplo`.

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `GEMINI_API_KEY` | Sí (solo el chat) | Clave de Google Gemini. Solo vive en el backend. |
| `GEMINI_MODEL` | No | Modelo principal. Por defecto `gemini-3.8-flash`. |
| `GEMINI_MODEL_RESPALDO` | No | Modelo si el principal está saturado. |
| `MAX_ITERACIONES` | No | Tope de pasos herramienta→modelo por turno (25). |
| `MAX_TOKENS_SESION` | No | Tope de tokens por sesión (400.000). |
| `LLM_TIMEOUT_MS` | No | Timeout por llamada al modelo (60.000 ms). |
| `MAX_TOKENS_DIA` | No | Tope global diario de tokens del link público (3.000.000). |
| `MAX_MENSAJES_IP_10MIN` | No | Mensajes permitidos por IP cada 10 minutos (30). |
| `ADMIN_KEY` | Recomendada | "Reiniciar demo" exige esta clave. Sin ella, el reinicio solo funciona en local (desactivado en el link público). |
| `FECHA_REFERENCIA` | No | Fecha simulada para avisos y tablero (`2026-09-03` en la demo). Vacía = fecha real. |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, pendientes[], tokensUsados }` |
| `GET` | `/api/sessions/:id` | Historial completo (mensajes, llamadas a herramientas, errores) |
| `GET` | `/api/health` | `{ ok, provider, model, llave_configurada }` (nunca la clave) |
| `GET` | `/api/avisos` | Resumen del semáforo de alertas (lo usa la banda 🔔 del chat) |
| `POST` | `/api/reset` | Borra `out/` para repetir la demo desde el maestro original |
| `GET` | `/api/out/<ruta>` | Lee un artefacto generado (`alertas.md`, `sharepoint/maestro-contratos.csv`) |

## Alcance y limitaciones conocidas

| Tema | Estado | Por qué / qué haría en producción |
|---|---|---|
| Autenticación de usuarios | Fuera de alcance por diseño (PRD §3.2: "autenticación de usuarios, roles o multiusuario" es no-objetivo; §6.1: "el link puede ser público") | SSO corporativo (Entra ID) delante de la API, con roles analista / gerencia |
| Reinicio de la demo | **Protegido por defecto** (`ADMIN_KEY` o solo local) | — |
| Persistencia en archivos y sesiones en memoria | Por diseño (PRD §3.2: "sin base de datos, el maestro es un CSV") | Maestro en una lista de SharePoint vía Microsoft Graph y sesiones en una base gestionada; en Render el disco es efímero |
| Costo del link público | Topes por sesión, diarios globales y por IP | Cuotas por usuario autenticado |

## Módulo reutilizable (bonus)

```bash
npm run modulo            # genera modulo/ desde las fuentes de la app
npm run modulo:verificar  # falla si modulo/ difiere de lo que usa la app
```

Ver [modulo/README.md](modulo/README.md).

## Estructura

```
agent/prompt.md                   comportamiento (system prompt)
src/knowledge/registro-contratos.md  conocimiento del proceso
src/tools/contratos.ts            ejecución: las 6 herramientas (cada export = una herramienta)
src/lib/contratos-nucleo.ts       núcleo: extracción, reglas RN1–RN5, SharePoint simulado
src/agente.ts                     ciclo del agente (independiente del proveedor)
src/llm/adapter.ts, gemini.ts     adaptador del modelo
src/avisos.ts                     avisos proactivos y resumen diario
src/server.ts                     API HTTP
web/index.html                    chat + banda de avisos 🔔 + tablero 📊 (pestañas: vista ejecutiva / vista operativa)
modulo/                           bonus: agente empaquetado (generado)
demo.ts                           verificación sin modelo
tests/                            pruebas automáticas (npm test)
.github/workflows/ci.yml          integración continua
ejemplos/                         PDF nativo de ejemplo para contratos_leer_pdf
fixtures/                         insumos (solo lectura)
out/                              generado en ejecución (no se versiona)
```
