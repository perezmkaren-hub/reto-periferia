# SOLUCIÓN — Reto 02 · Agente de Registro de Contratos Vigentes

> Candidata: Karen Lorena Pérez · Rol: Project / Portfolio Manager
> Enfoque: gestioné este reto como un proyecto. Tomé el PRD como línea base del alcance, usé los 6 correos del buzón como criterios de aceptación y dirigí la construcción con un asistente de IA (ver §10).

---

## 1. Problema en una frase

Desde el 30 de mayo de 2026 Periferia no sabe con certeza qué contratos tiene vigentes, cuándo vencen ni qué pólizas debe: el maestro dejó de alimentarse cuando se fue la persona que lo llevaba, y a administración solo llegan los contratos que piden póliza.

| Actor | Dolor concreto |
|---|---|
| **Analista administrativa** (dueña del maestro) | Recibe contratos incompletos, por correos personales y sin orden. Tiene que perseguir comerciales para saber qué se firmó. |
| **Gerencia** | No puede responder "¿qué vence este trimestre?". En el maestro congelado ya hay contratos vencidos sin cierre (CT-2025-018, CT-2026-002) y uno que vence el 2026-09-30 (CT-2026-009). |
| **Comerciales** | No tienen a quién enviar ni cómo confirmar que lo enviado quedó registrado. |

---

## 2. Arquitectura

```
┌──────────────────┐  POST /api/chat   ┌────────────────────────────────────────────┐
│ Front (web/)     │ ────────────────▶ │ Backend (src/server.ts · Hono)             │
│ · historial      │ ◀──────────────── │  └─ Ciclo del agente (src/agente.ts)       │
│ · tool calls 🔧  │ reply, toolCalls, │      ├─ Adaptador LLM (src/llm/adapter.ts) │
│ · ⏸ confirmación │ needsConfirmation │      │    └─ Gemini (src/llm/gemini.ts)     │
└──────────────────┘                   │      └─ Herramientas zod (src/tools/)      │
                                       └───────────┬─────────────────┬──────────────┘
                                                   │                 │
                                       fixtures/ (solo lectura)   out/ (escritura)
                                       buzón, maestro, comerciales  sharepoint/maestro-contratos.csv
                                                                    sharepoint/Contratos/<año>/<cliente>/
                                                                    sharepoint/historial.jsonl
                                                                    procesados.json · log.jsonl · alertas.md
```

**Separación que pide el PRD (§6.5):**

| Capa | Dónde vive | Qué cambia si cambia el negocio |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Cómo conversa y en qué orden trabaja el agente |
| **Conocimiento** | `src/knowledge/registro-contratos.md` | Reglas del proceso, significado de campos, dueños |
| **Ejecución** | `src/tools/contratos.ts` | Extracción, validación, registro, alertas (código determinista) |

El servidor no contiene reglas de negocio: solo expone la API y ejecuta el ciclo. `demo.ts` importa las mismas herramientas sin el servidor.

---

## 3. Ciclo del agente

`src/agente.ts → ejecutarTurno()`:

1. Agrega el mensaje del usuario a la sesión (en memoria, por `sessionId`).
2. **Bucle** con tope de `MAX_ITERACIONES = 25` (CA1): envía prompt + historial + definiciones de herramientas al modelo.
3. Si el modelo pide herramientas (puede pedir **varias en paralelo**), el backend **valida los argumentos con zod** antes de ejecutar; si no cumplen, devuelve el error al modelo. Cada herramienta devuelve `{ ok, data }` o `{ ok: false, error }` y **nunca lanza**.
4. Cada llamada queda en el historial visible del chat y en `out/log.jsonl` (CA4, RN7).
5. Si el modelo responde texto sin pedir herramientas, termina el turno. Si llega al tope, responde con lo que hizo y lo que falta.

**Confirmación humana (CA3), en tres capas:**

