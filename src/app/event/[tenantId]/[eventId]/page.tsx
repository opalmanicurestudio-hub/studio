'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import {
  Calendar, Clock, MapPin, Users, Check, ChevronRight,
  Loader, AlertTriangle, Ticket, Download, Mail, Phone,
  Star, ArrowLeft, X,
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore, doc, getDoc, collection, addDoc,
  query, where, getDocs, updateDoc,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';

// ─── FIREBASE (standalone public page) ───────────────────────────────────────
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

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const hexLuminance = (hex: string) => {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  return 0.299*r + 0.587*g + 0.114*b;
};

const generateTicketCode = () => nanoid(8).toUpperCase();

// ─── ICS CALENDAR FILE GENERATOR ─────────────────────────────────────────────
const generateICS = (event: any, ticket: any): string => {
  const start = event.date && event.time
    ? new Date(`${event.date}T${event.time}`)
    : event.date ? new Date(event.date) : new Date();

  const end = event.endTime && event.date
    ? new Date(`${event.date}T${event.endTime}`)
    : new Date(start.getTime() + 2 * 60 * 60 * 1000); // default 2hrs

  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Opal Studio//Event Ticket//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ticket.id}@opal-studio`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${event.name || event.title || 'Event'}`,
    `DESCRIPTION:Ticket #${ticket.ticketCode}\\nGuest: ${ticket.guestName}`,
    event.venue ? `LOCATION:${event.venue}` : '',
    `STATUS:CONFIRMED`,
    `SEQUENCE:0`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return lines.join('\r\n');
};

