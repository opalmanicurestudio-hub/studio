// src/lib/agent-feed.ts — ONE BUSINESS, AS AN ASSISTANT SHOULD SEE IT (the agent plan, Phase 1). The same public facts
// as the booking page: who the business is, what it offers at what price and length, who does each service, the
// booking policies in plain words, and exactly how an assistant finds a time and books. Built from the same records as
// the booking page so it can never drift. Also the open-times answer (the booking page's own engine and rules) and the
// plain-text guide (llms.txt) for one business.
import { agentPolicy, publicService, publicAddOn, holdable } from '@/lib/agent-access';
import { bookingPolicyLines } from '@/lib/policy-copy';
import { computeDepositCents } from '@/lib/deposit-policy';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';

const rows = (snap: any) => (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const bookableStaff = (st: any[]) => st.filter((m: any) => m?.name && m.isActive !== false && m.active !== false && !m.isRenter && m.role !== 'renter' && m.bookingOptOut !== true && m.hiddenFromBooking !== true);

export async function businessFeed(db: any, tenantId: string, origin: string) {
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(tenantId)) return null;
  const tSnap = await db.doc(`tenants/${tenantId}`).get(); if (!tSnap.exists) return null;
  const t: any = tSnap.data() || {}; const pol = agentPolicy(t);
  if (!pol.menu) return { t, pol, feed: null };
  const [sv, st] = await Promise.all([db.collection(`tenants/${tenantId}/services`).get(), db.collection(`tenants/${tenantId}/staff`).get()]);
  const services = rows(sv); const staff = bookableStaff(rows(st));
  const addOns = services.filter(publicAddOn).map((s: any) => ({ id: s.id, name: s.name, price: Number(s.price) || 0, durationMinutes: Number(s.duration) || 0 }));
  const whoDoes = (s: any) => { const ids: string[] = Array.isArray(s.staffIds) && s.staffIds.length ? s.staffIds.map(String) : staff.map((m: any) => m.id);
    const skilled = (m: any) => !s.requiredSkills?.length || s.requiredSkills.every((k: string) => (m.skillSet || []).includes(k));
    return staff.filter((m: any) => ids.includes(m.id) && skilled(m)).map((m: any) => m.id); };
  const base = `${origin}/book/${encodeURIComponent(tenantId)}`; const api = `${origin}/api/agents/${encodeURIComponent(tenantId)}`;
  const list = services.filter(publicService).sort((a: any, b: any) => (Number.isFinite(a.menuOrder) ? a.menuOrder : 1e9) - (Number.isFinite(b.menuOrder) ? b.menuOrder : 1e9) || String(a.name).localeCompare(String(b.name)))
    .map((s: any) => { const price = Number(s.price) || 0; let deposit = 0; try { deposit = computeDepositCents({ tenant: t, service: s, price, depositsLive: t.depositsLive === true }); } catch { /* none */ }
      const linked: string[] = Array.isArray(s.addOnIds) ? s.addOnIds.map(String) : [];
      return { id: s.id, name: String(s.name), category: String(s.category || 'Services'), description: s.description ? String(s.description).slice(0, 400) : null,
        price, priceIsFrom: !!(s.priceIsFrom || (s.serviceTiers || []).length), durationMinutes: Number(s.duration) || null,
        depositDollars: deposit > 0 ? Math.round(deposit) / 100 : null, membersOnly: !!s.membersOnly,
        needsConsultation: !!(s.consultationRequired || s.requiresConsultation), needsApproval: s.bookingMode === 'request' || s.requiresApproval === true,
        providerIds: whoDoes(s), addOnIds: linked.length ? linked.filter((id) => addOns.some((a: any) => a.id === id)) : addOns.map((a: any) => a.id),
        assistantCanHold: pol.holds && holdable(s) && (!pol.holdServices || pol.holdServices.includes(s.id)), bookingUrl: `${base}?service=${encodeURIComponent(s.id)}` }; });
  const a = t.address && typeof t.address === 'object' ? t.address : null;
  const feed = {
    ok: true, code: 'ok', updatedAt: new Date().toISOString(),
    business: { id: tenantId, name: String(t.businessName || t.name || 'Studio'), tagline: t.tagline || t.retailSettings?.shopTagline || null, timeZone: tenantTimeZone(t),
      address: a ? { street: a.street || a.line1 || '', city: a.city || '', region: a.state || a.region || '', postalCode: a.postalCode || a.zip || '', country: a.country || 'US' } : null,
      bookingUrl: base },
    team: staff.map((m: any) => ({ id: m.id, name: String(m.name), title: m.title || m.jobTitle || null })),
    services: list, addOns,
    policies: bookingPolicyLines(t),
    howToBook: {
      openTimes: `${api}/open-times?service={serviceId}&provider={providerId|any}&from={YYYY-MM-DD}&days={1-14}`,
      book: pol.holds
        ? { kind: 'hold', url: `${api}/hold`, note: `POST the client's name, mobile number, service and time. The time is held for ${pol.holdMinutes} minutes and the client gets one text to confirm it themselves; nothing is booked or charged until they do.` }
        : { kind: 'link', url: base, note: 'Send the client this booking link (add ?service={serviceId}); they choose the time and confirm it themselves.' },
      rules: ['Only the client can confirm, change or cancel their own booking (their visit link does all three).', 'Do not invent prices, times or policies: use the answers here.', 'Each answer has a code and a message; read the code, show the message.'],
    },
  };
  return { t, pol, feed };
}

