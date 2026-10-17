/* A one-page PDF holding one JPEG, fitted to an A4 page. Small enough that
   the app doesn't need a PDF library. Pure. */

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 28

export interface PdfImage {
  /** JPEG file bytes */
  jpeg: Uint8Array
  /** pixel size of the image */
  width: number
  height: number
}

/** Page orientation and where the image goes, in PDF points. */
export function pageLayout(width: number, height: number) {
  const landscape = width > height
  const page = landscape ? { width: A4.height, height: A4.width } : A4
  const scale = Math.min((page.width - MARGIN * 2) / width, (page.height - MARGIN * 2) / height)
  const w = width * scale
  const h = height * scale
  return { page, landscape, image: { x: (page.width - w) / 2, y: (page.height - h) / 2, width: w, height: h } }
}

const n = (v: number) => (Math.round(v * 100) / 100).toString()

export function imagePdf(img: PdfImage, title = 'Diagram'): Uint8Array {
  const { page, image } = pageLayout(img.width, img.height)
  const content = `q ${n(image.width)} 0 0 ${n(image.height)} ${n(image.x)} ${n(image.y)} cm /Im0 Do Q`
  const safeTitle = title.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?')

  // objects as [header text, optional binary stream]
  const objects: [string, Uint8Array?][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`],
    [`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>`, img.jpeg],
    [`<< /Length ${content.length} >>`, new TextEncoder().encode(content)],
    [`<< /Title (${safeTitle}) /Producer (Schemasketch) >>`],
  ]

  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  let length = 0
  const push = (p: Uint8Array | string) => {
    const bytes = typeof p === 'string' ? enc.encode(p) : p
    parts.push(bytes)
    length += bytes.length
  }

  // the binary comment line tells readers the file holds 8-bit data
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
  const offsets: number[] = []
  objects.forEach(([head, stream], i) => {
    offsets.push(length)
    push(`${i + 1} 0 obj\n${head}\n`)
    if (stream) {
      push('stream\n')
      push(stream)
      push('\nendstream\n')
    }
    push('endobj\n')
  })
  const xref = length
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  for (const o of offsets) push(`${String(o).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
