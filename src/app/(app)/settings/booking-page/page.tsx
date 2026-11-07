'use client';
// src/app/(app)/settings/booking-page/page.tsx — BOOKING PAGE: what clients see when they book. One design for every
// business; the owner chooses what makes it theirs (lib/studio-page): the color, the headline, description and cover
// photo, which sections show and in what order, and the photos, about words and questions in a few of them. Each change
// saves as it's made and the preview beside it reloads. Anything written in the old page builder carries over.
import * as React from 'react';
import { doc, updateDoc, deleteField, type Firestore } from 'firebase/firestore';
import { ChevronRight, GripVertical, ImagePlus, Trash2, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { uploadImage } from '@/lib/upload-image';
import { SettingsPage, Section, Row, Toggle, Choice, cfInput, cfInputStyle } from '@/components/settings/settings-ui';
import { Sheet } from '@/components/orders/ui';
import { moduleEnabled } from '@/lib/modules';
import { spacesSettings, SPACES_LIMITS } from '@/lib/spaces-section';
import { oldPageExtras } from '@/lib/studio-page';
import { studioPage, comingEvents, eventToday, sectionSwitch, SECTIONS, COLORS, MOODS, readable, whiteContrast, colorName, headlineParts, type SectionId, type Photo, type Faq, type Mood, type VisitNotes } from '@/lib/studio-page';

const field = (k: string) => `bookingPageSettings.studio.${k}`;
/** A value with every empty field taken out (the database refuses an empty field inside a list or a map). */
function clean(v: any): any {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)]));
  return v;
}
/** Whether the screen is at least this wide, kept up to date. */
function useWide(px: number) {
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => { const m = window.matchMedia(`(min-width: ${px}px)`); const f = () => setWide(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, [px]);
  return wide;
}
/** A label wrapping a hidden file or color input shows a focus ring when the input inside it has keyboard focus. */
const FOCUS_WITHIN = 'focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-[var(--accent)]';

/** The most common strong color in a logo, or null when it can't be read (a logo stored where the browser can't look). */
async function logoColor(url: string): Promise<string | null> {
  try {
    const img = new Image(); img.crossOrigin = 'anonymous';
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('x')); img.src = url; });
    const c = document.createElement('canvas'); c.width = 48; c.height = 48; const g = c.getContext('2d'); if (!g) return null;
    g.drawImage(img, 0, 0, 48, 48); const d = g.getImageData(0, 0, 48, 48).data; const tally = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) {
      const [r, gr, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]]; if (a < 200) continue;
      const max = Math.max(r, gr, b), min = Math.min(r, gr, b); if (max - min < 40 || max < 40 || min > 225) continue;
      const k = [r, gr, b].map((v) => Math.round(v / 32) * 32).map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join(''); tally.set(k, (tally.get(k) || 0) + 1);
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]; return best ? `#${best[0]}` : null;
  } catch { return null; }
}

