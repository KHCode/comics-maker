// Run with: node test/javascript/pdf.test.mjs
//
// Beyond checking buildPdfBytes' own text structure, this also hands the
// output to `pdfinfo`/`pdftoppm` (poppler, a real independent PDF reader,
// not this codebase's own logic) to confirm the file is actually valid and
// renders each page's image at the right size and color — the same
// "don't trust it until you've actually looked at the rendered output"
// discipline the PNG export bugs (see editor_controller.js's own export
// comments) were caught with.

import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildPdfBytes } from "../../app/javascript/kapow/pdf.js"

const RED_JPEG = readFileSync(new URL("../fixtures/files/pdf_page_red.jpg", import.meta.url))
const BLUE_JPEG = readFileSync(new URL("../fixtures/files/pdf_page_blue.jpg", import.meta.url))

function pdfText(bytes) {
  return Buffer.from(bytes).toString("latin1")
}

test("buildPdfBytes produces a well-formed single-page PDF", () => {
  const bytes = buildPdfBytes([ { jpegBytes: RED_JPEG, width: 40, height: 30 } ])
  const text = pdfText(bytes)

  assert.ok(text.startsWith("%PDF-1.4"))
  assert.ok(text.endsWith("%%EOF"))
  assert.equal((text.match(/\/Type \/Page \/Parent/g) ?? []).length, 1)
  assert.match(text, /\/MediaBox \[0 0 40 30\]/)
  assert.match(text, /\/Filter \/DCTDecode/)
})

test("buildPdfBytes assembles multiple pages in order, each keeping its own dimensions", () => {
  const bytes = buildPdfBytes([
    { jpegBytes: RED_JPEG, width: 40, height: 30 },
    { jpegBytes: BLUE_JPEG, width: 20, height: 50 }
  ])
  const text = pdfText(bytes)

  assert.equal((text.match(/\/Type \/Page \/Parent/g) ?? []).length, 2)
  assert.equal((text.match(/\/Type \/Pages /g) ?? []).length, 1)
  assert.match(text, /\/Count 2/)
  assert.match(text, /\/MediaBox \[0 0 40 30\]/)
  assert.match(text, /\/MediaBox \[0 0 20 50\]/)
})

// Every object's recorded xref offset should point at that exact object's
// own "N 0 obj" header — not just a plausible-looking number. A single
// off-by-one in a /Length or an offset would still often "look like" a
// PDF, but poppler (below) would refuse to open it, so this is checked
// directly too as a more targeted first failure signal.
test("buildPdfBytes' xref table offsets point at the right objects", () => {
  const bytes = buildPdfBytes([
    { jpegBytes: RED_JPEG, width: 40, height: 30 },
    { jpegBytes: BLUE_JPEG, width: 20, height: 50 }
  ])
  const text = pdfText(bytes)

  const xrefMatch = text.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/)
  assert.ok(xrefMatch, "expected an xref table")
  const [ , countStr, entriesBlock ] = xrefMatch
  const entries = entriesBlock.split("\n").filter(Boolean)
  assert.equal(entries.length, Number(countStr))

  // Entry 0 is always the free-list head; objects 1..N-1 are real.
  entries.slice(1).forEach((entry, i) => {
    const objectNum = i + 1
    const offset = Number(entry.slice(0, 10))
    const atOffset = text.slice(offset, offset + `${objectNum} 0 obj`.length)
    assert.equal(atOffset, `${objectNum} 0 obj`)
  })
})

test("a poppler-parsed round trip confirms the PDF is valid and renders each page at the right size/color", () => {
  const bytes = buildPdfBytes([
    { jpegBytes: RED_JPEG, width: 40, height: 30 },
    { jpegBytes: BLUE_JPEG, width: 20, height: 50 }
  ])

  const dir = mkdtempSync(join(tmpdir(), "kapow-pdf-test-"))
  const pdfPath = join(dir, "out.pdf")
  writeFileSync(pdfPath, bytes)

  const info = execFileSync("pdfinfo", [ pdfPath ], { encoding: "utf8" })
  assert.match(info, /Pages:\s+2/)

  const ppmPrefix = join(dir, "page")
  execFileSync("pdftoppm", [ "-r", "72", pdfPath, ppmPrefix ])

  const page1 = readFileSync(`${ppmPrefix}-1.ppm`)
  const page2 = readFileSync(`${ppmPrefix}-2.ppm`)

  // A PPM's header is plain ASCII ("P6\n<width> <height>\n255\n") followed
  // immediately by raw RGB triples — parse just enough to sample one pixel
  // near the middle of each page.
  function samplePixel(ppmBuffer) {
    const header = ppmBuffer.toString("latin1", 0, 40)
    const match = header.match(/^P6\s+(\d+)\s+(\d+)\s+255\n/)
    const [ , widthStr, heightStr ] = match
    const width = Number(widthStr)
    const height = Number(heightStr)
    const dataStart = header.indexOf("255\n") + 4
    const midOffset = dataStart + (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3
    return { width, height, r: ppmBuffer[midOffset], g: ppmBuffer[midOffset + 1], b: ppmBuffer[midOffset + 2] }
  }

  const pixel1 = samplePixel(page1)
  assert.equal(pixel1.width, 40)
  assert.equal(pixel1.height, 30)
  assert.ok(pixel1.r > 150 && pixel1.g < 100 && pixel1.b < 100, `expected page 1 to render red, got rgb(${pixel1.r},${pixel1.g},${pixel1.b})`)

  const pixel2 = samplePixel(page2)
  assert.equal(pixel2.width, 20)
  assert.equal(pixel2.height, 50)
  assert.ok(pixel2.b > 150 && pixel2.r < 100 && pixel2.g < 100, `expected page 2 to render blue, got rgb(${pixel2.r},${pixel2.g},${pixel2.b})`)
})
