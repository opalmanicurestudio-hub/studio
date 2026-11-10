"use client";

/**
 * The deeper tabs of the renter's own page (components/renters/RenterPage draws the header and the tabs): Details
 * (contact, papers, lease, concierge link, portal access, notes, charging their card), Money (statements, Record
 * payment, refunds, the deposit, autopay, payments, amenity orders), Documents, Messages and Activity. Every outside
 * dependency arrives through props; it reads only what each tab shows. In the new look: white cards, sentence-case
 * titles, 44px controls, amber for what needs doing and red only for what can't be undone.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { renterBusinessCard, spacePayAccount } from '@/lib/space-stripe';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { auditEntry } from '@/lib/audit';
import { getDocs, query, where, doc, setDoc, updateDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { Coffee, CreditCard, FileText, Paperclip } from 'lucide-react';
import type { Renter, Lease, Booth } from '@/lib/booth-rental-types';
import { formatCents, RENTER_STATUS_LABELS } from '@/lib/booth-rental-types';
import { buildRenterTimeline, withRunningBalance, TIMELINE_ACTOR_LABEL, type TimelineEntry } from '@/lib/renter-timeline';
import { belongsToRenter } from '@/lib/notice-record';
import { RenterNoticeRecord } from '@/components/renters/RenterNoticeRecord';
import { depositPosition, DEPOSIT_STATUS_LABEL } from '@/lib/deposit-accounting';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { PrintLink } from '@/components/shared/PrintLink';
import { RenterPortalAccess } from '@/components/renters/RenterPortalAccess';
import { RenterRefundDialog } from '@/components/rent/RenterRefundDialog';
import { incidentalsForLease } from '@/lib/incidentals';
import { latestCredential, primaryCredentialIndex, otherCredentials } from '@/lib/compliance';
import { RENTALS_BTN, RENTALS_BTN_DARK } from '@/components/renters/RentalsNav';

// The new look (the renter's own page): white cards, sentence-case titles, 44px controls.
const CARD = 'min-w-0 rounded-[20px] border border-[#ececee] bg-white p-4';
const TITLE = 'text-[15px] font-semibold text-[#16171a]';
const TEXT = 'text-[14px] text-[#16171a]';
const SUB = 'text-[13px] leading-snug text-[#6d7075]';
const ROW = 'flex min-h-[44px] items-center justify-between gap-3 border-t border-[#ececee] py-2.5 first:border-t-0';
const INPUT = 'h-11 min-w-0 rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a] outline-none focus:border-[#16171a]';
/** 2026-12-31 → Dec 31, 2026 (left as it is when it isn't a date). */
const longDay = (v: any) => { const s = String(v || '').slice(0, 10); const d = new Date(`${s}T12:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : String(v || ''); };

const BOOTH_DEFAULT_INCIDENTALS: { label: string; capCents: number }[] = [
  { label: 'Cleaning fee', capCents: 7500 },
  { label: 'Damage', capCents: 50000 },
  { label: 'Lost key / fob', capCents: 2500 },
  { label: 'Late checkout', capCents: 5000 },
  { label: 'Missing product / supplies', capCents: 15000 },
];

// ── Duplicated from the booth hub (byte-for-byte, per repo convention: no
// cross-route imports). If one of these changes there, change it here.
const fmtStamp = (v: any): string => {
  const s = typeof v === 'string' ? v : '';
  if (!s) return '';
  try {
    if (s.length > 10) return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s.slice(0, 16); }
};

const resolveBoothIncidentalPolicy = (tenant: any): { label: string; capCents: number }[] => {
  const saved = tenant?.incidentalCategories;
  return (Array.isArray(saved) && saved.length) ? saved : BOOTH_DEFAULT_INCIDENTALS;
};

const writeBoothAudit = (firestore: any, tenantId: string, e: any) => {
  try {
    const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
    setDoc(aRef, { id: aRef.id, ...auditEntry(e) }).catch(() => {});
  } catch { /* non-fatal */ }
};

function complianceOf(r: any): { items: { label: string; number: string; expiry: string; state: string }[]; worst: string } {
  const judge = (expiry: any): string => {
    if (!expiry) return 'missing';
    const days = Math.floor((new Date(expiry + 'T00:00:00Z').getTime() - Date.now()) / 86400000);
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
    return 'ok';
  };
  const items: { label: string; number: string; expiry: string; state: string; fileUrl?: string; fileName?: string }[] = [];
  const list: any[] = Array.isArray(r.credentials) ? r.credentials.filter((c: any) => c?.label) : [];
  // Insurance and license by the shared rule (lib/compliance): the newest date on file, their own upload or this list.
  for (const kind of ['license', 'insurance'] as const) {
    const on = latestCredential(r, kind);
    const at = primaryCredentialIndex(list, kind); const listed = at >= 0 ? list[at] : null;
    const extra = kind === 'license' ? r.licenseNumber : r.insuranceCarrier;
    if (!on.expiry && !on.docUrl && !listed && !extra) continue;
    items.push({
      label: listed?.label || (kind === 'license' ? 'Professional license' : `Liability insurance${r.insuranceCarrier ? ` (${r.insuranceCarrier})` : ''}`),
      number: listed?.number || (kind === 'license' ? r.licenseNumber || '' : r.insurancePolicyNumber || ''),
      expiry: on.expiry || '', state: judge(on.expiry), fileUrl: on.docUrl || '',
    });
  }
  for (const cr of otherCredentials(list)) {
    items.push({ label: cr.label, number: cr.number || '', expiry: cr.expiry || '', state: judge(cr.expiry), fileUrl: cr.fileUrl || '', fileName: cr.fileName || '' });
  }
  const rank: Record<string, number> = { expired: 0, expiring: 1, missing: 2, ok: 3 };
  const worst = items.length === 0 ? 'none' : items.reduce((w, it) => rank[it.state] < rank[w] ? it.state : w, 'ok');
  return { items, worst };
}


/** The renter's OK for autopay is in place: given (in their portal, or on paper and recorded) and not withdrawn. */
const autopayOk = (r: any) => !!r?.autopayAuthorization?.at && !r.autopayAuthorization.withdrawnAt;
/** Asked before the business turns on automatic rent for a renter who hasn't given their OK in their portal. */
const AUTOPAY_PAPER_OK = (first?: string) => `Turn on automatic rent for ${first || 'this renter'}?\n\nThis charges their card on each due date without asking each time, so it needs their written OK. The simplest way is for them to turn on autopay in their portal, which records it and emails them a copy.\n\nTurn it on here only if they’ve signed an authorization on paper. Choosing OK records that they did.`;

export function RenterProfileDrawer({
  renter, lease, booth, reservations, amenityRequests, w9, tenantId, firestore,
  onClose, onEdit, onLease, onEndLease, contactNote, onSaveNote,
  onRecordPayment, onAddCard, inPage, pageTab,
}: {
  renter: Renter;
  lease?: Lease;
  booth?: Booth;
  reservations: any[];
  amenityRequests?: any[];
  w9: any;
  tenantId: string;
  firestore: any;
  onClose: () => void;
  onEdit: () => void;
  onLease: () => void;
  onEndLease: () => void;
  contactNote?: string;
  onSaveNote?: (note: string) => void;
  onRecordPayment?: (() => void) | null;
  onAddCard?: () => void;
  /** Shown inside the renter's own page (components/renters/RenterPage), which draws its own header and tabs: just
   *  the chosen tab's content, no overlay. */
  inPage?: boolean;
  pageTab?: 'overview' | 'money' | 'documents' | 'messages' | 'activity';
}) {
  const ptab = pageTab || 'overview';
  const [refundOpen, setRefundOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string>(contactNote || '');
  const [chargeAmt, setChargeAmt] = useState('');
  const [chargeCat, setChargeCat] = useState('');
  const [chargeNote, setChargeNote] = useState('');
  const [renterChargingId, setRenterChargingId] = useState<string | null>(null);
  // This charge's name: the same charge asked again (after no answer) keeps it, so it can't go through twice.
  const chargeTry = React.useRef('');
  const { toast: drawerToast } = useToast();
  const { selectedTenant: drawerTenant } = useTenant();
  // The client concierge link for this renter's station carries a signature only the server can make: it's what lets
  // an order from the link be charged to the station. A new link stops the old one charging.
  const stationBoothId = (renter as any)?.amenitiesEnabled && lease?.boothId ? String(lease.boothId) : '';
  const [stationLink, setStationLink] = useState<{ boothId: string; token: string } | null>(null);
  const [stationLinkBusy, setStationLinkBusy] = useState(false);
  const [stationLinkError, setStationLinkError] = useState('');
  const loadStationLink = async (renew: boolean) => {
    if (!stationBoothId || !tenantId) return;
    setStationLinkBusy(true); setStationLinkError('');
    try {
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'station-link', tenantId, boothId: stationBoothId, renew }),
      });
      const d = await res.json().catch(() => ({}));
      if (d?.ok && d.token) {
        setStationLink({ boothId: stationBoothId, token: String(d.token) });
        if (renew) drawerToast({ title: 'New link made', description: 'Share it with the renter. The old link no longer charges this station.' });
      } else setStationLinkError(d?.error || 'The link couldn’t be made. Try again.');
    } catch { setStationLinkError('The link couldn’t be made. Try again.'); }
    finally { setStationLinkBusy(false); }
  };
  useEffect(() => {
    setStationLink(null); setStationLinkError('');
    if (stationBoothId) void loadStationLink(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationBoothId, tenantId, renter?.id]);
  // Constrained to the studio's capped incidentals policy — no made-up charges. A renter on a lease from the builder:
  // only what their signed lease lists, at no more than its cap (lib/incidentals, checked again when it's charged).
  const chargePolicy = incidentalsForLease(resolveBoothIncidentalPolicy(drawerTenant).map((c: any) => ({ label: String(c.label), capCents: Math.round(Number(c.capCents) || 0) })), lease).cats;
  const chargeCatObj = chargePolicy.find((c: any) => c.label === chargeCat) || null;
  const chargeCapCents = chargeCatObj ? Math.round(Number(chargeCatObj.capCents) || 0) : 0;
  const chargeCents = Math.round((parseFloat(chargeAmt) || 0) * 100);
  const chargeOverCap = chargeCapCents > 0 && chargeCents > chargeCapCents;
  const chargeRenterCard = async (rt: Renter) => {
    if (!(chargeCents >= 50) || !chargeCat || chargeOverCap || renterChargingId) return;
    setRenterChargingId(rt.id);
    if (!chargeTry.current) chargeTry.current = Math.random().toString(36).slice(2, 10);
    const key = `${chargeTry.current}-${rt.id}-${chargeCents}-${chargeCat}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
    try {
      // Hardened monthly-renter path: same capped policy as day/hourly renters,
      // enforced server-side (setup-card PUT validates category + cap).
      const res = await fetch('/api/booths/setup-card', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, renterId: rt.id, amountCents: chargeCents, category: chargeCat, note: chargeNote.trim(), key }),
      });
      const d = await res.json();
      // Charged, or the card said no: the next charge is a new attempt.
      if (d.ok || res.status === 402) chargeTry.current = '';
      if (d.ok) {
        // The server records the charge in the activity log, with who made it.
        setChargeAmt(''); setChargeCat(''); setChargeNote('');
        drawerToast({ title: 'Card charged', description: `$${(d.chargedCents / 100).toFixed(2)} for ${chargeCat}, recorded in the ledger.${d.receiptSentTo ? ` Receipt sent to ${d.receiptSentTo}.` : ''}` });
      } else {
        drawerToast({ variant: 'destructive', title: 'Charge failed', description: d.error || 'Try again or collect another way.' });
      }
    } catch {
      drawerToast({ variant: 'destructive', title: 'Network error', description: 'The charge may not have completed — check Stripe before retrying.' });
    }
    finally { setRenterChargingId(null); }
  };
  const [txns, setTxns] = useState<any[] | null>(null);
  // The conversation — live, so a reply shows the moment it lands.
  const [thread, setThread] = useState<any[] | null>(null);
  const [dedAmt, setDedAmt] = useState('');
  const [dedReason, setDedReason] = useState('');
  const [refundArm, setRefundArm] = useState(false);
  const [forfeitArm, setForfeitArm] = useState(false);
  const [depBusy, setDepBusy] = useState(false);
  // A card return Stripe didn't answer: pressing it again asks the same request (lib/rent-deposit), never a second one.
  const [depReq, setDepReq] = useState<{ action: string; leaseId: string; id: string } | null>(null);
  const [dedPhotos, setDedPhotos] = useState<string[]>([]);
  const [docPick, setDocPick] = useState(false);
  useEffect(() => { if (!forfeitArm) return; const t = setTimeout(() => setForfeitArm(false), 5000); return () => clearTimeout(t); }, [forfeitArm]);
  useEffect(() => { if (!refundArm) return; const t = setTimeout(() => setRefundArm(false), 5000); return () => clearTimeout(t); }, [refundArm]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Their messages are marked read once they can be seen: whenever the card is open, or on the page only on Messages.
  const seenRef = React.useRef(!inPage || pageTab === 'messages');
  seenRef.current = !inPage || pageTab === 'messages';
  useEffect(() => {
    if (!firestore || !tenantId || !renter?.id) return;
    const q = query(collection(firestore, 'tenants', tenantId, 'renterThreads', renter.id, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setThread(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      if (seenRef.current) setDoc(doc(firestore, 'tenants', tenantId, 'renterThreads', renter.id), { unreadForOwner: false, ownerSeenAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    }, () => setThread([]));
    return () => unsub();
  }, [firestore, tenantId, renter?.id]);
  useEffect(() => {
    if (!inPage || pageTab !== 'messages' || !firestore || !tenantId || !renter?.id || thread === null) return;
    setDoc(doc(firestore, 'tenants', tenantId, 'renterThreads', renter.id), { unreadForOwner: false, ownerSeenAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  }, [inPage, pageTab, firestore, tenantId, renter?.id, thread === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/booths/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'renter-message', tenantId, renterId: renter.id, text, byName: (drawerTenant as any)?.name || 'The business' }),
      });
      const d = await res.json();
      if (d?.ok) { setDraft(''); setRecordTick((n) => n + 1); drawerToast({ title: 'Sent', description: `${d.emailStatus === 'sent' ? 'Emailed' : ''}${d.emailStatus === 'sent' && d.smsStatus === 'sent' ? ' and ' : ''}${d.smsStatus === 'sent' ? 'texted' : ''}${d.emailStatus !== 'sent' && d.smsStatus !== 'sent' ? 'Saved to the thread — no email or phone on file to deliver to.' : '.'}` }); }
      else drawerToast({ title: 'Not sent', description: d?.error || 'Try again in a moment.' });
    } catch { drawerToast({ title: 'Not sent', description: 'Try again in a moment.' }); }
    setSending(false);
  };

  // The account record — invoices, the rent ledger, every message sent to
  // them, and their maintenance tickets. Read once when the card opens.
  const [record, setRecord] = useState<{ invoices: any[]; ledger: any[]; messages: any[]; tickets: any[] } | null>(null);
  // Read again after a message is sent, so its email and text show how they went (lib/notice-record).
  const [recordTick, setRecordTick] = useState(0);
  useEffect(() => {
    if (!firestore || !tenantId || !renter?.id) return;
    let cancelled = false;
    (async () => {
      const pull = async (col: string, field: string, value: string) => {
        try {
          const snap = await getDocs(query(collection(firestore, 'tenants', tenantId, col), where(field, '==', value)));
          return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        } catch { return []; }
      };
      const [invoices, ledger, byId, tickets] = await Promise.all([
        pull('rentInvoices', 'renterId', renter.id),
        pull('rentLedger', 'renterId', renter.id),
        pull('messageLog', 'recipientId', renter.id),
        pull('tickets', 'renterId', renter.id),
      ]);
      // Messages are also matched by the address they went to — a notice sent
      // against a tour or invoice id still belongs on this person's record.
      const email = String(renter.email || '').trim();
      const digits = String(renter.phone || '').replace(/\D/g, '');
      const addrs = [...new Set([email, email.toLowerCase(), String(renter.phone || '').replace(/[^0-9+]/g, ''), digits.length === 10 ? `+1${digits}` : digits.length > 10 ? `+${digits}` : ''].filter(Boolean))];
      const byAddr = (await Promise.all(addrs.map((a) => pull('messageLog', 'to', a)))).flat();
      const seen = new Set(byId.map((m) => m.id));
      const messages = [...byId, ...byAddr.filter((m) => !seen.has(m.id) && (seen.add(m.id), true))]
        // Only what was sent to them as a renter: not their own messages to their clients, nor mail to them as a client
        // or a team member (lib/notice-record).
        .filter((m) => belongsToRenter(m, renter.id, renter));
      if (!cancelled) setRecord({ invoices, ledger, messages, tickets });
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId, renter?.id, renter?.email, renter?.phone, recordTick]);


  // This renter's day rentals — matched by phone/email
  const myReservations = useMemo(() =>
    reservations.filter(r =>
      (renter.phone && r.phone === renter.phone) ||
      (renter.email && r.email === renter.email)
    ).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
    [reservations, renter.phone, renter.email]);

  // This renter's concierge amenity orders (their clients order to their booth,
  // stamped with renterId). Newest first.
  const myAmenity = useMemo(() =>
    (amenityRequests || [])
      .filter(a => a.renterId && a.renterId === renter.id)
      .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || ''))),
    [amenityRequests, renter.id]);

  // Their rent and space payments: by renter id, or (older lines) recorded against their own lease, rent bills, ledger
  // lines or bookings. Never by name: someone else with the same name is someone else (lib/renter-rent-history).
  const sourceKey = [lease?.id || '', ...(record?.invoices || []).map((i: any) => i.id), ...(record?.ledger || []).map((l: any) => l.id), ...myReservations.map((r: any) => r.id)].filter(Boolean).join(',');
  useEffect(() => {
    if (!firestore || !tenantId || !renter?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const col = collection(firestore, 'tenants', tenantId, 'transactions');
        const found = new Map<string, any>();
        const keep = (docs: any[]) => { for (const d of docs) { const x: any = d.data() || {}; if (x.source === 'booth_rent' || x.rentRefundOf) found.set(d.id, { id: d.id, ...x }); } };
        keep((await getDocs(query(col, where('renterId', '==', renter.id)))).docs);
        const ids = sourceKey ? sourceKey.split(',') : [];
        for (let i = 0; i < ids.length; i += 30) keep((await getDocs(query(col, where('sourceId', 'in', ids.slice(i, i + 30))))).docs);
        if (cancelled) return;
        setTxns([...found.values()].sort((a, b) => ((b.date || b.createdAt || '') + '').localeCompare((a.date || a.createdAt || '') + '')));
      } catch { if (!cancelled) setTxns([]); }
    })();
    return () => { cancelled = true; };
  }, [firestore, tenantId, renter?.id, sourceKey]);

  // A refund to their card (lib/renter-refund) counts against what they paid.
  const dollars = (t: any) => { const v = typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100; return t.type === 'reversal' || t.rentRefundOf ? -Math.abs(v) : v; };
  const dateStr = (v: any) => {
    if (!v) return '';
    if (typeof v === 'string') return v.slice(0, 10);
    if (typeof v?.toDate === 'function') { try { return v.toDate().toISOString().slice(0, 10); } catch { return ''; } }
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toISOString().slice(0, 10);
    return '';
  };
  // Full-precision stamp (keeps the TIME) for events that were actually
  // logged — timelines show the real moment, not just the day.
  const stampStr = (v: any) => {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v?.toDate === 'function') { try { return v.toDate().toISOString(); } catch { return ''; } }
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
    return '';
  };
  const thisYear = new Date().getFullYear().toString();
  const ytdTotal = useMemo(() => {
    const fromTxns = (txns || []).filter(t => dateStr(t.date || t.createdAt).startsWith(thisYear)).reduce((s, t) => s + dollars(t), 0);
    const fromRes = myReservations.filter(r => ['confirmed','checked_in','completed'].includes(r.status) && (r.startDate || '').startsWith(thisYear)).reduce((s, r) => s + (r.amountCents || 0) / 100, 0);
    return fromTxns + fromRes;
  }, [txns, myReservations, thisYear]);

  // Activity timeline: lease events + reservation lifecycle stamps
  const timeline = useMemo(() => withRunningBalance(buildRenterTimeline({
    renter, leases: lease ? [lease] : [], invoices: record?.invoices || [], ledger: record?.ledger || [],
    messages: record?.messages || [], tickets: record?.tickets || [], reservations: myReservations, thread: thread || [],
    boothById: booth ? new Map([[booth.id, booth]]) : undefined,
  })), [renter, lease, booth, record, myReservations, thread]);

  const activity = useMemo(() => {
    const items: { at: string; label: string }[] = [];
    if ((renter as any).appliedAt) items.push({ at: String((renter as any).appliedAt).slice(0, 10), label: 'Applied via website' });
    if (lease) {
      if (lease.startDate) items.push({ at: lease.startDate, label: `Lease started · ${booth?.name ?? ''}` });
      if (lease.endDate) items.push({ at: lease.endDate, label: `Lease ends · ${booth?.name ?? ''}` });
    }
    myReservations.forEach(r => {
      if (r.createdAt) items.push({ at: stampStr(r.createdAt), label: `Booked ${r.boothName} (${r.startDate} → ${r.endDate})` });
      if (r.checked_inAt) items.push({ at: stampStr(r.checked_inAt), label: `Checked in · ${r.boothName}` });
      if (r.completedAt) items.push({ at: stampStr(r.completedAt), label: `Completed stay · ${r.boothName}` });
      if (r.cancelled_refund_pendingAt) items.push({ at: stampStr(r.cancelled_refund_pendingAt), label: `Cancelled — refund pending · ${r.boothName}` });
    });
    // Real logged events — signed lease + every status change with its
    // recorded timestamp (statusHistory is written the moment status changes).
    if ((lease as any)?.signedAt) items.push({ at: stampStr((lease as any).signedAt), label: `Signed lease · ${booth?.name ?? ''}` });
    for (const h of (Array.isArray((renter as any).statusHistory) ? (renter as any).statusHistory : [])) {
      if (h?.at && h?.to) items.push({ at: stampStr(h.at), label: `Status: ${RENTER_STATUS_LABELS[h.from] ?? h.from ?? '—'} → ${RENTER_STATUS_LABELS[h.to] ?? h.to}` });
    }
    // Money events from their ledger — payments recorded (cash, card, Zelle…).
    for (const t of (txns || [])) {
      const at = stampStr(t.date || t.createdAt);
      if (at && (t.type === 'reversal' || t.rentRefundOf)) items.push({ at, label: `Refund to card $${Math.abs(dollars(t)).toFixed(2)}` });
      else if (at && (t.type === 'income' || typeof t.amount === 'number')) {
        items.push({ at, label: `${t.category === 'Booth Rent' || /rent/i.test(t.description || '') ? 'Rent' : t.category || 'Payment'} $${(typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100).toFixed(2)}${t.paymentMethod ? ` · ${t.paymentMethod}` : ''}` });
      }
    }
    return items.filter(i => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  }, [lease, booth, myReservations, renter, txns]);

  // Day rentals they've paid for (shown under Payments and as receipts).
  const paidStays = myReservations.filter(r => ['confirmed', 'checked_in', 'completed'].includes(r.status));

  const body = (
        <div className="space-y-4">
          {ptab === 'overview' && (
            <>
              <section className={CARD}>
                <h3 className={TITLE}>Contact</h3>
                <div className="mt-1 space-y-0.5">
                  {renter.email && <p className={`break-all ${TEXT}`}>{renter.email}</p>}
                  {renter.phone && <p className={TEXT}>{renter.phone}</p>}
                  {renter.specialty && <p className={SUB}>{renter.specialty}</p>}
                  {!renter.email && !renter.phone && <p className={SUB}>No email or phone yet. Add them with Edit.</p>}
                </div>
                {(renter.email || renter.phone) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {renter.phone && <a href={`tel:${renter.phone}`} className={RENTALS_BTN}>Call</a>}
                    {renter.phone && <a href={`sms:${renter.phone}`} className={RENTALS_BTN}>Text</a>}
                    {renter.email && <a href={`mailto:${renter.email}`} className={RENTALS_BTN}>Email</a>}
                  </div>
                )}
                {renter.notes && <p className={`mt-3 border-t border-[#ececee] pt-3 ${SUB}`}>{renter.notes}</p>}
              </section>

              {(() => {
                const comp = complianceOf(renter as any);
                const TONE: Record<string, string> = { ok: 'text-[#1f7a4d]', expiring: 'text-[#b45309]', expired: 'text-[#b45309]', missing: 'text-[#6d7075]' };
                const WORD: Record<string, (d: string) => string> = {
                  ok: d => `valid to ${longDay(d)}`, expiring: d => `expires ${longDay(d)}`, expired: d => `expired ${longDay(d)}`, missing: () => 'no date on file',
                };
                return (
                  <section className={cn(CARD, comp.worst === 'expiring' || comp.worst === 'expired' ? 'bg-[#fff7ed]' : '')}>
                    <h3 className={TITLE}>License, insurance and papers</h3>
                    {comp.items.length === 0 ? (
                      <p className={`mt-1 ${SUB}`}>Nothing on file yet. They can upload their own in the portal, or add them with Edit.</p>
                    ) : (
                      <ul className="mt-1">
                        {comp.items.map((it, i) => (
                          <li key={i} className={ROW}>
                            <span className="min-w-0">
                              <span className={`block ${TEXT}`}>{it.label}{it.number ? ` #${it.number}` : ''}</span>
                              <span className={`block text-[13px] ${TONE[it.state]}`}>{WORD[it.state](it.expiry)}</span>
                            </span>
                            {(it as any).fileUrl && <a href={(it as any).fileUrl} target="_blank" rel="noreferrer" aria-label={`Open the ${it.label}`} className={RENTALS_BTN}><FileText className="mr-1.5 h-4 w-4" aria-hidden /> Open</a>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })()}

              {lease && booth ? (
                <section className={CARD}>
                  <h3 className={TITLE}>Lease · {booth.name}</h3>
                  <p className={SUB}>{formatCents(lease.rentAmountCents)} {lease.frequency || 'monthly'} · {lease.endDate ? `ends ${longDay(lease.endDate)}` : 'month to month'}</p>
                  {(() => {
                    // Automatic rent — the same rule the autopay job uses: the renter's own autopay, OR this lease set to
                    // auto-collect, with a saved card. One plain line; a switch only when it's the owner's call.
                    // A card autopay can charge: saved on the business's own account (lib/space-stripe).
                    const r: any = renter; const hasCard = !!renterBusinessCard(r, spacePayAccount(drawerTenant));
                    if (r.autopayEnabled === true) return <p className={`mt-2 ${SUB}`}>Rent is paid automatically: they set up autopay.</p>;
                    if (!hasCard) return <p className={`mt-2 ${SUB}`}>{r.cardOnFile ? 'To charge rent automatically, they need to save their card again in their portal first.' : 'To charge rent automatically, they need to save a card in their portal first.'}</p>;
                    const on = (lease as any).autoCollect === true;
                    const flip = async () => {
                      // Charging a card on each due date needs the renter's written OK: they give it in their portal
                      // (autopay), or on paper, which is recorded here.
                      const paperNeeded = !on && !autopayOk(r);
                      if (paperNeeded && !window.confirm(AUTOPAY_PAPER_OK(r.firstName))) return;
                      try {
                        // Their OK is recorded first, so charging is never on without it.
                        if (paperNeeded) await updateDoc(doc(firestore, 'tenants', tenantId, 'renters', r.id), { autopayAuthorization: { method: 'paper', at: new Date().toISOString(), recordedBy: 'business' } });
                        await setDoc(doc(firestore, 'tenants', tenantId, 'leases', (lease as any).id), { autoCollect: !on, updatedAt: new Date().toISOString() }, { merge: true });
                        writeBoothAudit(firestore, tenantId, { action: 'booth.autocollect_' + (!on ? 'on' : 'off'), targetType: 'lease', targetId: (lease as any).id,
                          summary: `Rent charged automatically turned ${!on ? 'on' : 'off'} for ${`${r.firstName || ''} ${r.lastName || ''}`.trim() || 'a renter'}` });
                      } catch { window.alert('That didn’t save. Try again.'); }
                    };
                    return (
                      <div className="mt-2 flex min-h-[44px] items-center justify-between gap-3 border-t border-[#ececee] pt-2">
                        <p id="rpd-collect" className={TEXT}>{on ? 'Rent is charged to their card automatically on each due date.' : 'Charge rent to their card automatically'}</p>
                        <button type="button" role="switch" aria-checked={on} aria-label="Charge rent to their card automatically" aria-describedby="rpd-collect" onClick={() => void flip()}
                          className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center">
                          <span className={cn('relative h-7 w-12 rounded-full transition-colors', on ? 'bg-[#1f7a4d]' : 'bg-[#6d7075]')}>
                            <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left]" style={{ left: on ? 22 : 2 }} />
                          </span>
                        </button>
                      </div>);
                  })()}
                  <div className="mt-2 flex flex-wrap gap-2 border-t border-[#ececee] pt-3">
                    <button type="button" onClick={onEndLease} className={cn(RENTALS_BTN, 'text-[#b42318]')}>End lease</button>
                  </div>
                </section>
              ) : (
                <section className={CARD}>
                  <h3 className={TITLE}>No lease</h3>
                  <p className={SUB}>They don’t hold a space right now.</p>
                  <button type="button" onClick={onLease} className={`mt-3 ${RENTALS_BTN_DARK}`}>Write the lease</button>
                </section>
              )}

              {stationBoothId && (() => {
                const token = stationLink?.boothId === stationBoothId ? stationLink.token : '';
                const link = token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/concierge/${tenantId}?booth=${encodeURIComponent(stationBoothId)}&k=${encodeURIComponent(token)}` : '';
                return (
                  <section className={CARD}>
                    <h3 className={`flex items-center gap-1.5 ${TITLE}`}><Coffee className="h-4 w-4" aria-hidden /> Client concierge</h3>
                    <p className={`mt-1 ${SUB}`}>Their clients scan or open this to order amenities to {booth?.name || 'their space'}. {(renter as any).amenityPayer === 'client' ? 'The client pays for anything over the free allowance.' : 'Extras are charged to this renter’s card.'}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <input readOnly value={link || (stationLinkBusy ? 'Making the link…' : '')} aria-label="Concierge link" className={`flex-1 truncate font-mono ${INPUT}`} onFocus={(e) => e.currentTarget.select()} />
                      <button type="button" onClick={() => { if (link) navigator.clipboard?.writeText(link).catch(() => {}); }} disabled={!link} className={RENTALS_BTN_DARK}>Copy</button>
                    </div>
                    {stationLinkError && <p role="alert" className="mt-1 text-[13px] text-[#b45309]">{stationLinkError}</p>}
                    <button type="button"
                      onClick={() => { if (window.confirm('Make a new link for this space?\n\nThe current link will still open the menu, but orders from it can no longer be charged to them. Share the new link with the renter.')) void loadStationLink(true); }}
                      disabled={stationLinkBusy} className={`mt-2 ${RENTALS_BTN}`}>
                      Make a new link
                    </button>
                  </section>
                );
              })()}
              <RenterPortalAccess tenantId={tenantId} renter={renter} />

              {onSaveNote && (
                <section className={CARD}>
                  <label htmlFor="renter-notes" className={TITLE}>Notes</label>
                  <textarea id="renter-notes" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onBlur={() => { if ((noteDraft || '') !== (contactNote || '')) onSaveNote(noteDraft); }} rows={2}
                    placeholder="Private notes about them, kept from their first visit on." className="mt-2 w-full resize-none rounded-xl border border-[#ececee] px-3 py-2.5 text-[15px] text-[#16171a] outline-none focus:border-[#16171a]" />
                </section>
              )}

              {(renter as any).cardOnFile ? (
                <section className={CARD}>
                  <h3 className={TITLE}>Charge their card</h3>
                  <p className={SUB}>{(renter as any).cardBrand ? `${(renter as any).cardBrand} ····${(renter as any).cardLast4}` : 'Card on file'}. Only the charges your policies allow, each up to its limit.</p>
                  <div className="mt-2 space-y-2">
                    <select value={chargeCat} aria-label="What the charge is for"
                      onChange={e => { setChargeCat(e.target.value); const c = chargePolicy.find((x: any) => x.label === e.target.value); if (c && c.capCents > 0 && chargeCents > c.capCents) setChargeAmt((c.capCents / 100).toFixed(0)); }}
                      className={`w-full ${INPUT}`}>
                      <option value="">What is it for?</option>
                      {chargePolicy.map((c: any) => (
                        <option key={c.label} value={c.label}>{c.label}{c.capCents > 0 ? `, up to $${(c.capCents / 100).toFixed(0)}` : ''}</option>
                      ))}
                    </select>
                    <div className="grid grid-cols-[110px_1fr] gap-2">
                      <input type="number" inputMode="decimal" placeholder="$" aria-label="Amount" value={chargeAmt} onChange={e => setChargeAmt(e.target.value)}
                        className={cn(INPUT, 'w-full', chargeOverCap ? 'border-[#b45309]' : '')} />
                      <input type="text" placeholder="Note (optional)" aria-label="Note" value={chargeNote} onChange={e => setChargeNote(e.target.value)} className={`w-full ${INPUT}`} />
                    </div>
                    {chargeOverCap && <p role="alert" className="text-[13px] text-[#b45309]">That’s over the ${(chargeCapCents / 100).toFixed(0)} limit for {chargeCat}.</p>}
                    <button type="button" onClick={() => chargeRenterCard(renter)}
                      disabled={!(chargeCents >= 50) || !chargeCat || chargeOverCap || renterChargingId === renter.id} className={`w-full ${RENTALS_BTN_DARK}`}>
                      {renterChargingId === renter.id ? 'Charging…' : `Charge the card${chargeCents >= 50 ? ` $${(chargeCents / 100).toFixed(2)}` : ''}`}
                    </button>
                    <p className={SUB}>It’s charged without them present and kept in your books as a renter charge.</p>
                  </div>
                </section>
              ) : (
                <section className={CARD}>
                  <h3 className={TITLE}>No card on file</h3>
                  <p className={SUB}>It’s saved the first time they pay rent online, or they can add one in their portal. Then the charges your policies allow can be made from here.</p>
                </section>
              )}
            </>
          )}

          {ptab === 'money' && (
            <>
              <section className={CARD}>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className={SUB}>Paid in {thisYear}</p>
                    <p className="text-[28px] font-bold leading-9 tabular-nums text-[#16171a]">${ytdTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <button type="button" onClick={() => setDocPick((v) => !v)} aria-expanded={docPick} className={RENTALS_BTN}>Statements</button>
                </div>
                {docPick && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {([
                      ['Account statement', '', 'Balance, every charge and payment, with a remittance slip'],
                      ['Full account record', 'full', 'The statement plus every notice, message, ticket and change'],
                      ['Deposit accounting', 'deposit', 'Held, deductions with reasons and photos, what comes back'],
                      ['Move-out statement', 'final', 'What is owed, the deposit, and which way the money goes'],
                    ] as const).map(([label, mode, note]) => (
                      <PrintLink key={label} path="/api/booths/account-statement" params={{ tenantId, renterId: renter.id, mode }} className="block min-h-[44px] rounded-xl border border-[#ececee] bg-white px-3 py-2.5 hover:bg-[#f5f5f7]">
                        <span className={`block font-medium ${TEXT}`}>{label}</span>
                        <span className={`block ${SUB}`}>{note}</span>
                      </PrintLink>
                    ))}
                    <PrintLink path="/api/booths/statement" params={{ tenantId, renterId: renter.id, year: thisYear }} className="block min-h-[44px] rounded-xl border border-[#ececee] bg-white px-3 py-2.5 hover:bg-[#f5f5f7] sm:col-span-2">
                      <span className={`block font-medium ${TEXT}`}>{thisYear} statement</span>
                      <span className={`block ${SUB}`}>Total rent paid this year, for their bookkeeping</span>
                    </PrintLink>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2 border-t border-[#ececee] pt-3">
                  {onRecordPayment && <button type="button" onClick={onRecordPayment} className={RENTALS_BTN_DARK}>Record payment</button>}
                  {(renter as any).cardOnFile ? (
                    <span className={`inline-flex min-h-[44px] items-center ${SUB}`}><CreditCard className="mr-1.5 h-4 w-4" aria-hidden /> {(renter as any).cardBrand || 'Card'} ····{(renter as any).cardLast4 || ''} on file</span>
                  ) : onAddCard ? (
                    <button type="button" onClick={onAddCard} className={RENTALS_BTN}><CreditCard className="mr-1.5 h-4 w-4" aria-hidden /> Add a card</button>
                  ) : null}
                  <button type="button" onClick={() => setRefundOpen(true)} className={RENTALS_BTN}>Refund a payment</button>
                </div>
              </section>
              <RenterRefundDialog open={refundOpen} onOpenChange={setRefundOpen} tenantId={tenantId} renter={renter}
                onDone={(m) => drawerToast({ title: 'Refunded', description: m })} />

              {lease && (() => {
                const dep = depositPosition(lease, record?.ledger || []);
                if (dep.status === 'none') return null;
                // Recorded on the server (api/rent/deposit, lib/rent-deposit): checked against the deposit as it stands,
                // written once, in the books, and the renter is told in writing.
                // Paid by card from their portal: a return goes back to that card (lib/rent-deposit refundDepositToCard).
                const paidByCard = (record?.ledger || []).some((l: any) => l.leaseId === lease.id && l.type === 'deposit_charge' && l.status === 'paid' && l.stripePaymentIntentId);
                const write = async (type: string, cents: number, description: string, evidenceUrls: string[] = []): Promise<boolean> => {
                  if (!tenantId || cents <= 0 || depBusy) return false;
                  const action = type === 'deposit_charge' ? 'received' : type === 'deposit_deduction' ? 'deduct' : type === 'deposit_refund' ? 'refund' : 'apply';
                  setDepBusy(true);
                  const reqId = depReq?.action === action && depReq.leaseId === lease.id ? depReq.id : crypto.randomUUID();
                  try {
                    const d: any = await fetch('/api/rent/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tenantId, leaseId: lease.id, action, cents, reason: action === 'deduct' ? description : '', evidenceUrls, requestId: reqId, toCard: action === 'refund' && paidByCard }) })
                      .then((r) => r.json()).catch(() => null);
                    // No answer from Stripe: the same request is asked again on the next tap, so it can't go back twice.
                    if (!d || d.retry) { setDepReq({ action, leaseId: lease.id, id: reqId }); drawerToast({ title: 'Not sure yet', description: d?.error || 'We couldn’t tell whether it went through. Press it again: it won’t happen twice.' }); return false; }
                    setDepReq(null);
                    if (!d?.ok) { drawerToast({ variant: 'destructive', title: 'Not recorded', description: d?.error || 'Nothing was saved. Try again.' }); return false; }
                    const nowIso = new Date().toISOString();
                    setRecord((r) => r ? { ...r, ledger: [...r.ledger.filter((l: any) => !(action === 'received' && l.type === 'deposit_charge' && l.status !== 'paid')),
                      { id: d.lineId, leaseId: lease.id, type, status: 'paid', amountCents: type === 'deposit_deduction' || type === 'deposit_charge' ? d.cents : -d.cents, description, evidenceUrls, createdAt: nowIso }] } : r);
                    if (d.sentTo) drawerToast({ title: 'Notice sent', description: `${d.sentTo}.` });
                    return true;
                  } finally { setDepBusy(false); }
                };
                return (
                  <section className={CARD}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className={TITLE}>Deposit</h3>
                        <p className={SUB}>
                          {DEPOSIT_STATUS_LABEL[dep.status]}{dep.refundingCents > 0 ? ` · ${formatCents(dep.refundingCents)} on its way to their card` : ''} · agreed {formatCents(dep.agreedCents)}{dep.refundable ? '' : ' · non-refundable'}
                          {dep.conditions ? ` · ${dep.conditions}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={SUB}>Comes back</p>
                        <p className="text-[20px] font-bold leading-7 tabular-nums text-[#16171a]">{formatCents(dep.returnableCents)}</p>
                      </div>
                    </div>
                    {dep.status === 'not_collected' && (
                      <button type="button" disabled={depBusy} onClick={() => write('deposit_charge', dep.agreedCents, 'Deposit collected')} className={`mt-3 w-full ${RENTALS_BTN_DARK}`}>
                        Record the deposit received · {formatCents(dep.agreedCents)}
                      </button>
                    )}
                    {dep.deductions.length > 0 && (
                      <ul className="mt-2">
                        {dep.deductions.map((d) => (
                          <li key={d.id} className={ROW}>
                            <p className={`min-w-0 ${TEXT}`}>
                              {d.reason}<span className="text-[#6d7075]"> · {longDay(d.at)}</span>
                              {(d.evidenceUrls || []).length > 0 && (
                                <span className="ml-1.5 text-[#6d7075]">
                                  {d.evidenceUrls!.map((u, i) => <a key={u} href={u} target="_blank" rel="noopener" className="mr-1 underline">photo {i + 1}</a>)}
                                </span>
                              )}
                            </p>
                            <p className={`shrink-0 tabular-nums ${TEXT}`}>−{formatCents(d.cents)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(dep.status === 'held' || dep.status === 'partly_returned') && (
                      <div className="mt-3 space-y-2 border-t border-[#ececee] pt-3">
                        <p className={`font-medium ${TEXT}`}>Keep part of it</p>
                        <div className="flex flex-wrap gap-2">
                          <input value={dedAmt} onChange={(e) => setDedAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" aria-label="Amount to keep" className={`w-28 ${INPUT}`} />
                          <input value={dedReason} onChange={(e) => setDedReason(e.target.value.slice(0, 120))} placeholder="Reason, shown on their statement" aria-label="Reason" className={`min-w-0 flex-1 basis-48 ${INPUT}`} />
                          <button type="button" disabled={!(Number(dedAmt) > 0) || !dedReason.trim() || depBusy}
                            onClick={async () => { if (!(await write('deposit_deduction', Math.round(Number(dedAmt) * 100), dedReason.trim(), dedPhotos))) return; setDedAmt(''); setDedReason(''); setDedPhotos([]); drawerToast({ title: 'Deduction recorded', description: dedPhotos.length ? `${dedPhotos.length} photo${dedPhotos.length === 1 ? '' : 's'} attached.` : undefined }); }}
                            className={RENTALS_BTN}>
                            Keep it
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <ImageUpload multiple clearOnUpload enableMarkup={false} storageFolder="renters"
                            onImageUploaded={(url) => { if (url && !url.startsWith('data:')) setDedPhotos((p) => [...p, url]); }} />
                          {dedPhotos.map((u, i) => (
                            <a key={u} href={u} target="_blank" rel="noopener" className="h-11 w-11 overflow-hidden rounded-lg border border-[#ececee]">
                              <img src={u} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                            </a>
                          ))}
                          {dedPhotos.length > 0 && <span className={SUB}>Attached to the next deduction</span>}
                        </div>
                        <div className="flex flex-wrap gap-2 border-t border-[#ececee] pt-3" aria-live="polite">
                          <button type="button" disabled={dep.returnableCents <= 0 || depBusy}
                            onClick={() => { if (refundArm) { void write('deposit_refund', dep.returnableCents, 'Deposit refunded').then((ok) => { if (ok) drawerToast({ title: paidByCard ? 'Returned to their card' : 'Refund recorded', description: paidByCard ? 'It usually shows on their card within 5 to 10 business days. They’re told, with every deduction listed.' : 'Move the money by whatever means you use. This records that you did, with every deduction listed for them.' }); }); setRefundArm(false); } else setRefundArm(true); }}
                            className={cn(refundArm ? RENTALS_BTN_DARK : RENTALS_BTN, 'w-full py-2.5 text-center leading-snug sm:w-auto')}>
                            {refundArm ? (paidByCard ? `Tap again to return ${formatCents(dep.returnableCents)} to their card` : `Tap again to record ${formatCents(dep.returnableCents)} returned`) : `Return ${formatCents(dep.returnableCents)}${paidByCard ? ' to their card' : ''}`}
                          </button>
                          <button type="button" disabled={dep.returnableCents <= 0 || depBusy}
                            title="Put the deposit toward what they owe instead of returning it"
                            onClick={() => { if (forfeitArm) { void write('deposit_forfeit', dep.returnableCents, 'Deposit applied to balance').then((ok) => { if (ok) drawerToast({ title: 'Deposit put toward what they owe', description: 'It’s a credit on their account and comes off their open rent now.' }); }); setForfeitArm(false); } else setForfeitArm(true); }}
                            className={cn(forfeitArm ? 'inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#b42318] px-4 text-[15px] font-semibold text-white disabled:opacity-40' : cn(RENTALS_BTN, 'text-[#b42318]'), 'w-full py-2.5 text-center leading-snug sm:w-auto')}>
                            {forfeitArm ? 'Tap again to put it toward what they owe' : 'Put it toward what they owe'}
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })()}

              {(() => {
                const r: any = renter;
                const hasCard = !!(r.cardOnFile && renterBusinessCard(r, spacePayAccount(drawerTenant)));
                const on = r.autopayEnabled === true;
                const toggle = async () => {
                  if (!hasCard && !on) { drawerToast({ title: 'No card on file', description: 'Autopay needs a saved card to charge. They can add one in their portal.' }); return; }
                  // Autopay needs the renter's written OK: given in their portal, or on paper and recorded here.
                  const paper = !on && !autopayOk(r);
                  if (paper && !window.confirm(AUTOPAY_PAPER_OK(r.firstName))) return;
                  try {
                    // A paper OK replaces any earlier authorization whole (a withdrawn one leaves nothing behind on it), and
                    // is recorded first, so autopay is never on without it.
                    if (paper) await updateDoc(doc(firestore, 'tenants', tenantId, 'renters', r.id), { autopayAuthorization: { method: 'paper', at: new Date().toISOString(), recordedBy: 'business' } });
                    await setDoc(doc(firestore, 'tenants', tenantId, 'renters', r.id), {
                      autopayEnabled: !on,
                      autopayChangedAt: new Date().toISOString(),
                      autopayChangedBy: 'owner',
                    }, { merge: true });
                    writeBoothAudit(firestore, tenantId, {
                      action: !on ? 'renter.autopay_on' : 'renter.autopay_off', targetType: 'renter', targetId: r.id,
                      summary: `${!on ? 'Turned on' : 'Turned off'} autopay for ${r.firstName || ''} ${r.lastName || ''}`.trim(),
                      actor: { type: 'user' },
                    });
                    drawerToast({ title: !on ? 'Autopay on' : 'Autopay off', description: !on ? 'Rent is charged on each due day to the card on file.' : 'They pay by hand from now on.' });
                  } catch {
                    drawerToast({ title: 'Could not save', description: 'Try again in a moment.' });
                  }
                };
                return (
                  <section className={cn(CARD, 'flex items-center justify-between gap-3')}>
                    <span className="min-w-0">
                      <span className={`block ${TITLE}`}>Autopay</span>
                      <span id="rpd-autopay" className={`block ${SUB}`}>
                        {on
                          ? `Rent is charged on each due day to ${r.cardBrand || 'the card'} ····${r.cardLast4 || ''}.`
                          : hasCard ? `Off: they pay by hand. Card ····${r.cardLast4 || ''} is on file if you turn it on.`
                          : r.cardOnFile ? 'Off: their card has to be saved again in their portal before autopay can use it.'
                          : 'Off: no card on file yet.'}
                      </span>
                    </span>
                    <button type="button" role="switch" aria-checked={on} aria-label="Autopay" aria-describedby="rpd-autopay" onClick={() => void toggle()} className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center">
                      <span className={cn('relative h-7 w-12 rounded-full transition-colors', on ? 'bg-[#1f7a4d]' : 'bg-[#6d7075]')}>
                        <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left]" style={{ left: on ? 22 : 2 }} />
                      </span>
                    </button>
                  </section>
                );
              })()}

              <section className={CARD}>
                <h3 className={TITLE}>Payments</h3>
                {txns === null ? <p className={`py-2 ${SUB}`}>Loading…</p> : (txns.length + paidStays.length) === 0 ? <p className={`py-2 ${SUB}`}>No payments on record.</p> : (
                  <ul className="mt-1">
                    {paidStays.map(r => (
                      <li key={r.id} className={ROW}>
                        <span className="min-w-0">
                          <span className={`block truncate ${TEXT}`}>Day rental · {r.boothName}</span>
                          <span className={`block ${SUB}`}>{r.startDate === r.endDate ? longDay(r.startDate) : `${longDay(r.startDate)} to ${longDay(r.endDate)}`}</span>
                        </span>
                        <span className={`shrink-0 tabular-nums ${TEXT}`}>${((r.amountCents || 0) / 100).toFixed(2)}</span>
                      </li>
                    ))}
                    {txns.map(t => (
                      <li key={t.id} className={ROW}>
                        <span className="min-w-0">
                          <span className={`block truncate ${TEXT}`}>{t.description || 'Rent'}</span>
                          <span className={`block truncate ${SUB}`}>
                            {(() => { try { return new Date(t.date || t.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return dateStr(t.date || t.createdAt); } })()}
                            {t.paymentMethod ? ` · ${t.paymentMethod}` : ''}
                          </span>
                        </span>
                        <span className={cn('shrink-0 tabular-nums text-[14px]', dollars(t) < 0 ? 'text-[#6d7075]' : 'text-[#16171a]')}>{dollars(t) < 0 ? '−' : ''}${Math.abs(dollars(t)).toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {myAmenity.length > 0 && (
                <section className={CARD}>
                  <h3 className={TITLE}>Amenity orders · {myAmenity.length}</h3>
                  <ul className="mt-1">
                    {myAmenity.slice(0, 20).map((a: any) => {
                      const when = (() => { try { return new Date(a.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; } })();
                      const tag = a.compedByRenter ? { t: 'Covered by them', c: 'bg-[#ecf6f0] text-[#1f7a4d]' }
                        : a.chargedToStation ? { t: 'Charged to their card', c: 'bg-[#f5f5f7] text-[#16171a]' }
                        : (Number(a.priceAtRequest) > 0 ? { t: 'Client paid', c: 'bg-[#ecf6f0] text-[#1f7a4d]' } : { t: 'Free', c: 'bg-[#f5f5f7] text-[#6d7075]' });
                      const statusTag = a.status === 'delivered' ? 'Delivered' : a.status === 'cancelled' ? 'Cancelled' : 'Waiting';
                      return (
                        <li key={a.id} className={ROW}>
                          <span className="min-w-0">
                            <span className={`block truncate ${TEXT}`}>{a.quantity > 1 ? `${a.quantity} × ` : ''}{a.itemName || 'Amenity'}</span>
                            <span className={`block truncate ${SUB}`}>{when}{a.clientName ? ` · ${a.clientName}` : ''} · {statusTag}</span>
                          </span>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ${tag.c}`}>{tag.t}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}

          {ptab === 'documents' && (
            <>
              {w9 === undefined ? (
                <section className={CARD}><p className={SUB}>Checking for a W-9…</p></section>
              ) : (
                <section className={cn(CARD, w9 ? '' : 'bg-[#fff7ed]')}>
                  <h3 className={TITLE}>{w9 ? 'W-9 on file' : 'No W-9 yet'}</h3>
                  {w9 ? <p className={SUB}>{w9.legalName} · TIN {w9.tinMasked}</p> : <p className="text-[13px] leading-snug text-[#b45309]">They add it in their portal, under Space, then Tax form (W-9).</p>}
                </section>
              )}
              <RenterSignedDocs tenantId={tenantId} firestore={firestore} renterId={renter.id} />
              {Array.isArray((renter as any).applicationAttachments) && (renter as any).applicationAttachments.length > 0 && (
                <section className={CARD}>
                  <h3 className={TITLE}>From their application</h3>
                  <ul className="mt-1">
                    {(renter as any).applicationAttachments.map((at: any) => (
                      <li key={at.url} className={ROW}>
                        <span className={`flex min-w-0 items-center gap-1.5 ${TEXT}`}><Paperclip className="h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0 truncate">{at.label || at.name || 'Document'}</span></span>
                        <a href={at.url} target="_blank" rel="noreferrer" aria-label={`Open ${at.label || at.name || 'the document'}`} className={RENTALS_BTN}>Open</a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className={CARD}>
                <h3 className={TITLE}>Yearly statements</h3>
                <ul className="mt-1">
                  {[new Date().getFullYear(), new Date().getFullYear() - 1].map(yr => (
                    <li key={yr} className={ROW}>
                      <span className={TEXT}>{yr} rent statement</span>
                      <PrintLink path="/api/booths/statement" params={{ tenantId, renterId: renter.id, year: yr }} ariaLabel={`Open the ${yr} rent statement`} className={RENTALS_BTN}>Open</PrintLink>
                    </li>
                  ))}
                </ul>
              </section>
              {paidStays.length > 0 && (
                <section className={CARD}>
                  <h3 className={TITLE}>Receipts</h3>
                  <ul className="mt-1">
                    {paidStays.map(r => (
                      <li key={r.id} className={ROW}>
                        <span className={`min-w-0 truncate ${TEXT}`}>{r.boothName} · {longDay(r.startDate)}</span>
                        <PrintLink path="/api/booths/receipt" params={{ tenantId, type: 'reservation', id: r.id }} ariaLabel={`Receipt for ${r.boothName}, ${longDay(r.startDate)}`} className={RENTALS_BTN}><FileText className="mr-1.5 h-4 w-4" aria-hidden /> Receipt</PrintLink>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {ptab === 'messages' && (
            <div className="flex flex-col gap-4">
              <RenterNoticeRecord tenantId={tenantId} renter={renter} rows={record ? record.messages : null} thread={thread} />
              <section className={CARD}>
                <label htmlFor="renter-compose" className={TITLE}>Write to {renter.firstName || 'them'}</label>
                <div className="mt-2 flex gap-2">
                  <textarea id="renter-compose" value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 2000))} rows={2}
                    placeholder="It goes by email and text, and stays in their portal."
                    className="flex-1 rounded-xl border border-[#ececee] px-3.5 py-2.5 text-[15px] text-[#16171a] outline-none focus:border-[#16171a]" />
                  <button type="button" onClick={sendMessage} disabled={sending || !draft.trim()} className={`self-end ${RENTALS_BTN_DARK}`}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </section>
            </div>
          )}

          {ptab === 'activity' && (
            record === null ? <section className={CARD}><p className={SUB}>Reading the account…</p></section>
            : timeline.length === 0 ? <section className={CARD}><p className={SUB}>{activity.length ? 'Loading…' : 'No activity yet.'}</p></section> : (
              <section className={CARD}>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                  <p className={SUB}>{timeline.length} events: money, notices, tickets and changes</p>
                  <PrintLink path="/api/booths/account-statement" params={{ tenantId, renterId: renter.id, mode: 'full' }} className={RENTALS_BTN}>Print the full record</PrintLink>
                </div>
                <ol>
                  {timeline.map((e, i) => {
                    const tone = ({
                      late_fee: 'bg-[#b45309]', autopay_failed: 'bg-[#b45309]', barred: 'bg-[#16171a]', notice: 'bg-[#b45309]',
                      payment: 'bg-[#1f7a4d]', part_payment: 'bg-[#1f7a4d]', autopay_ok: 'bg-[#1f7a4d]', credit: 'bg-[#1f7a4d]',
                      write_off: 'bg-[#6d7075]', ticket_opened: 'bg-[#b45309]', ticket_resolved: 'bg-[#1f7a4d]',
                      message_in: 'bg-[#6d7075]', message_out: 'bg-[#c9cbd0]',
                    } as Record<string, string>)[e.kind] || 'bg-[#16171a]';
                    const money = typeof e.amountCents === 'number' && e.kind !== 'booking';
                    return (
                      <li key={`${e.at}-${i}`} className="relative flex gap-3 pb-4">
                        <div className="flex flex-col items-center">
                          <div className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', tone)} />
                          {i < timeline.length - 1 && <div className="mt-1 w-px flex-1 bg-[#ececee]" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className={TEXT}>{e.title}</p>
                            {money && (
                              <p className={cn('shrink-0 text-[14px] tabular-nums', (e.amountCents as number) < 0 ? 'text-[#1f7a4d]' : 'text-[#16171a]')}>
                                {(e.amountCents as number) < 0 ? '−' : '+'}{formatCents(Math.abs(e.amountCents as number))}
                              </p>
                            )}
                          </div>
                          {e.detail && <p className={SUB}>{e.detail}</p>}
                          <p className="text-[12px] text-[#6d7075]">
                            {fmtStamp(e.at)}
                            {e.actor ? ` · ${TIMELINE_ACTOR_LABEL[e.actor] || e.actor}` : ''}
                            {typeof (e as any).balanceCents === 'number' ? ` · balance ${formatCents(Math.max((e as any).balanceCents, 0))}` : ''}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )
          )}
        </div>
  );
  return body;
}


// ─── Signed documents (drawer Documents tab) ─────────────────────────────────
// The renter's paper file: everything sent to them (summary, move-in report,
// notices, renewals) with its state, and everything they have ever signed —
// the lease included — from the same signedDocuments collection. Its own
// component so its subscriptions live only while the tab is open.
function RenterSignedDocs({ tenantId, firestore, renterId }: { tenantId: string; firestore: any; renterId: string }) {
  const [sent, setSent] = useState<any[]>([]);
  const [signed, setSigned] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId || !renterId) return;
    const u1 = onSnapshot(query(collection(firestore, 'tenants', tenantId, 'renterDocuments'), where('renterId', '==', renterId)),
      (s) => setSent(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setSent([]));
    const u2 = onSnapshot(query(collection(firestore, 'tenants', tenantId, 'signedDocuments'), where('subjectId', '==', renterId)),
      (s) => setSigned(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setSigned([]));
    return () => { u1(); u2(); };
  }, [firestore, tenantId, renterId]);
  const sentSorted = useMemo(() => [...sent].sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt))), [sent]);
  const otherSigned = useMemo(() => {
    const linked = new Set(sent.map((d) => d.signedDocumentId).filter(Boolean));
    return signed.filter((x) => !linked.has(x.id)).sort((a, b) => String(b.signedAt).localeCompare(String(a.signedAt)));
  }, [sent, signed]);
  if (sentSorted.length === 0 && otherSigned.length === 0) {
    return <section className={CARD}><h3 className={TITLE}>Documents and signatures</h3><p className={SUB}>Nothing sent or signed yet. Send one from Renters, then Documents.</p></section>;
  }
  const tone = (st: string) => st === 'signed' ? 'text-[#1f7a4d]' : st === 'sent' || st === 'declined' ? 'text-[#b45309]' : 'text-[#6d7075]';
  const label = (d: any) => d.status === 'sent' ? `Waiting · sent ${longDay(d.sentAt)}` : d.status === 'signed' ? `${d.action === 'acknowledge' ? 'Acknowledged' : 'Signed'} ${longDay(d.signedAt)} as ${d.signedName}` : d.status === 'declined' ? `Declined ${longDay(d.declinedAt)}${d.declineNote ? `: “${d.declineNote}”` : ''}` : 'Withdrawn';
  return (
    <section className={CARD}>
      <h3 className={TITLE}>Documents and signatures</h3>
      <ul className="mt-1">
        {sentSorted.map((d) => (
          <li key={d.id} className={ROW}>
            <span className="min-w-0">
              <span className={`flex min-w-0 items-center gap-1.5 ${TEXT}`}><FileText className="h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0 truncate">{d.title}</span></span>
              <span className={cn('block text-[13px]', tone(d.status))}>{label(d)}</span>
            </span>
            <PrintLink path="/api/booths/renter-document" params={{ tenantId, id: d.id }} ariaLabel={`Open ${d.title}`} className={RENTALS_BTN}>Open</PrintLink>
          </li>
        ))}
        {otherSigned.map((x) => (
          <li key={x.id} className={ROW}>
            <span className="min-w-0">
              <span className={`flex min-w-0 items-center gap-1.5 ${TEXT}`}><FileText className="h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0 truncate">{x.title || x.kind}</span></span>
              <span className="block text-[13px] text-[#1f7a4d]">Signed {longDay(x.signedAt)} as {x.signedName}{x.kind ? ` · ${String(x.kind).replace(/_/g, ' ')}` : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Perk row (lease wizard) ──────────────────────────────────────────────────
