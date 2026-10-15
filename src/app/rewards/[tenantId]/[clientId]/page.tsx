// src/app/rewards/[tenantId]/[clientId]/page.tsx — A CLIENT'S REWARDS (design canvas "Loyalty engine", board 3). Their
// points and what they're worth, progress to the next reward, rewards ready to use, any gift card balance beside it,
// their history and the terms in plain words. Opened by the private link (?k=) on their receipt and client page — no
// app, no sign-in. Shows first names only.
import { getAdminDb } from '@/lib/firebase-admin';
import { rewardsKey } from '@/lib/loyalty-link';
import { loyaltyOf, rewardsFor, worthCents, termsOf, unitOf, tierFor } from '@/lib/loyalty';
import { ledgerFor } from '@/lib/loyalty-server';
import { brandAccent } from '@/lib/brand-accent';

export const dynamic = 'force-dynamic';
const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', MINT = '#7fd1a5';
const font = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK, letterSpacing: '-0.01em' } as const;
const day = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export default async function RewardsPage({ params, searchParams }: { params: Promise<{ tenantId: string; clientId: string }>; searchParams: Promise<{ k?: string }> }) {
  const { tenantId, clientId } = await params; const sp = await searchParams;
  const shell = (body: React.ReactNode) => <div style={{ ...font, background: '#ffffff', minHeight: '100vh' }}><div style={{ maxWidth: 480, margin: '0 auto', padding: '28px 20px 60px', display: 'flex', flexDirection: 'column', gap: 18 }}>{body}</div></div>;
  if (!sp.k || sp.k !== rewardsKey(tenantId, clientId)) return shell(<div style={{ paddingTop: 40 }}><p style={{ fontSize: 20 }}>This link isn’t valid.</p><p style={{ color: MUTED }}>Use the link on your receipt, or ask us for a new one.</p></div>);
  const db = getAdminDb(); const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {}; const c: any = (await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data() || null;
  const S = loyaltyOf(tenant); const name = String(tenant.name || tenant.businessName || 'Your rewards'); const tz = tenant.timezone || 'America/New_York';
  if (!c || !S.on) return shell(<p style={{ color: MUTED, paddingTop: 40 }}>{name} doesn’t have a rewards program running right now.</p>);
  const ledger = await ledgerFor(db, tenantId, clientId); const bal = Math.max(0, ledger.reduce((t, e) => t + (Number(e.points) || 0), 0));
  const unit = unitOf(S); const r = rewardsFor(S, bal); const worth = worthCents(S, bal); const accent = brandAccent(tenant) || INK;
  const nextPts = r.next ? r.next.reward.points : Math.max(bal, 1); const pct = Math.max(0.02, Math.min(1, bal / nextPts)); const C = 2 * Math.PI * 40;
  const gifts = (await db.collection(`tenants/${tenantId}/giftCards`).where('recipientId', '==', clientId).get().catch(() => ({ docs: [] }))).docs.map((d: any) => d.data() || {}).filter((g: any) => g.status === 'active' && Number(g.balanceCents) > 0 && !g.ownerRenterId);
  const giftLeft = gifts.reduce((t: number, g: any) => t + Number(g.balanceCents || 0), 0);
  const first = String(c.firstName || c.name || '').trim().split(/\s+/)[0];
  const e12 = ledger.filter((e: any) => (e.type === 'earn' || e.type === 'bonus') && Date.parse(e.at) >= Date.now() - 365 * 864e5).reduce((a: number, e: any) => a + Math.max(0, Number(e.points) || 0), 0); const tr = tierFor(S, e12, c.loyalty?.tier || null);
  return shell(<>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{tenant.logoUrl ? <img src={tenant.logoUrl} alt="" style={{ width: 34, height: 34, borderRadius: 10, objectFit: 'cover' }} /> : <span style={{ width: 34, height: 34, borderRadius: 10, background: accent, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{name.charAt(0)}</span>}<span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span></div>
    <div><div style={{ fontSize: 14, color: MUTED }}>{first ? `Hi ${first},` : 'Hello,'}</div><h1 style={{ margin: '2px 0 0', fontSize: 30, fontWeight: 300, letterSpacing: '-0.03em' }}>Your rewards</h1></div>
    <div style={{ borderRadius: 24, background: INK, color: '#fff', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`${bal} ${unit}${r.next ? ` of ${r.next.reward.points}` : ''}`}><circle cx="48" cy="48" r="40" fill="none" stroke="#2c2d31" strokeWidth="10" /><circle cx="48" cy="48" r="40" fill="none" stroke={MINT} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 48 48)" /></svg>
        <div><div style={{ fontSize: 40, fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1 }}>{bal}</div><div style={{ fontSize: 13.5, color: '#c9cace', marginTop: 4 }}>{unit}{worth > 0 ? ` · worth about ${money(worth)}` : ''}</div></div>
      </div>
      {tr.tier && <div style={{ fontSize: 13.5, color: '#c9cace' }}>{tr.tier.name}{tr.tier.perks.length ? ` · ${tr.tier.perks.join(', ')}` : ''}{tr.next ? ` · ${tr.next.toGo} more this year for ${tr.next.tier.name}` : ''}</div>}
      <div style={{ fontSize: 14 }}>{r.next ? `${r.next.toGo} more for ${r.next.reward.name.charAt(0).toLowerCase()}${r.next.reward.name.slice(1)}.` : r.ready.length ? 'You have a reward ready.' : 'Earning with every visit.'}</div>
    </div>
    {(r.ready.length > 0 || r.next) && <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><div style={{ fontSize: 15, fontWeight: 600 }}>{r.ready.length ? 'Ready to use' : 'Coming up'}</div>
      {r.ready.map((x) => <div key={x.id} style={{ border: `1px solid ${LINE}`, borderRadius: 18, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600 }}>{x.name}</div><div style={{ fontSize: 13, color: MUTED }}>{x.points} {unit} · tell us at your visit</div></div><span style={{ padding: '5px 10px', borderRadius: 999, background: '#e9f5ee', color: GREEN, fontSize: 12, fontWeight: 700 }}>Ready</span></div>)}
      {r.next && <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, color: MUTED }}><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{r.next.reward.name}</div><div style={{ fontSize: 13 }}>{r.next.reward.points} {unit}</div></div><span style={{ fontSize: 12.5 }}>{r.next.toGo} to go</span></div>}
    </div>}
    {giftLeft > 0 && <div style={{ borderRadius: 18, background: SOFT, padding: '14px 16px' }}><div style={{ fontSize: 13, color: MUTED }}>Gift card{gifts.length > 1 ? 's' : ''}</div><div style={{ fontSize: 17, fontWeight: 600 }}>{money(giftLeft)} left</div></div>}
    {ledger.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><div style={{ fontSize: 15, fontWeight: 600 }}>History</div>
      {ledger.slice(0, 12).map((e: any) => <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}><span>{day(e.at, tz)} · {String(e.why || '').replace(/^Adjusted by [^:]+: /, '').replace(/^\d+ for /, 'Spent ').slice(0, 60) || e.type}</span><span style={{ fontWeight: 600, color: e.points > 0 ? GREEN : INK }}>{e.points > 0 ? `+${e.points}` : `−${Math.abs(e.points)}`}</span></div>)}</div>}
    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: MUTED }}>{termsOf(S)}</div>
    <a href={`/book/${encodeURIComponent(tenantId)}?c=${encodeURIComponent(clientId)}&rk=${encodeURIComponent(String(sp.k))}`} style={{ height: 52, borderRadius: 999, background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>Book your next visit</a>
  </>);
}
