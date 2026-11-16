'use client';
// src/components/products/YieldPanel.tsx — WHAT YOU PAY FOR, WHAT YOU SERVE (design canvas "Food numbers": Yields). On an
// ingredient's product page: the share usable after trimming, the share lost in cooking when a recipe weighs it cooked,
// what an amount costs as bought and as served, and what one gives when it's counted one by one (a lemon's juice). The
// business measures its own yield in three steps, or starts from a typical one. Saved through api/food-cost 'yield';
// every recipe that uses it then costs it, and takes it off stock, at what's really served (lib/kitchen-units).
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { Btn, C, Sheet, muted } from '@/components/orders/ui';
import { canonUnit, cookLossOf, measuredYield, perEachOf, TYPICAL_YIELDS, usableOf, VOLUMES, WEIGHTS, yieldOf, COOK_LOSS_MAX, USABLE_MIN } from '@/lib/kitchen-units';
import { unitCost, unitLabel } from '@/lib/product-cost';

const money = (n: number) => `$${n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;
const card: React.CSSProperties = { background: C.paper, border: `1px solid ${C.line}` };
const field = 'h-12 w-full rounded-xl px-3 text-[16px] tabular-nums outline-none';
const fieldStyle: React.CSSProperties = { border: `1px solid ${C.line}`, background: C.paper, color: C.ink };

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/food-cost', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

/** An amount as it reads best for what it's counted in: per oz or lb for a weight bought that way, per 100 g or 100 ml
 *  for the small metric units, per one for everything else. */
function perWords(unit: string): { per: number; label: string } {
  const c = canonUnit(unit);
  if (c === 'g' || c === 'ml') return { per: 100, label: `100 ${c}` };
  return { per: 1, label: c || (unit === 'each' ? 'one' : unit.replace(/s$/, '')) };
}

export function YieldPanel({ tenantId, product, usedIn, onSaved }: { tenantId: string; product: any; usedIn: { id: string; name: string }[]; onSaved?: (patch: any) => void }) {
  const [open, setOpen] = React.useState(false);
  const [local, setLocal] = React.useState<any>({});
  const p = { ...product, ...local };
  const unit = unitLabel(p); const cost = unitCost(p); const y = yieldOf(p);
  const counted = !canonUnit(unit); const pe = perEachOf(p);
  const { per, label } = perWords(unit);
  const usable = Math.round(usableOf(p) * 100); const loss = Math.round(cookLossOf(p) * 100);
  const ex = WEIGHTS.includes(canonUnit(unit) || '') ? 'oz' : 'fl oz';
  return (
    <section className="rounded-2xl p-5" style={card} aria-labelledby="yield-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="yield-title" className="m-0 text-[17px] font-semibold">In recipes</h2>
        <Btn kind="soft" onClick={() => setOpen(true)}>{y < 0.9995 || pe ? 'Change' : counted ? 'Set what one gives' : 'Set its yield'}</Btn>
      </div>
      {usedIn.length > 0 && <p className="m-0 mb-2 text-[14px]" style={muted}>Used in {usedIn.slice(0, 4).map((x) => x.name).join(', ')}{usedIn.length > 4 ? ` and ${usedIn.length - 4} more` : ''}.</p>}
      {!counted && (
        <div className="grid grid-cols-2 gap-3 rounded-2xl p-4" style={{ background: C.soft }}>
          <div><p className="m-0 text-[13px] font-semibold" style={muted}>As bought</p><p className="m-0 mt-0.5 text-[20px] font-semibold tabular-nums">{cost === null ? 'No cost yet' : `${money(cost * per)} per ${label}`}</p></div>
          <div><p className="m-0 text-[13px] font-semibold" style={muted}>What you can serve</p><p className="m-0 mt-0.5 text-[20px] font-semibold tabular-nums" style={y < 0.9995 ? { color: C.warn } : undefined}>{cost === null ? '—' : `${money((cost / y) * per)} per ${label}`}</p></div>
          <p className="col-span-2 m-0 text-[14px] leading-snug">{y < 0.9995
            ? <>{usable < 100 ? `${usable}% usable after trimming` : ''}{usable < 100 && loss ? ', and ' : ''}{loss ? `${loss}% lost in cooking` : ''}. A 6 {ex} portion takes {Math.round((6 / y) * 10) / 10} {ex} off stock, and costs that much.</>
            : 'All of it is served as bought. If you trim it (skin, bones, ends, peel) or a recipe weighs it cooked, set its yield so recipes cost what’s really on the plate.'}</p>
        </div>
      )}
      {counted && (
        <p className="m-0 rounded-2xl px-4 py-3 text-[14px] leading-snug" style={{ background: C.soft }}>{pe
          ? <>One gives about <b className="font-semibold">{pe.amount} {pe.unit}</b>. A recipe can use it by the {pe.unit} ({VOLUMES.includes(pe.unit) ? 'say 120 ml of juice' : 'say 230 g'}) and it’s counted by how many that takes.</>
          : `Counted one by one (${unit}). If a recipe measures it (a lemon’s juice in ml, an onion in g), say what one gives, and recipes can use it that way.`}</p>
      )}
      {open && <YieldSheet tenantId={tenantId} product={p} onClose={() => setOpen(false)} onSaved={(patch) => { setLocal((l: any) => ({ ...l, ...patch })); onSaved?.(patch); setOpen(false); }} />}
    </section>
  );
}

function YieldSheet({ tenantId, product, onClose, onSaved }: { tenantId: string; product: any; onClose: () => void; onSaved: (patch: any) => void }) {
  const unit = unitLabel(product); const counted = !canonUnit(unit); const pe = perEachOf(product);
  const [usable, setUsable] = React.useState(Number(product.usablePct) > 0 ? String(product.usablePct) : '');
  const [loss, setLoss] = React.useState(Number(product.cookLossPct) > 0 ? String(product.cookLossPct) : '');
  const [inW, setInW] = React.useState(''); const [outW, setOutW] = React.useState('');
  const [peAmt, setPeAmt] = React.useState(pe ? String(pe.amount) : ''); const [peUnit, setPeUnit] = React.useState(pe?.unit || (counted ? 'ml' : canonUnit(unit) || 'g'));
  const { per, label } = perWords(unit);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const measured = measuredYield(Number(inW), Number(outW));
  const cost = unitCost(product);
  const u = Number(usable) > 0 ? Math.min(100, Number(usable)) : 100; const l = Number(loss) > 0 ? Math.min(COOK_LOSS_MAX, Number(loss)) : 0;
  const y = Math.max(0.01, (u / 100) * (1 - l / 100));
  const save = async () => {
    if (usable.trim() && !(Number(usable) >= USABLE_MIN && Number(usable) <= 100)) { setErr(`Usable after trimming: ${USABLE_MIN}% to 100%, or leave it empty.`); return; }
    if (loss.trim() && !(Number(loss) >= 0 && Number(loss) <= COOK_LOSS_MAX)) { setErr(`Lost in cooking: up to ${COOK_LOSS_MAX}%, or leave it empty.`); return; }
    if (peAmt.trim() && !(Number(peAmt) > 0)) { setErr('What one gives: an amount, like 45.'); return; }
    setBusy(true); setErr('');
    const body: any = { tenantId, action: 'yield', itemId: String(product.id) };
    if (!counted) { body.usablePct = usable.trim(); body.cookLossPct = loss.trim(); }
    body.perEach = peAmt.trim() ? { amount: Number(peAmt), unit: peUnit } : null;
    const d = await post(body); setBusy(false);
    if (!d.ok) { setErr(d.error || 'That didn’t save.'); return; }
    onSaved({ ...(d.usablePct !== undefined ? { usablePct: d.usablePct } : {}), ...(d.cookLossPct !== undefined ? { cookLossPct: d.cookLossPct } : {}), perEach: d.perEach ?? null });
  };
  // What one gives: the whole point for something counted one by one (a lemon's juice); for something bought by weight
  // or volume, only when a recipe uses one at a time (an onion), so it's tucked away there. (Called, not mounted, so a
  // field keeps its focus as it's typed in.)
  const oneGives = () => (
    <fieldset className="m-0 p-0">
      <legend className="mb-1.5 text-[13px] font-semibold">{counted ? (unit === 'each' ? 'One gives about' : `One ${unit.replace(/s$/, '')} gives about`) : 'One weighs or holds about'}</legend>
      <div className="flex gap-2">
        <input inputMode="decimal" value={peAmt} onChange={(e) => setPeAmt(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))} placeholder={counted ? '45' : '230'} aria-label="Amount one gives" className={`${field} flex-1`} style={fieldStyle} />
        <select value={peUnit} onChange={(e) => setPeUnit(e.target.value)} aria-label="Measured in" className="h-12 w-28 rounded-xl px-3 text-[16px] outline-none" style={fieldStyle}>
          {[...VOLUMES, ...WEIGHTS].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <p className="m-0 mt-1.5 text-[13px] leading-snug" style={muted}>{counted ? 'A lemon gives about 45 ml of juice; a can about 400 g. Recipes can then measure it.' : 'For a recipe that uses one at a time: an onion is about 230 g.'} Leave it empty if recipes always count it whole.</p>
    </fieldset>
  );
  return (
    <Sheet title={counted ? 'What one gives' : 'Its yield'} sub={String(product.name || '')} onClose={onClose}>
      <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {!counted && <>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="mb-1.5 block text-[13px] font-semibold">Usable after trimming</span>
              <span className="relative block"><input inputMode="numeric" value={usable} onChange={(e) => setUsable(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="100" className={`${field} pr-8`} style={fieldStyle} />
                <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[15px]" style={muted}>%</span></span></label>
            <label className="block"><span className="mb-1.5 block text-[13px] font-semibold">Lost in cooking</span>
              <span className="relative block"><input inputMode="numeric" value={loss} onChange={(e) => setLoss(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} placeholder="None" className={`${field} pr-8`} style={fieldStyle} />
                <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[15px]" style={muted}>%</span></span></label>
          </div>
          <p className="m-0 -mt-2 text-[13px] leading-snug" style={muted}>Lost in cooking: only when your recipes weigh it after it’s cooked (a 4.5 oz cooked patty). If they weigh it raw, leave it empty.</p>
          {cost !== null && <p className="m-0 rounded-2xl px-4 py-3 text-[14px]" style={{ background: C.soft }}>{Math.round(y * 100)}% of what you buy is served: what you serve costs {money((cost / y) * per)} per {label}, not {money(cost * per)}.</p>}
          <fieldset className="m-0 rounded-2xl p-4" style={{ border: `1px solid ${C.line}` }}>
            <legend className="px-1 text-[15px] font-semibold">Measure your own</legend>
            <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-[14px]">
              <li><label className="flex flex-wrap items-center gap-2">Weigh it as it comes in:<input inputMode="decimal" value={inW} onChange={(e) => setInW(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))} aria-label="Weight as it comes in" className="h-11 w-24 rounded-xl px-3 text-[16px] tabular-nums outline-none" style={fieldStyle} /></label></li>
              <li><label className="flex flex-wrap items-center gap-2">Trim it, and weigh what you’ll serve:<input inputMode="decimal" value={outW} onChange={(e) => setOutW(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))} aria-label="Weight after trimming" className="h-11 w-24 rounded-xl px-3 text-[16px] tabular-nums outline-none" style={fieldStyle} /></label></li>
              <li>That’s its yield{measured ? <>: <b className="font-semibold">{measured}%</b>.</> : '.'} Weigh it again once a month, or when the supplier changes.</li>
            </ol>
            <p className="m-0 mt-1 text-[12.5px]" style={muted}>Any scale and any unit, as long as both weights are in the same one.</p>
            {measured !== null && <Btn kind="soft" className="mt-3" onClick={() => setUsable(String(measured))}>Use {measured}%</Btn>}
          </fieldset>
          <details className="rounded-2xl px-4 py-2" style={{ background: C.soft }}>
            <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-semibold">Typical yields to start from</summary>
            <ul className="m-0 list-none p-0 pb-2">
              {TYPICAL_YIELDS.map((t) => (
                <li key={t.name} className="flex min-h-[44px] items-center justify-between gap-3 border-t text-[14px]" style={{ borderColor: C.line }}>
                  <span>{t.name}</span>
                  <button type="button" onClick={() => (t.kind === 'trim' ? setUsable(String(t.pct)) : setLoss(String(t.pct)))} className="min-h-[44px] px-2 text-[14px] font-semibold underline underline-offset-4" style={{ color: C.ink }} aria-label={`Use ${t.name}: ${t.words}`}>{t.words}</button>
                </li>))}
            </ul>
            <p className="m-0 pb-2 text-[12.5px]" style={muted}>Every kitchen and supplier differs: weigh your own when you can.</p>
          </details>
        </>}
        {counted ? oneGives() : (
          <details className="rounded-2xl px-4 py-2" style={{ border: `1px solid ${C.line}` }} open={!!pe}>
            <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-semibold">A recipe uses one at a time</summary>
            <div className="pb-3">{oneGives()}</div>
          </details>
        )}
        {err && <p role="alert" className="m-0 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
        <Btn kind="primary" type="submit" className="w-full text-[17px]" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
      </form>
    </Sheet>
  );
}
