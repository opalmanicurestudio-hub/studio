'use client';
// src/components/visit/VisitLounge.tsx — the visit link once they've checked in, when the business offers the waiting
// lounge (Settings: guest experience on). ClientVisit board, "Checked in": a calm check and who'll be with them; then
// "While you wait", the comforts the business offers as one-tap choices (a drink, a blanket, a charger), with the
// quantity, what it costs or that it's included, and where each request is (sent, being made, on its way, and recall
// while it's still only sent); "Need a hand?" (someone comes over, with who's coming); what's happening today; the
// Wi-Fi; and other services they can ask about before they go. Every request goes through /api/guest-lounge with this
// visit's token: a guest isn't signed in, so the browser never writes these itself. Anything that doesn't go through is
// said on the screen, in amber, never a pop-up.
import * as React from 'react';
import { format, startOfMonth, subMonths, subYears, isAfter } from 'date-fns';
import { Bell, Clock, CreditCard, SunDim, MapPin, User, Sparkles, Wifi, MessageSquare, Award, Calendar, Coffee, Minus, Plus } from 'lucide-react';
import { VisitShell, VisitButton, VisitMuted, VisitRows, VisitLabel, VisitCheck, VisitSaid, type VisitBrand } from '@/components/booking/VisitShell';
import { CopyButton, safeDate } from '@/components/visit/VisitStages';
import { wallDate } from '@/lib/tenant-time';

// ── What the lounge offers, as /api/guest-lounge hands it back ──────────────
// Deliberately narrower than an inventory item: a guest never receives cost, supplier, margin or stock counts, only
// whether the thing can be asked for and up to how many.
export type LoungeAmenity = { id: string; name: string; description?: string; category?: string; price?: number; imageUrl?: string; isMembersOnly?: boolean; maxQty?: number };
export type LoungeUpsell = { id: string; name: string; description?: string; category?: string; price?: number; duration?: number };
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Fallback only: a staff member opening the link on a studio device can read the inventory itself. */
export const toAmenity = (i: any): LoungeAmenity => ({
  id: i.id, name: i.name, description: i.description || '', category: i.category || '', price: num(i.price), imageUrl: i.imageUrl || '',
  isMembersOnly: i.isMembersOnly === true, maxQty: Math.max(1, Math.min(6, Math.floor(num(i.totalStock)) || 1)),
});

// ── Where a request is ──────────────────────────────────────────────────────
// The team moves a request along pending → making → ready → delivered. Anything neither finished nor recalled is still
// live (so the same drink can't be asked for twice while the first is being made); an unknown status reads as "sent",
// so a request never silently vanishes.
export type GuestOrderStage = 'new' | 'making' | 'ready' | 'delivered' | 'cancelled';
export const guestStageOf = (r: any): GuestOrderStage => {
  const s = String(r?.status || '').trim().toLowerCase();
  if (s === 'making' || s === 'preparing' || s === 'in_progress') return 'making';
  if (s === 'ready' || s === 'ready_for_pickup') return 'ready';
  if (s === 'delivered' || s === 'done' || s === 'completed' || s === 'complete') return 'delivered';
  if (s === 'cancelled' || s === 'canceled' || s === 'void') return 'cancelled';
  return 'new';
};
export const GUEST_STAGE_COPY: Record<'new' | 'making' | 'ready', { label: string; note: string }> = {
  new: { label: 'Sent', note: 'We’ve got it' },
  making: { label: 'Being made', note: 'Being made for you now' },
  ready: { label: 'On its way', note: 'Someone is bringing it over' },
};
const READY_ON_PASS = { label: 'Ready', note: 'It’s ready, and someone will bring it over' };

