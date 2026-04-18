'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import {
  doc, collection, query, where, writeBatch, onSnapshot,
  updateDoc, deleteDoc, addDoc, getDoc, increment, getDocs, setDoc,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { format, parseISO } from 'date-fns';
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
  QrCode, Printer, BarChart2, Search, Plus, Utensils, Link2, Copy,
  UserPlus, Pencil, Trash2, PackageCheck, PackageX, ChevronDown,
  ChevronUp, X, UserCheck, Box, Check, Bell, ExternalLink,
  RefreshCw, ShieldAlert, Megaphone, Send, Package,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const safeDate = (v: any) => v?.toDate?.() ?? (typeof v === 'string' ? parseISO(v) : new Date(v));
const safeNum  = (v: any) => Number(v) || 0;

// ─── ALLERGY PILL ─────────────────────────────────────────────────────────────
const AllergyPill = ({ allergy }: { allergy: any }) => {
  const label    = typeof allergy === 'object' ? allergy.label    : allergy;
  const severity = typeof allergy === 'object' ? allergy.severity : 'preference';
  if (severity === 'critical') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border bg-red-100 border-red-400 text-red-800">
      <AlertTriangle className="w-2.5 h-2.5" /> {label}
    </span>
  );
  if (severity === 'intolerance') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border bg-amber-50 border-amber-300 text-amber-800">
      <AlertTriangle className="w-2 h-2" /> {label}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border bg-slate-100 border-slate-200 text-slate-600">
      <Leaf className="w-2 h-2" /> {label}
    </span>
  );
};

// ─── STAT CARD ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color = 'slate' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) => {
  const colors: Record<string, string> = {
    slate:   'bg-white border-slate-200',
    amber:   'bg-amber-50 border-amber-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    blue:    'bg-blue-50 border-blue-200',
    red:     'bg-red-50 border-red-200',
  };
  return (
    <div className={cn('p-5 rounded-2xl border-2', colors[color] || colors.slate)}>
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className="text-3xl font-black tracking-tighter text-slate-900 leading-none">{value}</p>
      {sub && <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-wide">{sub}</p>}
    </div>
  );
};

// ─── FLOOR REQUEST PANEL ──────────────────────────────────────────────────────
const FLOOR_REQUEST_ICONS: Record<string, string> = {
  water: '💧', napkins: '🧻', condiments: '🧂', utensils: '🍴',
  ice: '🧊', accessibility: '♿', temperature: '🌡️', cleaning: '🧹', other: '💬',
};

