// src/lib/payroll-checks.ts — PRINTED PAYCHECKS (Money › Payday › Print checks; design boards "Print checks" and "A
// printed paycheck"). Each check on a sheet of voucher check paper (the check and two stubs: one for the person, one for
// the business), with the bank's numbers already printed on the paper: ClarityFlow prints the date, the payee, the
// amount in figures and words, the memo and the stubs, never an account number. A test page on plain paper shows where
// each goes, and a nudge in sixteenths of an inch, kept for the business, lines it up with the paper.

export type CheckLayout = 'top' | 'middle';
export type Nudge = { x: number; y: number };
export type StubRow = { label: string; now: number; year?: number | null; minus?: boolean };
export type CheckData = {
  no: string; date: string; payee: string; amount: number; memo: string;
  /** The person's stub: what they earned, the taxes taken out, and the year so far. */
  earned: StubRow[]; taxes: StubRow[]; note?: string;
  /** The business's stub: the business's own payroll taxes on it. */
  employer: StubRow[];
  /** "Pay for November 16 to 29, paid December 3, 2026". */
  span: string;
};

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const under1000 = (n: number): string => {
  const h = Math.floor(n / 100), r = n % 100; const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ''}`);
  return parts.join(' ');
};
/** The amount on a check's line, in words: "One thousand three hundred thirty-five and 61/100". */
export function amountInWords(amount: number): string {
  const cents = Math.round(Math.max(0, amount) * 100); const d = Math.floor(cents / 100), c = cents % 100;
  const groups: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']];
  let rest = d; const words: string[] = [];
  for (const [size, name] of groups) { const g = Math.floor(rest / size); rest %= size; if (g) words.push(`${under1000(g)}${name ? ` ${name}` : ''}`); }
  const w = words.join(' ') || 'zero';
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} and ${String(c).padStart(2, '0')}/100`;
}

