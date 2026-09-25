// src/lib/hq-metrics.ts
//
// THE NUMBERS THAT RUN CLARITYFLOW — measured once a day (HQ job), stored so
// every figure has a trend.
//
//   platformTenantMetrics/{tenantId}  latest numbers for one business + a
//                                     short daily history
//   platformMetrics/{YYYY-MM-DD}      platform totals + niche benchmarks
//
// Revenue here = the booked value of COMPLETED visits (what the business
// earned through ClarityFlow). Costs are estimates from adjustable rates:
//   SMS_COST_CENTS (per text segment, default 1.3), EMAIL_COST_CENTS
//   (per email, default 0.1), INFRA_MONTHLY_USD (hosting + database, spread
//   across active businesses, default 45), and real AI usage.
// Niche benchmarks appear only when a niche has 3+ businesses — no single
// business can ever be picked out.

import { getAdminDb } from '@/lib/firebase-admin';

const DAY = 86400000;
const median = (a: number[]) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

export interface TenantMetrics {
  tenantId: string; name: string; businessType: string; ageDays: number; active: boolean;
  revenue30: number; revenuePrev30: number; revenueChangePct: number | null;
  bookings30: number; bookingsPrev30: number; avgTicket: number | null;
  noShowRate: number | null; rebookRate: number | null; onlineShare: number | null; depositShare: number | null;
  sinceJoining: { firstMonthRevenue: number; latestMonthRevenue: number; revenueChangePct: number | null; firstMonthBookings: number; latestMonthBookings: number; bookingsChangePct: number | null; firstNoShow: number | null; latestNoShow: number | null } | null;
  messages30: { emails: number; textSegments: number };
  cost30: { texts: number; emails: number; ai: number; infra: number; total: number };
  computedAt: string;
}

