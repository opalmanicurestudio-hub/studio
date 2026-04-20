'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Check, ChevronRight, Loader, ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

// ─── Types ────────────────────────────────────────────────────────────────────
type FloorRequestType =
  | 'water' | 'napkins' | 'condiments' | 'utensils'
  | 'ice' | 'accessibility' | 'temperature' | 'cleaning' | 'other';

interface FloorRequest {
  type: FloorRequestType;
  label: string;
  emoji: string;
  description: string;
}

const FLOOR_REQUESTS: FloorRequest[] = [
  { type: 'water',         label: 'Water',       emoji: '💧', description: 'Refill your water' },
  { type: 'napkins',       label: 'Napkins',      emoji: '🧻', description: 'Extra napkins' },
  { type: 'condiments',    label: 'Condiments',   emoji: '🧂', description: 'Salt, pepper & more' },
  { type: 'utensils',      label: 'Utensils',     emoji: '🍴', description: 'Extra cutlery' },
  { type: 'ice',           label: 'Ice',          emoji: '🧊', description: 'For your drinks' },
  { type: 'temperature',   label: 'Temperature',  emoji: '🌡️', description: 'Too warm or cool?' },
  { type: 'cleaning',      label: 'Spill',        emoji: '🧹', description: 'Spill or cleanup' },
  { type: 'accessibility', label: 'Assistance',   emoji: '♿', description: "We'll come to you" },
  { type: 'other',         label: 'Other',        emoji: '💬', description: 'Any other request' },
];

// ─── Ambient background ───────────────────────────────────────────────────────
const AmbientBg = ({ hex }: { hex?: string }) => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <div className="absolute inset-0 bg-[#0a0a0b]" />
    <div
      className="absolute -top-1/3 -left-1/4 w-2/3 h-2/3 rounded-full blur-[100px] opacity-15 transition-all duration-1000"
      style={{ backgroundColor: hex || '#c9a96e' }}
    />
    <div
      className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full blur-[80px] opacity-10 transition-all duration-1000"
      style={{ backgroundColor: hex || '#c9a96e' }}
    />
  </div>
);

// ─── Table number entry ───────────────────────────────────────────────────────
const TableStep = ({
  onConfirm,
  logoUrl,
  tenantName,
  eventName,
  hex,
}: {
  onConfirm: (table: string) => void;
  logoUrl?: string;
  tenantName?: string;
  eventName?: string;
  hex?: string;
}) => {
  const [table, setTable] = useState('');
  return (
    <motion.div
      key="table-step"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col items-center justify-center min-h-screen p-8 relative z-10"
    >
      <div className="w-full max-w-sm space-y-10 text-center">
        {logoUrl && (
          <div className="relative w-16 h-16 mx-auto rounded-2xl overflow-hidden shadow-2xl">
            <Image src={logoUrl} alt={tenantName || ''} fill className="object-cover" />
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[8px] font-bold uppercase tracking-[0.4em] text-white/25">
            {tenantName}
          </p>
          <h1 className="text-5xl font-light text-white italic leading-tight">
            {eventName || 'Good Evening'}
          </h1>
          <p className="text-white/35 text-sm pt-1">
            Enter your table number to get started
          </p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            value={table}
            onChange={e => setTable(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && table && onConfirm(table)}
            placeholder="—"
            className="w-full h-24 rounded-2xl bg-white/[0.05] border border-white/10 text-center text-5xl font-bold text-white outline-none focus:border-white/25 transition-all placeholder:text-white/15 tracking-widest"
            autoFocus
          />
          <p className="text-[9px] text-white/20 uppercase tracking-[0.25em]">
            Table Number
          </p>
        </div>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => table && onConfirm(table)}
          disabled={!table}
          className="w-full h-14 rounded-2xl font-bold uppercase tracking-widest text-sm disabled:opacity-20 transition-all flex items-center justify-center gap-2"
          style={{ backgroundColor: hex || '#c9a96e', color: '#0a0a0b' }}
        >
          Continue <ChevronRight className="w-4 h-4" />
        </motion.button>
      </div>
    </motion.div>
  );
};

// ─── Request button ───────────────────────────────────────────────────────────
type ReqStatus = 'idle' | 'loading' | 'sent' | 'acknowledged';

const RequestButton = ({
  req,
  status,
  onTap,
  hex,
}: {
  req: FloorRequest;
  status: ReqStatus;
  onTap: () => void;
  hex?: string;
}) => {
  const isDone    = status === 'sent' || status === 'acknowledged';
  const isLoading = status === 'loading';

  return (
    <motion.button
      whileTap={!isDone ? { scale: 0.93 } : {}}
      onClick={!isDone && !isLoading ? onTap : undefined}
      className={cn(
        'relative flex flex-col items-center gap-2.5 p-4 rounded-2xl border transition-all duration-300 overflow-hidden',
        isDone
          ? 'border-white/5 bg-white/[0.02] opacity-60'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06] active:bg-white/[0.08]'
      )}
    >
      {status === 'acknowledged' && (
        <motion.div
          className="absolute inset-0 rounded-2xl border-2 opacity-40"
          style={{ borderColor: hex || '#c9a96e' }}
          animate={{ opacity: [0.4, 0.1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}

      <span className={cn('text-3xl transition-all', isDone ? 'opacity-40 scale-90' : '')}>
        {req.emoji}
      </span>

      <div className="text-center">
        <p className={cn(
          'text-[10px] font-bold uppercase tracking-wide leading-tight transition-all',
          isDone ? 'text-white/25' : 'text-white/60'
        )}>
          {req.label}
        </p>
        <p className={cn(
          'text-[8px] font-medium leading-tight mt-0.5 transition-all',
          isDone ? 'text-white/15' : 'text-white/25'
        )}>
          {status === 'acknowledged' ? 'On the way ✓' : isDone ? 'Requested' : req.description}
        </p>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-2xl">
          <Loader className="w-5 h-5 animate-spin text-white/40" />
        </div>
      )}
      {isDone && !isLoading && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 12 }}
          className="absolute top-2 right-2"
        >
          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
            <Check className="w-2.5 h-2.5 text-white" />
          </div>
        </motion.div>
      )}
    </motion.button>
  );
};

