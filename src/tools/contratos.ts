// Herramientas del agente "Registro de Contratos Vigentes".
// Cada export es una herramienta: { description, args (zod), execute(args, ctx) → string JSON }.
// El nombre que ve el modelo es contratos_<export>. Nunca lanzan: devuelven { ok: false, error }.
import { z } from "zod"
import { promises as fs } from "node:fs"
import path from "node:path"

// ─── Tipos compartidos ────────────────────────────────────────────────────────

export type Ctx = { directory: string; sessionId: string }

const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const
const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const
const ESTADOS_POLIZA = ["vigente", "pendiente", "vencida", "no_aplica"] as const
const UMBRAL_CONFIANZA = 0.8
const FECHA_CORTE = "2026-05-30"

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD")

export const ContratoSchema = z.object({
  id_contrato: z.string().nullable().describe("Número del contrato tal como aparece en el documento"),
  cliente: z.string().nullable().describe("Razón social de la contraparte"),
  nit_cliente: z.string().nullable().describe("Identificador tributario sin dígito de verificación ni puntos"),
  pais: z.enum(PAISES).nullable().describe("País de la contraparte"),
  objeto: z.string().max(200).nullable().describe("Objeto del contrato, máx. 200 caracteres"),
  valor: z.number().nullable().describe("Valor sin separadores; 0 si es por demanda"),
  valor_indeterminado: z.boolean().describe("true si el contrato no tiene valor determinado"),
  moneda: z.enum(MONEDAS).nullable().describe("Moneda del valor"),
  fecha_inicio: fecha.nullable().describe("Fecha de inicio YYYY-MM-DD"),
  fecha_fin: fecha.nullable().describe("Fecha de fin YYYY-MM-DD"),
  requiere_poliza: z.boolean().nullable().describe("true si el contrato exige póliza"),
  tipo_poliza: z.string().describe("Tipos de póliza separados por ';'. Vacío si no requiere"),
  es_otrosi: z.boolean().describe("true si el documento es un otrosí que modifica un contrato existente"),
  confianza: z.record(z.string(), z.number().min(0).max(1)).describe("Confianza por campo, entre 0 y 1"),
})
export type Contrato = z.infer<typeof ContratoSchema>

type Fila = {
  id_contrato: string; cliente: string; nit_cliente: string; pais: string; objeto: string
  valor: string; moneda: string; fecha_inicio: string; fecha_fin: string; requiere_poliza: string
  tipo_poliza: string; estado_poliza: string; comercial: string; ruta_sharepoint: string
  fecha_registro: string; fuente: string
}
const COLUMNAS: (keyof Fila)[] = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio",
  "fecha_fin", "requiere_poliza", "tipo_poliza", "estado_poliza", "comercial", "ruta_sharepoint",
  "fecha_registro", "fuente",
]

type Correo = { id: string; de: string; para: string; asunto: string; fecha: string; cuerpo: string; adjuntos: string[] }
type Comercial = { email: string; nombre: string; region: string }
type Resultado = { ok: true; data: unknown } | { ok: false; error: string }

// ─── Rutas ────────────────────────────────────────────────────────────────────

const rutas = (dir: string) => ({
  buzon: path.join(dir, "fixtures/reto-02/buzon"),
  maestroFixture: path.join(dir, "fixtures/reto-02/maestro-contratos.csv"),
  comerciales: path.join(dir, "fixtures/reto-02/comerciales.json"),
  out: path.join(dir, "out"),
  sharepoint: path.join(dir, "out/sharepoint"),
  maestro: path.join(dir, "out/sharepoint/maestro-contratos.csv"),
  historial: path.join(dir, "out/sharepoint/historial.jsonl"),
  procesados: path.join(dir, "out/procesados.json"),
  log: path.join(dir, "out/log.jsonl"),
  alertas: path.join(dir, "out/alertas.md"),
})

// ─── Utilidades de archivos ───────────────────────────────────────────────────

const existe = async (p: string) => fs.access(p).then(() => true, () => false)
const leerJson = async <T>(p: string): Promise<T> => JSON.parse(await fs.readFile(p, "utf8")) as T
const anexar = async (p: string, obj: object) => {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.appendFile(p, JSON.stringify(obj) + "\n")
}

// RN6: el fixture es de solo lectura; la primera ejecución lo copia a out/sharepoint/.
async function asegurarMaestro(dir: string) {
  const r = rutas(dir)
  if (!(await existe(r.maestro))) {
    await fs.mkdir(r.sharepoint, { recursive: true })
    await fs.copyFile(r.maestroFixture, r.maestro)
  }
}

function parsearCsvLinea(linea: string): string[] {
  const celdas: string[] = []
  let actual = ""
  let comillas = false
  for (const c of linea) {
    if (c === '"') comillas = !comillas
    else if (c === "," && !comillas) { celdas.push(actual); actual = "" }
    else actual += c
  }
  celdas.push(actual)
  return celdas
}
const csvCelda = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

