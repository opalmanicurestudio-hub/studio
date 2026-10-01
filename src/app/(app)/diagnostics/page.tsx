'use client';
// src/app/(app)/diagnostics/page.tsx — WHAT THIS DEVICE ACTUALLY SEES (signed-in, read-only).
// Opened at /diagnostics. Shows who you are, which business and role the app picked, the location list before and after
// filtering, a live test read of each key area (refusals shown word for word), and a 15-second timeline of every change
// — which captures a "shows, then disappears" moment exactly. Nothing here changes any data.
import * as React from 'react';
import { collection, doc, getDoc, getDocs, limit, query } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';

export default function DiagnosticsPage() {
  const { firestore, user } = useFirebase() as any;
  const t: any = useTenant(); const l: any = useLocation();
  const [api, setApi] = React.useState<any>(null); const [probes, setProbes] = React.useState<any[]>([]); const [tenantDoc, setTenantDoc] = React.useState<any>(null);
  const [timeline, setTimeline] = React.useState<string[]>([]); const start = React.useRef(Date.now());
  const snap = `tenant=${t?.selectedTenant?.id || '—'} · role=${t?.role || '—'} · tenantLoading=${!!t?.isLoading} · locations=${(l?.locations || []).length} [${(l?.locations || []).map((x: any) => x.name).join(', ')}] · selectedLocation=${l?.selectedLocationId || '—'} · locLoading=${!!l?.isLoading}`;
  React.useEffect(() => { const s = ((Date.now() - start.current) / 1000).toFixed(1); setTimeline((tl) => (tl[tl.length - 1]?.endsWith(snap) || (Date.now() - start.current) > 15000 ? tl : [...tl, `${s}s  ${snap}`])); }, [snap]);
  React.useEffect(() => { (async () => { try { const tk = await getAuth().currentUser?.getIdToken(); const r = await fetch('/api/my-tenants', { headers: { Authorization: `Bearer ${tk}` }, cache: 'no-store' }); setApi({ status: r.status, body: await r.json().catch(() => null) }); } catch (e: any) { setApi({ error: String(e?.message || e) }); } })(); }, [user?.uid]);
  const tid = t?.selectedTenant?.id || null;
  React.useEffect(() => { if (!firestore || !tid) return; (async () => {
    try { const d = await getDoc(doc(firestore, 'tenants', tid)); const x: any = d.data() || {}; setTenantDoc({ exists: d.exists(), name: x.name || null, userId: x.userId || '(missing)', userIdMatchesMe: x.userId === user?.uid, primaryLocationId: x.primaryLocationId || null }); } catch (e: any) { setTenantDoc({ error: String(e?.code || e?.message || e) }); }
    const out: any[] = [];
    for (const c of ['locations', 'appointments', 'clients', 'retailOrders', 'calls', 'waitlist', 'staff', 'inventory']) {
      try { const s = await getDocs(query(collection(firestore, `tenants/${tid}/${c}`), limit(50))); out.push({ area: c, ok: true, count: s.size, sample: c === 'locations' ? s.docs.map((d) => ({ id: d.id, name: (d.data() as any).name, timezone: (d.data() as any).timezone || null, locationTypeId: (d.data() as any).locationTypeId || null, isActive: (d.data() as any).isActive })) : undefined }); }
      catch (e: any) { out.push({ area: c, ok: false, error: String(e?.code || '') + ' ' + String(e?.message || e).slice(0, 140) }); }
    }
    try { const s = await getDoc(doc(firestore, 'tenants', tid, 'staff', user?.uid || 'x')); out.push({ area: 'my staff record', ok: true, exists: s.exists(), role: (s.data() as any)?.role || null }); } catch (e: any) { out.push({ area: 'my staff record', ok: false, error: String(e?.code || e) }); }
    setProbes(out); })(); }, [firestore, tid, user?.uid]);
  let ls: any = {}; try { ls = { selectedTenantId: localStorage.getItem('selectedTenantId'), selectedLocationId: localStorage.getItem('selectedLocationId') }; } catch { /* */ }
  const report = { when: new Date().toISOString(), me: { uid: user?.uid || null, email: user?.email || null }, serverSaysIOwn: api, appPicked: { tenantId: tid, tenantName: t?.selectedTenant?.name || null, role: t?.role || null }, tenantRecord: tenantDoc, locationsInApp: (l?.locations || []).map((x: any) => ({ id: x.id, name: x.name })), selectedLocationId: l?.selectedLocationId || null, storedOnThisDevice: ls, testReads: probes, timeline };
  const text = JSON.stringify(report, null, 2);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Diagnostics</h1>
      <p className="text-sm text-muted-foreground">What this device sees. Wait 15 seconds, then tap <b>Copy report</b> and paste it to Claude (or screenshot the whole page).</p>
      <button type="button" onClick={() => navigator.clipboard?.writeText(text)} className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">Copy report</button>
      <div className="space-y-2 rounded-2xl border p-4 text-sm">
        <p><b>Timeline</b> (every change in the first 15 s)</p>
        {timeline.map((x, i) => <p key={i} className="font-mono text-xs break-words">{x}</p>)}
      </div>
      <div className="space-y-1 rounded-2xl border p-4 text-sm">
        <p><b>Test reads</b></p>
        {probes.length ? probes.map((p) => <p key={p.area} className="font-mono text-xs break-words">{p.ok ? '✓' : '✗'} {p.area}: {p.ok ? `${p.count ?? (p.exists ? 'exists' : 'missing')}${p.role ? ` (${p.role})` : ''}` : p.error}</p>) : <p className="text-xs">Running…</p>}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border p-4 text-[11px]">{text}</pre>
    </div>
  );
}
