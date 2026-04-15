// src/app/floor/[tenantId]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Floor staff alert view — mobile-optimized, front-of-house only
// Intentionally different from KDS:
//   KDS = kitchen, mounted screen, prep lanes, inventory deduction
//   Floor = mobile, FOH staff, instant resolve, no inventory impact
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where, updateDoc } from 'firebase/firestore';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Bell, AlertTriangle, Loader, Droplets, Utensils, Package, Accessibility, MessageSquare, LayoutGrid } from 'lucide-react';
import { type FloorRequest, FLOOR_REQUEST_TYPES } from '@/lib/event-types';

const safeDate = (v: any) => v?.toDate?.() ?? (typeof v === 'string' ? parseISO(v) : new Date(v));

// ─── REQUEST TYPE ICON ────────────────────────────────────────────────────────
const typeIcon = (type: FloorRequest['type']) => {
  const map: Record<string, React.ReactNode> = {
    water:         <Droplets className="w-5 h-5" />,
    napkins:       <Package className="w-5 h-5" />,
    condiments:    <Package className="w-5 h-5" />,
    utensils:      <Utensils className="w-5 h-5" />,
    accessibility: <Accessibility className="w-5 h-5" />,
    other:         <MessageSquare className="w-5 h-5" />,
  };
  return map[type] ?? <Bell className="w-5 h-5" />;
};

const typeLabel = (type: FloorRequest['type']) =>
  FLOOR_REQUEST_TYPES.find(t => t.type === type)?.label ?? type;

// ─── LIVE ELAPSED TIMER ──────────────────────────────────────────────────────
const ElapsedTimer = ({ createdAt }: { createdAt: string }) => {
  const [elapsed, setElapsed] = useState(0); // seconds
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - safeDate(createdAt).getTime()) / 1000));
    tick();
    const i = setInterval(tick, 10_000);
    return () => clearInterval(i);
  }, [createdAt]);
  const mins = Math.floor(elapsed / 60);
  const isWarning = mins >= 5;
  const label = mins < 1 ? 'Just now' : `${mins}m ago`;
  return (
    <span className={cn('text-[10px] font-black uppercase tracking-widest',
      isWarning ? 'text-amber-500' : 'text-slate-400')}>
      {isWarning && '⚠ '}{label}
    </span>
  );
};