async function leerMaestro(dir: string): Promise<Fila[]> {
  await asegurarMaestro(dir)
  const lineas = (await fs.readFile(rutas(dir).maestro, "utf8")).split(/\r?\n/).filter(Boolean)
  const encabezados = parsearCsvLinea(lineas[0]) as (keyof Fila)[]
  return lineas.slice(1).map((l) => {
    const celdas = parsearCsvLinea(l)
    const fila = {} as Fila
    encabezados.forEach((h, i) => { fila[h] = celdas[i] ?? "" })
    return fila
  })
}

async function escribirMaestro(dir: string, filas: Fila[]) {
  const texto = [COLUMNAS.join(","), ...filas.map((f) => COLUMNAS.map((c) => csvCelda(f[c])).join(","))].join("\n") + "\n"
  await fs.writeFile(rutas(dir).maestro, texto)
}

async function leerProcesados(dir: string): Promise<Record<string, string>> {
  const p = rutas(dir).procesados
  return (await existe(p)) ? leerJson<Record<string, string>>(p) : {}
}

async function marcarProcesado(dir: string, mensajeId: string, accion: string) {
  const procesados = await leerProcesados(dir)
  procesados[mensajeId] = accion
  await fs.mkdir(rutas(dir).out, { recursive: true })
  await fs.writeFile(rutas(dir).procesados, JSON.stringify(procesados, null, 2))
}

// Evita que un mensaje_id como "../../etc" salga del buzón.
const idSeguro = (id: string) => /^[a-zA-Z0-9_-]+$/.test(id)

async function leerCorreo(dir: string, mensajeId: string): Promise<Correo> {
  if (!idSeguro(mensajeId)) throw new Error(`mensaje_id inválido: ${mensajeId}`)
  const p = path.join(rutas(dir).buzon, mensajeId, "correo.json")
  if (!(await existe(p))) throw new Error(`No existe el mensaje ${mensajeId} en el buzón`)
  return leerJson<Correo>(p)
}

// ─── Heurísticas de texto ─────────────────────────────────────────────────────

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}
const pad = (n: number) => String(n).padStart(2, "0")
const aIso = (a: number, m: number, d: number) => `${a}-${pad(m)}-${pad(d)}`
const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate()

function sumarMeses(iso: string, meses: number): { a: number; m: number } {
  const [a, m] = iso.split("-").map(Number)
  const total = a * 12 + (m - 1) + meses
  return { a: Math.floor(total / 12), m: (total % 12) + 1 }
}

// "(1) de agosto de 2026" → 2026-08-01
function fechasEn(texto: string): string[] {
  const re = /\((\d{1,2})\)\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/gi
  const out: string[] = []
  for (const m of texto.matchAll(re)) {
    const mes = MESES[m[2].toLowerCase()]
    if (mes) out.push(aIso(Number(m[3]), mes, Number(m[1])))
  }
  return out
}

function esFechaValida(iso: string): boolean {
  const [a, m, d] = iso.split("-").map(Number)
  return m >= 1 && m <= 12 && d >= 1 && d <= ultimoDia(a, m)
}

// Toma el texto de una cláusula: desde "SEGUNDA. VALOR." hasta la siguiente cláusula.
function clausula(texto: string, titulo: string): string | null {
  const re = new RegExp(`(?:^|\\n)\\s*[A-ZÁÉÍÓÚ]+\\.\\s*${titulo}[^\\n]*`, "i")
  const m = texto.match(re)
  return m ? m[0].trim() : null
}

// "265.000.000" → 265000000 ; "120,000.00" → 120000
function parsearNumero(crudo: string): number | null {
  let s = crudo.trim()
  const ultimaComa = s.lastIndexOf(","), ultimoPunto = s.lastIndexOf(".")
  if (ultimaComa > -1 && ultimoPunto > -1) {
    const decimal = ultimaComa > ultimoPunto ? "," : "."
    s = s.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".")
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
    s = s.replace(/[.,]/g, "")
  } else {
    s = s.replace(",", ".")
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(s\.?\s?a\.?\s?s|s\.?\s?a\.?\s?c|s\.?\s?a|s\. de r\.l|ltda)\.?$/i, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

// Similitud de Dice sobre bigramas (0..1), para RN2 (mismo NIT + objeto parecido).
export function similitud(a: string, b: string): number {
  const bigramas = (s: string) => {
    const t = normalizar(s).replace(/\s+/g, " ")
    const out = new Map<string, number>()
    for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1)
    return out
  }
  const A = bigramas(a), B = bigramas(b)
  let inter = 0, total = 0
  for (const [k, v] of A) { inter += Math.min(v, B.get(k) ?? 0); total += v }
  for (const v of B.values()) total += v
  return total === 0 ? 0 : (2 * inter) / total
}

// Busca el nombre del cliente con mayúsculas/minúsculas correctas (bloque de firmas).
function nombreBonito(texto: string, enMayusculas: string): { nombre: string; confianza: number } {
  const escapado = enMayusculas.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  for (const m of texto.matchAll(new RegExp(escapado, "gi"))) {
    if (m[0] !== m[0].toUpperCase()) return { nombre: m[0], confianza: 0.95 }
  }
  const titulo = enMayusculas.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
  return { nombre: titulo, confianza: 0.85 }
}

