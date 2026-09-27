// Ciclo del agente: prompt → modelo → herramientas → modelo … → respuesta.
// Independiente del proveedor (usa ProveedorLLM) y del servidor HTTP.
import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { DefinicionHerramienta, Mensaje, ProveedorLLM } from "./llm/adapter.ts"
import { herramientas, type NombreHerramienta } from "./tools/contratos.ts"

export type LlamadaVisible = { nombre: string; argumentos: Record<string, unknown>; ok: boolean; resumen: string; resultado: unknown }

export type Evento =
  | { tipo: "usuario"; texto: string; ts: string }
  | { tipo: "asistente"; texto: string; ts: string; necesitaConfirmacion: boolean }
  | { tipo: "herramienta"; ts: string; llamada: LlamadaVisible }
  | { tipo: "error"; texto: string; ts: string }

export type Sesion = {
  id: string
  mensajes: Mensaje[]
  eventos: Evento[]
  tokensUsados: number
  // Mensajes del buzón que quedaron esperando confirmación humana en un turno anterior.
  pendientesConfirmacion: Set<string>
}

export type Config = { directorio: string; maxIteraciones: number; maxTokensSesion: number }
export type RespuestaTurno = { reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean; pendientes: string[] }

const ahora = () => new Date().toISOString()

// El prompt (comportamiento) y el conocimiento del proceso viven en Markdown, no en el código.
export async function cargarSistema(directorio: string): Promise<string> {
  const prompt = await fs.readFile(path.join(directorio, "agent/prompt.md"), "utf8")
  const conocimiento = await fs.readFile(path.join(directorio, "src/knowledge/registro-contratos.md"), "utf8")
  return `${prompt}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento}`
}

export function definiciones(): DefinicionHerramienta[] {
  return Object.entries(herramientas).map(([nombre, h]) => {
    const { $schema: _omitido, ...parametros } = z.toJSONSchema(z.object(h.args)) as Record<string, unknown>
    return { nombre, descripcion: h.description, parametros }
  })
}

function resumir(resultado: string): { ok: boolean; resumen: string; datos: unknown } {
  const r = JSON.parse(resultado) as { ok: boolean; data?: unknown; error?: string }
  if (!r.ok) return { ok: false, resumen: r.error ?? "error", datos: r }
  const d = r.data as Record<string, unknown>
  const resumen =
    typeof d?.clasificacion === "string" ? `${d.clasificacion}${Array.isArray(d.requiere_revision) && d.requiere_revision.length ? ` · revisar: ${d.requiere_revision.join(", ")}` : ""}` :
    typeof d?.accion === "string" ? `${d.accion}${d.id_contrato ? ` · ${String(d.id_contrato)}` : ""}` :
    Array.isArray(d?.mensajes) ? `${d.mensajes.length} mensajes pendientes` :
    typeof d?.ruta === "string" ? `reporte en ${d.ruta}` : "ok"
  return { ok: true, resumen, datos: r }
}

