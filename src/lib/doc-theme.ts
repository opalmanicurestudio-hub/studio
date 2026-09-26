// src/lib/doc-theme.ts
//
// ONE LOOK FOR EVERYTHING PRINTED — reports, letters, transcripts, the
// student file, tests and worksheets. Matches the landing page: Plus Jakarta
// Sans, light headings with a semibold word for emphasis, stone ink
// (#1c1917) on warm paper (#f7f5f2), soft rounded panels, the school's name
// and logo on top, a quiet footer. Opens a clean page and prints (or "Save as
// PDF" from the print dialog).

export const esc = (v: any) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export const DOC_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
@page { size: letter; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #1c1917; background: #fff; margin: 0; font-size: 12.5px; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { max-width: 820px; margin: 0 auto; padding: 28px 24px 40px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid #e7e5e4; margin-bottom: 22px; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 300; letter-spacing: -0.01em; }
.brand b { font-weight: 600; } .brand img { height: 34px; width: 34px; border-radius: 999px; object-fit: cover; }
.meta { text-align: right; font-size: 11px; color: #78716c; }
h1 { font-size: 30px; font-weight: 300; letter-spacing: -0.02em; line-height: 1.15; margin: 0 0 4px; } h1 b { font-weight: 600; }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.22em; color: #78716c; font-weight: 500; margin: 26px 0 8px; }
.sub { color: #57534e; margin: 0 0 18px; }
.panel { background: #f7f5f2; border-radius: 16px; padding: 14px 16px; margin: 8px 0; break-inside: avoid; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; } .grid3 { grid-template-columns: repeat(3, 1fr); } .grid2 { grid-template-columns: repeat(2, 1fr); }
.stat { background: #f7f5f2; border-radius: 14px; padding: 10px 12px; } .stat .v { font-size: 22px; font-weight: 600; } .stat .l { font-size: 10.5px; color: #78716c; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 11.5px; } thead { display: table-header-group; }
th { text-align: left; font-weight: 600; background: #f5f5f4; padding: 7px 8px; } td { padding: 6px 8px; border-bottom: 1px solid #eeecea; vertical-align: top; } tr { break-inside: avoid; }
.ok { color: #047857; font-weight: 600; } .warn { color: #b45309; font-weight: 600; } .bad { color: #b91c1c; font-weight: 600; } .muted { color: #78716c; }
.pill { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 10.5px; background: #f5f5f4; }
.sig { display: flex; gap: 28px; margin-top: 44px; } .sig div { flex: 1; border-top: 1px solid #1c1917; padding-top: 6px; font-size: 11px; }
.foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e7e5e4; font-size: 10.5px; color: #78716c; display: flex; justify-content: space-between; gap: 12px; }
.break { break-before: page; }
.answer-line { border-bottom: 1px solid #a8a29e; height: 26px; }
@media screen { body { background: #f7f5f2; } .page { background: #fff; margin: 24px auto; border-radius: 20px; box-shadow: 0 20px 60px -30px rgba(28,25,23,.35); } }
`;

export interface DocBrand { name: string; logoUrl?: string | null; color?: string | null; address?: string | null }

/** Wrap content in the ClarityFlow document look and open it to print / save as PDF. */
export function printDocument(opts: { title: string; brand: DocBrand; body: string; footerNote?: string; autoPrint?: boolean }) {
  const w = window.open('', '_blank'); if (!w) return;
  const accent = opts.brand.color || '#1c1917';
  const [first, ...rest] = String(opts.brand.name || 'Academy').split(' ');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>${DOC_CSS} h1 b, .accent { color: ${accent}; }</style></head><body><div class="page">
    <div class="head"><div class="brand">${opts.brand.logoUrl ? `<img src="${esc(opts.brand.logoUrl)}" alt="">` : ''}<span>${esc(first)} <b>${esc(rest.join(' ') || 'Academy')}</b></span></div>
      <div class="meta">${opts.brand.address ? `${esc(opts.brand.address)}<br>` : ''}Printed ${esc(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</div></div>
    ${opts.body}
    <div class="foot"><span>${esc(opts.footerNote || 'Records kept in ClarityFlow with a tamper-evident audit trail.')}</span><span>${esc(opts.brand.name)}</span></div>
  </div>${opts.autoPrint === false ? '' : '<script>document.fonts && document.fonts.ready ? document.fonts.ready.then(()=>setTimeout(()=>print(),200)) : setTimeout(()=>print(),600)</script>'}</body></html>`);
  w.document.close();
}

/** "Hours <b>report</b>" — a light heading with one semibold word, like the landing page. */
export const heading = (light: string, bold: string) => `<h1>${esc(light)} <b>${esc(bold)}</b></h1>`;

/**
 * Simple text → HTML for school documents: "# Heading", "## Subheading",
 * "- bullet", "**bold**", blank line = new paragraph. Everything is escaped
 * first, so nothing in a document can run as code.
 */
export function mdLite(text: string) {
  const out: string[] = []; let list = false;
  for (const raw of String(text || '').split('\n')) {
    const line = esc(raw).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[\[(.+?)\]\]/g, '<mark style="background:#fef3c7;padding:0 3px;border-radius:4px">[$1]</mark>');
    const t = line.trim();
    if (/^-\s+/.test(t)) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${t.replace(/^-\s+/, '')}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (/^##\s+/.test(t)) out.push(`<h3>${t.replace(/^##\s+/, '')}</h3>`);
    else if (/^#\s+/.test(t)) out.push(`<h2>${t.replace(/^#\s+/, '')}</h2>`);
    else if (t) out.push(`<p>${t}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}
