// Herramientas del agente "Registro de Contratos Vigentes".
// Cada export de este archivo es una herramienta: { description, args (zod), execute(args, ctx) → string JSON }.
// El nombre que ve el modelo es contratos_<export>. Nunca lanzan: devuelven { ok: false, error }.
import { z } from "zod"
import { promises as fs } from "node:fs"
import path from "node:path"
import { COLUMNAS, type Comercial, type Contrato, ContratoSchema, CorreccionesSchema, FECHA_CORTE, type Fila, LEYENDA_SEMAFORO, MONEDAS, anexar, camposAlterados, clasificar, contratoDelMensaje, esFechaValida, escribirMaestro, existe, extraerDeTexto, fecha, fechaHoy, herramienta, leerAdjuntoContrato, leerCorreo, leerMaestro, leerProcesados, marcarProcesado, monedaDesconocida, rutas, slug, tieneContrato } from "../lib/contratos-nucleo.ts"

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
      const conContrato = tieneContrato(c)
      mensajes.push({
        id: c.id, de: c.de, asunto: c.asunto, fecha: c.fecha, adjuntos: c.adjuntos, tiene_contrato: conContrato,
        ...(conContrato ? {} : { clasificacion: "rechazado", motivo: `Sin adjunto de contrato (adjuntos: ${c.adjuntos.join(", ")})` }),
      })
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
    const moneda = monedaDesconocida(adjunto.texto)
    if (moneda) throw new Error(`Moneda desconocida en el contrato: ${moneda}. Monedas válidas: ${MONEDAS.join(", ")}`)
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
    contrato: ContratoSchema.nullable().optional().describe("Opcional y solo de referencia: los valores siempre se toman del documento; si difieren, se marca revisión"),
  },
  async ({ mensaje_id, contrato }, ctx) => {
    const correo = await leerCorreo(ctx.directory, mensaje_id)
    // Los valores salen SIEMPRE del documento. Si el modelo envía un contrato distinto, se reporta como conflicto.
    const c = await contratoDelMensaje(ctx.directory, correo)
    const v = await clasificar(ctx.directory, correo, c)
    const alterados = contrato ? camposAlterados(c, contrato) : []
    if (alterados.length) v.requiere_revision.push(...alterados.map((k) => `${k} (el valor enviado no coincide con el documento)`))
    return { data: v, resumen: `${v.clasificacion}${v.requiere_revision.length ? ` · revisar: ${v.requiere_revision.join(", ")}` : ""}` }
  },
)

export const registrar = herramienta(
  "registrar",
  "Registra o actualiza el contrato en el maestro de SharePoint y archiva el documento; si hay campos en revisión solo escribe con confirmado=true.",
  {
    mensaje_id: z.string().describe("Id del mensaje del buzón"),
    contrato: ContratoSchema.nullable().optional().describe("Opcional y solo de referencia: los valores siempre se toman del documento; si difieren, se marca revisión"),
    correcciones: CorreccionesSchema.optional().describe("Valores que el usuario confirmó o corrigió en el chat, solo con confirmado=true"),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente los campos en revisión"),
  },
  async ({ mensaje_id, contrato, correcciones, confirmado }, ctx) => {
    const dir = ctx.directory
    const correo = await leerCorreo(dir, mensaje_id)
    const procesados = await leerProcesados(dir)
    if (procesados[mensaje_id]) throw new Error(`El mensaje ${mensaje_id} ya fue procesado (${procesados[mensaje_id]})`)

    // Se vuelve a validar aquí: registrar nunca confía en una clasificación hecha antes.
    // Los valores salen SIEMPRE del documento; un humano solo puede cambiarlos vía correcciones + confirmado.
    const base = await contratoDelMensaje(dir, correo)
    const alterados = contrato ? camposAlterados(base, contrato) : []
    if (alterados.length) throw new Error(`requiere revisión: los valores enviados en contrato no coinciden con el documento (${alterados.join(", ")}). Use correcciones con confirmado=true tras la aprobación del usuario`)
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
    const hoy = fechaHoy()

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
      LEYENDA_SEMAFORO, ``,
      `## 1. Contratos que vencen en 60 días o menos (${vencen.length})`, ``,
      tabla(["", "Contrato", "Cliente", "Fecha fin", "Días", "Comercial"], vencen.map((v) => [v.dias_restantes <= 30 ? "🔴" : "🟡", v.id_contrato, v.cliente, v.fecha_fin, String(v.dias_restantes), v.comercial])),
      `### Ya vencidos sin acta de terminación en el maestro (${vencidos.length})`, ``,
      tabla(["", "Contrato", "Cliente", "Fecha fin", "Días vencido"], vencidos.map((v) => ["🔴", v.id_contrato, v.cliente, v.fecha_fin, String(v.dias_vencido)])),
      `## 2. Pólizas exigidas y no vigentes (${polizas_pendientes.length})`, ``,
      tabla(["", "Contrato", "Cliente", "Tipo", "Estado", "Comercial"], polizas_pendientes.map((p) => ["🔴", p.id_contrato, p.cliente, p.tipo_poliza, p.estado_poliza, p.comercial])),
      `## 3. Contratos registrados desde el corte del ${FECHA_CORTE} — gap cubierto (${registrados_desde_corte.length})`, ``,
      tabla(["", "Contrato", "Cliente", "Fecha registro", "Tipo"], registrados_desde_corte.map((r) => ["🟢", r.id_contrato, r.cliente, r.fecha_registro, r.tipo])),
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