// ─── REQUEST CARD ─────────────────────────────────────────────────────────────
const RequestCard = ({
  request, onResolve,
}: { request: FloorRequest; onResolve: (id: string) => Promise<void> }) => {
  const [resolving, setResolving] = useState(false);
  const isNew = request.status === 'new' || request.status === 'acknowledged';
  const isUrgent = request.type === 'accessibility';
  const elapsedMins = Math.floor((Date.now() - safeDate(request.createdAt).getTime()) / 60000);
  const isLate = isNew && elapsedMins >= 5;

  const handleResolve = async () => {
    setResolving(true);
    await onResolve(request.id);
    setResolving(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      className={cn(
        'rounded-2xl border-2 overflow-hidden transition-all',
        isNew && isUrgent ? 'border-red-300 bg-red-50 shadow-lg shadow-red-100' :
        isNew && isLate ? 'border-amber-300 bg-amber-50 shadow-md shadow-amber-100' :
        isNew ? 'border-slate-200 bg-white shadow-md shadow-slate-100' :
        'border-slate-100 bg-slate-50 opacity-60'
      )}
    >
      <div className="p-4 flex items-start gap-4">
        {/* Icon */}
        <div className={cn('p-3 rounded-xl shrink-0',
          isUrgent ? 'bg-red-100 text-red-600' :
          isLate ? 'bg-amber-100 text-amber-700' :
          isNew ? 'bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-400')}>
          {typeIcon(request.type)}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="font-black text-base text-slate-900 uppercase tracking-tight">
              {typeLabel(request.type)}
            </p>
            {isNew && isUrgent && (
              <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-black uppercase tracking-wide">
                Urgent
              </span>
            )}
            {isNew && isLate && !isUrgent && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-black uppercase tracking-wide">
                Waiting {elapsedMins}m
              </span>
            )}
          </div>

          {/* Location */}
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
            {request.tableNumber && <span>Table {request.tableNumber}</span>}
            {request.tableNumber && request.seatNumber && <span>·</span>}
            {request.seatNumber && <span>Seat {request.seatNumber}</span>}
            {request.guestName && (
              <><span>·</span><span className="text-slate-700">{request.guestName}</span></>
            )}
          </div>

          {/* Allergy flags — shown prominently if present */}
          {(request.guestAllergies || []).length > 0 && (
            <div className="flex flex-wrap gap-1 my-2">
              {(request.guestAllergies || []).map((a: string) => (
                <span key={a} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[9px] font-black uppercase tracking-wide text-amber-700">
                  ⚠ {a}
                </span>
              ))}
            </div>
          )}

          {request.requestText && (
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">{request.requestText}</p>
          )}

          <div className="mt-2">
            <ElapsedTimer createdAt={request.createdAt} />
          </div>
        </div>

        {/* Resolve button */}
        {isNew && (
          <button onClick={handleResolve} disabled={resolving}
            className={cn('shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-all',
              resolving ? 'bg-slate-100' :
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
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(i);
  }, []);

  // Realtime listener — today's floor requests only
  const floorQ = useMemoFirebase(() => query(
    collection(firestore, `tenants/${tenantId}/floorRequests`),
    where('status', 'in', ['new', 'acknowledged', 'done'])
  ), [firestore, tenantId]);
  const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);

  const { data: allRequests, isLoading } = useCollection<FloorRequest>(floorQ);
  const { data: tenant } = useDoc<any>(tenantRef);

  // Split new vs done
  const { newRequests, doneRequests } = useMemo(() => ({
    newRequests: (allRequests || []).filter(r => r.status === 'new' || r.status === 'acknowledged')
      .sort((a, b) => {
        // Accessibility requests always first
        if (a.type === 'accessibility' && b.type !== 'accessibility') return -1;
        if (b.type === 'accessibility' && a.type !== 'accessibility') return 1;
        return safeDate(a.createdAt).getTime() - safeDate(b.createdAt).getTime();
      }),
    doneRequests: (allRequests || []).filter(r => r.status === 'done')
      .sort((a, b) => safeDate(b.resolvedAt || b.createdAt).getTime() - safeDate(a.resolvedAt || a.createdAt).getTime())
      .slice(0, 20), // show last 20 resolved
  }), [allRequests]);

  const handleResolve = async (requestId: string) => {
    if (!firestore || !tenantId) return;
    try {
      await updateDoc(
        doc(firestore, `tenants/${tenantId}/floorRequests`, requestId),
        { status: 'done', resolvedAt: new Date().toISOString() }
      );
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error resolving request' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header — stays at top on mobile */}
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
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-6">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-8 h-8 animate-spin text-slate-600" />
          </div>
        )}

        {/* New requests */}
        {!isLoading && (
          <>
            {newRequests.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <CheckCircle2 className="w-12 h-12 text-slate-700 mx-auto" />
                <p className="text-slate-500 font-black uppercase text-sm tracking-widest">All clear</p>
                <p className="text-slate-600 text-sm">No pending floor requests</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">
                  Pending · {newRequests.length} request{newRequests.length !== 1 ? 's' : ''}
                </p>
                <AnimatePresence initial={false}>
                  {newRequests.map(r => (
                    <RequestCard key={r.id} request={r} onResolve={handleResolve} />
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Done requests */}
            <AnimatePresence>
              {showDone && doneRequests.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600">
                    Resolved · {doneRequests.length}
                  </p>
                  {doneRequests.map(r => <RequestCard key={r.id} request={r} onResolve={handleResolve} />)}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}