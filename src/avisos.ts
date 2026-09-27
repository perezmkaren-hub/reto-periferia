// Avisos proactivos: las alertas llegan a quien las necesita, sin que nadie pregunte.
// En producción la "bandeja de salida" se reemplaza por envío real (Microsoft Graph: correo o Teams).
import { promises as fs } from "node:fs"
import path from "node:path"
import { alertas } from "./tools/contratos.ts"

type Fila = { id_contrato: string; cliente: string; fecha_fin?: string; dias_restantes?: number; dias_vencido?: number; tipo_poliza?: string; estado_poliza?: string; comercial?: string }
type DatosAlertas = { vencen: Fila[]; vencidos: Fila[]; polizas_pendientes: Fila[]; registrados_desde_corte: Fila[] }

export type Avisos = {
  ok: boolean
  hoy: string
  criticos: number
  atencion: number
  resumen: { vencidos: number; vencen_30: number; vencen_60: number; polizas_pendientes: number; registrados_desde_corte: number }
  correos_generados?: string[]
  error?: string
}

export async function generarAvisos(directorio: string, hoy: string, enviarCorreos = false): Promise<Avisos> {
  const r = JSON.parse(await alertas.execute({ hoy }, { directory: directorio, sessionId: "avisos" })) as
    { ok: true; data: DatosAlertas } | { ok: false; error: string }
  const vacio = { vencidos: 0, vencen_30: 0, vencen_60: 0, polizas_pendientes: 0, registrados_desde_corte: 0 }
  if (!r.ok) return { ok: false, hoy, criticos: 0, atencion: 0, resumen: vacio, error: r.error }

  const d = r.data
  const vencen30 = d.vencen.filter((v) => (v.dias_restantes ?? 99) <= 30)
  const resumen = {
    vencidos: d.vencidos.length,
    vencen_30: vencen30.length,
    vencen_60: d.vencen.length - vencen30.length,
    polizas_pendientes: d.polizas_pendientes.length,
    registrados_desde_corte: d.registrados_desde_corte.length,
  }
  const avisos: Avisos = {
    ok: true, hoy, resumen,
    criticos: resumen.vencidos + resumen.vencen_30 + resumen.polizas_pendientes,
    atencion: resumen.vencen_60,
  }
  if (enviarCorreos) avisos.correos_generados = await bandejaDeSalida(directorio, hoy, d)
  return avisos
}

// Escribe los correos que se enviarían: uno a gerencia (consolidado) y uno por comercial con sus pendientes.
async function bandejaDeSalida(directorio: string, hoy: string, d: DatosAlertas): Promise<string[]> {
  const dir = path.join(directorio, "out/bandeja-salida", hoy)
  await fs.mkdir(dir, { recursive: true })
  const linea = (f: Fila) =>
    `- ${f.id_contrato} · ${f.cliente}` +
    (f.dias_vencido !== undefined ? ` · 🔴 vencido hace ${f.dias_vencido} días` : "") +
    (f.dias_restantes !== undefined ? ` · ${f.dias_restantes <= 30 ? "🔴" : "🟡"} vence en ${f.dias_restantes} días (${f.fecha_fin})` : "") +
    (f.estado_poliza ? ` · 🔴 póliza ${f.tipo_poliza} ${f.estado_poliza}` : "")

  const archivos: string[] = []
  const gerencia = [
    `Para: gerencia@periferia-ficticia.com`, `Asunto: [Contratos] Resumen diario ${hoy}`, ``,
    `Vencidos sin acta: ${d.vencidos.length} · Vencen en ≤ 60 días: ${d.vencen.length} · Pólizas pendientes: ${d.polizas_pendientes.length}`, ``,
    ...[...d.vencidos, ...d.vencen, ...d.polizas_pendientes].map(linea), ``,
    `Detalle completo: out/alertas.md`,
  ].join("\n")
  await fs.writeFile(path.join(dir, "gerencia.md"), gerencia)
  archivos.push(`out/bandeja-salida/${hoy}/gerencia.md`)

  const porComercial = new Map<string, Fila[]>()
  for (const f of [...d.vencen, ...d.polizas_pendientes]) {
    if (!f.comercial) continue
    porComercial.set(f.comercial, [...(porComercial.get(f.comercial) ?? []), f])
  }
  for (const [comercial, filas] of porComercial) {
    const nombre = comercial.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    await fs.writeFile(path.join(dir, `${nombre}.md`), [
      `Para: ${comercial}`, `Asunto: [Contratos] Tienes ${filas.length} pendiente(s) al ${hoy}`, ``,
      `Hola, estos contratos a tu cargo requieren gestión (prórroga, acta de terminación o póliza):`, ``,
      ...filas.map(linea), ``, `Responde enviando el documento al buzón contratos@periferia-ficticia.com.`,
    ].join("\n"))
    archivos.push(`out/bandeja-salida/${hoy}/${nombre}.md`)
  }
  return archivos
}