export async function computeMetrics(): Promise<{ platform: any; tenants: TenantMetrics[] }> {
  const db = getAdminDb();
  const now = Date.now();
  const iso = (d: number) => new Date(now - d * DAY).toISOString();
  const smsC = Number(process.env.SMS_COST_CENTS) || 1.3;
  const emailC = Number(process.env.EMAIL_COST_CENTS) || 0.1;
  const infraMonthly = Number(process.env.INFRA_MONTHLY_USD) || 45;

  const tSnap = await db.collection('tenants').limit(500).get();
  const tenants = tSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((t: any) => t.subscriptionStatus !== 'cancelled');

  // AI spend per business, last 30 days.
  const aiByTenant: Record<string, number> = {}; let aiPlatform = 0;
  try { for (const d of (await db.collection('platformAiUsage').where('at', '>=', iso(30)).limit(5000).get()).docs) { const v = d.data() as any; aiPlatform += Number(v.costUsd) || 0; if (v.tenantId) aiByTenant[v.tenantId] = (aiByTenant[v.tenantId] || 0) + (Number(v.costUsd) || 0); } } catch { /* none yet */ }

  const rows: TenantMetrics[] = [];
  for (const t of tenants) {
    const created = t.createdAt ? new Date(t.createdAt).getTime() : now;
    const ageDays = Math.floor((now - created) / DAY);
    let appts: any[] = [];
    try { appts = (await db.collection(`tenants/${t.id}/appointments`).where('startTime', '>=', new Date(Math.min(now - 120 * DAY, created)).toISOString()).select('status', 'price', 'startTime', 'clientId', 'source', 'depositStatus', 'depositAmountCents', 'createdAt').limit(8000).get()).docs.map((d: any) => d.data()); } catch { /* none */ }
    const inRange = (a: any, from: number, to: number) => { const x = new Date(a.startTime).getTime(); return x >= from && x < to; };
    const done = (a: any) => a.status === 'completed';
    const noShow = (a: any) => a.status === 'no_show';
    const window = (from: number, to: number) => {
      const w = appts.filter((a) => inRange(a, from, to) && a.status !== 'requested');
      const comp = w.filter(done);
      const revenue = comp.reduce((n, a) => n + (Number(a.price) || 0), 0);
      const attended = comp.length + w.filter(noShow).length;
      return { revenue, bookings: w.length, completed: comp.length, noShowRate: attended ? w.filter(noShow).length / attended : null, list: w };
    };
    const cur = window(now - 30 * DAY, now), prev = window(now - 60 * DAY, now - 30 * DAY);
    const d90 = window(now - 90 * DAY, now);
    const visitsByClient: Record<string, number> = {};
    for (const a of d90.list) if (done(a) && a.clientId) visitsByClient[a.clientId] = (visitsByClient[a.clientId] || 0) + 1;
    const clientsSeen = Object.keys(visitsByClient).length;
    const online = cur.list.filter((a) => /booking-page|public|online/i.test(String(a.source || ''))).length;
    const withDeposit = cur.list.filter((a) => a.depositStatus === 'paid' || Number(a.depositAmountCents) > 0).length;

    let sinceJoining: TenantMetrics['sinceJoining'] = null;
    if (ageDays >= 45) {
      const first = window(created, created + 30 * DAY);
      sinceJoining = { firstMonthRevenue: first.revenue, latestMonthRevenue: cur.revenue, revenueChangePct: pct(cur.revenue, first.revenue),
        firstMonthBookings: first.bookings, latestMonthBookings: cur.bookings, bookingsChangePct: pct(cur.bookings, first.bookings),
        firstNoShow: first.noShowRate, latestNoShow: cur.noShowRate };
    }

    let emails = 0, textSegments = 0;
    try { for (const d of (await db.collection(`tenants/${t.id}/messageLog`).where('sentAt', '>=', iso(30)).select('channel', 'status', 'segments').limit(10000).get()).docs) { const v = d.data() as any; if (v.status !== 'sent') continue; if (v.channel === 'sms') textSegments += Number(v.segments) || 1; else emails++; } } catch { /* none */ }

    rows.push({
      tenantId: t.id, name: t.name || 'Untitled', businessType: t.businessType || t.category || 'other', ageDays,
      active: cur.bookings > 0,
      revenue30: cur.revenue, revenuePrev30: prev.revenue, revenueChangePct: pct(cur.revenue, prev.revenue),
      bookings30: cur.bookings, bookingsPrev30: prev.bookings, avgTicket: cur.completed ? Math.round((cur.revenue / cur.completed) * 100) / 100 : null,
      noShowRate: cur.noShowRate, rebookRate: clientsSeen ? Object.values(visitsByClient).filter((n) => n >= 2).length / clientsSeen : null,
      onlineShare: cur.bookings ? online / cur.bookings : null, depositShare: cur.bookings ? withDeposit / cur.bookings : null,
      sinceJoining, messages30: { emails, textSegments },
      cost30: { texts: (textSegments * smsC) / 100, emails: (emails * emailC) / 100, ai: aiByTenant[t.id] || 0, infra: 0, total: 0 },
      computedAt: new Date().toISOString(),
    });
  }
  const activeCount = Math.max(1, rows.filter((r) => r.active).length);
  for (const r of rows) { r.cost30.infra = r.active ? infraMonthly / activeCount : 0; r.cost30.total = Math.round((r.cost30.texts + r.cost30.emails + r.cost30.ai + r.cost30.infra) * 100) / 100; }

  // Support speed, last 30 days.
  let ticketsOpened = 0; const firstResponseHrs: number[] = []; let solved = 0;
  try { for (const d of (await db.collection('platformTickets').where('createdAt', '>=', iso(30)).limit(2000).get()).docs) { const k = d.data() as any; ticketsOpened++; if (k.status === 'solved') solved++; if (k.firstRespondedAt) firstResponseHrs.push((new Date(k.firstRespondedAt).getTime() - new Date(k.createdAt).getTime()) / 3600000); } } catch { /* none */ }

  // Industry benchmarks by niche (3+ businesses only).
  const byNiche: Record<string, TenantMetrics[]> = {};
  for (const r of rows.filter((x) => x.active)) (byNiche[r.businessType] = byNiche[r.businessType] || []).push(r);
  const benchmarks = Object.entries(byNiche).filter(([, v]) => v.length >= 3).map(([niche, v]) => {
    const withDep = v.filter((x) => (x.depositShare || 0) >= 0.5), without = v.filter((x) => (x.depositShare || 0) < 0.5);
    return { niche, businesses: v.length, avgTicket: median(v.map((x) => x.avgTicket || NaN)), noShowRate: median(v.map((x) => x.noShowRate ?? NaN)),
      bookingsPerWeek: median(v.map((x) => (x.bookings30 / 30) * 7)), rebookRate: median(v.map((x) => x.rebookRate ?? NaN)), onlineShare: median(v.map((x) => x.onlineShare ?? NaN)),
      noShowWithDeposits: median(withDep.map((x) => x.noShowRate ?? NaN)), noShowWithoutDeposits: median(without.map((x) => x.noShowRate ?? NaN)) };
  });

  const sum = (f: (r: TenantMetrics) => number) => Math.round(rows.reduce((n, r) => n + f(r), 0) * 100) / 100;
  const platform = {
    date: new Date().toISOString().slice(0, 10), computedAt: new Date().toISOString(),
    businesses: rows.length, activeBusinesses: rows.filter((r) => r.active).length,
    bookings30: sum((r) => r.bookings30), revenue30: sum((r) => r.revenue30), revenuePrev30: sum((r) => r.revenuePrev30),
    cost30: { texts: sum((r) => r.cost30.texts), emails: sum((r) => r.cost30.emails), ai: Math.round(aiPlatform * 100) / 100, infra: infraMonthly, total: 0 },
    costPerActiveBusiness: 0,
    growingBusinesses: rows.filter((r) => (r.revenueChangePct || 0) > 0).length,
    sinceJoiningMedianRevenueChange: median(rows.filter((r) => r.sinceJoining?.revenueChangePct != null).map((r) => r.sinceJoining!.revenueChangePct!)),
    support: { opened30: ticketsOpened, solved30: solved, medianFirstResponseHours: median(firstResponseHrs) },
    benchmarks,
  };
  platform.cost30.total = Math.round((platform.cost30.texts + platform.cost30.emails + platform.cost30.ai + platform.cost30.infra) * 100) / 100;
  platform.costPerActiveBusiness = Math.round((platform.cost30.total / activeCount) * 100) / 100;

  // Store: today's platform snapshot, and each business's latest + short history.
  await db.doc(`platformMetrics/${platform.date}`).set(platform);
  for (const r of rows) {
    const ref = db.doc(`platformTenantMetrics/${r.tenantId}`);
    const hist = (((await ref.get()).data() as any)?.history || []).filter((h: any) => h.date !== platform.date).slice(-89);
    await ref.set({ ...r, history: [...hist, { date: platform.date, revenue30: r.revenue30, bookings30: r.bookings30, noShowRate: r.noShowRate, cost: r.cost30.total }] });
  }
  return { platform, tenants: rows };
}
