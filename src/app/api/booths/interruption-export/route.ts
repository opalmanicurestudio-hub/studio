// src/app/api/booths/interruption-export/route.ts — THE CLAIM SPREADSHEET.
// Every appointment an interruption (or a provider callout) affected, and what
// happened to it — value, deposit, outcome, new time, refund/credit, and when
// the client was told, reminded and invited back — plus the totals and the
// linked maintenance tickets. Same access as the packet: a capability URL
// (the record's id). Opens in Excel / Google Sheets; the packet prints to PDF.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { disruptionTotals } from '@/lib/disruptions';

export const dynamic = 'force-dynamic';
const cell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const usd = (c: any) => (Number(c) ? (Number(c) / 100).toFixed(2) : '');
const OUT: Record<string, string> = { pending: 'Waiting for their choice', rescheduled: 'Rescheduled', reassigned: 'Another provider', kept: 'Kept', moved_room: 'Moved room', cancelled: 'Cancelled' };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || '').trim(), id = String(sp.get('id') || '').trim();
  const kind = sp.get('kind') === 'callout' ? 'callout' : 'interruption';
  if (!tenantId || !id) return new NextResponse('Missing tenantId or id', { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const snap = await db.doc(`${T}/${kind === 'callout' ? 'providerCallouts' : 'interruptions'}/${id}`).get();
  if (!snap.exists) return new NextResponse('Not found', { status: 404 });
  const rec: any = snap.data();
  const renters = new Map<string, string>();
  for (const d of (await db.collection(`${T}/renters`).get()).docs) renters.set(d.id, String((d.data() as any)?.name || ''));
  const rows: string[][] = [];
  rows.push([kind === 'callout' ? `Provider callout — ${rec.staffName || ''}` : `Business interruption — ${rec.title || ''}`]);
  rows.push([kind === 'callout' ? `From ${String(rec.from || '').slice(0, 16).replace('T', ' ')} to ${String(rec.to || '').slice(0, 16).replace('T', ' ')} · scheduled hours lost ${rec.hoursLost ?? ''}` : `From ${rec.startDate || ''} to ${rec.endDate || 'ongoing'} · type ${rec.type || ''}`]);
  rows.push([]);
  rows.push(['When', 'Client', 'Service', 'Book', 'Renter', 'Booked value ($)', 'Deposit held ($)', 'Outcome', 'New time', 'Refund ($)', 'Credit ($)', 'Client told', 'Reminded', 'Invited back']);
  const affected: any[] = Object.values(rec.affected || {}).sort((a: any, b: any) => String(a.startTime).localeCompare(String(b.startTime)));
  for (const x of affected) rows.push([String(x.startTime || '').slice(0, 16).replace('T', ' '), x.clientName || '', x.serviceName || '', x.isRenterBooking ? 'Renter' : 'Studio', x.renterId ? renters.get(x.renterId) || x.renterId : '',
    usd(x.valueCents), usd(x.depositCents), OUT[x.outcome] || x.outcome || '', x.newStartTime ? String(x.newStartTime).slice(0, 16).replace('T', ' ') : '', usd(x.refundCents), usd(x.creditCents),
    x.notifiedAt ? String(x.notifiedAt).slice(0, 16).replace('T', ' ') : '', x.chasedAt ? String(x.chasedAt).slice(0, 16).replace('T', ' ') : '', x.reopenNotifiedAt ? String(x.reopenNotifiedAt).slice(0, 16).replace('T', ' ') : '']);
  const t = disruptionTotals(affected);
  rows.push([]);
  rows.push(['Totals', `${t.appointments} appointments (${t.studio} studio, ${t.renter} renter)`, '', '', '', usd(t.bookedCents), usd(t.depositsCents), `${t.rescheduled} rescheduled · ${t.reassigned} another provider · ${t.cancelled} cancelled · ${t.kept} kept · ${t.pending} waiting`, '', usd(t.refundsCents), usd(t.creditsCents)]);
  rows.push(['Booked value lost (cancelled)', usd(t.lostCents)]);
  // Per-renter recorded bookings — for renter reimbursements, beside their own loss logs.
  const byRenter = new Map<string, { n: number; cents: number }>();
  for (const x of affected) if (x.isRenterBooking && x.renterId) { const r = byRenter.get(x.renterId) || { n: 0, cents: 0 }; r.n++; r.cents += Number(x.valueCents) || 0; byRenter.set(x.renterId, r); }
  if (byRenter.size) { rows.push([]); rows.push(['Renter', 'Bookings affected (recorded)', 'Booked value ($)']); for (const [rid, r] of Array.from(byRenter.entries())) rows.push([renters.get(rid) || rid, String(r.n), usd(r.cents)]); }
  if (Array.isArray(rec.ticketIds) && rec.ticketIds.length) {
    rows.push([]); rows.push(['Maintenance ticket', 'Category', 'Status', 'Opened']);
    for (const tid of rec.ticketIds.slice(0, 20)) { const d = await db.doc(`${T}/tickets/${tid}`).get().catch(() => null); const tk: any = d && d.exists ? d.data() : null; if (tk) rows.push([tk.title || 'Ticket', tk.category || '', tk.status || '', String(tk.createdAt || '').slice(0, 10)]); }
  }
  const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const name = `${kind === 'callout' ? 'callout' : 'interruption'}-${String(rec.title || rec.staffName || id).replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}.csv`;
  return new NextResponse('\ufeff' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
}