function inferirPais(tipoId: string, id: string, texto: string): { pais: Contrato["pais"]; confianza: number } {
  const t = normalizar(texto)
  const porTexto: Contrato["pais"] =
    /ecuador|quito|guayaquil/.test(t) ? "EC" : /peru|lima\b/.test(t) ? "PE" :
    /panama/.test(t) ? "PA" : /honduras|tegucigalpa|san pedro sula/.test(t) ? "HN" : null
  const porId: Contrato["pais"] =
    tipoId === "NIT" ? "CO" : tipoId === "RTN" ? "HN" :
    tipoId === "RUC" && id.length === 13 ? "EC" : tipoId === "RUC" && id.length === 11 ? "PE" : null
  if (porId && porTexto && porId !== porTexto) return { pais: porId, confianza: 0.5 }
  if (porId === "CO" && !porTexto) return { pais: "CO", confianza: 0.95 }
  if (porId && porTexto) return { pais: porId, confianza: 0.95 }
  return { pais: porId ?? porTexto, confianza: porId ?? porTexto ? 0.85 : 0 }
}

const MONEDA_POR_PAIS: Record<string, Contrato["moneda"]> = { CO: "COP", EC: "USD", PE: "PEN", PA: "USD", HN: "HNL" }

// ─── Extracción determinista ──────────────────────────────────────────────────

export function extraerDeTexto(texto: string): Contrato {
  const conf: Record<string, number> = {}
  const es_otrosi = /^\s*OTROS[IÍ]/i.test(texto)

  // Número de contrato: en un otrosí es el del contrato modificado.
  const mId = texto.match(/CONTRATO[^\n]*?No\.\s*([A-Z]{1,4}-\d{4}-\d{1,4})/i)
  const id_contrato = mId ? mId[1].toUpperCase() : null
  conf.id_contrato = id_contrato ? 0.98 : 0

  // Contraparte: primera parte nombrada tras "Entre (los suscritos,)".
  const mParte = texto.match(/Entre\s+(?:los suscritos,\s*)?([^,]+?),\s*(?:identificada con\s+)?(NIT|RUC|RTN)\s*([\d.\-]+)/i)
  let cliente: string | null = null, nit_cliente: string | null = null, pais: Contrato["pais"] = null
  if (mParte) {
    const bonito = nombreBonito(texto, mParte[1].trim())
    cliente = bonito.nombre
    conf.cliente = bonito.confianza
    const tipoId = mParte[2].toUpperCase()
    // NIT colombiano: se quita el dígito de verificación (lo que va después del guion).
    nit_cliente = (tipoId === "NIT" ? mParte[3].split("-")[0] : mParte[3]).replace(/\D/g, "")
    conf.nit_cliente = nit_cliente.length >= 8 ? 0.95 : 0.6
    const p = inferirPais(tipoId, nit_cliente, texto.slice(0, 600))
    pais = p.pais
    conf.pais = p.confianza
  } else {
    conf.cliente = 0; conf.nit_cliente = 0; conf.pais = 0
  }

  // Objeto.
  const cObjeto = clausula(texto, "OBJETO")
  let objeto: string | null = null
  if (cObjeto) {
    objeto = cObjeto
      .replace(/^.*?OBJETO\.\s*/i, "")
      .replace(/^(EL CONTRATISTA\s+(se obliga a\s+)?(ejecutar|prestará|prestar)\s+(la|el|los|las)?\s*)/i, "")
      .replace(/^Establecer las condiciones generales bajo las cuales EL CONTRATISTA prestará\s+/i, "")
      .replace(/\s+/g, " ").trim()
    objeto = objeto.charAt(0).toUpperCase() + objeto.slice(1)
    if (objeto.length > 200) objeto = objeto.slice(0, 197).trimEnd() + "..."
    conf.objeto = 0.9
  } else {
    conf.objeto = 0
  }

  // Valor y moneda.
  const cValor = clausula(texto, "VALOR") ?? ""
  let valor: number | null = null, moneda: Contrato["moneda"] = null, valor_indeterminado = false
  const mValor = cValor.match(/\(\s*(COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d.,]+)\s*\)/i)
    ?? texto.match(/valor total del contrato será de[^(]*\(\s*(COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d.,]+)\s*\)/i)
  if (mValor) {
    moneda = mValor[1].toUpperCase() as Contrato["moneda"]
    valor = parsearNumero(mValor[2])
    conf.valor = valor !== null ? 0.95 : 0.3
    conf.moneda = 0.98
  } else if (/no tiene un valor determinado|valor indeterminado|por demanda/i.test(cValor)) {
    // Contrato por demanda: el maestro exige valor 0, pero un humano debe confirmarlo.
    valor = 0
    valor_indeterminado = true
    conf.valor = 0.5
    moneda = pais ? MONEDA_POR_PAIS[pais] ?? null : null
    conf.moneda = moneda ? 0.8 : 0
  } else {
    conf.valor = 0; conf.moneda = 0
  }

  // Fechas.
  const cPlazo = clausula(texto, "PLAZO") ?? ""
  const plazoTexto = es_otrosi ? (texto.match(/cláusula TERCERA \(PLAZO\)[^\n]*/i)?.[0] ?? "") : cPlazo
  const fechasPlazo = fechasEn(plazoTexto)
  let fecha_inicio: string | null = null, fecha_fin: string | null = null
  if (es_otrosi) {
    // Un otrosí solo trae la nueva fecha fin; el resto se conserva del maestro.
    fecha_fin = fechasPlazo[0] ?? null
    conf.fecha_fin = fecha_fin ? 0.95 : 0
    conf.fecha_inicio = 0
  } else if (fechasPlazo.length >= 2) {
    ;[fecha_inicio, fecha_fin] = fechasPlazo
    conf.fecha_inicio = 0.95; conf.fecha_fin = 0.95
  } else {
    // Plazo en meses contado desde la firma.
    const mMeses = cPlazo.match(/\((\d{1,3})\)\s*meses/i)
    const firmaExacta = fechasEn(texto.slice(texto.search(/se firma/i)))[0]
    const firmaMes = texto.match(/se firma[^\n]*en el mes de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i)
    if (firmaExacta) {
      fecha_inicio = firmaExacta; conf.fecha_inicio = 0.85
    } else if (firmaMes && MESES[firmaMes[1].toLowerCase()]) {
      // Solo se conoce mes y año de firma: se toma el día 1.
      fecha_inicio = aIso(Number(firmaMes[2]), MESES[firmaMes[1].toLowerCase()], 1)
      conf.fecha_inicio = 0.8
    } else {
      conf.fecha_inicio = 0
    }
    if (fecha_inicio && mMeses) {
      // Día de firma incierto → fecha fin estimada al cierre del mes (la más tardía posible). Va a revisión.
      const { a, m } = sumarMeses(fecha_inicio, Number(mMeses[1]))
      fecha_fin = firmaExacta
        ? aIso(a, m, Math.min(Number(fecha_inicio.slice(8)), ultimoDia(a, m)))
        : aIso(a, m, ultimoDia(a, m))
      conf.fecha_fin = firmaExacta ? 0.85 : 0.5
    } else {
      conf.fecha_fin = 0
    }
  }

  // Póliza.
  const cGarantias = clausula(texto, "GARANT[IÍ]AS") ?? ""
  const TIPOS: [RegExp, string][] = [
    [/cumplimiento/i, "cumplimiento"], [/calidad/i, "calidad"],
    [/responsabilidad civil/i, "responsabilidad_civil"], [/salarios|prestaciones/i, "salarios_prestaciones"],
  ]
  let requiere_poliza: boolean | null
  let tipo_poliza = ""
  if (es_otrosi) {
    requiere_poliza = null // se conserva la del maestro
    conf.requiere_poliza = 0
  } else if (/p[óo]liza/i.test(cGarantias) && /para cada orden de servicio/i.test(cGarantias)) {
    // Contrato marco: la póliza se exige a cada orden de servicio, no al marco.
    requiere_poliza = false
    conf.requiere_poliza = 0.8
  } else if (/p[óo]liza/i.test(cGarantias)) {
    requiere_poliza = true
    tipo_poliza = TIPOS.filter(([re]) => re.test(cGarantias)).map(([, t]) => t).join(";")
    conf.requiere_poliza = 0.9
  } else {
    requiere_poliza = false
    conf.requiere_poliza = /p[óo]liza/i.test(texto) ? 0.6 : 0.9
  }

  return {
    id_contrato, cliente, nit_cliente, pais, objeto, valor, valor_indeterminado, moneda,
    fecha_inicio, fecha_fin, requiere_poliza, tipo_poliza, es_otrosi, confianza: conf,
  }
}

