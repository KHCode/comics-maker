// Pure, dependency-free multi-page PDF assembly for Phase 9's PDF export
// (see editor_controller.js#exportPdf). No PDF library is pinned in the
// importmap, and none is needed: a PDF whose every page is just one full-
// bleed JPEG image is a tiny, well-documented structure — a handful of
// plain-ASCII indirect objects plus an xref table — so it's cheaper and more
// transparent to write directly here than to vendor a general-purpose PDF
// library for this one narrow use.
//
// Each page's raster comes in as JPEG bytes (not PNG) specifically so it can
// be embedded with the /DCTDecode filter and copied into the file byte-for-
// byte, unmodified — a PNG would need its own re-encoding into a PDF-
// compatible filter (FlateDecode over raw pixel data), which buys nothing
// here since the export is already a flattened raster, not something a user
// needs losslessly.
//
// The PDF spec doesn't attach any physical unit to MediaBox — it's just
// "the page is this many units wide/tall, and 1 unit is treated as 1/72
// inch by convention." Using each page's own pixel dimensions directly as
// its MediaBox means the embedded image fills the page exactly, so every
// page's own aspect ratio (comic/manga's portrait, newspaper strip's wide
// letterbox, webtoon's tall scroll) is preserved automatically — there's no
// separate "fit to a fixed paper size" step to get wrong.

const PDF_HEADER = "%PDF-1.4\n"

function encode(str) {
  return new TextEncoder().encode(str)
}

// Fixed-width (20-byte) xref entry, per the PDF spec's own requirement.
function xrefEntry(offset) {
  return `${String(offset).padStart(10, "0")} 00000 n \n`
}

// pages: [{ jpegBytes: Uint8Array, width: Number, height: Number }], already
// in the order they should appear in the file (i.e. page order).
export function buildPdfBytes(pages) {
  const parts = []
  let byteLength = 0

  function push(bytes) {
    parts.push(bytes)
    byteLength += bytes.length
  }

  // Object numbers: 1 = catalog, 2 = pages tree; each page then gets three
  // objects (content stream, image, page dict), allocated so that writing
  // objects in ascending number order (1, 2, 3, 4, 5, ...) is also a valid
  // writing order (nothing references a not-yet-assigned number) — object
  // *output* order in the file never has to match this, but keeping them
  // the same avoids any need to reorder anything.
  const pageObjNums = pages.map((_page, i) => 5 + i * 3)
  const catalogObjNum = 1
  const pagesObjNum = 2

  const offsets = new Array(pageObjNums.at(-1) ?? pagesObjNum).fill(0)

  function writeObject(num, bodyBytesArray) {
    offsets[num - 1] = byteLength
    push(encode(`${num} 0 obj\n`))
    bodyBytesArray.forEach(push)
    push(encode("endobj\n"))
  }

  push(encode(PDF_HEADER))

  writeObject(catalogObjNum, [ encode(`<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>\n`) ])

  writeObject(pagesObjNum, [
    encode(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>\n`)
  ])

  pages.forEach((page, i) => {
    const contentObjNum = 3 + i * 3
    const imageObjNum = 4 + i * 3
    const pageObjNum = pageObjNums[i]

    const content = encode(`q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q`)
    writeObject(contentObjNum, [
      encode(`<< /Length ${content.length} >>\nstream\n`),
      content,
      encode("\nendstream\n")
    ])

    writeObject(imageObjNum, [
      encode(
        "<< /Type /XObject /Subtype /Image "
        + `/Width ${page.width} /Height ${page.height} `
        + "/ColorSpace /DeviceRGB /BitsPerComponent 8 "
        + `/Filter /DCTDecode /Length ${page.jpegBytes.length} >>\nstream\n`
      ),
      page.jpegBytes,
      encode("\nendstream\n")
    ])

    writeObject(pageObjNum, [
      encode(
        `<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 ${page.width} ${page.height}] `
        + `/Resources << /XObject << /Im0 ${imageObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>\n`
      )
    ])
  })

  const xrefOffset = byteLength
  const objectCount = offsets.length + 1 // + the free-list head, object 0
  push(encode(`xref\n0 ${objectCount}\n0000000000 65535 f \n`))
  offsets.forEach((offset) => push(encode(xrefEntry(offset))))
  push(encode(`trailer\n<< /Size ${objectCount} /Root ${catalogObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`))

  const bytes = new Uint8Array(byteLength)
  let cursor = 0
  for (const part of parts) {
    bytes.set(part, cursor)
    cursor += part.length
  }
  return bytes
}
