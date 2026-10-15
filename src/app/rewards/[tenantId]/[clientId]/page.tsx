// src/app/rewards/[tenantId]/[clientId]/page.tsx — A CLIENT'S REWARDS (design canvas "Loyalty engine", board 3). Their
// points and what they're worth, progress to the next reward, rewards ready to use, any gift card balance beside it,
// their history and the terms in plain words. Opened by the private link (?k=) on their receipt and client page — no
// app, no sign-in. Shows first names only.
import { getAdminDb } from '@/lib/firebase-admin';
import { rewardsKey } from '@/lib/loyalty-link';
import { loyaltyOf, rewardsFor, worthCents, termsOf, unitOf, tierFor, goalOf, perkWords, activeBoosts } from '@/lib/loyalty';
import { GoalPicker } from '@/components/loyalty/GoalPicker';
import { walletConfig } from '@/lib/wallet';
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
  const goal = goalOf(S, c.loyalty?.goalRewardId || null, bal);
  const svcNames = new Map<string, string>(); for (const id of S.tiers.flatMap((x) => (x.upgrade ? [x.upgrade.fromServiceId, x.upgrade.toServiceId] : []))) { const d: any = (await db.doc(`tenants/${tenantId}/services/${id}`).get()).data(); if (d?.name) svcNames.set(id, String(d.name)); }
  const { dayKey } = await import('@/lib/tenant-time'); const boosts = activeBoosts(S, dayKey(new Date(), tz));
  const e12 = ledger.filter((e: any) => (e.type === 'earn' || e.type === 'bonus') && Date.parse(e.at) >= Date.now() - 365 * 864e5).reduce((a: number, e: any) => a + Math.max(0, Number(e.points) || 0), 0); const tr = tierFor(S, e12, c.loyalty?.tier || null);
  return shell(<>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{tenant.logoUrl ? <img src={tenant.logoUrl} alt="" style={{ width: 34, height: 34, borderRadius: 10, objectFit: 'cover' }} /> : <span style={{ width: 34, height: 34, borderRadius: 10, background: accent, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{name.charAt(0)}</span>}<span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span></div>
    <div><div style={{ fontSize: 14, color: MUTED }}>{first ? `Hi ${first},` : 'Hello,'}</div><h1 style={{ margin: '2px 0 0', fontSize: 30, fontWeight: 300, letterSpacing: '-0.03em' }}>Your rewards</h1></div>
    <div style={{ borderRadius: 24, background: INK, color: '#fff', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`${bal} ${unit}${r.next ? ` of ${r.next.reward.points}` : ''}`}><circle cx="48" cy="48" r="40" fill="none" stroke="#2c2d31" strokeWidth="10" /><circle cx="48" cy="48" r="40" fill="none" stroke={MINT} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 48 48)" /></svg>
        <div><div style={{ fontSize: 40, fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1 }}>{bal}</div><div style={{ fontSize: 13.5, color: '#c9cace', marginTop: 4 }}>{unit}{worth > 0 ? ` · worth about ${money(worth)}` : ''}</div></div>
      </div>
      {goal && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, color: '#c9cace' }}>{goal.chosen ? 'Saving for' : 'Next up'}</div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>{goal.reward.name}</div>
        <div style={{ height: 10, borderRadius: 999, background: '#2c2d31', overflow: 'hidden' }}><div style={{ width: `${Math.max(3, goal.pct)}%`, height: '100%', background: MINT }} /></div>
        <div style={{ fontSize: 14 }}>{goal.toGo ? `${bal} of ${goal.reward.points} ${unit}. ${goal.toGo} to go.` : 'Ready. Just mention it at your visit.'}</div></div>}
      {!goal && <div style={{ fontSize: 14 }}>{r.ready.length ? 'You have a reward ready.' : 'Earning with every visit.'}</div>}
      {tr.tier && <div style={{ fontSize: 13.5, color: '#c9cace' }}>{tr.tier.name}{perkWords(tr.tier, (id) => svcNames.get(id) || null).length ? ` · ${perkWords(tr.tier, (id) => svcNames.get(id) || null).join(' · ')}` : ''}{tr.next ? ` · ${tr.next.toGo} more this year for ${tr.next.tier.name}` : ''}</div>}
    </div>
    <GoalPicker tenantId={tenantId} clientId={clientId} k={String(sp.k)} unit={unit} goalId={c.loyalty?.goalRewardId || null} rewards={S.rewards.filter((x) => x.on).sort((a2, b2) => a2.points - b2.points).map((x) => ({ id: x.id, name: x.name, points: x.points, ready: x.points <= bal }))} />
    {boosts.map((b2) => <div key={b2.id} style={{ borderRadius: 16, background: SOFT, padding: '12px 14px', fontSize: 13.5 }}>{b2.label}: {b2.multiplier === 2 ? 'double' : `${b2.multiplier}×`} points{b2.scope === 'products' ? ' on products' : b2.scope === 'services' ? ' on services' : ''} until {new Date(`${b2.to}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}.</div>)}
    {(() => { const w = walletConfig(); if (!w.apple && !w.google) return null; const q = `t=${encodeURIComponent(tenantId)}&c=${encodeURIComponent(clientId)}&k=${encodeURIComponent(String(sp.k))}`;
      const btn = { flex: 1, height: 48, borderRadius: 12, background: '#000', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13.5, fontWeight: 600, textDecoration: 'none' } as const;
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ display: 'flex', gap: 8 }}>{w.apple && <a href={`/api/wallet/apple/pass?${q}`} style={btn}>Add to Apple Wallet</a>}{w.google && <a href={`/api/wallet/google/save?${q}`} style={btn}>Add to Google Wallet</a>}</div>
        <div style={{ fontSize: 12.5, color: MUTED }}>Your card updates by itself after every visit.</div></div>; })()}
    {S.referralPoints > 0 && <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, padding: '12px 14px', fontSize: 13.5 }}>Bring a friend: when they come in for their first visit, you get {S.referralPoints} {unit}.</div>}
    {(r.ready.length > 0 || r.next) && <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><div style={{ fontSize: 15, fontWeight: 600 }}>{r.ready.length ? 'Ready to use' : 'Coming up'}</div>
      {r.ready.map((x) => <div key={x.id} style={{ border: `1px solid ${LINE}`, borderRadius: 18, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600 }}>{x.name}</div><div style={{ fontSize: 13, color: MUTED }}>{x.points} {unit} · tell us at your visit</div></div><span style={{ padding: '5px 10px', borderRadius: 999, background: '#e9f5ee', color: GREEN, fontSize: 12, fontWeight: 700 }}>Ready</span></div>)}
      {r.next && <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, color: MUTED }}><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{r.next.reward.name}</div><div style={{ fontSize: 13 }}>{r.next.reward.points} {unit}</div></div><span style={{ fontSize: 12.5 }}>{r.next.toGo} to go</span></div>}
    </div>}
    {giftLeft > 0 && <div style={{ borderRadius: 18, background: SOFT, padding: '14px 16px' }}><div style={{ fontSize: 13, color: MUTED }}>Gift card{gifts.length > 1 ? 's' : ''}</div><div style={{ fontSize: 17, fontWeight: 600 }}>{money(giftLeft)} left</div></div>}
    {ledger.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><div style={{ fontSize: 15, fontWeight: 600 }}>History</div>
      {ledger.filter((e: any) => Number(e.points) !== 0 || e.type === 'surprise').slice(0, 12).map((e: any) => <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}><span>{day(e.at, tz)} · {String(e.why || '').replace(/^Adjusted by [^:]+: /, '').replace(/^\d+ for /, 'Spent ').slice(0, 60) || e.type}</span><span style={{ fontWeight: 600, color: e.points > 0 || e.type === 'surprise' ? GREEN : INK }}>{e.type === 'surprise' ? 'Gift' : e.points > 0 ? `+${e.points}` : `−${Math.abs(e.points)}`}</span></div>)}</div>}
    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: MUTED }}>{termsOf(S)}</div>
    <a href={`/book/${encodeURIComponent(tenantId)}?c=${encodeURIComponent(clientId)}&rk=${encodeURIComponent(String(sp.k))}`} style={{ height: 52, borderRadius: 999, background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>Book your next visit</a>
  </>);
}
