// src/app/floor/[tenantId]/page.tsx
'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where, updateDoc, setDoc } from 'firebase/firestore';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle2, Bell, AlertTriangle, Loader, Droplets, Utensils,
  Package, Accessibility, MessageSquare, WifiOff, LayoutGrid, UserCheck,
} from 'lucide-react';
import { nanoid } from 'nanoid';

const safeDate = (v: any) => v?.toDate?.() ?? (typeof v === 'string' ? parseISO(v) : new Date(v));

// ─── TYPES ────────────────────────────────────────────────────────────────────
type FloorRequest = {
  id: string;
  tenantId: string;
  type: string;
  label: string;
  status: 'new' | 'acknowledged' | 'done';
  tableNumber?: string;
  seatNumber?: string;
  guestName?: string;
  guestAllergies?: any[];
  requestText?: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  assignedStaffId?: string;
  source?: string;
  _pending?: boolean; // optimistic — not yet synced
};

const FLOOR_REQUEST_TYPES = [
  { type: 'water', label: 'Water Refill', icon: '💧' },
  { type: 'napkins', label: 'Napkins', icon: '🧻' },
  { type: 'condiments', label: 'Condiments', icon: '🧂' },
  { type: 'utensils', label: 'Extra Utensils', icon: '🍴' },
  { type: 'ice', label: 'Ice', icon: '🧊' },
  { type: 'accessibility', label: 'Accessibility', icon: '♿' },
  { type: 'temperature', label: 'Temperature', icon: '🌡️' },
  { type: 'cleaning', label: 'Spill / Cleanup', icon: '🧹' },
  { type: 'other', label: 'Other', icon: '💬' },
];

const typeIcon = (type: string) => {
  const map: Record<string, React.ReactNode> = {
    water: <Droplets className="w-5 h-5" />,
    napkins: <Package className="w-5 h-5" />,
    condiments: <Package className="w-5 h-5" />,
    utensils: <Utensils className="w-5 h-5" />,
    accessibility: <Accessibility className="w-5 h-5" />,
    other: <MessageSquare className="w-5 h-5" />,
  };
  return map[type] ?? <Bell className="w-5 h-5" />;
};

// ─── LIVE ELAPSED TIMER ──────────────────────────────────────────────────────
const ElapsedTimer = ({ createdAt }: { createdAt: string }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - safeDate(createdAt).getTime()) / 1000));
    tick();
    const i = setInterval(tick, 10_000);
    return () => clearInterval(i);
  }, [createdAt]);
  const mins = Math.floor(elapsed / 60);
  const isWarning = mins >= 5;
  return (
    <span className={cn('text-[10px] font-black uppercase tracking-widest',
      isWarning ? 'text-amber-500' : 'text-slate-400')}>
      {isWarning && '⚠ '}{mins < 1 ? 'Just now' : `${mins}m ago`}
    </span>
  );
};