/** Open times for a service: the booking page's own engine and rules (notice, horizon, buffers, resources). */
export async function agentOpenTimes(db: any, tenantId: string, q: { serviceId: string; providerId?: string | null; from?: string | null; days?: number; addOnIds?: string[] }) {
  const { loadBookingData, engineFrame, FALLBACK_HOURS } = await import('@/lib/booking-data');
  const { computeAvailability } = await import('@/lib/availability');
  const data: any = await loadBookingData(db, `tenants/${tenantId}`); if (!data) return { status: 404 as const };
  const t = data.t; const tz = tenantTimeZone(t);
  const services = rows(data.sv).filter((s: any) => s.isActive !== false);
  const svc = services.find((s: any) => s.id === q.serviceId);
  if (!svc || !publicService(svc)) return { status: 404 as const, kind: 'service' };
  const staff = bookableStaff(rows(data.st));
  const pool = !svc.requiredSkills?.length ? staff : staff.filter((m: any) => svc.requiredSkills.every((k: string) => (m.skillSet || []).includes(k)));
  const providerId = q.providerId && q.providerId !== 'any' ? String(q.providerId) : null;
  if (providerId && !pool.some((m: any) => m.id === providerId)) return { status: 404 as const, kind: 'provider' };
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? String(q.from) : todayIn(tz);
  const days = Math.max(1, Math.min(14, Math.round(Number(q.days) || 7)));
  const name = (id: string) => String(staff.find((m: any) => m.id === id)?.name || '');
  const out: { date: string; time: string; label: string; startsAt: string; providers: { id: string; name: string }[] }[] = [];
  const { wallToUtc } = await import('@/lib/tenant-time');
  const [y, mo, d] = start.split('-').map(Number);
  for (let i = 0; i < days && out.length < 60; i++) {
    const day = new Date(Date.UTC(y, mo - 1, d + i)).toISOString().slice(0, 10);
    const f = engineFrame({ appointments: rows(data.ap), events: rows(data.ce), staffBlocks: rows(data.sb), tickets: rows(data.tk) }, tz, day);
    let r: any; try {
      r = computeAvailability({ date: day, serviceId: svc.id, staffId: providerId || 'any', addOnIds: (q.addOnIds || []).slice(0, 8), services, staff: pool, scheduleProfiles: rows(data.sp), tenant: { id: tenantId, ...t },
        appointments: f.appointments, events: f.events, staffBlocks: f.staffBlocks, tickets: f.tickets, now: f.now, shifts: rows(data.sh), dayOffBlocks: rows(data.dof), resources: rows(data.rs), maintenancePlans: rows(data.mp),
        fallbackHours: FALLBACK_HOURS, includeUnavailable: false } as any);
    } catch { continue; }
    for (const time of (r?.times || []) as string[]) {
      const [hh, mm] = time.split(':').map(Number);
      const who = ((r.byTime?.[time] || []) as any[]).map((x: any) => String(x.staffId || x.staff?.id || '')).filter(Boolean);
      out.push({ date: day, time, label: r.byTime?.[time]?.[0]?.label || time, startsAt: wallToUtc(day, hh, mm, tz).toISOString(), providers: (who.length ? who : providerId ? [providerId] : []).map((id) => ({ id, name: name(id) })) });
      if (out.length >= 60) break;
    }
  }
  return { status: 200 as const, tz, service: { id: svc.id, name: svc.name, durationMinutes: Number(svc.duration) || null }, from: start, days, times: out };
}

/** The plain-text guide for one business (served as /book/{id}/llms.txt). */
export function guideText(feed: any): string {
  const b = feed.business; const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const lines: string[] = [];
  lines.push(`# ${b.name}`, '', b.tagline ? `> ${b.tagline}` : `> Book ${b.name} online.`, '');
  lines.push('This page is for AI assistants helping someone find a time or book with this business. The same facts are on the booking page.', '');
  lines.push('## Book', '', `- Booking page: ${b.bookingUrl}`, `- Everything below as data: ${feed.howToBook.openTimes.split('/open-times')[0]}`, `- Open times: ${feed.howToBook.openTimes}`,
    feed.howToBook.book.kind === 'hold' ? `- Hold a time for the client to confirm: POST ${feed.howToBook.book.url}. ${feed.howToBook.book.note}` : `- To book: ${feed.howToBook.book.note}`, '');
  if (b.address) lines.push('## Where', '', `${[b.address.street, b.address.city, b.address.region, b.address.postalCode].filter(Boolean).join(', ')} (times are in ${b.timeZone})`, '');
  const cats = new Map<string, any[]>(); for (const s of feed.services) cats.set(s.category, [...(cats.get(s.category) || []), s]);
  lines.push('## Services', '');
  for (const [cat, list] of cats) { lines.push(`### ${cat}`, '');
    for (const s of list) lines.push(`- ${s.name} (id ${s.id}): ${s.priceIsFrom ? 'from ' : ''}${money(s.price)}${s.durationMinutes ? `, ${s.durationMinutes} min` : ''}${s.depositDollars ? `, ${money(s.depositDollars)} deposit` : ''}${s.needsConsultation ? ', consultation first' : ''}${s.needsApproval ? ', the business accepts each request' : ''}${s.membersOnly ? ', members only' : ''}`);
    lines.push(''); }
  if (feed.addOns.length) { lines.push('## Add-ons', ''); for (const a of feed.addOns) lines.push(`- ${a.name} (id ${a.id}): ${money(a.price)}${a.durationMinutes ? `, ${a.durationMinutes} min` : ''}`); lines.push(''); }
  if (feed.team.length) { lines.push('## Team', ''); for (const m of feed.team) lines.push(`- ${m.name} (id ${m.id})${m.title ? `, ${m.title}` : ''}`); lines.push(''); }
  lines.push('## Policies', '', ...feed.policies.map((p: string) => `- ${p}`), '');
  lines.push('## Rules for assistants', '', ...feed.howToBook.rules.map((r: string) => `- ${r}`), '');
  return lines.join('\n');
}
