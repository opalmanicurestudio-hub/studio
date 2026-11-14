'use client';
// src/components/host/TableTab.tsx — THE TAB for a seated table (Host Stand). Items are grouped by course (lib/table-
// service): a held course waits until the server fires it, and shows how long it takes once fired. Tap an item to comp
// it, void it, have it made again, or move it to another seat: each goes through the server (api/tab), with a reason,
// and a manager's PIN only when it's needed (over the server's comp allowance, or a void the kitchen has started).
// Every comp and void on the table is listed with who asked and who approved. "Check out" fills the normal checkout with
// the tab (split by seat or item, tip on the whole meal), once nothing is waiting to be fired. With pay at the table on,
// the guests can pay on their own phones instead (TablePayCard); once any of it is paid there, it's finished there.
// Allergies (lib/allergens): a regular's come from their profile; the table is asked once before its first order (unless
// the business turns that off); each is on a seat or the whole table. Ringing in a dish that contains one warns first,
// and every ticket for that seat tells the kitchen. Counted dishes (lib/dish-counts) show what's left, and can't be rung
// in once sold out. A regular's usual (lib/guest-memory, design canvas GuestMemory) is a tap away, through the same
// checks as the menu, when the business shows regulars. "Print the check" prints at the business's check printer
// (lib/printing-server), or through this device's own print dialog when it has none.
// Through a Wi-Fi drop (lib/outbox; design canvas "When the Wi-Fi drops"): items added are kept by the database on the
// device and marked "Not sent yet" until they reach the server; firing a course is kept and sent when the connection's
// back (after the items). Until then a paper ticket of what hasn't reached the kitchen prints from here. Allergies,
// comps, voids and payments need the connection, and say so.
import * as React from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { addToTab, ensureTableVisit, newLineId, tabComps, tabTotal, type TabLine } from '@/lib/table-tab';
import { ALLERGENS, allergensKnown, allergyLine, allergyPhrase, cleanKeys, conflicts, itemAllergens, reaching, tableAllergies, ticketAllergyFields, whoWords, wordsList, type AllergenKey, type TableAllergy } from '@/lib/allergens';
import { keptNow, landed, send, useOutbox } from '@/lib/outbox';
import { ticketFrom } from '@/lib/kitchen';
import { tenantTimeZone } from '@/lib/tenant-time';
import { itemSoldOut } from '@/lib/menu-choices';
import { leftWords, lowCount, type CountRow } from '@/lib/dish-counts';
import { deskPrice, listingsOf, saleName, variantIdsOf } from '@/lib/variants';
import { kitchenScreenOn } from '@/lib/kitchen';
import { makeSecondsOf } from '@/lib/counter-orders';
import { approveWithPin } from '@/lib/approve-client';
import { tablePayOf } from '@/lib/table-bill';
import { TablePayCard } from '@/components/host/TablePayCard';
import { paperDoc, renderHtml } from '@/lib/printing';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';
import { askAllergiesOf, compReasonsOf, courseOfItem, courseStage, coursesOf, kitchenStarted, listPriceOf, prepMinutes, stationOfItem, stationsOf, OTHER_REASON, REMAKE_REASONS, VOID_REASONS, type Course } from '@/lib/table-service';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const GREEN_TINT = '#eaf6ef', AMBER_TINT = '#fff7ed';
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const btn = 'min-h-[44px] px-4 rounded-xl text-[14px] font-semibold disabled:opacity-40';
const quiet: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, color: INK };
const dark: React.CSSProperties = { background: INK, color: '#fff' };

/** A step through the server, signed in as this person: kept on the device when there's no connection and `keep`
 *  names it (only firing a course); anything else says it needs the connection (`offline`). */
