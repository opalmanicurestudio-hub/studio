'use client';

/**
 * Post-Event Inventory Reconciliation Report
 * Route: /app/(app)/events/[eventId]/reconciliation/page.tsx
 * 
 * Shows: guests served, courses fired, supplies consumed vs expected,
 * revenue impact, and any discrepancies.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { format, parseISO } from 'date-fns';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Download, CheckCircle2, AlertTriangle, Package, Users,
  Utensils, TrendingDown, BarChart2, ArrowLeft, Loader,
  PackageCheck, PackageX, ChevronRight,
} from 'lucide-react';

const safeNum = (v: any) => Number(v) || 0;
const safeDate = (v: any) => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v === 'string') return parseISO(v);
  if (v?.toDate) return v.toDate();
  return new Date(v);
};

const StatCard = ({ label, value, sub, color = 'slate', icon }: any) => {
  const colors: Record<string, string> = {
    slate: 'bg-white border-slate-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    amber: 'bg-amber-50 border-amber-200',
    red: 'bg-red-50 border-red-200',
    blue: 'bg-blue-50 border-blue-200',
  };
  return (
    <div className={cn('p-5 rounded-2xl border-2', colors[color])}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
          <p className="text-3xl font-black tracking-tighter text-slate-900 leading-none">{value}</p>
          {sub && <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-wide">{sub}</p>}
        </div>
        {icon && <div className="opacity-30">{icon}</div>}
      </div>
    </div>
  );
};

export default function EventReconciliationPage() {
  const params = useParams();
  const router = useRouter();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { inventory } = useInventory();
  const tenantId = selectedTenant?.id ?? '';
  const eventId = params.eventId as string;

  const [event, setEvent]           = useState<any>(null);
  const [guests, setGuests]         = useState<any[]>([]);
  const [menuItems, setMenuItems]   = useState<any[]>([]);
  const [fires, setFires]           = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    if (!firestore || !tenantId || !eventId) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId),
      snap => { if (snap.exists()) setEvent({ id: snap.id, ...snap.data() }); setLoading(false); }
    ));
    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/eventGuests`), where('eventId', '==', eventId)),
      snap => setGuests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));
    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/eventMenuItems`), where('eventId', '==', eventId)),
      snap => setMenuItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));
    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/courseFires`), where('eventId', '==', eventId)),
      snap => setFires(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));
    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/stockCorrections`), where('eventId', '==', eventId)),
      snap => setCorrections(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));

    return () => unsubs.forEach(u => u());
  }, [firestore, tenantId, eventId]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const checkedIn = guests.filter(g => g.checkedIn).length;
    const totalRSVPs = guests.length;
    const attendanceRate = totalRSVPs > 0 ? Math.round((checkedIn / totalRSVPs) * 100) : 0;
    const coursesFired = fires.filter(f => f.status === 'fired').length;
    const totalInventoryDeducted = corrections.reduce((acc, c) => acc + Math.abs(safeNum(c.change)), 0);

    // Meal breakdown
    const mealBreakdown: Record<string, number> = {};
    guests.filter(g => g.checkedIn).forEach(g => {
      const name = menuItems.find(m => m.id === g.mealChoiceId)?.name || g.mealChoiceName || 'Unknown';
      mealBreakdown[name] = (mealBreakdown[name] || 0) + 1;
    });

    // Allergy summary
    const allergyCount = guests.filter(g => g.allergies?.length > 0).length;

    return { checkedIn, totalRSVPs, attendanceRate, coursesFired, totalInventoryDeducted, mealBreakdown, allergyCount };
  }, [guests, fires, corrections, menuItems]);

  // ── Inventory reconciliation ───────────────────────────────────────────────
  const inventoryReport = useMemo(() => {
    const report: {
      id: string; name: string; unit: string;
      expected: number; actual: number; variance: number;
      currentStock: number; status: 'match' | 'over' | 'under';
    }[] = [];

    // Calculate expected usage from RSVPs
    const expectedMap: Record<string, number> = {};
    guests.filter(g => g.checkedIn).forEach(guest => {
      const mealItem = menuItems.find(m => m.id === guest.mealChoiceId);
      const items = mealItem ? [mealItem] : [];
      if (guest.courseSelections) {
        Object.values(guest.courseSelections).forEach((mId: any) => {
          const item = menuItems.find(m => m.id === mId);
          if (item && !items.find(i => i.id === item.id)) items.push(item);
        });
      }
      items.forEach(item => {
        (item.supplies || []).forEach((s: any) => {
          expectedMap[s.inventoryId] = (expectedMap[s.inventoryId] || 0) + safeNum(s.qty);
        });
      });
    });

    // Compare against actual deductions from stockCorrections
    const actualMap: Record<string, number> = {};
    corrections.forEach(c => {
      actualMap[c.productId] = (actualMap[c.productId] || 0) + Math.abs(safeNum(c.change));
    });

    const allIds = new Set([...Object.keys(expectedMap), ...Object.keys(actualMap)]);
    allIds.forEach(id => {
      const inv = (inventory || []).find((i: any) => i.id === id);
      if (!inv) return;
      const expected = safeNum(expectedMap[id]);
      const actual = safeNum(actualMap[id]);
      const variance = actual - expected;
      report.push({
        id, name: (inv as any).name, unit: (inv as any).unit || 'units',
        expected, actual, variance,
        currentStock: safeNum((inv as any).totalStock),
        status: Math.abs(variance) < 0.01 ? 'match' : variance > 0 ? 'over' : 'under',
      });
    });

    return report.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  }, [guests, menuItems, corrections, inventory]);

  // ── Export PDF-style report ────────────────────────────────────────────────
  const handleExport = () => {
    const rows = [
      ['POST-EVENT RECONCILIATION REPORT'],
      [`Event: ${event?.name}`],
      [`Date: ${event?.date ? format(new Date(event.date), 'MMMM d, yyyy') : 'N/A'}`],
      [''],
      ['ATTENDANCE'],
      ['Total RSVPs', stats.totalRSVPs],
      ['Checked In', stats.checkedIn],
      ['Attendance Rate', `${stats.attendanceRate}%`],
      [''],
      ['MEAL BREAKDOWN'],
      ...Object.entries(stats.mealBreakdown).map(([meal, count]) => [meal, count]),
      [''],
      ['INVENTORY RECONCILIATION'],
      ['Item', 'Expected', 'Actual', 'Variance', 'Unit', 'Status'],
      ...inventoryReport.map(r => [r.name, r.expected, r.actual, r.variance, r.unit, r.status]),
    ];
    const csv = rows.map(r => Array.isArray(r) ? r.map(cell => `"${cell}"`).join(',') : `"${r}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${event?.name || 'event'}-reconciliation.csv`;
    a.click();
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <Loader className="animate-spin w-8 h-8 text-slate-400" />
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <AppHeader title={`${event?.title || event?.name || 'Event'} — Reconciliation`} />
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 pb-24">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <button onClick={() => router.push(`/events/${eventId}/manifest`)}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors mb-3">
              <ArrowLeft className="w-3 h-3" /> Back to Manifest
            </button>
            <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
              Post-Event Report
            </h1>
            {event?.date && (
              <p className="text-sm text-slate-500 mt-1">{format(new Date(event.date), 'EEEE, MMMM d, yyyy')}</p>
            )}
          </div>
          <Button onClick={handleExport} variant="outline"
            className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2 shrink-0">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total RSVPs" value={stats.totalRSVPs} sub="Pre-registered" icon={<Users className="w-8 h-8" />} />
          <StatCard label="Attended" value={stats.checkedIn} sub={`${stats.attendanceRate}% attendance`}
            color={stats.attendanceRate >= 80 ? 'emerald' : stats.attendanceRate >= 50 ? 'amber' : 'red'}
            icon={<CheckCircle2 className="w-8 h-8" />} />
          <StatCard label="Courses Fired" value={stats.coursesFired} sub="Sent to kitchen"
            color="blue" icon={<Utensils className="w-8 h-8" />} />
          <StatCard label="No-Shows" value={stats.totalRSVPs - stats.checkedIn}
            sub={`${100 - stats.attendanceRate}% of RSVPs`}
            color={stats.totalRSVPs - stats.checkedIn > 0 ? 'amber' : 'slate'}
            icon={<TrendingDown className="w-8 h-8" />} />
        </div>

        {/* Meal breakdown */}
        {Object.keys(stats.mealBreakdown).length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
                <Utensils className="w-4 h-4 text-primary" /> Meal Summary
              </h2>
            </div>
            <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(stats.mealBreakdown).map(([meal, count]) => (
                <div key={meal} className="p-4 rounded-2xl border-2 border-slate-100 bg-slate-50">
                  <p className="text-2xl font-black text-slate-900">{count}</p>
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 mt-0.5">{meal}</p>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                    {Math.round((count / Math.max(stats.checkedIn, 1)) * 100)}% of guests
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inventory reconciliation */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" /> Inventory Reconciliation
            </h2>
            <div className="flex items-center gap-2">
              {inventoryReport.filter(r => r.status !== 'match').length === 0 ? (
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black text-[9px]">✓ All Matched</Badge>
              ) : (
                <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-black text-[9px]">
                  {inventoryReport.filter(r => r.status !== 'match').length} Discrepancies
                </Badge>
              )}
            </div>
          </div>
          {inventoryReport.length === 0 ? (
            <div className="p-8 text-center">
              <Package className="w-8 h-8 text-slate-200 mx-auto mb-3" />
              <p className="font-black uppercase text-[10px] tracking-widest text-slate-400">
                No inventory data — link supplies to menu items to see reconciliation
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Item</th>
                    <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Expected</th>
                    <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Actual Used</th>
                    <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Variance</th>
                    <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Remaining Stock</th>
                    <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {inventoryReport.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-black text-sm text-slate-900">{item.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-700">{item.expected} {item.unit}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-700">{item.actual} {item.unit}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className={cn('font-black text-sm',
                          item.status === 'match' ? 'text-emerald-600' :
                          item.status === 'over' ? 'text-amber-600' : 'text-red-600'
                        )}>
                          {item.variance > 0 ? '+' : ''}{item.variance.toFixed(2)} {item.unit}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-700">{item.currentStock} {item.unit}</p>
                      </td>
                      <td className="px-4 py-3">
                        {item.status === 'match' && (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black text-[9px] flex items-center gap-1 w-fit">
                            <PackageCheck className="w-3 h-3" /> Matched
                          </Badge>
                        )}
                        {item.status === 'over' && (
                          <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-black text-[9px] flex items-center gap-1 w-fit">
                            <AlertTriangle className="w-3 h-3" /> Over Used
                          </Badge>
                        )}
                        {item.status === 'under' && (
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-black text-[9px] flex items-center gap-1 w-fit">
                            <PackageX className="w-3 h-3" /> Under Used
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Course fire log */}
        {fires.length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-primary" /> Course Fire Log
              </h2>
            </div>
            <div className="divide-y divide-slate-50">
              {fires.sort((a, b) => a.courseNumber - b.courseNumber).map(fire => (
                <div key={fire.id} className="px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-black text-sm text-slate-900">Course {fire.courseNumber} — {fire.courseName}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                      Fired at {fire.firedAt ? format(safeDate(fire.firedAt), 'h:mm a') : '—'} · {fire.guestCount} tickets
                    </p>
                  </div>
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black text-[9px]">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Fired
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Allergy summary */}
        {stats.allergyCount > 0 && (
          <div className="bg-amber-50 rounded-2xl border-2 border-amber-200 p-5">
            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-amber-800 flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4" /> Allergy Notes
            </h2>
            <div className="space-y-2">
              {guests.filter(g => g.allergies?.length > 0).map(guest => (
                <div key={guest.id} className="flex items-start gap-3">
                  <p className="font-black text-sm text-amber-900 w-32 shrink-0">{guest.name}</p>
                  <p className="text-sm text-amber-700">{(guest.allergies || []).join(', ')}</p>
                  {guest.allergyNote && <p className="text-xs text-amber-600 italic">"{guest.allergyNote}"</p>}
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}