// Genera modulo/ a partir de las MISMAS fuentes que usa la aplicación (una sola fuente de verdad):
//   agent/prompt.md                     → modulo/agent.md                          (+ frontmatter)
//   src/tools/contratos.ts              → modulo/tools/contratos.ts                (copia exacta: solo las herramientas)
//   src/lib/contratos-nucleo.ts         → modulo/lib/contratos-nucleo.ts           (copia exacta: núcleo sin servidor)
//   src/knowledge/registro-contratos.md → modulo/skill/registro-contratos/SKILL.md (+ frontmatter)
// Uso: npm run modulo            (genera)
//      npm run modulo:verificar  (falla si modulo/ difiere de las fuentes)
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const leer = (p: string) => fs.readFile(path.join(raiz, p), "utf8")

async function piezas(): Promise<Record<string, string>> {
  const prompt = await leer("agent/prompt.md")
  const herramientas = await leer("src/tools/contratos.ts")
  const nucleo = await leer("src/lib/contratos-nucleo.ts")
  const conocimiento = await leer("src/knowledge/registro-contratos.md")
  return {
    "modulo/agent.md": [
      "---",
      "description: Registra contratos vigentes desde el buzón único; extrae, valida, archiva y alerta, pidiendo confirmación humana para campos dudosos.",
      "mode: primary",
      "permission:",
      "  edit: deny",
      "  bash: deny",
      "---",
      "",
      prompt,
    ].join("\n"),
    "modulo/tools/contratos.ts": herramientas,
    "modulo/lib/contratos-nucleo.ts": nucleo,
    "modulo/skill/registro-contratos/SKILL.md": [
      "---",
      "name: registro-contratos",
      "description: Conocimiento del proceso de registro de contratos vigentes de Periferia (reglas RN1–RN5, campos del maestro, pólizas, alertas y dueños). Úsalo al procesar el buzón de contratos o responder sobre vencimientos y pólizas.",
      "---",
      "",
      conocimiento,
    ].join("\n"),
  }
}

async function main() {
  const verificar = process.argv.includes("--verificar")
  const diferencias: string[] = []
  for (const [destino, contenido] of Object.entries(await piezas())) {
    const ruta = path.join(raiz, destino)
    if (verificar) {
      const actual = await fs.readFile(ruta, "utf8").catch(() => null)
      if (actual !== contenido) diferencias.push(destino)
    } else {
      await fs.mkdir(path.dirname(ruta), { recursive: true })
      await fs.writeFile(ruta, contenido)
      console.log(`✔ ${destino}`)
    }
  }
  if (verificar) {
    if (diferencias.length) {
      console.error(`✗ modulo/ difiere de las fuentes: ${diferencias.join(", ")}. Ejecuta npm run modulo`)
      process.exit(1)
    }
    console.log("✔ modulo/ es idéntico a las piezas que usa la aplicación")
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