// ─── Main EventModeScreen ─────────────────────────────────────────────────────
interface EventModeScreenProps {
  event: any;
  tenant: any;
  t: any;
  onFloorRequest: (type: string, label: string, tableNumber: string) => Promise<void>;
  onExit: () => void;
  firestore: any;
  tenantId: string;
}

export function EventModeScreen({
  event,
  tenant,
  onFloorRequest,
  onExit,
  firestore,
  tenantId,
}: EventModeScreenProps) {
  const { toast } = useToast();

  const brandHex   = tenant?.kioskSettings?.primaryColor || tenant?.bookingPageSettings?.primaryColor || '#c9a96e';
  const logoUrl    = tenant?.kioskSettings?.logoUrl || tenant?.bookingPageSettings?.logoUrl;
  const tenantName = tenant?.name || 'Studio';
  const eventName  = event?.title || event?.name || "Tonight's Event";

  // ── Table session ─────────────────────────────────────────────────────────
  const [tableNumber, setTableNumber] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(`opal_event_table_${event?.id}`) || null;
  });

  // ── Guest lookup ──────────────────────────────────────────────────────────
  const [guestName,  setGuestName]  = useState<string | null>(null);
  const [lookingUp,  setLookingUp]  = useState(false);

  const lookupGuest = async (table: string) => {
    if (!firestore || !tenantId || !event?.id) return;
    setLookingUp(true);
    try {
      const snap = await getDocs(
        query(
          collection(firestore, `tenants/${tenantId}/eventGuests`),
          where('eventId',    '==', event.id),
          where('tableNumber','==', table),
          where('checkedIn',  '==', true)
        )
      );
      if (!snap.empty) setGuestName(snap.docs[0].data().name || null);
    } catch {
      // Non-critical
    } finally {
      setLookingUp(false);
    }
  };

  const handleTableConfirm = async (table: string) => {
    sessionStorage.setItem(`opal_event_table_${event?.id}`, table);
    setTableNumber(table);
    await lookupGuest(table);
  };

  // ── Request statuses ──────────────────────────────────────────────────────
  const [requestStatuses, setRequestStatuses] = useState<Record<string, ReqStatus>>({});

  useEffect(() => {
    if (!firestore || !tenantId || !tableNumber) return;
    const q = query(
      collection(firestore, `tenants/${tenantId}/floorRequests`),
      where('tableNumber', '==', tableNumber),
      where('status',      '==', 'acknowledged')
    );
    const unsub = onSnapshot(q,
      snap => {
        snap.docs.forEach(d => {
          const type = d.data().requestType;
          setRequestStatuses(prev =>
            prev[type] === 'sent' ? { ...prev, [type]: 'acknowledged' } : prev
          );
        });
      },
      err => console.error('[EventModeScreen] acknowledgment listener:', err)
    );
    return unsub;
  }, [firestore, tenantId, tableNumber]);

  const handleRequest = async (req: FloorRequest) => {
    if (!tableNumber) return;
    const current = requestStatuses[req.type];
    if (current === 'sent' || current === 'acknowledged' || current === 'loading') return;

    // Dedup check
    if (firestore && tenantId) {
      try {
        const fiveMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000));
        const dupSnap = await getDocs(query(
          collection(firestore, `tenants/${tenantId}/floorRequests`),
          where('tableNumber',  '==', tableNumber),
          where('requestType',  '==', req.type),
          where('status', 'in', ['new', 'acknowledged'])
        ));
        const recentDup = dupSnap.docs.find(d => {
          const created: Timestamp | undefined = d.data().createdAt;
          return created?.seconds != null && created.seconds >= fiveMinutesAgo.seconds;
        });
        if (recentDup) {
          const ackd = recentDup.data().status === 'acknowledged';
          toast({
            title:       ackd ? 'Staff are on their way ✓' : 'Already requested',
            description: ackd ? 'Your request has been acknowledged.' : "Staff have been notified.",
          });
          setRequestStatuses(prev => ({ ...prev, [req.type]: ackd ? 'acknowledged' : 'sent' }));
          return;
        }
      } catch { /* proceed */ }
    }

    setRequestStatuses(prev => ({ ...prev, [req.type]: 'loading' }));
    try {
      await onFloorRequest(req.type, req.label, tableNumber);
      setRequestStatuses(prev => ({ ...prev, [req.type]: 'sent' }));
    } catch {
      setRequestStatuses(prev => ({ ...prev, [req.type]: 'idle' }));
      toast({ variant: 'destructive', title: 'Could not send request', description: 'Please try again or flag down a staff member.' });
    }
  };

  const firstName     = (name: string) => name.trim().split(' ')[0];
  const pendingCount  = Object.values(requestStatuses).filter(s => s === 'sent').length;
  const ackdCount     = Object.values(requestStatuses).filter(s => s === 'acknowledged').length;

  // ── No table yet ──────────────────────────────────────────────────────────
  if (!tableNumber) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0b] overflow-hidden">
        <AmbientBg hex={brandHex} />
        <AnimatePresence mode="wait">
          <TableStep
            key="table"
            onConfirm={handleTableConfirm}
            logoUrl={logoUrl}
            tenantName={tenantName}
            eventName={eventName}
            hex={brandHex}
          />
        </AnimatePresence>
      </div>
    );
  }

  // ── Main request screen ───────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-[#0a0a0b] overflow-auto">
      <AmbientBg hex={brandHex} />

      <div className="relative z-10 max-w-lg mx-auto px-5 py-8 space-y-8">

        {/* Top bar */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {logoUrl && (
              <div className="relative w-9 h-9 rounded-xl overflow-hidden shrink-0">
                <Image src={logoUrl} alt={tenantName} fill className="object-cover" />
              </div>
            )}
            <div>
              <p className="text-[7px] font-bold uppercase tracking-[0.35em] text-white/20">{tenantName}</p>
              <p className="text-sm text-white/50 italic">{eventName}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[7px] font-bold uppercase tracking-[0.3em] text-white/20">Table</p>
            <p className="text-2xl font-light text-white leading-none">{tableNumber}</p>
          </div>
        </div>

        {/* Welcome */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-1">
          {lookingUp ? (
            <div className="flex items-center gap-2">
              <Loader className="w-3 h-3 animate-spin text-white/20" />
              <p className="text-white/20 text-xs">Finding your reservation…</p>
            </div>
          ) : guestName ? (
            <>
              <p className="text-[8px] font-bold uppercase tracking-[0.35em] text-white/25">Good evening</p>
              <h1 className="text-4xl font-light text-white italic">{firstName(guestName)}</h1>
            </>
          ) : (
            <>
              <p className="text-[8px] font-bold uppercase tracking-[0.35em] text-white/25">Table {tableNumber}</p>
              <h1 className="text-4xl font-light text-white italic">Good evening</h1>
            </>
          )}
          <p className="text-white/30 text-sm pt-1">Your meal is being prepared. Tap below for anything you need.</p>
        </motion.div>

        {/* Status bar */}
        <AnimatePresence>
          {(pendingCount > 0 || ackdCount > 0) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="px-4 py-3 rounded-xl border flex items-center gap-3"
                style={{ borderColor: `${brandHex}30`, backgroundColor: `${brandHex}08` }}>
                <div className="w-2 h-2 rounded-full animate-pulse shrink-0"
                  style={{ backgroundColor: ackdCount > 0 ? '#22c55e' : brandHex }} />
                <p className="text-xs font-bold" style={{ color: `${brandHex}cc` }}>
                  {ackdCount > 0
                    ? `Staff are on their way — ${ackdCount} request${ackdCount !== 1 ? 's' : ''} acknowledged`
                    : `${pendingCount} request${pendingCount !== 1 ? 's' : ''} sent — staff notified`}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Request grid */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/20 mb-3">Request Assistance</p>
          <div className="grid grid-cols-3 gap-2.5">
            {FLOOR_REQUESTS.map(req => (
              <RequestButton
                key={req.type}
                req={req}
                status={requestStatuses[req.type] || 'idle'}
                onTap={() => handleRequest(req)}
                hex={brandHex}
              />
            ))}
          </div>
        </motion.div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => {
              sessionStorage.removeItem(`opal_event_table_${event?.id}`);
              setTableNumber(null);
              setGuestName(null);
              setRequestStatuses({});
            }}
            className="text-[9px] font-bold uppercase tracking-widest text-white/15 hover:text-white/30 transition-colors"
          >
            Change Table
          </button>
          <button onClick={onExit}
            className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-white/15 hover:text-white/30 transition-colors">
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
        </div>
      </div>
    </div>
  );
}

export default EventModeScreen;