async function tabCall(body: any, path = '/api/tab', keep?: string): Promise<any> {
  // A course fired more than 20 minutes late is no longer right to send.
  const r = await send(path, body, { label: keep || 'A tap', auth: 'user', keep: !!keep, tenantId: String(body.tenantId || ''), afterWrites: body.action === 'fire', maxAgeMs: 20 * 60000 });
  return r.d && typeof r.d === 'object' ? r.d : { ok: false, error: 'That didn’t go through.' };
}
// Items added with no connection, by visit, until the database says the tab has reached the server.
const UNSENT = 'cf.tab.unsent';
const unsentAll = (): Record<string, Record<string, number>> => { try { const v = JSON.parse(localStorage.getItem(UNSENT) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
function markUnsent(visitId: string, lineId: string | null, on: boolean): Set<string> {
  const all = unsentAll(); const v = { ...(all[visitId] || {}) };
  if (!lineId) { for (const k of Object.keys(v)) delete v[k]; } else if (on) v[lineId] = Date.now(); else delete v[lineId];
  if (Object.keys(v).length) all[visitId] = v; else delete all[visitId];
  try { if (Object.keys(all).length) localStorage.setItem(UNSENT, JSON.stringify(all)); else localStorage.removeItem(UNSENT); } catch { /* storage blocked */ }
  return new Set(Object.keys(v));
}

type Sheet = { kind: 'comp' | 'void' | 'remake'; line: TabLine };
const STAGE: Record<string, { text: string; bg: string; fg: string }> = {
  unfired: { text: 'Held', bg: AMBER_TINT, fg: AMBER }, cooking: { text: 'At the kitchen', bg: SOFT, fg: INK },
  ready: { text: 'Ready', bg: GREEN_TINT, fg: GREEN }, served: { text: 'Out', bg: GREEN_TINT, fg: GREEN },
};

export function TableTab({ firestore, tenantId, party, tableName, by }: { firestore: Firestore; tenantId: string; party: any; tableName: string; by: string }) {
  const [visitId, setVisitId] = React.useState<string | null>(null); const [tab, setTab] = React.useState<TabLine[]>([]);
  const [tenant, setTenant] = React.useState<any>(null);
  const [catalog, setCatalog] = React.useState<any[]>([]); const [q, setQ] = React.useState(''); const [seat, setSeat] = React.useState(''); const [note, setNote] = React.useState('');
  const [statuses, setStatuses] = React.useState<Record<string, string>>({}); const [records, setRecords] = React.useState<any[]>([]);
  const [picked, setPicked] = React.useState<string | null>(null); const [sheet, setSheet] = React.useState<Sheet | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false);
  // The visit as saved (its allergies), the table's tickets as the kitchen has them, and tonight's counts.
  const [visit, setVisit] = React.useState<any>(null); const [tickets, setTickets] = React.useState<Record<string, any>>({});
  const [counts, setCounts] = React.useState<Record<string, CountRow>>({});
  const [allergySheet, setAllergySheet] = React.useState<{ edit: TableAllergy | null } | null>(null);
  const [warn, setWarn] = React.useState<{ it: any; keys: AllergenKey[]; who: TableAllergy[]; unknown?: boolean } | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  // Paid at the table so far (on the guests' phones, or cash the server took): the check is then finished here, not at
  // the desk, so nobody pays twice.
  const [paidHere, setPaidHere] = React.useState(0);
  // Sold out by hand since the menu was read (the counts read brings them), so a dish sold out mid-service can't be rung in.
  const [outNow, setOutNow] = React.useState<Set<string>>(new Set());
  const allergies = React.useMemo(() => tableAllergies(visit), [visit]);
  // No connection: items added here that haven't reached the server, and courses fired that are waiting to be sent.
  const [unsent, setUnsent] = React.useState<Set<string>>(new Set());
  const outbox = useOutbox(tenantId);
  const courses: Course[] = React.useMemo(() => coursesOf(tenant), [tenant]);
  const stations = React.useMemo(() => stationsOf(tenant), [tenant]);

  React.useEffect(() => { let un: any = null; let un2: any = null; let un3: any = null;
    ensureTableVisit(firestore, tenantId, party, tableName, by).then((id) => { setVisitId(id);
      setUnsent(new Set(Object.keys(unsentAll()[id] || {})));
      // Every save of the tab reached the server: nothing on it is "Not sent yet" any more.
      un = onSnapshot(doc(firestore, 'tenants', tenantId, 'appointments', id), { includeMetadataChanges: true }, (s) => { const v: any = s.data() || {}; setVisit(v); setTab((v.tab || []) as TabLine[]);
        if (!s.metadata.hasPendingWrites && Object.keys(unsentAll()[id] || {}).length) setUnsent(markUnsent(id, null, false)); }, () => {});
      un2 = onSnapshot(query(collection(firestore, 'tenants', tenantId, 'kdsTickets'), where('visitId', '==', id)), (s) => { const m: Record<string, string> = {}; const full: Record<string, any> = {};
        s.docs.forEach((d) => { const x: any = d.data() || {}; m[d.id] = String(x.status || 'pending'); full[d.id] = x; }); setStatuses(m); setTickets(full); }, () => {});
      un3 = onSnapshot(query(collection(firestore, 'tenants', tenantId, 'approvals'), where('visitId', '==', id)), (s) => setRecords(s.docs.map((d) => d.data()).filter((r: any) => ['comp', 'void_item', 'remake'].includes(r.kind)).sort((a: any, b: any) => String(a.usedAt || a.createdAt).localeCompare(String(b.usedAt || b.createdAt)))), () => {});
    }).catch(() => setMsg('The table’s visit couldn’t be opened.'));
    return () => { if (un) un(); if (un2) un2(); if (un3) un3(); }; }, [firestore, tenantId, party.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { getDoc(doc(firestore, 'tenants', tenantId)).then((s) => setTenant(s.data() || {})).catch(() => setTenant({})); }, [firestore, tenantId]);
  // A regular's allergies come from their profile (read by the server), once per visit, for the whole table until the
  // server puts them on a seat. A profile that couldn't be read is tried again the next time the table is opened.
  // Kept by visit and guest: a table linked to a regular after it opened (the host stand) takes their profile's too.
  const seeding = React.useRef(''); const [seedFailed, setSeedFailed] = React.useState(false);
  const seed = React.useCallback(async () => { if (!visitId) return; setSeedFailed(false);
    const d = await tabCall({ tenantId, action: 'allergies', op: 'seed', visitId }); if (!d.ok) setSeedFailed(true); }, [tenantId, visitId]);
  React.useEffect(() => {
    const key = `${visitId}|${visit?.clientId || ''}`;
    if (!visitId || !visit || visit.allergiesSeeded || seeding.current === key) return;
    seeding.current = key; void seed();
  }, [visitId, visit]); // eslint-disable-line react-hooks/exhaustive-deps
  // A regular's usual and what the team knows (api/tab 'usual'), read again when the table's guest changes.
  const [usual, setUsual] = React.useState<{ items: { id: string; name: string }[]; words: string; note: string }>({ items: [], words: '', note: '' });
  const guestId = String(visit?.clientId || '');
  React.useEffect(() => { if (!visitId || !guestId || guestId === 'guest-walkin') { setUsual({ items: [], words: '', note: '' }); return; } let live = true;
    void tabCall({ tenantId, action: 'usual', visitId }).then((d) => { if (live && d?.ok) setUsual({ items: Array.isArray(d.usual) ? d.usual : [], words: String(d.words || ''), note: String(d.note || '') }); });
    return () => { live = false; }; }, [tenantId, visitId, guestId]);
  const takeCounts = (d: any) => { if (!d?.ok) return null; const m: Record<string, CountRow> = Object.fromEntries((d.counts || []).map((r: CountRow) => [r.id, r])); setCounts(m);
    if (Array.isArray(d.soldOut)) setOutNow(new Set(d.soldOut.map(String))); return m; };
  const loadCounts = React.useCallback(() => { void tabCall({ tenantId, action: 'counts' }, '/api/menu').then(takeCounts); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { loadCounts(); const i = setInterval(loadCounts, 30000); return () => clearInterval(i); }, [loadCounts]);
  React.useEffect(() => { if (!tenant) return; Promise.all([getDocs(collection(firestore, `tenants/${tenantId}/inventory`)), getDocs(collection(firestore, `tenants/${tenantId}/services`))]).then(([inv, sv]) => {
    // Products as the desk sells them (lib/variants), each with its course, station and make time (lib/table-service).
    const all = inv.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const listings = listingsOf(all);
    const prods = all.filter((x: any) => !x.isBackbar && !x.backbar && x.isArchived !== true && x.status !== 'archived' && !x.hasVariants && !variantIdsOf(x).length && !['equipment', 'overhead'].includes(String(x.type || '')));
    const svcs = sv.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((x: any) => x.isActive !== false && !x.archived);
    // Without a kitchen screen nobody would see a held course to fire it, so everything goes right away.
    const kitchenOn = kitchenScreenOn(tenant);
    setCatalog([...prods.map((x: any) => { const raw = { ...x, category: x.category || listings.get(String(x.id))?.category || x.department || '' };
      const c = courseOfItem(raw, courses);
      return { id: x.id, type: 'product', name: saleName(x, listings), price: deskPrice(x, listings), category: raw.category, course: c && !kitchenOn ? { ...c, hold: false } : c, station: stationOfItem(raw, stations), makeSeconds: x.type === 'refreshment' ? makeSecondsOf(x) : null,
        allergens: itemAllergens(x), allergensKnown: x.type !== 'refreshment' || allergensKnown(x), soldOut: x.type === 'refreshment' && itemSoldOut(x) }; }).filter((x: any) => x.price > 0),
      ...svcs.map((x: any) => ({ id: x.id, type: 'service', name: x.name || 'Service', price: Number(x.price) || 0, category: x.category || '', course: null, station: null, makeSeconds: null }))]); }).catch(() => {}); }, [firestore, tenantId, tenant, courses, stations]);

  const fired = (n: number) => tab.some((l) => Number(l.course) === n && !!l.firedAt);
  const outOf = (it: any, m: Record<string, CountRow> = counts) => it.type === 'product' && (it.soldOut || outNow.has(it.id) || (!!m[it.id] && m[it.id].left <= 0));
  // A dish with an allergen someone it reaches can't have is asked about first (lib/allergens conflicts); so is a dish
  // nobody has said the contents of, when someone it reaches has a severe allergy. A counted dish is checked again first.
  const add = async (it: any) => { if (!visitId) return; setMsg(null);
    let m = counts;
    if (counts[it.id]) { setBusy(true); m = takeCounts(await tabCall({ tenantId, action: 'counts', fresh: true }, '/api/menu')) || counts; setBusy(false); }
    if (outOf(it, m)) { setMsg(`${it.name} is sold out tonight.`); return; }
    const c = it.type === 'product' ? conflicts(it.allergens || [], allergies, seat || null) : { keys: [], who: [] };
    if (c.keys.length) { setWarn({ it, keys: c.keys, who: c.who }); return; }
    const severe = it.type === 'product' && !it.allergensKnown ? reaching(allergies, seat || null).filter((a) => a.severe) : [];
    if (severe.length) { setWarn({ it, keys: [], who: severe, unknown: true }); return; }
    await ringIn(it); };
  const ringIn = async (it: any) => { if (!visitId) return; setBusy(true); setMsg(null);
    const lineId = newLineId(); const vid = visitId;
    try { const sendNow = !!it.course?.hold && fired(it.course.n);
      setUnsent(markUnsent(vid, lineId, true));
      const saving = addToTab(firestore, tenantId, vid, { tableName, guestName: party.name || 'Table' }, it, { seat: seat || null, note: note.trim() || null, by, sendNow, allergies, lineId })
        .then((l) => { setUnsent(markUnsent(vid, lineId, false)); return l; });
      // No answer in a few seconds: the database keeps it on this device and sends it when the connection's back.
      const went = await landed(saving); setNote('');
      const held = it.type === 'product' && it.course?.hold && !sendNow;
      if (!went) setMsg(`${it.name} added${held ? `, held with ${it.course.name.toLowerCase()}` : ''}. It reaches ${it.type !== 'product' ? 'the tab' : it.station || 'the kitchen'} when the connection’s back.`);
      else setMsg(`${it.name} added${it.type !== 'product' ? '' : held ? `, held with ${it.course.name.toLowerCase()}` : `, sent to ${it.station || 'the kitchen'}`}.`); }
    catch { setUnsent(markUnsent(vid, lineId, false)); setMsg('That didn’t save.'); }
    setBusy(false); if (counts[it.id]) loadCounts(); };
  // The table's allergies change on the server, one at a time, with every ticket not yet out (api/tab 'allergies').
  const allergyCall = async (op: 'save' | 'remove' | 'asked', x: any = {}): Promise<string | null> => { if (!visitId) return 'The table isn’t open yet.';
    const d = await tabCall({ tenantId, action: 'allergies', op, visitId, ...x });
    // An allergy never waits on this device: the kitchen has to know now.
    return d.ok ? null : d.offline ? 'No connection, so the allergy didn’t change. Tell the kitchen in person, and change it here when the connection’s back.' : d.error || 'That didn’t save. Try again.'; };
  const askFirst = askAllergiesOf(tenant) && !!visit && !visit.allergiesAsked;
  const fire = async (c: { n: number; name: string }) => { if (!visitId) return; setBusy(true); setMsg(null);
    const d = await tabCall({ tenantId, action: 'fire', visitId, course: c.n }, '/api/tab', `${tableName}: fire ${c.name.toLowerCase()}`); setBusy(false);
    setMsg(d.kept ? `${c.name} fires when the connection’s back. If it’s a while, print a paper ticket.` : d.ok ? `${c.name} fired. The kitchen has it now.` : d.error || 'That didn’t go through.'); };
  // PAPER TICKET (lib/printing paperDoc): what hasn't reached the kitchen's screens with no connection, by station.
  const firesWaiting = React.useMemo(() => new Set(keptNow().filter((k) => k.tenantId === tenantId && k.body?.action === 'fire' && k.body?.visitId === visitId).map((k) => Number(k.body.course))),
    [tenantId, visitId, outbox.waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPaper = tab.filter((l) => !!l.kdsId && ((unsent.has(l.lineId) && !!l.firedAt) || (!l.firedAt && !!l.course && firesWaiting.has(Number(l.course)))));
  const printPaper = () => {
    const raws = onPaper.map((l) => { const al = ticketAllergyFields(allergies, l.seat || null, l.allergens || []);
      return ticketFrom({ id: l.kdsId, itemName: l.name, quantity: l.quantity, seatNumber: l.seat || null, note: l.note || null, tableNumber: tableName, guestName: party.name || 'Table', course: l.course, courseName: l.courseName,
        madeAt: l.station || null, visitId, status: 'pending', allergies: al.allergies, contains: al.contains, createdAt: l.at }, 'kdsTickets'); });
    const per = new Map<string, any[]>(); for (const t of raws) { const k = String((t as any).madeAt || ''); per.set(k, [...(per.get(k) || []), t]); }
    const d = paperDoc(Array.from(per.entries()).map(([station, list]) => ({ station: station || null, tickets: list })), { tz: tenantTimeZone(tenant), at: new Date().toISOString(), by: String(by || '') });
    const w = window.open('', '_blank', 'width=420,height=620');
    if (!w) { setMsg('Allow pop-ups here to print the paper ticket.'); return; }
    w.document.open(); w.document.write(renderHtml(d, { font: PRINT_FONT_STACK, fontHref: PRINT_FONT_HREF })); w.document.close();
    w.onload = () => { const go = () => { w.focus(); w.print(); w.close(); }; const f = (w.document as any).fonts; if (f?.ready) f.ready.then(go, go); else go(); };
  };
  const moveSeat = async (l: TabLine, s: string) => { if (!visitId) return; const d = await tabCall({ tenantId, action: 'seat', visitId, lineId: l.lineId, seat: s || null }); if (!d.ok) setMsg(d.error || 'That didn’t move.'); };

  // PRINT THE CHECK (lib/printing-server): at the business's check printer, or this device's own print dialog without one.
  const [printing, setPrinting] = React.useState(false); const [printMsg, setPrintMsg] = React.useState('');
  const printCheck = async () => {
    if (!visitId) return; setPrinting(true); setPrintMsg('');
    const r = await tabCall({ tenantId, action: 'print_check', visitId });
    setPrinting(false);
    if (!r?.ok) { setPrintMsg(r?.error || 'The check couldn’t be printed.'); return; }
    if (r.printer) { setPrintMsg(`Printing at ${r.printer}.`); return; }
    const w = window.open('', '_blank', 'width=420,height=620');
    if (r.down) setPrintMsg(`${r.down} isn’t answering, so the check opens here to print.`);
    if (!w) { setPrintMsg(`${r.down ? `${r.down} isn’t answering. ` : ''}Allow pop-ups here to print the check.`); return; }
    w.document.open(); w.document.write(renderHtml(r.doc, { font: PRINT_FONT_STACK, fontHref: PRINT_FONT_HREF })); w.document.close();
    w.onload = () => { const go = () => { w.focus(); w.print(); w.close(); }; const f = (w.document as any).fonts; if (f?.ready) f.ready.then(go, go); else go(); };
  };
  // Their usual, as the menu has it now (an item no longer on the menu isn't offered).
  const usualItems = usual.items.map((u) => catalog.find((x) => x.type === 'product' && x.id === u.id)).filter(Boolean) as any[];
  const t = q.trim().toLowerCase(); const shown = t ? catalog.filter((x) => x.name.toLowerCase().includes(t) || String(x.category).toLowerCase().includes(t)).slice(0, 24) : catalog.slice(0, 12);
  const seats = Array.from({ length: Math.max(1, Math.min(20, Number(party.size) || 1)) }, (_, i) => String(i + 1));
  // The tab by course: what goes right away first, then each course in order.
  const groups = React.useMemo(() => {
    const m = new Map<string, { key: string; course: Course | null; lines: TabLine[] }>();
    for (const l of tab) { const c = l.course ? courses.find((x) => x.n === Number(l.course)) || { n: Number(l.course), name: l.courseName || `Course ${l.course}`, hold: false } : null;
      const k = c ? `c${c.n}` : 'now'; const g = m.get(k) || { key: k, course: c, lines: [] }; g.lines.push(l); m.set(k, g); }
    return Array.from(m.values()).sort((a, b) => (a.course?.n ?? 0) - (b.course?.n ?? 0));
  }, [tab, courses]);
  const waiting = groups.filter((g) => g.course && g.lines.some((l) => !l.firedAt && l.kdsId && statuses[l.kdsId] !== 'cancelled'));
  const comps = tabComps(tab);

  return (
    <div className="space-y-3" style={{ color: INK }}>
      <section className="rounded-3xl bg-[#fff] p-4 space-y-1" style={{ border: `1px solid ${LINE}` }}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[19px] font-semibold">{tableName}, {party.name}</p>
          <p className="text-[19px] font-semibold tabular-nums">{money(tabTotal(tab))}</p>
        </div>
        {comps > 0 && <p className="text-[13px]" style={{ color: MUTED }}>{money(comps)} comped</p>}
        {!tab.length && <p className="text-[14px] pt-1" style={{ color: MUTED }}>Nothing on the tab yet.</p>}
        {groups.map((g) => {
          const stage = courseStage(g.lines, statuses);
          // No connection: a course fired here that's waiting to be sent, or items that haven't reached the server.
          const fireKept = !!g.course && firesWaiting.has(g.course.n); const notSent = g.lines.some((l) => unsent.has(l.lineId));
          const st = fireKept ? { text: 'Fire waiting to send', bg: AMBER_TINT, fg: AMBER } : notSent ? { text: 'Not sent yet', bg: AMBER_TINT, fg: AMBER } : STAGE[stage];
          const unfired = g.course && stage === 'unfired' && !fireKept;
          return (
            <div key={g.key} className="pt-3 mt-2" style={{ borderTop: `1px solid ${LINE}` }}>
              <div className="flex flex-wrap items-center gap-2 min-h-[44px]">
                <h3 className="text-[16px] font-semibold">{g.course ? g.course.name : 'Right away'}</h3>
                <span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: st.bg, color: st.fg }}>{st.text}</span>
                {unfired && <span className="text-[13px]" style={{ color: MUTED }}>Takes about {prepMinutes(g.lines.filter((l) => !l.firedAt))} min once fired</span>}
                <span className="flex-1" />
                {unfired && <button type="button" disabled={busy} onClick={() => fire(g.course!)} className={btn} style={dark}>Fire {g.course!.name.toLowerCase()}</button>}
              </div>
              {g.lines.map((l) => {
                const open = picked === l.lineId; const status = l.kdsId ? statuses[l.kdsId] : null; const started = kitchenStarted(status);
                return (
                  <div key={l.lineId} className="rounded-2xl" style={open ? { background: SOFT, margin: '2px -8px', padding: '2px 8px 10px' } : undefined}>
                    <button type="button" onClick={() => setPicked(open ? null : l.lineId)} aria-expanded={open} className="w-full grid items-center gap-2 min-h-[48px] text-left" style={{ gridTemplateColumns: '32px 1fr auto' }}>
                      <span className="h-7 w-7 rounded-full grid place-items-center text-[13px] font-semibold" style={{ background: open ? '#fff' : SOFT }}>{l.seat || 'T'}</span>
                      <span className="min-w-0"><span className="block text-[15px] font-medium truncate">{l.name}</span>
                        {unsent.has(l.lineId) && <span className="block text-[12.5px] font-semibold" style={{ color: AMBER }}>Not sent yet</span>}
                        <span className="block text-[12.5px] truncate" style={{ color: l.comp ? GREEN : MUTED }}>{l.comp ? `Comped: ${l.comp.reason}. ${l.comp.approvedBy !== l.comp.by ? `${l.comp.approvedBy} approved.` : ''}` : [l.station, l.note, status === 'ready' ? 'Ready' : status === 'delivered' ? 'Out' : null].filter(Boolean).join(', ')}</span>
                        {l.kdsId && Array.isArray(tickets[l.kdsId]?.allergies) && tickets[l.kdsId].allergies.length > 0 && <span className="block text-[12.5px] font-semibold truncate" style={{ color: AMBER }}>{tickets[l.kdsId].allergyNotedAt ? `Allergy noted${tickets[l.kdsId].allergyNotedBy ? ` by ${tickets[l.kdsId].allergyNotedBy}` : ''}` : `Allergy: ${tickets[l.kdsId].allergies.map((a: any) => String(a?.name || a)).join(', ').toLowerCase()}`}</span>}</span>
                      <span className="text-right tabular-nums"><span className="block text-[15px] font-semibold">{money(l.price)}</span>{l.comp && <span className="block text-[12px] line-through" style={{ color: MUTED }}>{money(listPriceOf(l))}</span>}</span>
                    </button>
                    {open && (
                      <div className="flex flex-wrap items-center gap-2 pl-10">
                        {l.itemType === 'product' && !l.comp && <button type="button" onClick={() => setSheet({ kind: 'comp', line: l })} className={btn} style={quiet}>Comp</button>}
                        <button type="button" onClick={() => setSheet({ kind: 'void', line: l })} className={btn} style={quiet}>Void</button>
                        {started && <button type="button" onClick={() => setSheet({ kind: 'remake', line: l })} className={btn} style={quiet}>Make again</button>}
                        <select value={l.seat || ''} onChange={(e) => moveSeat(l, e.target.value)} aria-label={`Seat for ${l.name}`} className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold bg-[#fff]" style={{ border: `1px solid ${LINE}` }}>
                          <option value="">Table</option>{seats.map((s) => <option key={s} value={s}>Seat {s}</option>)}
                        </select>
                        <span className="text-[12.5px]" style={{ color: MUTED }}>{!l.kdsId ? '' : status === 'unfired' || !status ? 'Not started, so a void needs only a reason' : started ? 'The kitchen has started it' : 'Waiting at the kitchen'}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      {onPaper.length > 0 && (
        <section role="status" className="rounded-3xl p-4 space-y-3" style={{ background: AMBER_TINT, color: AMBER }} aria-label="Not at the kitchen yet">
          <p className="text-[14.5px] leading-snug"><b className="font-semibold">{onPaper.length === 1 ? '1 item hasn’t' : `${onPaper.length} items haven’t`} reached the kitchen.</b> {onPaper.length === 1 ? 'It goes' : 'They go'} by {onPaper.length === 1 ? 'itself' : 'themselves'} when the connection’s back. If it’s down for a while, print a paper ticket or walk it over.</p>
          <button type="button" onClick={printPaper} className={btn} style={dark}>Print a paper ticket</button>
        </section>
      )}

      {visitId && (
        <section className="rounded-3xl bg-[#fff] p-4 space-y-2" style={{ border: `1px solid ${LINE}` }} aria-label="Allergies">
          <div className="flex items-center gap-2 min-h-[44px]">
            <h3 className="flex-1 text-[16px] font-semibold">Allergies</h3>
            <button type="button" onClick={() => setAllergySheet({ edit: null })} className={btn} style={quiet}>Add an allergy</button>
          </div>
          {seedFailed && <div className="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2" style={{ background: AMBER_TINT }} role="alert">
            <p className="flex-1 min-w-[180px] text-[14px] font-semibold" style={{ color: AMBER }}>Their profile’s allergies couldn’t be loaded. Ask the table, or try again.</p>
            <button type="button" onClick={() => void seed()} className={btn} style={quiet}>Try again</button></div>}
          {allergies.length > 0 && <div className="flex flex-wrap gap-2">{allergies.map((a) => (
            <span key={a.id} className="inline-flex min-h-[44px] items-center gap-1 rounded-full pl-3.5 pr-1 text-[13.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>
              <button type="button" onClick={() => setAllergySheet({ edit: a })} className="min-h-[44px] text-left">{allergyLine(a)}{a.from === 'profile' ? <span className="font-medium" style={{ color: MUTED }}> {a.by ? `from ${a.by}` : ''}</span> : null}</button>
              {removing === a.id
                ? <span className="flex items-center gap-1 pl-1"><button type="button" onClick={() => { setRemoving(null); void allergyCall('remove', { id: a.id }).then((e) => e && setMsg(e)); }} className="min-h-[44px] rounded-full px-3 text-[13px] font-semibold text-[#fff]" style={{ background: AMBER }}>Remove</button>
                    <button type="button" onClick={() => setRemoving(null)} className="min-h-[44px] rounded-full px-3 text-[13px] font-semibold">Keep</button></span>
                : <button type="button" onClick={() => setRemoving(a.id)} aria-label={`Remove ${allergyLine(a)}`} className="h-11 w-11 rounded-full grid place-items-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={AMBER} strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>}
            </span>))}</div>}
          {askFirst
            ? <div className="flex flex-wrap items-center gap-2 rounded-2xl p-3" style={{ background: SOFT }}>
                <p className="flex-1 min-w-[180px] text-[14.5px] font-medium">{allergies.length ? 'Anyone else at the table with an allergy?' : 'Anyone at the table with an allergy?'}</p>
                <button type="button" onClick={() => void allergyCall('asked').then((e) => e && setMsg(e))} className={btn} style={quiet}>{allergies.length ? 'No one else' : 'No allergies'}</button>
                <button type="button" onClick={() => setAllergySheet({ edit: null })} className={btn} style={dark}>Add one</button>
              </div>
            : <p className="text-[12.5px]" style={{ color: MUTED }}>{allergies.length ? 'Every dish for these seats tells the kitchen, and the cook taps Allergy noted before it’s marked ready.' : 'None noted for this table.'}</p>}
        </section>
      )}

      {records.length > 0 && (
        <section className="rounded-3xl bg-[#fff] p-4 space-y-2" style={{ border: `1px solid ${LINE}` }}>
          <h3 className="text-[16px] font-semibold">Comps and voids</h3>
          {records.map((r: any, i: number) => (
            <div key={r.id || i} className="space-y-0.5 pt-2" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
              <div className="flex justify-between gap-2 text-[14.5px] font-medium"><span>{r.itemName}, {r.kind === 'comp' ? 'comped' : r.kind === 'remake' ? 'made again' : 'voided'}</span><span className="tabular-nums">{r.kind === 'remake' ? '' : money(r.amount)}</span></div>
              <p className="text-[12.5px]" style={{ color: MUTED }}>{r.reason}. {r.askedBy || r.requestedBy}{r.approverName && r.approverName !== (r.askedBy || r.requestedBy) ? ` asked, ${r.approverName} approved` : ''}.{r.wasteCost ? ` ${money(r.wasteCost)} waste.` : ''}</p>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-3xl bg-[#fff] p-4 space-y-2" style={{ border: `1px solid ${LINE}` }}>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={!seat} onClick={() => setSeat('')} className="min-h-[44px] rounded-full px-4 text-[13px] font-semibold" style={!seat ? dark : { background: SOFT }}>Table</button>
          {seats.map((s) => <button key={s} type="button" aria-pressed={seat === s} onClick={() => setSeat(s)} className="min-h-[44px] min-w-[44px] rounded-full px-3 text-[13px] font-semibold" style={seat === s ? dark : { background: SOFT }}>Seat {s}</button>)}
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 80))} placeholder="Note for the kitchen, like no onions" aria-label="Note for the kitchen" className="h-11 w-full rounded-xl px-3 text-[15px] outline-none bg-[#fff]" style={{ border: `1px solid ${LINE}` }} />
        {(usual.words || usual.note || usualItems.length > 0) && <div className="space-y-1.5 pt-1">
          {usualItems.length > 0 && <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Their usual</p>}
          {usualItems.length > 0 && <div className="flex flex-wrap gap-2">{usualItems.map((it) => (
            <button key={it.id} type="button" disabled={busy || !visitId || outOf(it)} onClick={() => add(it)} className="min-h-[44px] rounded-full px-4 text-[14px] font-semibold disabled:opacity-40" style={{ border: `1px solid ${LINE}` }}>+ {it.name}</button>))}</div>}
          {(usual.words || usual.note) && <p className="text-[13px] leading-snug" style={{ color: MUTED }}>{usual.words}{usual.note ? `${usual.words ? ' ' : ''}Note: ${usual.note}` : ''}</p>}
        </div>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="h-11 w-full rounded-xl px-3 text-[15px] outline-none bg-[#fff]" style={{ border: `1px solid ${LINE}` }} />
        <div className="grid grid-cols-2 gap-2">{shown.map((it) => { const out = outOf(it); const cnt = counts[it.id]; const hit = it.type === 'product' && conflicts(it.allergens || [], allergies, seat || null).keys.length > 0;
          return <button key={`${it.type}:${it.id}`} type="button" disabled={busy || !visitId || out} onClick={() => add(it)} className="rounded-2xl p-3 text-left disabled:opacity-40" style={{ background: SOFT, ...(hit ? { boxShadow: `inset 0 0 0 1.5px ${AMBER}` } : {}) }}>
          <span className="block text-[14px] font-semibold">{it.name}</span>
          <span className="block text-[12px] tabular-nums" style={{ color: MUTED }}>{out ? 'Sold out tonight' : <>{money(it.price)}{it.course ? `, ${it.course.name}` : ''}{cnt ? <span style={{ color: lowCount(cnt) ? AMBER : MUTED }}>, {leftWords(cnt)}</span> : null}</>}</span>
          {!out && (it.allergens || []).length > 0 && <span className="block text-[12px]" style={{ color: hit ? AMBER : MUTED, fontWeight: hit ? 600 : 400 }}>{wordsList(it.allergens)}</span>}</button>; })}</div>
      </section>
      {msg && <p className="text-[14px] font-semibold" role="status">{msg}</p>}
      {waiting.length > 0 && tab.length > 0 && <p className="text-[13px]" style={{ color: AMBER }}>{waiting.map((g, i) => (i ? g.course!.name.toLowerCase() : g.course!.name)).join(' and ')} {waiting.length === 1 ? 'hasn’t' : 'haven’t'} been fired. Fire {waiting.length === 1 ? 'it' : 'them'} or void what they didn’t want before checking out.</p>}
      {visitId && tab.length > 0 && tablePayOf(tenant).on && <TablePayCard tenantId={tenantId} visitId={visitId} table={tableName} poke={`${visit?.payPaidSoFar || 0}|${tab.length}`} onPaid={(paid) => setPaidHere(paid)} />}
      {visitId && tab.length > 0 && <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={printing} onClick={printCheck} className="min-h-[44px] rounded-xl border bg-[#fff] px-4 text-[14px] font-semibold disabled:opacity-50" style={{ borderColor: LINE }}>{printing ? 'Printing…' : 'Print the check'}</button>
        {printMsg && <p role="status" className="text-[13.5px]" style={{ color: MUTED }}>{printMsg}</p>}
      </div>}
      {paidHere > 0
        ? <p className="text-[13px]" style={{ color: MUTED }}>Part of this check was paid at the table, so it’s finished there, not at the desk.</p>
        : <a href={visitId ? `/pos?checkout=${encodeURIComponent(visitId)}&tab=1` : '#'} aria-disabled={!visitId || !tab.length || waiting.length > 0}
            className={`flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold ${!visitId || !tab.length || waiting.length > 0 ? 'pointer-events-none opacity-40' : ''}`} style={dark}>Check out {tableName}, {money(tabTotal(tab))}</a>}
      {allergySheet && <AllergySheet edit={allergySheet.edit} seats={seats} by={by} onClose={() => setAllergySheet(null)}
        onSave={async (a) => { const e = await allergyCall('save', { allergy: a }); if (!e) { setAllergySheet(null); setMsg('Allergy saved. The kitchen sees it on every dish for that seat.'); } return e; }} />}
      {warn && <AllergyWarn it={warn.it} keys={warn.keys} who={warn.who} unknown={!!warn.unknown} onClose={() => setWarn(null)} onRing={() => { const it = warn.it; setWarn(null); void ringIn(it); }} />}
      {sheet && visitId && <ActionSheet sheet={sheet} tenantId={tenantId} visitId={visitId} reasons={compReasonsOf(tenant)} onClose={(done) => { setSheet(null); if (done) { setMsg(done); setPicked(null); } }} />}
    </div>
  );
}

function ActionSheet({ sheet, tenantId, visitId, reasons, onClose }: { sheet: Sheet; tenantId: string; visitId: string; reasons: string[]; onClose: (done?: string) => void }) {
  const { kind, line } = sheet;
  const [need, setNeed] = React.useState<{ pin: boolean; why: string | null; started: boolean; allowanceLeftCents: number | null } | null>(null);
  const [reason, setReason] = React.useState(''); const [other, setOther] = React.useState('');
  const [part, setPart] = React.useState(false); const [amt, setAmt] = React.useState('');
  const [stop, setStop] = React.useState(true); const [pin, setPin] = React.useState(''); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (kind === 'remake') { setNeed({ pin: false, why: null, started: true, allowanceLeftCents: null }); return; }
    tabCall({ tenantId, action: 'need', visitId, lineId: line.lineId, kind }).then((d) => { if (d.ok) setNeed(d); else setErr(d.error || 'That item couldn’t be checked.'); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const price = Number(line.price) || 0;
  const cents = kind === 'comp' ? (part ? Math.round(Math.max(0, Number(amt) || 0) * 100) : Math.round(price * 100)) : 0;
  // A comp's PIN depends on how much: over what's left of the allowance tonight, a manager approves.
  const pinNeeded = !!need && (kind === 'comp' ? need.allowanceLeftCents !== null && cents > need.allowanceLeftCents : need.pin);
  const why = reason === OTHER_REASON ? other.trim() : reason;
  const list = kind === 'comp' ? reasons : kind === 'void' ? VOID_REASONS : REMAKE_REASONS;
  const ready = !!need && !!why && (!pinNeeded || pin.length === 4) && (kind !== 'comp' || (cents > 0 && cents <= Math.round(price * 100)));
  const go = async () => {
    setBusy(true); setErr('');
    let approvalToken: string | undefined;
    if (pinNeeded) { const a = await approveWithPin(tenantId, pin, { kind: kind === 'comp' ? 'comp' : 'void_item', amount: kind === 'comp' ? cents / 100 : null, ref: `${visitId}:${line.lineId}`, reason: why });
      if (!a.ok || !a.token) { setBusy(false); setPin(''); setErr(a.error || 'That PIN wasn’t accepted.'); return; } approvalToken = a.token; }
    const d = await tabCall({ tenantId, action: kind, visitId, lineId: line.lineId, reason: why, ...(kind === 'comp' ? (part ? { cents } : { all: true }) : {}), ...(kind === 'void' ? { stopKitchen: stop } : {}), ...(approvalToken ? { approvalToken } : {}) });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'That didn’t go through.'); return; }
    onClose(kind === 'comp' ? `${line.name} comped, ${money(d.amount)}.` : kind === 'void' ? `${line.name} voided.${d.started && d.waste ? ` ${money(d.waste)} counts as waste.` : ''}` : `${line.name} is being made again.`);
  };
  const title = kind === 'comp' ? `Comp ${line.name}` : kind === 'void' ? `Void ${line.name}` : `Make ${line.name} again`;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 space-y-4 max-h-[92dvh] overflow-y-auto" style={{ color: INK }}>
        <div className="flex items-start gap-3">
          <div className="flex-1"><h2 className="text-[20px] font-semibold leading-tight">{title}</h2><p className="text-[14px]" style={{ color: MUTED }}>{line.seat ? `Seat ${line.seat}, ` : ''}{money(price)}</p></div>
          <button type="button" onClick={() => onClose()} aria-label="Close" className="h-11 w-11 rounded-xl grid place-items-center" style={quiet}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </div>
        {kind === 'void' && need?.started && <div className="rounded-2xl p-4 text-[14px]" style={{ background: AMBER_TINT }}><b className="font-semibold">The kitchen has started it.</b> It comes off the check, and what it cost to make counts as waste.</div>}
        {kind === 'remake' && <p className="rounded-2xl p-4 text-[14px]" style={{ background: SOFT }}>It stays on the check once. A fresh one goes to {line.station || 'the kitchen'}, and the first counts as waste.</p>}
        {kind === 'comp' && (
          <div className="space-y-2"><p className="text-[14px] font-semibold">How much</p>
            <div role="radiogroup" className="flex rounded-xl p-1 gap-1" style={{ background: SOFT }}>
              <button type="button" role="radio" aria-checked={!part} onClick={() => setPart(false)} className="flex-1 min-h-[44px] rounded-lg text-[14px] font-semibold" style={!part ? { background: '#fff' } : { color: MUTED }}>All of it, {money(price)}</button>
              <button type="button" role="radio" aria-checked={part} onClick={() => setPart(true)} className="flex-1 min-h-[44px] rounded-lg text-[14px] font-semibold" style={part ? { background: '#fff' } : { color: MUTED }}>Part of it</button>
            </div>
            {part && <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} placeholder="Amount off, like 5.00" aria-label="Amount off" className="h-11 w-full rounded-xl px-3 text-[15px] outline-none" style={{ border: `1px solid ${LINE}` }} />}
          </div>
        )}
        <div className="space-y-2"><p className="text-[14px] font-semibold">Why</p>
          <div className="flex flex-wrap gap-2">{[...list, OTHER_REASON].map((r) => <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className="min-h-[44px] rounded-full px-4 text-[14px] font-medium" style={reason === r ? dark : quiet}>{r}</button>)}</div>
          {reason === OTHER_REASON && <input value={other} onChange={(e) => setOther(e.target.value.slice(0, 80))} placeholder="A few words" aria-label="Reason" className="h-11 w-full rounded-xl px-3 text-[15px] outline-none" style={{ border: `1px solid ${LINE}` }} />}
        </div>
        {kind === 'void' && need?.started && (
          <label className="flex items-center gap-3 rounded-2xl p-3 min-h-[44px]" style={{ border: `1px solid ${LINE}` }}>
            <span className="flex-1"><span className="block text-[15px] font-semibold">Tell {line.station || 'the kitchen'} to stop</span><span className="block text-[13px]" style={{ color: MUTED }}>It comes off their screen right away</span></span>
            <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} className="h-6 w-6" style={{ accentColor: GREEN }} />
          </label>
        )}
        {pinNeeded && (
          <div className="rounded-2xl p-4 space-y-2" style={{ background: SOFT }}>
            <p className="text-[14px] font-semibold">A manager’s PIN</p>
            <p className="text-[13px]" style={{ color: MUTED }}>{kind === 'comp' ? 'Over your allowance for tonight, so a manager approves.' : need?.why}</p>
            <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} aria-label="Manager’s PIN" placeholder="4 digits" className={`h-12 w-40 rounded-xl px-3 text-[20px] outline-none bg-[#fff] ${pin ? 'tracking-[0.4em]' : ''}`} style={{ border: `1px solid ${LINE}` }} />
          </div>
        )}
        {err && <p className="text-[14px] font-semibold" style={{ color: RED }} role="alert">{err}</p>}
        <button type="button" disabled={!ready || busy} onClick={go} className="w-full min-h-[52px] rounded-2xl text-[16px] font-semibold disabled:opacity-40" style={kind === 'void' ? { background: RED, color: '#fff' } : dark}>
          {kind === 'comp' ? `Comp ${money(cents / 100)}` : kind === 'void' ? `Void ${money(price)}` : 'Make it again'}
        </button>
      </div>
    </div>
  );
}

// ─── An allergy at the table: whose seat, what, anything else in their words, how serious ───────────────────────────
function AllergySheet({ edit, seats, by, onClose, onSave }: { edit: TableAllergy | null; seats: string[]; by: string; onClose: () => void; onSave: (a: TableAllergy) => Promise<string | null> }) {
  const [seat, setSeat] = React.useState<string>(edit?.seat || ''); const [keys, setKeys] = React.useState<AllergenKey[]>(edit?.keys || []);
  const [other, setOther] = React.useState(edit?.other || ''); const [severe, setSevere] = React.useState(!!edit?.severe);
  const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const toggle = (k: AllergenKey) => setKeys((cur) => cleanKeys(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const can = keys.length > 0 || !!other.trim();
  const go = async () => { setBusy(true); setErr('');
    const e = await onSave({ id: edit?.id || '', seat: seat || null, keys, other: other.trim().slice(0, 60) || null, severe, from: edit?.from || 'asked', by: edit?.by || by, at: edit?.at || new Date().toISOString() });
    setBusy(false); if (e) setErr(e); };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-label={edit ? 'Change an allergy' : 'Add an allergy'}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 space-y-4 max-h-[92dvh] overflow-y-auto" style={{ color: INK }}>
        <div className="flex items-start gap-3">
          <h2 className="flex-1 text-[20px] font-semibold leading-tight">{edit ? 'Change an allergy' : 'Add an allergy'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 rounded-xl grid place-items-center" style={quiet}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </div>
        <div className="space-y-2"><p className="text-[14px] font-semibold">Who</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={!seat} onClick={() => setSeat('')} className="min-h-[44px] rounded-full px-4 text-[13px] font-semibold" style={!seat ? dark : { background: SOFT }}>Whole table</button>
            {seats.map((x) => <button key={x} type="button" aria-pressed={seat === x} onClick={() => setSeat(x)} className="min-h-[44px] min-w-[44px] rounded-full px-3 text-[13px] font-semibold" style={seat === x ? dark : { background: SOFT }}>Seat {x}</button>)}
          </div>
          {!seat && <p className="text-[12.5px]" style={{ color: MUTED }}>When you don’t know whose it is: every dish for the table tells the kitchen.</p>}
        </div>
        <div className="space-y-2"><p className="text-[14px] font-semibold">Allergic to</p>
          <div className="flex flex-wrap gap-2">{ALLERGENS.map((a) => <button key={a.key} type="button" aria-pressed={keys.includes(a.key)} onClick={() => toggle(a.key)} className="min-h-[44px] rounded-full px-4 text-[14px] font-medium" style={keys.includes(a.key) ? dark : quiet}>{a.label}</button>)}</div>
          <input value={other} onChange={(e) => setOther(e.target.value.slice(0, 60))} placeholder="Anything else, like mustard" aria-label="Anything else they’re allergic to" className="h-11 w-full rounded-xl px-3 text-[15px] outline-none" style={{ border: `1px solid ${LINE}` }} />
        </div>
        <label className="flex items-center gap-3 rounded-2xl p-3 min-h-[44px]" style={{ border: `1px solid ${LINE}` }}>
          <span className="flex-1"><span className="block text-[15px] font-semibold">Severe</span><span className="block text-[13px]" style={{ color: MUTED }}>They carry an EpiPen, or even a trace is a problem</span></span>
          <input type="checkbox" checked={severe} onChange={(e) => setSevere(e.target.checked)} className="h-6 w-6" style={{ accentColor: AMBER }} />
        </label>
        {err && <p className="text-[14px] font-semibold" style={{ color: RED }} role="alert">{err}</p>}
        <button type="button" disabled={!can || busy} onClick={go} className="w-full min-h-[52px] rounded-2xl text-[16px] font-semibold disabled:opacity-40" style={dark}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

// ─── Ringing in a dish that has someone's allergen: asked first, the safe choice first ─────────────────────────────
function AllergyWarn({ it, keys, who, unknown, onClose, onRing }: { it: any; keys: AllergenKey[]; who: TableAllergy[]; unknown: boolean; onClose: () => void; onRing: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="alertdialog" aria-modal="true" aria-labelledby="warn-title">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 space-y-3" style={{ color: INK }}>
        <h2 id="warn-title" className="text-[20px] font-semibold leading-tight">{unknown ? `Nobody has said what’s in ${it.name}` : `${it.name} has ${wordsList(keys)}`}</h2>
        <div className="space-y-0.5">{who.map((a) => { const k = unknown ? a.keys : a.keys.filter((x) => keys.includes(x));
          return <p key={a.id} className="text-[15px]" style={{ color: MUTED }}>{whoWords(a)} has {k.length ? allergyPhrase(k, a.severe) : `a severe allergy${a.other ? ` (${a.other})` : ''}`}.</p>; })}</div>
        {unknown && <p className="text-[14px]" style={{ color: MUTED }}>Check with the kitchen before ringing it in. A manager can say what it contains on the Menu page.</p>}
        <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>If you ring it in, the kitchen sees the allergy on the ticket and has to tap Allergy noted before it’s ready.</p>
        <button type="button" onClick={onClose} autoFocus className="w-full min-h-[52px] rounded-2xl text-[16px] font-semibold" style={dark}>Pick something else</button>
        <button type="button" onClick={onRing} className="w-full min-h-[48px] rounded-2xl text-[15px] font-semibold" style={quiet}>Ring it in, the kitchen will make it safe</button>
      </div>
    </div>
  );
}