// ─── Clasificación (RN1–RN5) ──────────────────────────────────────────────────

const CAMPOS_REVISABLES = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda",
  "fecha_inicio", "fecha_fin", "requiere_poliza",
] as const

type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado"
type Validacion = {
  clasificacion: Clasificacion
  motivo: string
  id_contrato_existente?: string
  requiere_revision: string[]
  diferencias?: Record<string, { antes: string; despues: string }>
  advertencias: string[]
  comercial: string | null
}

const tieneContrato = (correo: Correo) => correo.adjuntos.some((a) => /^(contrato|otros[ií])/i.test(a))

async function resolverComercial(dir: string, email: string) {
  const lista = await leerJson<Comercial[]>(rutas(dir).comerciales)
  return lista.find((c) => c.email.toLowerCase() === email.toLowerCase()) ?? null
}

async function clasificar(dir: string, correo: Correo, c: Contrato): Promise<Validacion> {
  const advertencias: string[] = []
  const comercial = await resolverComercial(dir, correo.de)
  if (!comercial) advertencias.push(`Remitente no registrado en comerciales.json: ${correo.de}`)
  const base = { advertencias, comercial: comercial?.nombre ?? null }

  // RN4: rechazado.
  if (!tieneContrato(correo)) {
    return { ...base, clasificacion: "rechazado", motivo: `El correo no trae contrato (adjuntos: ${correo.adjuntos.join(", ")})`, requiere_revision: [] }
  }
  if (!c.cliente || (!c.objeto && !c.es_otrosi)) {
    return { ...base, clasificacion: "rechazado", motivo: "El texto no tiene partes u objeto identificables", requiere_revision: [] }
  }

  const maestro = await leerMaestro(dir)
  const existente =
    (c.id_contrato && maestro.find((f) => f.id_contrato === c.id_contrato)) ||
    (c.nit_cliente && c.objeto && maestro.find((f) => f.nit_cliente === c.nit_cliente && similitud(f.objeto, c.objeto ?? "") >= 0.9)) ||
    null

  // Campos con baja confianza. En un otrosí solo cuentan los campos que trae el documento.
  const bajaConfianza = CAMPOS_REVISABLES.filter((k) => {
    if (c.es_otrosi && c[k] === null) return false
    return (c.confianza[k] ?? 0) < UMBRAL_CONFIANZA
  })

  if (!existente) {
    return { ...base, clasificacion: "nuevo", motivo: "No hay coincidencia en el maestro", requiere_revision: bajaConfianza }
  }

  // Conflictos: mismo número de contrato pero otro NIT.
  const conflictos: string[] = []
  if (c.nit_cliente && existente.nit_cliente && c.nit_cliente !== existente.nit_cliente) {
    conflictos.push(`nit_cliente (maestro ${existente.nit_cliente} vs documento ${c.nit_cliente})`)
  }

  const diferencias: Record<string, { antes: string; despues: string }> = {}
  const comparar: [keyof Fila, string | null][] = [
    ["valor", c.valor === null ? null : String(c.valor)], ["moneda", c.moneda],
    ["fecha_inicio", c.fecha_inicio], ["fecha_fin", c.fecha_fin],
  ]
  for (const [campo, nuevo] of comparar) {
    if (nuevo !== null && nuevo !== existente[campo]) diferencias[campo] = { antes: existente[campo], despues: nuevo }
  }

  // RN1: duplicado.
  if (!c.es_otrosi && Object.keys(diferencias).length === 0) {
    return {
      ...base, clasificacion: "duplicado", id_contrato_existente: existente.id_contrato,
      motivo: `Ya existe ${existente.id_contrato} con el mismo valor y fechas`, requiere_revision: conflictos,
    }
  }

  // RN2: actualización.
  if (c.es_otrosi && existente.requiere_poliza === "true") {
    advertencias.push("El otrosí amplía el plazo: las pólizas deben ampliarse, estado_poliza pasa a 'pendiente'")
  }
  return {
    ...base, clasificacion: "actualizacion", id_contrato_existente: existente.id_contrato,
    motivo: c.es_otrosi ? "El documento es un otrosí de un contrato existente" : "Mismo contrato con campos distintos",
    requiere_revision: [...bajaConfianza, ...conflictos], diferencias,
  }
}

