// Verificación sin modelo de lenguaje: procesa los 6 mensajes del buzón llamando
// directamente a las herramientas. No necesita ninguna clave. Uso: npm run demo
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { leer_buzon, extraer, validar, registrar, alertas, leer_pdf } from "./src/tools/contratos.ts"
import { monedaDesconocida, extraerDeTexto, type Contrato } from "./src/lib/contratos-nucleo.ts"

const directory = path.dirname(fileURLToPath(import.meta.url))
const ctx = { directory, sessionId: "demo" }
const HOY = "2026-09-03"
// Determinismo: la fecha de registro usa la misma fecha simulada que las alertas.
process.env.FECHA_REFERENCIA = HOY

type Ok<T> = { ok: true; data: T }
type Err = { ok: false; error: string }
const parse = <T>(s: string) => JSON.parse(s) as Ok<T> | Err

async function main() {
  // Determinismo: out/ se limpia al inicio.
  await fs.rm(path.join(directory, "out"), { recursive: true, force: true })

  const buzon = parse<{ mensajes: { id: string; asunto: string; tiene_contrato: boolean }[] }>(await leer_buzon.execute({}, ctx))
  if (!buzon.ok) throw new Error(buzon.error)
  console.log(`\n📥 Buzón: ${buzon.data.mensajes.length} mensajes pendientes\n`)

  const pendientes: { id: string; contrato: Contrato; revisar: string[] }[] = []

  for (const m of buzon.data.mensajes) {
    console.log(`── ${m.id} · ${m.asunto}`)
    const ext = parse<{ contrato: Contrato }>(await extraer.execute({ mensaje_id: m.id }, ctx))
    const contrato = ext.ok ? ext.data.contrato : null
    if (!ext.ok) console.log(`   extracción: ${ext.error}`)

    const val = parse<{ clasificacion: string; requiere_revision: string[]; advertencias: string[]; diferencias?: object }>(
      await validar.execute({ mensaje_id: m.id }, ctx),
    )
    if (!val.ok) { console.log(`   ❌ ${val.error}\n`); continue }
    console.log(`   clasificación:  ${val.data.clasificacion}`)
    console.log(`   en revisión:    ${val.data.requiere_revision.join(", ") || "—"}`)
    if (val.data.diferencias) console.log(`   diferencias:    ${JSON.stringify(val.data.diferencias)}`)
    for (const a of val.data.advertencias) console.log(`   ⚠️  ${a}`)

    const reg = parse<{ accion: string; id_contrato: string; ruta_archivo: string | null }>(
      await registrar.execute({ mensaje_id: m.id }, ctx),
    )
    if (reg.ok) {
      console.log(`   acción:         ${reg.data.accion}${reg.data.ruta_archivo ? ` → ${reg.data.ruta_archivo}` : ""}\n`)
    } else {
      console.log(`   acción:         ⏸  NO registrado — ${reg.error}\n`)
      if (contrato) pendientes.push({ id: m.id, contrato, revisar: val.data.requiere_revision })
    }
  }

  // Seguridad (CA2/RN5): el modelo no puede colar valores propios saltándose la revisión.
  const ext6 = parse<{ contrato: Contrato }>(await extraer.execute({ mensaje_id: "msg-006" }, ctx))
  if (ext6.ok) {
    const trampa = { ...ext6.data.contrato, valor: 999999, confianza: Object.fromEntries(Object.keys(ext6.data.contrato.confianza).map((k) => [k, 1])) }
    const intento = parse(await registrar.execute({ mensaje_id: "msg-006", contrato: trampa }, ctx))
    console.log(`🛡️  Intento de registrar msg-006 con valor inventado 999999 y confianza 1 → ${intento.ok ? "❌ ACEPTADO" : `bloqueado: ${intento.error.slice(0, 110)}…`}\n`)
  }

  // Segunda pasada: el humano confirma uno de los pendientes.
  for (const p of pendientes) {
    console.log(`── Segunda pasada ${p.id}: el usuario confirma ${p.revisar.join(", ")} → valor 0, fecha_fin 2027-08-31`)
    const reg = parse<{ accion: string; id_contrato: string; ruta_archivo: string }>(
      await registrar.execute({ mensaje_id: p.id, correcciones: { valor: 0, fecha_fin: "2027-08-31" }, confirmado: true }, ctx),
    )
    console.log(reg.ok ? `   acción:         ${reg.data.accion} → ${reg.data.ruta_archivo}\n` : `   ❌ ${reg.error}\n`)
  }

  // Idempotencia: volver a leer el buzón no debe traer nada.
  const otraVez = parse<{ mensajes: unknown[] }>(await leer_buzon.execute({}, ctx))
  if (otraVez.ok) console.log(`📥 Buzón tras procesar: ${otraVez.data.mensajes.length} pendientes\n`)

  // Manejo de errores (HU-6): un caso malo no rompe el lote.
  const malo = parse(await extraer.execute({ mensaje_id: "msg-999" }, ctx))
  console.log(`🧪 Mensaje inexistente → ${malo.ok ? "ok" : `{ ok: false, error: "${malo.error}" }`}`)
  const fechaMala = parse(await alertas.execute({ hoy: "2026-13-45" }, ctx))
  console.log(`🧪 Fecha inválida     → ${fechaMala.ok ? "ok" : `{ ok: false, error: "${fechaMala.error}" }`}`)
  console.log(`🧪 Moneda desconocida → detectada: ${monedaDesconocida("SEGUNDA. VALOR. El valor es de (EUR 50.000,00).")}\n`)

  // P1 · contratos_leer_pdf: el mismo contrato de msg-001 en PDF nativo debe dar exactamente los mismos datos.
  const pdf = parse<{ texto: string; caracteres: number }>(await leer_pdf.execute({ ruta: "ejemplos/contrato-CT-2026-015.pdf" }, ctx))
  if (pdf.ok) {
    const desdePdf = extraerDeTexto(pdf.data.texto)
    const desdeTxt = extraerDeTexto(await fs.readFile(path.join(directory, "fixtures/reto-02/buzon/msg-001/contrato.txt"), "utf8"))
    const campos = ["id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza"] as const
    const distintos = campos.filter((k) => desdePdf[k] !== desdeTxt[k])
    console.log(`📄 contratos_leer_pdf(ejemplos/contrato-CT-2026-015.pdf) → ${pdf.data.caracteres} caracteres`)
    console.log(`   ${desdePdf.id_contrato} · ${desdePdf.cliente} · ${desdePdf.valor} ${desdePdf.moneda} · ${desdePdf.fecha_inicio} → ${desdePdf.fecha_fin} · póliza ${desdePdf.tipo_poliza}`)
    console.log(`   PDF vs TXT: ${distintos.length === 0 ? "✅ los 11 campos coinciden" : `❌ difieren: ${distintos.join(", ")}`}`)
  } else {
    console.log(`📄 contratos_leer_pdf → ❌ ${pdf.error}`)
  }
  const fuera = parse(await leer_pdf.execute({ ruta: "../.env" }, ctx))
  console.log(`🧪 PDF fuera del proyecto → ${fuera.ok ? "❌ permitido" : `{ ok: false, error: "${fuera.error}" }`}\n`)

  const al = parse<{ ruta: string; vencen: unknown[]; polizas_pendientes: unknown[]; registrados_desde_corte: unknown[] }>(
    await alertas.execute({ hoy: HOY }, ctx),
  )
  if (al.ok) {
    console.log(`🚨 Alertas (${HOY}) → ${al.data.ruta}`)
    console.log(`   vencen ≤ 60 días: ${al.data.vencen.length} · pólizas pendientes: ${al.data.polizas_pendientes.length} · registrados desde corte: ${al.data.registrados_desde_corte.length}\n`)
    console.log(await fs.readFile(path.join(directory, al.data.ruta), "utf8"))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