const downloadICS = (event: any, ticket: any) => {
  const ics = generateICS(event, ticket);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${(event.name || 'event').replace(/\s+/g, '-').toLowerCase()}.ics`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── TYPES ────────────────────────────────────────────────────────────────────
type PageState = 'loading' | 'event' | 'form' | 'processing' | 'confirmed' | 'sold_out' | 'closed' | 'error';

type GuestInfo = {
  name:  string;
  email: string;
  phone: string;
};

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
const TicketCard = ({ ticket, event, onDownloadCal }: { ticket: any; event: any; onDownloadCal: () => void }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9, y: 20 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    transition={{ type: 'spring', damping: 14, stiffness: 120 }}
    className="relative bg-white rounded-3xl overflow-hidden shadow-2xl border border-slate-100 max-w-sm w-full mx-auto"
  >
    {/* Ticket top */}
    <div className="p-6 pb-4" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
      <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/40 mb-1">Your Ticket</p>
      <h2 className="text-2xl font-black text-white leading-tight">{event.name || event.title}</h2>
      {event.date && (
        <p className="text-white/60 text-sm font-bold mt-2">
          {format(new Date(event.date), 'EEEE, MMMM d, yyyy')}
          {event.time && ` · ${event.time}`}
        </p>
      )}
      {event.venue && <p className="text-white/40 text-xs font-bold mt-1">{event.venue}</p>}
    </div>

    {/* Tear line */}
    <div className="flex items-center">
      <div className="w-4 h-4 rounded-full bg-slate-50 -ml-2 shrink-0" />
      <div className="flex-1 border-t-2 border-dashed border-slate-200" />
      <div className="w-4 h-4 rounded-full bg-slate-50 -mr-2 shrink-0" />
    </div>

    {/* Ticket bottom */}
    <div className="p-6 pt-4 space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guest</span>
          <span className="text-sm font-black text-slate-800">{ticket.guestName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Ticket #</span>
          <span className="text-sm font-black font-mono text-slate-800">{ticket.ticketCode}</span>
        </div>
        {ticket.type === 'paid' && (
          <div className="flex justify-between">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Paid</span>
            <span className="text-sm font-black text-emerald-600">${(ticket.amountPaid || ticket.price || 0).toFixed(2)}</span>
          </div>
        )}
        {ticket.type === 'free' && (
          <div className="flex justify-between">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Type</span>
            <span className="text-sm font-black text-slate-600">Free RSVP</span>
          </div>
        )}
      </div>

      {/* QR placeholder — real QR generated server-side */}
      <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-center aspect-square max-w-[140px] mx-auto border-2 border-slate-100">
        <div className="text-center space-y-1">
          <Ticket className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{ticket.ticketCode}</p>
        </div>
      </div>

      <button onClick={onDownloadCal}
        className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl border-2 border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest hover:border-slate-400 hover:bg-slate-50 transition-all">
        <Download className="w-3.5 h-3.5" /> Add to Calendar
      </button>
    </div>
  </motion.div>
);

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function EventPublicPage() {
  const params      = useParams();
  const searchParams = useSearchParams();
  const tenantId    = params.tenantId as string;
  const eventId     = params.eventId  as string;

  // ?invite=guestId for personalized invite links
  const inviteGuestId = searchParams.get('invite');
  // ?session_id=xxx for Stripe redirect back
  const stripeSessionId = searchParams.get('session_id');

  const [pageState, setPageState]   = useState<PageState>('loading');
  const [tenant,    setTenant]      = useState<any>(null);
  const [event,     setEvent]       = useState<any>(null);
  const [invitedGuest, setInvitedGuest] = useState<any>(null);
  const [ticket,    setTicket]      = useState<any>(null);
  const [ticketCount, setTicketCount] = useState(0);
  const [guest,     setGuest]       = useState<GuestInfo>({ name: '', email: '', phone: '' });
  const [errors,    setErrors]      = useState<Record<string, string>>({});
  const [errorMsg,  setErrorMsg]    = useState('');

  const primaryHex  = tenant?.kioskSettings?.primaryColor || '#6366f1';
  const isDark      = hexLuminance(primaryHex) < 0.4;
  const textOn      = isDark ? '#ffffff' : '#0f172a';
  const logoUrl     = tenant?.kioskSettings?.logoUrl;

  const ticketConfig = event?.ticketingConfig || {};
  const isPaid       = ticketConfig.type === 'paid';
  const isFree       = !isPaid;
  const capacity     = ticketConfig.capacity || null;
  const isSoldOut    = capacity !== null && ticketCount >= capacity;

  // ── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const db = getDb();

        // Tenant
        const tenantSnap = await getDoc(doc(db, `tenants/${tenantId}`));
        if (!tenantSnap.exists()) { setErrorMsg('Studio not found.'); setPageState('error'); return; }
        setTenant(tenantSnap.data());

        // Event
        const eventSnap = await getDoc(doc(db, `tenants/${tenantId}/studioEvents/${eventId}`));
        if (!eventSnap.exists()) { setErrorMsg('Event not found.'); setPageState('error'); return; }
        const ev = { id: eventSnap.id, ...eventSnap.data() };
        setEvent(ev);

        // Ticket count
        const ticketsSnap = await getDocs(query(
          collection(db, `tenants/${tenantId}/eventTickets`),
          where('eventId', '==', eventId),
          where('status', 'in', ['rsvpd', 'paid', 'checked_in'])
        ));
        setTicketCount(ticketsSnap.size);

        // Invited guest pre-fill
        if (inviteGuestId) {
          const guestSnap = await getDoc(doc(db, `tenants/${tenantId}/clients/${inviteGuestId}`));
          if (guestSnap.exists()) {
            const g = guestSnap.data();
            setInvitedGuest(g);
            setGuest({ name: g.name || '', email: g.email || '', phone: g.phone || '' });
          }
        }

        // Stripe success redirect
        if (stripeSessionId) {
          const existingTicket = await getDocs(query(
            collection(db, `tenants/${tenantId}/eventTickets`),
            where('stripeSessionId', '==', stripeSessionId)
          ));
          if (!existingTicket.empty) {
            setTicket({ id: existingTicket.docs[0].id, ...existingTicket.docs[0].data() });
            setPageState('confirmed');
            return;
          }
        }

        // Check event status
        const evData = ev as any;
        if (evData.status === 'cancelled') { setErrorMsg('This event has been cancelled.'); setPageState('closed'); return; }
        if (evData.status === 'closed')    { setErrorMsg('This event is no longer accepting registrations.'); setPageState('closed'); return; }

        const cap = evData.ticketingConfig?.capacity;
        if (cap && ticketsSnap.size >= cap) { setPageState('sold_out'); return; }

        setPageState('event');
      } catch (e) {
        console.error(e);
        setErrorMsg('Something went wrong loading this event.');
        setPageState('error');
      }
    };
    load();
  }, [tenantId, eventId, inviteGuestId, stripeSessionId]);

  // ── Validation ──────────────────────────────────────────────────────────
  const validate = () => {
    const e: Record<string, string> = {};
    if (!guest.name.trim())  e.name  = 'Required';
    if (!guest.email.trim()) e.email = 'Required';
    if (guest.email && !/^\S+@\S+\.\S+$/.test(guest.email)) e.email = 'Invalid email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Free RSVP submit ────────────────────────────────────────────────────
  const handleFreeRsvp = async () => {
    if (!validate()) return;
    setPageState('processing');
    try {
      const db   = getDb();
      const code = generateTicketCode();
      const id   = nanoid();
      const newTicket = {
        id,
        eventId,
        tenantId,
        guestName:  guest.name.trim(),
        guestEmail: guest.email.trim().toLowerCase(),
        guestPhone: guest.phone.trim() || null,
        guestId:    inviteGuestId || null,
        type:       'free',
        status:     'rsvpd',
        price:      0,
        amountPaid: 0,
        ticketCode: code,
        source:     inviteGuestId ? 'invite_link' : 'public',
        invitedAt:  null,
        confirmedAt: new Date().toISOString(),
        checkedInAt: null,
        tableNumber: null,
        seatNumber:  null,
      };
      await addDoc(collection(db, `tenants/${tenantId}/eventTickets`), newTicket);

      // ── EMAIL STUB ────────────────────────────────────────────────────────
      // TODO: Wire up Resend when ready.
      // Call your API route: POST /api/notifications/ticket-confirmation
      // Body: { ticket: newTicket, event, tenant, icsAttachment: generateICS(event, newTicket) }
      // See src/app/api/notifications/ticket-confirmation/route.ts (stub file)
      // ─────────────────────────────────────────────────────────────────────

      // ── SMS STUB ──────────────────────────────────────────────────────────
      // TODO: Wire up Twilio when ready.
      // Call your API route: POST /api/notifications/ticket-sms
      // Body: { phone: guest.phone, ticketCode: code, eventName: event.name, eventDate: event.date }
      // See src/app/api/notifications/ticket-sms/route.ts (stub file)
      // ─────────────────────────────────────────────────────────────────────

      setTicket(newTicket);
      setPageState('confirmed');
    } catch (e) {
      console.error(e);
      setErrorMsg('Failed to complete your RSVP. Please try again.');
      setPageState('form');
    }
  };

  // ── Paid checkout (Stripe) ──────────────────────────────────────────────
  const handlePaidCheckout = async () => {
    if (!validate()) return;
    setPageState('processing');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          eventId,
          guestName:  guest.name.trim(),
          guestEmail: guest.email.trim().toLowerCase(),
          guestPhone: guest.phone.trim() || null,
          guestId:    inviteGuestId || null,
          price:      ticketConfig.price,
          eventName:  event.name || event.title,
          ticketName: ticketConfig.ticketName || 'General Admission',
          successUrl: `${window.location.href}?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl:  window.location.href,
        }),
      });
      const { url, error } = await res.json();
      if (error) throw new Error(error);
      window.location.href = url;
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Failed to start checkout. Please try again.');
      setPageState('form');
    }
  };

  const handleSubmit = isPaid ? handlePaidCheckout : handleFreeRsvp;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>

      {/* Hero header */}
      <div className="relative overflow-hidden" style={{ background: primaryHex, minHeight: 260 }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 30% 50%, rgba(255,255,255,0.12) 0%, transparent 70%),
                         radial-gradient(ellipse at 80% 20%, rgba(0,0,0,0.15) 0%, transparent 60%)`,
          }} />
        <div className="relative z-10 max-w-2xl mx-auto px-6 py-10">
          {logoUrl && (
            <img src={logoUrl} alt={tenant?.name} className="h-9 w-auto object-contain mb-6"
              style={{ filter: isDark ? 'brightness(0) invert(1)' : 'brightness(0)' }} />
          )}
          {invitedGuest && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4"
              style={{ background: 'rgba(255,255,255,0.15)' }}>
              <Star className="w-3 h-3" style={{ color: textOn }} />
              <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: textOn }}>
                You've been personally invited
              </p>
            </motion.div>
          )}
          <AnimatePresence mode="wait">
            {pageState !== 'loading' && event && (
              <motion.div key="hero" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <h1 className="text-4xl md:text-5xl font-black leading-none tracking-tight" style={{ color: textOn }}>
                  {event.name || event.title}
                </h1>
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
                  {event.date && (
                    <div className="flex items-center gap-2" style={{ color: `${textOn}99` }}>
                      <Calendar className="w-4 h-4" />
                      <span className="text-sm font-bold">{format(new Date(event.date), 'EEEE, MMMM d, yyyy')}</span>
                    </div>
                  )}
                  {event.time && (
                    <div className="flex items-center gap-2" style={{ color: `${textOn}99` }}>
                      <Clock className="w-4 h-4" />
                      <span className="text-sm font-bold">{event.time}{event.endTime && ` – ${event.endTime}`}</span>
                    </div>
                  )}
                  {event.venue && (
                    <div className="flex items-center gap-2" style={{ color: `${textOn}99` }}>
                      <MapPin className="w-4 h-4" />
                      <span className="text-sm font-bold">{event.venue}</span>
                    </div>
                  )}
                  {capacity && (
                    <div className="flex items-center gap-2" style={{ color: `${textOn}99` }}>
                      <Users className="w-4 h-4" />
                      <span className="text-sm font-bold">{Math.max(0, capacity - ticketCount)} spots left</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-2xl mx-auto px-6 py-10">
        <AnimatePresence mode="wait">

          {/* Loading */}
          {pageState === 'loading' && (
            <motion.div key="load" className="flex justify-center py-20">
              <Loader className="w-8 h-8 animate-spin text-slate-300" />
            </motion.div>
          )}

          {/* Event info + CTA */}
          {pageState === 'event' && event && (
            <motion.div key="event" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="space-y-6">
              {event.description && (
                <div className="bg-white rounded-3xl border-2 border-slate-100 p-6">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-3">About this event</p>
                  <p className="text-slate-700 font-medium leading-relaxed">{event.description}</p>
                </div>
              )}

              {/* Ticket info card */}
              <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-black text-xl text-slate-900">
                      {ticketConfig.ticketName || (isPaid ? 'General Admission' : 'Free Event')}
                    </p>
                    <p className="text-slate-500 text-sm font-bold mt-0.5">
                      {isPaid ? `$${ticketConfig.price?.toFixed(2)} per person` : 'Free to attend'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-black" style={{ color: primaryHex }}>
                      {isPaid ? `$${ticketConfig.price?.toFixed(2)}` : 'Free'}
                    </p>
                    {capacity && <p className="text-[9px] font-bold text-slate-400 mt-0.5">{Math.max(0, capacity - ticketCount)} of {capacity} left</p>}
                  </div>
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setPageState('form')}
                  className="w-full h-14 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2"
                  style={{ background: primaryHex, color: textOn }}>
                  {isPaid ? 'Get Tickets' : 'RSVP Now'} <ChevronRight className="w-4 h-4" />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* RSVP / checkout form */}
          {pageState === 'form' && (
            <motion.div key="form" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="space-y-5">
              <button onClick={() => setPageState('event')}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>

              <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-5">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-1">
                    {isPaid ? 'Checkout' : 'Complete your RSVP'}
                  </p>
                  <h2 className="text-2xl font-black text-slate-900">Your details</h2>
                </div>

                {invitedGuest && (
                  <div className="flex items-center gap-2 p-3 rounded-2xl bg-violet-50 border-2 border-violet-100">
                    <Star className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                    <p className="text-[9px] font-black uppercase tracking-widest text-violet-700">
                      Invited guest — details pre-filled
                    </p>
                  </div>
                )}

                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Full Name</label>
                  <input value={guest.name} onChange={e => setGuest(g => ({ ...g, name: e.target.value }))}
                    placeholder="Your full name"
                    className="w-full h-12 rounded-2xl border-2 border-slate-100 px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-300 placeholder:text-slate-300" />
                  {errors.name && <p className="text-[9px] font-bold text-red-500">{errors.name}</p>}
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-1.5">
                    <Mail className="w-3 h-3" /> Email
                  </label>
                  <input type="email" value={guest.email} onChange={e => setGuest(g => ({ ...g, email: e.target.value }))}
                    placeholder="your@email.com"
                    className="w-full h-12 rounded-2xl border-2 border-slate-100 px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-300 placeholder:text-slate-300" />
                  {errors.email && <p className="text-[9px] font-bold text-red-500">{errors.email}</p>}
                  <p className="text-[8px] font-bold text-slate-400">Your ticket confirmation will be sent here</p>
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-1.5">
                    <Phone className="w-3 h-3" /> Phone <span className="text-slate-300">(optional)</span>
                  </label>
                  <input type="tel" value={guest.phone} onChange={e => setGuest(g => ({ ...g, phone: e.target.value }))}
                    placeholder="(555) 000-0000"
                    className="w-full h-12 rounded-2xl border-2 border-slate-100 px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-300 placeholder:text-slate-300" />
                </div>

                {/* Order summary for paid */}
                {isPaid && (
                  <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Order Summary</p>
                    <div className="flex justify-between text-sm">
                      <span className="font-bold text-slate-600">{ticketConfig.ticketName || 'General Admission'}</span>
                      <span className="font-black text-slate-800">${ticketConfig.price?.toFixed(2)}</span>
                    </div>
                    <div className="border-t border-slate-200 pt-2 flex justify-between">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total</span>
                      <span className="font-black text-slate-900">${ticketConfig.price?.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {errorMsg && (
                  <div className="flex items-center gap-2 p-3 rounded-2xl bg-red-50 border-2 border-red-100">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                    <p className="text-[10px] font-bold text-red-600">{errorMsg}</p>
                  </div>
                )}

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSubmit}
                  className="w-full h-14 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2"
                  style={{ background: primaryHex, color: textOn }}>
                  {isPaid ? 'Proceed to Payment' : 'Confirm RSVP'} <ChevronRight className="w-4 h-4" />
                </motion.button>

                {isPaid && (
                  <p className="text-center text-[9px] font-bold text-slate-400">
                    Secured by Stripe · Your card details are never stored
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {/* Processing */}
          {pageState === 'processing' && (
            <motion.div key="proc" className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader className="w-8 h-8 animate-spin" style={{ color: primaryHex }} />
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {isPaid ? 'Redirecting to checkout…' : 'Confirming your RSVP…'}
              </p>
            </motion.div>
          )}

          {/* Confirmed */}
          {pageState === 'confirmed' && ticket && (
            <motion.div key="conf" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="space-y-6">
              <div className="text-center space-y-2">
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 12, stiffness: 140, delay: 0.1 }}
                  className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
                  style={{ background: `${primaryHex}15`, border: `2px solid ${primaryHex}30` }}>
                  <Check className="w-8 h-8" style={{ color: primaryHex }} />
                </motion.div>
                <h2 className="text-3xl font-black text-slate-900">
                  {isPaid ? "You're in!" : "RSVP Confirmed!"}
                </h2>
                <p className="text-slate-500 font-bold">
                  {isPaid ? `Payment confirmed · ` : ''}See you there{invitedGuest ? `, ${invitedGuest.name?.split(' ')[0]}` : ''}!
                </p>
              </div>

              <TicketCard
                ticket={ticket}
                event={event}
                onDownloadCal={() => downloadICS(event, ticket)}
              />

              <div className="text-center space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  A confirmation has been sent to {ticket.guestEmail}
                </p>
                <p className="text-[9px] font-bold text-slate-400">
                  Present your ticket code at the door: <span className="font-black text-slate-700 font-mono">{ticket.ticketCode}</span>
                </p>
              </div>
            </motion.div>
          )}

          {/* Sold out */}
          {pageState === 'sold_out' && (
            <motion.div key="sold" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="text-center py-16 space-y-4">
              <div className="w-16 h-16 rounded-2xl mx-auto bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
                <Ticket className="w-8 h-8 text-amber-400" />
              </div>
              <h2 className="text-2xl font-black text-slate-900">Sold Out</h2>
              <p className="text-slate-500 font-bold">This event has reached capacity.</p>
            </motion.div>
          )}

          {/* Closed / Error */}
          {(pageState === 'closed' || pageState === 'error') && (
            <motion.div key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="text-center py-16 space-y-4">
              <div className="w-16 h-16 rounded-2xl mx-auto bg-slate-100 border-2 border-slate-200 flex items-center justify-center">
                <X className="w-8 h-8 text-slate-400" />
              </div>
              <h2 className="text-2xl font-black text-slate-900">
                {pageState === 'error' ? 'Something went wrong' : 'Not Available'}
              </h2>
              <p className="text-slate-500 font-bold">{errorMsg}</p>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}