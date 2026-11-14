'use client';
// src/app/wait/[tenantId]/[token]/page.tsx — A WAITING GUEST'S OWN LINK (design canvas WaitLink), in the business's look:
// their place in line and about how long, worked out from the same floor the host sees (lib/wait-line), kept up to date
// while the page is open. When their table's ready it says so, and how long it's held. They can ask for more time (as
// often as the business allows), leave the list, and, when the business offers it, pick a drink for when they sit: it
// goes on their table's check, and the bar makes it when they sit down or when we text them, as the business chose.
// Never shows anyone else on the list. /api/wait.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitLabel, VisitSaid, VisitCheck, brandFromLook, useLook } from '@/components/booking/VisitShell';

const POLL_MS = 20000;
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
type Line = { itemId: string; name: string; price: number; qty: number };
type Drink = { id: string; name: string; price: number; section: string; contains: string };

export default function WaitPage() {
  const { tenantId, token } = useParams() as { tenantId: string; token: string };
  const [v, setV] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const [all, setAll] = React.useState(false); const [leaving, setLeaving] = React.useState(false);
  const post = React.useCallback((action: string, extra: any = {}) => fetch('/api/wait', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, token, action, ...extra }) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection. Try again in a moment.' })), [tenantId, token]);
  // A check that doesn't get through (a moment offline) keeps what's on the screen; only a first look shows the error.
  const load = React.useCallback(() => post('view').then((r) => { setV((prev: any) => (r?.ok || !prev?.ok ? r : prev)); }), [post]);
  React.useEffect(() => {
    void load(); const i = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') void load(); }; document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [load]);
  const act = async (action: string, extra: any = {}) => {
    setBusy(`${action}:${extra.itemId || ''}`); setErr('');
    const r = await post(action, extra); setBusy('');
    if (!r?.ok) setErr(r?.error || 'That didn’t go through.');
    await load();
  };

  const { look, ready } = useLook(tenantId, v?.look);
  const brand = brandFromLook(look, tenantId); if (!brand.studioName && v?.business) brand.studioName = v.business;
  const at = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(brand.zone ? { timeZone: brand.zone } : {}) }) : '');
  if (!ready) return <div className="min-h-dvh" aria-busy="true" />;
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link isn’t working"><VisitCard><VisitMuted>{v.error || 'Ask the host for your place in line.'}</VisitMuted></VisitCard></VisitShell>;
  const name = v.first ? `, ${v.first}` : '';
  if (v.state === 'seated') return <VisitShell brand={brand} title={<>You’re seated{name}</>} subtitle="Enjoy your meal."><div className="flex justify-center py-2"><VisitCheck /></div>
    {v.rung && v.preorder.length > 0 && <VisitCard><VisitMuted>Your drinks are on their way, and on your table’s check.</VisitMuted></VisitCard>}</VisitShell>;
  if (v.state === 'left') return <VisitShell brand={brand} title="You’ve left the list" subtitle="Thanks for letting us know. Come back any time." />;
  if (v.state === 'closed') return <VisitShell brand={brand} title="The list has closed for today" subtitle="Come back and see the host for a table." />;
  if (v.state === 'done') return <VisitShell brand={brand} title="This link has finished" subtitle="Thanks for coming in." />;

  const isReady = v.state === 'ready';
  const lines: Line[] = Array.isArray(v.preorder) ? v.preorder : [];
  const qty = (id: string) => lines.find((l) => l.itemId === id)?.qty || 0;
  const drinks: Drink[] = Array.isArray(v.drinks) ? v.drinks : [];
  const picked = drinks.filter((d) => qty(d.id) > 0);
  const shown = all ? drinks : [...picked, ...drinks.filter((d) => qty(d.id) === 0)].slice(0, Math.max(5, picked.length));
  const placeBig = v.ahead === 0 ? 'Next' : v.placeWords.replace(/ in line$/, '');

  return (
    <VisitShell brand={brand} title={isReady ? <>Your table’s ready{name}</> : <>You’re on the list{name}</>}
      subtitle={isReady ? (v.holdUntil ? `Please head to the host stand. ${v.holdTable ? `${v.holdTable} is` : 'It’s'} held for you until ${at(v.holdUntil)}.` : 'Please head to the host stand.') : undefined}>
      {!isReady && <VisitCard>
        <div className="flex items-center gap-4">
          <div className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-full text-center" style={{ background: 'var(--soft)' }}>
            <span className="leading-none"><span className="block text-[26px] font-semibold tabular-nums">{placeBig}</span><span className="mt-1 block text-[12px]" style={{ color: 'var(--muted)' }}>in line for {v.size}</span></span>
          </div>
          <div className="min-w-0">
            <p className="text-[22px] font-semibold leading-tight">{v.minutesWords}</p>
            <p className="mt-1 text-[14px] leading-snug" style={{ color: 'var(--muted)' }}>{v.laterUntil ? `You asked for more time. You’re back in line at ${at(v.laterUntil)}.` : 'We’ll text you the moment your table is ready. This page keeps itself up to date.'}</p>
          </div>
        </div>
      </VisitCard>}
      {isReady && <div className="flex justify-center py-1"><VisitCheck /></div>}
      <VisitSaid text={err} />

      {v.preorderOn && (v.rung ? lines.length > 0 && <VisitCard><VisitMuted>The bar has your drinks: {lines.map((l) => (l.qty > 1 ? `${l.qty} ${l.name}` : l.name)).join(', ')}. They’re on your table’s check.</VisitMuted></VisitCard>
        : drinks.length > 0 && <section aria-label="A drink for when you sit" className="space-y-2">
          <div className="px-1"><p className="text-[17px] font-semibold">A drink for when you sit?</p>
            <p className="text-[14px] leading-snug" style={{ color: 'var(--muted)' }}>{v.drinksWhen === 'ready' ? 'The bar makes it when we call you, and it goes on your table’s check.' : 'The bar makes it when you sit down, and it goes on your table’s check.'}</p></div>
          <div className="v-grp">
            {shown.map((d) => { const n = qty(d.id); const b = busy.endsWith(`:${d.id}`);
              return (
                <div key={d.id} className="v-row" style={{ minHeight: 64 }}>
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{d.name}</span><span className="block text-[13px]" style={{ color: 'var(--muted)' }}>{money(d.price)}{d.contains ? `. ${d.contains}` : ''}</span></span>
                  {n > 0 && <><button type="button" aria-label={`One fewer ${d.name}`} disabled={b} onClick={() => act('remove', { itemId: d.id })} className="v-pill grid w-11 place-items-center px-0 text-[20px]">−</button>
                    <span className="w-6 text-center font-semibold tabular-nums" aria-live="polite">{n}</span></>}
                  <button type="button" aria-label={`Add ${d.name}`} disabled={b} onClick={() => act('add', { itemId: d.id })} className="v-pill grid w-11 place-items-center px-0 text-[20px]">+</button>
                </div>);
            })}
          </div>
          {drinks.length > shown.length && <button type="button" onClick={() => setAll(true)} className="v-pill w-full">See all {drinks.length} drinks</button>}
          {lines.length > 0 && <p className="px-1 text-[14.5px]">Your drinks: <b className="font-semibold">{money(v.preorderTotal)}</b>, on your table’s check</p>}
        </section>)}

      <div className="space-y-2 pt-2">
        {v.canLater && !leaving && <VisitButton quiet disabled={!!busy} onClick={() => act('later')}>Need {v.moreMin} more min</VisitButton>}
        {!leaving ? <VisitButton quiet danger disabled={!!busy} onClick={() => setLeaving(true)}>Leave the list</VisitButton>
          : <VisitCard tone="warn"><VisitLabel>Leave the list?</VisitLabel><VisitMuted>You’ll lose your place{lines.length && !v.rung ? ', and your drinks won’t be made' : ''}.</VisitMuted>
            <VisitButton danger disabled={!!busy} onClick={() => act('leave')}>Yes, leave the list</VisitButton><VisitButton quiet onClick={() => setLeaving(false)}>Stay on the list</VisitButton></VisitCard>}
      </div>
    </VisitShell>
  );
}
