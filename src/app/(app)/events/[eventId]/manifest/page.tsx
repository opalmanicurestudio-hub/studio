'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import {
  doc, collection, query, where, writeBatch, onSnapshot,
  updateDoc, deleteDoc, addDoc, getDoc,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Users, AlertTriangle, Leaf, Download, Play, CheckCircle2, Loader,
  Search, Plus, Utensils, Link2, Copy, QrCode, UserPlus, Pencil,
  Trash2, PackageCheck, PackageX, ChevronDown, ChevronUp, X,
  UserCheck, Box, Check,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const safeDate = (v: any) => v?.toDate?.() ?? (typeof v === 'string' ? parseISO(v) : new Date(v));
const safeNum = (v: any) => Number(v) || 0;

// ─── ALLERGY PILL ─────────────────────────────────────────────────────────────
const AllergyPill = ({ label, type = 'allergy' }: { label: string; type?: 'allergy' | 'dietary' }) => (
  <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border',
    type === 'allergy' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
  )}>
    {type === 'allergy' ? <AlertTriangle className="w-2 h-2" /> : <Leaf className="w-2 h-2" />}
    {label}
  </span>
);

// ─── STAT CARD ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color = 'slate' }: { label: string; value: string | number; sub?: string; color?: string }) => {
  const colors: Record<string, string> = {
    slate: 'bg-white border-slate-200', amber: 'bg-amber-50 border-amber-200',
    emerald: 'bg-emerald-50 border-emerald-200', blue: 'bg-blue-50 border-blue-200',
    red: 'bg-red-50 border-red-200',
  };
  return (
    <div className={cn('p-5 rounded-2xl border-2', colors[color] || colors.slate)}>
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
  const { inventory, clients } = useInventory();
  const tenantId = selectedTenant?.id ?? '';
  const eventId = params.eventId as string;

  // ── Live data ──────────────────────────────────────────────────────────────
  const [event, setEvent]       = useState<any>(null);
  const [guests, setGuests]     = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [fires, setFires]       = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!firestore || !tenantId || !eventId) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(doc(firestore, `tenants/${tenantId}/events`, eventId), snap => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      setLoading(false);
    }));
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
    return () => unsubs.forEach(u => u());
  }, [firestore, tenantId, eventId]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [search, setSearch]             = useState('');
  const [filterMeal, setFilterMeal]     = useState('all');
  const [filterFlag, setFilterFlag]     = useState('all');
  const [isFiring, setIsFiring]         = useState<number | null>(null);
  const [showForecast, setShowForecast] = useState(true);
  const [showLink, setShowLink]         = useState(false);
  const [activeTab, setActiveTab]       = useState('guests');

  // Menu item form
  const [isAddingMenu, setIsAddingMenu]         = useState(false);
  const [newMenuName, setNewMenuName]           = useState('');
  const [newMenuDesc, setNewMenuDesc]           = useState('');
  const [newMenuCourse, setNewMenuCourse]       = useState(1);
  const [newMenuCategory, setNewMenuCategory]   = useState('main');
  const [newMenuVegan, setNewMenuVegan]         = useState(false);
  const [newMenuGF, setNewMenuGF]               = useState(false);
  const [menuSupplies, setMenuSupplies]         = useState<{ inventoryId: string; qty: number }[]>([]);

  // Guest add/edit
  const [isAddingGuest, setIsAddingGuest]       = useState(false);
  const [editingGuest, setEditingGuest]         = useState<any>(null);
  const [guestForm, setGuestForm]               = useState({ name: '', email: '', phone: '', tableNumber: '', seatNumber: '', mealChoiceId: '', notes: '' });
  const [clientSearch, setClientSearch]         = useState('');
  const [savingGuest, setSavingGuest]           = useState(false);

  // ── Shareable link ────────────────────────────────────────────────────────
  const shareableLink = typeof window !== 'undefined'
    ? `${window.location.origin}/event/${tenantId}/${eventId}`
    : `/event/${tenantId}/${eventId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(shareableLink);
    toast({ title: 'Link Copied', description: 'Share this with your guests.' });
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const allergyFlags = guests.flatMap(g => g.allergies || []);
    const mealCounts: Record<string, number> = {};
    guests.forEach(g => {
      const name = menuItems.find(m => m.id === g.mealChoiceId)?.name || g.mealChoiceName || 'No selection';
      mealCounts[name] = (mealCounts[name] || 0) + 1;
    });
    return {
      total: guests.length,
      checkedIn: guests.filter(g => g.checkedIn).length,
      allergyCount: allergyFlags.length,
      uniqueAllergies: Array.from(new Set(allergyFlags)) as string[],
      mealCounts,
    };
  }, [guests, menuItems]);

  // ── Inventory forecast ────────────────────────────────────────────────────
  const forecast = useMemo(() => {
    if (!menuItems.length || !guests.length) return [];
    const supplyNeeds: Record<string, { name: string; needed: number; inStock: number; unit: string; status: 'ok' | 'low' | 'critical' }> = {};

    guests.forEach(guest => {
      // Single-course events
      const mealItem = menuItems.find(m => m.id === guest.mealChoiceId);
      const items = mealItem ? [mealItem] : [];
      // Multi-course events
      if (guest.courseSelections) {
        Object.values(guest.courseSelections).forEach((mId: any) => {
          const item = menuItems.find(m => m.id === mId);
          if (item && !items.find(i => i.id === item.id)) items.push(item);
        });
      }
      items.forEach(item => {
        (item.supplies || []).forEach((s: any) => {
          const inv = (inventory || []).find((i: any) => i.id === s.inventoryId);
          if (!inv) return;
          if (!supplyNeeds[s.inventoryId]) {
            supplyNeeds[s.inventoryId] = { name: inv.name, needed: 0, inStock: safeNum(inv.totalStock), unit: inv.unit || 'units', status: 'ok' };
          }
          supplyNeeds[s.inventoryId].needed += safeNum(s.qty);
        });
      });
    });

    return Object.entries(supplyNeeds).map(([id, data]) => {
      const remaining = data.inStock - data.needed;
      const status = remaining < 0 ? 'critical' : remaining < data.needed * 0.2 ? 'low' : 'ok';
      return { id, ...data, status, remaining };
    });
  }, [guests, menuItems, inventory]);

  // ── Filtered guests ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return guests.filter(g => {
      if (search && !g.name?.toLowerCase().includes(search.toLowerCase()) &&
          !g.seatNumber?.includes(search) && !g.tableNumber?.includes(search)) return false;
      if (filterMeal !== 'all' && g.mealChoiceId !== filterMeal) return false;
      if (filterFlag === 'allergies' && (!g.allergies || !g.allergies.length)) return false;
      if (filterFlag === 'dietary' && (!g.dietaryRestrictions || !g.dietaryRestrictions.length)) return false;
      return true;
    }).sort((a, b) => {
      if (a.tableNumber && b.tableNumber) return a.tableNumber.localeCompare(b.tableNumber);
      return (a.submittedAt || '').localeCompare(b.submittedAt || '');
    });
  }, [guests, search, filterMeal, filterFlag]);

  // ── Filtered clients for import ───────────────────────────────────────────
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return (clients || []).slice(0, 10);
    const s = clientSearch.toLowerCase();
    return (clients || []).filter((c: any) =>
      c.name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) || c.phone?.includes(s)
    ).slice(0, 10);
  }, [clients, clientSearch]);

  const courseNumbers = useMemo(() =>
    Array.from(new Set(menuItems.map(m => m.courseNumber))).sort() as number[],
    [menuItems]
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleFireCourse = async (courseNumber: number) => {
    if (!firestore || !tenantId) return;
    setIsFiring(courseNumber);
    try {
      const batch = writeBatch(firestore);
      const fireId = nanoid();
      const now = new Date().toISOString();
      const guestsForCourse = guests.filter(g => g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId));

      // Course fire record
      batch.set(doc(firestore, `tenants/${tenantId}/courseFires`, fireId), {
        id: fireId, eventId, tenantId, courseNumber,
        courseName: `Course ${courseNumber}`,
        firedAt: now, firedBy: 'host',
        guestCount: guestsForCourse.length, status: 'fired',
      });

      // KDS ticket per guest
      guestsForCourse.forEach(guest => {
        const menuItemId = guest.courseSelections?.[courseNumber] || guest.mealChoiceId;
        const menuItem = menuItems.find(m => m.id === menuItemId);
        const kdsId = nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/kdsTickets`, kdsId), {
          id: kdsId, source: 'event', eventId,
          eventTitle: event?.title || '', courseFireId: fireId, courseNumber,
          guestId: guest.id, guestName: guest.name,
          seatNumber: guest.seatNumber || null, tableNumber: guest.tableNumber || null,
          menuItemId, menuItemName: menuItem?.name || 'Item',
          allergies: guest.allergies || [], dietaryRestrictions: guest.dietaryRestrictions || [],
          notes: guest.notes || null, status: 'pending', createdAt: now, tenantId,
        });
      });

      // ── DEDUCT INVENTORY for each menu item fired ──────────────────────
      const deductionMap: Record<string, number> = {};
      guestsForCourse.forEach(guest => {
        const menuItemId = guest.courseSelections?.[courseNumber] || guest.mealChoiceId;
        const menuItem = menuItems.find(m => m.id === menuItemId);
        if (!menuItem?.supplies) return;
        menuItem.supplies.forEach((s: any) => {
          deductionMap[s.inventoryId] = (deductionMap[s.inventoryId] || 0) + safeNum(s.qty);
        });
      });

      Object.entries(deductionMap).forEach(([invId, qty]) => {
        const inv = (inventory || []).find((i: any) => i.id === invId);
        if (!inv) return;
        const { increment } = require('firebase/firestore');
        batch.update(doc(firestore, `tenants/${tenantId}/inventory`, invId), {
          totalStock: increment(-qty),
        });
        batch.set(doc(collection(firestore, `tenants/${tenantId}/stockCorrections`)), {
          id: nanoid(), productId: invId, productName: inv.name,
          date: now, change: -qty, unit: inv.unit || 'units',
          reason: `Event: ${event?.title} — Course ${courseNumber} fired`,
          source: 'event_course_fire', eventId,
        });
      });

      await batch.commit();
      toast({ title: `Course ${courseNumber} Fired`, description: `${guestsForCourse.length} tickets sent to kitchen. Inventory updated.` });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Fire Failed' });
    } finally {
      setIsFiring(null);
    }
  };

  const handleCheckInGuest = async (guestId: string, currentValue: boolean) => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, guestId), {
      checkedIn: !currentValue,
      checkedInAt: !currentValue ? new Date().toISOString() : null,
    });
    toast({ title: !currentValue ? 'Checked In ✓' : 'Check-in Removed' });
  };

  const handleDeleteGuest = async (guestId: string) => {
    if (!firestore || !tenantId) return;
    await deleteDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, guestId));
    toast({ title: 'Guest Removed' });
  };

  const handleSaveGuest = async () => {
    if (!guestForm.name.trim() || !firestore || !tenantId) return;
    setSavingGuest(true);
    const mealItem = menuItems.find(m => m.id === guestForm.mealChoiceId);
    try {
      if (editingGuest) {
        await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, editingGuest.id), {
          ...guestForm,
          mealChoiceName: mealItem?.name || null,
          updatedAt: new Date().toISOString(),
        });
        toast({ title: 'Guest Updated' });
      } else {
        const id = nanoid();
        await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
          id, eventId, tenantId, ...guestForm,
          mealChoiceName: mealItem?.name || null,
          allergies: [], dietaryRestrictions: [],
          checkedIn: false, source: 'manual',
          submittedAt: new Date().toISOString(),
        });
        toast({ title: 'Guest Added' });
      }
    } finally {
      setSavingGuest(false);
      setIsAddingGuest(false);
      setEditingGuest(null);
      setGuestForm({ name: '', email: '', phone: '', tableNumber: '', seatNumber: '', mealChoiceId: '', notes: '' });
    }
  };

  const handleImportClient = async (client: any) => {
    if (!firestore || !tenantId) return;
    // Check if already added
    if (guests.find(g => g.clientId === client.id)) {
      toast({ variant: 'destructive', title: 'Already on guest list' });
      return;
    }
    const id = nanoid();
    await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
      id, eventId, tenantId,
      name: client.name, email: client.email || '', phone: client.phone || '',
      tableNumber: '', seatNumber: '', mealChoiceId: '', mealChoiceName: null,
      allergies: [], dietaryRestrictions: [],
      checkedIn: false, source: 'client_import', clientId: client.id,
      submittedAt: new Date().toISOString(),
    });
    toast({ title: `${client.name} added to guest list` });
  };

  const handleAddMenuItem = async () => {
    if (!newMenuName.trim() || !firestore || !tenantId) return;
    const id = nanoid();
    const batch = writeBatch(firestore);

    const menuItem = {
      id, eventId, tenantId,
      name: newMenuName.trim(),
      description: newMenuDesc.trim() || null,
      category: newMenuCategory,
      courseNumber: newMenuCourse,
      isVegan: newMenuVegan,
      isGlutenFree: newMenuGF,
      // Link to inventory supplies
      supplies: menuSupplies.filter(s => s.inventoryId && s.qty > 0),
    };

    batch.set(doc(firestore, `tenants/${tenantId}/eventMenuItems`, id), menuItem);

    // ALSO write into event.menuItems array so guest order page can read it
    const eventRef = doc(firestore, `tenants/${tenantId}/events`, eventId);
    const eventSnap = await getDoc(eventRef);
    const existing = eventSnap.data()?.menuItems || [];
    batch.update(eventRef, { menuItems: [...existing, menuItem] });

    await batch.commit();
    setNewMenuName(''); setNewMenuDesc(''); setMenuSupplies([]); setIsAddingMenu(false);
    toast({ title: 'Menu item added' });
  };

  const handleExportCSV = () => {
    const rows = [
      ['Name', 'Email', 'Phone', 'Table', 'Seat', 'Meal Choice', 'Allergies', 'Dietary', 'Notes', 'Checked In'],
      ...guests.map(g => [
        g.name, g.email || '', g.phone || '',
        g.tableNumber || '', g.seatNumber || '',
        g.mealChoiceName || '',
        (g.allergies || []).join('; '),
        (g.dietaryRestrictions || []).join('; '),
        g.notes || '',
        g.checkedIn ? 'Yes' : 'No',
      ])
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${event?.title || 'event'}-manifest.csv`;
    a.click();
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader className="animate-spin w-8 h-8 text-slate-400" /></div>;
  if (!event) return <div className="flex h-screen items-center justify-center text-slate-400 font-bold">Event not found</div>;

  const courseLabels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
  const firedCourses = new Set(fires.filter(f => f.status === 'fired').map(f => f.courseNumber));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <AppHeader title={`${event.title} — Manifest`} />
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 pb-24">

        {/* ── HEADER ── */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">{event.title}</h1>
            {event.date && <p className="text-sm text-slate-500 mt-1">{format(new Date(event.date), "EEEE, MMMM d, yyyy")}</p>}
            {event.venue && <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{event.venue}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setShowLink(!showLink)}
              className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
              <Link2 className="w-4 h-4" /> Guest Link
            </Button>
            <Button variant="outline" onClick={handleExportCSV}
              className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
              <Download className="w-4 h-4" /> Export CSV
            </Button>
          </div>
        </div>

        {/* ── SHAREABLE LINK ── */}
        <AnimatePresence>
          {showLink && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="bg-white rounded-2xl border-2 border-primary/20 p-5 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guest Order Link — Share this before the event</p>
              <div className="flex items-center gap-3">
                <code className="flex-1 text-xs font-bold bg-slate-50 rounded-xl px-4 py-3 border-2 border-slate-200 truncate text-slate-700">
                  {shareableLink}
                </code>
                <Button onClick={copyLink} className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shrink-0">
                  <Copy className="w-4 h-4" /> Copy
                </Button>
              </div>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                Guests open this link to submit meal choices and flag allergies before the event.
                You can append ?table=3&seat=A1 to pre-fill their seat.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── STATS ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Responses" value={stats.total} sub={`${stats.checkedIn} checked in`} />
          <StatCard label="Allergy Flags" value={stats.allergyCount} sub={stats.uniqueAllergies.slice(0, 2).join(', ') || 'None'} color="amber" />
          {Object.entries(stats.mealCounts).slice(0, 2).map(([meal, count]) => (
            <StatCard key={meal} label={meal} value={count}
              sub={`${Math.round(count / Math.max(stats.total, 1) * 100)}%`} color="emerald" />
          ))}
        </div>

        {/* ── INVENTORY FORECAST ── */}
        {forecast.length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
            <button onClick={() => setShowForecast(!showForecast)}
              className="w-full p-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Supply Forecast</h2>
                <Badge className={cn('ml-1 font-black text-[9px]',
                  forecast.some(f => f.status === 'critical') ? 'bg-red-100 text-red-700 border-red-200' :
                  forecast.some(f => f.status === 'low') ? 'bg-amber-100 text-amber-700 border-amber-200' :
                  'bg-emerald-100 text-emerald-700 border-emerald-200'
                )}>
                  {forecast.some(f => f.status === 'critical') ? '⚠ Shortage' :
                   forecast.some(f => f.status === 'low') ? '⚠ Low Stock' : '✓ Covered'}
                </Badge>
              </div>
              {showForecast ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            <AnimatePresence>
              {showForecast && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                  <div className="p-5 pt-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {forecast.map(item => (
                      <div key={item.id} className={cn('p-4 rounded-2xl border-2',
                        item.status === 'critical' ? 'border-red-200 bg-red-50' :
                        item.status === 'low' ? 'border-amber-200 bg-amber-50' :
                        'border-emerald-200 bg-emerald-50'
                      )}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-black text-sm text-slate-900">{item.name}</p>
                            <p className="text-[10px] font-bold text-slate-500 mt-0.5 uppercase">
                              Need: {item.needed} {item.unit} · Have: {item.inStock} {item.unit}
                            </p>
                          </div>
                          {item.status === 'ok'
                            ? <PackageCheck className="w-5 h-5 text-emerald-500 shrink-0" />
                            : <PackageX className="w-5 h-5 text-red-500 shrink-0" />}
                        </div>
                        {item.status !== 'ok' && (
                          <p className={cn('text-[10px] font-black uppercase tracking-widest mt-2',
                            item.status === 'critical' ? 'text-red-600' : 'text-amber-600'
                          )}>
                            {item.status === 'critical'
                              ? `Short by ${Math.abs(item.remaining)} ${item.unit} — reorder needed`
                              : `Only ${item.remaining} ${item.unit} buffer — running low`}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="px-5 pb-4 text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                    Based on {stats.total} RSVPs. Updates live as guests submit orders. Deducted automatically when course fires.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── COURSE FIRING ── */}
        {courseNumbers.length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
                <Utensils className="w-4 h-4 text-primary" /> Course Firing
              </h2>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-0.5">
                Pushes all orders to KDS simultaneously and deducts inventory
              </p>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {courseNumbers.map(n => {
                const fired = firedCourses.has(n);
                const count = guests.filter(g => g.courseSelections?.[n] || (n === 1 && g.mealChoiceId)).length;
                return (
                  <div key={n} className={cn('p-4 rounded-2xl border-2',
                    fired ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Course {n}</p>
                        <p className="font-black text-slate-900 text-sm">{courseLabels[n] || `Course ${n}`}</p>
                        <p className="text-[10px] text-slate-500">{count} guests</p>
                      </div>
                      {fired && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
                    </div>
                    <Button onClick={() => handleFireCourse(n)} disabled={!!isFiring || fired || count === 0}
                      className={cn('w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2',
                        fired ? 'bg-emerald-500 hover:bg-emerald-500 opacity-60 cursor-not-allowed' : 'shadow-lg shadow-primary/20')}>
                      {isFiring === n ? <Loader className="w-4 h-4 animate-spin" />
                        : fired ? <><CheckCircle2 className="w-4 h-4" /> Fired</>
                        : <><Play className="w-4 h-4" /> Fire Course</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── MAIN TABS: Guests / Menu ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-11 rounded-2xl border-2 bg-slate-100 p-1 gap-1">
            <TabsTrigger value="guests" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-sm px-5">
              Guests ({guests.length})
            </TabsTrigger>
            <TabsTrigger value="menu" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-sm px-5">
              Menu ({menuItems.length})
            </TabsTrigger>
          </TabsList>

          {/* ── GUESTS TAB ── */}
          <TabsContent value="guests" className="mt-4 space-y-4">
            {/* Guest action bar */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => { setIsAddingGuest(true); setEditingGuest(null); setGuestForm({ name: '', email: '', phone: '', tableNumber: '', seatNumber: '', mealChoiceId: '', notes: '' }); }}
                className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg shadow-primary/20">
                <UserPlus className="w-4 h-4" /> Add Guest
              </Button>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search guests…"
                  className="pl-8 h-10 w-48 rounded-xl border-2 text-xs font-bold" />
              </div>
              <Select value={filterMeal} onValueChange={setFilterMeal}>
                <SelectTrigger className="h-10 w-36 rounded-xl border-2 font-bold uppercase text-[10px]">
                  <SelectValue placeholder="All meals" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Meals</SelectItem>
                  {menuItems.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterFlag} onValueChange={setFilterFlag}>
                <SelectTrigger className="h-10 w-36 rounded-xl border-2 font-bold uppercase text-[10px]">
                  <SelectValue placeholder="All flags" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guests</SelectItem>
                  <SelectItem value="allergies">Has Allergy</SelectItem>
                  <SelectItem value="dietary">Dietary Req.</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Add / edit guest form */}
            <AnimatePresence>
              {(isAddingGuest || editingGuest) && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="bg-white rounded-2xl border-2 border-primary/20 overflow-hidden">
                  <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-black uppercase tracking-tight text-slate-900">
                        {editingGuest ? 'Edit Guest' : 'Add Guest'}
                      </h3>
                      {/* Import from client log */}
                      {!editingGuest && (
                        <div className="flex items-center gap-2">
                          <Input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                            placeholder="Import from client log…" className="h-9 w-52 rounded-xl border-2 text-xs font-bold" />
                        </div>
                      )}
                    </div>

                    {/* Client search results */}
                    {!editingGuest && clientSearch && filteredClients.length > 0 && (
                      <div className="rounded-xl border-2 divide-y overflow-hidden">
                        {filteredClients.map((c: any) => (
                          <button key={c.id} onClick={() => { handleImportClient(c); setClientSearch(''); }}
                            className="w-full flex items-center justify-between p-3 hover:bg-primary/5 transition-colors text-left gap-3">
                            <div>
                              <p className="font-black text-sm text-slate-900">{c.name}</p>
                              <p className="text-[10px] text-slate-400">{c.email} · {c.phone}</p>
                            </div>
                            <Badge className="bg-primary/10 text-primary border-primary/20 font-black text-[9px] shrink-0">Import</Badge>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Manual form */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Name *</Label>
                        <Input value={guestForm.name} onChange={e => setGuestForm(p => ({ ...p, name: e.target.value }))}
                          placeholder="Full name" className="h-11 rounded-xl border-2" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Email</Label>
                        <Input value={guestForm.email} onChange={e => setGuestForm(p => ({ ...p, email: e.target.value }))}
                          placeholder="email@example.com" className="h-11 rounded-xl border-2" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Phone</Label>
                        <Input value={guestForm.phone} onChange={e => setGuestForm(p => ({ ...p, phone: e.target.value }))}
                          placeholder="(555) 000-0000" className="h-11 rounded-xl border-2" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Meal Choice</Label>
                        <Select value={guestForm.mealChoiceId} onValueChange={v => setGuestForm(p => ({ ...p, mealChoiceId: v }))}>
                          <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue placeholder="Select meal…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">No selection</SelectItem>
                            {menuItems.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Table</Label>
                        <Input value={guestForm.tableNumber} onChange={e => setGuestForm(p => ({ ...p, tableNumber: e.target.value }))}
                          placeholder="Table #" className="h-11 rounded-xl border-2" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Seat</Label>
                        <Input value={guestForm.seatNumber} onChange={e => setGuestForm(p => ({ ...p, seatNumber: e.target.value }))}
                          placeholder="Seat #" className="h-11 rounded-xl border-2" />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button onClick={() => { setIsAddingGuest(false); setEditingGuest(null); }} variant="outline"
                        className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                      <Button onClick={handleSaveGuest} disabled={savingGuest || !guestForm.name.trim()}
                        className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                        {savingGuest ? <Loader className="w-4 h-4 animate-spin" /> : editingGuest ? 'Save Changes' : 'Add Guest →'}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Guest table */}
            <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Guest</th>
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Seat</th>
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Meal</th>
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Flags</th>
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Status</th>
                      <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map(guest => (
                      <tr key={guest.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-black text-sm text-slate-900">{guest.name}</p>
                          <p className="text-[10px] text-slate-400">{guest.email || ''}{guest.phone ? ` · ${guest.phone}` : ''}</p>
                          {guest.source === 'client_import' && (
                            <span className="text-[8px] font-black uppercase tracking-widest text-primary opacity-60">From client log</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {guest.tableNumber && <span className="text-[10px] font-black uppercase text-slate-500">T{guest.tableNumber}</span>}
                          {guest.seatNumber && <span className="text-[10px] font-black uppercase text-slate-400"> · {guest.seatNumber}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-bold text-slate-700">
                            {guest.mealChoiceName || <span className="text-slate-300 italic text-xs">—</span>}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(guest.allergies || []).map((a: string) => <AllergyPill key={a} label={a} type="allergy" />)}
                            {(guest.dietaryRestrictions || []).map((d: string) => <AllergyPill key={d} label={d} type="dietary" />)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleCheckInGuest(guest.id, guest.checkedIn)}
                            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest transition-all',
                              guest.checkedIn
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-primary/30 hover:text-primary')}>
                            {guest.checkedIn ? <><UserCheck className="w-3 h-3" /> In</> : <><UserPlus className="w-3 h-3" /> Check In</>}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setEditingGuest(guest); setIsAddingGuest(false); setGuestForm({ name: guest.name, email: guest.email || '', phone: guest.phone || '', tableNumber: guest.tableNumber || '', seatNumber: guest.seatNumber || '', mealChoiceId: guest.mealChoiceId || '', notes: guest.notes || '' }); }}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDeleteGuest(guest.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400 font-bold uppercase tracking-widest">
                        {guests.length === 0 ? 'No guests yet — add manually or share the guest link' : 'No guests match your filters'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ── MENU TAB ── */}
          <TabsContent value="menu" className="mt-4 space-y-4">
            <Button onClick={() => setIsAddingMenu(true)}
              className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4" /> Add Menu Item
            </Button>

            <AnimatePresence>
              {isAddingMenu && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="bg-white rounded-2xl border-2 border-primary/20 overflow-hidden">
                  <div className="p-6 space-y-4">
                    <h3 className="font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                      <Plus className="w-4 h-4 text-primary" /> New Menu Item
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Item Name *</Label>
                        <Input value={newMenuName} onChange={e => setNewMenuName(e.target.value)}
                          placeholder="e.g. Pan-Seared Salmon" className="h-12 rounded-xl border-2" />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Description</Label>
                        <Input value={newMenuDesc} onChange={e => setNewMenuDesc(e.target.value)}
                          placeholder="With lemon butter and asparagus" className="h-12 rounded-xl border-2" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Course #</Label>
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
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Category</Label>
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
                      <div className="flex items-center gap-4 sm:col-span-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={newMenuVegan} onChange={e => setNewMenuVegan(e.target.checked)} className="rounded" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Vegan</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={newMenuGF} onChange={e => setNewMenuGF(e.target.checked)} className="rounded" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Gluten-Free</span>
                        </label>
                      </div>

                      {/* ── INVENTORY SUPPLIES LINK ── */}
                      <div className="sm:col-span-2 space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                            Inventory Supplies Used Per Guest
                          </Label>
                          <Button type="button" variant="outline" onClick={() => setMenuSupplies(p => [...p, { inventoryId: '', qty: 1 }])}
                            className="h-8 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest gap-1">
                            <Plus className="w-3 h-3" /> Add Supply
                          </Button>
                        </div>
                        {menuSupplies.length === 0 && (
                          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                            Link inventory items to auto-forecast and deduct stock when this course fires.
                          </p>
                        )}
                        {menuSupplies.map((supply, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Select value={supply.inventoryId} onValueChange={v => {
                              const next = [...menuSupplies];
                              next[i] = { ...next[i], inventoryId: v };
                              setMenuSupplies(next);
                            }}>
                              <SelectTrigger className="flex-1 h-10 rounded-xl border-2 font-bold text-xs"><SelectValue placeholder="Select item from inventory…" /></SelectTrigger>
                              <SelectContent>
                                {(inventory || []).map((inv: any) => (
                                  <SelectItem key={inv.id} value={inv.id}>{inv.name} ({inv.totalStock} {inv.unit} in stock)</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input type="number" min="0.01" step="0.01" value={supply.qty}
                              onChange={e => { const next = [...menuSupplies]; next[i] = { ...next[i], qty: parseFloat(e.target.value) || 0 }; setMenuSupplies(next); }}
                              placeholder="Qty" className="w-20 h-10 rounded-xl border-2 font-bold text-center" />
                            <button onClick={() => setMenuSupplies(p => p.filter((_, j) => j !== i))}
                              className="p-2 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button onClick={() => setIsAddingMenu(false)} variant="outline"
                        className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                      <Button onClick={handleAddMenuItem} disabled={!newMenuName.trim()}
                        className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                        Add to Menu →
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Menu items list */}
            {menuItems.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed rounded-3xl">
                <Utensils className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="font-black uppercase text-[10px] tracking-widest text-slate-400">No menu items yet</p>
                <p className="text-[9px] text-slate-300 font-bold uppercase tracking-widest mt-1">Add items above — they'll appear on the guest order page automatically</p>
              </div>
            ) : (
              <div className="space-y-2">
                {menuItems.map(item => (
                  <div key={item.id} className="bg-white rounded-2xl border-2 border-slate-200 p-4 flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-black text-slate-900">{item.name}</p>
                        <Badge className="bg-slate-100 text-slate-500 border-slate-200 font-black text-[8px]">
                          Course {item.courseNumber}
                        </Badge>
                        {item.isVegan && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black text-[8px]">Vegan</Badge>}
                        {item.isGlutenFree && <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-black text-[8px]">GF</Badge>}
                      </div>
                      {item.description && <p className="text-[10px] text-slate-500 mt-0.5">{item.description}</p>}
                      {item.supplies?.length > 0 && (
                        <p className="text-[9px] text-primary font-bold uppercase tracking-widest mt-1">
                          {item.supplies.length} supply item{item.supplies.length !== 1 ? 's' : ''} linked
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className="bg-slate-50 text-slate-600 border-slate-200 font-black text-[9px]">
                        {guests.filter(g => g.mealChoiceId === item.id || Object.values(g.courseSelections || {}).includes(item.id)).length} selected
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}