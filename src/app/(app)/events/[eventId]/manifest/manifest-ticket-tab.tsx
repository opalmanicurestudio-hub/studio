'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Ticket, Plus, Search, Check, X, Send, QrCode, Copy,
  Users, UserPlus, Download, ChevronDown, Mail, Phone,
  CheckCircle2, Clock, Ban, AlertTriangle, Loader,
  BarChart3, DollarSign, Star, ExternalLink, Trash2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';

// ─── TYPES ────────────────────────────────────────────────────────────────────
type TicketStatus = 'invited' | 'rsvpd' | 'paid' | 'checked_in' | 'no_show' | 'cancelled';

type EventTicket = {
  id:          string;
  eventId:     string;
  tenantId:    string;
  guestName:   string;
  guestEmail:  string;
  guestPhone?: string;
  guestId?:    string;
  type:        'paid' | 'free' | 'comp';
  status:      TicketStatus;
  price:       number;
  amountPaid:  number;
  ticketCode:  string;
  source:      string;
  confirmedAt?: string;
  checkedInAt?: string;
  invitedAt?:  string;
  tableNumber?: string;
  seatNumber?:  string;
};

type TicketingConfig = {
  type:        'paid' | 'free' | 'comp_only';
  price?:      number;
  capacity?:   number;
  ticketName?: string;
  allowPublicPurchase?: boolean;
  saleFrom?:   string;
  saleUntil?:  string;
};

type Client = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
};