async function leerAdjuntoContrato(dir: string, correo: Correo): Promise<{ nombre: string; texto: string } | null> {
  const nombre = correo.adjuntos.find((a) => /^(contrato|otros[ií])/i.test(a))
  if (!nombre) return null
  const texto = await fs.readFile(path.join(rutas(dir).buzon, correo.id, nombre), "utf8")
  return { nombre, texto }
}

const CONTRATO_VACIO: Contrato = {
  id_contrato: null, cliente: null, nit_cliente: null, pais: null, objeto: null, valor: null,
  valor_indeterminado: false, moneda: null, fecha_inicio: null, fecha_fin: null,
  requiere_poliza: null, tipo_poliza: "", es_otrosi: false, confianza: {},
}

// La fuente de los valores es siempre el documento: el modelo no necesita (ni puede) reescribirlos.
async function contratoDelMensaje(dir: string, correo: Correo): Promise<Contrato> {
  const adjunto = await leerAdjuntoContrato(dir, correo)
  return adjunto ? extraerDeTexto(adjunto.texto) : CONTRATO_VACIO
}

const CorreccionesSchema = z.object({
  valor: z.number().optional().describe("Valor confirmado por el usuario"),
  moneda: z.enum(MONEDAS).optional().describe("Moneda confirmada"),
  fecha_inicio: fecha.optional().describe("Fecha inicio confirmada YYYY-MM-DD"),
  fecha_fin: fecha.optional().describe("Fecha fin confirmada YYYY-MM-DD"),
  requiere_poliza: z.boolean().optional().describe("Si requiere póliza, confirmado"),
  cliente: z.string().optional().describe("Razón social confirmada"),
  nit_cliente: z.string().optional().describe("NIT confirmado"),
  objeto: z.string().max(200).optional().describe("Objeto confirmado"),
})

// ─── Envoltura común: valida args, registra log (RN7/CA4), nunca lanza ────────

type Herramienta<S extends z.ZodRawShape> = {
  description: string
  args: S
  execute: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<string>
}

