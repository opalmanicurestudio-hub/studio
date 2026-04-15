'use client';

import React, { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where, writeBatch } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/context/TenantContext';
import {
  Users, AlertTriangle, Leaf, Download, Play, CheckCircle2,
  Loader, Search, Plus, Utensils,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const safeDate = (v: any) => v?.toDate?.() ?? (typeof v === 'string' ? parseISO(v) : new Date(v));

const AllergyPill = ({ label, type = 'allergy' }: { label: string; type?: 'allergy' | 'dietary' }) => (
  <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border',
    type === 'allergy'
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-emerald-50 border-emerald-200 text-emerald-700'
  )}>
    {type === 'allergy' ? <AlertTriangle className="w-2 h-2" /> : <Leaf className="w-2 h-2" />}
    {label}
  </span>
);

const StatCard = ({ label, value, sub, color = 'slate' }: { label: string; value: string | number; sub?: string; color?: string }) => {
  const colorMap: Record<string, string> = {
    slate: 'bg-white border-slate-200', amber: 'bg-amber-50 border-amber-200',
    emerald: 'bg-emerald-50 border-emerald-200', blue: 'bg-blue-50 border-blue-200',
  };
  return (
    <div className={cn('p-5 rounded-2xl border-2', colorMap[color] || colorMap.slate)}>
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className="text-3xl font-black tracking-tighter text-slate-900 leading-none">{value}</p>
      {sub && <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-wide">{sub}</p>}
    </div>
  );
};

export default function EventManifestPage() {
  const params = useParams();
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? '';
  const eventId = params.eventId as string;

  const eventRef  = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/events/${eventId}`), [firestore, tenantId, eventId]);
  const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const guestsQ   = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/eventGuests`), where('eventId', '==', eventId)), [firestore, tenantId, eventId]);
  const menuQ     = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/eventMenuItems`), where('eventId', '==', eventId)), [firestore, tenantId, eventId]);
  const firesQ    = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/courseFires`), where('eventId', '==', eventId)), [firestore, tenantId, eventId]);

  const { data: event }     = useDoc<any>(eventRef);
  const { data: tenant }    = useDoc<any>(tenantRef);
  const { data: guests }    = useCollection<any>(guestsQ);
  const { data: menuItems } = useCollection<any>(menuQ);
  const { data: fires }     = useCollection<any>(firesQ);

  const [search, setSearch]               = useState('');
  const [filterMeal, setFilterMeal]       = useState('all');
  const [filterFlag, setFilterFlag]       = useState('all');
  const [isFiring, setIsFiring]           = useState<number | null>(null);
  const [isAddingMenu, setIsAddingMenu]   = useState(false);
  const [newMenuName, setNewMenuName]     = useState('');
  const [newMenuDesc, setNewMenuDesc]     = useState('');
  const [newMenuCourse, setNewMenuCourse] = useState(1);
  const [newMenuCategory, setNewMenuCategory] = useState('main');
  const [newMenuVegan, setNewMenuVegan]   = useState(false);
  const [newMenuGF, setNewMenuGF]         = useState(false);

  const stats = useMemo(() => {
    const g = guests || [];
    const mealCounts: Record<string, number> = {};
    g.forEach((guest: any) => {
      const name = guest.mealChoiceName || 'No selection';
      mealCounts[name] = (mealCounts[name] || 0) + 1;
    });
    const allergyFlags = g.flatMap((g: any) => g.allergies || []);
    const allAllergyCount = allergyFlags.length;
    const uniqueAllergies = Array.from(new Set(allergyFlags)) as string[];
    const checkedIn = g.filter((x: any) => x.checkedIn).length;
    return { total: g.length, checkedIn, mealCounts, allAllergyCount, uniqueAllergies };
  }, [guests]);

  const filtered = useMemo(() => {
    return (guests || []).filter((g: any) => {
      if (search && !g.name?.toLowerCase().includes(search.toLowerCase()) && !g.seatNumber?.includes(search) && !g.tableNumber?.includes(search)) return false;
      if (filterMeal !== 'all' && g.mealChoiceId !== filterMeal) return false;
      if (filterFlag === 'allergies' && (!g.allergies || g.allergies.length === 0)) return false;
      if (filterFlag === 'dietary' && (!g.dietaryRestrictions || g.dietaryRestrictions.length === 0)) return false;
      return true;
    }).sort((a: any, b: any) => {
      if (a.tableNumber && b.tableNumber) return a.tableNumber.localeCompare(b.tableNumber);
      return (a.submittedAt || '').localeCompare(b.submittedAt || '');
    });
  }, [guests, search, filterMeal, filterFlag]);

  const courseNumbers = useMemo(() => {
    return Array.from(new Set((menuItems || []).map((m: any) => m.courseNumber))).sort() as number[];
  }, [menuItems]);

  const handleFireCourse = async (courseNumber: number) => {
    if (!firestore || !tenantId) return;
    setIsFiring(courseNumber);
    try {
      const batch = writeBatch(firestore);
      const fireId = nanoid();
      const now = new Date().toISOString();
      const guestsForCourse = (guests || []).filter((g: any) => g.courseSelections?.[courseNumber]);

      batch.set(doc(firestore, `tenants/${tenantId}/courseFires`, fireId), {
        id: fireId, eventId, tenantId,
        courseNumber,
        courseName: `Course ${courseNumber}`,
        firedAt: now,
        firedBy: 'host',
        guestCount: guestsForCourse.length,
        status: 'fired',
      });

      guestsForCourse.forEach((guest: any) => {
        const menuItemId = guest.courseSelections![courseNumber];
        const menuItem = (menuItems || []).find((m: any) => m.id === menuItemId);
        const kdsTicketId = nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/kdsTickets`, kdsTicketId), {
          id: kdsTicketId,
          source: 'event',
          eventId,
          eventTitle: event?.title || '',
          courseFireId: fireId,
          courseNumber,
          guestId: guest.id,
          guestName: guest.name,
          seatNumber: guest.seatNumber || null,
          tableNumber: guest.tableNumber || null,
          menuItemId,
          menuItemName: menuItem?.name || 'Item',
          allergies: guest.allergies || [],
          dietaryRestrictions: guest.dietaryRestrictions || [],
          notes: guest.notes || null,
          status: 'pending',
          createdAt: now,
          tenantId,
        });
      });

      await batch.commit();
      toast({ title: `Course ${courseNumber} Fired`, description: `${guestsForCourse.length} tickets sent to kitchen.` });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Fire Failed' });
    } finally {
      setIsFiring(null);
    }
  };

  const handleAddMenuItem = async () => {
    if (!newMenuName.trim() || !firestore || !tenantId) return;
    const id = nanoid();
    const batch = writeBatch(firestore);
    batch.set(doc(firestore, `tenants/${tenantId}/eventMenuItems`, id), {
      id, eventId, tenantId,
      name: newMenuName.trim(),
      description: newMenuDesc.trim() || null,
      category: newMenuCategory,
      courseNumber: newMenuCourse,
      isVegan: newMenuVegan,
      isGlutenFree: newMenuGF,
    });
    await batch.commit();
    setNewMenuName(''); setNewMenuDesc(''); setIsAddingMenu(false);
    toast({ title: 'Menu item added' });
  };

  const handleExportCSV = () => {
    const rows = [
      ['Name', 'Table', 'Seat', 'Meal Choice', 'Allergies', 'Dietary', 'Notes', 'Checked In'],
      ...(guests || []).map((g: any) => [
        g.name, g.tableNumber || '', g.seatNumber || '',
        g.mealChoiceName || '',
        (g.allergies || []).join('; '),
        (g.dietaryRestrictions || []).join('; '),
        g.notes || '',
        g.checkedIn ? 'Yes' : 'No',
      ])
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${event?.title || 'event'}-manifest.csv`; a.click();
  };

  if (!event) return (
    <div className="flex h-screen items-center justify-center">
      <Loader className="animate-spin w-8 h-8 text-slate-400" />
    </div>
  );

  const courseLabels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
  const firedCourses = new Set((fires || []).filter((f: any) => f.status === 'fired').map((f: any) => f.courseNumber));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <AppHeader title={`${event.title} — Manifest`} />
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 pb-24">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">{event.title}</h1>
            {event.startTime && (
              <p className="text-sm text-slate-500 mt-1">
                {format(safeDate(event.startTime), "EEEE, MMMM d 'at' h:mm a")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={handleExportCSV}
              className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
              <Download className="w-4 h-4" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => setIsAddingMenu(true)}
              className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
              <Plus className="w-4 h-4" /> Add Menu Item
            </Button>
          </div>
        </div>

        {/* STATS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Responses" value={stats.total} sub={`${stats.checkedIn} checked in`} />
          <StatCard label="Allergy Flags" value={stats.allAllergyCount} sub={stats.uniqueAllergies.slice(0, 2).join(', ')} color="amber" />
          {Object.entries(stats.mealCounts).slice(0, 2).map(([meal, count]) => (
            <StatCard key={meal} label={meal} value={count}
              sub={`${Math.round((count as number) / Math.max(stats.total, 1) * 100)}%`} color="emerald" />
          ))}
        </div>

        {/* COURSE FIRING */}
        {courseNumbers.length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
                <Utensils className="w-4 h-4 text-primary" /> Course Firing
              </h2>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-0.5">
                Send courses to kitchen KDS simultaneously
              </p>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {courseNumbers.map(n => {
                const fired = firedCourses.has(n);
                const count = (guests || []).filter((g: any) => g.courseSelections?.[n]).length;
                return (
                  <div key={n} className={cn('p-4 rounded-2xl border-2', fired ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Course {n}</p>
                        <p className="font-black text-slate-900 text-sm">{courseLabels[n] || `Course ${n}`}</p>
                        <p className="text-[10px] text-slate-500">{count} guests</p>
                      </div>
                      {fired && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
                    </div>
                    <Button
                      onClick={() => handleFireCourse(n)}
                      disabled={!!isFiring || fired || count === 0}
                      className={cn('w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2',
                        fired ? 'bg-emerald-500 hover:bg-emerald-500 opacity-60 cursor-not-allowed' : 'shadow-lg shadow-primary/20'
                      )}>
                      {isFiring === n
                        ? <Loader className="w-4 h-4 animate-spin" />
                        : fired
                          ? <><CheckCircle2 className="w-4 h-4" /> Fired</>
                          : <><Play className="w-4 h-4" /> Fire Course</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ADD MENU ITEM FORM */}
        <AnimatePresence>
          {isAddingMenu && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="bg-white rounded-2xl border-2 border-primary/20 overflow-hidden">
              <div className="p-6 space-y-4">
                <h3 className="font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-primary" /> Add Menu Item
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Item Name *</label>
                    <Input value={newMenuName} onChange={e => setNewMenuName(e.target.value)}
                      placeholder="e.g. Pan-Seared Salmon" className="h-12 rounded-xl border-2" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Description</label>
                    <Input value={newMenuDesc} onChange={e => setNewMenuDesc(e.target.value)}
                      placeholder="With lemon butter and asparagus" className="h-12 rounded-xl border-2" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Course #</label>
                    <Select value={String(newMenuCourse)} onValueChange={v => setNewMenuCourse(Number(v))}>
                      <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Course 1 — Starter</SelectItem>
                        <SelectItem value="2">Course 2 — Main</SelectItem>
                        <SelectItem value="3">Course 3 — Dessert</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Category</label>
                    <Select value={newMenuCategory} onValueChange={setNewMenuCategory}>
                      <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="main">Main</SelectItem>
                        <SelectItem value="dessert">Dessert</SelectItem>
                        <SelectItem value="beverage">Beverage</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={newMenuVegan} onChange={e => setNewMenuVegan(e.target.checked)} className="rounded" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Vegan</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={newMenuGF} onChange={e => setNewMenuGF(e.target.checked)} className="rounded" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Gluten-Free</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button onClick={() => setIsAddingMenu(false)} variant="ghost"
                    className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest">Cancel</Button>
                  <Button onClick={handleAddMenuItem} disabled={!newMenuName.trim()}
                    className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                    Add Item
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* GUEST MANIFEST TABLE */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Guest Manifest
              <Badge className="ml-1 bg-slate-100 text-slate-600 border-none font-black">{filtered.length}</Badge>
            </h2>
            <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search guests…"
                  className="pl-8 h-9 w-48 rounded-xl border-2 text-xs font-bold" />
              </div>
              <Select value={filterMeal} onValueChange={setFilterMeal}>
                <SelectTrigger className="h-9 w-36 rounded-xl border-2 font-bold uppercase text-[10px]">
                  <SelectValue placeholder="All meals" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Meals</SelectItem>
                  {(menuItems || []).map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterFlag} onValueChange={setFilterFlag}>
                <SelectTrigger className="h-9 w-36 rounded-xl border-2 font-bold uppercase text-[10px]">
                  <SelectValue placeholder="All flags" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guests</SelectItem>
                  <SelectItem value="allergies">Has Allergy</SelectItem>
                  <SelectItem value="dietary">Dietary Req.</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Guest</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Seat</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Meal</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Dietary Flags</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((guest: any) => (
                  <tr key={guest.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-black text-sm text-slate-900">{guest.name}</p>
                      {guest.notes && (
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[200px]">{guest.notes}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {guest.tableNumber && <span className="text-[10px] font-black uppercase text-slate-500">T{guest.tableNumber}</span>}
                      {guest.seatNumber && <span className="text-[10px] font-black uppercase text-slate-400"> · {guest.seatNumber}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-bold text-slate-700">
                        {guest.mealChoiceName || <span className="text-slate-300 italic">—</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(guest.allergies || []).map((a: string) => <AllergyPill key={a} label={a} type="allergy" />)}
                        {(guest.dietaryRestrictions || []).map((d: string) => <AllergyPill key={d} label={d} type="dietary" />)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {guest.checkedIn
                        ? <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black uppercase text-[9px]">Checked In</Badge>
                        : <Badge className="bg-slate-50 text-slate-400 border-slate-200 font-black uppercase text-[9px]">Pre-Registered</Badge>
                      }
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400 font-bold uppercase tracking-widest">
                      No guests match your filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}