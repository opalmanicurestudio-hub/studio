'use client';
// src/components/close/NightReportView.tsx — THE NIGHT'S REPORT (lib/night-close nightReport), as /close shows it to a
// manager: the totals, sales by hour, comps, voids and waste, tips as shared, how guests paid, the drawers, deliveries and
// app orders on their own, and anything worth a look (a reading out of its limit, a drawer short or over, comps well above
// a usual night, a delivery still to settle).
import type { DeliveryNight, NightReport } from '@/lib/night-close';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const $ = (n: number | null | undefined) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Card({ title, right, children, sub }: { title: string; right?: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-[#fff] p-5 space-y-2">
      <div className="flex items-baseline justify-between gap-3"><h3 className="text-[17px] font-semibold">{title}</h3>{right && <span className="text-[17px] font-semibold tabular-nums">{right}</span>}</div>
      {sub && <p className="text-[13px] -mt-1" style={{ color: MUTED }}>{sub}</p>}
      {children}
    </section>
  );
}
const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
  <div className="flex justify-between gap-3 text-[14px] leading-snug"><span style={{ color: strong ? INK : MUTED, fontWeight: strong ? 600 : 400 }}>{k}</span><span className="tabular-nums" style={{ fontWeight: strong ? 600 : 400 }}>{v}</span></div>
);
const Sep = () => <div className="h-px my-1" style={{ background: LINE }} />;

