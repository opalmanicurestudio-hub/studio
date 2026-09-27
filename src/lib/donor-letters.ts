// src/lib/donor-letters.ts — the words for donors (safe on server AND in the
// browser, so the emailed letter and the printed letter are identical).
//   thankYouLetter  the school's own template ({first}, {amount}, {fund}…),
//                   then the official receipt
//   yearStatement   every gift in a year, the total, and the right tax wording
// Tax wording: only a tax-exempt nonprofit WITH an EIN says gifts may be
// deductible (and "no goods or services were provided"); otherwise it says
// plainly that they are not.

export const DEFAULT_THANK_YOU = `Dear {first},

Thank you for your generous gift of {amount} to {fund}.

Gifts like yours go straight to our students — helping them with tuition, professional kits and exam fees, so that talent, not money, decides who finishes. Every award is made by our review team, and we report each year on how gifts were used.

On behalf of our students and instructors, thank you for believing in them.

With gratitude,`;

export interface DonorWho { school: string; legal: string; nonprofit: boolean; ein: string }
const usd = (c: number) => `$${(Math.round(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: (c || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (v: string) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export function taxLine(w: DonorWho, many = false) {
  return w.nonprofit
    ? `${w.legal} is a tax-exempt organisation (EIN ${w.ein}). No goods or services were provided in exchange for ${many ? 'these contributions' : 'this contribution'}. Please keep this ${many ? 'statement' : 'receipt'} for your records; gifts may be tax-deductible to the extent allowed by law.`
    : `${w.school} is not a tax-exempt charity, so ${many ? 'these gifts are' : 'this gift is'} not tax-deductible. Thank you for supporting our students all the same.`;
}

/** The receipt block (markdown-lite: "# heading", "- item"). */
export function receiptBlock(g: any, w: DonorWho) {
  return [`# Receipt`, `- Receipt number: ${g.receiptNo}`, `- Date: ${day(g.createdAt)}`, `- Amount: ${usd(g.amountCents)}`, `- Fund: ${g.fund}`, `- From: ${g.business || g.name || 'Anonymous donor'}`, '', taxLine(w)].join('\n');
}

/** The thank-you letter + receipt, from the school's template. */
export function thankYouLetter(g: any, w: DonorWho, template?: string | null) {
  const first = String(g.business ? (g.name || g.business) : (g.name || '')).split(' ')[0] || 'friend';
  const body = String(template || DEFAULT_THANK_YOU)
    .replace(/\{first\}/g, first).replace(/\{name\}/g, g.name || first).replace(/\{business\}/g, g.business || g.name || '')
    .replace(/\{amount\}/g, usd(g.amountCents)).replace(/\{fund\}/g, g.fund || 'our students').replace(/\{school\}/g, w.school).replace(/\{date\}/g, day(g.createdAt));
  return `${body.trim()}\n\n${receiptBlock(g, w)}`;
}

/** A year's giving, for one donor. */
export function yearStatement(gifts: any[], w: DonorWho, year: number) {
  const list = [...gifts].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const total = list.reduce((n, g) => n + (g.amountCents || 0), 0);
  const who = list[0]?.business || list[0]?.name || 'Donor';
  return [`Dear ${String(list[0]?.name || who).split(' ')[0] || 'friend'},`, '', `Thank you for supporting ${w.school} students in ${year}. Here is a summary of your gifts for your records.`, '',
    `# ${year} giving statement — ${who}`, ...list.map((g) => `- ${day(g.createdAt)} · ${usd(g.amountCents)} · ${g.fund} · receipt ${g.receiptNo}`), '', `**Total given in ${year}: ${usd(total)}**`, '', taxLine(w, list.length > 1), '', 'With gratitude,'].join('\n');
}
