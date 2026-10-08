// API HTTP del chat. Solo orquesta: la lógica vive en src/agente.ts y src/tools/.
import "dotenv/config"
import { promises as fs } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { z } from "zod"
import { GeminiLLM } from "./llm/gemini.ts"
import { cargarSistema, ejecutarTurno, type Sesion } from "./agente.ts"
import { generarAvisos } from "./avisos.ts"

const directorio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const config = {
  directorio,
  maxIteraciones: Number(process.env.MAX_ITERACIONES ?? 25),
  maxTokensSesion: Number(process.env.MAX_TOKENS_SESION ?? 400_000),
}
const MAX_SESIONES = 100
// D4 · Costo del link público: tope global diario de tokens, límite de mensajes por IP y reset protegido.
const MAX_TOKENS_DIA = Number(process.env.MAX_TOKENS_DIA ?? 3_000_000)
const MAX_MENSAJES_IP_10MIN = Number(process.env.MAX_MENSAJES_IP_10MIN ?? 30)
const consumo = { dia: "", tokens: 0 }
const mensajesPorIp = new Map<string, number[]>()

function dentroDeLimites(ip: string): string | null {
  const hoy = new Date().toISOString().slice(0, 10)
  if (consumo.dia !== hoy) { consumo.dia = hoy; consumo.tokens = 0 }
  if (consumo.tokens >= MAX_TOKENS_DIA) return "Se alcanzó el tope diario de uso del modelo en este link. Intenta mañana o córrelo en local."
  const ahora = Date.now()
  const recientes = (mensajesPorIp.get(ip) ?? []).filter((t) => ahora - t < 10 * 60_000)
  if (recientes.length >= MAX_MENSAJES_IP_10MIN) return "Demasiados mensajes seguidos desde tu conexión. Espera unos minutos."
  mensajesPorIp.set(ip, [...recientes, ahora])
  return null
}

const apiKey = process.env.GEMINI_API_KEY ?? ""
const llm = new GeminiLLM(apiKey, process.env.GEMINI_MODEL ?? "gemini-3.8-flash", Number(process.env.LLM_TIMEOUT_MS ?? 60_000), process.env.GEMINI_MODEL_RESPALDO ?? "gemini-3.1-flash-lite")
const sesiones = new Map<string, Sesion>()

const app = new Hono()

app.get("/api/health", (c) => c.json({ ok: true, provider: llm.proveedor, model: llm.modelo, llave_configurada: apiKey.length > 0 }))

const CuerpoChat = z.object({ sessionId: z.string().max(100).optional(), message: z.string().min(1).max(4000) })

app.post("/api/chat", async (c) => {
  const parsed = CuerpoChat.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ ok: false, error: "Cuerpo inválido: se espera { sessionId, message }" }, 400)
  if (!apiKey) return c.json({ ok: false, error: "El servidor no tiene configurada la clave del modelo (GEMINI_API_KEY)" }, 500)

  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"
  const limite = dentroDeLimites(ip)
  if (limite) return c.json({ ok: false, error: limite }, 429)

  const id = parsed.data.sessionId ?? randomUUID()
  let sesion = sesiones.get(id)
  if (!sesion) {
    if (sesiones.size >= MAX_SESIONES) sesiones.delete(sesiones.keys().next().value as string)
    sesion = { id, mensajes: [], eventos: [], tokensUsados: 0, pendientesConfirmacion: new Set() }
    sesiones.set(id, sesion)
  }

  try {
    const sistema = await cargarSistema(directorio)
    const antes = sesion.tokensUsados
    const r = await ejecutarTurno(sesion, parsed.data.message, llm, sistema, config)
    consumo.tokens += sesion.tokensUsados - antes
    return c.json({ ok: true, sessionId: id, ...r, tokensUsados: sesion.tokensUsados })
  } catch (e) {
    // CA5: el error se muestra en lenguaje claro y la sesión sigue viva.
    const texto = e instanceof Error ? e.message : "Error desconocido"
    sesion.eventos.push({ tipo: "error", texto, ts: new Date().toISOString() })
    // Se descarta el último mensaje del usuario si el modelo no alcanzó a responder, para no dejar el historial a medias.
    const ultimo = sesion.mensajes.at(-1)
    if (ultimo?.rol === "usuario") sesion.mensajes.pop()
    return c.json({ ok: false, sessionId: id, error: `No pude completar el turno: ${texto}. Puedes intentarlo de nuevo.` }, 502)
  }
})

// Avisos proactivos: el front los consulta al abrir y después de cada turno.
app.get("/api/avisos", async (c) => c.json(await generarAvisos(directorio, fechaReferencia())))

app.get("/api/sessions/:id", (c) => {
  const s = sesiones.get(c.req.param("id"))
  if (!s) return c.json({ ok: false, error: "Sesión no encontrada" }, 404)
  return c.json({ ok: true, id: s.id, eventos: s.eventos, tokensUsados: s.tokensUsados, pendientes: [...s.pendientesConfirmacion] })
})

// Reinicia el SharePoint simulado para repetir la demo desde cero.
app.post("/api/reset", async (c) => {
  // Protegido por defecto: con ADMIN_KEY se exige la clave; sin ella, solo se permite desde la propia máquina.
  const clave = process.env.ADMIN_KEY
  const local = ["127.0.0.1", "::1", "localhost"].includes(new URL(c.req.url).hostname) && !c.req.header("x-forwarded-for")
  if (clave ? c.req.header("x-admin-key") !== clave : !local) {
    return c.json({ ok: false, error: clave ? "Se requiere la clave de administración para reiniciar" : "Reinicio deshabilitado: configure ADMIN_KEY en el servidor" }, 401)
  }
  await fs.rm(path.join(directorio, "out"), { recursive: true, force: true })
  sesiones.clear()
  return c.json({ ok: true })
})

// Descarga de artefactos generados (solo lectura, solo dentro de out/).
app.get("/api/out/:archivo{.+}", async (c) => {
  const destino = path.resolve(directorio, "out", c.req.param("archivo"))
  if (!destino.startsWith(path.join(directorio, "out") + path.sep)) return c.json({ ok: false, error: "Ruta no permitida" }, 400)
  try {
    return c.text(await fs.readFile(destino, "utf8"))
  } catch {
    return c.json({ ok: false, error: "Archivo no encontrado. Procesa el buzón primero." }, 404)
  }
})

app.use("/*", serveStatic({ root: path.relative(process.cwd(), path.join(directorio, "web")) || "web" }))

// Fecha simulada de la demo (PRD §11). En producción se omite y se usa la fecha real.
const fechaReferencia = () => process.env.FECHA_REFERENCIA || new Date().toISOString().slice(0, 10)

// Resumen diario automático: genera alertas.md y los correos que saldrían a gerencia y comerciales.
const resumenDiario = () => generarAvisos(directorio, fechaReferencia(), true).catch((e) => console.error("[avisos]", e))
setInterval(resumenDiario, 24 * 60 * 60 * 1000)
resumenDiario()

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`Agente de contratos en http://localhost:${port} · modelo ${llm.modelo}`))
