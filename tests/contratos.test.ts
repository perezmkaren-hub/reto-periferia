// Pruebas automáticas (npm test): los criterios de aceptación del PRD, sin modelo ni clave.
// Cada prueba trabaja sobre una copia aislada del proyecto en un directorio temporal.
import { test, before } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { leer_buzon, extraer, validar, registrar, alertas, leer_pdf } from "../src/tools/contratos.ts"
import { extraerDeTexto, monedaDesconocida, type Contrato } from "../src/lib/contratos-nucleo.ts"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
type R = { ok: boolean; data?: Record<string, unknown> & { clasificacion?: string; requiere_revision?: string[]; accion?: string }; error?: string }
const parse = (s: string) => JSON.parse(s) as R

async function proyectoAislado() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reto02-"))
  await fs.cp(path.join(raiz, "fixtures"), path.join(dir, "fixtures"), { recursive: true })
  await fs.cp(path.join(raiz, "ejemplos"), path.join(dir, "ejemplos"), { recursive: true })
  return { directory: dir, sessionId: "test" }
}

before(() => { process.env.FECHA_REFERENCIA = "2026-09-03" })

test("HU-1: el buzón lista los 6 mensajes y marca la cotización como rechazada", async () => {
  const ctx = await proyectoAislado()
  const r = parse(await leer_buzon.execute({}, ctx))
  const mensajes = r.data?.mensajes as { id: string; tiene_contrato: boolean; clasificacion?: string }[]
  assert.equal(mensajes.length, 6)
  const m5 = mensajes.find((m) => m.id === "msg-005")
  assert.equal(m5?.tiene_contrato, false)
  assert.equal(m5?.clasificacion, "rechazado")
})

test("§7.4: los 6 casos se clasifican como exige el PRD", async () => {
  const ctx = await proyectoAislado()
  const esperado: Record<string, string> = {
    "msg-001": "nuevo", "msg-002": "nuevo", "msg-003": "actualizacion",
    "msg-004": "duplicado", "msg-005": "rechazado", "msg-006": "nuevo",
  }
  for (const [id, clase] of Object.entries(esperado)) {
    const v = parse(await validar.execute({ mensaje_id: id }, ctx))
    assert.equal(v.data?.clasificacion, clase, id)
  }
  const v6 = parse(await validar.execute({ mensaje_id: "msg-006" }, ctx))
  assert.deepEqual(v6.data?.requiere_revision, ["valor", "fecha_fin"])
})

test("HU-4 / RN1–RN3: registra nuevos, actualiza el otrosí con historial y no escribe duplicados", async () => {
  const ctx = await proyectoAislado()
  for (const id of ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005"]) {
    assert.equal(parse(await registrar.execute({ mensaje_id: id }, ctx)).ok, true, id)
  }
  const maestro = await fs.readFile(path.join(ctx.directory, "out/sharepoint/maestro-contratos.csv"), "utf8")
  assert.match(maestro, /CT-2026-015,.*,pendiente,/)
  assert.match(maestro, /CT-2026-016,.*,no_aplica,/)
  assert.match(maestro, /CT-2026-011,.*,520000,PEN,2026-05-02,2027-11-01/)
  assert.equal(maestro.match(/^CT-2026-012,/gm)?.length, 1, "el duplicado no debe crear otra fila")
  const historial = await fs.readFile(path.join(ctx.directory, "out/sharepoint/historial.jsonl"), "utf8")
  assert.match(historial, /"id_contrato":"CT-2026-011","accion":"actualizado"/)
  await fs.access(path.join(ctx.directory, "out/sharepoint/Contratos/2026/industrias-delta/CT-2026-015.txt"))
})

test("RN5 / CA3: msg-006 no se registra sin confirmación y sí con confirmación", async () => {
  const ctx = await proyectoAislado()
  const sin = parse(await registrar.execute({ mensaje_id: "msg-006" }, ctx))
  assert.equal(sin.ok, false)
  assert.match(sin.error ?? "", /^requiere revisión: valor, fecha_fin/)
  const con = parse(await registrar.execute({ mensaje_id: "msg-006", confirmado: true, correcciones: { valor: 0, fecha_fin: "2027-08-31" } }, ctx))
  assert.equal(con.data?.accion, "insertado")
})

