'use client';
// src/components/documents/DocLinksEditor.tsx — "SHOWS UP DURING WORK" in the document editor (lib/doc-links): link the
// document to a service (or one step of it), a station, or a kit, so it appears on the staff app's Now card during
// those visits. A station link also gets a printable QR code — scanned at the station, it opens that station's documents.
import * as React from 'react';
import { collection } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { payPost } from '@/components/pay/pay-client';
import { phasesFromService } from '@/lib/blueprint';
import { cleanLinks, linkLabel, type DocLink } from '@/lib/doc-links';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', RED = '#b42318';
const sel = 'h-10 w-full rounded-[12px] border bg-card px-2.5 text-[14px] outline-none';
type Kind = 'service' | 'station' | 'kit';

export function DocLinksEditor({ tenantId, value, onChange, kinds = ['service', 'station', 'kit'], steps: withSteps = true }: { tenantId: string; value: DocLink[]; onChange: (v: DocLink[]) => void; kinds?: Kind[]; steps?: boolean }) {
  const { firestore } = useFirebase() as any;
  const c = (name: string) => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, name) : null);
  const { data: services } = useCollection<any>(useMemoFirebase(() => c('services'), [firestore, tenantId]));
  const { data: resources } = useCollection<any>(useMemoFirebase(() => c('resources'), [firestore, tenantId]));
  const { data: kitTypes } = useCollection<any>(useMemoFirebase(() => c('kitTypes'), [firestore, tenantId]));
  const [kind, setKind] = React.useState<Kind>(kinds[0] || 'service'); const [id, setId] = React.useState(''); const [step, setStep] = React.useState('');
  const [qrBusy, setQrBusy] = React.useState(''); const [err, setErr] = React.useState('');

  const svcList = (services || []).filter((s: any) => s.archived !== true && s.status !== 'archived').sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  const stations = (resources || []).filter((r: any) => r.archived !== true).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  const kits = (kitTypes || []).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  const list: any[] = kind === 'service' ? svcList : kind === 'station' ? stations : kits;
  const svc = kind === 'service' ? svcList.find((s: any) => s.id === id) : null;
  // A service without a blueprint has made-up steps (set-up, service, turnover) — keyed by kind, matched by label later.
  const steps: any[] = !svc ? [] : svc.blueprint?.phases?.length ? svc.blueprint.phases.filter((p: any) => p?.id) : phasesFromService(svc).map((p) => ({ ...p, id: `k-${p.kind}` }));

  const add = () => {
    const item = list.find((x: any) => x.id === id); if (!item) return;
    const st = steps.find((p: any) => p.id === step);
    const next = cleanLinks([...value, kind === 'service' ? { kind, id, name: item.name, stepId: st?.id || null, stepLabel: st ? (st.label || null) : null } : { kind, id, name: item.name }]);
    onChange(next); setId(''); setStep('');
  };
  const qr = async (l: DocLink) => {
    setQrBusy(l.id); setErr('');
    const r = await payPost('/api/documents/links', { tenantId, action: 'station-qr', stationId: l.id }); setQrBusy('');
    if (!r.ok) { setErr(r.error || 'That didn’t work.'); return; } window.open(r.path, '_blank', 'noopener');
  };

  return (
    <div className="space-y-2" style={{ color: INK }}>
      {value.length > 0 ? <div className="flex flex-wrap gap-1.5">{value.map((l, i) => <span key={`${l.kind}:${l.id}:${(l as any).stepId || ''}`} className="inline-flex h-9 max-w-full items-center gap-1 rounded-full pl-3 pr-1 text-[13px]" style={{ background: SOFT }}>
          <span className="truncate">{linkLabel(l)}</span>
          {l.kind === 'station' && <button type="button" onClick={() => qr(l)} className="h-7 rounded-full bg-card px-2.5 text-[12px] font-semibold">{qrBusy === l.id ? '…' : 'QR'}</button>}
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove ${linkLabel(l)}`} className="h-7 w-7 rounded-full text-[12px]">✕</button></span>)}</div>
        : <p className="text-[13px]" style={{ color: MUTED }}>{kinds.length > 1 ? 'Link it to a service, a step, a station or a kit and it shows up on the staff app during those visits.' : 'Pick the services it’s for.'}</p>}
      {kinds.length > 1 && <div className="flex gap-1">{([['service', 'Service'], ['station', 'Station'], ['kit', 'Kit']] as const).filter(([k]) => kinds.includes(k)).map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setId(''); setStep(''); }} className="h-8 rounded-full px-3 text-[12.5px] font-medium" style={kind === k ? { background: INK, color: 'hsl(var(--background))' } : { background: SOFT }}>{l}</button>)}</div>}
      <select value={id} onChange={(e) => { setId(e.target.value); setStep(''); }} aria-label={`Choose a ${kind}`} className={sel} style={{ borderColor: LINE }}>
        <option value="">{list.length ? `Choose a ${kind}…` : kind === 'station' ? 'No stations yet (Resources)' : kind === 'kit' ? 'No kit types yet' : 'No services yet'}</option>
        {list.map((x: any) => <option key={x.id} value={x.id}>{x.name || 'Untitled'}</option>)}</select>
      {withSteps && svc && steps.length > 1 && <select value={step} onChange={(e) => setStep(e.target.value)} aria-label="Which step" className={sel} style={{ borderColor: LINE }}>
        <option value="">The whole service</option>{steps.map((p: any) => <option key={p.id} value={p.id}>Step · {p.label}</option>)}</select>}
      {id && <button type="button" onClick={add} className="h-9 rounded-full px-3.5 text-[13px] font-semibold text-background" style={{ background: INK }}>Add the link</button>}
      {err && <p className="text-[12.5px]" style={{ color: RED }}>{err}</p>}
    </div>);
}
