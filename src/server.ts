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

const directorio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const config = {
  directorio,
  maxIteraciones: Number(process.env.MAX_ITERACIONES ?? 25),
  maxTokensSesion: Number(process.env.MAX_TOKENS_SESION ?? 400_000),
}
const MAX_SESIONES = 100

const apiKey = process.env.GEMINI_API_KEY ?? ""
const llm = new GeminiLLM(apiKey, process.env.GEMINI_MODEL ?? "gemini-3.8-flash", Number(process.env.LLM_TIMEOUT_MS ?? 60_000), process.env.GEMINI_MODEL_RESPALDO ?? "gemini-3-flash-preview")
const sesiones = new Map<string, Sesion>()

const app = new Hono()

app.get("/api/health", (c) => c.json({ ok: true, provider: llm.proveedor, model: llm.modelo, llave_configurada: apiKey.length > 0 }))

const CuerpoChat = z.object({ sessionId: z.string().max(100).optional(), message: z.string().min(1).max(4000) })

app.post("/api/chat", async (c) => {
  const parsed = CuerpoChat.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ ok: false, error: "Cuerpo inválido: se espera { sessionId, message }" }, 400)
  if (!apiKey) return c.json({ ok: false, error: "El servidor no tiene configurada la clave del modelo (GEMINI_API_KEY)" }, 500)

  const id = parsed.data.sessionId ?? randomUUID()
  let sesion = sesiones.get(id)
  if (!sesion) {
    if (sesiones.size >= MAX_SESIONES) sesiones.delete(sesiones.keys().next().value as string)
    sesion = { id, mensajes: [], eventos: [], tokensUsados: 0, pendientesConfirmacion: new Set() }
    sesiones.set(id, sesion)
  }

  try {
    const sistema = await cargarSistema(directorio)
    const r = await ejecutarTurno(sesion, parsed.data.message, llm, sistema, config)
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

app.get("/api/sessions/:id", (c) => {
  const s = sesiones.get(c.req.param("id"))
  if (!s) return c.json({ ok: false, error: "Sesión no encontrada" }, 404)
  return c.json({ ok: true, id: s.id, eventos: s.eventos, tokensUsados: s.tokensUsados, pendientes: [...s.pendientesConfirmacion] })
})

// Reinicia el SharePoint simulado para repetir la demo desde cero.
app.post("/api/reset", async (c) => {
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

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`Agente de contratos en http://localhost:${port} · modelo ${llm.modelo}`))
