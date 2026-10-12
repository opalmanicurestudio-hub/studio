// src/app/api/tidy/route.ts — TIDY MY DAY for the team (lib/tidy-server, design canvas TD1). A provider works on their
// own day; managers on anyone's.
//   mine      → for the signed-in provider: gaps waiting on their call, today's plans, live asks, a light day to clear
//   plans     → { staffId, date } a day's gap and the ways to close it
//   clear     → { staffId } light days that could be cleared
//   ask       → { staffId, date?, key, kind? } text only the people in that plan
//   cancel    → { askId }   · block_day → { askId }   · decide → { openingId, choice: 'waitlist' | 'leave' }
//   asks      → recent asks (managers: everyone's)
//   settings  → read · save_settings → { gapMode, byStaff?, maxEarlierMin, minNoticeMin, lightMax } (managers)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const str = (v: any, n: number) => String(v ?? '').slice(0, n);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = str(b.tenantId, 120); const action = str(b.action, 30);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing business.' }, { status: 400 });
  const db = getAdminDb();
  const { requestActor } = await import('@/lib/request-actor');
  const w = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error }, { status: w.status });
  const me = w.actor; const boss = me.isManager || me.isOwner;
  const X = await import('@/lib/tidy-server');
  // Your own day, or (managers) anyone's.
  const who = (id: any) => { const s = str(id, 120) || me.staffId; return s === me.staffId || boss ? s : null; };
  const scope = boss ? null : me.staffId;
  try {
    if (action === 'mine') {
      const sid = me.staffId; const now = Date.now();
      const gaps = await X.awaiting(db, tenantId, sid, now);
      const days: any[] = []; const today = await X.tidyPlans(db, tenantId, sid, null, now); days.push(today);
      for (const g of gaps) { const tz = today.tz; const date = new Date(g.date).toLocaleDateString('en-CA', { timeZone: tz }); if (!days.some((d) => d.date === date)) days.push(await X.tidyPlans(db, tenantId, sid, date, now)); }
      const clear = await X.clearPlans(db, tenantId, sid, now);
      return NextResponse.json({ ok: true, gaps, days: days.filter((d) => d.gap || d.asking.length), asks: await X.recentAsks(db, tenantId, sid, now), clear: clear.days.slice(0, 2) });
    }
    if (action === 'plans') { const sid = who(b.staffId); if (!sid) return NextResponse.json({ ok: false, error: 'You can tidy your own day.' }, { status: 403 }); return NextResponse.json(await X.tidyPlans(db, tenantId, sid, /^\d{4}-\d{2}-\d{2}$/.test(str(b.date, 10)) ? str(b.date, 10) : null)); }
    if (action === 'clear') { const sid = who(b.staffId); if (!sid) return NextResponse.json({ ok: false, error: 'You can tidy your own days.' }, { status: 403 }); return NextResponse.json(await X.clearPlans(db, tenantId, sid)); }
    if (action === 'ask') { const sid = who(b.staffId); if (!sid) return NextResponse.json({ ok: false, error: 'You can tidy your own day.' }, { status: 403 });
      return NextResponse.json(await X.askTidy(db, tenantId, me, { staffId: sid, date: /^\d{4}-\d{2}-\d{2}$/.test(str(b.date, 10)) ? str(b.date, 10) : null, key: str(b.key, 2000), kind: b.kind === 'clear' ? 'clear' : 'day' })); }
    if (action === 'cancel') return NextResponse.json(await X.cancelTidy(db, tenantId, str(b.askId, 60), scope));
    if (action === 'block_day') return NextResponse.json(await X.blockDay(db, tenantId, str(b.askId, 60), scope));
    if (action === 'decide') return NextResponse.json(await X.decideGap(db, tenantId, str(b.openingId, 160), b.choice === 'leave' ? 'leave' : 'waitlist', scope));
    if (action === 'asks') return NextResponse.json({ ok: true, asks: await X.recentAsks(db, tenantId, scope), gaps: await X.awaiting(db, tenantId, scope) });
    if (action === 'settings' || action === 'save_settings') {
      const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      if (action === 'save_settings') {
        if (!boss) return NextResponse.json({ ok: false, error: 'Managers only.' }, { status: 403 });
        const cur = tenant.tidy || {}; const mode = (v: any) => (['ask', 'waitlist', 'tidy'].includes(v) ? v : undefined);
        const byStaff: any = { ...(cur.byStaff || {}) }; if (b.byStaff && typeof b.byStaff === 'object') for (const [k, v] of Object.entries(b.byStaff).slice(0, 100)) { const m = mode((v as any)?.gapMode); if (m) byStaff[str(k, 120)] = { gapMode: m }; else delete byStaff[str(k, 120)]; }
        const next = { ...cur, ...(mode(b.gapMode) ? { gapMode: b.gapMode } : {}), byStaff, ...(Number(b.maxEarlierMin) ? { maxEarlierMin: Number(b.maxEarlierMin) } : {}), ...(Number(b.minNoticeMin) ? { minNoticeMin: Number(b.minNoticeMin) } : {}), ...(Number(b.lightMax) ? { lightMax: Number(b.lightMax) } : {}) };
        await db.doc(`tenants/${tenantId}`).set({ tidy: next }, { merge: true }); return NextResponse.json({ ok: true, settings: X.settingsOf({ tidy: next }), byStaff: next.byStaff });
      }
      const staff = (await db.collection(`tenants/${tenantId}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((m: any) => !m.archived && m.isActive !== false && !['front_desk'].includes(String(m.role || '')) && !m.isRenter && m.role !== 'renter').map((m: any) => ({ id: m.id, name: m.name || '' }));
      return NextResponse.json({ ok: true, settings: X.settingsOf(tenant), byStaff: tenant.tidy?.byStaff || {}, staff, me: me.staffId, boss });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (e) { console.error('[tidy]', e); return NextResponse.json({ ok: false, error: 'Something went wrong — try again.' }, { status: 500 }); }
}
