// Interfaz propia del proveedor de lenguaje. El ciclo del agente solo conoce estos tipos,
// así que cambiar de proveedor (Gemini → Claude → OpenAI) no toca el ciclo.

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: Record<string, unknown> }

export type Mensaje =
  | { rol: "usuario"; texto: string }
  // `crudo` guarda la respuesta original del proveedor (p. ej. firmas de razonamiento de Gemini)
  // para reenviarla tal cual en el siguiente paso del ciclo.
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[]; crudo?: unknown }
  | { rol: "herramienta"; resultados: { id: string; nombre: string; resultado: string }[] }

export type DefinicionHerramienta = { nombre: string; descripcion: string; parametros: Record<string, unknown> }

export type RespuestaLLM = {
  texto: string
  llamadas: LlamadaHerramienta[]
  crudo?: unknown
  tokens: { entrada: number; salida: number }
}

export interface ProveedorLLM {
  readonly proveedor: string
  readonly modelo: string
  enviar(sistema: string, mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM>
}
