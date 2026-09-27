# Proceso de registro de contratos vigentes

## Contexto
- El maestro de contratos (SharePoint) estaba congelado desde el **2026-05-30**. Todo lo registrado después de esa fecha cubre el gap.
- Antes solo llegaban contratos con póliza. Ahora **todo** contrato firmado debe registrarse, con o sin póliza.
- No hay área legal: el agente no opina sobre cláusulas, solo registra datos.

## Clasificación (reglas de negocio)
| Regla | Clasificación | Qué pasa |
|---|---|---|
| RN1 | **duplicado** | Mismo número de contrato y mismos valor, fecha inicio y fecha fin. No se escribe nada. |
| RN2 | **actualizacion** | Mismo número de contrato (o mismo NIT y objeto con similitud ≥ 0.9) con algún campo distinto, o el documento es un **otrosí**. Se modifica la fila y queda historial. |
| RN3 | **nuevo** | Sin coincidencia en el maestro. Se inserta. |
| RN4 | **rechazado** | Sin adjunto de contrato (cotizaciones, preguntas) o sin partes/objeto identificables. |
| RN5 | revisión | Campos con confianza **< 0.8** detienen el registro hasta que el usuario confirme. |

## Significado de los campos
- `valor = 0` con `valor_indeterminado = true`: contrato marco o por demanda; el valor real está en cada orden de servicio.
- `fecha_fin` derivada de un plazo en meses cuando el día de firma no se conoce: se estima al cierre del mes y siempre va a revisión.
- `estado_poliza`: un contrato nuevo que exige póliza queda `pendiente` hasta que se reciba la póliza expedida. Un otrosí que amplía plazo deja la póliza en `pendiente` porque debe ampliarse.
- `comercial`: se resuelve con el correo del remitente en `comerciales.json`. Un remitente desconocido se reporta pero no bloquea.

## Alertas
- **Vencen en ≤ 60 días**: el comercial debe gestionar prórroga o acta de terminación.
- **Pólizas pendientes**: contratos que exigen póliza y no la tienen vigente. Riesgo de incumplimiento contractual.
- **Registrados desde el corte**: evidencia de que el gap se está cerrando.

## Dueños
- Maestro: analista administrativa.
- Pólizas: analista administrativa con el corredor de seguros.
- Envío del contrato al buzón `contratos@periferia-ficticia.com`: el comercial que lo firmó.

## Convenciones de color
- **Clasificación:** 🟢 nuevo · 🔵 actualización · ⚪ duplicado · 🔴 rechazado · 🟡 requiere confirmación.
- **Semáforo de riesgo:** 🔴 crítico (vencido, vence en ≤ 30 días o póliza exigida sin constituir) · 🟡 atención (vence en 31–60 días o comercial no registrado) · 🟢 al día.

## Avisos proactivos
Las alertas no dependen de que alguien pregunte: el sistema genera cada día el reporte y un correo para gerencia y uno por comercial con sus pendientes, y el chat muestra el aviso al abrirse.

## Documentos en PDF
Se procesan PDF nativos (con texto). El texto se reconstruye por párrafos y cláusulas, y se aplican las mismas reglas que a un `.txt`. Un PDF escaneado (imagen) no trae texto: se reporta como "requiere OCR" y no se inventa nada.