// ─── REQUEST CARD ─────────────────────────────────────────────────────────────
const RequestCard = ({
  request, onResolve, myTables, isPending,
}: {
  request: FloorRequest; onResolve: (id: string) => Promise<void>;
  myTables: string[]; isPending?: boolean;
}) => {
  const [resolving, setResolving] = useState(false);
  const isNew = request.status === 'new' || request.status === 'acknowledged';
  const isUrgent = request.type === 'accessibility';
  const elapsedMins = Math.floor((Date.now() - safeDate(request.createdAt).getTime()) / 60000);
  const isLate = isNew && elapsedMins >= 5;
  const isMyTable = myTables.length === 0 || (request.tableNumber && myTables.includes(request.tableNumber));
  const hasCritical = (request.guestAllergies || []).some(
    (a: any) => typeof a === 'object' && a.severity === 'critical'
  );

  const handleResolve = async () => {
    setResolving(true);
    await onResolve(request.id);
    setResolving(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: isPending ? 0.7 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      className={cn(
        'rounded-2xl border-2 overflow-hidden transition-all',
        !isMyTable && 'opacity-40',
        isNew && isUrgent ? 'border-red-300 bg-red-50 shadow-lg shadow-red-100' :
        isNew && isLate ? 'border-amber-300 bg-amber-50 shadow-md shadow-amber-100' :
        isNew ? 'border-slate-200 bg-white shadow-md shadow-slate-100' :
        'border-slate-100 bg-slate-50 opacity-60'
      )}
    >
      <div className="p-4 flex items-start gap-4">
        <div className={cn('p-3 rounded-xl shrink-0',
          isUrgent ? 'bg-red-100 text-red-600' :
          isLate ? 'bg-amber-100 text-amber-700' :
          isNew ? 'bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-400')}>
          {typeIcon(request.type)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="font-black text-base text-slate-900 uppercase tracking-tight">
              {FLOOR_REQUEST_TYPES.find(t => t.type === request.type)?.label || request.type}
            </p>
            {isPending && (
              <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[9px] font-black uppercase tracking-wide">
                Syncing…
              </span>
            )}
            {isNew && isUrgent && (
              <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-black uppercase tracking-wide">Urgent</span>
            )}
            {isNew && isLate && !isUrgent && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-black uppercase tracking-wide">
                Waiting {elapsedMins}m
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
            {request.tableNumber && <span>Table {request.tableNumber}</span>}
            {request.tableNumber && request.seatNumber && <span>·</span>}
            {request.seatNumber && <span>Seat {request.seatNumber}</span>}
            {request.guestName && <><span>·</span><span className="text-slate-700">{request.guestName}</span></>}
          </div>

          {hasCritical && (
            <div className="flex flex-wrap gap-1 my-1.5">
              {(request.guestAllergies || [])
                .filter((a: any) => typeof a === 'object' && a.severity === 'critical')
                .map((a: any) => (
                  <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-[9px] font-black uppercase tracking-wide text-red-800">
                    ⚠ {a.label}
                  </span>
                ))}
            </div>
          )}

          {!hasCritical && (request.guestAllergies || []).length > 0 && (
            <div className="flex flex-wrap gap-1 my-1.5">
              {(request.guestAllergies || []).map((a: any) => (
                <span key={typeof a === 'string' ? a : a.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[9px] font-black uppercase tracking-wide text-amber-700">
                  ⚠ {typeof a === 'string' ? a : a.label}
                </span>
              ))}
            </div>
          )}

          {request.requestText && (
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">{request.requestText}</p>
          )}
          <div className="mt-2"><ElapsedTimer createdAt={request.createdAt} /></div>
        </div>

        {isNew && (
          <button onClick={handleResolve} disabled={resolving || isPending}
            className={cn('shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-all',
              resolving || isPending ? 'bg-slate-100' :
              isLate ? 'bg-amber-500 hover:bg-amber-600 active:scale-95 shadow-lg shadow-amber-200' :
              'bg-emerald-500 hover:bg-emerald-600 active:scale-95 shadow-lg shadow-emerald-200')}>
            {resolving
              ? <Loader className="w-5 h-5 animate-spin text-slate-400" />
              : <CheckCircle2 className="w-6 h-6 text-white" />}
          </button>
        )}
        {!isNew && <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-1" />}
      </div>
    </motion.div>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function FloorStaffPage() {
  const params = useParams();
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const tenantId = params.tenantId as string;
  const [showDone, setShowDone] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  // ── TABLE OWNERSHIP ──────────────────────────────────────────────────────────
  const [myTables, setMyTables] = useState<string[]>([]);
  const [tableInput, setTableInput] = useState('');
  const [showTableSetup, setShowTableSetup] = useState(false);
  // ── OPTIMISTIC UPDATES ───────────────────────────────────────────────────────
  const [pendingResolves, setPendingResolves] = useState<Set<string>>(new Set());

  // Online/offline detection
  useEffect(() => {
    const onOnline = () => { setIsOnline(true); toast({ title: 'Back online' }); };
    const onOffline = () => { setIsOnline(false); toast({ variant: 'destructive', title: 'Offline — requests will sync when reconnected' }); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setIsOnline(navigator.onLine);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [toast]);

  const floorQ = useMemoFirebase(() => query(
    collection(firestore, `tenants/${tenantId}/floorRequests`),
    where('status', 'in', ['new', 'acknowledged', 'done'])
  ), [firestore, tenantId]);
  const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const { data: allRequests, isLoading } = useCollection<FloorRequest>(floorQ);
  const { data: tenant } = useDoc<any>(tenantRef);

  const { newRequests, doneRequests } = useMemo(() => ({
    newRequests: (allRequests || [])
      .filter(r => r.status === 'new' || r.status === 'acknowledged')
      .sort((a, b) => {
        if (a.type === 'accessibility' && b.type !== 'accessibility') return -1;
        if (b.type === 'accessibility' && a.type !== 'accessibility') return 1;
        return safeDate(a.createdAt).getTime() - safeDate(b.createdAt).getTime();
      }),
    doneRequests: (allRequests || [])
      .filter(r => r.status === 'done')
      .sort((a, b) => safeDate(b.resolvedAt || b.createdAt).getTime() - safeDate(a.resolvedAt || a.createdAt).getTime())
      .slice(0, 20),
  }), [allRequests]);

  // Filtered by table ownership
  const myNewRequests = useMemo(() => {
    if (myTables.length === 0) return newRequests;
    return newRequests.filter(r => !r.tableNumber || myTables.includes(r.tableNumber));
  }, [newRequests, myTables]);

  const otherRequests = useMemo(() => {
    if (myTables.length === 0) return [];
    return newRequests.filter(r => r.tableNumber && !myTables.includes(r.tableNumber));
  }, [newRequests, myTables]);

  // ── OPTIMISTIC RESOLVE ────────────────────────────────────────────────────────
  const handleResolve = useCallback(async (requestId: string) => {
    // Optimistic — mark as pending immediately
    setPendingResolves(prev => new Set([...prev, requestId]));
    try {
      await updateDoc(
        doc(firestore, `tenants/${tenantId}/floorRequests`, requestId),
        { status: 'done', resolvedAt: new Date().toISOString(), resolvedBy: 'floor_staff' }
      );
    } catch (e) {
      // Revert optimistic update on failure
      setPendingResolves(prev => { const next = new Set(prev); next.delete(requestId); return next; });
      if (!isOnline) {
        toast({ variant: 'destructive', title: 'Offline — will retry when reconnected' });
      } else {
        toast({ variant: 'destructive', title: 'Error resolving request' });
      }
    } finally {
      setPendingResolves(prev => { const next = new Set(prev); next.delete(requestId); return next; });
    }
  }, [firestore, tenantId, isOnline, toast]);

  const handleSetTables = () => {
    const tables = tableInput.split(',').map(t => t.trim()).filter(Boolean);
    setMyTables(tables);
    setShowTableSetup(false);
    toast({ title: `Watching ${tables.length} table${tables.length !== 1 ? 's' : ''}`, description: tables.join(', ') });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Offline banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="bg-amber-500 text-slate-900 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 max-w-md mx-auto">
              <WifiOff className="w-4 h-4 shrink-0" />
              <p className="text-[10px] font-black uppercase tracking-widest">Offline — requests queued, will sync when reconnected</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
              <Bell className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">{tenant?.name || 'Studio'}</p>
              <h1 className="text-sm font-black uppercase tracking-tight leading-none">Floor Requests</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {myTables.length > 0 && (
              <span className="text-[9px] font-black uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-lg">
                T{myTables.join(', T')}
              </span>
            )}
            <button onClick={() => setShowTableSetup(s => !s)}
              className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-800 text-slate-400 hover:text-slate-200 transition-all">
              <UserCheck className="w-3.5 h-3.5 inline mr-1" />My Tables
            </button>
            {newRequests.length > 0 && (
              <div className="w-7 h-7 rounded-full bg-red-500 flex items-center justify-center">
                <span className="text-[11px] font-black text-white">{newRequests.length}</span>
              </div>
            )}
            <button onClick={() => setShowDone(s => !s)}
              className={cn('px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                showDone ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200')}>
              {showDone ? 'Hide Done' : 'Show Done'}
            </button>
          </div>
        </div>

        {/* Table ownership setup */}
        <AnimatePresence>
          {showTableSetup && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="max-w-md mx-auto overflow-hidden">
              <div className="pt-3 flex items-center gap-2">
                <input
                  value={tableInput}
                  onChange={e => setTableInput(e.target.value)}
                  placeholder="My tables: 1, 2, 3 (comma separated)"
                  className="flex-1 h-10 rounded-xl bg-slate-800 border border-slate-700 px-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:border-primary"
                />
                <button onClick={handleSetTables}
                  className="h-10 px-4 rounded-xl bg-primary font-black uppercase text-[10px] tracking-widest text-white shrink-0">
                  Set
                </button>
                {myTables.length > 0 && (
                  <button onClick={() => { setMyTables([]); setTableInput(''); setShowTableSetup(false); }}
                    className="h-10 px-3 rounded-xl bg-slate-800 font-black uppercase text-[10px] tracking-widest text-slate-400">
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-1.5">
                Only your tables will be highlighted. Other tables are dimmed.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-6">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-8 h-8 animate-spin text-slate-600" />
          </div>
        )}

        {!isLoading && (
          <>
            {/* My table requests */}
            {myNewRequests.length === 0 && otherRequests.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <CheckCircle2 className="w-12 h-12 text-slate-700 mx-auto" />
                <p className="text-slate-500 font-black uppercase text-sm tracking-widest">All clear</p>
                <p className="text-slate-600 text-sm">No pending floor requests</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myTables.length > 0 && myNewRequests.length > 0 && (
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-primary">
                    Your Tables · {myNewRequests.length} request{myNewRequests.length !== 1 ? 's' : ''}
                  </p>
                )}
                {myTables.length === 0 && newRequests.length > 0 && (
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">
                    Pending · {newRequests.length} request{newRequests.length !== 1 ? 's' : ''}
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {myNewRequests.map(r => (
                    <RequestCard key={r.id} request={r} onResolve={handleResolve}
                      myTables={myTables} isPending={pendingResolves.has(r.id)} />
                  ))}
                </AnimatePresence>

                {/* Other tables dimmed */}
                {otherRequests.length > 0 && (
                  <>
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600 mt-4">
                      Other Tables · {otherRequests.length}
                    </p>
                    <AnimatePresence initial={false}>
                      {otherRequests.map(r => (
                        <RequestCard key={r.id} request={r} onResolve={handleResolve}
                          myTables={[]} isPending={pendingResolves.has(r.id)} />
                      ))}
                    </AnimatePresence>
                  </>
                )}
              </div>
            )}

            {/* Done requests */}
            <AnimatePresence>
              {showDone && doneRequests.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600">
                    Resolved · {doneRequests.length}
                  </p>
                  {doneRequests.map(r => (
                    <RequestCard key={r.id} request={r} onResolve={handleResolve} myTables={[]} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}