export default function BookingPageSettings() {
  const { selectedTenant, role } = useTenant() as any;
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const t = selectedTenant; const tenantId: string = t?.id || '';
  // The business record (where these settings live) can be changed by its owner only.
  const isMgr = String(role || '').toLowerCase() === 'owner';
  const xl = useWide(1280);
  const page = React.useMemo(() => studioPage(t), [t]);
  const [stamp, setStamp] = React.useState(0);
  const [pub, setPub] = React.useState<{ services: any[]; staff: any[]; events: any[] } | null>(null);
  const [sheet, setSheet] = React.useState<'work' | 'about' | 'faqs' | 'visit' | 'spaces' | null>(null);
  // What's typed or uploaded in an editor stays here if it's closed without saving, and comes back when it's opened.
  const [drafts, setDrafts] = React.useState<{ work?: Photo[]; about?: { text: string; photo: Photo | null }; faqs?: Faq[]; visit?: VisitNotes; spaces?: SpacesDraft }>({});
  React.useEffect(() => { setDrafts({}); }, [tenantId]);
  const [busy, setBusy] = React.useState('');

  React.useEffect(() => {
    if (!tenantId) return;
    fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId }) })
      .then((r) => r.json()).then((d) => { if (d?.ok) setPub({ services: d.services || [], staff: d.staff || [], events: d.studioEvents || [] }); }).catch(() => {});
  }, [tenantId]);

  /** Saves one or more fields, then reloads the preview. undefined removes a field. */
  const save = async (patch: Record<string, any>, label: string) => {
    if (!isMgr || !tenantId) return false;
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), Object.fromEntries(Object.entries(patch).map(([k, v]) => [field(k), v === undefined ? deleteField() : clean(v)])));
      setStamp((n) => n + 1); toast({ title: `${label} saved` }); return true;
    } catch { toast({ variant: 'destructive', title: 'That didn’t save', description: 'Check your connection and try again.' }); return false; }
  };

  const link = typeof window !== 'undefined' && tenantId ? `${window.location.origin}/book/${tenantId}` : '';
  const [copied, setCopied] = React.useState(false);
  const qrDownload = async () => {
    try { const QR: any = await import('qrcode'); const url = await QR.toDataURL(link, { margin: 2, width: 1024 }); const a = document.createElement('a'); a.href = url; a.download = 'booking-page-qr.png'; document.body.appendChild(a); a.click(); a.remove(); }
    catch { toast({ variant: 'destructive', title: 'The QR code didn’t download. Try again.' }); }
  };

  const [fromLogo, setFromLogo] = React.useState<string | null>(null);
  React.useEffect(() => { let alive = true; setFromLogo(null); if (t?.logoUrl) void logoColor(t.logoUrl).then((c) => { if (alive) setFromLogo(c); }); return () => { alive = false; }; }, [t?.logoUrl]);
  const color = page.color || '#16171a';
  // The free picker sends a color on every move; it's saved once the owner settles on one.
  const [picking, setPicking] = React.useState<string | null>(null);
  React.useEffect(() => { if (!picking) return; const v = picking; const h = setTimeout(() => { void save({ color: v }, 'Color').then(() => setPicking((p) => (p === v ? null : p))); }, 700); return () => clearTimeout(h); }, [picking]); // eslint-disable-line react-hooks/exhaustive-deps
  // A color still settling when the owner leaves the page is saved on the way out.
  const pickingRef = React.useRef<string | null>(null); pickingRef.current = picking;
  const saveRef = React.useRef(save); saveRef.current = save;
  React.useEffect(() => () => { if (pickingRef.current) void saveRef.current({ color: pickingRef.current }, 'Color'); }, []);
  const named = colorName(color);
  const darkened = page.color && whiteContrast(page.color) < 4.5;

  const [headline, setHeadline] = React.useState(''); const [description, setDescription] = React.useState('');
  const editing = React.useRef<'headline' | 'description' | null>(null);
  // Each field follows what's saved, except while the owner is typing in it.
  React.useEffect(() => { if (editing.current !== 'headline') setHeadline(page.headline); }, [tenantId, page.headline]);
  React.useEffect(() => { if (editing.current !== 'description') setDescription(page.description); }, [tenantId, page.description]);
  const [plain, bold] = headlineParts(headline);

  const pickCover = async (f: File | undefined) => {
    if (!f || !isMgr) return; setBusy('cover');
    try { const url = await uploadImage(`tenants/${tenantId}/branding/booking-page/cover-${Date.now().toString(36)}.jpg`, f, 2000); await save({ cover: { url } }, 'Photo'); }
    catch { toast({ variant: 'destructive', title: 'That photo didn’t upload. Try a smaller one.' }); }
    setBusy('');
  };

  // Counts for each section row, from what the public page shows.
  const services = (pub?.services || []).filter((s: any) => s.isActive !== false && !s.isPrivate && s.type !== 'addon');
  const team = (pub?.staff || []).filter((m: any) => m.showOnPublicPage !== false && !(m.isRenter && m.bookingOptOut) && !m.isStudent);
  const today = eventToday(t);   // the business's own date, as on the page
  const events = comingEvents(pub?.events || [], today, 99);
  const useModule = (m: string) => moduleEnabled(t, m as any);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const note = (id: SectionId): string => {
    switch (id) {
      case 'services': return 'Always on the page';
      case 'team': return pub ? plural(team.length, 'person', 'people') : '';
      case 'events': return pub ? (events.length ? `${events.length} coming up` : 'Events show here when “Show on your booking page” is on') : '';
      case 'work': return page.work.length ? plural(page.work.length, 'photo') : 'Add photos of your work';
      case 'about': return page.about.text ? page.about.text.slice(0, 60) + (page.about.text.length > 60 ? '…' : '') : 'A few words about you';
      case 'faqs': return page.faqs.length ? plural(page.faqs.length, 'question') : 'Answer what clients ask most';
      case 'reviews': return 'Reviews you’ve chosen to show';
      case 'policies': return 'Your cancellation, late and deposit rules, in plain words';
      case 'visit': return page.visit.parking || page.visit.entrance || page.visit.video ? 'Address, phone, hours and getting here' : 'Address, phone and hours. Add parking, the way in and your social links';
      case 'waitlist': return 'Offered when nothing fits, and as a link at the bottom';
      case 'offers': return !page.on.offers ? 'Off. Switch on to sell your public memberships and packages online' : t?.stripeAccountId && t?.stripeChargesEnabled !== false ? 'Your public memberships and packages, bought online' : 'Shown; connect payments so clients can buy them online';
      case 'gifts': return t?.giftCardSettings?.online ? 'Sold online' : 'Turn on online gift cards to show this';
      case 'spaces': { const sp = spacesSettings(t); return !sp.showLeases && !sp.showDayUse ? 'Nothing listed. Choose what to rent out' : [sp.showLeases && 'Leases', sp.showDayUse && 'by the hour or day'].filter(Boolean).join(', ').replace(/^b/, 'B') + (sp.terms ? ', with your terms' : ''); }
      default: return '';
    }
  };
  // What the business's old page showed that this design doesn't, said once until they've read it.
  const leftovers = React.useMemo(() => {
    if (t?.bookingPageSettings?.studio?.oldPageNoted === true) return '';
    const x = oldPageExtras(t); const gone = x.gone.filter((g) => !((g === 'memberships' || g === 'packages') && page.on.offers));
    // What carried over and still shows from the old page (not yet changed in Visit us).
    const saved = t?.bookingPageSettings?.studio?.visit || {};
    const kept = [typeof saved.hours !== 'string' && x.hours && 'your hours', !Array.isArray(saved.social) && x.social.length && 'your social links', typeof saved.quote !== 'string' && x.quoteUrl && 'your quote button'].filter(Boolean) as string[];
    if (!gone.length && !kept.length) return '';
    const sell = gone.some((g) => g === 'memberships' || g === 'packages');
    const rest = gone.filter((g) => g !== 'memberships' && g !== 'packages');
    const say = (a: string[]) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0]);
    return [rest.length ? `Your old page also showed ${say(rest)}, which this design doesn’t have.` : '',
      sell ? 'To sell memberships and packages here, switch on Memberships and packages below.' : '',
      kept.length ? `${say(kept)[0].toUpperCase()}${say(kept).slice(1)} carried over to Visit us, where you can change them.` : ''].filter(Boolean).join(' ');
  }, [t, page.on.offers]);
  const editors: Partial<Record<SectionId, 'work' | 'about' | 'faqs' | 'visit' | 'spaces'>> = { work: 'work', about: 'about', faqs: 'faqs', visit: 'visit', spaces: 'spaces' };
  const shown = page.order.filter((id) => { const def = SECTIONS.find((x) => x.id === id); return def && (!def.module || useModule(def.module)); });

  // Reordering: drag the grip, or focus it and use the arrow keys.
  const [order, setOrder] = React.useState<SectionId[]>(shown);
  React.useEffect(() => { setOrder(shown); }, [shown.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [said, setSaid] = React.useState('');
  const commitOrder = (next: SectionId[]) => { const before = shown; setOrder(next); void save({ order: next.filter((id) => id !== 'services') }, 'Order').then((ok) => { if (!ok) setOrder(before); }); };
  const move = (id: SectionId, by: -1 | 1) => {
    const i = order.indexOf(id); const j = i + by; if (i <= 0 || j <= 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]]; commitOrder(next);
    setSaid(`${SECTIONS.find((x) => x.id === id)?.title} moved to position ${j + 1} of ${order.length}`);
  };
  // Dragging: the new place comes from where the pointer is against the rows as they were when the drag began, so it
  // never flips back and forth; the page scrolls when the pointer nears the top or bottom of the screen.
  const orderRef = React.useRef(order); orderRef.current = order;
  const drag = React.useRef<{ id: SectionId; start: SectionId[]; mids: number[]; y: number; scroll: number; pointer: number } | null>(null);
  const [dragging, setDragging] = React.useState<SectionId | null>(null);
  const [reorder, setReorder] = React.useState(false);   // phones: up and down buttons in place of the switches, for anyone who can't drag
  const listRef = React.useRef<HTMLDivElement>(null);
  const place = (pageY: number) => {
    const d = drag.current; if (!d) return;
    const rest = d.start.filter((x) => x !== d.id);
    const slot = Math.max(1, Math.min(rest.length, d.mids.filter((m) => m < pageY).length));
    const next = [...rest.slice(0, slot), d.id, ...rest.slice(slot)];
    if (next.join(',') !== orderRef.current.join(',')) setOrder(next);
  };
  React.useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => { const d = drag.current; if (d) { const edge = 72; const vy = d.y < edge ? -12 : d.y > window.innerHeight - edge ? 12 : 0; if (vy) { window.scrollBy(0, vy); place(d.y + window.scrollY); } } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    // Followed on the whole window: when the row moves down a place the browser lets go of the grip, and the pointer is
    // rarely still over it.
    // Only the pointer that started the drag moves it; a move with no button down means the release was missed (let go
    // outside the window), so the drag ends there.
    const onMove = (e: PointerEvent) => { const d = drag.current; if (!d || e.pointerId !== d.pointer) return; if (e.pointerType === 'mouse' && e.buttons === 0) { onGripUp(); return; } d.y = e.clientY; place(e.clientY + window.scrollY); };
    const onUp = (e: PointerEvent) => { const d = drag.current; if (d && e.pointerId === d.pointer) onGripUp(); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
  }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps
  const onGripDown = (e: React.PointerEvent, id: SectionId) => {
    if (!isMgr || id === 'services' || e.button !== 0 || drag.current) return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-section-row]') || []);
    const mids = rows.filter((el) => el.dataset.sectionRow !== id).map((el) => { const r = el.getBoundingClientRect(); return r.top + window.scrollY + r.height / 2; });
    drag.current = { id, start: [...orderRef.current], mids, y: e.clientY, scroll: window.scrollY, pointer: e.pointerId }; setDragging(id); (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onGripUp = () => {
    const d = drag.current; if (!d) return; drag.current = null; setDragging(null);
    const now = orderRef.current; if (now.join(',') !== d.start.join(',')) { commitOrder(now); setSaid(`${SECTIONS.find((x) => x.id === d.id)?.title} moved to position ${now.indexOf(d.id) + 1} of ${now.length}`); }
  };

  if (!t) return <SettingsPage title="Booking page"><p className="cf-muted">Loading…</p></SettingsPage>;
  return (
    <SettingsPage wide title="Booking page" help={`What clients see when they book with you. One design, in your color.${isMgr ? '' : ' Only the business owner can change it.'}`}
      actions={<a href={`/book/${tenantId}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold" style={{ background: 'var(--soft)', color: 'var(--ink)' }}>View your page<ExternalLink className="h-4 w-4" aria-hidden /></a>}>
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8 md:space-y-10">


          <Section title="Your page">
            <Row label="Link" inline><span className="flex items-center gap-2"><span className="hidden max-w-[16rem] truncate text-[14px] cf-muted sm:inline">{link.replace(/^https?:\/\//, '')}</span>
              <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { window.prompt('Your booking link', link); } }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>{copied ? 'Copied' : 'Copy'}</button></span></Row>
            <Row label="QR code" help="For your counter, cards and windows" inline><button type="button" onClick={() => void qrDownload()} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>Download</button></Row>
            <Row label="Your color" help={darkened ? 'Buttons show a deeper shade of it (a lighter one in dark mode), so the text on them stays readable.' : 'Buttons and highlights. Tap the circle for any color; text on it always stays readable.'} inline>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <label className={`relative grid h-11 w-11 place-items-center rounded-full ${isMgr ? 'cursor-pointer' : ''} ${FOCUS_WITHIN}`} title="Pick your own color">
                  <span className="h-8 w-8 rounded-full" style={{ background: picking ? readable(picking) : page.paint, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} aria-hidden />
                  <input type="color" aria-label="Pick your own color" disabled={!isMgr} value={picking || color} onChange={(e) => setPicking(e.target.value)} className="sr-only" />
                </label>
                <select aria-label="Your color" disabled={!isMgr} value={named ? color : 'custom'} onChange={(e) => { const v = e.target.value; if (v !== 'custom') void save({ color: v }, 'Color'); }} className="h-11 rounded-xl border px-3 text-[15px]" style={cfInputStyle}>
                  {COLORS.map((c) => <option key={c.hex} value={c.hex}>{c.name}</option>)}
                  <option value="custom" disabled={!!named}>{named ? 'Tap the circle for any color' : 'Your own color'}</option>
                </select>
                {fromLogo && fromLogo !== color && <button type="button" disabled={!isMgr} onClick={() => void save({ color: fromLogo }, 'Color')} className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-[14px] font-medium" style={{ background: 'var(--soft)' }}><span className="h-4 w-4 rounded-full" style={{ background: readable(fromLogo) }} aria-hidden />From your logo</button>}
              </span>
            </Row>
            <Row label="Mood" help={MOODS.find((m) => m.id === page.mood)?.meaning}>
              <Choice<Mood> label="Mood" value={page.mood} options={MOODS.map((m) => ({ value: m.id, label: m.title }))} onChange={(v) => { if (isMgr) void save({ mood: v }, 'Mood'); }} />
            </Row>
            <Row label="Opening splash" help="Your color, logo and name for under a second, the first time someone opens your page. Never for anyone whose phone asks for less motion." inline>
              <Toggle label="Show the opening splash" checked={page.splash} disabled={!isMgr} onChange={(v) => void save({ splash: v ? undefined : false }, 'Opening splash')} />
            </Row>
          </Section>

          <Section title="At the top">
            <Row label="Headline" help={bold ? <>Shows as: {plain} <b>{bold}</b></> : 'Words after a comma stand out in bold, like “Healthy nails, done beautifully”.'}>
              <input value={headline} disabled={!isMgr} maxLength={90} placeholder={`Welcome to ${t?.name || 'your business'}`} onChange={(e) => setHeadline(e.target.value)} onFocus={() => { editing.current = 'headline'; }}
                onBlur={() => { editing.current = null; if (headline.trim() !== page.headline) void save({ headline: headline.trim() }, 'Headline'); }} aria-label="Headline" className={cfInput} style={cfInputStyle} />
            </Row>
            <Row label="Description" help="A line or two under the headline.">
              <textarea value={description} disabled={!isMgr} maxLength={240} rows={2} onChange={(e) => setDescription(e.target.value)} onFocus={() => { editing.current = 'description'; }}
                onBlur={() => { editing.current = null; if (description.trim() !== page.description) void save({ description: description.trim() }, 'Description'); }} aria-label="Description" className={`${cfInput} h-auto py-3`} style={cfInputStyle} />
            </Row>
            <Row label="Star rating" help="Your average from the reviews you show, under the headline, once there are three or more." inline>
              <Toggle label="Show the star rating" checked={page.showRating} disabled={!isMgr} onChange={(v) => void save({ showRating: v ? undefined : false }, 'Star rating')} />
            </Row>
            <Row label="Soonest times" help="Each service shows its next open time, and each person on your team their next opening." inline>
              <Toggle label="Show soonest times" checked={page.soonest} disabled={!isMgr} onChange={(v) => void save({ soonest: v ? undefined : false }, 'Soonest times')} />
            </Row>
            <Row label="Welcome back" help="Someone who booked on this phone or computer before sees their last service, with Book again." inline>
              <Toggle label="Welcome back returning clients" checked={page.bookAgain} disabled={!isMgr} onChange={(v) => void save({ bookAgain: v ? undefined : false }, 'Welcome back')} />
            </Row>
            <Row label="Photo" help={page.cover ? 'A photo of your space or your work.' : 'Without one, a soft glow of your color around your logo.'} inline>
              <span className="flex items-center gap-2">
                {page.cover?.url ? <img src={page.cover.url} alt="" className="h-12 w-16 rounded-xl object-cover" /> : <span className="h-12 w-16 rounded-xl" style={{ background: `radial-gradient(circle at 50% 50%, ${page.paint}55, transparent 70%), var(--soft)` }} aria-hidden />}
                <label className={`inline-flex h-11 cursor-pointer items-center rounded-full px-4 text-[14px] font-semibold ${FOCUS_WITHIN} ${!isMgr || busy === 'cover' ? 'pointer-events-none opacity-50' : ''}`} style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                  {busy === 'cover' ? 'Uploading…' : page.cover ? 'Change' : 'Add a photo'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => void pickCover(e.target.files?.[0])} /></label>
                {page.cover && isMgr && <button type="button" onClick={() => void save({ cover: null }, 'Photo')} className="h-11 rounded-full px-3 text-[14px] font-medium cf-muted">Remove</button>}
              </span>
            </Row>
          </Section>

          {isMgr && leftovers && <div className="cf-sheet flex flex-wrap items-start justify-between gap-3 px-5 py-4" role="status">
            <p className="max-w-[60ch] text-[14.5px]">{leftovers}</p>
            <button type="button" onClick={() => void save({ oldPageNoted: true }, 'Page note')} className="inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Got it</button>
          </div>}
          <section aria-label="Sections" className="space-y-3">
            <div className="flex items-center justify-between gap-3"><h2 className="text-[19px] font-semibold tracking-tight">Sections</h2>
              {isMgr && <button type="button" onClick={() => setReorder((v) => !v)} className="inline-flex h-11 items-center rounded-full px-4 text-[14px] font-semibold sm:hidden" style={{ background: reorder ? 'var(--ink)' : 'var(--soft)', color: reorder ? 'var(--paper)' : 'var(--ink)' }}>{reorder ? 'Done' : 'Change order'}</button>}</div>
            <div ref={listRef} className="cf-sheet">
              {order.map((id) => { const def = SECTIONS.find((x) => x.id === id)!; const ed = editors[id]; const fixed = id === 'services'; return (
                <div key={id} data-section-row={id} data-setting-row={def.title} className="flex items-center gap-2 px-3 py-2 [&+&]:border-t" style={{ borderColor: 'var(--line)', opacity: dragging === id ? 0.6 : 1, background: dragging === id ? 'var(--soft)' : undefined }}>
                  {fixed ? <span className="w-11 shrink-0" aria-hidden /> : <button type="button" aria-label={`Move ${def.title}. Use the up and down arrow keys.`} disabled={!isMgr}
                    onPointerDown={(e) => onGripDown(e, id)}
                    onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); move(id, -1); } if (e.key === 'ArrowDown') { e.preventDefault(); move(id, 1); } }}
                    className="grid h-11 w-11 shrink-0 cursor-grab touch-none place-items-center rounded-xl cf-muted disabled:cursor-default"><GripVertical className="h-4 w-4" aria-hidden /></button>}
                  <div className="min-w-0 flex-1 py-1.5"><p className="text-[15.5px] font-medium">{def.title}</p>{note(id) && <p className="truncate text-[13.5px] cf-muted">{note(id)}</p>}</div>
                  {fixed ? <span className="px-2 text-[14px] cf-muted">{pub ? plural(services.length, 'service') : ''}</span>
                    : <span className="flex shrink-0 items-center gap-1">
                      {!fixed && isMgr && <span className={`items-center sm:flex ${reorder ? 'flex' : 'hidden'}`}>
                        <button type="button" aria-label={`Move ${def.title} up`} onClick={() => move(id, -1)} disabled={order.indexOf(id) <= 1} className="grid h-11 w-11 place-items-center cf-muted disabled:opacity-30"><ArrowUp className="h-4 w-4" aria-hidden /></button>
                        <button type="button" aria-label={`Move ${def.title} down`} onClick={() => move(id, 1)} disabled={order.indexOf(id) >= order.length - 1} className="grid h-11 w-11 place-items-center cf-muted disabled:opacity-30"><ArrowDown className="h-4 w-4" aria-hidden /></button></span>}
                      <span className={`items-center gap-1 sm:flex ${reorder ? 'hidden' : 'flex'}`}>
                        {ed && <button type="button" onClick={() => setSheet(ed)} aria-label={`Edit ${def.title}`} className="grid h-11 w-11 place-items-center cf-muted"><ChevronRight className="h-5 w-5" aria-hidden /></button>}
                        <Toggle label={`Show ${def.title}`} checked={page.on[id]} disabled={!isMgr} onChange={(v) => void save({ [`off.${id}`]: sectionSwitch(id, v) }, def.title)} /></span>
                    </span>}
                </div>); })}
            </div>
            <p className="px-1 text-[13.5px] cf-muted">Drag to change the order<span className="sm:hidden">, or tap Change order</span>. A section with nothing in it stays hidden until it has something, so a new page never looks empty.</p>
            <p className="sr-only" role="status" aria-live="polite">{said}</p>
          </section>
        </div>

        {xl && <aside aria-label="Preview" className="sticky top-6">
          <p className="mb-2 text-[13.5px] font-semibold cf-muted">Preview</p>
          <div className="overflow-hidden rounded-[44px] p-[10px]" style={{ background: '#16171a', width: 300, boxShadow: '0 0 0 1px var(--line)' }}>
            <div className="overflow-hidden rounded-[34px] bg-white" style={{ width: 280, height: 580 }}>
              {tenantId && <iframe key={stamp} title="Your booking page" src={`/book/${tenantId}?preview=1`} style={{ width: 390, height: 808, border: 0, transform: `scale(${280 / 390})`, transformOrigin: 'top left' }} />}
            </div>
          </div>
          <p className="mt-3 max-w-[300px] text-[13.5px] cf-muted">Changes show here as you make them, and on your page right away.</p>
        </aside>}
      </div>

      {sheet === 'work' && <WorkSheet photos={drafts.work || page.work} unsaved={!!drafts.work} canEdit={isMgr} tenantId={tenantId} onDraft={(work) => setDrafts((d) => ({ ...d, work }))}
        onSave={async (work) => { const ok = await save({ work }, 'Our work'); if (ok) setDrafts((d) => ({ ...d, work: undefined })); return ok; }} onClose={() => setSheet(null)} />}
      {sheet === 'about' && <AboutSheet about={drafts.about || page.about} unsaved={!!drafts.about} canEdit={isMgr} tenantId={tenantId} onDraft={(about) => setDrafts((d) => ({ ...d, about }))}
        onSave={async (about) => { const ok = await save({ about }, 'About us'); if (ok) setDrafts((d) => ({ ...d, about: undefined })); return ok; }} onClose={() => setSheet(null)} />}
      {sheet === 'visit' && <VisitSheet visit={drafts.visit || page.visit} unsaved={!!drafts.visit} canEdit={isMgr} onDraft={(visit) => setDrafts((d) => ({ ...d, visit }))}
        onSave={async (visit) => { const ok = await save({ visit }, 'Visit us'); if (ok) setDrafts((d) => ({ ...d, visit: undefined })); return ok; }} onClose={() => setSheet(null)} />}
      {sheet === 'spaces' && <SpacesSheet spaces={drafts.spaces || spacesDraftOf(t)} unsaved={!!drafts.spaces} canEdit={isMgr} onDraft={(spaces) => setDrafts((d) => ({ ...d, spaces }))}
        onSave={async (next) => {
          // Only what changed is saved: an old booth section keeps its own choices until the owner changes that setting.
          const was = spacesDraftOf(t); const now = { ...was, ...next };
          const patch: Record<string, any> = {};
          if (now.showLeases !== was.showLeases) patch['spaces.showLeases'] = now.showLeases;
          if (now.showDayUse !== was.showDayUse) patch['spaces.showDayUse'] = now.showDayUse;
          if (now.terms.trim() !== was.terms.trim()) patch['spaces.terms'] = now.terms.trim().slice(0, SPACES_LIMITS.terms);
          if (now.docs.trim() !== was.docs.trim()) patch['spaces.requiredDocs'] = lines(now.docs, SPACES_LIMITS.docs);
          if (now.docsAfterApproval !== was.docsAfterApproval) patch['spaces.docsAfterApproval'] = now.docsAfterApproval;
          if (now.qualifiers !== was.qualifiers) patch['spaces.qualifiers'] = now.qualifiers;
          if (now.niches.trim() !== was.niches.trim()) patch['spaces.niches'] = lines(now.niches, SPACES_LIMITS.niches);
          const ok = Object.keys(patch).length ? await save(patch, 'Spaces to rent') : true; if (ok) setDrafts((d) => ({ ...d, spaces: undefined })); return ok; }} onClose={() => setSheet(null)} />}
      {sheet === 'faqs' && <FaqSheet faqs={drafts.faqs || page.faqs} unsaved={!!drafts.faqs} canEdit={isMgr} onDraft={(faqs) => setDrafts((d) => ({ ...d, faqs }))}
        onSave={async (faqs) => { const ok = await save({ faqs }, 'Questions'); if (ok) setDrafts((d) => ({ ...d, faqs: undefined })); return ok; }} onClose={() => setSheet(null)} />}
    </SettingsPage>
  );
}

const btn = 'inline-flex h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold';
const Unsaved = () => <p className="text-[13.5px] font-medium" style={{ color: '#b45309' }}>Not saved yet. Your changes are kept here until you save them.</p>;
/** Keeps an editor's work in the page as it changes, so closing the sheet never loses it. */
function useDraft<T>(initial: T, onDraft: (v: T) => void): [T, (f: (v: T) => T) => void, boolean] {
  const [v, setV] = React.useState<T>(initial); const [touched, setTouched] = React.useState(false); const latest = React.useRef(initial);
  const set = (f: (v: T) => T) => { const n = f(latest.current); latest.current = n; setV(n); onDraft(n); setTouched(true); };
  return [v, set, touched];
}

function WorkSheet({ photos, unsaved, canEdit, tenantId, onDraft, onSave, onClose }: { photos: Photo[]; unsaved: boolean; canEdit: boolean; tenantId: string; onDraft: (p: Photo[]) => void; onSave: (p: Photo[]) => Promise<boolean>; onClose: () => void }) {
  const [list, setList, touched] = useDraft<Photo[]>(photos, onDraft);
  const [busy, setBusy] = React.useState(0); const [err, setErr] = React.useState('');
  const add = async (files: FileList | null) => {
    if (!files?.length) return; setErr(''); const picked = Array.from(files).slice(0, 24 - list.length); setBusy(picked.length);
    const out: Photo[] = [];
    for (const f of picked) { try { out.push({ url: await uploadImage(`tenants/${tenantId}/branding/booking-page/work-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.jpg`, f, 1600) }); } catch { setErr('Some photos didn’t upload. Try smaller ones.'); } setBusy((n) => n - 1); }
    setList((l) => [...l, ...out]);
  };
  const shift = (i: number, by: number) => setList((l) => { const j = i + by; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <Sheet wide title="Our work" sub="Photos of your work, shown on your page in this order. The first four show first." onClose={onClose} closeLabel="Close">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{list.map((p, i) => (
          <figure key={p.url + i} className="space-y-2">
            <img src={p.url} alt={p.caption || `Photo ${i + 1}`} className="aspect-square w-full rounded-2xl object-cover" />
            <input value={p.caption || ''} disabled={!canEdit} maxLength={80} placeholder="Caption (optional)" aria-label={`Caption for photo ${i + 1}`} onChange={(e) => setList((l) => l.map((x, k) => { if (k !== i) return x; const { caption: _c, ...rest } = x; return e.target.value ? { ...rest, caption: e.target.value } : rest; }))} className="h-11 w-full rounded-xl border px-3 text-[14px]" style={cfInputStyle} />
            {canEdit && <div className="flex items-center justify-between">
              <span className="flex"><button type="button" aria-label={`Move photo ${i + 1} earlier`} onClick={() => shift(i, -1)} disabled={i === 0} className="grid h-11 w-11 place-items-center cf-muted disabled:opacity-30"><ArrowUp className="h-4 w-4 -rotate-90" aria-hidden /></button>
                <button type="button" aria-label={`Move photo ${i + 1} later`} onClick={() => shift(i, 1)} disabled={i === list.length - 1} className="grid h-11 w-11 place-items-center cf-muted disabled:opacity-30"><ArrowDown className="h-4 w-4 -rotate-90" aria-hidden /></button></span>
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setList((l) => l.filter((_, k) => k !== i))} className="grid h-11 w-11 place-items-center" style={{ color: '#b42318' }}><Trash2 className="h-4 w-4" aria-hidden /></button>
            </div>}
          </figure>))}
          {canEdit && list.length < 24 && <label className={`grid aspect-square cursor-pointer place-items-center rounded-2xl text-center text-[14px] font-medium ${FOCUS_WITHIN}`} style={{ background: 'var(--soft)' }}>
            <span className="space-y-1"><ImagePlus className="mx-auto h-6 w-6" aria-hidden /><span className="block">{busy ? `Uploading ${busy}…` : 'Add photos'}</span></span>
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void add(e.target.files)} /></label>}
        </div>
        {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: '#b45309' }}>{err}</p>}
        {(unsaved || touched) && canEdit && <Unsaved />}
        {canEdit && <div className="flex justify-end"><button type="button" disabled={busy > 0} onClick={async () => { if (await onSave(list)) onClose(); }} className={`${btn} disabled:opacity-50`} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Save photos</button></div>}
      </div>
    </Sheet>
  );
}

function AboutSheet({ about, unsaved, canEdit, tenantId, onDraft, onSave, onClose }: { about: { text: string; photo: Photo | null }; unsaved: boolean; canEdit: boolean; tenantId: string; onDraft: (a: { text: string; photo: Photo | null }) => void; onSave: (a: { text: string; photo: Photo | null }) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft, touched] = useDraft(about, onDraft); const { text, photo } = draft;
  const setText = (v: string) => setDraft((d) => ({ ...d, text: v })); const setPhoto = (v: Photo | null) => setDraft((d) => ({ ...d, photo: v }));
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const pick = async (f?: File) => { if (!f) return; setBusy(true); setErr(''); try { setPhoto({ url: await uploadImage(`tenants/${tenantId}/branding/booking-page/about-${Date.now().toString(36)}.jpg`, f, 1600) }); } catch { setErr('That photo didn’t upload. Try a smaller one.'); } setBusy(false); };
  return (
    <Sheet title="About us" sub="A few words about you and your space. Leave a blank line between paragraphs." onClose={onClose} closeLabel="Close">
      <div className="space-y-4">
        <textarea value={text} disabled={!canEdit} rows={7} maxLength={1500} onChange={(e) => setText(e.target.value)} aria-label="About us" placeholder="How you started, what you care about, what clients can expect." className={`${cfInput} h-auto py-3`} style={cfInputStyle} />
        <div className="flex flex-wrap items-center gap-3">
          {photo?.url ? <img src={photo.url} alt="" className="h-16 w-24 rounded-xl object-cover" /> : null}
          {canEdit && <label className={`${btn} cursor-pointer ${FOCUS_WITHIN} ${busy ? 'pointer-events-none opacity-50' : ''}`} style={{ background: 'var(--soft)' }}>{busy ? 'Uploading…' : photo ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} /></label>}
          {photo && canEdit && <button type="button" onClick={() => setPhoto(null)} className="h-11 px-2 text-[14px] font-medium cf-muted">Remove photo</button>}
        </div>
        {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: '#b45309' }}>{err}</p>}
        {(unsaved || touched) && canEdit && <Unsaved />}
        {canEdit && <div className="flex justify-end"><button type="button" disabled={busy} onClick={async () => { if (await onSave({ text: text.trim(), photo })) onClose(); }} className={`${btn} disabled:opacity-50`} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Save</button></div>}
      </div>
    </Sheet>
  );
}

const KNOWN_SOCIAL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn', pinterest: 'Pinterest', x: 'X', twitter: 'X', yelp: 'Yelp', threads: 'Threads' };
/** Social links as the sheet edits them: one per line, a name and an https link ("Instagram https://…"). */
const socialText = (list: { label: string; url: string }[] | undefined) => (list || []).map((x) => `${x.label} ${x.url}`).join('\n');
function socialFrom(text: string): { list: { label: string; url: string }[]; bad: boolean } {
  const list: { label: string; url: string }[] = []; let bad = false;
  const all = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (all.length > 6) bad = true;   // never dropped quietly: the sheet asks for six or fewer
  for (const line of all) {
    const m = /(https:\/\/\S+)/i.exec(line); if (!m) { bad = true; continue; }
    const label = line.replace(m[1], '').trim().slice(0, 30) || (() => { try { const h = new URL(m[1]).hostname.replace(/^www\./, '').split('.')[0].toLowerCase(); return KNOWN_SOCIAL[h] || h[0].toUpperCase() + h.slice(1); } catch { return 'Link'; } })();
    list.push({ label, url: m[1].slice(0, 300) });
  }
  return { list: list.slice(0, 6), bad };
}

function VisitSheet({ visit, unsaved, canEdit, onDraft, onSave, onClose }: { visit: VisitNotes; unsaved: boolean; canEdit: boolean; onDraft: (v: VisitNotes) => void; onSave: (v: VisitNotes) => Promise<boolean>; onClose: () => void }) {
  type D = VisitNotes & { socialLines?: string };
  const [draft, setDraft, touched] = useDraft<D>({ ...visit, socialLines: (visit as D).socialLines ?? socialText(visit.social) }, onDraft);
  const set = (k: keyof D, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const https = (x?: string) => !x?.trim() || /^https:\/\/[^\s]+$/i.test(x.trim());
  const videoBad = !https(draft.video); const quoteBad = !https(draft.quote);
  const social = socialFrom(draft.socialLines || '');
  const label = (id: string, title: string, el: React.ReactNode, help?: string) => (
    <div className="space-y-1.5"><label htmlFor={id} className="block text-[14.5px] font-semibold">{title}</label>{el}{help && <p id={`${id}-help`} className="text-[13.5px] cf-muted">{help}</p>}</div>);
  return (
    <Sheet title="Visit us" sub="Your address, phone and email come from your business details. Getting here shows with buttons for Apple Maps and Google Maps." onClose={onClose} closeLabel="Close">
      <div className="space-y-4">
        {label('visit-parking', 'Parking', <textarea id="visit-parking" value={draft.parking || ''} disabled={!canEdit} rows={2} maxLength={300} onChange={(e) => set('parking', e.target.value)} placeholder="Free lot behind the building. Street parking is 2 hours." className={`${cfInput} h-auto py-3`} style={cfInputStyle} />)}
        {label('visit-entrance', 'The entrance', <textarea id="visit-entrance" value={draft.entrance || ''} disabled={!canEdit} rows={2} maxLength={300} onChange={(e) => set('entrance', e.target.value)} placeholder="The blue door beside the bakery, then up one floor. There’s an elevator." className={`${cfInput} h-auto py-3`} style={cfInputStyle} />)}
        {label('visit-video', 'A short video of the way in', <input id="visit-video" value={draft.video || ''} disabled={!canEdit} maxLength={300} inputMode="url" onChange={(e) => set('video', e.target.value)} placeholder="https://" aria-invalid={videoBad} aria-describedby={videoBad ? 'video-bad' : undefined} className={cfInput} style={cfInputStyle} />)}
        {videoBad && <p id="video-bad" role="alert" className="text-[14px] font-semibold" style={{ color: '#b45309' }}>Paste a link that starts with https://</p>}
        {label('visit-hours', 'Hours, in your words', <textarea id="visit-hours" value={draft.hours || ''} disabled={!canEdit} rows={3} maxLength={400} onChange={(e) => set('hours', e.target.value)} placeholder={'Tuesday to Saturday, 10am to 6pm\nSunday and Monday, closed'} aria-describedby="visit-hours-help" className={`${cfInput} h-auto py-3`} style={cfInputStyle} />,
          'Leave it empty to show hours from your team’s schedules, which stay up to date on their own.')}
        {label('visit-social', 'Social links', <textarea id="visit-social" value={draft.socialLines || ''} disabled={!canEdit} rows={3} maxLength={1200} onChange={(e) => set('socialLines', e.target.value)} placeholder={'Instagram https://www.instagram.com/yourname\nTikTok https://www.tiktok.com/@yourname'} aria-invalid={social.bad} aria-describedby="visit-social-help" className={`${cfInput} h-auto py-3`} style={cfInputStyle} />,
          'One per line, up to 6: a name, then the link.')}
        {social.bad && <p role="alert" className="text-[14px] font-semibold" style={{ color: '#b45309' }}>{(draft.socialLines || '').split('\n').filter((l) => l.trim()).length > 6 ? 'Up to 6 links, one per line.' : 'Each line needs a link that starts with https://'}</p>}
        {label('visit-quote', 'Quote request link', <input id="visit-quote" value={draft.quote || ''} disabled={!canEdit} maxLength={300} inputMode="url" onChange={(e) => set('quote', e.target.value)} placeholder="https://" aria-invalid={quoteBad} aria-describedby="visit-quote-help" className={cfInput} style={cfInputStyle} />,
          'For events and bigger bookings: a link to your own form. It shows as Request a quote.')}
        {quoteBad && <p role="alert" className="text-[14px] font-semibold" style={{ color: '#b45309' }}>Paste a link that starts with https://</p>}
        {(unsaved || touched) && canEdit && <Unsaved />}
        {canEdit && <div className="flex justify-end"><button type="button" disabled={videoBad || quoteBad || social.bad} onClick={async () => { if (await onSave({ parking: (draft.parking || '').trim(), entrance: (draft.entrance || '').trim(), video: (draft.video || '').trim(), hours: (draft.hours || '').trim(), social: social.list, quote: (draft.quote || '').trim() })) onClose(); }} className={`${btn} disabled:opacity-50`} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Save</button></div>}
      </div>
    </Sheet>
  );
}

type SpacesDraft = { showLeases: boolean; showDayUse: boolean; terms: string; docs: string; docsAfterApproval: boolean; qualifiers: boolean; niches: string };
/** What the sheet edits: the settings as they stand (including anything from the old page builder), lists as lines. */
const spacesDraftOf = (t: any): SpacesDraft => { const s = spacesSettings(t); return { showLeases: s.showLeases, showDayUse: s.showDayUse, terms: s.terms, docs: s.requiredDocs.join('\n'), docsAfterApproval: s.docsAfterApproval, qualifiers: s.qualifiers, niches: s.niches.join('\n') }; };
const lines = (x: string, max: number) => [...new Set(x.split('\n').map((v) => v.trim().slice(0, SPACES_LIMITS.item)).filter(Boolean))].slice(0, max);

function SpacesSheet({ spaces, unsaved, canEdit, onDraft, onSave, onClose }: { spaces: SpacesDraft; unsaved: boolean; canEdit: boolean; onDraft: (v: SpacesDraft) => void; onSave: (v: SpacesDraft) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft, touched] = useDraft<SpacesDraft>(spaces, onDraft);
  const set = <K extends keyof SpacesDraft>(k: K, v: SpacesDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const labeled = (id: string, label: string, help: string, el: React.ReactNode) => (
    <div className="space-y-1.5"><label htmlFor={id} className="block text-[14.5px] font-semibold">{label}</label>{el}<p id={`${id}-help`} className="text-[13.5px] cf-muted">{help}</p></div>);
  const area = (id: string, k: 'terms' | 'docs' | 'niches', rows: number, max: number, placeholder: string) => (
    <textarea id={id} value={draft[k]} disabled={!canEdit} rows={rows} maxLength={max} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} aria-describedby={`${id}-help`} className={`${cfInput} h-auto py-3`} style={cfInputStyle} />);
  return (
    <Sheet title="Spaces to rent" sub="Booths and spaces you rent to other professionals: what your page lists, and what people agree to. Rates, photos and availability are set on each space in Booths." onClose={onClose} closeLabel="Close">
      <div className="space-y-5">
        <div className="cf-sheet divide-y [&>*]:[border-color:var(--line)]">
          <div className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="text-[15px] font-medium">Leases by the month</p><p className="text-[13.5px] cf-muted">People apply, and you approve them</p></div>
            <Toggle label="List leases by the month" checked={draft.showLeases} disabled={!canEdit} onChange={(v) => set('showLeases', v)} /></div>
          <div className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="text-[15px] font-medium">By the hour or the day</p><p className="text-[13.5px] cf-muted">Booked and paid for online</p></div>
            <Toggle label="List spaces by the hour or the day" checked={draft.showDayUse} disabled={!canEdit} onChange={(v) => set('showDayUse', v)} /></div>
        </div>
        {labeled('spaces-terms', 'Your application terms', 'Shown as a box to tick on a lease application; with none, there’s no box. Anyone renting by the hour or the day signs the standard rental agreement, which covers payment, care of the space and any incidental charges.',
          area('spaces-terms', 'terms', 6, SPACES_LIMITS.terms, 'What applicants agree to: their information is accurate, a background or license check, how you choose renters.'))}
        {labeled('spaces-docs', 'Documents applicants upload', 'One per line, up to 8, like a license or proof of insurance.', area('spaces-docs', 'docs', 3, 600, 'Cosmetology license\nProof of insurance'))}
        <div className="cf-sheet divide-y [&>*]:[border-color:var(--line)]">
          <div className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="text-[15px] font-medium">Ask for documents after approval</p><p className="text-[13.5px] cf-muted">A lighter first application</p></div>
            <Toggle label="Ask for documents after approval" checked={draft.docsAfterApproval} disabled={!canEdit} onChange={(v) => set('docsAfterApproval', v)} /></div>
          <div className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="text-[15px] font-medium">Qualifying questions</p><p className="text-[13.5px] cf-muted">Licensed, their own clients, years of experience</p></div>
            <Toggle label="Ask qualifying questions" checked={draft.qualifiers} disabled={!canEdit} onChange={(v) => set('qualifiers', v)} /></div>
        </div>
        {labeled('spaces-niches', 'Specialties applicants choose from', 'One per line, up to 16. Leave it empty for the usual list: hair, nails, esthetics, massage and more.', area('spaces-niches', 'niches', 3, 1200, 'Hair\nNails\nEsthetics'))}
        {(unsaved || touched) && canEdit && <Unsaved />}
        {canEdit && <div className="flex justify-end"><button type="button" onClick={async () => { if (await onSave(draft)) onClose(); }} className={btn} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Save</button></div>}
      </div>
    </Sheet>
  );
}

function FaqSheet({ faqs, unsaved, canEdit, onDraft, onSave, onClose }: { faqs: Faq[]; unsaved: boolean; canEdit: boolean; onDraft: (f: Faq[]) => void; onSave: (f: Faq[]) => Promise<boolean>; onClose: () => void }) {
  const [list, setList, touched] = useDraft<Faq[]>(faqs.length ? faqs : [{ q: '', a: '' }], onDraft);
  const set = (i: number, k: 'q' | 'a', v: string) => setList((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const shift = (i: number, by: number) => setList((l) => { const j = i + by; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const ready = list.filter((f) => f.q.trim() && f.a.trim()).map((f) => ({ q: f.q.trim(), a: f.a.trim() }));
  const half = list.some((f) => (f.q.trim() && !f.a.trim()) || (!f.q.trim() && f.a.trim()));
  return (
    <Sheet wide title="Questions" sub="What clients ask most, answered once on your page." onClose={onClose} closeLabel="Close">
      <div className="space-y-4">
        {list.map((f, i) => (
          <div key={i} className="space-y-2 rounded-2xl p-4" style={{ background: 'var(--soft)' }}>
            <input value={f.q} disabled={!canEdit} maxLength={140} placeholder="The question, like “How should I prepare?”" aria-label={`Question ${i + 1}`} onChange={(e) => set(i, 'q', e.target.value)} className={cfInput} style={cfInputStyle} />
            <textarea value={f.a} disabled={!canEdit} maxLength={600} rows={2} placeholder="Your answer" aria-label={`Answer ${i + 1}`} onChange={(e) => set(i, 'a', e.target.value)} className={`${cfInput} h-auto py-3`} style={cfInputStyle} />
            {canEdit && <div className="flex items-center justify-between">
              <span className="flex"><button type="button" aria-label={`Move question ${i + 1} up`} onClick={() => shift(i, -1)} disabled={i === 0} className="grid h-11 w-11 place-items-center cf-muted disabled:opacity-30"><ArrowUp className="h-4 w-4" aria-hidden /></button>
                <button type="button" aria-label={`Move question ${i + 1} down`} onClick={() => shift(i, 1)} disabled={i === list.length - 1} className="grid h-11 w-11 place-items-center cf-muted disabled:opacity-30"><ArrowDown className="h-4 w-4" aria-hidden /></button></span>
              <button type="button" onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="inline-flex h-11 items-center gap-1.5 px-2 text-[14px] font-medium" style={{ color: '#b42318' }}><Trash2 className="h-4 w-4" aria-hidden />Remove</button>
            </div>}
          </div>))}
        {canEdit && list.length < 12 && <button type="button" onClick={() => setList((l) => [...l, { q: '', a: '' }])} className={btn} style={{ background: 'var(--soft)' }}>Add a question</button>}
        {half && <p className="text-[14px]" style={{ color: '#b45309' }}>A question without an answer (or an answer without a question) won’t show.</p>}
        {(unsaved || touched) && canEdit && <Unsaved />}
        {canEdit && <div className="flex justify-end"><button type="button" onClick={async () => { if (await onSave(ready)) onClose(); }} className={`${btn}`} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Save questions</button></div>}
      </div>
    </Sheet>
  );
}
