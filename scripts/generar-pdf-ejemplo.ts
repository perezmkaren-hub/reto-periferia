// Genera ejemplos/contrato-CT-2026-015.pdf (PDF nativo con texto) a partir del contrato de msg-001,
// para demostrar contratos_leer_pdf sin modificar los fixtures. Uso: npm run pdf:ejemplo
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PDFDocument, StandardFonts } from "pdf-lib"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const texto = await fs.readFile(path.join(raiz, "fixtures/reto-02/buzon/msg-001/contrato.txt"), "utf8")

const pdf = await PDFDocument.create()
const fuente = await pdf.embedFont(StandardFonts.Helvetica)
const TAM = 10, MARGEN = 50, ALTO_LINEA = 14, ANCHO = 612 - 2 * MARGEN

// Parte cada párrafo en líneas que quepan en el ancho de la página.
const lineas: string[] = []
for (const parrafo of texto.split("\n")) {
  let actual = ""
  for (const palabra of parrafo.replace(/\s+/g, " ").split(" ")) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (fuente.widthOfTextAtSize(prueba, TAM) > ANCHO) { lineas.push(actual); actual = palabra } else actual = prueba
  }
  lineas.push(actual)
}

let pagina = pdf.addPage([612, 792])
let y = 792 - MARGEN
for (const linea of lineas) {
  if (y < MARGEN) { pagina = pdf.addPage([612, 792]); y = 792 - MARGEN }
  pagina.drawText(linea, { x: MARGEN, y, size: TAM, font: fuente })
  y -= ALTO_LINEA
}
await fs.mkdir(path.join(raiz, "ejemplos"), { recursive: true })
await fs.writeFile(path.join(raiz, "ejemplos/contrato-CT-2026-015.pdf"), await pdf.save())
console.log("✔ ejemplos/contrato-CT-2026-015.pdf")