test("CA2 (seguridad): el modelo no puede colar un valor inventado", async () => {
  const ctx = await proyectoAislado()
  const ext = parse(await extraer.execute({ mensaje_id: "msg-006" }, ctx))
  const contrato = ext.data?.contrato as Contrato
  const trampa: Contrato = { ...contrato, valor: 999999, confianza: Object.fromEntries(Object.keys(contrato.confianza).map((k) => [k, 1])) }
  const r = parse(await registrar.execute({ mensaje_id: "msg-006", contrato: trampa }, ctx))
  assert.equal(r.ok, false)
  assert.match(r.error ?? "", /no coinciden con el documento/)
  const correccionSinConfirmar = parse(await registrar.execute({ mensaje_id: "msg-006", correcciones: { valor: 1 } }, ctx))
  assert.equal(correccionSinConfirmar.ok, false)
})

test("HU-5: alertas con las tres secciones y fecha como argumento", async () => {
  const ctx = await proyectoAislado()
  const r = parse(await alertas.execute({ hoy: "2026-09-03" }, ctx))
  const vencen = r.data?.vencen as { id_contrato: string }[]
  assert.deepEqual(vencen.map((v) => v.id_contrato), ["CT-2026-009", "CT-2026-004"])
  const md = await fs.readFile(path.join(ctx.directory, "out/alertas.md"), "utf8")
  for (const seccion of ["## 1.", "## 2.", "## 3."]) assert.ok(md.includes(seccion), seccion)
})

test("HU-6: errores tipados, nunca excepciones", async () => {
  const ctx = await proyectoAislado()
  assert.match(parse(await extraer.execute({ mensaje_id: "msg-999" }, ctx)).error ?? "", /No existe/)
  assert.match(parse(await extraer.execute({ mensaje_id: "../../etc" }, ctx)).error ?? "", /inválido/)
  assert.match(parse(await alertas.execute({ hoy: "2026-13-45" }, ctx)).error ?? "", /Fecha inválida/)
  assert.equal(parse(await alertas.execute({ hoy: 42 } as never, ctx)).ok, false)
  assert.equal(monedaDesconocida("SEGUNDA. VALOR. Por (EUR 50.000,00)."), "EUR")
})

test("RN6 / RN7: el fixture no se modifica y toda llamada queda en el log", async () => {
  const ctx = await proyectoAislado()
  const original = await fs.readFile(path.join(ctx.directory, "fixtures/reto-02/maestro-contratos.csv"), "utf8")
  await registrar.execute({ mensaje_id: "msg-001" }, ctx)
  assert.equal(await fs.readFile(path.join(ctx.directory, "fixtures/reto-02/maestro-contratos.csv"), "utf8"), original)
  const log = (await fs.readFile(path.join(ctx.directory, "out/log.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>)
  for (const k of ["ts", "herramienta", "mensaje_id", "ok", "resumen"]) assert.ok(k in log[0], k)
})

test("P1: el PDF de ejemplo da los mismos datos que el .txt y no lee fuera del proyecto", async () => {
  const ctx = await proyectoAislado()
  const pdf = parse(await leer_pdf.execute({ ruta: "ejemplos/contrato-CT-2026-015.pdf" }, ctx))
  const desdePdf = extraerDeTexto(String(pdf.data?.texto))
  const desdeTxt = extraerDeTexto(await fs.readFile(path.join(ctx.directory, "fixtures/reto-02/buzon/msg-001/contrato.txt"), "utf8"))
  const { confianza: _a, ...a } = desdePdf
  const { confianza: _b, ...b } = desdeTxt
  assert.deepEqual(a, b)
  assert.equal(parse(await leer_pdf.execute({ ruta: "../.env" }, ctx)).ok, false)
})