| Capa | Mecanismo |
|---|---|
| Herramienta | `contratos_registrar` **re-valida** y rechaza con "requiere revisión: …" si hay campos < 0.8 y no viene `confirmado: true`. |
| Ciclo (código) | El backend **bloquea** `confirmado: true` para un mensaje que no quedó pendiente en un turno **anterior**. El modelo no puede auto-confirmarse en el mismo turno en que detecta la duda. |
| Interfaz | La respuesta trae `needsConfirmation: true` y el chat resalta la burbuja y la caja de texto en ámbar ("⏸ El agente necesita tu confirmación"). |

**Errores (CA5):** reintentos automáticos ante saturación del proveedor (429/503) con modelo de respaldo, timeout configurable, y si aun así falla, el agente responde en lenguaje claro qué alcanzó a hacer y la sesión sigue viva ("escríbeme *continúa*").

**Costo:** tope de iteraciones por turno y de tokens por sesión (`MAX_TOKENS_SESION`), ambos configurables.

---

## 4. Elección del modelo

| Decisión | Detalle |
|---|---|
| Proveedor / modelo | **Google Gemini · `gemini-3.8-flash`** (respaldo: `gemini-3-flash-preview`), vía API REST sin SDK. |
| Por qué | Buena capacidad de *function calling* en paralelo, latencia baja, costo bajo y **nivel gratuito** suficiente para una prueba de concepto. `thinkingLevel: low` y `temperature: 0` porque el modelo solo **orquesta**: no extrae ni calcula. |
| Independencia | El ciclo solo conoce la interfaz `ProveedorLLM.enviar(sistema, mensajes, herramientas)`. Cambiar a Claude u OpenAI es escribir otro archivo en `src/llm/` y cambiar una línea en `server.ts`. |

**Costo estimado por caso procesado** (medido con el contador de tokens de la sesión):

| Medición | Valor |
|---|---|
| Tokens de una corrida completa (6 correos + alertas, medido en la sesión de prueba) | **28.407** (≈ 4.700 por correo), en ~5 pasos del modelo gracias a las llamadas en paralelo |
| Supuesto de tarifa (verificar en la lista de precios vigente de Google) | ≈ US$0,50 por millón de tokens de entrada · ≈ US$3 por millón de salida (incluye razonamiento) |
| Costo estimado por correo procesado | **≈ US$0,003–0,014** (la cota alta asume todo a tarifa de salida) |
| Proyección 500 contratos/mes | **≈ US$2–7 al mes** |
| En esta prueba | **US$0**: nivel gratuito de Gemini |

La extracción no consume tokens (es código). El modelo solo orquesta, y por eso el costo es marginal frente a una persona dedicada. Controles: tope de 25 pasos por turno y de 400.000 tokens por sesión.

---

## 5. Estrategia de extracción

**Principio: el modelo no extrae valores; las herramientas sí.** La extracción es determinista (expresiones regulares y heurísticas sobre `contrato.txt`), y `contratos_validar` / `contratos_registrar` **vuelven a leer el documento** en vez de confiar en lo que les pase el modelo. Así se cumple CA2 por diseño: el modelo no tiene cómo "redondear" un valor.