const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
const money = (v: number) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
/** The business's address as lines, from a string or { line1, line2, city, state, postalCode } (or street/zip). */
export function addressLines(a: any): string[] {
  if (!a) return []; if (typeof a === 'string') return a.split(/\n|,\s*(?=[^,]*,)/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
  const l1 = String(a.line1 || a.street || '').trim(), l2 = String(a.line2 || '').trim();
  const city = [String(a.city || '').trim(), [String(a.state || '').trim(), String(a.postalCode || a.zip || '').trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [l1, l2, city].filter(Boolean);
}

const CSS = `@page { size: letter; margin: 0; }
* { box-sizing: border-box; } html, body { margin: 0; padding: 0; }
body { font-family: 'Plus Jakarta Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #16171a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: 8.5in; height: 11in; position: relative; overflow: hidden; page-break-after: always; break-after: page; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
.part { position: absolute; left: 0; width: 8.5in; height: 3.6667in; padding: 0.3in 0.45in; }
.chk { font-size: 11px; }
.chk .biz { position: absolute; left: 0.45in; top: 0.3in; line-height: 1.35; } .chk .biz b { font-size: 13px; }
.chk .no { position: absolute; right: 0.45in; top: 0.3in; font-size: 13px; font-weight: 600; }
.chk .date { position: absolute; right: 0.45in; top: 0.85in; width: 2.2in; } .chk .lbl { font-size: 9px; color: #6d7075; }
.chk .payee { position: absolute; left: 0.45in; top: 1.35in; width: 5.6in; } .chk .payee .v { font-size: 13px; font-weight: 600; border-bottom: 1px solid #16171a; padding-bottom: 2px; }
.chk .amt { position: absolute; right: 0.45in; top: 1.35in; width: 1.7in; } .chk .amt .v { font-size: 14px; font-weight: 600; border: 1px solid #16171a; padding: 3px 8px; text-align: right; }
.chk .words { position: absolute; left: 0.45in; top: 1.9in; width: 7.6in; border-bottom: 1px solid #16171a; font-size: 12px; padding-bottom: 2px; display: flex; justify-content: space-between; }
.chk .memo { position: absolute; left: 0.45in; top: 2.45in; width: 3.6in; } .chk .memo .v { border-bottom: 1px solid #16171a; padding-bottom: 2px; }
.chk .sig { position: absolute; right: 0.45in; top: 2.45in; width: 3in; } .chk .sig .v { border-bottom: 1px solid #16171a; height: 18px; }
.stub { font-size: 10px; line-height: 1.4; } .stub h4 { margin: 0; font-size: 12px; } .stub .sub { color: #6d7075; margin-bottom: 6px; }
.stub .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3in; }
.stub table { width: 100%; border-collapse: collapse; } .stub th { text-align: right; font-weight: 500; color: #6d7075; font-size: 9px; padding: 2px 0; } .stub th:first-child { text-align: left; }
.stub td { padding: 2px 0; border-top: 1px solid #ececee; text-align: right; font-variant-numeric: tabular-nums; } .stub td:first-child { text-align: left; }
.stub tr.t td { border-top: 1px solid #16171a; font-weight: 600; } .stub .take { margin-top: 6px; font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; }
.stub .note { color: #6d7075; margin-top: 4px; }
.test .box { position: absolute; border: 1.5px dashed #b45309; color: #b45309; font-size: 10px; padding: 2px 4px; }
.cutline { position: absolute; left: 0; width: 8.5in; border-top: 1px dashed #c9cacd; }
@media screen { body { background: #f5f5f7; } .sheet { background: #fff; margin: 16px auto; box-shadow: 0 1px 6px rgba(0,0,0,0.08); } }`;

const table = (rows: StubRow[], heads: [string, string, string] | null, total?: StubRow) => `<table>${heads ? `<thead><tr><th>${esc(heads[0])}</th><th>${esc(heads[1])}</th><th>${esc(heads[2])}</th></tr></thead>` : ''}<tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.minus ? '−' : ''}${money(r.now)}</td><td>${r.year == null ? '' : `${r.minus ? '−' : ''}${money(r.year)}`}</td></tr>`).join('')}${total ? `<tr class="t"><td>${esc(total.label)}</td><td>${money(total.now)}</td><td>${total.year == null ? '' : money(total.year)}</td></tr>` : ''}</tbody></table>`;

function checkPart(c: CheckData, biz: { name: string; lines: string[] }) {
  return `<div class="chk"><div class="biz"><b>${esc(biz.name)}</b>${biz.lines.map((l) => `<br>${esc(l)}`).join('')}</div><div class="no">${esc(c.no)}</div>
    <div class="date"><div class="lbl">Date</div><div>${esc(longDay(c.date))}</div></div>
    <div class="payee"><div class="lbl">Pay to the order of</div><div class="v">${esc(c.payee)}</div></div>
    <div class="amt"><div class="lbl">&nbsp;</div><div class="v">$${money(c.amount)}</div></div>
    <div class="words"><span>${esc(amountInWords(c.amount))} ***</span><span>Dollars</span></div>
    <div class="memo"><div class="lbl">Memo</div><div class="v">${esc(c.memo)}</div></div>
    <div class="sig"><div class="lbl">&nbsp;</div><div class="v"></div><div class="lbl">Authorized signature</div></div></div>`;
}
function personStub(c: CheckData, biz: string) {
  const earnedTotal = c.earned.reduce((t, r) => t + (r.minus ? -r.now : r.now), 0);
  const taxTotal = c.taxes.reduce((t, r) => t + r.now, 0); const taxYear = c.taxes.reduce((t, r) => t + (r.year || 0), 0);
  return `<div class="stub"><h4>${esc(c.payee)}</h4><div class="sub">${esc(c.span)}. ${esc(biz)}, check ${esc(c.no)}</div>
    <div class="cols"><div>${table(c.earned, ['Earned', 'This payday', ''], { label: 'In this check, before taxes', now: Math.round(earnedTotal * 100) / 100, year: null })}</div>
    <div>${c.taxes.length ? table(c.taxes, ['Taxes taken out', 'This payday', 'This year'], { label: 'Taxes in all', now: Math.round(taxTotal * 100) / 100, year: Math.round(taxYear * 100) / 100 }) : '<p class="note">Paid as a contractor: nothing is taken out.</p>'}
    <div class="take"><span>Take-home pay, this check</span><span>$${money(c.amount)}</span></div>${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}</div></div></div>`;
}
function bizStub(c: CheckData) {
  const er = c.employer.reduce((t, r) => t + r.now, 0);
  return `<div class="stub"><h4>For your records</h4><div class="sub">${esc(c.payee)}, check ${esc(c.no)}, ${esc(longDay(c.date))}: $${money(c.amount)}</div>
    <div class="cols"><div>${table([...c.earned, ...(c.taxes.length ? [{ label: 'Taxes taken out', now: c.taxes.reduce((t, r) => t + r.now, 0), minus: true }] : [])], null, { label: 'This check', now: c.amount, year: null })}</div>
    <div>${c.employer.length ? table(c.employer, null, { label: 'Your payroll taxes', now: Math.round(er * 100) / 100, year: null }) : '<p class="note">No payroll taxes: a contractor.</p>'}</div></div></div>`;
}

/** The sheets to print: one per check, the check on top (two stubs below) or in the middle (a stub above and below),
 *  moved by the business's nudge. `test`: plain paper, with a box where each thing goes. */
export function checksHtml(o: { business: { name: string; lines: string[] }; checks: CheckData[]; layout: CheckLayout; nudge: Nudge; test?: boolean }): string {
  const H = 3.6667; const tops = o.layout === 'middle' ? { chk: H, a: 0, b: 2 * H } : { chk: 0, a: H, b: 2 * H };
  const shift = `transform: translate(${o.nudge.x / 16}in, ${o.nudge.y / 16}in);`;
  const sheet = (c: CheckData) => `<div class="sheet"><div style="${shift}position:absolute;inset:0">
    <div class="part" style="top:${tops.chk}in">${checkPart(c, o.business)}</div>
    <div class="part" style="top:${tops.a}in">${personStub(c, o.business.name)}</div>
    <div class="part" style="top:${tops.b}in">${bizStub(c)}</div></div>
    <div class="cutline" style="top:${H}in"></div><div class="cutline" style="top:${2 * H}in"></div></div>`;
  const test = () => { const b = (l: number, t: number, w: number, h: number, label: string) => `<div class="box" style="left:${l}in;top:${t + tops.chk}in;width:${w}in;height:${h}in">${esc(label)}</div>`;
    return `<div class="sheet test"><div style="${shift}position:absolute;inset:0">
      ${b(0.45, 0.3, 3, 0.6, 'Your business’s name and address')}${b(7.05, 0.3, 1, 0.3, 'Check number')}${b(5.85, 0.85, 2.2, 0.4, 'Date')}
      ${b(0.45, 1.35, 5.6, 0.45, 'Pay to the order of')}${b(6.35, 1.35, 1.7, 0.45, 'Amount')}${b(0.45, 1.9, 7.6, 0.35, 'Amount in words')}
      ${b(0.45, 2.45, 3.6, 0.45, 'Memo')}${b(5.05, 2.45, 3, 0.45, 'Signature')}</div>
      <div class="cutline" style="top:${H}in"></div><div class="cutline" style="top:${2 * H}in"></div>
      <div style="position:absolute;left:0.45in;top:${(o.layout === 'middle' ? 0 : H) + 0.4}in;width:7.6in;font-size:12px;color:#6d7075">Test page: print on plain paper, hold it over a sheet of checks against a window, and nudge it on Payday until each dashed box sits on its line.</div></div>`; };
  const body = o.test ? test() : o.checks.map(sheet).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${o.test ? 'Check test page' : `Checks${o.checks[0] ? `, ${esc(longDay(o.checks[0].date))}` : ''}`}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${body}<script>(function(){var d=false;function go(){if(d)return;d=true;setTimeout(function(){window.print()},300)}if(document.fonts&&document.fonts.ready){document.fonts.ready.then(go)}else{window.addEventListener('load',go)}setTimeout(go,1500)})();</script></body></html>`;
}