// ── "Need a hand?" ──────────────────────────────────────────────────────────
// Separate from the menu: that one means "bring me something" and lands on the team's request board; this one means
// "come over here" and lands on the floor board, where the waits are timed. The server sends the list it accepts.
type AssistOption = { key: string; label: string; hint: string };
type AssistLive = { kind: string; status: string; claimedByName: string | null };
const ASSIST_ICONS: Record<string, any> = { assistance: Bell, comfort: SunDim, timing: Clock, checkout: CreditCard };
const ASSIST_FALLBACK: AssistOption[] = [
  { key: 'assistance', label: 'I need a hand', hint: 'Someone will come to you' },
  { key: 'comfort', label: 'Too warm or too cold', hint: 'Temperature, seating or lighting' },
  { key: 'timing', label: 'I’m short on time', hint: 'We’ll let your provider know' },
  { key: 'checkout', label: 'Ready to check out', hint: 'We’ll be ready for you' },
];

const ico = (I: any) => <I className="h-[18px] w-[18px]" />;
const money = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;

export function VisitLounge({ brand, client, inventory, activeRequests, appointment, staff, resources, memberships, isWaiting, token, lounge, loungeError, onRefresh, onMessage, portalHref, wifi }: {
  brand: VisitBrand; client: any; inventory: any[]; activeRequests: any[]; appointment: any; staff: any; resources: any[]; memberships: any[];
  isWaiting: boolean;
  /** The visit token — every request goes through /api/guest-lounge with it. */
  token: string;
  /** /api/guest-lounge's answer, or null while it loads (the page asks again every 15 seconds). */
  lounge: any; loungeError?: boolean; onRefresh: () => void;
  onMessage?: () => void; portalHref?: string | null;
  wifi?: { network?: string | null; password?: string | null } | null;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState(1);
  const [ordering, setOrdering] = React.useState(false);
  const [orderSaid, setOrderSaid] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [recalling, setRecalling] = React.useState<string | null>(null);
  const [assistSending, setAssistSending] = React.useState<string | null>(null);
  const [assistSent, setAssistSent] = React.useState<Record<string, number>>({});
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [assistSaid, setAssistSaid] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [asked, setAsked] = React.useState<string[]>([]);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [askSaid, setAskSaid] = React.useState<{ ok: boolean; text: string } | null>(null);

  const post = async (body: any) => {
    try { const r = await fetch('/api/guest-lounge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) }); const d = await r.json().catch(() => ({})); return r.ok && d?.ok ? d : { ok: false, error: d?.error }; }
    catch { return { ok: false, error: null }; }
  };

  // Membership: the server's word for a guest (the browser can't read memberships); the records themselves on a
  // studio device.
  const isMember = lounge ? lounge.guest?.isMember === true : !!(client?.activeMembershipId && client?.subscription?.status === 'active');
  const activeMembership = React.useMemo(() => (client?.activeMembershipId && memberships ? memberships.find((m: any) => m.id === client.activeMembershipId) || null : null), [client, memberships]);
  const perkMap: Record<string, number> = lounge?.perks && typeof lounge.perks === 'object' ? lounge.perks : {};
  const isPerk = (id: string) => (lounge ? Object.prototype.hasOwnProperty.call(perkMap, id) : !!activeMembership?.includedProducts?.some((p: any) => p.id === id));
  const perksLeft = (id: string) => {
    if (lounge) return Math.max(0, num(perkMap[id]));
    if (!isMember || !activeMembership || !client?.subscription) return 0;
    const def = activeMembership.includedProducts?.find((p: any) => p.id === id); if (!def) return 0;
    const next = safeDate(client.subscription.nextBillingDate);
    const from = startOfMonth(activeMembership.interval === 'yearly' ? subYears(next, 1) : subMonths(next, 1));
    const used = activeRequests.filter((r) => r.itemId === id && r.status !== 'cancelled' && isAfter(safeDate(r.requestedAt), from)).reduce((n, r) => n + num(r.quantity), 0);
    return Math.max(0, num(def.quantity) - used);
  };
  const perkTotal = Object.keys(perkMap).reduce((n, k) => n + Math.max(0, num(perkMap[k])), 0);

  // The menu: the server's first (the only one a guest can get), the inventory on a studio device.
  const amenities: LoungeAmenity[] = React.useMemo(() => {
    if (Array.isArray(lounge?.amenities) && lounge.amenities.length) return lounge.amenities;
    return (inventory || []).filter((i: any) => i.type === 'refreshment' && i.showInConcierge !== false && num(i.totalStock) > 0 && (!i.isMembersOnly || isMember)).map(toAmenity);
  }, [lounge, inventory, isMember]);
  // Grouped: members' things first, then comforts, then the rest by category. Labels only when there's more than one.
  const groups = React.useMemo(() => {
    const g: Record<string, LoungeAmenity[]> = {};
    for (const a of amenities) {
      const c = String(a.category || '').toLowerCase();
      const k = a.isMembersOnly ? 'For members' : c.includes('comfort') || c.includes('amenity') ? 'Comforts' : a.category ? String(a.category) : 'Drinks and snacks';
      (g[k] = g[k] || []).push(a);
    }
    const first = ['For members', 'Comforts'].filter((k) => g[k]);
    return [...first, ...Object.keys(g).filter((k) => !first.includes(k)).sort()].map((k) => ({ label: k, items: g[k] }));
  }, [amenities]);

  // This visit's live requests (delivered and recalled ones drop out, which is what lets them ask again).
  const live = activeRequests.filter((r) => (!r.appointmentId || r.appointmentId === appointment?.id) && !['delivered', 'cancelled'].includes(guestStageOf(r)));
  const stageOfItem = (id: string): 'new' | 'making' | 'ready' | null => {
    const rs = live.filter((r) => r.itemId === id); if (!rs.length) return null;
    return rs.some((r) => guestStageOf(r) === 'ready') ? 'ready' : rs.some((r) => guestStageOf(r) === 'making') ? 'making' : 'new';
  };
  const loading = !lounge && !loungeError;
  const item = amenities.find((a) => a.id === picked) || null;
  const maxQty = item ? Math.max(1, Math.floor(num(item.maxQty)) || 1) : 1;
  React.useEffect(() => { if (picked && !loading && !amenities.some((a) => a.id === picked)) setPicked(null); }, [picked, amenities]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (qty > maxQty) setQty(maxQty); }, [qty, maxQty]);
  const itemStage = item ? stageOfItem(item.id) : null;
  // Asked for meanwhile (on another phone, say): the choice closes, and its chip says where it is.
  React.useEffect(() => { if (itemStage && !ordering) setPicked(null); }, [itemStage]); // eslint-disable-line react-hooks/exhaustive-deps
  const priceWords = (a: LoungeAmenity, n = 1) => (isPerk(a.id) && perksLeft(a.id) >= n ? 'Included with your membership' : num(a.price) > 0 ? `${money(num(a.price) * n)}${n > 1 ? ` for ${n}` : ''}, added to your visit` : 'On the house');

  const order = async () => {
    if (!item || ordering) return;
    setOrdering(true); setOrderSaid(null);
    const d = await post({ action: 'request', itemId: item.id, quantity: qty });
    setOrdering(false);
    if (!d.ok) { setOrderSaid({ ok: false, text: d.error || 'That didn’t send. Please ask us in person.' }); return; }
    setOrderSaid({ ok: true, text: d.request?.isRedemption ? `Sent, using your membership. We’ll bring ${qty > 1 ? `${qty} ` : ''}${item.name.toLowerCase()} over.` : `Sent. We’ll bring ${qty > 1 ? `${qty} ` : ''}${item.name.toLowerCase()} over.` });
    setPicked(null); setQty(1); onRefresh();
  };
  const recall = async (id: string) => {
    if (recalling) return; setRecalling(id); setOrderSaid(null);
    const d = await post({ action: 'recall', requestId: id }); setRecalling(null);
    if (!d.ok) { setOrderSaid({ ok: false, text: d.error || 'That couldn’t be called back. Please let us know.' }); return; }
    setOrderSaid({ ok: true, text: 'Called back. Nothing is on its way for that one.' }); onRefresh();
  };

  // "Need a hand?": what can be asked for and what's already open, from the server (the floor board is team-only).
  const assistOptions: AssistOption[] = React.useMemo(() => {
    const api = Array.isArray(lounge?.assistOptions) ? lounge.assistOptions : [];
    return api.length ? api.filter((o: any) => o && typeof o.key === 'string' && typeof o.label === 'string').map((o: any) => ({ key: String(o.key), label: String(o.label), hint: String(o.hint || '') })) : ASSIST_FALLBACK;
  }, [lounge]);
  const assistLive: AssistLive[] = React.useMemo(() => {
    const rows: any[] = Array.isArray(lounge?.assist) ? lounge.assist : [];
    const out: AssistLive[] = rows.map((r) => ({ kind: String(r?.kind || ''), status: r?.status === 'acknowledged' ? 'acknowledged' : 'new', claimedByName: r?.claimedByName ? String(r.claimedByName) : null }));
    // Shown as sent straight away (a button that still looks untapped gets tapped again); the server's copy wins.
    // For 20 seconds; after that the server's list decides (once the team has dealt with it, it can be asked again).
    Object.entries(assistSent).forEach(([k, at]) => { if (Date.now() - at < 20000 && !out.some((r) => r.kind === k)) out.push({ kind: k, status: 'new', claimedByName: null }); });
    return out;
  }, [lounge, assistSent]);
  const liveAssist = (k: string) => assistLive.find((r) => r.kind === k) || null;
  const assist = async (kind: string, text?: string) => {
    if (assistSending) return; setAssistSending(kind); setAssistSaid(null);
    const d = await post({ action: 'assist', kind, note: (text || '').slice(0, 160) }); setAssistSending(null);
    if (!d.ok) { setAssistSaid({ ok: false, text: d.error || 'That didn’t send. Please ask us in person.' }); return; }
    setAssistSent((p) => ({ ...p, [kind]: Date.now() })); setNote(''); setNoteOpen(false);
    setAssistSaid({ ok: true, text: 'Sent. We’ll be right with you.' }); onRefresh();
  };

  // Other services: asking books nothing and charges nothing; the provider and the desk hear about it.
  const upsell: LoungeUpsell[] = Array.isArray(lounge?.upsell) ? lounge.upsell : [];
  const ask = async (svc: LoungeUpsell) => {
    if (asking) return; setAsking(svc.id); setAskSaid(null);
    const d = await post({ action: 'interest', serviceId: svc.id }); setAsking(null);
    if (!d.ok) { setAskSaid({ ok: false, text: d.error || 'That didn’t send. Just mention it to your provider.' }); return; }
    setAsked((p) => (p.includes(svc.id) ? p : [...p, svc.id])); setAskSaid({ ok: true, text: `Noted. We’ll tell you about ${svc.name} before you go.` });
  };

  const first = lounge?.guest?.firstName || (client?.name ? String(client.name).split(/\s+/)[0] : '');
  const who = String(staff?.name || lounge?.session?.staffName || '').split(' ')[0];
  const start = lounge?.session?.startTime || appointment?.startTime || null; const end = lounge?.session?.endTime || appointment?.endTime || null;
  const real = start ? safeDate(start) : null; const m = real ? Math.round((real.getTime() - Date.now()) / 60000) : 0;
  const when = m > 90 ? `at ${format(wallDate(real!, brand.zone), 'h:mm a')}` : m > 1 ? `in about ${m} minutes` : 'shortly';
  const station = !isWaiting && appointment?.requiredResourceIds?.length && resources ? resources.find((r: any) => r.id === appointment.requiredResourceIds[0])?.name || '' : '';

  return (
    <VisitShell brand={brand} chip={isWaiting ? 'Checked in' : 'In progress'} kicker={<span className="mb-2 inline-block"><VisitCheck /></span>}
      title={isWaiting ? <>You’re <b>checked in</b></> : <>You’re <b>all set</b></>}
      subtitle={isWaiting ? `${who ? `${who} knows` : 'We know'} you’re here and will be with you ${when}.` : `Enjoy your appointment${first ? `, ${first}` : ''}.`}>

      {live.length > 0 && <section aria-label="On its way">
        <VisitLabel>On its way</VisitLabel>
        <div className="v-grp" aria-live="polite">{live.map((r) => {
          const st = guestStageOf(r) as 'new' | 'making' | 'ready';
          // "On its way" once someone has it in hand; ready on the pass but not yet picked up says just that.
          const copy = (r as any).bringingOutAt ? GUEST_STAGE_COPY.ready : st === 'ready' ? READY_ON_PASS : GUEST_STAGE_COPY[st] || GUEST_STAGE_COPY.new;
          return <div key={r.id} className="v-row">
            <span className="v-ico" aria-hidden>{st === 'ready' ? ico(Bell) : st === 'making' ? ico(Coffee) : <span className="pub-breathe" />}</span>
            <span className="min-w-0 flex-1 py-3"><span className="block truncate font-semibold">{r.itemName}{num(r.quantity) > 1 ? ` ×${num(r.quantity)}` : ''}</span>
              <span className="block text-[13.5px]" style={{ color: 'var(--muted)' }}>{copy.note}{r.isRedemption ? ', with your membership' : ''}</span></span>
            {st === 'new' ? <button type="button" disabled={recalling === r.id} onClick={() => recall(r.id)} className="v-pill pub-press shrink-0 disabled:opacity-50">{recalling === r.id ? 'One moment…' : 'Call it back'}</button>
              : <span className="max-w-[6rem] shrink-0 text-right text-[13px]" style={{ color: 'var(--muted)' }}>Already started</span>}
          </div>; })}</div>
      </section>}

      {(loading || amenities.length > 0 || loungeError) && <section aria-label="While you wait" className="space-y-3">
        <div className="px-1"><h2 className="text-[19px] font-semibold" style={{ letterSpacing: '-.01em' }}>While you wait</h2>
          <p className="text-[14px]" style={{ color: 'var(--muted)' }}>Anything you’d like? We’ll bring it over.</p></div>
        {loading ? <VisitMuted>Getting what’s on offer…</VisitMuted>
          : amenities.length === 0 ? <div className="v-note space-y-2"><p>We can’t show what’s on offer right now. Just ask if you’d like anything.</p>
            <VisitButton quiet onClick={onRefresh}>Try again</VisitButton></div>
          : groups.map((g) => <div key={g.label} className="space-y-2">
            {groups.length > 1 && <p className="px-1 text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>{g.label}</p>}
            <div className="flex flex-wrap gap-2">{g.items.map((a) => {
              const st = stageOfItem(a.id); const on = picked === a.id;
              return <button key={a.id} type="button" aria-pressed={on} disabled={!!st} onClick={() => { setOrderSaid(null); setPicked(on ? null : a.id); setQty(1); }} className="v-pill pub-press disabled:opacity-60">
                {a.name}{st ? ` · ${GUEST_STAGE_COPY[st].label.toLowerCase()}` : isPerk(a.id) && perksLeft(a.id) > 0 ? ' · included' : ''}</button>; })}</div>
          </div>)}
        {item && <div className="pub-card space-y-3 p-4" aria-live="polite">
          <div className="flex items-start gap-3">
            {/^(https:\/\/|\/(?![/\\]))/.test(String(item.imageUrl || '')) ? <img src={item.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : null}
            <div className="min-w-0 flex-1"><p className="text-[16px] font-semibold">{item.name}</p>
              <p className="text-[13.5px]" style={{ color: isPerk(item.id) && perksLeft(item.id) >= qty ? 'var(--good)' : 'var(--muted)' }}>{priceWords(item, qty)}</p>
              {item.isMembersOnly && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>For members</p>}
              {isPerk(item.id) && perksLeft(item.id) < qty && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{perksLeft(item.id) > 0 ? `${perksLeft(item.id)} left with your membership this cycle` : 'Your membership’s ones are used for this cycle'}</p>}
              {item.description && <p className="pt-1 text-[14px] leading-snug" style={{ color: 'var(--muted)' }}>{item.description}</p>}</div>
          </div>
          <div className="flex items-center gap-2">
            {maxQty > 1 && <div className="flex shrink-0 items-center rounded-full" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }} role="group" aria-label="How many">
              <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} className="inline-flex h-11 w-11 items-center justify-center disabled:opacity-30"><Minus className="h-4 w-4" /></button>
              <span className="w-6 text-center text-[16px] font-semibold tabular-nums" aria-live="polite">{qty}</span>
              <button type="button" aria-label="One more" disabled={qty >= maxQty} onClick={() => setQty((n) => Math.min(maxQty, n + 1))} className="inline-flex h-11 w-11 items-center justify-center disabled:opacity-30"><Plus className="h-4 w-4" /></button></div>}
            <div className="min-w-0 flex-1"><VisitButton disabled={ordering || !!itemStage} onClick={order}>{ordering ? 'Sending…' : itemStage ? 'Already asked for' : 'Bring it over'}</VisitButton></div>
          </div>
        </div>}
      </section>}
      <VisitSaid text={orderSaid?.text} ok={orderSaid?.ok} />

      <section aria-label="Need a hand?" className="space-y-2">
        <div className="px-1"><p className="text-[16px] font-semibold">Need a hand?</p><p className="text-[14px]" style={{ color: 'var(--muted)' }}>One tap and we’ll come to you.</p></div>
        <div className="v-grp">{assistOptions.map((o) => {
          const row = liveAssist(o.key); const I = ASSIST_ICONS[o.key] || Bell;
          const status = row ? (row.status === 'acknowledged' ? (row.claimedByName ? `${row.claimedByName} is on the way` : 'Someone is on the way') : 'Sent') : o.hint;
          return <button key={o.key} type="button" disabled={!!row || !!assistSending} onClick={() => assist(o.key)} className="v-row v-tap w-full text-left disabled:cursor-default">
            <span className="v-ico" aria-hidden>{ico(I)}</span>
            <span className="min-w-0 flex-1 py-3"><span className="block font-semibold">{o.label}</span><span className="block text-[13.5px]" style={{ color: row ? 'var(--good)' : 'var(--muted)' }}>{assistSending === o.key ? 'Sending…' : status}</span></span>
          </button>; })}
          {liveAssist('assistance') ? <div className="v-row"><span className="v-ico" aria-hidden>{ico(MessageSquare)}</span><span className="flex-1 py-3 text-[14px]" style={{ color: 'var(--muted)' }}>Someone is already on the way, so you can tell them the rest in person.</span></div>
            : !noteOpen ? <button type="button" onClick={() => setNoteOpen(true)} className="v-row v-tap w-full text-left"><span className="v-ico" aria-hidden>{ico(MessageSquare)}</span><span className="flex-1 py-3 font-semibold">Something else</span></button>
            : <div className="space-y-2 px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
              <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 160))} rows={2} aria-label="What do you need?" placeholder="Tell us in a few words" className="v-field py-3" />
              <div className="flex items-center gap-2"><div className="flex-1"><VisitButton disabled={!note.trim() || !!assistSending} onClick={() => assist('assistance', note)}>{assistSending ? 'Sending…' : 'Send'}</VisitButton></div>
                <button type="button" onClick={() => { setNoteOpen(false); setNote(''); }} className="inline-flex min-h-11 items-center px-3 text-[14px] underline underline-offset-2" style={{ color: 'var(--muted)' }}>Not now</button></div>
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{note.trim().length} of 160</p></div>}
        </div>
        <VisitSaid text={assistSaid?.text} ok={assistSaid?.ok} />
      </section>

      <VisitRows label="Today" rows={[
        (lounge?.session?.serviceName || appointment?.serviceName) && { key: 's', icon: ico(Sparkles), text: lounge?.session?.serviceName || appointment?.serviceName },
        who && { key: 'w', icon: ico(User), text: `With ${who}` },
        (isWaiting || station) && { key: 'p', icon: ico(MapPin), text: isWaiting ? 'Waiting in the lounge' : `At ${station}` },
        (end || start) && { key: 't', icon: ico(Clock), text: end ? `Should finish around ${format(wallDate(safeDate(end), brand.zone), 'h:mm a')}` : `${real && real.getTime() > Date.now() ? 'Starts' : 'Started'} at ${format(wallDate(safeDate(start), brand.zone), 'h:mm a')}` },
        isMember && { key: 'm', icon: ico(Award), text: <><span className="block font-semibold">{lounge?.guest?.membershipName || activeMembership?.name || 'Member'}</span><span className="block text-[13.5px]" style={{ color: 'var(--muted)' }}>{perkTotal > 0 ? `${perkTotal} included ${perkTotal === 1 ? 'treat' : 'treats'} left this cycle` : 'Included treats used for this cycle'}</span></> },
      ]} />

      {wifi?.network && <VisitRows label="Wi-Fi" rows={[{ key: 'w', icon: ico(Wifi), chevron: false,
        text: <><span className="block font-semibold">{wifi.network}</span>{wifi.password && <span className="block break-all text-[13.5px]" style={{ color: 'var(--muted)' }}>Password: <span style={{ color: 'var(--ink)' }}>{wifi.password}</span></span>}</>,
        right: wifi.password ? <CopyButton text={wifi.password} label="Copy the Wi-Fi password" /> : undefined }]} />}

      {upsell.length > 0 && <section aria-label="While you’re here" className="space-y-2">
        <div className="px-1"><p className="text-[16px] font-semibold">While you’re here</p><p className="text-[14px]" style={{ color: 'var(--muted)' }}>Tap anything you’d like to hear about. We’ll mention it before you go.</p></div>
        <div className="v-grp">{upsell.map((s) => { const done = asked.includes(s.id); const p = num(s.price); const mins = Math.floor(num(s.duration));
          return <div key={s.id} className="v-row">
            <span className="min-w-0 flex-1 py-3"><span className="block font-semibold">{s.name}</span>
              {(p > 0 || mins > 0) && <span className="block text-[13.5px]" style={{ color: 'var(--muted)' }}>{[p > 0 ? money(p) : '', mins > 0 ? `${mins} min` : ''].filter(Boolean).join(' · ')}</span>}
              {s.description && <span className="block text-[13.5px] leading-snug" style={{ color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.description}</span>}</span>
            <button type="button" disabled={done || asking === s.id} onClick={() => ask(s)} aria-pressed={done} className="v-pill pub-press shrink-0 disabled:opacity-80">{done ? 'We’ll mention it' : asking === s.id ? 'Sending…' : 'Ask about it'}</button>
          </div>; })}</div>
        <VisitSaid text={askSaid?.text} ok={askSaid?.ok} />
      </section>}

      <VisitRows rows={[
        onMessage && { key: 'm', icon: ico(MessageSquare), text: 'Message us', onClick: onMessage },
        brand.bookHref && { key: 'b', icon: ico(Calendar), text: 'Book your next visit', href: brand.bookHref },
        portalHref && { key: 'a', icon: ico(User), text: 'Your account', href: portalHref },
      ]} />
    </VisitShell>
  );
}
