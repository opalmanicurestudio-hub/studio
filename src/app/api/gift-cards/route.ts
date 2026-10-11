// /api/gift-cards — GIFT CARDS (lib/gift-cards).
//   GET  ?tenantId&id&k                         → the recipient's page (public, by the private link)
//   POST lookup  { code }                       → a card by its code (the team, at checkout)
//        forClient { clientId }                 → cards this client holds or bought, with money left
//        hold     { id | code, holdId, cents }  → set money aside on this checkout (30 min); cents 0 lets it go
//        list     {}                            → every card, newest first (managers)
//        adjust   { id, kind: add|set|void, cents?, note } (managers)
//        resend   { id, via?, phone?, email? }   (managers and the desk)
//        issue    { amountCents, recipient…, note } → a card given without a sale (managers — a goodwill gift)
//        settings { save? } → the online shop and design library settings (managers; owner to save)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { findByCode, holdGiftCard, adjustGiftCard, issueGiftCard, deliverGiftCard, giftLinkKey, pub, available, codeTries, alertManagers, transferGiftCard } from '@/lib/gift-cards';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const tenantId = String(q.get('tenantId') || ''); const id = String(q.get('id') || '');
  if (!tenantId || !id || q.get('k') !== giftLinkKey(tenantId, id)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
  const db = getAdminDb(); const g: any = (await db.doc(`tenants/${tenantId}/giftCards/${id}`).get()).data(); if (!g) return j({ ok: false, error: 'This gift card wasn’t found.' }, 404);
  const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const { brandAccent } = await import('@/lib/brand-accent');
  // A card a renter sold is theirs: their name on it, and "Book with it" opens their page.
  let prov: string | null = null; if (g.ownerRenterId) { const st = await db.collection(`tenants/${tenantId}/staff`).where('renterId', '==', g.ownerRenterId).limit(3).get(); prov = st.docs.find((d: any) => (d.data() as any).isRenter)?.id || null; }
  return j({ ok: true, card: { ...pub(g), code: g.code }, brand: { name: g.ownerName || t.name || t.businessName || 'Gift card', accent: brandAccent(t), logo: g.ownerRenterId ? null : t.logoUrl || t.logo || null, phone: g.ownerRenterId ? null : t.phone || null },
    bookUrl: `/book/${encodeURIComponent(tenantId)}${prov ? `?provider=${encodeURIComponent(prov)}` : ''}` }, 200);
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || ''); const action = String(b.action || '');
  const mgrOnly = ['list', 'adjust', 'issue', 'settings', 'transfer', 'report'].includes(action);
  const g = await requireRole(req, tenantId, mgrOnly ? 'manager' : 'staff'); if (g.deny) return g.deny;
  const db = getAdminDb(); const by = g.actor?.name || 'Staff'; const T = `tenants/${tenantId}`;
  // Wrong codes are counted per person: after 8 misses in 15 minutes they wait 15 minutes, and managers hear about it.
  const who = g.actor?.uid || g.actor?.name || 'staff';
  const tryCode = async (code: string) => { if ((await codeTries(db, tenantId, who, false)).blocked) return { blocked: true, card: null as any };
    const c = await findByCode(db, tenantId, code); if (!c) { const r: any = await codeTries(db, tenantId, who, true); if (r.justBlocked) await alertManagers(db, tenantId, `${by} entered 8 wrong gift card codes in a few minutes — gift card lookups are paused for them for 15 minutes.`).catch(() => {}); }
    return { blocked: false, card: c }; };
  if (action === 'lookup') { const tc = await tryCode(String(b.code || '')); if (tc.blocked) return j({ ok: false, error: 'Too many wrong codes — try again in 15 minutes.' }, 429); const c = tc.card; if (!c) return j({ ok: false, error: 'That gift card code wasn’t found. Check it and try again.' }, 404);
    if (c.status === 'void') return j({ ok: false, error: 'That gift card was cancelled.' }, 409); return j({ ok: true, card: pub(c) }); }
  if (action === 'forClient') { const cid = String(b.clientId || ''); if (!cid) return j({ ok: true, cards: [] });
    const [a, p] = await Promise.all([db.collection(`${T}/giftCards`).where('recipientId', '==', cid).get(), db.collection(`${T}/giftCards`).where('purchaserId', '==', cid).get()]);
    const m = new Map<string, any>(); for (const d of [...a.docs, ...p.docs]) { const x: any = { id: d.id, ...d.data() }; if (x.status === 'active' && available(x) > 0) m.set(d.id, { ...pub(x), mine: x.recipientId === cid }); }
    void (await import('@/lib/gift-cards')).syncClientGift(db, tenantId, cid).catch(() => {});   // keeps the badge right for older cards
    return j({ ok: true, cards: [...m.values()].sort((x, y) => Number(y.mine) - Number(x.mine)) }); }
  if (action === 'hold') { const holdId = String(b.holdId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60); if (!holdId) return j({ ok: false, error: 'Missing the checkout.' }, 400);
    if (!b.id && b.code) { const tc = await tryCode(String(b.code)); if (tc.blocked) return j({ ok: false, error: 'Too many wrong codes — try again in 15 minutes.' }, 429); }
    const r: any = await holdGiftCard(db, tenantId, { id: b.id ? String(b.id) : undefined, code: b.code ? String(b.code) : undefined, holdId, cents: Math.round(Number(b.cents) || 0) }); return j(r, r.ok ? 200 : 409); }
  if (action === 'list') { const s = await db.collection(`${T}/giftCards`).get(); const cards = s.docs.map((d: any) => { const x: any = { id: d.id, ...d.data() }; return { ...pub(x), source: x.source, importedFrom: x.importedFrom || null, sendVia: x.sendVia || null, sentAt: x.sentAt || null, sendAt: x.sendAt || null, sendStatus: x.sendStatus || null, recipientPhone: x.recipientPhone || null, recipientEmail: x.recipientEmail || null, history: (x.history || []).slice(-20) }; })
      .sort((a: any, b2: any) => String(b2.createdAt).localeCompare(String(a.createdAt))); return j({ ok: true, cards }); }
  if (action === 'adjust') { const kind = ['add', 'set', 'void'].includes(b.kind) ? b.kind : null; if (!kind) return j({ ok: false, error: 'Choose what to change.' }, 400);
    if (kind !== 'void' && !String(b.note || '').trim()) return j({ ok: false, error: 'Say why the balance is changing.' }, 400);
    const r: any = await adjustGiftCard(db, tenantId, { id: String(b.id || ''), kind, cents: Math.round(Number(b.cents) || 0), note: b.note, by });
    if (r.ok) { const c: any = (await db.doc(`${T}/giftCards/${String(b.id || '')}`).get()).data() || {}; await alertManagers(db, tenantId, kind === 'void' ? `${by} cancelled gift card ${c.code}.` : `${by} changed gift card ${c.code} to $${(r.balanceCents / 100).toFixed(2)} — “${String(b.note || '').slice(0, 80)}”`, '/gift-cards', g.actor?.uid || null).catch(() => {}); }
    return j(r, r.ok ? 200 : 400); }
  if (action === 'resend') { const ref = db.doc(`${T}/giftCards/${String(b.id || '')}`); const x: any = (await ref.get()).data(); if (!x) return j({ ok: false, error: 'That gift card wasn’t found.' }, 404);
    const patch: any = { sendStatus: null, sendAt: null }; if (b.via === 'text' || b.via === 'email') patch.sendVia = b.via; if (b.phone) patch.recipientPhone = String(b.phone).slice(0, 30); if (b.email) patch.recipientEmail = String(b.email).slice(0, 120);
    await ref.set(patch, { merge: true }); const t: any = (await db.doc(T).get()).data() || {}; const r = await deliverGiftCard(db, tenantId, t, { ...x, ...patch, id: ref.id });
    return j(r.sent ? { ok: true } : { ok: false, error: 'It didn’t send — check the number or email, or that texting/email is set up.' }, r.sent ? 200 : 400); }
  if (action === 'issue') { const r: any = await issueGiftCard(db, tenantId, { amountCents: Math.round(Number(b.amountCents) || 0), by, source: 'recovery', recipient: b.recipient || null, message: b.message || null, sendVia: b.sendVia || 'code' });
    if (r.ok && ['text', 'email'].includes(b.sendVia)) { const t: any = (await db.doc(T).get()).data() || {}; await deliverGiftCard(db, tenantId, t, r.card); }
    if (r.ok) await alertManagers(db, tenantId, `${by} gave a $${(r.card.initialCents / 100).toFixed(2)} gift card without a sale${b.recipient?.name ? ` to ${b.recipient.name}` : ''}${b.message ? ` — “${String(b.message).slice(0, 80)}”` : ''}.`, '/gift-cards', g.actor?.uid || null).catch(() => {});
    return j(r.ok ? { ok: true, card: pub(r.card) } : r, r.ok ? 200 : 400); }
  if (action === 'transfer') { const r: any = await transferGiftCard(db, tenantId, { id: String(b.id || ''), name: String(b.name || ''), phone: b.phone || null, email: b.email || null, clientId: b.clientId || null, note: b.note || null, by });
    if (r.ok && (b.send === 'text' || b.send === 'email')) { const x: any = (await db.doc(`${T}/giftCards/${String(b.id)}`).get()).data(); const t: any = (await db.doc(T).get()).data() || {}; await deliverGiftCard(db, tenantId, t, { ...x, id: String(b.id), sendVia: b.send, sendAt: null }).catch(() => {}); }
    return j(r, r.ok ? 200 : 400); }
  // THE MONEY REPORT: by month — sold, brought in, used, corrected, cancelled and what's still owed at the end of each
  // month — plus balances nobody has touched in a long time. The studio's cards only (a renter's cards are their money).
  if (action === 'report') {
    const snap = await db.collection(`${T}/giftCards`).get(); const m: Record<string, any> = {}; const row = (k: string) => (m[k] ||= { month: k, sold: 0, imported: 0, used: 0, adjusted: 0, voided: 0, soldCount: 0 });
    const idle = { y1: { n: 0, cents: 0 }, y2: { n: 0, cents: 0 }, y3: { n: 0, cents: 0 } }; const nowMs = Date.now(); let owedNow = 0;
    for (const d of snap.docs) { const x: any = d.data(); if (x.ownerRenterId) continue;
      for (const h of x.history || []) { const r = row(String(h.at || x.createdAt).slice(0, 7)); const c = Number(h.cents) || 0;
        if (h.type === 'issue') { r.sold += c; r.soldCount++; } else if (h.type === 'import') r.imported += c; else if (h.type === 'spend') r.used += -c; else if (h.type === 'void') r.voided += -c; else if (h.type === 'adjust') r.adjusted += c; }
      if (x.status === 'active' && x.balanceCents > 0) { owedNow += x.balanceCents; const age = (nowMs - Date.parse(x.lastUsedAt || x.createdAt)) / (365 * 864e5);
        if (age >= 3) { idle.y3.n++; idle.y3.cents += x.balanceCents; } else if (age >= 2) { idle.y2.n++; idle.y2.cents += x.balanceCents; } else if (age >= 1) { idle.y1.n++; idle.y1.cents += x.balanceCents; } } }
    const months = Object.values(m).sort((a: any, c: any) => a.month.localeCompare(c.month)); let run = 0;
    for (const r of months as any[]) { run += r.sold + r.imported - r.used + r.adjusted - r.voided; r.owedEnd = run; }
    return j({ ok: true, months: months.reverse(), owedNow, idle }); }
  if (action === 'settings') { const { shopSettings, cleanShowcase } = await import('@/lib/gift-designs'); const tref = db.doc(T); const t: any = (await tref.get()).data() || {};
    if (b.save && typeof b.save === 'object') { const v = b.save; const cur = shopSettings(t);
      const next = { online: v.online === true, designs: Array.isArray(v.designs) ? v.designs.map(String).filter((x: string) => /^[a-z0-9-]{2,30}$/.test(x)).slice(0, 80) : null,
        amounts: Array.isArray(v.amounts) ? v.amounts.map(Number).filter((n: number) => n >= 1 && n <= 5000).slice(0, 6) : cur.amounts, custom: v.custom !== false,
        min: Math.max(1, Math.min(5000, Number(v.min) || cur.min)), max: Math.max(1, Math.min(5000, Number(v.max) || cur.max)), seasonalOnly: v.seasonalOnly !== false,
        rules: String(v.rules || '').trim().slice(0, 600) || null, onBooking: v.onBooking !== false, buyerThanks: v.buyerThanks !== false, showcase: cleanShowcase(v.showcase), renters: { salonCards: v.renters?.salonCards !== false, ownCards: v.renters?.ownCards === true }, expiryYears: [0, 5, 6, 7, 10].includes(Number(v.expiryYears)) ? Number(v.expiryYears) : 0, paysFor: { services: v.paysFor?.services !== false, products: v.paysFor?.products !== false, tips: v.paysFor?.tips !== false }, cashBackUnderCents: [0, 500, 1000].includes(Number(v.cashBackUnderCents)) ? Number(v.cashBackUnderCents) : 0, refundDays: [0, 7, 14, 30].includes(Number(v.refundDays)) ? Number(v.refundDays) : 0, updatedAt: new Date().toISOString(), updatedBy: by };
      if (next.max < next.min) return j({ ok: false, error: 'The most someone can spend has to be more than the least.' }, 400);
      if (next.designs && !next.designs.length) return j({ ok: false, error: 'Keep at least one design on.' }, 400);
      await tref.set({ giftCardSettings: next }, { merge: true }); return j({ ok: true, settings: shopSettings({ giftCardSettings: next }), paymentsReady: !!t.stripeAccountId }); }
    return j({ ok: true, settings: shopSettings(t), paymentsReady: !!t.stripeAccountId }); }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
