# Marco de gobierno de datos e IA para el ciclo de vida contractual

> Documento estratégico complementario a la regla de gobierno operativa (SOLUCION.md §6).
> Audiencia: Vicepresidencia / comité de transformación digital.
> Autora: Karen Lorena Pérez

---

## 1. La tesis

El maestro de contratos no se congeló por un problema de tecnología: se congeló porque **el dato no tenía dueño, ni reglas, ni un mecanismo que lo mantuviera vivo**. El proceso dependía de una persona, y cuando esa persona se fue, el dato murió con ella.

La automatización resuelve el *cómo*. El gobierno resuelve el *quién, con qué reglas y cómo sabemos que funciona*. Sin gobierno, el agente solo automatiza lo que le llega, y hoy le llega la mitad.

**Principio rector:** *un contrato que no está en el maestro no existe para Periferia.*

---

## 2. Modelo de roles (quién responde por el dato)

| Rol | Quién | Responde por | En este caso |
|---|---|---|---|
| **Dueño del dato** (*Data Owner*) | Dirección administrativa | Que el maestro exista, sea confiable y se use para decidir. Aprueba reglas y excepciones. | Firma la regla de gobierno y preside el seguimiento mensual. |
| **Administrador del dato** (*Data Steward*) | Analista administrativa | Calidad diaria: confirma campos dudosos, resuelve excepciones, cuida el catálogo. | Confirma en el chat lo que el agente marca 🟡. |
| **Productor del dato** | Comerciales | Enviar el documento completo, a tiempo y por el canal único. | Cumplen el SLA de 3 días hábiles. |
| **Custodio técnico** (*Data Custodian*) | TI | Disponibilidad, accesos, respaldos y seguridad del buzón, SharePoint y el agente. | Opera la plataforma y la clave del modelo. |
| **Consumidores** | Gerencia, finanzas, operaciones | Usar el dato para decidir (vencimientos, pólizas, facturación). | Reciben el resumen diario y el tablero. |
| **Agente de IA** | Sistema | Ejecutar las reglas de forma consistente y dejar trazabilidad. **No decide sobre lo dudoso.** | Clasifica, registra lo limpio y escala lo dudoso. |

Resuelve la pregunta abierta del PRD: **el dueño del maestro es la dirección administrativa. La analista es la administradora, no la dueña.** Así la responsabilidad sobrevive a la rotación de personas.

---

## 3. Calidad de datos: dimensiones, reglas y control automático

Cada dimensión de calidad tiene una regla concreta y **un control que el sistema ya ejecuta**:

| Dimensión | Regla | Control implementado |
|---|---|---|
| **Completitud** | Todo contrato firmado está en el maestro, con o sin póliza | Canal único + indicador "% facturados en el maestro" + campaña de cierre del gap |
| **Exactitud** | Los valores registrados son los del documento | Extracción determinista (sin IA) + confianza por campo + revisión humana si < 0.8 |
| **Unicidad** | Un contrato = una fila | Detección de duplicados por número de contrato y por NIT + similitud del objeto (RN1, RN2) |
| **Validez** | Formatos y catálogos correctos (fechas, moneda, país) | Esquemas `zod`, catálogo de monedas y países, rechazo con motivo |
| **Consistencia** | El cambio de un contrato no crea otro | Los otrosíes actualizan la fila existente con antes/después (RN2) |
| **Oportunidad** | El dato llega a tiempo para actuar | SLA de 3 días, acuse automático y alertas a 60 y 30 días |
| **Trazabilidad** | Se sabe quién cambió qué, cuándo y por qué | `historial.jsonl` (linaje del dato), `log.jsonl` (auditoría de cada acción del agente) |

---

## 4. Gobierno de la IA (uso responsable)

La IA en este proceso **orquesta, no decide**. Reglas de gobierno de IA:

| Principio | Cómo se cumple |
|---|---|
| **Supervisión humana** | Nada dudoso se registra sin confirmación. La guardia está **en el código**, no solo en las instrucciones del modelo. |
| **No invención** | El modelo no puede afirmar valores que no salieron de una herramienta. Las herramientas leen el documento original. |
| **Explicabilidad** | Cada campo trae su nivel de confianza y cada clasificación su motivo. |
| **Auditoría** | Toda acción del agente queda registrada con fecha, herramienta, mensaje y resultado. |
| **Independencia del proveedor** | El proveedor de IA se puede cambiar sin rehacer el proceso (adaptador propio). |
| **Control de costos** | Topes de pasos y de consumo por sesión. La extracción no gasta IA. |
| **Confidencialidad** | Minimizar lo que se envía al modelo y elegir un proveedor sin retención de datos, validado por la dirección. |

---

## 5. Seguridad, privacidad y cumplimiento

- **Datos personales:** los contratos contienen nombres de representantes legales. El tratamiento debe alinearse con la **Ley 1581 de 2012** de protección de datos personales en Colombia y con las normas equivalentes en EC, PE, PA y HN.
- **Acceso mínimo:** solo la analista y su respaldo escriben en el maestro. Gerencia consulta. El agente opera con permisos restringidos: en el módulo reutilizable está configurado para **no poder editar archivos ni ejecutar comandos**.
- **Secretos:** la clave del modelo vive solo en el servidor, nunca en el código ni en el navegador.
- **Retención:** el contrato firmado se conserva en SharePoint con estructura estándar `Contratos/<año>/<cliente>/<número>`.

---

## 6. Ciclo de vida del contrato como dato

```
Firma → Envío al buzón (≤ 3 días) → Registro (agente + confirmación humana) → Vigencia (alertas 60/30 días, pólizas)
      → Novedades (otrosíes: actualización con historial) → Terminación (acta) → Archivo
```

Cada etapa tiene un responsable (§2), un control (§3) y un indicador (§7).

---

## 7. Indicadores del proceso (cómo sabemos que vive)

| Indicador | Meta | Frecuencia | Responsable |
|---|---|---|---|
| % de contratos facturados que existen en el maestro | ≥ 95 % | Mensual | Dirección administrativa |
| % de pólizas exigidas pendientes por más de 15 días | 0 % | Semanal | Analista |
| Días promedio entre firma y registro | ≤ 3 días hábiles | Mensual | Gerencia comercial |
| % de registros que requirieron corrección humana | Tendencia a la baja | Mensual | Analista (mide la calidad de la extracción) |
| Contratos vencidos sin acta de terminación | 0 | Semanal | Comercial responsable |

---

## 8. Hoja de ruta de madurez

| Fase | Horizonte | Alcance | Resultado |
|---|---|---|---|
| **1. Estabilizar** | Mes 1 | Regla de gobierno firmada, canal único, agente en piloto paralelo al proceso manual, campaña de cierre del gap jun–ago | Maestro completo y al día |
| **2. Integrar** | Meses 2–3 | Conexión real con Exchange y SharePoint (Microsoft Graph), envío real de avisos por correo/Teams, OCR para escaneados | El proceso corre solo; la analista solo gestiona excepciones |
| **3. Explotar el dato** | Meses 4–6 | Cruce con facturación y cartera, tablero ejecutivo para la vicepresidencia, alertas de renovación comercial | El maestro pasa de registro a **herramienta de decisión** |
| **4. Escalar el modelo** | Mes 6+ | Replicar el patrón (canal único + agente + gobierno) en otros documentos: órdenes de compra, pólizas, actas, proveedores | Un **modelo de gobierno reutilizable** para la organización |

La fase 4 es el verdadero retorno: **el patrón es reutilizable**. Este caso es la prueba de concepto de cómo Periferia puede gobernar cualquier flujo documental con IA.

---

## 9. Qué pediría a la vicepresidencia

1. **Patrocinio** de la regla: que la obligación del comercial sea una política, no una sugerencia.
2. **Designar formalmente** al dueño del dato (dirección administrativa) y al respaldo de la analista.
3. **Aprobar la campaña** de cierre del gap junio–agosto (2 semanas).
4. **Adoptar el indicador** "% facturados en el maestro" en el comité mensual.