| Campo | Cómo se encuentra | Confianza |
|---|---|---|
| `id_contrato` | `CONTRATO … No. XX-AAAA-NNN` (en un otrosí, el del contrato modificado) | 0.98 |
| `cliente` | Primera parte tras "Entre (los suscritos,)"; se toma la versión con mayúsculas/minúsculas del bloque de firmas | 0.95 (0.85 si no aparece en firmas) |
| `nit_cliente` | NIT/RUC/RTN tras el nombre; NIT colombiano sin dígito de verificación ni puntos | 0.95 |
| `pais` | Tipo y longitud del identificador (NIT→CO, RUC 13→EC, RUC 11→PE) cruzado con el domicilio | 0.95 si coinciden · 0.5 si se contradicen |
| `objeto` | Cláusula OBJETO sin la fórmula "EL CONTRATISTA se obliga a…", máx. 200 caracteres | 0.9 |
| `valor` / `moneda` | Cifra entre paréntesis `(COP $265.000.000)` / `(USD 120,000.00)`; detecta separador decimal | 0.95 · **0.5 si es "valor no determinado"** (→ 0 y `valor_indeterminado`) |
| `fecha_inicio` / `fecha_fin` | Fechas "(1) de agosto de 2026" en la cláusula PLAZO | 0.95 |
| … plazo en meses | Fecha de firma + N meses. Si solo se conoce el **mes** de firma: inicio = día 1, fin = **cierre del mes** (estimación más tardía) | 0.8 inicio · **0.5 fin** |
| `requiere_poliza` / `tipo_poliza` | Cláusula GARANTÍAS; tipos normalizados (cumplimiento, calidad, responsabilidad_civil, salarios_prestaciones). Póliza "para cada orden de servicio" → no aplica al marco | 0.9 |

Campos ausentes → `null` con confianza 0, nunca inventados. Todo campo < **0.8** entra a `requiere_revision`. En un otrosí solo se evalúan los campos que el documento trae; el resto se conserva del maestro.

**Clasificación (RN1–RN4):** búsqueda por `id_contrato`; si no, por `nit_cliente` + similitud de objeto ≥ 0.9 (coeficiente de Dice sobre bigramas). Mismo id y mismos valor/fechas → **duplicado**; otrosí o campos distintos → **actualización** (con `diferencias` antes/después); sin coincidencia → **nuevo**; sin adjunto de contrato o sin partes/objeto → **rechazado**.

**Resultado sobre los 6 casos (`npm run demo`):**

| Mensaje | Esperado (PRD §7.4) | Obtenido |
|---|---|---|
| msg-001 | nuevo, registrado, póliza pendiente | ✅ CT-2026-015 insertado · cumplimiento · pendiente |
| msg-002 | nuevo, registrado, no_aplica | ✅ CT-2026-016 insertado · no_aplica |
| msg-003 | actualización, fila modificada, historial | ✅ CT-2026-011: valor 350.000→520.000 PEN, fin 2027-05-01→2027-11-01, historial; póliza → pendiente (debe ampliarse) |
| msg-004 | duplicado, sin escritura | ✅ duplicado de CT-2026-012, sin escritura |
| msg-005 | rechazado | ✅ rechazado: adjunto es una cotización |
| msg-006 | nuevo con revisión (valor, fecha_fin) | ✅ nuevo · revisión: valor, fecha_fin · remitente no registrado (advertencia, no bloquea) · se registra solo tras confirmar valor 0 y fin 2027-08-31 |

---

## 6. Regla de gobierno

**Principio:** un contrato que no está en el maestro no existe para Periferia. El agente es la herramienta; la regla es lo que garantiza que el proceso sobreviva a la rotación de personas.

**Dueño del maestro** (respuesta a la pregunta abierta del PRD §10): como no hay área legal, el dueño es la **analista administrativa**, bajo la **dirección administrativa**, que responde ante gerencia. La analista no revisa cláusulas: responde por la **completitud y la exactitud** del registro. El contenido jurídico sigue siendo responsabilidad de quien firma.

**1. Canal único.** Todo documento contractual se envía a **contratos@periferia-ficticia.com** y a ningún otro lado. Lo administra la analista administrativa. Tiene un **respaldo nombrado** en la dirección administrativa (una persona concreta, no un cargo genérico), que tiene acceso al buzón y al maestro y lo cubre en vacancias o ausencias de más de 2 días hábiles. Si llega un contrato a un correo personal, quien lo recibe lo reenvía al buzón y no lo gestiona.

