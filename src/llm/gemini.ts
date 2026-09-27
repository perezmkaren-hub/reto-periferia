// Implementación del adaptador para Google Gemini vía API REST (sin SDK: menos dependencias).
import type { DefinicionHerramienta, Mensaje, ProveedorLLM, RespuestaLLM } from "./adapter.ts"

type Parte = {
  text?: string
  thought?: boolean
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> }
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> }
  thoughtSignature?: string
}
type Contenido = { role: "user" | "model"; parts: Parte[] }
type RespuestaGemini = {
  candidates?: { content?: Contenido; finishReason?: string }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
  error?: { message: string }
}

export class GeminiLLM implements ProveedorLLM {
  readonly proveedor = "google-gemini"

  constructor(
    private readonly apiKey: string,
    readonly modelo: string,
    private readonly timeoutMs: number,
    private readonly modeloRespaldo?: string,
  ) {}

  // Reintenta ante saturación del proveedor (429/503) y, si persiste, usa el modelo de respaldo.
  async enviar(sistema: string, mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const modelos = [this.modelo, this.modelo, this.modelo, this.modeloRespaldo ?? this.modelo, this.modeloRespaldo ?? this.modelo]
    let ultimoError: Error = new Error("sin intentos")
    for (const [i, modelo] of modelos.entries()) {
      try {
        return await this.enviarA(modelo, sistema, mensajes, herramientas)
      } catch (e) {
        ultimoError = e instanceof Error ? e : new Error(String(e))
        if (!/respondió (429|500|503)/.test(ultimoError.message)) throw ultimoError
        console.warn(`[llm] intento ${i + 1} con ${modelo} falló: ${ultimoError.message.slice(0, 120)}`)
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
      }
    }
    throw ultimoError
  }

  private aContenidos(mensajes: Mensaje[]): Contenido[] {
    return mensajes.map((m): Contenido => {
      if (m.rol === "usuario") return { role: "user", parts: [{ text: m.texto }] }
      if (m.rol === "asistente") {
        if (m.crudo) return m.crudo as Contenido
        const parts: Parte[] = []
        if (m.texto) parts.push({ text: m.texto })
        for (const l of m.llamadas) parts.push({ functionCall: { id: l.id, name: l.nombre, args: l.argumentos } })
        return { role: "model", parts }
      }
      return {
        role: "user",
        parts: m.resultados.map((r) => ({
          functionResponse: { id: r.id, name: r.nombre, response: JSON.parse(r.resultado) as Record<string, unknown> },
        })),
      }
    })
  }

  private async enviarA(modelo: string, sistema: string, mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`
    const cuerpo = {
      systemInstruction: { parts: [{ text: sistema }] },
      contents: this.aContenidos(mensajes),
      tools: [{
        functionDeclarations: herramientas.map((h) => ({
          name: h.nombre, description: h.descripcion, parametersJsonSchema: h.parametros,
        })),
      }],
      generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: "low" } },
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: "POST",
        // La clave va en un encabezado, nunca en la URL (así no queda en logs de acceso).
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      const esTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
      throw new Error(esTimeout ? `El modelo no respondió en ${this.timeoutMs / 1000} s` : "No se pudo conectar con el proveedor del modelo")
    }

    const json = (await res.json()) as RespuestaGemini
    if (!res.ok) throw new Error(`El proveedor del modelo respondió ${res.status}: ${json.error?.message ?? "error desconocido"}`)

    const contenido = json.candidates?.[0]?.content ?? { role: "model", parts: [] }
    const partes = contenido.parts ?? []
    const texto = partes.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim()
    const llamadas = partes
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: p.functionCall?.id ?? `llamada-${Date.now()}-${i}`,
        nombre: p.functionCall?.name ?? "",
        argumentos: p.functionCall?.args ?? {},
      }))

    return {
      texto,
      llamadas,
      crudo: { role: "model", parts: partes },
      tokens: { entrada: json.usageMetadata?.promptTokenCount ?? 0, salida: (json.usageMetadata?.candidatesTokenCount ?? 0) + (json.usageMetadata?.thoughtsTokenCount ?? 0) },
    }
  }
}
