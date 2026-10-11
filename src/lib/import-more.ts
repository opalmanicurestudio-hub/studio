// src/lib/import-more.ts — THE SECOND HALF OF MOVING IN (server): appointments, gift card balances and packages from
// another app (rows already cleaned by lib/import-records).
//   • Appointments: who each one is with (staff names in the file → your team, asked once and remembered), which service
//     (file names → your menu, remembered), and which client (email, then mobile, then an exact name; otherwise a new
//     client is added). Upcoming visits come in as booked; past ones as history. Nobody is texted about them: past visits
//     are marked as already thanked, and upcoming ones get their usual reminders only if the business says so.
//     Each appointment's id comes from its client, time and service, so running the same file again (switch-over day)
//     only adds the new ones.
//   • Gift cards: each card keeps its old code, so cards people already hold work here; what's left on it is money owed
//     to clients (not a sale). A card already here (same code) is skipped.
//   • Packages: sessions left go on the client's account, on one of your packages (matched by name, or made — hidden from
//     sale — when there isn't one).
import { createHash } from 'crypto';
import { digits10, type ImportKind } from '@/lib/import-records';

const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();
const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SYN: [RegExp, string][] = [[/\bmani\b/g, 'manicure'], [/\bpedi\b/g, 'pedicure'], [/\bgel x\b/g, 'gelx'], [/\b&\b|\band\b|\+/g, ' '], [/\bw\b/g, 'with'], [/\bhr\b/g, 'hour']];
const svcNorm = (s: any) => { let x = ` ${norm(s)} `; for (const [re, to] of SYN) x = x.replace(re, to); return x.replace(/\s+/g, ' ').trim(); };
export const mapKey = (s: any, svc = false) => (svc ? svcNorm(s) : norm(s)).replace(/[\s.]/g, '_');
const tokens = (s: string) => new Set(svcNorm(s).split(' ').filter((w) => w.length > 1));

/** Your team member a name in the file means: exact, "Ana R." → Ana Ruiz, or a first name only one person has. */
export function matchStaff(name: string, staff: any[]): any | null {
  const n = norm(name); if (!n) return null; const people = staff.filter((s) => s.archived !== true);
  const exact = people.find((s) => norm(s.name) === n || norm(s.preferredName) === n); if (exact) return exact;
  const [f, l] = n.split(' ');
  const init = people.filter((s) => { const [sf, ...rest] = norm(s.name).split(' '); return sf === f && (!l || rest.join(' ').startsWith(l.replace(/\./g, ''))); });
  if (init.length === 1) return init[0];
  const first = people.filter((s) => norm(s.name).split(' ')[0] === f); return first.length === 1 && !l ? first[0] : null;
}
/** Your service a name in the file means: exact (allowing mani/pedi), else the closest by shared words (≥ 60%). */
export function matchService(name: string, services: any[]): any | null {
  const n = svcNorm(name); if (!n) return null; const live = services.filter((s) => s.status !== 'archived');
  const exact = live.find((s) => svcNorm(s.name) === n); if (exact) return exact;
  const a = tokens(name); let best: any = null, score = 0;
  for (const s of live) { const b = tokens(s.name); const inter = [...a].filter((w) => b.has(w)).length; const sc = inter / Math.max(a.size, b.size, 1); if (sc > score) { score = sc; best = s; } }
  return score >= 0.6 ? best : null;
}

/** Everyone already here, indexed so a row can find its client fast. */
export async function clientIndex(db: any, tenantId: string) {
  const s = await db.collection(`${T(tenantId)}/clients`).get(); const byEmail = new Map<string, any>(), byPhone = new Map<string, any>(), byName = new Map<string, any[]>();
  for (const d of s.docs) { const c: any = { id: d.id, ...(d.data() || {}) }; if (c.ownerRenterId || c.status === 'archived') continue;
    if (c.email) byEmail.set(String(c.email).toLowerCase(), c); const p = digits10(c.phone); if (p.length === 10) byPhone.set(p, c);
    const k = norm(c.name); if (k) byName.set(k, [...(byName.get(k) || []), c]); }
  return { byEmail, byPhone, byName,
    find(r: { email?: string; phone?: string; client?: string; name?: string }) {
      if (r.email && byEmail.has(r.email.toLowerCase())) return byEmail.get(r.email.toLowerCase());
      const p = digits10(r.phone); if (p.length === 10 && byPhone.has(p)) return byPhone.get(p);
      const same = byName.get(norm(r.client || r.name)); return same && same.length === 1 ? same[0] : null;
    },
    add(c: any) { if (c.email) byEmail.set(String(c.email).toLowerCase(), c); const p = digits10(c.phone); if (p.length === 10) byPhone.set(p, c); const k = norm(c.name); if (k) byName.set(k, [...(byName.get(k) || []), c]); } };
}