type Props = {
  tenantId:       string;
  eventId:        string;
  tickets:        EventTicket[];
  clients:        Client[];
  ticketingConfig: TicketingConfig;
  onUpdateConfig: (config: TicketingConfig) => Promise<void>;
  onCreateTicket: (ticket: Omit<EventTicket, 'id'>) => Promise<void>;
  onUpdateTicket: (id: string, updates: Partial<EventTicket>) => Promise<void>;
  onDeleteTicket: (id: string) => Promise<void>;
  baseUrl:        string;
};

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<TicketStatus, { label: string; color: string; bg: string; icon: any }> = {
  invited:    { label: 'Invited',    color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200',  icon: Send },
  rsvpd:      { label: 'RSVP\'d',    color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200',      icon: CheckCircle2 },
  paid:       { label: 'Paid',       color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200',icon: DollarSign },
  checked_in: { label: 'Checked In', color: 'text-emerald-700',bg: 'bg-emerald-100 border-emerald-300',icon: Check },
  no_show:    { label: 'No Show',    color: 'text-slate-500',  bg: 'bg-slate-50 border-slate-200',    icon: Ban },
  cancelled:  { label: 'Cancelled',  color: 'text-red-600',    bg: 'bg-red-50 border-red-200',        icon: X },
};

const getInitials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return p.length === 1 ? p[0].slice(0,2).toUpperCase() : (p[0][0]+p[p.length-1][0]).toUpperCase();
};

const generateTicketCode = () => nanoid(8).toUpperCase();

// ─── TICKETING CONFIG PANEL ───────────────────────────────────────────────────
const TicketingConfigPanel = ({
  config, onSave, baseUrl, tenantId, eventId,
}: {
  config: TicketingConfig;
  onSave: (c: TicketingConfig) => Promise<void>;
  baseUrl: string; tenantId: string; eventId: string;
}) => {
  const [local,   setLocal]   = useState(config);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [copied,  setCopied]  = useState(false);

  const publicUrl = `${baseUrl}/events/${tenantId}/${eventId}`;

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(local); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    finally { setSaving(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* Ticket type */}
      <div className="space-y-2">
        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Ticket Type</label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: 'free',      label: 'Free',       sub: 'RSVP only' },
            { id: 'paid',      label: 'Paid',        sub: 'Stripe checkout' },
            { id: 'comp_only', label: 'Comp / Invite', sub: 'Invite only' },
          ] as const).map(opt => (
            <button key={opt.id} onClick={() => setLocal(l => ({ ...l, type: opt.id }))}
              className={cn('p-3 rounded-xl border-2 text-left transition-all',
                local.type === opt.id ? 'border-slate-900 bg-slate-900' : 'border-slate-100 hover:border-slate-200')}>
              <p className={cn('text-[10px] font-black uppercase tracking-tight', local.type === opt.id ? 'text-white' : 'text-slate-700')}>{opt.label}</p>
              <p className={cn('text-[8px] font-bold mt-0.5', local.type === opt.id ? 'text-white/60' : 'text-slate-400')}>{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Price (paid only) */}
      {local.type === 'paid' && (
        <div className="space-y-1.5">
          <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Price per ticket</label>
          <div className="flex items-center h-11 rounded-xl border-2 border-slate-100 overflow-hidden focus-within:border-slate-300">
            <span className="px-3 text-sm font-black text-slate-400 border-r border-slate-100">$</span>
            <input type="number" value={local.price || ''} onChange={e => setLocal(l => ({ ...l, price: parseFloat(e.target.value) || 0 }))}
              placeholder="0.00" className="flex-1 h-full px-3 text-sm font-bold text-slate-800 outline-none bg-transparent" />
          </div>
        </div>
      )}

      {/* Ticket name */}
      <div className="space-y-1.5">
        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Ticket Name</label>
        <input value={local.ticketName || ''} onChange={e => setLocal(l => ({ ...l, ticketName: e.target.value }))}
          placeholder="e.g. General Admission, VIP Seat, Comp Ticket"
          className="w-full h-11 rounded-xl border-2 border-slate-100 px-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-300 placeholder:text-slate-300" />
      </div>

      {/* Capacity */}
      <div className="space-y-1.5">
        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Capacity (optional)</label>
        <input type="number" value={local.capacity || ''} onChange={e => setLocal(l => ({ ...l, capacity: parseInt(e.target.value) || undefined }))}
          placeholder="Leave blank for unlimited"
          className="w-full h-11 rounded-xl border-2 border-slate-100 px-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-300 placeholder:text-slate-300" />
      </div>

      {/* Public access toggle */}
      <div className={cn('flex items-center justify-between p-3 rounded-xl border-2 transition-all cursor-pointer',
        local.allowPublicPurchase ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100')}
        onClick={() => setLocal(l => ({ ...l, allowPublicPurchase: !l.allowPublicPurchase }))}>
        <div>
          <p className={cn('text-[10px] font-black uppercase tracking-widest', local.allowPublicPurchase ? 'text-emerald-700' : 'text-slate-600')}>
            Allow Public Purchase
          </p>
          <p className="text-[8px] font-bold text-slate-400 mt-0.5">Anyone with the link can buy/RSVP</p>
        </div>
        <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center',
          local.allowPublicPurchase ? 'bg-emerald-500 border-emerald-500' : 'border-slate-200')}>
          {local.allowPublicPurchase && <Check className="w-3 h-3 text-white" />}
        </div>
      </div>

      {/* Public event link */}
      {local.allowPublicPurchase && (
        <div className="space-y-1.5">
          <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Public Event Link</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center h-10 rounded-xl border-2 border-slate-100 bg-slate-50 px-3 overflow-hidden">
              <p className="text-[10px] font-bold text-slate-500 truncate">{publicUrl}</p>
            </div>
            <button onClick={copyLink}
              className={cn('h-10 px-3 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all shrink-0',
                copied ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-100 text-slate-500 hover:border-slate-300')}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer"
              className="h-10 px-3 rounded-xl border-2 border-slate-100 text-slate-500 hover:border-slate-300 flex items-center shrink-0">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      <button onClick={handleSave} disabled={saving}
        className={cn('w-full h-10 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
          saved ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white hover:bg-slate-800')}>
        {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : saved ? <><Check className="w-3.5 h-3.5" /> Saved</> : 'Save Config'}
      </button>
    </div>
  );
};

// ─── INVITE FROM CLIENT LOG ────────────────────────────────────────────────────
const InviteFromClientLog = ({
  clients, existingTickets, onInvite, baseUrl, tenantId, eventId, ticketType,
}: {
  clients: Client[];
  existingTickets: EventTicket[];
  onInvite: (clients: Client[]) => Promise<void>;
  baseUrl: string; tenantId: string; eventId: string;
  ticketType: TicketingConfig['type'];
}) => {
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);

  const alreadyInvited = new Set(existingTickets.map(t => t.guestId).filter(Boolean));

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clients.filter(c =>
      !alreadyInvited.has(c.id) &&
      (c.name.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q) || c.phone?.includes(q))
    );
  }, [clients, search, alreadyInvited]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(filtered.map(c => c.id)));
  const clearAll  = () => setSelected(new Set());

  const handleSend = async () => {
    if (selected.size === 0) return;
    setSending(true);
    try {
      const toInvite = clients.filter(c => selected.has(c.id));
      await onInvite(toInvite);
      setSent(true);
      setSelected(new Set());
      setTimeout(() => setSent(false), 3000);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…"
            className="w-full h-10 rounded-xl border-2 border-slate-100 pl-9 pr-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-300 placeholder:text-slate-300" />
        </div>
        {filtered.length > 0 && (
          <button onClick={selected.size === filtered.length ? clearAll : selectAll}
            className="h-10 px-3 rounded-xl border-2 border-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:border-slate-300 shrink-0">
            {selected.size === filtered.length ? 'Clear' : 'All'}
          </button>
        )}
      </div>

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-center py-6 text-[9px] font-black uppercase tracking-widest text-slate-400">
            {clients.length === 0 ? 'No clients in your log yet' : 'No matches'}
          </p>
        )}
        {filtered.map(client => (
          <button key={client.id} onClick={() => toggle(client.id)}
            className={cn('w-full flex items-center gap-3 p-2.5 rounded-xl border-2 transition-all text-left',
              selected.has(client.id) ? 'border-violet-200 bg-violet-50' : 'border-slate-100 hover:border-slate-200')}>
            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0',
              selected.has(client.id) ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500')}>
              {getInitials(client.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-slate-800 truncate">{client.name}</p>
              <p className="text-[9px] font-bold text-slate-400 truncate">{client.email || client.phone || ''}</p>
            </div>
            {selected.has(client.id) && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={handleSend}
          disabled={sending}
          className={cn('w-full h-11 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
            sent ? 'bg-emerald-500 text-white' : 'bg-violet-600 text-white hover:bg-violet-700')}>
          {sending ? <Loader className="w-3.5 h-3.5 animate-spin" /> :
           sent ? <><Check className="w-3.5 h-3.5" /> Invites Created</> :
           <><Send className="w-3.5 h-3.5" /> Send {selected.size} Invite{selected.size !== 1 ? 's' : ''}</>}
        </motion.button>
      )}

      <p className="text-[8px] font-bold text-slate-400 text-center">
        Each invited guest gets a personalized link to {ticketType === 'paid' ? 'purchase their ticket' : 'RSVP'}.
        {'\n'}Email delivery requires Resend to be configured.
      </p>
    </div>
  );
};

// ─── TICKET ROW ───────────────────────────────────────────────────────────────
const TicketRow = ({
  ticket, onCheckIn, onUpdateStatus, onDelete, baseUrl, tenantId, eventId,
}: {
  ticket: EventTicket;
  onCheckIn:      (id: string) => Promise<void>;
  onUpdateStatus: (id: string, status: TicketStatus) => Promise<void>;
  onDelete:       (id: string) => Promise<void>;
  baseUrl: string; tenantId: string; eventId: string;
}) => {
  const [acting,    setActing]    = useState(false);
  const [showMenu,  setShowMenu]  = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const cfg = STATUS_CONFIG[ticket.status];
  const Icon = cfg.icon;

  const inviteUrl = `${baseUrl}/events/${tenantId}/${eventId}?invite=${ticket.guestId || ticket.id}`;

  const handleCheckIn = async () => {
    setActing(true);
    await onCheckIn(ticket.id);
    setActing(false);
  };

  const showQR = async () => {
    if (!qrDataUrl) {
      const url = await QRCode.toDataURL(inviteUrl, { width: 200, margin: 1 });
      setQrDataUrl(url);
    }
    setShowMenu(false);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    setShowMenu(false);
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl border-2 border-slate-100 bg-white hover:border-slate-200 transition-all">
      {/* Avatar */}
      <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-500 shrink-0">
        {getInitials(ticket.guestName)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-black text-slate-800 truncate">{ticket.guestName}</p>
          <span className={cn('px-1.5 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-wide inline-flex items-center gap-1', cfg.bg, cfg.color)}>
            <Icon className="w-2.5 h-2.5" />{cfg.label}
          </span>
          {ticket.type === 'paid' && (
            <span className="text-[8px] font-black text-emerald-600">${ticket.amountPaid?.toFixed(2)}</span>
          )}
        </div>
        <p className="text-[9px] font-bold text-slate-400 truncate">{ticket.guestEmail}</p>
        <p className="text-[8px] font-mono font-bold text-slate-400">{ticket.ticketCode}</p>
        {qrDataUrl && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-2">
            <img src={qrDataUrl} alt="QR" className="w-24 h-24 rounded-lg border border-slate-100" />
            <p className="text-[7px] font-bold text-slate-400 mt-1">Seat QR — print and place at table</p>
          </motion.div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {ticket.status !== 'checked_in' && ticket.status !== 'cancelled' && ticket.status !== 'no_show' && (
          <button onClick={handleCheckIn} disabled={acting}
            className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[8px] font-black uppercase tracking-widest transition-all flex items-center gap-1">
            {acting ? <Loader className="w-3 h-3 animate-spin" /> : <><Check className="w-3 h-3" /> In</>}
          </button>
        )}
        <div className="relative">
          <button onClick={() => setShowMenu(s => !s)}
            className="h-8 w-8 rounded-lg border-2 border-slate-100 hover:border-slate-300 flex items-center justify-center transition-all">
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                className="absolute right-0 top-full mt-1 w-44 bg-white rounded-2xl border-2 border-slate-100 shadow-xl z-20 overflow-hidden">
                <button onClick={copyInviteLink} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50">
                  <Copy className="w-3.5 h-3.5" /> Copy Invite Link
                </button>
                <button onClick={showQR} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50">
                  <QrCode className="w-3.5 h-3.5" /> Show QR Code
                </button>
                <button onClick={() => { onUpdateStatus(ticket.id, 'no_show'); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-amber-600 hover:bg-amber-50">
                  <Ban className="w-3.5 h-3.5" /> Mark No Show
                </button>
                <button onClick={() => { onDelete(ticket.id); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export function ManifestTicketsTab({
  tenantId, eventId, tickets, clients, ticketingConfig,
  onUpdateConfig, onCreateTicket, onUpdateTicket, onDeleteTicket, baseUrl,
}: Props) {
  const [activeSection, setActiveSection] = useState<'overview' | 'guests' | 'invite' | 'config'>('overview');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [addingManual, setAddingManual] = useState(false);
  const [manualForm, setManualForm] = useState({ name: '', email: '', phone: '', type: 'comp' as 'comp' | 'paid' | 'free' });
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:      tickets.length,
    invited:    tickets.filter(t => t.status === 'invited').length,
    confirmed:  tickets.filter(t => ['rsvpd','paid'].includes(t.status)).length,
    checkedIn:  tickets.filter(t => t.status === 'checked_in').length,
    noShow:     tickets.filter(t => t.status === 'no_show').length,
    revenue:    tickets.filter(t => t.status === 'paid').reduce((s,t) => s + (t.amountPaid||0), 0),
    capacity:   ticketingConfig.capacity || null,
  }), [tickets, ticketingConfig]);

  // ── Filtered tickets ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tickets.filter(t =>
      (statusFilter === 'all' || t.status === statusFilter) &&
      (!q || t.guestName.toLowerCase().includes(q) || t.guestEmail.toLowerCase().includes(q) || t.ticketCode.toLowerCase().includes(q))
    );
  }, [tickets, search, statusFilter]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCheckIn = useCallback(async (id: string) => {
    await onUpdateTicket(id, { status: 'checked_in', checkedInAt: new Date().toISOString() });
  }, [onUpdateTicket]);

  const handleUpdateStatus = useCallback(async (id: string, status: TicketStatus) => {
    await onUpdateTicket(id, { status });
  }, [onUpdateTicket]);

  const handleManualAdd = async () => {
    if (!manualForm.name.trim() || !manualForm.email.trim()) return;
    const code = nanoid(8).toUpperCase();
    await onCreateTicket({
      eventId, tenantId,
      guestName:  manualForm.name.trim(),
      guestEmail: manualForm.email.trim().toLowerCase(),
      guestPhone: manualForm.phone.trim() || undefined,
      type:       manualForm.type as any,
      status:     'invited',
      price:      manualForm.type === 'paid' ? (ticketingConfig.price || 0) : 0,
      amountPaid: 0,
      ticketCode: code,
      source:     'manual',
      invitedAt:  new Date().toISOString(),
    });
    setManualForm({ name: '', email: '', phone: '', type: 'comp' });
    setAddingManual(false);
  };

  const handleBulkInvite = async (selectedClients: Client[]) => {
    for (const client of selectedClients) {
      const code = nanoid(8).toUpperCase();
      await onCreateTicket({
        eventId, tenantId,
        guestName:  client.name,
        guestEmail: client.email || '',
        guestPhone: client.phone,
        guestId:    client.id,
        type:       ticketingConfig.type === 'paid' ? 'paid' : 'comp',
        status:     'invited',
        price:      ticketingConfig.type === 'paid' ? (ticketingConfig.price || 0) : 0,
        amountPaid: 0,
        ticketCode: code,
        source:     'invite_link',
        invitedAt:  new Date().toISOString(),
      });
    }
  };

  // ── QR check-in scanner ───────────────────────────────────────────────────
  const handleScanResult = async (code: string) => {
    const found = tickets.find(t => t.ticketCode === code.trim().toUpperCase());
    if (found) {
      if (found.status === 'checked_in') {
        setScanResult(`Already checked in: ${found.guestName}`);
      } else if (found.status === 'cancelled') {
        setScanResult(`Ticket cancelled: ${found.guestName}`);
      } else {
        await handleCheckIn(found.id);
        setScanResult(`✓ Checked in: ${found.guestName}`);
      }
    } else {
      setScanResult('Ticket not found');
    }
    setTimeout(() => { setScanResult(null); setScanning(false); }, 3000);
  };

  return (
    <div className="space-y-5">
      {/* Section tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-2xl p-1">
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'guests',   label: `Guests (${stats.total})` },
          { id: 'invite',   label: 'Invite' },
          { id: 'config',   label: 'Config' },
        ] as const).map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={cn('flex-1 h-8 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all',
              activeSection === s.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {s.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ── OVERVIEW ── */}
        {activeSection === 'overview' && (
          <motion.div key="ov" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: 'Total',      value: stats.total,      color: 'text-slate-800' },
                { label: 'Confirmed',  value: stats.confirmed,  color: 'text-blue-600' },
                { label: 'Checked In', value: stats.checkedIn,  color: 'text-emerald-600' },
                { label: 'Invited',    value: stats.invited,    color: 'text-violet-600' },
                { label: 'No Show',    value: stats.noShow,     color: 'text-slate-500' },
                ...(stats.revenue > 0 ? [{ label: 'Revenue', value: `$${stats.revenue.toFixed(2)}`, color: 'text-emerald-600' }] : []),
              ].map(s => (
                <div key={s.label} className="bg-white rounded-2xl border-2 border-slate-100 p-4">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400 mb-1">{s.label}</p>
                  <p className={cn('text-2xl font-black leading-none', s.color)}>{s.value}</p>
                </div>
              ))}
            </div>

            {stats.capacity && (
              <div className="bg-white rounded-2xl border-2 border-slate-100 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Capacity</p>
                  <p className="text-[10px] font-black text-slate-600">{stats.confirmed + stats.checkedIn} / {stats.capacity}</p>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(100, ((stats.confirmed + stats.checkedIn) / stats.capacity) * 100)}%` }} />
                </div>
                <p className="text-[8px] font-bold text-slate-400">{Math.max(0, stats.capacity - stats.confirmed - stats.checkedIn)} spots remaining</p>
              </div>
            )}

            {/* Quick check-in scanner */}
            <div className="bg-white rounded-2xl border-2 border-slate-100 p-4 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Quick Check-In</p>
              <div className="flex gap-2">
                <input
                  placeholder="Enter ticket code…"
                  className="flex-1 h-10 rounded-xl border-2 border-slate-100 px-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-300 placeholder:text-slate-300 uppercase"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      handleScanResult((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                />
                <button
                  onClick={() => setScanning(s => !s)}
                  className="h-10 px-3 rounded-xl border-2 border-slate-100 text-slate-500 hover:border-slate-300 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest">
                  <QrCode className="w-3.5 h-3.5" /> Scan
                </button>
              </div>
              {scanResult && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  className={cn('px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest',
                    scanResult.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
                  {scanResult}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── GUESTS ── */}
        {activeSection === 'guests' && (
          <motion.div key="gu" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search guests…"
                  className="w-full h-10 rounded-xl border-2 border-slate-100 pl-9 pr-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-300 placeholder:text-slate-300" />
              </div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
                className="h-10 rounded-xl border-2 border-slate-100 px-2 text-[9px] font-black text-slate-600 uppercase outline-none bg-white">
                <option value="all">All</option>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <button onClick={() => setAddingManual(s => !s)}
                className="h-10 px-3 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 shrink-0">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            <AnimatePresence>
              {addingManual && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden">
                  <div className="bg-slate-50 rounded-2xl border-2 border-slate-200 p-4 space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Add Guest Manually</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={manualForm.name} onChange={e => setManualForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Full name *" className="h-9 rounded-xl border-2 border-slate-100 px-3 text-sm font-bold text-slate-700 outline-none col-span-2 placeholder:text-slate-300" />
                      <input type="email" value={manualForm.email} onChange={e => setManualForm(f => ({ ...f, email: e.target.value }))}
                        placeholder="Email *" className="h-9 rounded-xl border-2 border-slate-100 px-3 text-sm font-bold text-slate-700 outline-none placeholder:text-slate-300" />
                      <input type="tel" value={manualForm.phone} onChange={e => setManualForm(f => ({ ...f, phone: e.target.value }))}
                        placeholder="Phone" className="h-9 rounded-xl border-2 border-slate-100 px-3 text-sm font-bold text-slate-700 outline-none placeholder:text-slate-300" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleManualAdd} disabled={!manualForm.name || !manualForm.email}
                        className="flex-1 h-9 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest disabled:opacity-30">
                        Add Guest
                      </button>
                      <button onClick={() => setAddingManual(false)}
                        className="h-9 px-3 rounded-xl border-2 border-slate-200 text-slate-500 text-[9px] font-black uppercase">
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-2">
              {filtered.length === 0 && (
                <div className="text-center py-10 space-y-2">
                  <Users className="w-8 h-8 text-slate-200 mx-auto" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    {tickets.length === 0 ? 'No guests yet — use Invite to add' : 'No matches'}
                  </p>
                </div>
              )}
              {filtered.map(ticket => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  onCheckIn={handleCheckIn}
                  onUpdateStatus={handleUpdateStatus}
                  onDelete={onDeleteTicket}
                  baseUrl={baseUrl}
                  tenantId={tenantId}
                  eventId={eventId}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* ── INVITE ── */}
        {activeSection === 'invite' && (
          <motion.div key="inv" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <InviteFromClientLog
              clients={clients}
              existingTickets={tickets}
              onInvite={handleBulkInvite}
              baseUrl={baseUrl}
              tenantId={tenantId}
              eventId={eventId}
              ticketType={ticketingConfig.type}
            />
          </motion.div>
        )}

        {/* ── CONFIG ── */}
        {activeSection === 'config' && (
          <motion.div key="cf" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <TicketingConfigPanel
              config={ticketingConfig}
              onSave={onUpdateConfig}
              baseUrl={baseUrl}
              tenantId={tenantId}
              eventId={eventId}
            />
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}