// Minimal dependency-free PDF writer (Helvetica/Courier text, landscape A4) for report export.
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7e]/g, '?')
export function buildPdf({ title, subtitle, columns, rows, summary }) {
  const W = 842, H = 595, M = 36, LH = 14, perPage = Math.floor((H - 2 * M - 70) / LH)
  const colW = (W - 2 * M) / columns.length
  const cut = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 2) + '..' : s }
  const chars = Math.max(6, Math.floor(colW / 5.4))
  const pages = []
  const lines = rows.length ? rows : [{}]
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage))
  const objs = []
  const add = (s) => { objs.push(s); return objs.length }
  const catalog = add(''), pagesObj = add(''), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'), bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>')
  const kids = []
  pages.forEach((pg, pi) => {
    let c = ''
    const text = (x, y, t, f = 'F1', size = 9) => { c += `BT /${f} ${size} Tf ${x} ${y} Td (${esc(t)}) Tj ET\n` }
    text(M, H - M, 'LinuxWatch  |  ' + title, 'F2', 14)
    text(M, H - M - 16, subtitle, 'F1', 9)
    if (pi === 0 && summary?.length) text(M, H - M - 30, summary.map(([k, v]) => `${k}: ${v}`).join('   |   '), 'F1', 9)
    let y = H - M - 56
    columns.forEach(([, label], ci) => text(M + ci * colW, y, cut(label.toUpperCase(), chars), 'F2', 8))
    c += `${M} ${y - 4} m ${W - M} ${y - 4} l S\n`
    y -= LH
    pg.forEach((row) => { columns.forEach(([k], ci) => text(M + ci * colW, y, cut(row[k] ?? '', chars), 'F1', 8)); y -= LH })
    text(M, 20, `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC - page ${pi + 1}/${pages.length}`, 'F1', 7)
    const content = add(`<< /Length ${c.length} >>\nstream\n${c}endstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> >>`))
  })
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n'; const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`
  return out
}