export async function ejecutarTurno(
  sesion: Sesion,
  textoUsuario: string,
  llm: ProveedorLLM,
  sistema: string,
  config: Config,
): Promise<RespuestaTurno> {
  const ctx = { directory: config.directorio, sessionId: sesion.id }
  const llamadasTurno: LlamadaVisible[] = []
  // Solo se aceptan confirmaciones de lo que quedó pendiente ANTES de este mensaje del usuario (CA3).
  const confirmables = new Set(sesion.pendientesConfirmacion)
  const nuevosPendientes = new Set<string>()
  const registradosTurno = new Set<string>()

  sesion.mensajes.push({ rol: "usuario", texto: textoUsuario })
  sesion.eventos.push({ tipo: "usuario", texto: textoUsuario, ts: ahora() })

  if (sesion.tokensUsados >= config.maxTokensSesion) {
    const reply = `Esta sesión alcanzó el tope de ${config.maxTokensSesion.toLocaleString("es-CO")} tokens. Abre una sesión nueva para continuar.`
    sesion.eventos.push({ tipo: "error", texto: reply, ts: ahora() })
    return { reply, toolCalls: [], needsConfirmation: false, pendientes: [...sesion.pendientesConfirmacion] }
  }

  const defs = definiciones()
  let reply = ""

  for (let i = 0; i < config.maxIteraciones; i++) {
    let r
    try {
      r = await llm.enviar(sistema, sesion.mensajes, defs)
    } catch (e) {
      // CA5: un error del proveedor no mata la sesión ni pierde lo ya hecho.
      const motivo = e instanceof Error ? e.message : String(e)
      reply = `⚠️ Me interrumpí por un problema con el proveedor del modelo (${motivo}).` +
        (llamadasTurno.length ? ` Alcancé a hacer: ${llamadasTurno.map((l) => `${l.nombre}${typeof l.argumentos.mensaje_id === "string" ? ` ${l.argumentos.mensaje_id}` : ""} (${l.resumen})`).join("; ")}.` : "") +
        " Escríbeme \"continúa\" para retomar donde quedé."
      sesion.mensajes.push({ rol: "asistente", texto: reply, llamadas: [] })
      sesion.eventos.push({ tipo: "error", texto: motivo, ts: ahora() })
      break
    }
    sesion.tokensUsados += r.tokens.entrada + r.tokens.salida
    sesion.mensajes.push({ rol: "asistente", texto: r.texto, llamadas: r.llamadas, crudo: r.crudo })

    if (r.llamadas.length === 0) { reply = r.texto; break }

    const resultados: { id: string; nombre: string; resultado: string }[] = []
    for (const llamada of r.llamadas) {
      const h = herramientas[llamada.nombre as NombreHerramienta]
      const mensajeId = typeof llamada.argumentos.mensaje_id === "string" ? llamada.argumentos.mensaje_id : ""
      let resultado: string

      if (!h) {
        resultado = JSON.stringify({ ok: false, error: `La herramienta ${llamada.nombre} no existe` })
      } else if (llamada.nombre === "contratos_registrar" && llamada.argumentos.confirmado === true && !confirmables.has(mensajeId)) {
        // Guardia en código: el modelo no puede auto-confirmarse en el mismo turno en que detecta la duda.
        resultado = JSON.stringify({ ok: false, error: `confirmado=true no es válido para ${mensajeId}: primero debes preguntarle al usuario y esperar su respuesta en el siguiente mensaje` })
      } else {
        resultado = await h.execute(llamada.argumentos as never, ctx)
      }

      const { ok, resumen, datos } = resumir(resultado)
      const visible: LlamadaVisible = { nombre: llamada.nombre, argumentos: llamada.argumentos, ok, resumen, resultado: datos }
      llamadasTurno.push(visible)
      sesion.eventos.push({ tipo: "herramienta", ts: ahora(), llamada: visible })
      resultados.push({ id: llamada.id, nombre: llamada.nombre, resultado })

      // Seguimiento de confirmaciones pendientes.
      const parsed = JSON.parse(resultado) as { ok: boolean; data?: { requiere_revision?: string[]; clasificacion?: string }; error?: string }
      if (llamada.nombre === "contratos_validar" && parsed.ok && (parsed.data?.requiere_revision?.length ?? 0) > 0 &&
          parsed.data?.clasificacion !== "duplicado" && parsed.data?.clasificacion !== "rechazado") nuevosPendientes.add(mensajeId)
      if (llamada.nombre === "contratos_registrar" && !parsed.ok && parsed.error?.startsWith("requiere revisión")) nuevosPendientes.add(mensajeId)
      if (llamada.nombre === "contratos_registrar" && parsed.ok) registradosTurno.add(mensajeId)
    }
    sesion.mensajes.push({ rol: "herramienta", resultados })

    if (i === config.maxIteraciones - 1) {
      reply = `Llegué al tope de ${config.maxIteraciones} pasos en este turno. Esto es lo que alcancé a hacer: ${llamadasTurno.map((l) => `${l.nombre} (${l.resumen})`).join("; ")}. Pídeme que continúe para terminar lo que falta.`
    }
  }

  for (const id of registradosTurno) { sesion.pendientesConfirmacion.delete(id); nuevosPendientes.delete(id) }
  for (const id of nuevosPendientes) sesion.pendientesConfirmacion.add(id)
  const needsConfirmation = sesion.pendientesConfirmacion.size > 0

  if (!reply) reply = "No obtuve una respuesta de texto del modelo. Intenta reformular la solicitud."
  sesion.eventos.push({ tipo: "asistente", texto: reply, ts: ahora(), necesitaConfirmacion: needsConfirmation })
  return { reply, toolCalls: llamadasTurno, needsConfirmation, pendientes: [...sesion.pendientesConfirmacion] }
}