**2. Obligación del comercial.**
- **Qué envía:** el PDF firmado por ambas partes, cada otrosí, las actas de terminación o liquidación, y la póliza expedida (o su renovación) cuando el contrato la exige. **Todo contrato, requiera póliza o no.**
- **Plazo:** **3 días hábiles** desde la firma de la última parte.
- **Asunto:** `[CONTRATO] <Cliente> - <No. contrato> - <tipo: nuevo|otrosí|terminación|póliza>`. Ejemplo: `[CONTRATO] Minera Los Andes - CT-2026-011 - otrosí`.
- Un correo por contrato. Si hay anexos de tarifas, van en el mismo correo.

**3. Acuse automático.** En **menos de 15 minutos** el agente responde al remitente con: la clasificación (nuevo, actualización, duplicado o rechazado), el número de contrato registrado y la ruta de archivo, o bien **los campos que quedaron en revisión** y lo que falta. El registro definitivo de lo que queda en revisión lo confirma la analista en **2 días hábiles**. Si el comercial no recibe acuse, el contrato no se considera entregado.

**4. Excepciones y escalamiento.**

| Caso | Qué hace el agente | Escala a | SLA |
|---|---|---|---|
| Contrato sin firmar o firmado por una sola parte | Lo marca como rechazado ("sin firma") y pide la versión firmada. | Comercial; si no la envía en 3 días hábiles, al **gerente comercial**. | 3 días hábiles |
| Sin valor determinado (contrato marco o por demanda) | Registra con valor 0 y `valor_indeterminado`, previa confirmación de la analista. | Analista (confirma) | 2 días hábiles |
| Remitente desconocido (p. ej. msg-006: un practicante que no está en `comerciales.json`) | Procesa el contrato sin bloquearlo y avisa. | **Gerente comercial**, que asigna el comercial responsable. | 2 días hábiles |
| Póliza exigida y no recibida | La marca como "pendiente" en las alertas. | Comercial; a los 15 días, a la **dirección administrativa**. | 15 días |
| Incumplimiento repetido (más de 2 en un trimestre) | Lo reporta en el indicador mensual. | Gerente comercial, en su comité | Mensual |

**5. Cierre del gap junio–agosto 2026.** Se hace en una sola campaña de **2 semanas**:
- **Semana 1:** la analista cruza la **facturación de jun–ago contra el maestro** y saca, por comercial, la lista de clientes facturados sin contrato registrado. La envía a cada comercial con fecha límite.
- **Semana 2:** cada comercial envía los contratos faltantes **por el mismo buzón**. Las filas quedan con `fuente = migracion`. La analista resuelve lo que quede en revisión y cierra con el indicador del punto 6.
- Lo que no aparezca al final de la campaña se escala a la dirección administrativa, con lista nominal.

**6. Indicador mensual.** El indicador principal es **el % de contratos facturados en el mes que existen en el maestro**, con **meta ≥ 95 %**. Como indicador secundario, **el % de pólizas "pendientes" con más de 15 días**, con meta de 0 %. Los calcula la analista con el reporte de alertas y la facturación del mes, y los presenta a gerencia el primer día hábil del mes.

**RACI**

| Actividad | Comercial | Analista adm. | Respaldo | Gerente comercial | Dirección adm. |
|---|---|---|---|---|---|
| Enviar contrato y novedades al buzón | **R/A** | I | | C | |
| Confirmar campos en revisión y registrar | I | **R/A** | R (en ausencia) | | |
| Seguimiento de pólizas | R | **A** | | I | I |
| Escalar incumplimientos | I | R | | **A** | C |
| Campaña de cierre del gap | R | **R** | C | C | **A** |
| Indicador mensual | | **R** | | I | **A** |

---