export function NightReportView({ r }: { r: NightReport }) {
  const max = Math.max(1, ...r.sales.byHour.map((h) => h.amount));
  return (
    <div className="space-y-4" style={{ color: INK }}>
      {r.flags.length > 0 && (
        <section className="rounded-3xl p-5 space-y-2" style={{ background: AMBER_TINT }} aria-label="Worth a look">
          <h3 className="text-[16px] font-semibold" style={{ color: AMBER }}>Worth a look</h3>
          <ul className="space-y-1">{r.flags.map((f, i) => <li key={i} className="text-[14px] leading-snug">{f}</li>)}</ul>
        </section>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[[$(r.sales.total), 'Sales, before tax and tips'], [String(r.guests.covers || '—'), 'Guests at tables'], [r.guests.perGuest === null ? '—' : $(r.guests.perGuest), 'Average per guest'], [$(r.sales.tips), 'Tips']].map(([v, k]) => (
          <div key={k} className="rounded-3xl bg-[#fff] p-4"><p className="text-[26px] font-semibold tracking-tight tabular-nums">{v}</p><p className="text-[13px]" style={{ color: MUTED }}>{k}</p></div>
        ))}
      </div>
      {r.unplaced && <p className="text-[13.5px]" style={{ color: MUTED }}>{r.unplaced.count === 1 ? 'One sale' : `${r.unplaced.count} sales`} tonight, {$(r.unplaced.total)}, {r.unplaced.count === 1 ? 'wasn’t' : 'weren’t'} at a location (fees paid online, or from before there were locations), so {r.unplaced.count === 1 ? 'it’s' : 'they’re'} on the whole business’s report.</p>}
      {r.sales.byHour.length > 0 && (
        <Card title="Sales by hour">
          <div className="flex items-end gap-2 h-36 pt-4" role="img" aria-label={`Sales by hour: ${r.sales.byHour.map((h) => `${h.hour} ${$(h.amount)}`).join(', ')}`}>
            {r.sales.byHour.map((h) => (
              <div key={h.hour} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1 h-full">
                <span className="text-[10.5px] font-semibold tabular-nums" style={{ color: INK }}>{h.amount >= 1000 ? `$${(h.amount / 1000).toFixed(1)}k` : `$${Math.round(h.amount)}`}</span>
                <span className="w-full max-w-[40px]" style={{ height: `${Math.max(3, (h.amount / max) * 100)}%`, background: INK, borderRadius: '6px 6px 2px 2px' }} />
                <span className="text-[11px]" style={{ color: MUTED }}>{h.hour}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        <Card title="Comps" right={$(r.comps.total)} sub={`${r.comps.count} ${r.comps.count === 1 ? 'item' : 'items'}${r.comps.usual ? `, a usual night is about ${$(r.comps.usual)}` : ''}`}>
          {r.comps.byReason.map((x) => <Row key={x.label} k={`${x.label}, ${x.count}`} v={$(x.amount)} />)}
          {r.comps.byPerson.length > 0 && <><Sep />{r.comps.byPerson.map((x) => <Row key={x.label} k={x.label} v={$(x.amount)} />)}</>}
          {!r.comps.count && <p className="text-[14px]" style={{ color: MUTED }}>None tonight.</p>}
        </Card>
        {(r.discounts?.count || 0) > 0 && <Card title="Discounts" right={$(r.discounts.total)} sub={`${r.discounts.count} at the counter, by name`}>
          {r.discounts.byLabel.map((x) => <Row key={x.label} k={`${x.label}, ${x.count}`} v={$(x.amount)} />)}
          {r.discounts.okayed.length > 0 && <><Sep />{r.discounts.okayed.map((x) => <Row key={x.label} k={`Okayed by ${x.label}`} v={$(x.amount)} />)}</>}
        </Card>}
        <Card title="Voids" right={$(r.voids.total)} sub="Every one has a reason and a name">
          <Row k={`Before the kitchen started, ${r.voids.before.count}`} v={$(r.voids.before.amount)} />
          <Row k={`After it started, ${r.voids.after.count}`} v={$(r.voids.after.amount)} />
          {r.voids.byReason.length > 0 && <><Sep />{r.voids.byReason.map((x) => <Row key={x.label} k={x.label} v={$(x.amount)} />)}</>}
          {r.remakes.count > 0 && <Row k="Made again" v={String(r.remakes.count)} />}
          <div className="mt-2 rounded-xl px-3 py-2 text-[13.5px] flex justify-between" style={{ background: AMBER_TINT }}><span>Waste, cost to make</span><b className="font-semibold tabular-nums">{$(r.waste)}</b></div>
        </Card>
        <Card title="How guests paid">
          {r.sales.byMethod.map((m) => <Row key={m.method} k={m.method} v={$(m.amount)} />)}
          <Sep /><Row k="Taken" v={$(r.sales.taken ?? r.sales.total)} strong />
          <Row k="Tax" v={$(r.sales.tax)} /><Row k="Tips" v={$(r.sales.tips)} />
          {r.giftCards && <Row k={`Gift cards sold, ${r.giftCards.count}, held for guests`} v={$(r.giftCards.total)} />}
          {(r.sales.refunds || 0) > 0 && <Row k="Refunded on tonight’s sales" v={$(r.sales.refunds)} />}
          <Row k="Sales, after discounts and refunds" v={$(r.sales.total)} />
        </Card>
        <Card title="Tips" right={$(r.tips.total)} sub={r.place && r.tips.mode !== 'direct' ? 'Shared out on the whole business’s report' : r.tips.mode === 'direct' ? 'Each person keeps their own' : r.tips.mode === 'pool' ? 'Pooled, as your tip sharing is set' : 'Shared out, as your tip sharing is set'}>
          {r.place ? <p className="text-[14px]" style={{ color: MUTED }}>Each person’s tips are on the whole business’s report, with every location’s.</p> : r.tips.rows.length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>No tips recorded to anyone tonight.</p> : r.tips.rows.map((t) => (
            <div key={t.name} className="flex justify-between gap-3 text-[14px] leading-snug"><span>{t.name}{t.shared ? <span style={{ color: MUTED }}>{t.shared > 0 ? `, got ${$(t.shared)}` : `, shared ${$(-t.shared)}`}</span> : null}</span><span className="tabular-nums font-semibold">{$(t.takesHome)}</span></div>
          ))}
        </Card>
        {(() => { const D = (r as any).deliveries as DeliveryNight | null | undefined; if (!D) return null; const c = (n: number) => $(n / 100);
          const hot = D.delivered + D.refunded + D.pickedUp + D.notSettled + D.going;
          return (<>
            {hot > 0 && <Card title="Deliveries" right={String(D.delivered)} sub="Hot food delivered by your drivers">
              {(D.refunded + D.pickedUp + D.notSettled) > 0 && <Row k="Couldn’t be delivered" v={[D.refunded ? `${D.refunded} refunded` : '', D.pickedUp ? `${D.pickedUp} picked up` : '', D.notSettled ? `${D.notSettled} to settle` : ''].filter(Boolean).join(', ')} />}
              {D.going > 0 && <Row k="Still going" v={String(D.going)} />}
              <Row k="Delivery fees" v={c(D.feeCents)} />
              {D.tips.length > 0 && <><Sep /><p className="text-[13px]" style={{ color: MUTED }}>Driver tips, in the night’s tips</p>{D.tips.map((t) => <Row key={t.name} k={t.name} v={c(t.cents)} />)}</>}
              {D.tipsWaitingCents > 0 && <Row k="Tips on deliveries not made yet" v={c(D.tipsWaitingCents)} />}
            </Card>}
            {D.apps.length > 0 && <Card title="App orders" sub="Paid out by the apps, never in the drawer">
              {D.apps.map((a) => <div key={a.label} className="space-y-0.5"><Row k={`${a.label}, ${a.orders} ${a.orders === 1 ? 'order' : 'orders'}`} v={c(a.grossCents)} />{a.feeCents > 0 && <Row k="Its share" v={`−${c(a.feeCents)}`} />}</div>)}
            </Card>}
            {(D.later?.orders || 0) > 0 && <Card title="Orders for another day" sub="In tonight’s sales, made on their own day">
              <Row k={`${D.later!.orders} paid tonight`} v={c(D.later!.cents)} />
            </Card>}
            {(D.refunds?.count || 0) > 0 && <Card title="Refunds at the counter" sub="Given back tonight, whenever it was paid">
              {D.refunds!.rows.map((f, i) => <Row key={`${f.number}-${i}`} k={`${f.number}, ${f.reason}, okayed by ${f.approvedBy}`} v={c(f.cents)} />)}
              <Sep /><Row k="All of it" v={c(D.refunds!.cents)} />
            </Card>}
            {(D.held?.orders || 0) > 0 && <Card title="Split bills still open" sub={`${D.held!.numbers.join(', ')}. In sales once the last share is paid.`}>
              <Row k="Shares paid in cash, in the drawer" v={c(D.held!.cashCents)} />
              <Row k="Shares paid by card" v={c(D.held!.cardCents)} />
            </Card>}
          </>); })()}
        <Card title="Drawers">
          {r.drawers.length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>No drawer was opened tonight.</p> : r.drawers.map((d, i) => (
            <div key={i} className="space-y-1 pt-1" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
              <Row k={`Opened by ${d.openedBy}`} v={d.status === 'open' ? 'Still open' : ''} />
              <Row k="Started with" v={$(d.openingFloat)} /><Row k="Should have" v={$(d.expectedCash)} />
              <Row k="Counted" v={d.actualCash === null ? 'Not yet' : $(d.actualCash)} />
              {d.overShort !== null && <Row k={d.overShort < 0 ? 'Short' : d.overShort > 0 ? 'Over' : 'Even'} v={d.overShort ? $(Math.abs(d.overShort)) : ''} strong />}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