function herramienta<S extends z.ZodRawShape>(
  nombre: string,
  description: string,
  args: S,
  cuerpo: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<{ data: unknown; resumen: string }>,
): Herramienta<S> {
  return {
    description,
    args,
    async execute(crudos, ctx) {
      const parsed = z.object(args).safeParse(crudos)
      let resultado: Resultado
      let resumen: string
      if (!parsed.success) {
        resultado = { ok: false, error: `Argumentos inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }
        resumen = resultado.error
      } else {
        try {
          const r = await cuerpo(parsed.data, ctx)
          resultado = { ok: true, data: r.data }
          resumen = r.resumen
        } catch (e) {
          resultado = { ok: false, error: e instanceof Error ? e.message : String(e) }
          resumen = resultado.error
        }
      }
      const mensaje_id = typeof (crudos as Record<string, unknown>).mensaje_id === "string" ? (crudos as Record<string, string>).mensaje_id : null
      await anexar(rutas(ctx.directory).log, {
        ts: new Date().toISOString(), sesion: ctx.sessionId, herramienta: `contratos_${nombre}`,
        mensaje_id, ok: resultado.ok, resumen,
      }).catch(() => undefined)
      return JSON.stringify(resultado)
    },
  }
}

// ─── Herramientas ─────────────────────────────────────────────────────────────

export const leer_buzon = herramienta(
  "leer_buzon",
  "Lista los mensajes del buzón de contratos que aún no se han procesado, con remitente, asunto, adjuntos y si traen contrato.",
  {},
  async (_args, ctx) => {
    const r = rutas(ctx.directory)
    const procesados = await leerProcesados(ctx.directory)
    const ids = (await fs.readdir(r.buzon)).filter((d) => !d.startsWith(".")).sort()
    const mensajes = []
    for (const id of ids) {
      if (procesados[id]) continue
      const c = await leerCorreo(ctx.directory, id)
      mensajes.push({ id: c.id, de: c.de, asunto: c.asunto, fecha: c.fecha, adjuntos: c.adjuntos, tiene_contrato: tieneContrato(c) })
    }
    return { data: { mensajes, ya_procesados: Object.keys(procesados).length }, resumen: `${mensajes.length} mensajes pendientes` }
  },
)

export const extraer = herramienta(
  "extraer",
  "Extrae los datos estructurados del contrato adjunto a un mensaje, con un nivel de confianza por campo (0 a 1).",
  { mensaje_id: z.string().describe("Id del mensaje del buzón, por ejemplo msg-001") },
  async ({ mensaje_id }, ctx) => {
    const correo = await leerCorreo(ctx.directory, mensaje_id)
    const adjunto = await leerAdjuntoContrato(ctx.directory, correo)
    if (!adjunto) throw new Error(`El mensaje ${mensaje_id} no trae adjunto de contrato (adjuntos: ${correo.adjuntos.join(", ")})`)
    if (!adjunto.texto.trim()) throw new Error(`El adjunto ${adjunto.nombre} está vacío`)
    const contrato = extraerDeTexto(adjunto.texto)
    for (const f of [contrato.fecha_inicio, contrato.fecha_fin]) {
      if (f && !esFechaValida(f)) throw new Error(`Fecha inválida en el contrato: ${f}`)
    }
    return {
      data: { mensaje_id, adjunto: adjunto.nombre, contrato },
      resumen: `${contrato.id_contrato ?? "sin número"} · ${contrato.cliente ?? "sin cliente"}`,
    }
  },
)

export const validar = herramienta(
  "validar",
  "Clasifica un contrato extraído como nuevo, actualizacion, duplicado o rechazado contra el maestro, y lista los campos que requieren revisión humana.",
  {
    mensaje_id: z.string().describe("Id del mensaje del buzón"),
    contrato: ContratoSchema.nullable().optional().describe("Opcional. Si se omite, la herramienta extrae el contrato del mensaje (recomendado)"),
  },
  async ({ mensaje_id, contrato }, ctx) => {
    const correo = await leerCorreo(ctx.directory, mensaje_id)
    const c = contrato ?? (await contratoDelMensaje(ctx.directory, correo))
    const v = await clasificar(ctx.directory, correo, c)
    return { data: v, resumen: `${v.clasificacion}${v.requiere_revision.length ? ` · revisar: ${v.requiere_revision.join(", ")}` : ""}` }
  },
)

export const registrar = herramienta(
  "registrar",
  "Registra o actualiza el contrato en el maestro de SharePoint y archiva el documento; si hay campos en revisión solo escribe con confirmado=true.",
  {
    mensaje_id: z.string().describe("Id del mensaje del buzón"),
    contrato: ContratoSchema.nullable().optional().describe("Opcional. Si se omite, la herramienta extrae el contrato del mensaje (recomendado)"),
    correcciones: CorreccionesSchema.optional().describe("Valores que el usuario confirmó o corrigió en el chat, solo con confirmado=true"),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente los campos en revisión"),
  },
  async ({ mensaje_id, contrato, correcciones, confirmado }, ctx) => {
    const dir = ctx.directory
    const correo = await leerCorreo(dir, mensaje_id)
    const procesados = await leerProcesados(dir)
    if (procesados[mensaje_id]) throw new Error(`El mensaje ${mensaje_id} ya fue procesado (${procesados[mensaje_id]})`)

    // Se vuelve a validar aquí: registrar nunca confía en una clasificación hecha antes.
    const base = contrato ?? (await contratoDelMensaje(dir, correo))
    if (correcciones && confirmado !== true) throw new Error("Las correcciones solo se aceptan con confirmado=true")
    const c: Contrato = correcciones ? { ...base, ...correcciones, confianza: { ...base.confianza, ...Object.fromEntries(Object.keys(correcciones).map((k) => [k, 1])) } } : base
    const v = await clasificar(dir, correo, c)

    if (v.clasificacion === "rechazado" || v.clasificacion === "duplicado") {
      await marcarProcesado(dir, mensaje_id, v.clasificacion)
      return { data: { id_contrato: v.id_contrato_existente ?? null, accion: `sin_escritura_${v.clasificacion}`, ruta_archivo: null, motivo: v.motivo }, resumen: `${v.clasificacion}: no se escribe` }
    }
    if (v.requiere_revision.length > 0 && confirmado !== true) {
      throw new Error(`requiere revisión: ${v.requiere_revision.join(", ")}. Pida confirmación al usuario y vuelva a llamar con confirmado=true`)
    }

    const maestro = await leerMaestro(dir)
    const adjunto = await leerAdjuntoContrato(dir, correo)
    if (!adjunto) throw new Error("No se encontró el adjunto a archivar")
    const hoy = new Date().toISOString().slice(0, 10)

    let fila: Fila
    let accion: "insertado" | "actualizado"
    let cambios: Record<string, { antes: string; despues: string }> = {}

    if (v.clasificacion === "actualizacion" && v.id_contrato_existente) {
      const idx = maestro.findIndex((f) => f.id_contrato === v.id_contrato_existente)
      const antes = { ...maestro[idx] }
      fila = { ...antes }
      if (c.valor !== null) fila.valor = String(c.valor)
      if (c.moneda) fila.moneda = c.moneda
      if (c.fecha_inicio) fila.fecha_inicio = c.fecha_inicio
      if (c.fecha_fin) fila.fecha_fin = c.fecha_fin
      if (c.es_otrosi && fila.requiere_poliza === "true") fila.estado_poliza = "pendiente"
      const archivo = `Contratos/${fila.fecha_inicio.slice(0, 4)}/${slug(fila.cliente)}/${fila.id_contrato}-otrosi-${mensaje_id}${path.extname(adjunto.nombre)}`
      await fs.mkdir(path.join(rutas(dir).sharepoint, path.dirname(archivo)), { recursive: true })
      await fs.writeFile(path.join(rutas(dir).sharepoint, archivo), adjunto.texto)
      for (const k of COLUMNAS) if (antes[k] !== fila[k]) cambios[k] = { antes: antes[k], despues: fila[k] }
      maestro[idx] = fila
      accion = "actualizado"
      await escribirMaestro(dir, maestro)
      await anexar(rutas(dir).historial, { ts: new Date().toISOString(), id_contrato: fila.id_contrato, accion, cambios, mensaje_id, archivo })
      await marcarProcesado(dir, mensaje_id, accion)
      return { data: { id_contrato: fila.id_contrato, accion, ruta_archivo: archivo, cambios }, resumen: `${fila.id_contrato} actualizado` }
    }

    // Nuevo.
    let id = c.id_contrato
    if (!id) {
      const anio = (c.fecha_inicio ?? hoy).slice(0, 4)
      const n = maestro.filter((f) => f.id_contrato.startsWith(`AUTO-${anio}-`)).length + 1
      id = `AUTO-${anio}-${String(n).padStart(3, "0")}`
    }
    if (!c.cliente || !c.fecha_inicio) throw new Error("Faltan cliente o fecha_inicio para registrar")
    const archivo = `Contratos/${c.fecha_inicio.slice(0, 4)}/${slug(c.cliente)}/${id}${path.extname(adjunto.nombre)}`
    await fs.mkdir(path.join(rutas(dir).sharepoint, path.dirname(archivo)), { recursive: true })
    await fs.writeFile(path.join(rutas(dir).sharepoint, archivo), adjunto.texto)
    fila = {
      id_contrato: id, cliente: c.cliente, nit_cliente: c.nit_cliente ?? "", pais: c.pais ?? "",
      objeto: c.objeto ?? "", valor: String(c.valor ?? 0), moneda: c.moneda ?? "",
      fecha_inicio: c.fecha_inicio, fecha_fin: c.fecha_fin ?? "",
      requiere_poliza: String(c.requiere_poliza === true), tipo_poliza: c.requiere_poliza ? c.tipo_poliza : "",
      estado_poliza: c.requiere_poliza ? "pendiente" : "no_aplica",
      comercial: v.comercial ?? `NO REGISTRADO (${correo.de})`, ruta_sharepoint: archivo,
      fecha_registro: hoy, fuente: "buzon",
    }
    maestro.push(fila)
    accion = "insertado"
    cambios = Object.fromEntries(COLUMNAS.map((k) => [k, { antes: "", despues: fila[k] }]))
    await escribirMaestro(dir, maestro)
    await anexar(rutas(dir).historial, {
      ts: new Date().toISOString(), id_contrato: id, accion, cambios, mensaje_id,
      confirmado_por_usuario: v.requiere_revision.length > 0 ? v.requiere_revision : undefined,
    })
    await marcarProcesado(dir, mensaje_id, accion)
    return { data: { id_contrato: id, accion, ruta_archivo: archivo }, resumen: `${id} insertado` }
  },
)

export const alertas = herramienta(
  "alertas",
  "Genera el reporte de riesgos out/alertas.md: contratos que vencen en 60 días o menos, pólizas pendientes y contratos registrados desde el corte del 2026-05-30.",
  { hoy: fecha.describe("Fecha de referencia YYYY-MM-DD") },
  async ({ hoy }, ctx) => {
    if (!esFechaValida(hoy)) throw new Error(`Fecha inválida: ${hoy}`)
    const maestro = await leerMaestro(ctx.directory)
    const dias = (iso: string) => Math.round((Date.parse(iso) - Date.parse(hoy)) / 86_400_000)

    const vencen = maestro
      .filter((f) => f.fecha_fin && dias(f.fecha_fin) >= 0 && dias(f.fecha_fin) <= 60)
      .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_fin: f.fecha_fin, dias_restantes: dias(f.fecha_fin), comercial: f.comercial }))
      .sort((a, b) => a.dias_restantes - b.dias_restantes)
    const vencidos = maestro
      .filter((f) => f.fecha_fin && dias(f.fecha_fin) < 0)
      .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_fin: f.fecha_fin, dias_vencido: -dias(f.fecha_fin) }))
    const polizas_pendientes = maestro
      .filter((f) => f.requiere_poliza === "true" && f.estado_poliza !== "vigente")
      .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, tipo_poliza: f.tipo_poliza, estado_poliza: f.estado_poliza, comercial: f.comercial }))

    const historialPath = rutas(ctx.directory).historial
    const actualizados = new Set<string>()
    if (await existe(historialPath)) {
      for (const l of (await fs.readFile(historialPath, "utf8")).split("\n").filter(Boolean)) {
        const h = JSON.parse(l) as { id_contrato: string; accion: string }
        if (h.accion === "actualizado") actualizados.add(h.id_contrato)
      }
    }
    const registrados_desde_corte = maestro
      .filter((f) => f.fecha_registro > FECHA_CORTE || actualizados.has(f.id_contrato))
      .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_registro: f.fecha_registro, tipo: actualizados.has(f.id_contrato) ? "actualizado" : "nuevo" }))

    const tabla = (cab: string[], filas: string[][]) =>
      filas.length === 0 ? "_Sin registros._\n" :
        `| ${cab.join(" | ")} |\n|${cab.map(() => "---").join("|")}|\n` + filas.map((f) => `| ${f.join(" | ")} |`).join("\n") + "\n"

    const md = [
      `# Reporte de alertas de contratos`, ``, `Fecha de referencia: **${hoy}**`, ``,
      `## 1. Contratos que vencen en 60 días o menos (${vencen.length})`, ``,
      tabla(["Contrato", "Cliente", "Fecha fin", "Días", "Comercial"], vencen.map((v) => [v.id_contrato, v.cliente, v.fecha_fin, String(v.dias_restantes), v.comercial])),
      `### Ya vencidos sin acta de terminación en el maestro (${vencidos.length})`, ``,
      tabla(["Contrato", "Cliente", "Fecha fin", "Días vencido"], vencidos.map((v) => [v.id_contrato, v.cliente, v.fecha_fin, String(v.dias_vencido)])),
      `## 2. Pólizas exigidas y no vigentes (${polizas_pendientes.length})`, ``,
      tabla(["Contrato", "Cliente", "Tipo", "Estado", "Comercial"], polizas_pendientes.map((p) => [p.id_contrato, p.cliente, p.tipo_poliza, p.estado_poliza, p.comercial])),
      `## 3. Contratos registrados desde el corte del ${FECHA_CORTE} — gap cubierto (${registrados_desde_corte.length})`, ``,
      tabla(["Contrato", "Cliente", "Fecha registro", "Tipo"], registrados_desde_corte.map((r) => [r.id_contrato, r.cliente, r.fecha_registro, r.tipo])),
    ].join("\n")

    const ruta = rutas(ctx.directory).alertas
    await fs.mkdir(path.dirname(ruta), { recursive: true })
    await fs.writeFile(ruta, md)
    return {
      data: { ruta: "out/alertas.md", vencen, vencidos, polizas_pendientes, registrados_desde_corte },
      resumen: `${vencen.length} vencen · ${polizas_pendientes.length} pólizas pendientes · ${registrados_desde_corte.length} desde corte`,
    }
  },
)

// Registro de herramientas expuesto al agente: nombre visible = contratos_<export>.
export const herramientas = {
  contratos_leer_buzon: leer_buzon,
  contratos_extraer: extraer,
  contratos_validar: validar,
  contratos_registrar: registrar,
  contratos_alertas: alertas,
}
export type NombreHerramienta = keyof typeof herramientas