/** What a file of appointments needs answered, with our best guesses (and the answers remembered from earlier files). */
export async function appointmentQuestions(db: any, tenantId: string, rows: any[]) {
  const [st, sv, t] = await Promise.all([db.collection(`${T(tenantId)}/staff`).get(), db.collection(`${T(tenantId)}/services`).get(), db.doc(T(tenantId)).get()]);
  const staff = st.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.role !== 'renter' || true);
  const services = sv.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })); const saved: any = (t.data() || {}).importMaps || {};
  const count = (k: string) => { const m = new Map<string, number>(); for (const r of rows) { const v = String(r[k] || '').trim(); if (v) m.set(v, (m.get(v) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const staffQ = count('staff').map(([name, n]) => { const remembered = saved.staff?.[mapKey(name)]; const m = remembered ? staff.find((s: any) => s.id === remembered) : matchStaff(name, staff);
    return { name, count: n, suggest: remembered === '__past' ? '__past' : m?.id || null, sure: !!remembered || (!!m && norm(m.name) === norm(name)) }; });
  const serviceQ = count('service').map(([name, n]) => { const remembered = saved.services?.[mapKey(name, true)]; const m = remembered && remembered !== '__keep' ? services.find((s: any) => s.id === remembered) : remembered ? null : matchService(name, services);
    return { name, count: n, suggest: remembered === '__keep' ? '__keep' : m?.id || null, sure: !!remembered || (!!m && svcNorm(m.name) === svcNorm(name)) }; });
  const idx = await clientIndex(db, tenantId); const nowIso = new Date().toISOString().slice(0, 16);
  const newClients = new Set<string>(); let upcoming = 0, past = 0;
  for (const r of rows) { if (!idx.find(r)) newClients.add(norm(r.email || r.phone || r.client)); if (String(r.when) >= nowIso && r.status !== 'cancelled' && r.status !== 'no_show' && r.status !== 'done') upcoming++; else past++; }
  return { staff: staffQ, services: serviceQ, team: staff.filter((s: any) => s.archived !== true).map((s: any) => ({ id: s.id, name: s.name })), menu: services.filter((s: any) => s.status !== 'archived').map((s: any) => ({ id: s.id, name: s.name, duration: s.duration, price: s.price })), upcoming, past, newClients: newClients.size };
}

/** Remember the answers so the next file (switch-over day) asks nothing. */
export async function rememberMaps(db: any, tenantId: string, staffMap: Record<string, string>, serviceMap: Record<string, string>) {
  const patch: any = {}; for (const [k, v] of Object.entries(staffMap || {})) if (v) patch[`importMaps.staff.${mapKey(k)}`] = v;
  for (const [k, v] of Object.entries(serviceMap || {})) if (v) patch[`importMaps.services.${mapKey(k, true)}`] = v;
  if (Object.keys(patch).length) await db.doc(T(tenantId)).update(patch).catch(() => {});
}

const newClientDoc = (ref: any, r: any, meta: { importId: string; app: string }) => JSON.parse(JSON.stringify({ id: ref.id, name: r.client || r.name, firstName: r.firstName, lastName: r.lastName, email: r.email || null, phone: r.phone || null, status: 'active', lifetimeValue: 0, lastAppointment: null, createdVia: 'import', importId: meta.importId, importedFrom: meta.app || null, importedAt: now(), createdAt: now(), importedSpent: 0, importedLastVisit: null }));

/** Save a chunk of appointments. */
export async function saveAppointments(db: any, tenantId: string, tenant: any, rows: any[], o: { importId: string; app: string; staffMap: Record<string, string>; serviceMap: Record<string, string>; reminders: boolean }) {
  const { wallToUtc, tenantTimeZone } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant);
  const [st, sv] = await Promise.all([db.collection(`${T(tenantId)}/staff`).get(), db.collection(`${T(tenantId)}/services`).get()]);
  const staff = new Map<string, any>(st.docs.map((d: any) => [d.id, { id: d.id, ...(d.data() || {}) }])); const services = new Map<string, any>(sv.docs.map((d: any) => [d.id, { id: d.id, ...(d.data() || {}) }]));
  const idx = await clientIndex(db, tenantId); let batch = db.batch(); let n = 0; let added = 0, skipped = 0, clientsAdded = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
  const nowMs = Date.now(); const lastSeen = new Map<string, string>();
  // Which of these are already here (a second run of the same file): one read for the whole chunk.
  const keyOf = (r: any, cid: string, start: Date) => `imp_${createHash('sha1').update(`${cid}|${start.toISOString()}|${svcNorm(r.service || '')}`).digest('hex').slice(0, 20)}`;
  const pre: string[] = []; for (const r of rows) { const c = idx.find(r); const [d0, hm0] = String(r.when).split('T'); const [h0, m0] = String(hm0 || '00:00').split(':').map(Number); const s0 = wallToUtc(d0, h0, m0, tz); if (c && !isNaN(+s0)) pre.push(keyOf(r, c.id, s0)); }
  const there = new Set<string>(); for (let i = 0; i < pre.length; i += 300) { const snaps = await db.getAll(...pre.slice(i, i + 300).map((k) => db.doc(`${T(tenantId)}/appointments/${k}`))); for (const x of snaps) if (x.exists) there.add(x.id); }
  for (const r of rows) {
    const [d, hm] = String(r.when).split('T'); const [h, mi] = String(hm || '00:00').split(':').map(Number); const start = wallToUtc(d, h, mi, tz); if (isNaN(+start)) { skipped++; continue; }
    const sMap = o.serviceMap[r.service || ''] || null; const svc = sMap && sMap !== '__keep' ? services.get(sMap) : null;
    const mins = Number(r.minutes) || Number(svc?.duration) || 60; const end = new Date(+start + mins * 60000);
    let client = idx.find(r);
    if (!client) { const ref = db.collection(`${T(tenantId)}/clients`).doc(); client = newClientDoc(ref, r, o); batch.set(ref, client); n++; idx.add(client); clientsAdded++; }
    const id = keyOf(r, client.id, start); if (there.has(id)) { skipped++; continue; } there.add(id);
    const ref = db.doc(`${T(tenantId)}/appointments/${id}`);
    const stId = o.staffMap[r.staff || ''] || null; const who = stId && stId !== '__past' ? staff.get(stId) : null;
    const isPast = +start < nowMs; const st0 = r.status || (isPast ? 'done' : 'booked');
    const status = st0 === 'cancelled' ? 'cancelled' : st0 === 'no_show' ? 'no_show' : isPast ? 'completed' : 'confirmed';
    const price = r.price != null ? Number(r.price) : Number(svc?.price) || 0;
    batch.set(ref, JSON.parse(JSON.stringify({ id: ref.id, clientId: client.id, clientName: client.name, clientEmail: client.email || null, clientPhone: client.phone || null,
      staffId: who?.id || null, staffName: who?.name || (stId === '__past' ? `${r.staff} (past team member)` : r.staff || null),
      serviceId: svc?.id || null, serviceName: svc?.name || r.service || 'Appointment', startTime: start.toISOString(), endTime: end.toISOString(), duration: mins, price,
      status, ...(status === 'completed' ? { revenue: price, checkedOutAt: start.toISOString() } : {}), notes: r.notes || '', source: 'import', bookedBy: 'import', importId: o.importId, importedFrom: o.app || null, createdAt: now(),
      // Nothing is sent about an imported visit unless the business chose reminders for upcoming ones.
      followUpSentAt: now(), aftercareSentAt: now(), ...(isPast || !o.reminders ? { reminderSentAt: now(), reminderSentBy: 'import' } : {}), confirmationSentAt: now() })));
    n++; added++;
    if (status === 'completed') { const prev = lastSeen.get(client.id) || client.lastAppointment || ''; if (start.toISOString() > prev) lastSeen.set(client.id, start.toISOString()); }
    if (n >= 380) await flush();
  }
  for (const [cid, at] of lastSeen) { batch.set(db.doc(`${T(tenantId)}/clients/${cid}`), { lastAppointment: at, importedLastVisit: at }, { merge: true }); if (++n >= 380) await flush(); }
  await flush();
  return { added, skipped, clientsAdded };
}

/** Save a chunk of gift card balances. */
export async function saveGiftCards(db: any, tenantId: string, rows: any[], o: { importId: string; app: string; by: string }) {
  const { issueGiftCard, findByCode } = await import('@/lib/gift-cards'); const idx = await clientIndex(db, tenantId);
  let added = 0, skipped = 0, owedCents = 0;
  for (const r of rows) {
    if (await findByCode(db, tenantId, r.code)) { skipped++; continue; }
    const holder = idx.find({ email: r.email, phone: r.phone, client: r.holder || '' });
    const res: any = await issueGiftCard(db, tenantId, { amountCents: Math.max(1, Math.round((Number(r.initial) || Number(r.balance) || 0.01) * 100)), balanceCents: r.voided ? 0 : Math.round(Number(r.balance) * 100), code: r.code, by: o.by, source: 'import', importId: o.importId, importedFrom: o.app,
      recipient: { id: holder?.id || null, name: holder?.name || r.holder || null, phone: r.phone || null, email: r.email || null }, purchaser: r.purchaser ? { name: r.purchaser } : null,
      createdAt: r.created ? `${r.created}T12:00:00.000Z` : null, lastUsedAt: r.lastUsed ? `${r.lastUsed}T12:00:00.000Z` : null });
    if (res.ok) { added++; owedCents += res.card.balanceCents; if (r.voided) await db.doc(`${T(tenantId)}/giftCards/${res.card.id}`).set({ status: 'void' }, { merge: true }); } else skipped++;
  }
  return { added, skipped, owedCents };
}

/** Save a chunk of package balances. Returns fills so the import can be undone. */
export async function savePackages(db: any, tenantId: string, rows: any[], o: { importId: string; app: string; packageMap: Record<string, string> }) {
  const [pk, sv] = await Promise.all([db.collection(`${T(tenantId)}/packages`).get(), db.collection(`${T(tenantId)}/services`).get()]);
  const packages = pk.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })); const services = sv.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const idx = await clientIndex(db, tenantId); let added = 0, clientsAdded = 0, made = 0;
  const pkgFor = async (r: any) => {
    const mapped = o.packageMap[r.package]; if (mapped) { const p = packages.find((x: any) => x.id === mapped); if (p) return p; }
    const same = packages.find((x: any) => svcNorm(x.name) === svcNorm(r.package)); if (same) return same;
    const svc = (r.service && matchService(r.service, services)) || matchService(String(r.package).replace(/^\d+\s*(x\s*)?/i, ''), services) || null;
    const ref = db.collection(`${T(tenantId)}/packages`).doc(); const p = { id: ref.id, name: String(r.package).slice(0, 120), serviceId: svc?.id || '', sessions: Number(r.total) || Number(r.remaining) || 1, price: 0, expiresInMonths: 12, isPrivate: true, importId: o.importId, importedFrom: o.app || null, createdAt: now() };
    await ref.set(p); packages.push(p); made++; return p;
  };
  const fills: { docId: string; patch: any; before: any }[] = [];
  for (const r of rows) {
    const p = await pkgFor(r); let client = idx.find(r);
    if (!client) { const ref = db.collection(`${T(tenantId)}/clients`).doc(); client = newClientDoc(ref, r, o); await ref.set(client); idx.add(client); clientsAdded++; }
    const ref = db.doc(`${T(tenantId)}/clients/${client.id}`); const cur: any = (await ref.get()).data() || {}; const list: any[] = Array.isArray(cur.activePackages) ? cur.activePackages : [];
    if (list.some((x: any) => x.packageId === p.id && x.importId === o.importId)) continue;
    const entry = JSON.parse(JSON.stringify({ packageId: p.id, sessionsRemaining: Number(r.remaining) || 1, purchasedAt: r.bought ? `${r.bought}T12:00:00.000Z` : now(), expiresAt: r.expires ? `${r.expires}T23:59:00.000Z` : null, source: 'import', importId: o.importId, importedFrom: o.app || null }));
    const next = [...list, entry]; await ref.set({ activePackages: next }, { merge: true }); fills.push({ docId: client.id, patch: { activePackages: next }, before: { activePackages: list } }); added++;
  }
  return { added, clientsAdded, made, fills };
}

export const MORE_KINDS: ImportKind[] = ['appointments', 'giftcards', 'packages'];