## 7. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Extracción 100 % determinista** en código | Que el modelo lea el contrato y devuelva el JSON | Reproducible, auditable, gratis y sin alucinaciones. El PRD exige que `demo.ts` corra sin modelo. Costo: menos flexible ante formatos nuevos → en producción el modelo podría **proponer** valores para campos de baja confianza, siempre vía confirmación humana. |
| 2 | Las herramientas **re-leen el documento**; el modelo solo pasa `mensaje_id` | Que el modelo reenvíe el contrato completo entre herramientas | Primera versión lo hacía: era lento (~25 s por paso por tokens de salida) y abría la puerta a que el modelo alterara un valor. Ahora el modelo solo puede aportar `correcciones` explícitas con `confirmado: true`. |
| 3 | **Guardia de confirmación en código**, no solo en el prompt | Confiar en que el prompt diga "pregunta antes" | Un prompt se puede ignorar; el backend no. El modelo no puede confirmar en el mismo turno en que surgió la duda. |
| 4 | **Gemini Flash vía REST** con adaptador propio | SDK oficial / framework de agentes (LangChain, etc.) | Menos dependencias, el ciclo se entiende línea por línea y el proveedor es intercambiable. |
| 5 | HTML plano para el front | React / Next.js | Cero build, se despliega junto al backend, suficiente para el alcance. |
| 6 | Fecha fin estimada al **cierre del mes** cuando no se conoce el día de firma | Día 1 del mes + 12 meses − 1 día | Para alertas de vencimiento es más prudente no dar por vencido algo que puede seguir vigente; de todas formas va a revisión humana. |

---

## 8. Supuestos

- **Contrato marco sin valor** (msg-006): se registra con `valor = 0` y `valor_indeterminado = true`, siempre con confirmación humana. El valor real vive en cada orden de servicio, y esas órdenes se envían al buzón como documentos contractuales.
- **Plazo en meses sin día de firma** (msg-006 dice "doce meses contados a partir de la firma", firmado "en el mes de agosto de 2026"): la fecha fin se estima de forma conservadora al cierre del mes, **2027-08-31**, y se envía a revisión. No se registra sin confirmación.
- **Póliza condicionada** (msg-006: solo para órdenes de más de COP 100 M): no se exige al contrato marco. Se evalúa orden por orden.
- **Remitente desconocido:** se reporta al gerente comercial, pero no bloquea el registro. El contrato vale por sí mismo, no por quién lo envía.
- **Otrosí que exige ampliar garantías** (msg-003): la fila se actualiza (fecha fin y valor) y `estado_poliza` pasa a **"pendiente"** hasta que llegue la póliza ampliada, aunque antes figurara como vigente.
- **Reenvío de un contrato ya registrado** (msg-004): es un duplicado y no se escribe nada. Se informa al remitente en el acuse.
- **Una cotización no es un contrato** (msg-005): se rechaza con motivo y no se registra como oportunidad.
- **Mismo cliente con distinto objeto** (msg-006 vs. CT-2026-002, ambos de Distribuidora Caribe): se trata como un contrato nuevo, no como una actualización. El duplicado se detecta por NIT más objeto, no solo por nombre del cliente.
- **Fixtures de solo lectura:** el maestro original nunca se modifica; se trabaja sobre una copia en `out/`.
- **La fecha "hoy" se recibe como argumento:** las alertas (vencimientos a 60 días, pólizas pendientes) son reproducibles y no dependen del reloj del servidor.
- **No hay revisión jurídica:** el agente registra lo que dice el documento; no evalúa si las cláusulas son convenientes.

---

## 9. Cobertura

| Historia | Estado | Evidencia / qué falta para producción |
|---|---|---|
| HU-1 Leer el buzón | ✅ Hecho | `contratos_leer_buzon` excluye `out/procesados.json` |
| HU-2 Extraer | ✅ Hecho | Confianza por campo; nulos con 0. Falta: OCR y PDF nativo (P1) |
| HU-3 Validar y clasificar | ✅ Hecho | RN1–RN5, `diferencias`, remitente desconocido no bloquea |
| HU-4 Registrar y archivar | ✅ Hecho | Maestro en `out/sharepoint`, archivo por año/cliente, `historial.jsonl`, `procesados.json`. Falta: Microsoft Graph real |
| HU-5 Alertas | ✅ Hecho | `out/alertas.md` con las 3 secciones (+ vencidos sin acta) y fecha `hoy` como argumento |
| HU-6 Errores | ✅ Hecho | `{ ok:false, error }`; demo prueba mensaje inexistente y fecha inválida; el lote no se aborta |
| Front con tool calls y confirmación | ✅ Hecho | `web/index.html` |
| Link público | ✅ Render | Ver README |
| Bonus módulo reutilizable | ⏳ No hecho | Priorizado el núcleo evaluado dentro del tiempo |
| `contratos_leer_pdf` (P1) | ⏳ No hecho | Opcional |

