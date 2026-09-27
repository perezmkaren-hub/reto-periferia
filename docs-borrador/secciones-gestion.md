<!-- Borrador de secciones de gestión para SOLUCION.md (PRD §9.1: secciones 1, 6, 8 y 11). -->

## 1. Problema en una frase

Desde el 30 de mayo de 2026 Periferia no sabe con certeza qué contratos tiene vigentes, cuándo vencen ni qué pólizas debe: el maestro dejó de alimentarse cuando se fue la persona que lo llevaba, y a administración solo llegan los contratos que piden póliza.

**A quién le duele:**

| Actor | Dolor concreto |
|---|---|
| **Analista administrativa** (dueña del maestro) | Recibe contratos incompletos, por correos personales y sin orden. Tiene que perseguir comerciales para saber qué se firmó y no puede cumplir el seguimiento de pólizas que se le exige. |
| **Gerencia / dirección** | No puede responder "¿qué vence este trimestre?". En el maestro congelado ya hay contratos vencidos sin cierre registrado (CT-2025-018, CT-2026-002) y uno que vence el 2026-09-30 (CT-2026-009). Una póliza exigida y no constituida es un incumplimiento contractual. |
| **Comerciales** | No tienen a quién enviar ni cómo confirmar que lo enviado quedó registrado. Cuando falla una póliza o una renovación, la pregunta les llega a ellos. |

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
