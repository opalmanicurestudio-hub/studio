'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Droplets, UtensilsCrossed, Thermometer, MessageSquare, Package,
  IceCream2, ShoppingBag, CreditCard, ChefHat, Check, Send,
  AlertTriangle, Clock, Loader, Sparkles, ChevronLeft,
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { nanoid } from 'nanoid';

// ─── FIREBASE (standalone — no app context on public page) ───────────────────
const getDb = () => {
  if (getApps().length === 0) {
    initializeApp({
      apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  }
  return getFirestore();
};

// ─── DEFAULT REQUEST TYPES ────────────────────────────────────────────────────
const DEFAULT_REQUEST_TYPES = [
  { id: 'water',       label: 'Water Refill',    emoji: '💧', alwaysShow: true  },
  { id: 'napkins',     label: 'Napkins',          emoji: '🧻', alwaysShow: true  },
  { id: 'utensils',    label: 'Utensils',         emoji: '🍴', alwaysShow: true  },
  { id: 'condiments',  label: 'Condiments',       emoji: '🧂', alwaysShow: true  },
  { id: 'ice',         label: 'More Ice',         emoji: '🧊', alwaysShow: true  },
  { id: 'menu',        label: 'Menu Question',    emoji: '📋', alwaysShow: true  },
  { id: 'temp',        label: 'Temperature',      emoji: '🌡️', alwaysShow: true  },
  { id: 'spill',       label: 'Spill / Cleanup',  emoji: '🧹', alwaysShow: true  },
  { id: 'order',       label: 'Ready to Order',   emoji: '✋', alwaysShow: false },
  { id: 'bill',        label: 'Bill Please',      emoji: '💳', alwaysShow: false },
  { id: 'other',       label: 'Other',            emoji: '💬', alwaysShow: true  },
];

// ─── TYPES ────────────────────────────────────────────────────────────────────
type RequestType = { id: string; label: string; emoji: string; alwaysShow?: boolean; enabled?: boolean };
type PageState   = 'loading' | 'choose' | 'message' | 'confirm' | 'success' | 'cooldown' | 'error';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const hexToRgb = (hex: string) => {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r} ${g} ${b}`;
};

const luminance = (hex: string) => {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  return 0.299*r + 0.587*g + 0.114*b;
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function GuestRequestPage() {
  const params   = useParams();
  const tenantId = params.tenantId as string;
  const eventId  = params.eventId  as string;
  const tableId  = params.tableId  as string;
  const seatId   = params.seatId   as string;

  const [pageState,    setPageState]    = useState<PageState>('loading');
  const [tenant,       setTenant]       = useState<any>(null);
  const [event,        setEvent]        = useState<any>(null);
  const [guest,        setGuest]        = useState<any>(null);
  const [guestName,    setGuestName]    = useState('');
  const [requestTypes, setRequestTypes] = useState<RequestType[]>([]);
  const [selected,     setSelected]     = useState<RequestType | null>(null);
  const [message,      setMessage]      = useState('');
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const [lastRequest,  setLastRequest]  = useState<RequestType | null>(null);
  const [errorMsg,     setErrorMsg]     = useState('');
  const [tableName,    setTableName]    = useState('');
  const [seatLabel,    setSeatLabel]    = useState('');

  const primaryHex = tenant?.kioskSettings?.primaryColor || '#6366f1';
  const isDark     = luminance(primaryHex) < 0.4;
  const textOnBrand = isDark ? '#ffffff' : '#0f172a';

  // ── Load data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const db = getDb();

        // Tenant
        const tenantSnap = await getDoc(doc(db, `tenants/${tenantId}`));
        if (!tenantSnap.exists()) { setErrorMsg('Studio not found.'); setPageState('error'); return; }
        const tenantData = tenantSnap.data();
        setTenant(tenantData);

        // Event
        const eventSnap = await getDoc(doc(db, `tenants/${tenantId}/studioEvents/${eventId}`));
        if (!eventSnap.exists()) { setErrorMsg('Event not found.'); setPageState('error'); return; }
        const eventData = { id: eventSnap.id, ...eventSnap.data() };
        setEvent(eventData);

        // Table + seat info from seatingTables subcollection
        const tableSnap = await getDoc(doc(db, `tenants/${tenantId}/studioEvents/${eventId}/seatingTables/${tableId}`));
        if (tableSnap.exists()) {
          const tableData = tableSnap.data();
          setTableName(tableData.name || `Table ${tableId}`);
          const seat = (tableData.seats || []).find((s: any) => s.id === seatId);
          setSeatLabel(seat?.label || seatId);
        }

        // Guest identity — look up by tableNumber + seatNumber in eventGuests
        const guestQ = query(
          collection(db, `tenants/${tenantId}/eventGuests`),
          where('eventId',     '==', eventId),
          where('tableNumber', '==', tableId),
          where('seatNumber',  '==', seatId)
        );
        const guestSnap = await getDocs(guestQ);
        if (!guestSnap.empty) {
          const g = { id: guestSnap.docs[0].id, ...guestSnap.docs[0].data() };
          setGuest(g);
          setGuestName((g as any).name || '');
        }

        // Request types — event overrides > tenant defaults > system defaults
        const eventTypes: RequestType[] = (eventData as any).requestTypes;
        if (eventTypes?.length) {
          setRequestTypes(eventTypes.filter(t => t.enabled !== false));
        } else {
          const tenantTypes: RequestType[] = tenantData.defaultRequestTypes;
          if (tenantTypes?.length) {
            setRequestTypes(tenantTypes.filter(t => t.enabled !== false));
          } else {
            setRequestTypes(DEFAULT_REQUEST_TYPES.filter(t => t.alwaysShow));
          }
        }

        // Check cooldown (recent request from this seat in last 30s)
        const recentQ = query(
          collection(db, `tenants/${tenantId}/floorRequests`),
          where('eventId',  '==', eventId),
          where('tableId',  '==', tableId),
          where('seatId',   '==', seatId),
          where('status',   'in', ['new','acknowledged'])
        );
        const recentSnap = await getDocs(recentQ);
        if (!recentSnap.empty) {
          const latest = recentSnap.docs.sort((a,b) => {
            const aT = a.data().createdAt; const bT = b.data().createdAt;
            return new Date(bT).getTime() - new Date(aT).getTime();
          })[0];
          const elapsed = (Date.now() - new Date(latest.data().createdAt).getTime()) / 1000;
          if (elapsed < 30) {
            setCooldownSecs(Math.ceil(30 - elapsed));
            setPageState('cooldown');
            return;
          }
        }

        setPageState('choose');
      } catch (e) {
        console.error(e);
        setErrorMsg('Something went wrong. Please try again.');
        setPageState('error');
      }
    };
    load();
  }, [tenantId, eventId, tableId, seatId]);

  // ── Cooldown countdown ──────────────────────────────────────────────────────
  useEffect(() => {
    if (pageState !== 'cooldown' || cooldownSecs <= 0) return;
    const i = setInterval(() => {
      setCooldownSecs(s => {
        if (s <= 1) { clearInterval(i); setPageState('choose'); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(i);
  }, [pageState, cooldownSecs]);

  const needsMessage = selected && (selected.id === 'menu' || selected.id === 'other');

  const handleSelectType = (rt: RequestType) => {
    setSelected(rt);
    if (rt.id === 'menu' || rt.id === 'other') {
      setPageState('message');
    } else {
      setPageState('confirm');
    }
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setPageState('loading');
    try {
      const db = getDb();
      const id = nanoid();
      await addDoc(collection(db, `tenants/${tenantId}/floorRequests`), {
        id,
        tenantId,
        eventId,
        tableId,
        tableNumber: tableName || tableId,
        seatId,
        seatNumber: seatLabel || seatId,
        guestId:       guest?.id    || null,
        guestName:     guestName    || guest?.name || null,
        guestAllergies: guest?.allergies || [],
        requestType:   selected.id,
        label:         selected.label,
        emoji:         selected.emoji,
        message:       message.trim() || null,
        status:        'new',
        source:        'guest_qr',
        createdAt:     new Date().toISOString(),
        waitSeconds:   null,
      });
      setLastRequest(selected);
      setCooldownSecs(30);
      setPageState('success');
    } catch (e) {
      console.error(e);
      setErrorMsg('Failed to send request. Please flag down a staff member.');
      setPageState('error');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: `rgb(${hexToRgb(primaryHex)})` }}
    >
      {/* Mesh overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 20% 20%, rgba(255,255,255,0.15) 0%, transparent 60%),
                       radial-gradient(ellipse at 80% 80%, rgba(0,0,0,0.2) 0%, transparent 60%)`,
        }}
      />

      {/* Header */}
      <div className="relative z-10 px-6 pt-10 pb-6">
        <div className="flex items-center justify-between mb-6">
          {tenant?.kioskSettings?.logoUrl ? (
            <img src={tenant.kioskSettings.logoUrl} alt={tenant.name} className="h-8 w-auto object-contain" style={{ filter: isDark ? 'brightness(0) invert(1)' : 'brightness(0)' }} />
          ) : (
            <span className="font-black text-sm uppercase tracking-widest" style={{ color: textOnBrand, opacity: 0.7 }}>
              {tenant?.name || ''}
            </span>
          )}
          <div
            className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest"
            style={{ background: 'rgba(0,0,0,0.2)', color: textOnBrand }}
          >
            {tableName} · Seat {seatLabel}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {pageState !== 'success' && pageState !== 'cooldown' && (
            <motion.div
              key="header-text"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {guest || guestName ? (
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.3em] mb-1" style={{ color: textOnBrand, opacity: 0.6 }}>
                    {event?.name || 'Tonight'}
                  </p>
                  <h1 className="text-3xl font-black leading-none" style={{ color: textOnBrand }}>
                    Hi, {(guest?.name || guestName).split(' ')[0]} 👋
                  </h1>
                  <p className="text-sm font-bold mt-1" style={{ color: textOnBrand, opacity: 0.7 }}>
                    What do you need?
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.3em] mb-1" style={{ color: textOnBrand, opacity: 0.6 }}>
                    {event?.name || 'Floor Service'}
                  </p>
                  <h1 className="text-3xl font-black leading-none" style={{ color: textOnBrand }}>
                    Need something? 👋
                  </h1>
                  <p className="text-sm font-bold mt-1" style={{ color: textOnBrand, opacity: 0.7 }}>
                    Tap what you need and we'll be right over
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Card */}
      <div
        className="relative z-10 flex-1 rounded-t-[2rem] overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)' }}
      >
        <AnimatePresence mode="wait">

          {/* Loading */}
          {pageState === 'loading' && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center justify-center py-24">
              <Loader className="w-8 h-8 animate-spin text-slate-300" />
            </motion.div>
          )}

          {/* Choose */}
          {pageState === 'choose' && (
            <motion.div key="choose" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="p-6 space-y-5">
              {!guest && !guestName && (
                <div className="space-y-2">
                  <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Your name (optional)</label>
                  <input
                    value={guestName}
                    onChange={e => setGuestName(e.target.value)}
                    placeholder="So we can find you"
                    className="w-full h-12 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-300 placeholder:text-slate-300"
                  />
                </div>
              )}

              {/* Critical allergy warning */}
              {guest?.allergies?.some((a: any) => typeof a === 'object' && a.severity === 'critical') && (
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-red-50 border-2 border-red-200">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-red-600 mb-0.5">Allergy on file</p>
                    <div className="flex flex-wrap gap-1">
                      {guest.allergies.filter((a: any) => typeof a === 'object' && a.severity === 'critical').map((a: any) => (
                        <span key={a.id} className="text-[9px] font-black uppercase text-red-700 bg-red-100 px-2 py-0.5 rounded-full">{a.label}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-3">What do you need?</p>
                <div className="grid grid-cols-3 gap-2.5">
                  {requestTypes.map((rt, i) => (
                    <motion.button
                      key={rt.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.04 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => handleSelectType(rt)}
                      className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-slate-100 bg-white hover:border-slate-200 hover:shadow-md transition-all text-center active:scale-95"
                    >
                      <span className="text-2xl leading-none">{rt.emoji}</span>
                      <span className="text-[9px] font-black uppercase tracking-tight leading-tight text-slate-700">{rt.label}</span>
                    </motion.button>
                  ))}
                </div>
              </div>

              <p className="text-center text-[9px] font-bold uppercase tracking-widest text-slate-300 pb-4">
                A staff member will be with you shortly
              </p>
            </motion.div>
          )}

          {/* Message input */}
          {pageState === 'message' && selected && (
            <motion.div key="message" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="p-6 space-y-6">
              <button onClick={() => setPageState('choose')} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600">
                <ChevronLeft className="w-3 h-3" /> Back
              </button>
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                  style={{ background: `rgba(${hexToRgb(primaryHex)}, 0.1)` }}
                >
                  {selected.emoji}
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Selected</p>
                  <p className="text-xl font-black text-slate-900">{selected.label}</p>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">
                  {selected.id === 'menu' ? 'Your question (optional)' : 'Details (optional)'}
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={selected.id === 'menu' ? "e.g. Does the salmon contain nuts?" : "Any details for our staff…"}
                  rows={4}
                  className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 p-4 text-sm font-semibold text-slate-800 outline-none focus:border-slate-300 placeholder:text-slate-300 resize-none"
                />
              </div>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setPageState('confirm')}
                className="w-full h-14 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2"
                style={{ background: primaryHex, color: textOnBrand }}
              >
                Continue <Send className="w-4 h-4" />
              </motion.button>
            </motion.div>
          )}

          {/* Confirm */}
          {pageState === 'confirm' && selected && (
            <motion.div key="confirm" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="p-6 space-y-6">
              <button onClick={() => setPageState(needsMessage ? 'message' : 'choose')}
                className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600">
                <ChevronLeft className="w-3 h-3" /> Back
              </button>

              <div className="text-center space-y-3">
                <div
                  className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mx-auto"
                  style={{ background: `rgba(${hexToRgb(primaryHex)}, 0.1)` }}
                >
                  {selected.emoji}
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Sending request</p>
                  <h2 className="text-2xl font-black text-slate-900">{selected.label}</h2>
                  {message && <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">"{message}"</p>}
                </div>
              </div>

              <div className="space-y-2 p-4 rounded-2xl bg-slate-50 border-2 border-slate-100">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Table</span>
                  <span className="font-black text-slate-800">{tableName}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Seat</span>
                  <span className="font-black text-slate-800">{seatLabel}</span>
                </div>
                {(guest?.name || guestName) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guest</span>
                    <span className="font-black text-slate-800">{guest?.name || guestName}</span>
                  </div>
                )}
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSubmit}
                className="w-full h-14 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2"
                style={{ background: primaryHex, color: textOnBrand }}
              >
                Send Request <Send className="w-4 h-4" />
              </motion.button>
            </motion.div>
          )}

          {/* Success */}
          {pageState === 'success' && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="p-6 flex flex-col items-center justify-center min-h-[400px] space-y-6 text-center">
              <motion.div
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', damping: 12, stiffness: 140 }}
                className="w-24 h-24 rounded-3xl flex items-center justify-center"
                style={{ background: `rgba(${hexToRgb(primaryHex)}, 0.1)` }}
              >
                <Check className="w-12 h-12" style={{ color: primaryHex }} />
              </motion.div>
              <div>
                <h2 className="text-3xl font-black text-slate-900">Got it!</h2>
                <p className="text-slate-500 font-bold mt-1">
                  {lastRequest?.label} · a staff member is on their way
                </p>
              </div>
              <div className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Your request</p>
                <p className="font-black text-slate-800 text-lg">{lastRequest?.emoji} {lastRequest?.label}</p>
                <p className="text-[9px] font-bold text-slate-400">{tableName} · Seat {seatLabel}</p>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Clock className="w-4 h-4" />
                <p className="text-[10px] font-black uppercase tracking-widest">
                  Can send another in {cooldownSecs}s
                </p>
              </div>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => { setSelected(null); setMessage(''); setPageState('choose'); }}
                className="w-full h-12 rounded-2xl font-black text-sm uppercase tracking-widest border-2 border-slate-200 text-slate-600 hover:border-slate-300"
              >
                Need Something Else?
              </motion.button>
            </motion.div>
          )}

          {/* Cooldown */}
          {pageState === 'cooldown' && (
            <motion.div key="cooldown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="p-6 flex flex-col items-center justify-center min-h-[400px] space-y-6 text-center">
              <div className="w-20 h-20 rounded-3xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
                <Clock className="w-10 h-10 text-amber-500" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-900">Request Sent</h2>
                <p className="text-slate-500 font-bold mt-1">Staff are already on their way</p>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                You can send another request in {cooldownSecs}s
              </p>
            </motion.div>
          )}

          {/* Error */}
          {pageState === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="p-6 flex flex-col items-center justify-center min-h-[400px] space-y-4 text-center">
              <div className="w-20 h-20 rounded-3xl bg-red-50 border-2 border-red-200 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-red-400" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-900">Oops</h2>
                <p className="text-slate-500 font-bold mt-1">{errorMsg}</p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="h-12 px-8 rounded-2xl font-black uppercase tracking-widest text-sm border-2 border-slate-200 text-slate-600"
              >
                Try Again
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}