---

## 10. Uso de IA

| Asistente | Para qué lo usé |
|---|---|
| **Claude (Claude Code, modelo Opus)** | Como equipo de desarrollo dirigido por mí: descomposición del PRD en entregables, escritura del código TypeScript, pruebas contra los 6 casos, borrador de la documentación. |
| **Google Gemini** | Es el modelo que ejecuta el agente en producción (no se usó para construir). |

**Mi rol:** definí el orden de trabajo (núcleo evaluable primero: herramientas + `demo.ts`), fijé los criterios de aceptación con los 6 correos, tomé las decisiones de la §7 y verifiqué cada entrega.

**Qué descarté de lo que propuso la IA y por qué:**
- La primera versión del ciclo hacía que el modelo reenviara el contrato completo entre herramientas: la descarté al medir ~25 s por paso y por el riesgo de que el modelo alterara valores (decisión 2).
- Se propuso exigir la póliza al contrato marco de msg-006; lo descarté porque la cláusula la exige **por orden de servicio**, no al marco.
- Se propuso usar el SDK oficial de Google; lo reemplacé por llamadas REST directas para reducir dependencias y hacer el adaptador más legible.

---

## 11. Riesgos de llevar a producción y mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Contratos escaneados (imagen, sin texto) | La extracción falla o sale con baja confianza. | OCR como paso previo. Todo campo que venga de OCR entra con confianza reducida y pasa a revisión humana. |
| Falsos duplicados o duplicados no detectados por variaciones del nombre del cliente | Filas repetidas o actualizaciones que caen en el contrato equivocado. | Dedupe primero por `nit_cliente` y número de contrato, y después por similitud de objeto. El nombre nunca es la llave. |
| El modelo inventa o redondea valores y fechas | Datos incorrectos en el maestro, que se usan para decidir. | Los valores solo salen de las herramientas deterministas. El modelo propone y no escribe. Todo lo que tenga confianza < 0.8 requiere confirmación humana, y el historial deja trazabilidad. |
| Rotación de personal (se repite el origen del problema) | El proceso muere otra vez. | El proceso depende de un buzón y un rol, no de una persona. El respaldo está nombrado, el conocimiento está documentado en el agente y el indicador mensual es visible para gerencia. |
| Los comerciales no cumplen la regla | El agente solo registra lo que le llega, igual que hoy. | Indicador de % de facturados en el maestro, escalamiento al gerente comercial y acuse que hace visible el cumplimiento. Opcional: condicionar la primera factura a que el contrato esté registrado. |
| Fuga de la clave del modelo | Costo no autorizado y exposición de datos. | La clave va solo en una variable de entorno del backend, con un gestor de secretos y rotación periódica. Nunca va en el front, los logs ni las respuestas de la API. |
| Costos del modelo sin control | Gasto impredecible. | Tope de iteraciones por turno y de tokens por sesión. La extracción es determinista, así que el modelo solo orquesta. Se monitorea el costo por contrato procesado. |
| Conexión real a Exchange y SharePoint | Permisos, disponibilidad y concurrencia que no existen en la simulación local. | Integración por **Microsoft Graph** con una aplicación registrada y permisos mínimos (solo el buzón de contratos y la biblioteca de SharePoint). Piloto en paralelo al proceso manual durante un mes antes del corte. |
| Datos sensibles de clientes en el proveedor de IA | Riesgo contractual de confidencialidad. | Enviar al modelo solo los fragmentos necesarios, elegir un proveedor sin retención de datos y validarlo con la dirección administrativa. |