const FloorRequestPanel = ({ requests, onResolve, tenantId }: {
  requests: any[]; onResolve: (id: string) => void; tenantId: string;
}) => {
  const [resolving, setResolving] = useState<string | null>(null);
  if (requests.length === 0) return null;
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="bg-amber-50 border-2 border-amber-300 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-600 animate-pulse" />
            <p className="font-black text-sm text-amber-800 uppercase tracking-tight">
              Floor Requests — {requests.length} Pending
            </p>
          </div>
          <a href={`/floor/${tenantId}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-amber-600 hover:text-amber-800 transition-colors">
            Full View <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="divide-y divide-amber-200 max-h-64 overflow-y-auto">
          {requests.map(r => {
            const elapsedMins = Math.floor((Date.now() - safeDate(r.createdAt).getTime()) / 60000);
            const isLate = elapsedMins >= 5;
            return (
              <div key={r.id} className="flex items-center gap-3 p-3">
                <span className="text-xl shrink-0">{FLOOR_REQUEST_ICONS[r.requestType] || '💬'}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-sm text-amber-900">{r.label || r.requestType}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {r.tableNumber && <span className="text-[9px] font-bold text-amber-600 uppercase">Table {r.tableNumber}</span>}
                    {r.guestName   && <span className="text-[9px] font-bold text-amber-600 uppercase">{r.guestName}</span>}
                    <span className={cn('text-[9px] font-black uppercase tracking-widest',
                      isLate ? 'text-red-500' : 'text-amber-500')}>
                      {isLate ? `⚠ ${elapsedMins}m ago` : elapsedMins < 1 ? 'Just now' : `${elapsedMins}m ago`}
                    </span>
                  </div>
                </div>
                <button onClick={async () => { setResolving(r.id); await onResolve(r.id); setResolving(null); }}
                  disabled={resolving === r.id}
                  className="shrink-0 w-9 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-all active:scale-95">
                  {resolving === r.id
                    ? <Loader className="w-4 h-4 animate-spin text-white" />
                    : <Check className="w-4 h-4 text-white" />}
                </button>
              </div>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

// ─── DELTA RE-FIRE BANNER ─────────────────────────────────────────────────────
const DeltaRefireBanner = ({
  courseNumber, courseName, deltaGuests, onRefire, isFiring,
}: {
  courseNumber: number; courseName: string; deltaGuests: any[];
  onRefire: (courseNumber: number, deltaGuests: any[]) => Promise<void>; isFiring: boolean;
}) => (
  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
    className="bg-indigo-50 border-2 border-indigo-300 rounded-2xl p-4 flex items-center justify-between gap-4">
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
        <RefreshCw className="w-4 h-4 text-indigo-600" />
      </div>
      <div className="min-w-0">
        <p className="font-black text-sm text-indigo-900 leading-tight">
          {deltaGuests.length} new guest{deltaGuests.length !== 1 ? 's' : ''} missed {courseName}
        </p>
        <p className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest mt-0.5 truncate">
          {deltaGuests.map(g => g.name).join(', ')}
        </p>
      </div>
    </div>
    <Button onClick={() => onRefire(courseNumber, deltaGuests)} disabled={isFiring} size="sm"
      className="h-9 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 shrink-0 gap-2">
      {isFiring ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><RefreshCw className="w-3.5 h-3.5" /> Re-fire for them</>}
    </Button>
  </motion.div>
);

// ─── BROADCAST PANEL ──────────────────────────────────────────────────────────
const BroadcastPanel = ({
  eventId, tenantId, firestore, assignedStaffCount, currentBroadcast,
}: {
  eventId: string; tenantId: string; firestore: any;
  assignedStaffCount: number; currentBroadcast: string | null;
}) => {
  const [message, setMessage]   = useState('');
  const [sending, setSending]   = useState(false);
  const [clearing, setClearing] = useState(false);
  const { toast } = useToast();

  const handleSend = async () => {
    if (!message.trim() || !firestore) return;
    setSending(true);
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), {
        broadcastMessage: message.trim(), broadcastSentAt: new Date().toISOString(),
        broadcastSentBy: 'host', broadcastDismissed: false,
      });
      setMessage('');
      toast({ title: 'Broadcast sent', description: `All ${assignedStaffCount} floor staff will see this.` });
    } catch { toast({ variant: 'destructive', title: 'Failed to send' }); }
    finally { setSending(false); }
  };

  const handleClear = async () => {
    if (!firestore) return;
    setClearing(true);
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), {
        broadcastMessage: null, broadcastSentAt: null, broadcastDismissed: true,
      });
      toast({ title: 'Broadcast cleared' });
    } finally { setClearing(false); }
  };

  return (
    <div className="bg-violet-50 border-2 border-violet-200 rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-violet-200 flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-violet-600" />
        <p className="font-black text-sm text-violet-800 uppercase tracking-tight">Broadcast to Floor Staff</p>
        {assignedStaffCount > 0 && (
          <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-violet-500">{assignedStaffCount} staff assigned</span>
        )}
      </div>
      {currentBroadcast && (
        <div className="p-4 border-b border-violet-200 flex items-start gap-3">
          <div className="flex-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-violet-500 mb-1">Active Message</p>
            <p className="text-sm font-bold text-violet-900">"{currentBroadcast}"</p>
          </div>
          <button onClick={handleClear} disabled={clearing}
            className="shrink-0 w-8 h-8 rounded-xl bg-violet-100 hover:bg-violet-200 flex items-center justify-center transition-all">
            {clearing ? <Loader className="w-3.5 h-3.5 animate-spin text-violet-400" /> : <X className="w-3.5 h-3.5 text-violet-500" />}
          </button>
        </div>
      )}
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input value={message} onChange={e => setMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="e.g. Mains going out in 5 minutes…" maxLength={200}
            className="flex-1 h-11 rounded-xl border-2 border-violet-200 bg-white px-3 text-sm font-bold text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 transition-colors" />
          <button onClick={handleSend} disabled={sending || !message.trim()}
            className="h-11 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-black uppercase text-[10px] tracking-widest flex items-center gap-1.5 disabled:opacity-40 transition-all shrink-0">
            {sending ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {['Mains going out in 5 min', 'Desserts ready shortly', 'Please clear table 3', 'All hands to main floor'].map(preset => (
            <button key={preset} onClick={() => setMessage(preset)}
              className="text-[9px] font-black uppercase tracking-widest text-violet-600 bg-violet-100 hover:bg-violet-200 px-2.5 py-1.5 rounded-lg transition-colors">
              {preset}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── SENTINEL ─────────────────────────────────────────────────────────────────
const NO_SELECTION = '__none__';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function EventManifestPage() {
  const params   = useParams();
  const router   = useRouter();
  const { firestore } = useFirebase();
  const { toast }     = useToast();
  const { selectedTenant } = useTenant();
  const { inventory, clients, staff: staffFromContext } = useInventory();
  const tenantId = selectedTenant?.id ?? '';
  const eventId  = params.eventId as string;

  // ── Live data ──────────────────────────────────────────────────────────────
  const [event, setEvent]                 = useState<any>(null);
  const [guests, setGuests]               = useState<any[]>([]);
  const [menuItems, setMenuItems]         = useState<any[]>([]);
  const [fires, setFires]                 = useState<any[]>([]);
  const [floorRequests, setFloorRequests] = useState<any[]>([]);
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    if (!firestore || !tenantId || !eventId) return;
    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), snap => {
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
    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/floorRequests`), where('status', 'in', ['new', 'acknowledged'])),
      snap => setFloorRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));
    return () => unsubs.forEach(u => u());
  }, [firestore, tenantId, eventId]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [search, setSearch]                 = useState('');
  const [filterMeal, setFilterMeal]         = useState('all');
  const [filterFlag, setFilterFlag]         = useState('all');
  const [isFiring, setIsFiring]             = useState<number | null>(null);
  const [isRefiring, setIsRefiring]         = useState<number | null>(null);
  const [showForecast, setShowForecast]     = useState(true);
  const [isConfirmActivateOpen, setIsConfirmActivateOpen] = useState(false);
  const [activatingNow, setActivatingNow]   = useState(false);
  const [undoWindowOpen, setUndoWindowOpen] = useState(false);
  const [undoCountdown, setUndoCountdown]   = useState(120);
  const [showLink, setShowLink]             = useState(false);
  const [qrTables, setQrTables]             = useState('');
  const [qrSeatsPerTable, setQrSeatsPerTable] = useState('');
  const [qrCodes, setQrCodes]               = useState<{ label: string; dataUrl: string }[]>([]);
  const [activeTab, setActiveTab]           = useState('guests');
  const [staffToAdd, setStaffToAdd]         = useState('');
  const [mealOverrideGuest, setMealOverrideGuest] = useState<any>(null);
  const [mealOverrideId, setMealOverrideId] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  const [isEndEventOpen, setIsEndEventOpen] = useState(false);
  const [showBroadcast, setShowBroadcast]   = useState(false);

  // ── FIX: Guest/client state declared BEFORE any useMemo that references them ──
  const [isAddingGuest, setIsAddingGuest]   = useState(false);
  const [editingGuest, setEditingGuest]     = useState<any>(null);
  const [guestForm, setGuestForm]           = useState({ name: '', email: '', phone: '', tableNumber: '', seatNumber: '', mealChoiceId: '', notes: '' });
  const [clientSearch, setClientSearch]     = useState('');
  const [savingGuest, setSavingGuest]       = useState(false);

  // ── Menu item form ─────────────────────────────────────────────────────────
  const [isAddingMenu, setIsAddingMenu]               = useState(false);
  const [newMenuName, setNewMenuName]                 = useState('');
  const [newMenuDesc, setNewMenuDesc]                 = useState('');
  const [newMenuCourse, setNewMenuCourse]             = useState(1);
  const [newMenuCategory, setNewMenuCategory]         = useState('main');
  const [newMenuVegan, setNewMenuVegan]               = useState(false);
  const [newMenuGF, setNewMenuGF]                     = useState(false);
  const [menuSupplies, setMenuSupplies]               = useState<{ inventoryId: string; qty: number }[]>([]);
  const [newMenuInventoryItemId, setNewMenuInventoryItemId] = useState('');
  const [newMenuPortionSize, setNewMenuPortionSize]   = useState(1);
  const [newMenuPrice, setNewMenuPrice]               = useState(0);
  // Inventory search for menu form
  const [inventorySearch, setInventorySearch]         = useState('');

  // ── Gap 9: Delta detection ────────────────────────────────────────────────
  const [firedGuestIdsByCourse, setFiredGuestIdsByCourse] = useState<Record<number, Set<string>>>({});

  useEffect(() => {
    if (!firestore || !tenantId || fires.length === 0) return;
    const firedCourseNums = fires.filter(f => f.status === 'fired').map(f => f.courseNumber);
    if (firedCourseNums.length === 0) return;
    Promise.all(
      firedCourseNums.map(async (courseNumber: number) => {
        const snap = await getDocs(query(
          collection(firestore, `tenants/${tenantId}/kdsTickets`),
          where('eventId', '==', eventId),
          where('courseNumber', '==', courseNumber)
        ));
        const guestIds = new Set(snap.docs.map(d => d.data().guestId as string).filter(Boolean));
        return { courseNumber, guestIds };
      })
    ).then(results => {
      const map: Record<number, Set<string>> = {};
      results.forEach(({ courseNumber, guestIds }) => { map[courseNumber] = guestIds; });
      setFiredGuestIdsByCourse(map);
    });
  }, [fires, firestore, tenantId, eventId]);

  const courseNumbers = useMemo(() =>
    Array.from(new Set(menuItems.map(m => m.courseNumber))).sort() as number[],
    [menuItems]
  );

  const firedCourses = useMemo(
    () => new Set(fires.filter(f => f.status === 'fired').map(f => f.courseNumber)),
    [fires]
  );

  const unfiredCourses = useMemo(
    () => courseNumbers.filter(n => !firedCourses.has(n)),
    [courseNumbers, firedCourses]
  );

  const deltaGuestsByCourse = useMemo(() => {
    const result: Record<number, any[]> = {};
    fires.filter(f => f.status === 'fired').forEach((f: any) => {
      const n = f.courseNumber;
      const firedIds = firedGuestIdsByCourse[n];
      if (!firedIds) return;
      const eligible = guests.filter(g =>
        g.checkedIn &&
        (g.courseSelections?.[n] || (n === 1 && g.mealChoiceId)) &&
        !firedIds.has(g.id)
      );
      if (eligible.length > 0) result[n] = eligible;
    });
    return result;
  }, [guests, fires, firedGuestIdsByCourse]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const allergyObjects = guests.flatMap(g => g.allergies || []);
    const allergyLabels  = allergyObjects.map((a: any) => typeof a === 'object' ? a.label : a);
    const mealCounts: Record<string, number> = {};
    guests.forEach(g => {
      const name = menuItems.find(m => m.id === g.mealChoiceId)?.name || g.mealChoiceName || 'No selection';
      mealCounts[name] = (mealCounts[name] || 0) + 1;
    });
    return {
      total:        guests.length,
      checkedIn:    guests.filter(g => g.checkedIn).length,
      notCheckedIn: guests.filter(g => !g.checkedIn).length,
      allergyCount: allergyLabels.length,
      uniqueAllergies: Array.from(new Set(allergyLabels)) as string[],
      mealCounts,
    };
  }, [guests, menuItems]);

  // ── Filtered guests ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return guests.filter(g => {
      if (search && !g.name?.toLowerCase().includes(search.toLowerCase()) &&
          !g.seatNumber?.includes(search) && !g.tableNumber?.includes(search)) return false;
      if (filterMeal !== 'all' && g.mealChoiceId !== filterMeal) return false;
      if (filterFlag === 'allergies'      && (!g.allergies || !g.allergies.length)) return false;
      if (filterFlag === 'dietary'        && (!g.dietaryRestrictions || !g.dietaryRestrictions.length)) return false;
      if (filterFlag === 'not-checked-in' && g.checkedIn) return false;
      if (filterFlag === 'checked-in'     && !g.checkedIn) return false;
      return true;
    }).sort((a, b) => {
      if (a.tableNumber && b.tableNumber) return a.tableNumber.localeCompare(b.tableNumber);
      return (a.submittedAt || '').localeCompare(b.submittedAt || '');
    });
  }, [guests, search, filterMeal, filterFlag]);

  // ── Filtered clients for import (NOW after clientSearch is declared) ───────
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return (clients || []).slice(0, 10);
    const s = clientSearch.toLowerCase();
    return (clients || []).filter((c: any) =>
      c.name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) || c.phone?.includes(s)
    ).slice(0, 10);
  }, [clients, clientSearch]);

  // ── Filtered inventory for menu form ──────────────────────────────────────
  const filteredInventory = useMemo(() => {
    if (!inventorySearch.trim()) return (inventory || []).slice(0, 12);
    const s = inventorySearch.toLowerCase();
    return (inventory || []).filter((i: any) =>
      i.name?.toLowerCase().includes(s) || i.category?.toLowerCase().includes(s)
    ).slice(0, 12);
  }, [inventory, inventorySearch]);

  // ── Inventory forecast ────────────────────────────────────────────────────
  const forecast = useMemo(() => {
    if (!menuItems.length || !guests.length) return [];
    const supplyNeeds: Record<string, { name: string; needed: number; inStock: number; unit: string; status: 'ok' | 'low' | 'critical' }> = {};
    guests.forEach(guest => {
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
          const inv = (inventory || []).find((i: any) => i.id === s.inventoryId);
          if (!inv) return;
          if (!supplyNeeds[s.inventoryId]) {
            supplyNeeds[s.inventoryId] = { name: (inv as any).name, needed: 0, inStock: safeNum((inv as any).totalStock), unit: (inv as any).unit || 'units', status: 'ok' };
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

  // ── Cross-contamination warnings ──────────────────────────────────────────
  const crossContaminationWarnings = useMemo(() => {
    const warnings: { table: string; guests: string[]; reason: string }[] = [];
    const byTable: Record<string, any[]> = {};
    guests.filter(g => g.tableNumber).forEach(g => {
      if (!byTable[g.tableNumber]) byTable[g.tableNumber] = [];
      byTable[g.tableNumber].push(g);
    });
    Object.entries(byTable).forEach(([table, tableGuests]) => {
      const criticalGuests = tableGuests.filter(g =>
        (g.allergies || []).some((a: any) => typeof a === 'object' && a.severity === 'critical')
      );
      if (!criticalGuests.length) return;
      criticalGuests.forEach(cGuest => {
        const critAllergens = (cGuest.allergies || [])
          .filter((a: any) => typeof a === 'object' && a.severity === 'critical')
          .map((a: any) => a.id);
        tableGuests.filter(g => g.id !== cGuest.id).forEach(other => {
          const mealItem = menuItems.find(m => m.id === other.mealChoiceId);
          if (!mealItem) return;
          const mealText = `${mealItem.name} ${mealItem.description || ''}`.toLowerCase();
          const conflictAllergens = critAllergens.filter((a: string) => mealText.includes(a));
          if (conflictAllergens.length > 0) {
            warnings.push({
              table, guests: [cGuest.name, other.name],
              reason: `${cGuest.name} has critical ${conflictAllergens.join(', ')} allergy — ${other.name} ordered "${mealItem.name}"`,
            });
          }
        });
      });
    });
    return warnings;
  }, [guests, menuItems]);

  // ── Shareable link ────────────────────────────────────────────────────────
  const shareableLink = typeof window !== 'undefined'
    ? `${window.location.origin}/event/${tenantId}/${eventId}`
    : `/event/${tenantId}/${eventId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(shareableLink);
    toast({ title: 'Link Copied', description: 'Share this with your guests.' });
  };

  // ── QR codes ──────────────────────────────────────────────────────────────
  const generateQRDataUrl = async (url: string): Promise<string> =>
    `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;

  const handleGenerateQRs = async () => {
    const tables = qrTables.split(',').map(t => t.trim()).filter(Boolean);
    const seatsPerTable = parseInt(qrSeatsPerTable) || 4;
    const codes: { label: string; dataUrl: string }[] = [];
    for (const table of tables) {
      for (let seat = 1; seat <= seatsPerTable; seat++) {
        const url = `${shareableLink}?table=${table}&seat=${seat}`;
        codes.push({ label: `T${table} · S${seat}`, dataUrl: await generateQRDataUrl(url) });
      }
    }
    setQrCodes(codes);
    toast({ title: `${codes.length} QR codes generated` });
  };

  const handlePrintQRs = () => {
    const area = document.getElementById('qr-print-area');
    if (!area) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<html><head><title>QR Codes</title>
      <style>body{font-family:sans-serif;} .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px;}
      .card{border:1px solid #ddd;border-radius:8px;padding:12px;text-align:center;}
      img{width:80px;height:80px;} p{font-size:10px;font-weight:900;text-transform:uppercase;margin-top:4px;}
      @media print{@page{margin:0.5in;}}</style></head><body><div class="grid">`);
    area.querySelectorAll('.flex.flex-col').forEach(card => {
      const img   = card.querySelector('img') as HTMLImageElement;
      const label = card.querySelector('p')?.textContent || '';
      win.document.write(`<div class="card"><img src="${img?.src}" /><p>${label}</p></div>`);
    });
    win.document.write('</div></body></html>');
    win.document.close();
    win.print();
  };

  // ── Floor request resolve ─────────────────────────────────────────────────
  const handleResolveFloorRequest = async (requestId: string) => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/floorRequests`, requestId), {
      status: 'done', resolvedAt: new Date().toISOString(), resolvedBy: 'host_manifest',
    });
    toast({ title: 'Request resolved ✓' });
  };

  // ── Idempotency ref ───────────────────────────────────────────────────────
  const firingInProgress = useRef<Set<number>>(new Set());

  // ── Delta re-fire ─────────────────────────────────────────────────────────
  const handleRefireDelta = async (courseNumber: number, deltaGuests: any[]) => {
    if (!firestore || !tenantId || deltaGuests.length === 0) return;
    if (firingInProgress.current.has(courseNumber)) return;
    firingInProgress.current.add(courseNumber);
    setIsRefiring(courseNumber);
    try {
      const batch = writeBatch(firestore);
      const fireId = nanoid();
      const now = new Date().toISOString();
      const courseLabels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
      batch.set(doc(firestore, `tenants/${tenantId}/courseFires`, fireId), {
        id: fireId, eventId, tenantId, courseNumber,
        courseName: courseLabels[courseNumber] || `Course ${courseNumber}`,
        firedAt: now, firedBy: 'host_delta', guestCount: deltaGuests.length, status: 'fired', isDelta: true,
      });
      deltaGuests.forEach(guest => {
        const menuItemId = guest.courseSelections?.[courseNumber] || guest.mealChoiceId;
        const menuItem   = menuItems.find(m => m.id === menuItemId);
        const kdsId = nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/kdsTickets`, kdsId), {
          id: kdsId, source: 'event', eventId, eventTitle: event?.title || event?.name || '',
          courseFireId: fireId, courseNumber, guestId: guest.id, guestName: guest.name,
          seatNumber: guest.seatNumber || null, tableNumber: guest.tableNumber || null,
          menuItemId, menuItemName: menuItem?.name || 'Item',
          allergies: guest.allergies || [], allergyNote: guest.allergyNote || null,
          hasCriticalAllergy: (guest.allergies || []).some((a: any) => typeof a === 'object' && a.severity === 'critical'),
          notes: guest.guestNote || null, status: 'pending', createdAt: now, tenantId, isDelta: true,
        });
      });
      const deductionMap: Record<string, number> = {};
      deltaGuests.forEach(guest => {
        const menuItemId = guest.courseSelections?.[courseNumber] || guest.mealChoiceId;
        const menuItem   = menuItems.find(m => m.id === menuItemId);
        if (!menuItem?.supplies) return;
        menuItem.supplies.forEach((s: any) => {
          deductionMap[s.inventoryId] = (deductionMap[s.inventoryId] || 0) + safeNum(s.qty);
        });
      });
      Object.entries(deductionMap).forEach(([invId, qty]) => {
        const inv = (inventory || []).find((i: any) => i.id === invId);
        if (!inv) return;
        batch.update(doc(firestore, `tenants/${tenantId}/inventory`, invId), { totalStock: increment(-qty) });
        batch.set(doc(collection(firestore, `tenants/${tenantId}/stockCorrections`)), {
          id: nanoid(), productId: invId, productName: (inv as any).name, date: now, change: -qty,
          unit: (inv as any).unit || 'units', reason: `Event: ${event?.title || event?.name} — Course ${courseNumber} delta re-fire`,
          source: 'event_course_refire', eventId,
        });
      });
      await batch.commit();
      toast({ title: `Course ${courseNumber} re-fired`, description: `${deltaGuests.length} late arrival${deltaGuests.length !== 1 ? 's' : ''} sent to kitchen.` });
    } catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Re-fire failed' }); }
    finally { setIsRefiring(null); firingInProgress.current.delete(courseNumber); }
  };

  // ── Course firing ─────────────────────────────────────────────────────────
  const handleFireCourse = async (courseNumber: number) => {
    if (!firestore || !tenantId) return;
    if (firingInProgress.current.has(courseNumber)) { toast({ variant: 'destructive', title: 'Already firing this course' }); return; }
    if (firedCourses.has(courseNumber)) { toast({ variant: 'destructive', title: `Course ${courseNumber} already fired` }); return; }
    if (courseNumber > 1) {
      const unfiredPrev = courseNumbers.filter(n => n < courseNumber && !firedCourses.has(n));
      if (unfiredPrev.length > 0) {
        const ok = window.confirm(`Course ${unfiredPrev.join(', ')} has not been fired yet. Fire Course ${courseNumber} out of sequence?`);
        if (!ok) return;
      }
    }
    firingInProgress.current.add(courseNumber);
    setIsFiring(courseNumber);
    try {
      const existingFire = await getDocs(query(
        collection(firestore, `tenants/${tenantId}/courseFires`),
        where('eventId', '==', eventId), where('courseNumber', '==', courseNumber), where('status', '==', 'fired')
      ));
      if (existingFire.docs.some(d => !d.data().isDelta)) {
        toast({ variant: 'destructive', title: `Course ${courseNumber} was already fired`, description: 'Use the re-fire button for late arrivals.' });
        return;
      }
      const batch = writeBatch(firestore);
      const fireId = nanoid();
      const now = new Date().toISOString();
      const courseLabels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
      const guestsForCourse = guests.filter(g => g.checkedIn && (g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId)));
      if (guestsForCourse.length === 0) { toast({ variant: 'destructive', title: 'No checked-in guests', description: 'Check in seated guests before firing a course.' }); return; }
      const notCheckedIn = guests.filter(g => g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId)).length - guestsForCourse.length;
      batch.set(doc(firestore, `tenants/${tenantId}/courseFires`, fireId), {
        id: fireId, eventId, tenantId, courseNumber, courseName: courseLabels[courseNumber] || `Course ${courseNumber}`,
        firedAt: now, firedBy: 'host', guestCount: guestsForCourse.length, status: 'fired', isDelta: false,
      });
      guestsForCourse.forEach(guest => {
        const menuItemId = guest.courseSelections?.[courseNumber] || guest.mealChoiceId;
        const menuItem   = menuItems.find(m => m.id === menuItemId);
        const kdsId = nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/kdsTickets`, kdsId), {
          id: kdsId, source: 'event', eventId, eventTitle: event?.title || event?.name || '',
          courseFireId: fireId, courseNumber, guestId: guest.id, guestName: guest.name,
          seatNumber: guest.seatNumber || null, tableNumber: guest.tableNumber || null,
          menuItemId, menuItemName: menuItem?.name || 'Item',
          allergies: guest.allergies || [], allergyNote: guest.allergyNote || null,
          hasCriticalAllergy: (guest.allergies || []).some((a: any) => typeof a === 'object' && a.severity === 'critical'),
          notes: guest.guestNote || null, status: 'pending', createdAt: now, tenantId, isDelta: false,
        });
      });
      const deductionMap: Record<string, number> = {};
      guestsForCourse.forEach(guest => {
        const menuItemId = guest.courseSelections?.[courseNumber] || guest.mealChoiceId;
        const menuItem   = menuItems.find(m => m.id === menuItemId);
        if (!menuItem?.supplies) return;
        menuItem.supplies.forEach((s: any) => { deductionMap[s.inventoryId] = (deductionMap[s.inventoryId] || 0) + safeNum(s.qty); });
      });
      Object.entries(deductionMap).forEach(([invId, qty]) => {
        const inv = (inventory || []).find((i: any) => i.id === invId);
        if (!inv) return;
        batch.update(doc(firestore, `tenants/${tenantId}/inventory`, invId), { totalStock: increment(-qty) });
        batch.set(doc(collection(firestore, `tenants/${tenantId}/stockCorrections`)), {
          id: nanoid(), productId: invId, productName: (inv as any).name, date: now, change: -qty,
          unit: (inv as any).unit || 'units', reason: `Event: ${event?.title || event?.name} — Course ${courseNumber} fired`,
          source: 'event_course_fire', eventId,
        });
      });
      await batch.commit();
      toast({ title: `Course ${courseNumber} Fired`, description: notCheckedIn > 0 ? `${guestsForCourse.length} tickets sent. ${notCheckedIn} not yet checked in.` : `${guestsForCourse.length} tickets sent to kitchen.` });
    } catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Fire Failed' }); }
    finally { setIsFiring(null); firingInProgress.current.delete(courseNumber); }
  };

  // ── Guest actions ─────────────────────────────────────────────────────────
  const handleCheckInGuest = async (guestId: string, currentValue: boolean) => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, guestId), {
      checkedIn: !currentValue, checkedInAt: !currentValue ? new Date().toISOString() : null,
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
          ...guestForm, mealChoiceId: guestForm.mealChoiceId || null, mealChoiceName: mealItem?.name || null, updatedAt: new Date().toISOString(),
        });
        toast({ title: 'Guest Updated' });
      } else {
        const id = nanoid();
        await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
          id, eventId, tenantId, ...guestForm, mealChoiceId: guestForm.mealChoiceId || null, mealChoiceName: mealItem?.name || null,
          allergies: [], dietaryRestrictions: [], checkedIn: false, source: 'manual', submittedAt: new Date().toISOString(),
        });
        toast({ title: 'Guest Added' });
      }
    } finally {
      setSavingGuest(false); setIsAddingGuest(false); setEditingGuest(null);
      setGuestForm({ name: '', email: '', phone: '', tableNumber: '', seatNumber: '', mealChoiceId: '', notes: '' });
    }
  };

  const handleImportClient = async (client: any) => {
    if (!firestore || !tenantId) return;
    if (guests.find(g => g.clientId === client.id)) { toast({ variant: 'destructive', title: 'Already on guest list' }); return; }
    const id = nanoid();
    await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
      id, eventId, tenantId, name: client.name, email: client.email || '', phone: client.phone || '',
      tableNumber: '', seatNumber: '', mealChoiceId: null, mealChoiceName: null,
      allergies: [], dietaryRestrictions: [], checkedIn: false, source: 'client_import', clientId: client.id,
      submittedAt: new Date().toISOString(),
    });
    toast({ title: `${client.name} added to guest list` });
  };

  // ── Menu actions ──────────────────────────────────────────────────────────
  const resetMenuForm = () => {
    setNewMenuName(''); setNewMenuDesc(''); setNewMenuCourse(1); setNewMenuCategory('main');
    setNewMenuVegan(false); setNewMenuGF(false); setMenuSupplies([]);
    setNewMenuInventoryItemId(''); setNewMenuPortionSize(1); setNewMenuPrice(0);
    setInventorySearch(''); setIsAddingMenu(false);
  };

  const handleLinkInventoryItem = (invItem: any) => {
    setNewMenuInventoryItemId(invItem.id);
    // Auto-fill name and description if not already set
    if (!newMenuName) setNewMenuName(invItem.name || '');
    if (!newMenuDesc) setNewMenuDesc(invItem.description || '');
    // Auto-add as a supply with qty 1 if not already in list
    if (!menuSupplies.find(s => s.inventoryId === invItem.id)) {
      setMenuSupplies(prev => [...prev, { inventoryId: invItem.id, qty: 1 }]);
    }
  };

  const handleAddMenuItem = async () => {
    if (!newMenuName.trim() || !firestore || !tenantId) return;
    const id = nanoid();
    const batch = writeBatch(firestore);
    const linkedItem = newMenuInventoryItemId ? (inventory || []).find((i: any) => i.id === newMenuInventoryItemId) : null;
    const menuItem = {
      id, eventId, tenantId,
      name:            newMenuName.trim(),
      description:     newMenuDesc.trim() || null,
      category:        newMenuCategory,
      courseNumber:    newMenuCourse,
      isVegan:         newMenuVegan,
      isGlutenFree:    newMenuGF,
      inventoryItemId: newMenuInventoryItemId || null,
      portionSize:     newMenuPortionSize || 1,
      pricePerGuest:   newMenuPrice || 0,
      imageUrl:        (linkedItem as any)?.imageUrl || null,
      supplies:        menuSupplies.filter(s => s.inventoryId && s.qty > 0),
    };
    batch.set(doc(firestore, `tenants/${tenantId}/eventMenuItems`, id), menuItem);
    const eventRef  = doc(firestore, `tenants/${tenantId}/studioEvents`, eventId);
    const eventSnap = await getDoc(eventRef);
    const existingItems  = eventSnap.data()?.menuItems || [];
    const updatedItems   = [...existingItems.filter((m: any) => m.id !== id), menuItem];
    const courseMap      = new Map<number, any[]>();
    updatedItems.forEach((item: any) => {
      const n = item.courseNumber || 1;
      if (!courseMap.has(n)) courseMap.set(n, []);
      courseMap.get(n)!.push({ id: item.id, name: item.name, description: item.description, imageUrl: item.imageUrl });
    });
    const existingCourses = eventSnap.data()?.courses || [];
    const updatedCourses  = Array.from(courseMap.entries()).sort(([a], [b]) => a - b).map(([num, options]) => {
      const existing = existingCourses.find((c: any) => c.courseNumber === num);
      return { id: existing?.id || `course-${num}`, courseNumber: num, name: existing?.name || (num === 1 ? 'Starters' : num === 2 ? 'Mains' : num === 3 ? 'Desserts' : `Course ${num}`), note: existing?.note || null, options };
    });
    batch.update(eventRef, { menuItems: updatedItems, courses: updatedCourses });
    await batch.commit();
    resetMenuForm();
    toast({ title: 'Menu item added' });
  };

  const handleDeleteMenuItem = async (item: any) => {
    if (!firestore || !tenantId) return;
    const selectCount = guests.filter(g => g.mealChoiceId === item.id || Object.values(g.courseSelections || {}).includes(item.id)).length;
    if (selectCount > 0) {
      const ok = window.confirm(`${selectCount} guest${selectCount !== 1 ? 's have' : ' has'} selected "${item.name}". Deleting it will leave their meal choice blank. Are you sure?`);
      if (!ok) return;
      const batch = writeBatch(firestore);
      guests.filter(g => g.mealChoiceId === item.id).forEach(g => {
        batch.update(doc(firestore, `tenants/${tenantId}/eventGuests`, g.id), {
          mealChoiceId: null, mealChoiceName: null, mealClearedReason: `Menu item "${item.name}" was deleted`,
        });
      });
      await batch.commit();
    }
    await deleteDoc(doc(firestore, `tenants/${tenantId}/eventMenuItems`, item.id));
    toast({ title: `${item.name} removed${selectCount > 0 ? ` — ${selectCount} guest meal choice cleared` : ''}` });
  };

  const handleMealOverride = async () => {
    if (!mealOverrideGuest || !firestore || !tenantId) return;
    setSavingOverride(true);
    const resolvedId = mealOverrideId === NO_SELECTION ? null : mealOverrideId;
    const mealItem   = menuItems.find(m => m.id === resolvedId);
    await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, mealOverrideGuest.id), {
      mealChoiceId: resolvedId, mealChoiceName: mealItem?.name || null,
      mealOverriddenAt: new Date().toISOString(), mealOverriddenBy: 'staff',
    });
    setSavingOverride(false); setMealOverrideGuest(null); setMealOverrideId('');
    toast({ title: `Meal updated for ${mealOverrideGuest.name}` });
  };

  // ── Staff actions ─────────────────────────────────────────────────────────
  const handleAddStaff = async () => {
    if (!staffToAdd || !firestore || !tenantId) return;
    const current = event?.assignedStaffIds || [];
    if (current.includes(staffToAdd)) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { assignedStaffIds: [...current, staffToAdd] });
    setStaffToAdd(''); toast({ title: 'Staff assigned' });
  };

  const handleRemoveStaff = async (staffId: string) => {
    if (!firestore || !tenantId) return;
    const current = event?.assignedStaffIds || [];
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { assignedStaffIds: current.filter((id: string) => id !== staffId) });
    toast({ title: 'Staff removed' });
  };

  // ── Event lifecycle ───────────────────────────────────────────────────────
  const handleActivateEvent = async () => {
    if (!firestore || !tenantId) return;
    setActivatingNow(true);
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { status: 'active', activatedAt: new Date().toISOString(), activatedBy: 'host' });
      setIsConfirmActivateOpen(false); setUndoWindowOpen(true); setUndoCountdown(120);
      const interval = setInterval(() => { setUndoCountdown(prev => { if (prev <= 1) { clearInterval(interval); setUndoWindowOpen(false); return 0; } return prev - 1; }); }, 1000);
      toast({ title: '🟢 Event is now live', description: 'Kiosk has switched to event mode.' });
    } catch { toast({ variant: 'destructive', title: 'Activation failed' }); }
    finally { setActivatingNow(false); }
  };

  const handleDeactivateEvent = async () => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { status: 'upcoming', activatedAt: null, activatedBy: null });
    setUndoWindowOpen(false); toast({ title: 'Event deactivated', description: 'Kiosk returned to normal mode.' });
  };

  const handleEndEvent = () => setIsEndEventOpen(true);

  const handleConfirmEndEvent = async () => {
    if (!firestore || !tenantId) return;
    const now = new Date().toISOString();
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { status: 'completed', endedAt: now });
    const assignedStaffIds: string[] = event?.assignedStaffIds || [];
    assignedStaffIds.forEach(staffId => {
      const nRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      batch.set(nRef, {
        id: nRef.id, userId: staffId, type: 'event_ended',
        message: `${eventDisplayName} has ended. Thank you for your service tonight!`,
        link: `/events/${eventId}/reconciliation`, eventId, eventName: eventDisplayName,
        createdAt: now, read: false,
      });
    });
    await batch.commit();
    setIsEndEventOpen(false);
    toast({ title: 'Event complete', description: assignedStaffIds.length > 0 ? `${assignedStaffIds.length} staff member${assignedStaffIds.length !== 1 ? 's' : ''} notified.` : undefined });
  };

  const handleExportCSV = () => {
    const rows = [
      ['Name', 'Email', 'Phone', 'Table', 'Seat', 'Meal Choice', 'Allergies', 'Dietary', 'Notes', 'Checked In'],
      ...guests.map(g => [
        g.name, g.email || '', g.phone || '', g.tableNumber || '', g.seatNumber || '', g.mealChoiceName || '',
        (g.allergies || []).map((a: any) => typeof a === 'object' ? a.label : a).join('; '),
        (g.dietaryRestrictions || []).join('; '), g.notes || '', g.checkedIn ? 'Yes' : 'No',
      ])
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${event?.title || event?.name || 'event'}-manifest.csv`;
    a.click();
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader className="animate-spin w-8 h-8 text-slate-400" /></div>;
  if (!event)  return <div className="flex h-screen items-center justify-center text-slate-400 font-bold">Event not found</div>;

  const eventDisplayName   = event.title || event.name || 'Untitled Event';
  const courseLabels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
  const assignedStaffCount = (event?.assignedStaffIds || []).length;
  const currentBroadcast   = event?.broadcastMessage && !event?.broadcastDismissed ? event.broadcastMessage : null;
  const linkedInvItem      = newMenuInventoryItemId ? (inventory || []).find((i: any) => i.id === newMenuInventoryItemId) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <AppHeader title={`${eventDisplayName} — Manifest`} />
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 pb-24">

        {/* ── HEADER ── */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">{eventDisplayName}</h1>
            {event.date  && <p className="text-sm text-slate-500 mt-1">{format(new Date(event.date), 'EEEE, MMMM d, yyyy')}</p>}
            {event.venue && <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{event.venue}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {event?.status === 'active' ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 font-black uppercase text-[9px] tracking-widest">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live
                </span>
                <Button variant="outline" onClick={handleEndEvent} className="h-9 px-3 rounded-xl border-2 border-slate-200 font-black uppercase text-[9px] tracking-widest">End Event</Button>
              </div>
            ) : event?.status === 'completed' ? (
              <span className="px-3 py-1.5 rounded-xl bg-slate-100 border-2 border-slate-200 text-slate-500 font-black uppercase text-[9px] tracking-widest">Completed</span>
            ) : (
              <Button onClick={() => setIsConfirmActivateOpen(true)}
                className="h-10 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200">
                <span className="w-2 h-2 rounded-full bg-white" /> Go Live
              </Button>
            )}
            {event?.status === 'active' && (
              <Button variant="outline" onClick={() => setShowBroadcast(s => !s)}
                className={cn('h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2',
                  currentBroadcast ? 'border-violet-300 bg-violet-50 text-violet-700' : '')}>
                <Megaphone className="w-4 h-4" /> {currentBroadcast ? 'Broadcasting' : 'Broadcast'}
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowLink(!showLink)} className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2"><Link2 className="w-4 h-4" /> Guest Link</Button>
            <Button variant="outline" onClick={handleExportCSV} className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2"><Download className="w-4 h-4" /> Export CSV</Button>
            <Button variant="outline" onClick={() => router.push(`/events/${eventId}/reconciliation`)} className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2"><BarChart2 className="w-4 h-4" /> Post-Event Report</Button>
          </div>
        </div>

        {/* ── BROADCAST PANEL ── */}
        <AnimatePresence>
          {showBroadcast && event?.status === 'active' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <BroadcastPanel eventId={eventId} tenantId={tenantId} firestore={firestore} assignedStaffCount={assignedStaffCount} currentBroadcast={currentBroadcast} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── UNDO WINDOW ── */}
        <AnimatePresence>
          {undoWindowOpen && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <div>
                  <p className="font-black text-sm text-emerald-800">Event is now live — kiosk switched to event mode</p>
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Undo available for {undoCountdown}s</p>
                </div>
              </div>
              <Button onClick={handleDeactivateEvent} variant="outline"
                className="h-9 px-4 rounded-xl border-2 border-emerald-300 font-black uppercase text-[9px] tracking-widest text-emerald-700 hover:bg-emerald-100 shrink-0">Undo</Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── FLOOR REQUESTS ── */}
        <FloorRequestPanel requests={floorRequests} onResolve={handleResolveFloorRequest} tenantId={tenantId} />

        {/* ── DELTA RE-FIRE BANNERS ── */}
        <AnimatePresence>
          {Object.entries(deltaGuestsByCourse).map(([courseNumStr, deltaGuests]) => {
            const n = Number(courseNumStr);
            return <DeltaRefireBanner key={n} courseNumber={n} courseName={courseLabels[n] || `Course ${n}`} deltaGuests={deltaGuests} onRefire={handleRefireDelta} isFiring={isRefiring === n} />;
          })}
        </AnimatePresence>

        {/* ── MEAL OVERRIDE SHEET ── */}
        <AnimatePresence>
          {mealOverrideGuest && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm p-4"
              onClick={() => setMealOverrideGuest(null)}>
              <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-md bg-white rounded-3xl border-2 border-slate-200 shadow-2xl overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Override Meal Choice</p>
                  <p className="font-black text-lg text-slate-900 mt-0.5">{mealOverrideGuest.name}</p>
                  <p className="text-[10px] text-slate-400 font-bold">Current: {mealOverrideGuest.mealChoiceName || 'No selection'}{mealOverrideGuest.tableNumber && ` · Table ${mealOverrideGuest.tableNumber}`}</p>
                </div>
                <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                  {menuItems.map(item => (
                    <button key={item.id} onClick={() => setMealOverrideId(item.id)}
                      className={cn('w-full flex items-center justify-between p-3 rounded-2xl border-2 transition-all text-left', mealOverrideId === item.id ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300')}>
                      <div><p className="font-black text-sm text-slate-900">{item.name}</p>{item.description && <p className="text-[10px] text-slate-400">{item.description}</p>}</div>
                      {mealOverrideId === item.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
                <div className="p-4 flex gap-3 border-t border-slate-100">
                  <Button variant="outline" onClick={() => setMealOverrideGuest(null)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                  <Button onClick={handleMealOverride} disabled={savingOverride || !mealOverrideId} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                    {savingOverride ? <Loader className="w-4 h-4 animate-spin" /> : 'Save Override →'}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── CONFIRM ACTIVATION DIALOG ── */}
        <Dialog open={isConfirmActivateOpen} onOpenChange={setIsConfirmActivateOpen}>
          <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
            <DialogHeader className="p-6 pb-0">
              <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500" /> Go Live — Activate Event
              </DialogTitle>
            </DialogHeader>
            <div className="p-6 space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200 space-y-2">
                <p className="font-black text-emerald-800">{eventDisplayName}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">{stats.checkedIn} of {stats.total} guests checked in</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-bold text-slate-700">This will immediately:</p>
                <ul className="space-y-1.5">
                  {['Switch the walk-in kiosk to event floor-service mode', 'Hide food ordering for any guest scanning in', 'Route all kiosk requests to the floor staff view', 'Cannot be undone after 2 minutes'].map(item => (
                    <li key={item} className="flex items-start gap-2 text-[11px] text-slate-600"><span className="text-emerald-500 font-black mt-0.5">✓</span> {item}</li>
                  ))}
                </ul>
              </div>
              {stats.notCheckedIn > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">⚠ {stats.notCheckedIn} guest{stats.notCheckedIn !== 1 ? 's have' : ' has'} not checked in yet</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setIsConfirmActivateOpen(false)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                <Button onClick={handleActivateEvent} disabled={activatingNow} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-200 gap-2">
                  {activatingNow ? <Loader className="w-4 h-4 animate-spin" /> : '🟢 Activate Event'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── END EVENT DIALOG ── */}
        <Dialog open={isEndEventOpen} onOpenChange={setIsEndEventOpen}>
          <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
            <DialogHeader className="p-6 pb-0">
              <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-slate-400" /> End Event
              </DialogTitle>
            </DialogHeader>
            <div className="p-6 space-y-4">
              {(unfiredCourses.length > 0 || floorRequests.length > 0) && (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-slate-700">Before you end the event:</p>
                  {unfiredCourses.length > 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">{unfiredCourses.length} Course{unfiredCourses.length !== 1 ? 's' : ''} Not Fired</p>
                        <p className="text-[10px] font-bold text-amber-600 mt-0.5">{unfiredCourses.map(n => courseLabels[n] || `Course ${n}`).join(', ')} — kitchen has not received tickets</p>
                      </div>
                    </div>
                  )}
                  {floorRequests.length > 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                      <Bell className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">{floorRequests.length} Unresolved Floor Request{floorRequests.length !== 1 ? 's' : ''}</p>
                        <p className="text-[10px] font-bold text-amber-600 mt-0.5">Guests are still waiting on pending requests</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {unfiredCourses.length === 0 && floorRequests.length === 0 && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">All Clear</p>
                    <p className="text-[10px] font-bold text-emerald-600 mt-0.5">All courses fired, no pending requests</p>
                  </div>
                </div>
              )}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Event Summary</p>
                <p className="font-black text-slate-900">{eventDisplayName}</p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  {stats.checkedIn} of {stats.total} guests attended · {fires.filter(f => f.status === 'fired' && !f.isDelta).length} of {courseNumbers.length} courses fired
                </p>
              </div>
              {assignedStaffCount > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-violet-50 border border-violet-200">
                  <Bell className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] font-bold text-violet-700">{assignedStaffCount} staff member{assignedStaffCount !== 1 ? 's' : ''} will receive an in-app notification that the event has ended.</p>
                </div>
              )}
              <p className="text-[10px] text-slate-400 font-bold leading-relaxed">Ending the event marks it complete and reverts the kiosk to normal walk-in mode.</p>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setIsEndEventOpen(false)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                <Button onClick={handleConfirmEndEvent} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-slate-800 hover:bg-slate-900 gap-2">End Event →</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── SHAREABLE LINK ── */}
        <AnimatePresence>
          {showLink && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="bg-white rounded-2xl border-2 border-primary/20 p-5 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guest Order Link — Share this before the event</p>
              <div className="flex items-center gap-3">
                <code className="flex-1 text-xs font-bold bg-slate-50 rounded-xl px-4 py-3 border-2 border-slate-200 truncate text-slate-700">{shareableLink}</code>
                <Button onClick={copyLink} className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shrink-0"><Copy className="w-4 h-4" /> Copy</Button>
              </div>
              <div className="mt-4 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Generate Per-Seat QR Codes</p>
                <div className="flex items-center gap-3">
                  <Input placeholder="Tables (e.g. 1,2,3)" value={qrTables} onChange={e => setQrTables(e.target.value)} className="h-10 rounded-xl border-2 flex-1" />
                  <Input placeholder="Seats per table (e.g. 4)" value={qrSeatsPerTable} onChange={e => setQrSeatsPerTable(e.target.value)} className="h-10 rounded-xl border-2 w-48" />
                  <Button onClick={handleGenerateQRs} className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shrink-0"><QrCode className="w-4 h-4" /> Generate</Button>
                </div>
                {qrCodes.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{qrCodes.length} QR codes</p>
                      <Button onClick={handlePrintQRs} variant="outline" className="h-8 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest gap-1"><Printer className="w-3 h-3" /> Print All</Button>
                    </div>
                    <div className="grid grid-cols-4 gap-3 max-h-64 overflow-y-auto" id="qr-print-area">
                      {qrCodes.map(qr => (
                        <div key={qr.label} className="flex flex-col items-center gap-1 p-3 border-2 rounded-xl bg-white">
                          <img src={qr.dataUrl} alt={qr.label} className="w-16 h-16" />
                          <p className="text-[8px] font-black uppercase text-slate-600 text-center">{qr.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── STATS ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Responses" value={stats.total} sub={`${stats.checkedIn} checked in`} />
          <StatCard label="Allergy Flags" value={stats.allergyCount} sub={stats.uniqueAllergies.slice(0, 2).join(', ') || 'None'} color="amber" />
          {Object.entries(stats.mealCounts).slice(0, 2).map(([meal, count]) => (
            <StatCard key={meal} label={meal} value={count} sub={`${Math.round(count / Math.max(stats.total, 1) * 100)}%`} color="emerald" />
          ))}
        </div>

        {/* ── CROSS-CONTAMINATION WARNINGS ── */}
        {crossContaminationWarnings.length > 0 && (
          <div className="bg-red-50 rounded-2xl border-2 border-red-300 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-red-800">Cross-Contamination Risk — {crossContaminationWarnings.length} Table{crossContaminationWarnings.length !== 1 ? 's' : ''}</h2>
            </div>
            <div className="space-y-2">
              {crossContaminationWarnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-white border border-red-200">
                  <span className="text-red-500 font-black text-sm shrink-0">T{w.table}</span>
                  <p className="text-[11px] font-bold text-red-700">{w.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── INVENTORY FORECAST ── */}
        {forecast.length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
            <button onClick={() => setShowForecast(!showForecast)} className="w-full p-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Supply Forecast</h2>
                <Badge className={cn('ml-1 font-black text-[9px]',
                  forecast.some(f => f.status === 'critical') ? 'bg-red-100 text-red-700 border-red-200' :
                  forecast.some(f => f.status === 'low')      ? 'bg-amber-100 text-amber-700 border-amber-200' :
                  'bg-emerald-100 text-emerald-700 border-emerald-200')}>
                  {forecast.some(f => f.status === 'critical') ? '⚠ Shortage' : forecast.some(f => f.status === 'low') ? '⚠ Low Stock' : '✓ Covered'}
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
                        item.status === 'critical' ? 'border-red-200 bg-red-50' : item.status === 'low' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50')}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-black text-sm text-slate-900">{item.name}</p>
                            <p className="text-[10px] font-bold text-slate-500 mt-0.5 uppercase">Need: {item.needed} {item.unit} · Have: {item.inStock} {item.unit}</p>
                          </div>
                          {item.status === 'ok' ? <PackageCheck className="w-5 h-5 text-emerald-500 shrink-0" /> : <PackageX className="w-5 h-5 text-red-500 shrink-0" />}
                        </div>
                        {item.status !== 'ok' && (
                          <p className={cn('text-[10px] font-black uppercase tracking-widest mt-2', item.status === 'critical' ? 'text-red-600' : 'text-amber-600')}>
                            {item.status === 'critical' ? `Short by ${Math.abs(item.remaining)} ${item.unit} — reorder needed` : `Only ${item.remaining} ${item.unit} buffer — running low`}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── COURSE FIRING ── */}
        {courseNumbers.length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2"><Utensils className="w-4 h-4 text-primary" /> Course Firing</h2>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {courseNumbers.map(n => {
                const fired = firedCourses.has(n);
                const count = guests.filter(g => g.courseSelections?.[n] || (n === 1 && g.mealChoiceId)).length;
                const deltaCount = deltaGuestsByCourse[n]?.length || 0;
                return (
                  <div key={n} className={cn('p-4 rounded-2xl border-2', fired ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Course {n}</p>
                        <p className="font-black text-slate-900 text-sm">{courseLabels[n] || `Course ${n}`}</p>
                        <p className="text-[10px] text-slate-500">{count} guests</p>
                        {fired && deltaCount > 0 && <p className="text-[9px] font-black text-indigo-600 mt-0.5">+{deltaCount} new arrival{deltaCount !== 1 ? 's' : ''}</p>}
                      </div>
                      {fired && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
                    </div>
                    <Button onClick={() => handleFireCourse(n)} disabled={!!isFiring || fired || count === 0}
                      className={cn('w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2', fired ? 'bg-emerald-500 hover:bg-emerald-500 opacity-60 cursor-not-allowed' : 'shadow-lg shadow-primary/20')}>
                      {isFiring === n ? <Loader className="w-4 h-4 animate-spin" /> : fired ? <><CheckCircle2 className="w-4 h-4" /> Fired</> : <><Play className="w-4 h-4" /> Fire Course</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── MAIN TABS ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-11 rounded-2xl border-2 bg-slate-100 p-1 gap-1">
            <TabsTrigger value="guests" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-sm px-5">Guests ({guests.length})</TabsTrigger>
            <TabsTrigger value="menu"   className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-sm px-5">Menu ({menuItems.length})</TabsTrigger>
            <TabsTrigger value="staff"  className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-sm px-5">Staff</TabsTrigger>
          </TabsList>

          {/* ── GUESTS TAB ── */}
          <TabsContent value="guests" className="mt-4 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => { setIsAddingGuest(true); setEditingGuest(null); setGuestForm({ name: '', email: '', phone: '', tableNumber: '', seatNumber: '', mealChoiceId: '', notes: '' }); }}
                className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg shadow-primary/20">
                <UserPlus className="w-4 h-4" /> Add Guest
              </Button>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search guests…" className="pl-8 h-10 w-48 rounded-xl border-2 text-xs font-bold" />
              </div>
              <Select value={filterMeal} onValueChange={setFilterMeal}>
                <SelectTrigger className="h-10 w-36 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue placeholder="All meals" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Meals</SelectItem>
                  {menuItems.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterFlag} onValueChange={setFilterFlag}>
                <SelectTrigger className="h-10 w-40 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue placeholder="All guests" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guests</SelectItem>
                  <SelectItem value="not-checked-in">Not Checked In</SelectItem>
                  <SelectItem value="checked-in">Checked In</SelectItem>
                  <SelectItem value="allergies">Has Allergy</SelectItem>
                  <SelectItem value="dietary">Dietary Req.</SelectItem>
                </SelectContent>
              </Select>
              {stats.notCheckedIn > 0 && filterFlag !== 'not-checked-in' && (
                <button onClick={() => setFilterFlag('not-checked-in')}
                  className="flex items-center gap-1.5 h-10 px-3 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-700 font-black uppercase text-[9px] tracking-widest hover:bg-amber-100 transition-all">
                  <AlertTriangle className="w-3 h-3" /> {stats.notCheckedIn} Not In
                </button>
              )}
            </div>

            {/* Add / edit guest form */}
            <AnimatePresence>
              {(isAddingGuest || editingGuest) && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="bg-white rounded-2xl border-2 border-primary/20 overflow-hidden">
                  <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-black uppercase tracking-tight text-slate-900">{editingGuest ? 'Edit Guest' : 'Add Guest'}</h3>
                      {!editingGuest && <Input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Import from client log…" className="h-9 w-52 rounded-xl border-2 text-xs font-bold" />}
                    </div>
                    {!editingGuest && clientSearch && filteredClients.length > 0 && (
                      <div className="rounded-xl border-2 divide-y overflow-hidden">
                        {filteredClients.map((c: any) => (
                          <button key={c.id} onClick={() => { handleImportClient(c); setClientSearch(''); }}
                            className="w-full flex items-center justify-between p-3 hover:bg-primary/5 transition-colors text-left gap-3">
                            <div><p className="font-black text-sm text-slate-900">{c.name}</p><p className="text-[10px] text-slate-400">{c.email} · {c.phone}</p></div>
                            <Badge className="bg-primary/10 text-primary border-primary/20 font-black text-[9px] shrink-0">Import</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Name *</Label><Input value={guestForm.name} onChange={e => setGuestForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Email</Label><Input value={guestForm.email} onChange={e => setGuestForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Phone</Label><Input value={guestForm.phone} onChange={e => setGuestForm(p => ({ ...p, phone: e.target.value }))} placeholder="(555) 000-0000" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Meal Choice</Label>
                        <Select value={guestForm.mealChoiceId || NO_SELECTION} onValueChange={v => setGuestForm(p => ({ ...p, mealChoiceId: v === NO_SELECTION ? '' : v }))}>
                          <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue placeholder="Select meal…" /></SelectTrigger>
                          <SelectContent><SelectItem value={NO_SELECTION}>No selection</SelectItem>{menuItems.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Table</Label><Input value={guestForm.tableNumber} onChange={e => setGuestForm(p => ({ ...p, tableNumber: e.target.value }))} placeholder="Table #" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Seat</Label><Input value={guestForm.seatNumber} onChange={e => setGuestForm(p => ({ ...p, seatNumber: e.target.value }))} placeholder="Seat #" className="h-11 rounded-xl border-2" /></div>
                    </div>
                    <div className="flex gap-3">
                      <Button onClick={() => { setIsAddingGuest(false); setEditingGuest(null); }} variant="outline" className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                      <Button onClick={handleSaveGuest} disabled={savingGuest || !guestForm.name.trim()} className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
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
                      {['Guest','Seat','Meal','Flags','Status',''].map(h => <th key={h} className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map(guest => (
                      <tr key={guest.id} className={cn('hover:bg-slate-50/50 transition-colors', !guest.checkedIn && filterFlag === 'not-checked-in' && 'bg-amber-50/30')}>
                        <td className="px-4 py-3">
                          <p className="font-black text-sm text-slate-900">{guest.name}</p>
                          <p className="text-[10px] text-slate-400">{guest.email || ''}{guest.phone ? ` · ${guest.phone}` : ''}</p>
                          {guest.hasCriticalAllergy && <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5 mt-0.5"><AlertTriangle className="w-2.5 h-2.5" /> Critical Allergy</span>}
                          {guest.mealClearedReason && <span className="text-[8px] font-bold text-amber-600 block mt-0.5">⚠ Meal cleared — needs reselection</span>}
                          {guest.source === 'client_import' && <span className="text-[8px] font-black uppercase tracking-widest text-primary opacity-60 block mt-0.5">From client log</span>}
                        </td>
                        <td className="px-4 py-3">
                          {guest.tableNumber && <span className="text-[10px] font-black uppercase text-slate-500">T{guest.tableNumber}</span>}
                          {guest.seatNumber   && <span className="text-[10px] font-black uppercase text-slate-400"> · {guest.seatNumber}</span>}
                        </td>
                        <td className="px-4 py-3"><p className="text-sm font-bold text-slate-700">{guest.mealChoiceName || <span className="text-slate-300 italic text-xs">—</span>}</p></td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(guest.allergies || []).map((a: any, i: number) => <AllergyPill key={i} allergy={a} />)}
                            {(guest.dietaryRestrictions || []).map((d: string) => (
                              <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border bg-emerald-50 border-emerald-200 text-emerald-700"><Leaf className="w-2 h-2" /> {d}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleCheckInGuest(guest.id, guest.checkedIn)}
                            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest transition-all',
                              guest.checkedIn ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-primary/30 hover:text-primary')}>
                            {guest.checkedIn ? <><UserCheck className="w-3 h-3" /> In</> : <><UserPlus className="w-3 h-3" /> Check In</>}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setMealOverrideGuest(guest); setMealOverrideId(guest.mealChoiceId || ''); }} title="Override meal" className="p-1.5 rounded-lg hover:bg-primary/10 text-slate-400 hover:text-primary transition-colors"><Utensils className="w-3.5 h-3.5" /></button>
                            <button onClick={() => { setEditingGuest(guest); setIsAddingGuest(false); setGuestForm({ name: guest.name, email: guest.email || '', phone: guest.phone || '', tableNumber: guest.tableNumber || '', seatNumber: guest.seatNumber || '', mealChoiceId: guest.mealChoiceId || '', notes: guest.notes || '' }); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteGuest(guest.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
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
          <TabsContent value="menu" className="mt-4 space-y-5">
            {menuItems.length > 0 && (
              <div className="space-y-2">
                {menuItems.map(item => {
                  const selectionCount = guests.filter(g => g.mealChoiceId === item.id || Object.values(g.courseSelections || {}).includes(item.id)).length;
                  return (
                    <div key={item.id} className="bg-white rounded-2xl border-2 border-slate-200 p-4 flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-200" />}
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-black text-slate-900">{item.name}</p>
                            <Badge className="bg-slate-100 text-slate-500 border-slate-200 font-black text-[8px]">Course {item.courseNumber}</Badge>
                            {item.isVegan      && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black text-[8px]">Vegan</Badge>}
                            {item.isGlutenFree && <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-black text-[8px]">GF</Badge>}
                          </div>
                          {item.description && <p className="text-[10px] text-slate-500 mt-0.5">{item.description}</p>}
                          {(item.supplies || []).length > 0 && (
                            <p className="text-[9px] text-slate-400 mt-0.5">
                              <Package className="w-2.5 h-2.5 inline mr-0.5" />
                              {item.supplies.length} supply item{item.supplies.length !== 1 ? 's' : ''} linked
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={cn('font-black text-[9px]', selectionCount > 0 ? 'bg-primary/10 text-primary border-primary/20' : 'bg-slate-50 text-slate-400 border-slate-200')}>{selectionCount} selected</Badge>
                        <button onClick={() => handleDeleteMenuItem(item)}
                          className={cn('p-1.5 rounded-lg transition-colors', selectionCount > 0 ? 'hover:bg-amber-50 text-amber-400 hover:text-amber-600' : 'hover:bg-red-50 text-slate-300 hover:text-red-400')}
                          title={selectionCount > 0 ? `${selectionCount} guests selected this` : 'Delete item'}>
                          {selectionCount > 0 ? <ShieldAlert className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── ADD MENU ITEM FORM ── */}
            <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
              <button onClick={() => setIsAddingMenu(!isAddingMenu)} className="w-full p-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /><span className="font-black uppercase text-sm tracking-tight text-slate-900">Add Menu Item</span></div>
                {isAddingMenu ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>
              <AnimatePresence>
                {isAddingMenu && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-slate-100">
                    <div className="p-5 space-y-5">

                      {/* ── REFRESHMENT LIBRARY PICKER ── */}
                      <div className="space-y-2">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                          Link from Refreshment Library (optional)
                        </Label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                          <input
                            value={inventorySearch}
                            onChange={e => setInventorySearch(e.target.value)}
                            placeholder="Search refreshments, supplies…"
                            className="w-full h-10 rounded-xl border-2 border-slate-200 pl-8 pr-3 text-sm font-bold text-slate-900 placeholder:text-slate-400 outline-none focus:border-primary transition-colors"
                          />
                        </div>
                        {/* Linked item badge */}
                        {linkedInvItem && (
                          <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/5 border-2 border-primary/20">
                            {(linkedInvItem as any).imageUrl && (
                              <img src={(linkedInvItem as any).imageUrl} alt={(linkedInvItem as any).name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-black text-sm text-slate-900 truncate">{(linkedInvItem as any).name}</p>
                              <p className="text-[9px] font-bold text-slate-500 uppercase">{(linkedInvItem as any).unit || 'units'} · Stock: {safeNum((linkedInvItem as any).totalStock)}</p>
                            </div>
                            <button onClick={() => { setNewMenuInventoryItemId(''); setMenuSupplies(prev => prev.filter(s => s.inventoryId !== newMenuInventoryItemId)); }}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {/* Inventory grid */}
                        {!linkedInvItem && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                            {filteredInventory.length === 0 ? (
                              <p className="col-span-3 text-center text-[10px] font-bold text-slate-400 py-4 uppercase tracking-widest">
                                {(inventory || []).length === 0 ? 'No inventory items yet' : 'No results'}
                              </p>
                            ) : (
                              filteredInventory.map((inv: any) => (
                                <button key={inv.id} onClick={() => handleLinkInventoryItem(inv)}
                                  className="flex items-center gap-2 p-2.5 rounded-xl border-2 border-slate-200 hover:border-primary/40 hover:bg-primary/5 transition-all text-left">
                                  {inv.imageUrl
                                    ? <img src={inv.imageUrl} alt={inv.name} className="w-8 h-8 rounded-lg object-cover shrink-0 border border-slate-200" />
                                    : <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0"><Package className="w-4 h-4 text-slate-400" /></div>
                                  }
                                  <div className="min-w-0">
                                    <p className="font-black text-[11px] text-slate-900 truncate">{inv.name}</p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase">{inv.unit || 'units'} · {safeNum(inv.totalStock)}</p>
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      <div className="border-t border-slate-100 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Item Name *</Label>
                          <Input value={newMenuName} onChange={e => setNewMenuName(e.target.value)} placeholder="e.g. Pan-Seared Salmon" className="h-12 rounded-xl border-2" />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Description (shown to guests)</Label>
                          <Input value={newMenuDesc} onChange={e => setNewMenuDesc(e.target.value)} placeholder="e.g. With lemon butter and asparagus" className="h-12 rounded-xl border-2" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Course</Label>
                          <Select value={String(newMenuCourse)} onValueChange={v => setNewMenuCourse(Number(v))}>
                            <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Starter</SelectItem>
                              <SelectItem value="2">Main</SelectItem>
                              <SelectItem value="3">Dessert</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Price per guest ($)</Label>
                          <Input type="number" min="0" step="0.01" value={newMenuPrice} onChange={e => setNewMenuPrice(parseFloat(e.target.value) || 0)} className="h-12 rounded-xl border-2 font-bold text-center" />
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

                        {/* Supply quantities if inventory linked */}
                        {menuSupplies.length > 0 && (
                          <div className="sm:col-span-2 space-y-2">
                            <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Supply Quantities (deducted per guest when course fires)</Label>
                            {menuSupplies.map((s, idx) => {
                              const inv = (inventory || []).find((i: any) => i.id === s.inventoryId);
                              if (!inv) return null;
                              return (
                                <div key={s.inventoryId} className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-200 bg-slate-50">
                                  <p className="flex-1 font-black text-sm text-slate-900">{(inv as any).name}</p>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number" min="0.1" step="0.1" value={s.qty}
                                      onChange={e => setMenuSupplies(prev => prev.map((sp, i) => i === idx ? { ...sp, qty: parseFloat(e.target.value) || 1 } : sp))}
                                      className="w-20 h-9 rounded-xl border-2 text-center font-bold text-sm"
                                    />
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">{(inv as any).unit || 'units'}</span>
                                  </div>
                                  <button onClick={() => setMenuSupplies(prev => prev.filter((_, i) => i !== idx))} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-3 pt-1">
                        <Button onClick={resetMenuForm} variant="outline" className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                        <Button onClick={handleAddMenuItem} disabled={!newMenuName.trim()} className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">Add Item →</Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {menuItems.length === 0 && !isAddingMenu && (
              <div className="text-center py-10 border-2 border-dashed rounded-3xl">
                <Utensils className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="font-black uppercase text-[10px] tracking-widest text-slate-400">No menu items yet</p>
              </div>
            )}
          </TabsContent>

          {/* ── STAFF TAB ── */}
          <TabsContent value="staff" className="mt-4 space-y-4">
            <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Assigned Staff</h2>
              </div>
              <div className="p-5 space-y-3">
                {(event?.assignedStaffIds || []).length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed rounded-2xl"><p className="font-black uppercase text-[10px] tracking-widest text-slate-400">No staff assigned yet</p></div>
                )}
                {(event?.assignedStaffIds || []).map((staffId: string) => {
                  const member = (staffFromContext || []).find((s: any) => s.id === staffId);
                  if (!member) return null;
                  return (
                    <div key={staffId} className="flex items-center justify-between p-3 rounded-2xl border-2 border-slate-200">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center font-black text-primary text-sm">{(member as any).name?.charAt(0)}</div>
                        <div><p className="font-black text-sm text-slate-900">{(member as any).name}</p><p className="text-[9px] font-bold uppercase text-slate-400">{(member as any).role}</p></div>
                      </div>
                      <button onClick={() => handleRemoveStaff(staffId)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
                <div className="pt-2 space-y-2">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Add Staff Member</Label>
                  <div className="flex gap-2">
                    <Select value={staffToAdd || NO_SELECTION} onValueChange={v => setStaffToAdd(v === NO_SELECTION ? '' : v)}>
                      <SelectTrigger className="flex-1 h-11 rounded-xl border-2 font-bold text-sm"><SelectValue placeholder="Select staff member…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SELECTION}>Select staff member…</SelectItem>
                        {(staffFromContext || []).filter((s: any) => !(event?.assignedStaffIds || []).includes(s.id)).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button onClick={handleAddStaff} disabled={!staffToAdd || staffToAdd === NO_SELECTION} className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg shadow-primary/20"><Plus className="w-4 h-4" /> Assign</Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}