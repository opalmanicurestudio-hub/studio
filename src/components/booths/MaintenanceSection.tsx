'use client';

// src/components/booths/MaintenanceSection.tsx
//
// The owner's maintenance command center — lives in the Booth Hub's
// Operations tab. One queue for every issue, however it arrived (renter
// portal, floor tap, or logged here), with SLA deadlines, assignment,
// a public per-ticket thread, and the worker roster with their portal
// links. Server automations (SMS to techs and reporters) are triggered
// fire-and-forget via /api/maintenance.

import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc, updateDoc, collection, onSnapshot, increment, arrayUnion } from 'firebase/firestore';
import { uploadImageBlob } from '@/lib/upload-image';
import { useToast } from '@/hooks/use-toast';
import { auditEntry } from '@/lib/audit';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Wrench, Plus, Users, CalendarClock, BookUser, Phone, Mail, MessageCircle, FileClock, Shield } from 'lucide-react';
import {
  dueAtFor, ticketBlocksBooth, isTicketOverdue, addDaysISO, PLAN_INTERVALS, pickRotationWorker,
  TICKET_STATUS_LABELS, TICKET_STATUS_TONES, TICKET_PRIORITY_LABELS, TICKET_PRIORITY_TONES, TICKET_CATEGORIES,
  type TicketPriority, type TicketStatus,
} from '@/lib/maintenance';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtWhen = (s?: string | null) => {
  if (!s) return '';
  try { return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return String(s).slice(0, 16); }
};

const newToken = () => {
  try { return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 40); }
  catch { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36); }
};

export function MaintenanceSection({
  firestore, storage, tenantId, locationId, booths, tickets, workers, plans, ownerName, autoAssign, publicOrigin, studioName, rules,
}: {
  firestore: any;
  storage?: any;
  studioName?: string;
  // tenants/{id}.maintenanceRules — the business's own approval policy
  rules?: any;
  tenantId: string;
  locationId?: string | null;
  booths: any[];
  tickets: any[];
  workers: any[];
  plans: any[];
  ownerName?: string;
  autoAssign?: boolean;
  // The tenant's permanent domain — worker links and texted portal links
  // are built on it so they survive deploys (preview URLs are frozen).
  publicOrigin?: string | null;
}) {
  const { toast } = useToast();
  const me = ownerName || 'Owner';
  const shareOrigin = (String(publicOrigin || '').trim().replace(/\/+$/, ''))
    || (process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || (typeof window !== 'undefined' ? window.location.origin : '');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: 'equipment', priority: 'normal' as TicketPriority, boothId: '', resourceId: '', assigneeId: '' });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [workersOpen, setWorkersOpen] = useState(false);
  const [wForm, setWForm] = useState({ name: '', phone: '', email: '', payType: 'per_job' });
  const [showResolved, setShowResolved] = useState(false);
  // Photos (owner-side: direct client Storage upload — the owner is authed)
  const [createPhotos, setCreatePhotos] = useState<string[]>([]);
  const [notePhoto, setNotePhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Resolve inline confirm: materials → ledger expense (with receipt photo),
  // labor → per-job worker's payable balance.
  const [resolveForId, setResolveForId] = useState<string | null>(null);
  const [costDraft, setCostDraft] = useState('');
  const [laborDraft, setLaborDraft] = useState('');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  // Worker profile expansion + payout
  const [profileWorkerId, setProfileWorkerId] = useState<string | null>(null);
  const [payoutMethod, setPayoutMethod] = useState('Cash');
  // Approval RULES — the business writes its own policy
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<{ auto: string; quote: string; receipt: string }>({ auto: '', quote: '', receipt: '' });
  const [rulesSaving, setRulesSaving] = useState(false);
  // Work order HISTORY — searchable archive with money totals + CSV
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hQuery, setHQuery] = useState('');
  const [hRange, setHRange] = useState<'30' | '90' | '365' | 'all'>('90');
  const [hPlace, setHPlace] = useState('');

  // ── Per-worker KPIs, computed live from the ticket history ───────────
  const workerStats = useMemo(() => {
    const m = new Map<string, any>();
    const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
    for (const w of workers) {
      m.set(w.id, { open: 0, resolved30: 0, resolvedAll: 0, onTime: 0, overdueNow: 0, sumHours: 0, materialsCents: 0, recent: [] as any[] });
    }
    for (const t of tickets) {
      const s = t.assigneeId ? m.get(t.assigneeId) : null;
      if (!s) continue;
      if (['open', 'in_progress'].includes(t.status)) {
        s.open += 1;
        if (isTicketOverdue(t)) s.overdueNow += 1;
      }
      if (t.status === 'resolved' && t.resolvedAt) {
        s.resolvedAll += 1;
        if (t.resolvedAt >= cutoff30) s.resolved30 += 1;
        if (t.dueAt && t.resolvedAt <= t.dueAt) s.onTime += 1;
        if (t.createdAt) s.sumHours += Math.max(0, (new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / 3600000);
        if (typeof t.costCents === 'number') s.materialsCents += t.costCents;
      }
      s.recent.push(t);
    }
    for (const s of m.values()) {
      s.onTimePct = s.resolvedAll > 0 ? Math.round((s.onTime / s.resolvedAll) * 100) : null;
      s.avgHours = s.resolvedAll > 0 ? s.sumHours / s.resolvedAll : null;
      s.recent = s.recent.sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 5);
    }
    return m;
  }, [workers, tickets]);

  // Rotation toggle — one tenant-level switch; every entry point honors it
  // (renter tickets, floor reports, scheduled plans, and tickets made here).
  const toggleRotation = async () => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId), { maintenanceAutoAssign: autoAssign ? 'off' : 'rotate' });
      toast({ title: autoAssign ? 'Auto-rotation off' : 'Auto-rotation on', description: autoAssign ? 'New tickets wait for manual assignment.' : 'New tickets go to the least-recently-assigned worker automatically.' });
    } catch { toast({ variant: 'destructive', title: 'Could not save' }); }
  };

  // Pay out a per-job worker's accrued labor: one expense entry ('Contract
  // Labor'), an audit record, and a payment stamp on the worker — then the
  // balance resets. Their money trail is as auditable as everything else.
  const payOutLabor = async (w: any) => {
    const cents = Math.max(0, Math.round(Number(w.unpaidLaborCents) || 0));
    if (!(cents > 0)) return;
    try {
      const nowIso = new Date().toISOString();
      const txnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
      await setDoc(txnRef, {
        id: txnRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
        amount: cents / 100, category: 'Contract Labor',
        description: `Maintenance labor payout — ${w.name}`,
        clientOrVendor: w.name, date: nowIso, paymentMethod: payoutMethod,
        hasReceipt: false, sourceId: w.id, tenantId, createdAt: nowIso,
      });
      const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
      await setDoc(aRef, { id: aRef.id, ...auditEntry({
        action: 'maintenance.labor_paid', targetType: 'maintenanceWorker', targetId: w.id,
        summary: `Paid ${w.name} $${(cents / 100).toFixed(2)} for ticket labor (${payoutMethod})`,
        amount: cents / 100, actor: { type: 'user', name: me },
      }) });
      await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenanceWorkers', w.id), {
        unpaidLaborCents: 0,
        laborPayments: arrayUnion({ at: nowIso, amountCents: cents, method: payoutMethod }),
      });
      toast({ title: `Paid ${w.name}`, description: `$${(cents / 100).toFixed(2)} logged under Contract Labor.` });
    } catch { toast({ variant: 'destructive', title: 'Payout not recorded', description: 'Nothing was saved — try again.' }); }
  };
  // Preventive plans
  const [plansOpen, setPlansOpen] = useState(false);
  const [pForm, setPForm] = useState({ title: '', description: '', category: 'cleaning', priority: 'normal' as TicketPriority, boothId: '', resourceId: '', assigneeId: '', everyDays: '30', customDays: '', firstRun: todayISO() });
  const [pSaving, setPSaving] = useState(false);

  // ── Rooms & equipment from the RESOURCES page — tickets attach to a
  // specific resource ("Pedicure chair 2", "Back room AC") exactly like
  // they attach to a station, so equipment history accrues in one place.
  const [resources, setResources] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(collection(firestore, 'tenants', tenantId, 'resources'),
      (snap) => setResources(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
      () => setResources([]));
    return () => unsub();
  }, [firestore, tenantId]);
  const namedResources = useMemo(() =>
    resources.filter((r: any) => r.name && String(r.name).trim())
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))),
    [resources]);

  // ── Service-provider directory — the business rolodex (plumber, HVAC,
  // electrician…). Info has ONE home; "who did we use last time?" is a
  // lookup, not an archaeology dig.
  const [providers, setProviders] = useState<any[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(collection(firestore, 'tenants', tenantId, 'serviceProviders'),
      (snap) => setProviders(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
      () => setProviders([]));
    return () => unsub();
  }, [firestore, tenantId]);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [provForm, setProvForm] = useState({ company: '', contactName: '', trade: 'Plumber', tradeOther: '', phone: '', email: '', notes: '' });
  const [provSaving, setProvSaving] = useState(false);
  const PROVIDER_TRADES = ['Plumber', 'HVAC', 'Electrician', 'Handyman', 'Cleaning', 'Appliance repair', 'Landlord / building', 'Other'];
  const saveProvider = async () => {
    if (provSaving || !provForm.company.trim()) return;
    setProvSaving(true);
    try {
      const ref = doc(collection(firestore, 'tenants', tenantId, 'serviceProviders'));
      await setDoc(ref, {
        id: ref.id,
        company: provForm.company.trim().slice(0, 120),
        contactName: provForm.contactName.trim().slice(0, 120) || null,
        trade: (provForm.trade === 'Other' ? provForm.tradeOther.trim() : provForm.trade).slice(0, 60) || 'Other',
        phone: provForm.phone.trim().slice(0, 40) || null,
        email: provForm.email.trim().slice(0, 160) || null,
        notes: provForm.notes.trim().slice(0, 2000) || null,
        createdAt: new Date().toISOString(),
      });
      setProvForm({ company: '', contactName: '', trade: 'Plumber', tradeOther: '', phone: '', email: '', notes: '' });
      toast({ title: 'Provider saved', description: 'Findable forever under Providers.' });
    } catch { toast({ variant: 'destructive', title: 'Could not save provider' }); }
    finally { setProvSaving(false); }
  };
  const removeProvider = async (p: any) => {
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'serviceProviders', p.id), { archived: true }); }
    catch { toast({ variant: 'destructive', title: 'Could not archive' }); }
  };
  // Promote a provider to a WORKER: they get a portal token and can be
  // assigned tickets like anyone on the team. This IS maintenance onboarding.
  const giveProviderPortal = async (p: any) => {
    try {
      const ref = doc(collection(firestore, 'tenants', tenantId, 'maintenanceWorkers'));
      await setDoc(ref, {
        id: ref.id, name: p.contactName || p.company, phone: p.phone || null, email: p.email || null,
        token: newToken(), active: true, createdAt: new Date().toISOString(), providerId: p.id,
      });
      setProvidersOpen(false); setWorkersOpen(true);
      toast({ title: 'Portal access created', description: `${p.contactName || p.company} is now in Workers — text them their link from there.` });
    } catch { toast({ variant: 'destructive', title: 'Could not create access' }); }
  };

  // Upload one image to Storage and return its URL. Owner-side only —
  // techs/renters upload through the API routes with admin credentials.
  // Photos go through the SAME path as every other upload in the app
  // (avatars, documents, contact photos): tenants/{id}/uploads/… via the
  // shared upload helper. Maintenance previously wrote to its own tickets/
  // folder, which Storage rules never mentioned — that's why images saved
  // everywhere EXCEPT here.
  const uploadPhoto = async (file: File): Promise<string | null> => {
    if (!file.type.startsWith('image/')) { toast({ variant: 'destructive', title: 'Not an image' }); return null; }
    if (file.size > 5_000_000) { toast({ variant: 'destructive', title: 'Photo too large', description: 'Keep it under 5 MB.' }); return null; }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 60);
      return await uploadImageBlob(`tenants/${tenantId}/uploads/ticket_${Date.now()}_${safe}`, file);
    } catch (e: any) {
      const code = String(e?.code || e?.message || '');
      toast({ variant: 'destructive', title: 'Upload failed', description:
        /unauthorized|permission|403/i.test(code)
          ? 'Firebase Storage rules are blocking this — but the uploads folder should already be allowed. Check the rules published in the Firebase console.'
          : 'Try a smaller image or check your connection.' });
      return null;
    }
    finally { setUploading(false); }
  };

  const activeWorkers = useMemo(() => workers.filter((w: any) => w.active !== false), [workers]);

  // ── RUNNING COSTS — always visible, not buried in the ledger ─────────
  // This month vs all-time, split materials/labor, plus how much unpaid
  // labor is waiting to be paid out. Computed straight from the tickets,
  // so it always matches what the techs actually logged.
  const spend = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const mIso = monthStart.toISOString();
    const s = { monthMaterials: 0, monthLabor: 0, monthJobs: 0, allMaterials: 0, allLabor: 0, receipts: 0, owedLabor: 0 };
    for (const t of tickets) {
      if (t.status !== 'resolved') continue;
      const mat = Math.max(0, Math.round(Number(t.costCents) || 0));
      const lab = Math.max(0, Math.round(Number(t.laborCents) || 0));
      s.allMaterials += mat; s.allLabor += lab;
      if (mat > 0 && Array.isArray(t.photoUrls) && t.photoUrls.length > 0) s.receipts += 1;
      if ((t.resolvedAt || '') >= mIso) { s.monthMaterials += mat; s.monthLabor += lab; s.monthJobs += 1; }
    }
    s.owedLabor = workers.reduce((a: number, w: any) => a + Math.max(0, Math.round(Number(w.unpaidLaborCents) || 0)), 0);
    return s;
  }, [tickets, workers]);

  // ── WORK ORDER HISTORY — every finished job, searchable ──────────────
  // Filter by text, place, and period; totals recompute on the filtered
  // set; each row reprints its work order; CSV export hands the whole
  // thing to an accountant or an insurance adjuster in one tap.
  const historyRows = useMemo(() => {
    const cutoff = hRange === 'all' ? '' : new Date(Date.now() - Number(hRange) * 86400000).toISOString();
    const q = hQuery.trim().toLowerCase();
    return tickets
      .filter((t: any) => ['resolved', 'cancelled'].includes(t.status))
      .filter((t: any) => !cutoff || (t.resolvedAt || t.updatedAt || '') >= cutoff)
      .filter((t: any) => !hPlace || t.boothName === hPlace || t.resourceName === hPlace)
      .filter((t: any) => !q || `${t.title} ${t.description || ''} ${t.boothName || ''} ${t.resourceName || ''} ${t.assigneeName || ''} ${t.category || ''}`.toLowerCase().includes(q))
      .sort((a: any, b: any) => (b.resolvedAt || b.updatedAt || '').localeCompare(a.resolvedAt || a.updatedAt || ''));
  }, [tickets, hQuery, hRange, hPlace]);
  const historyTotals = useMemo(() => {
    const t = { jobs: 0, materials: 0, labor: 0 };
    for (const h of historyRows) {
      if (h.status !== 'resolved') continue;
      t.jobs += 1; t.materials += Math.max(0, Number(h.costCents) || 0); t.labor += Math.max(0, Number(h.laborCents) || 0);
    }
    return t;
  }, [historyRows]);
  const historyPlaces = useMemo(() => {
    const s = new Set<string>();
    for (const t of tickets) { if (t.boothName) s.add(t.boothName); if (t.resourceName) s.add(t.resourceName); }
    return Array.from(s).sort();
  }, [tickets]);
  const exportHistoryCsv = () => {
    try {
      const escCsv = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [
        ['Ticket', 'Title', 'Place', 'Category', 'Priority', 'Status', 'Reported by', 'Worker', 'Created', 'Resolved', 'Hours', 'Materials $', 'Labor $', 'Total $'].map(escCsv).join(','),
        ...historyRows.map((t: any) => [
          String(t.id).slice(0, 8).toUpperCase(), t.title,
          [t.boothName, t.resourceName].filter(Boolean).join(' / '),
          t.category, t.priority, t.status, t.reporter?.name || '', t.assigneeName || '',
          t.createdAt || '', t.resolvedAt || '', t.laborHours || 0,
          ((Number(t.costCents) || 0) / 100).toFixed(2),
          ((Number(t.laborCents) || 0) / 100).toFixed(2),
          (((Number(t.costCents) || 0) + (Number(t.laborCents) || 0)) / 100).toFixed(2),
        ].map(escCsv).join(',')),
      ];
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `maintenance-history-${todayISO()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch { toast({ variant: 'destructive', title: 'Export failed' }); }
  };

  // ── PRINTABLE WORK ORDER — the paper trail for any single job ────────
  // A branded, comprehensive document: header with the studio's name and
  // ticket number, status chip, meta grid, description, a real cost
  // breakdown (materials + labor hours × rate + total), the full activity
  // timeline, the photo record, and sign-off lines. Browser print dialog
  // handles paper or Save-as-PDF.
  const printTicket = (t: any) => {
    try {
      const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const brand = esc(studioName || (ownerName || '').replace(/ team$/i, '') || 'Studio');
      const num = esc(String(t.id).slice(0, 8).toUpperCase());
      const statusLabel = esc(TICKET_STATUS_LABELS[t.status as TicketStatus] || t.status);
      const chipColor = t.status === 'resolved' ? '#047857' : t.status === 'in_progress' ? '#4338ca' : t.status === 'cancelled' ? '#64748b' : '#b45309';
      const chipBg = t.status === 'resolved' ? '#d1fae5' : t.status === 'in_progress' ? '#e0e7ff' : t.status === 'cancelled' ? '#f1f5f9' : '#fef3c7';
      const rows = (t.updates || []).map((u: any, i: number) =>
        `<tr${i % 2 ? ' class="alt"' : ''}><td class="nowrap">${esc(fmtWhen(u.at))}</td><td><strong>${esc(u.by)}</strong> <span class="who">${esc(u.byType || '')}</span></td><td>${u.status ? `<span class="move">→ ${esc(TICKET_STATUS_LABELS[u.status as TicketStatus] || u.status)}</span> ` : ''}${esc(u.note || '')}${u.photoUrl ? ' <span class="who">(photo)</span>' : ''}</td></tr>`).join('');
      const photos = (Array.isArray(t.photoUrls) ? t.photoUrls : []).map((u: string) =>
        `<img src="${esc(u)}" />`).join('');
      const mat = Math.max(0, Number(t.costCents) || 0);
      const lab = Math.max(0, Number(t.laborCents) || 0);
      const hrs = Math.max(0, Number(t.laborHours) || 0);
      const q = t.quote && t.quote.status === 'approved' ? t.quote : null;
      const costRows = [
        q ? `<tr><td>Approved quote <span class="who">(${[q.hours ? `${q.hours}h est.` : null, (q.materialsCents || 0) > 0 ? `$${(q.materialsCents / 100).toFixed(2)} materials est.` : null].filter(Boolean).join(' + ') || 'agreed price'}${q.by ? ` · by ${esc(q.by)}` : ''})</span></td><td class="amt">$${((q.totalCents || 0) / 100).toFixed(2)}</td></tr>` : '',
        mat > 0 ? `<tr><td>Materials &amp; parts${(Array.isArray(t.photoUrls) && t.photoUrls.length > 0) ? ' <span class="who">(receipt on file)</span>' : ''}</td><td class="amt">$${(mat / 100).toFixed(2)}</td></tr>` : '',
        lab > 0 ? `<tr><td>Labor${hrs > 0 ? ` <span class="who">(${hrs} hr${hrs === 1 ? '' : 's'} @ $${((lab / hrs) / 100).toFixed(2)}/hr)</span>` : ''}</td><td class="amt">$${(lab / 100).toFixed(2)}</td></tr>` : '',
        hrs > 0 && lab === 0 ? `<tr><td>Labor <span class="who">(${hrs} hr${hrs === 1 ? '' : 's'} logged — no rate on file)</span></td><td class="amt">—</td></tr>` : '',
        q && (mat + lab) > 0 ? `<tr><td><span class="who">${(mat + lab) > (q.totalCents || 0) ? `Over quote by $${(((mat + lab) - (q.totalCents || 0)) / 100).toFixed(2)}` : 'Delivered on or under quote'}</span></td><td class="amt"></td></tr>` : '',
      ].join('');
      const w = window.open('', '_blank');
      if (!w) { toast({ variant: 'destructive', title: 'Allow pop-ups to print' }); return; }
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Work order ${num} — ${esc(t.title)}</title><style>
        @page{margin:16mm}
        *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:760px;margin:0 auto;padding:28px;font-size:13px;line-height:1.5}
        .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;border-bottom:3px solid #0f172a}
        .brand{font-size:11px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:#64748b}
        h1{font-size:24px;margin:4px 0 0;letter-spacing:-.02em}
        .ttl{font-size:15px;font-weight:700;color:#334155;margin-top:2px}
        .numbox{text-align:right;flex-shrink:0}
        .num{font-size:15px;font-weight:800;font-family:ui-monospace,Menlo,monospace}
        .chip{display:inline-block;margin-top:6px;padding:3px 12px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${chipColor};background:${chipBg}}
        .printed{font-size:10px;color:#94a3b8;margin-top:6px}
        .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin:18px 0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
        .meta>div{padding:10px 14px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0}
        .meta>div:nth-child(3n){border-right:none}.meta>div:nth-last-child(-n+3){border-bottom:none}
        .lbl{display:block;color:#94a3b8;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;margin-bottom:2px}
        .desc{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;white-space:pre-wrap;margin:0 0 18px}
        h2{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#64748b;margin:22px 0 8px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th{background:#0f172a;color:#fff;text-align:left;padding:7px 10px;font-size:9px;text-transform:uppercase;letter-spacing:.12em}
        td{padding:7px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}
        tr.alt td{background:#f8fafc}
        .nowrap{white-space:nowrap}.who{color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
        .move{color:#4338ca;font-weight:700}
        .amt{text-align:right;font-weight:700;font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
        .total td{border-top:2px solid #0f172a;border-bottom:none;font-weight:800;font-size:14px}
        .photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
        .photos img{width:100%;height:150px;object-fit:cover;border:1px solid #e2e8f0;border-radius:10px}
        .sig{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:32px}
        .sig div{border-top:1.5px solid #0f172a;padding-top:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#64748b}
        .foot{margin-top:28px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;display:flex;justify-content:space-between}
        @media print{.noprint{display:none}}
      </style></head><body>
        <div class="top">
          <div>
            <p class="brand">${brand}</p>
            <h1>Work Order</h1>
            <p class="ttl">${esc(t.title)}</p>
          </div>
          <div class="numbox">
            <p class="num">#${num}</p>
            <span class="chip">${statusLabel}</span>
            <p class="printed">Printed ${esc(new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}</p>
          </div>
        </div>
        <div class="meta">
          <div><span class="lbl">Location</span>${esc([t.boothName, t.resourceName].filter(Boolean).join(' · ') || '—')}</div>
          <div><span class="lbl">Category</span>${esc(TICKET_CATEGORIES.find((c) => c.value === t.category)?.label || t.category)}</div>
          <div><span class="lbl">Priority</span>${esc(TICKET_PRIORITY_LABELS[t.priority as TicketPriority] || t.priority)}</div>
          <div><span class="lbl">Reported by</span>${esc(t.reporter?.name || '—')}<br/><span style="color:#94a3b8;font-size:11px">${esc(fmtWhen(t.createdAt))}</span></div>
          <div><span class="lbl">Assigned to</span>${esc(t.assigneeName || 'Unassigned')}</div>
          <div><span class="lbl">${t.resolvedAt ? 'Resolved' : 'Due'}</span>${esc(t.resolvedAt ? fmtWhen(t.resolvedAt) : t.dueAt ? fmtWhen(t.dueAt) : '—')}</div>
        </div>
        ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
        ${costRows ? `<h2>Cost breakdown</h2><table><tr><th>Item</th><th style="text-align:right">Amount</th></tr>${costRows}<tr class="total"><td>Total</td><td class="amt">$${(((mat + lab)) / 100).toFixed(2)}</td></tr></table>` : ''}
        <h2>Activity log</h2>
        <table><tr><th>When</th><th>Who</th><th>Update</th></tr>${rows || '<tr><td colspan="3">No updates yet</td></tr>'}</table>
        ${photos ? `<h2>Photo record</h2><div class="photos">${photos}</div>` : ''}
        <div class="sig"><div>Completed by / date</div><div>Approved by / date</div></div>
        <div class="foot"><span>${brand} · Maintenance work order #${num}</span><span>Keep with receipts for tax records</span></div>
        <p class="noprint" style="margin-top:24px;text-align:center"><button onclick="window.print()" style="padding:12px 28px;font-weight:800;border-radius:10px;border:2px solid #0f172a;background:#0f172a;color:#fff;letter-spacing:.1em;text-transform:uppercase;font-size:11px">Print / Save as PDF</button></p>
        <script>setTimeout(function(){ try { window.print(); } catch (e) {} }, 400)</script>
      </body></html>`);
      w.document.close();
    } catch { toast({ variant: 'destructive', title: 'Could not open the print view' }); }
  };
  const sorted = useMemo(() => {
    const RANK: Record<string, number> = { open: 0, in_progress: 1, resolved: 2, cancelled: 3 };
    const PR: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return tickets.slice().sort((a, b) =>
      (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || (PR[a.priority] ?? 9) - (PR[b.priority] ?? 9) || (a.dueAt || '').localeCompare(b.dueAt || ''));
  }, [tickets]);
  const openCount = tickets.filter((t: any) => ['open', 'in_progress'].includes(t.status)).length;
  const shown = showResolved ? sorted : sorted.filter((t: any) => ['open', 'in_progress'].includes(t.status));

  // Keep the floor honest from the client too (the server does the same for
  // tech-portal updates): serious unfinished ticket ⇒ booth 'maintenance'.
  const syncBooth = async (boothId: string | null | undefined, allTickets: any[]) => {
    if (!boothId) return;
    try {
      const blocking = allTickets.some((t: any) => t.boothId === boothId && ticketBlocksBooth(t));
      const b = booths.find((x: any) => x.id === boothId);
      if (!b) return;
      if (blocking && b.status !== 'maintenance') {
        await updateDoc(doc(firestore, 'tenants', tenantId, 'booths', boothId), { status: 'maintenance', updatedAt: new Date().toISOString() });
      } else if (!blocking && b.status === 'maintenance') {
        await updateDoc(doc(firestore, 'tenants', tenantId, 'booths', boothId), { status: 'vacant', maintenanceNote: null, maintenanceReportedAt: null, updatedAt: new Date().toISOString() });
      }
    } catch { /* floor sync is best-effort */ }
  };

  const fireAndForget = (action: string, ticketId: string) => {
    try {
      fetch('/api/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, tenantId, ticketId, origin: shareOrigin }),
      }).catch(() => {});
    } catch { /* automation is a bonus */ }
  };

  const createTicket = async () => {
    if (saving || !form.title.trim()) return;
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const booth = booths.find((b: any) => b.id === form.boothId);
      const resource = namedResources.find((r: any) => r.id === form.resourceId);
      const worker = activeWorkers.find((w: any) => w.id === form.assigneeId);
      const ref = doc(collection(firestore, 'tenants', tenantId, 'tickets'));
      const ticket: any = {
        id: ref.id, tenantId, locationId: locationId || null,
        title: form.title.trim().slice(0, 140),
        description: form.description.trim().slice(0, 2000),
        category: form.category, priority: form.priority, status: 'open',
        boothId: booth?.id || null, boothName: booth?.name || null,
        resourceId: resource?.id || null, resourceName: resource?.name || null,
        photoUrls: createPhotos,
        reporter: { type: 'owner', name: me },
        assigneeId: worker?.id || null, assigneeName: worker?.name || null,
        updates: [{ at: nowIso, by: me, byType: 'owner', note: 'Ticket created', status: 'open', ...(createPhotos[0] ? { photoUrl: createPhotos[0] } : {}) }],
        createdAt: nowIso, updatedAt: nowIso, dueAt: dueAtFor(form.priority), resolvedAt: null,
      };
      await setDoc(ref, ticket);
      await syncBooth(ticket.boothId, [...tickets, ticket]);
      // Rotation: unassigned + auto-rotate on → hand it to the least-
      // recently-assigned worker right now, matching the server behavior.
      let rotated: any = null;
      if (!worker && autoAssign) {
        rotated = pickRotationWorker(activeWorkers);
        if (rotated) {
          await updateDoc(ref, {
            assigneeId: rotated.id, assigneeName: rotated.name,
            updates: [...ticket.updates, { at: new Date().toISOString(), by: 'Rotation', byType: 'system', note: `Auto-assigned to ${rotated.name}` }],
          });
          try { await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenanceWorkers', rotated.id), { lastAssignedAt: new Date().toISOString() }); } catch { /* cursor is best-effort */ }
        }
      }
      if (worker || rotated) fireAndForget('notify-assign', ref.id);
      toast({ title: 'Ticket created', description: worker ? `${worker.name} will be texted the details.` : rotated ? `Auto-assigned to ${rotated.name} — they'll be texted.` : 'Assign a worker to get it moving.' });
      setCreateOpen(false);
      setCreatePhotos([]);
      setForm({ title: '', description: '', category: 'equipment', priority: 'normal', boothId: '', resourceId: '', assigneeId: '' });
    } catch { toast({ variant: 'destructive', title: 'Could not create ticket', description: 'Try again.' }); }
    finally { setSaving(false); }
  };

  const patchTicket = async (t: any, patch: any, updateEntry: any) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'tickets', t.id), {
        ...patch, updatedAt: new Date().toISOString(),
        updates: [...(t.updates || []), { at: new Date().toISOString(), by: me, byType: 'owner', ...updateEntry }],
      });
      return true;
    } catch { toast({ variant: 'destructive', title: 'Could not save', description: 'Try again.' }); return false; }
  };

  const assign = async (t: any, workerId: string) => {
    const w = activeWorkers.find((x: any) => x.id === workerId);
    if (!w) return;
    if (await patchTicket(t, { assigneeId: w.id, assigneeName: w.name, assignNotifiedFor: null }, { note: `Assigned to ${w.name}` })) {
      try { await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenanceWorkers', w.id), { lastAssignedAt: new Date().toISOString() }); } catch { /* rotation cursor is best-effort */ }
      fireAndForget('notify-assign', t.id);
      toast({ title: `Assigned to ${w.name}`, description: w.phone ? 'They\'ll get a text with the details.' : 'No phone on file — share their portal link directly.' });
    }
  };

  // ── APPROVAL RULES — this business's own thresholds, in its own hands.
  // Enforced server-side; this dialog just writes the policy.
  const openRules = () => {
    const r = (rules || {}) as any;
    const d = (c: any) => (Number(c) || 0) > 0 ? String((Number(c) || 0) / 100) : '';
    setRulesDraft({ auto: d(r.autoApproveUnderCents), quote: d(r.requireQuoteOverCents), receipt: d(r.receiptRequiredOverCents) });
    setRulesOpen(true);
  };
  const saveRules = async () => {
    if (rulesSaving) return;
    setRulesSaving(true);
    try {
      const c = (v: string) => Math.max(0, Math.round((Number(v) || 0) * 100));
      await updateDoc(doc(firestore, 'tenants', tenantId), {
        maintenanceRules: {
          autoApproveUnderCents: c(rulesDraft.auto),
          requireQuoteOverCents: c(rulesDraft.quote),
          receiptRequiredOverCents: c(rulesDraft.receipt),
        },
      });
      toast({ title: 'Rules saved', description: 'They apply to every tech and every ticket immediately — enforced by the server, not the honor system.' });
      setRulesOpen(false);
    } catch { toast({ variant: 'destructive', title: 'Could not save rules' }); }
    finally { setRulesSaving(false); }
  };

  // ── QUOTES — price agreed before work starts ─────────────────────────
  const requestQuote = async (t: any) => {
    if (await patchTicket(t, { quoteRequested: true, quoteRequestNotified: null }, { note: 'Quote requested before work starts' })) {
      fireAndForget('notify-quote', t.id);
      toast({ title: 'Quote requested', description: t.assigneeName ? `${t.assigneeName} will be texted to price it before starting.` : 'Assign a worker so someone gets the request.' });
    }
  };
  const decideQuote = async (t: any, approved: boolean) => {
    if (!t.quote) return;
    const status = approved ? 'approved' : 'declined';
    if (await patchTicket(t,
      { quote: { ...t.quote, status, decidedAt: new Date().toISOString() } },
      { note: approved ? `Quote approved — $${((t.quote.totalCents || 0) / 100).toFixed(2)}` : 'Quote declined' })) {
      fireAndForget('notify-quote', t.id);
      toast({ title: approved ? 'Quote approved' : 'Quote declined', description: approved ? 'The tech gets a green-light text.' : 'The tech is told to hold off — they can send a new quote.' });
    }
  };

  const setStatus = async (t: any, status: TicketStatus, costCents = 0, laborCents = 0, receipt: string | null = null) => {
    const patch: any = { status };
    if (status === 'resolved') {
      patch.resolvedAt = new Date().toISOString();
      if (costCents > 0) patch.costCents = costCents;
      if (laborCents > 0) patch.laborCents = laborCents;
      if (receipt) patch.photoUrls = [...(Array.isArray(t.photoUrls) ? t.photoUrls : []), receipt];
    }
    const entry: any = { status };
    if (status === 'resolved' && (costCents > 0 || laborCents > 0)) {
      entry.note = `Resolved${costCents > 0 ? ` · materials $${(costCents / 100).toFixed(2)}` : ''}${laborCents > 0 ? ` · labor $${(laborCents / 100).toFixed(2)}` : ''}`;
    }
    if (receipt) entry.photoUrl = receipt;
    if (await patchTicket(t, patch, entry)) {
      if (status === 'resolved' && costCents > 0) {
        // Materials → ledger expense with the receipt photo attached.
        try {
          const nowIso = new Date().toISOString();
          const txnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
          await setDoc(txnRef, {
            id: txnRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
            amount: costCents / 100, category: 'Maintenance & Repairs',
            description: `Maintenance — ${t.title}${t.boothName ? ` (${t.boothName})` : ''}${t.resourceName ? ` · ${t.resourceName}` : ''}`,
            clientOrVendor: t.assigneeName || 'Maintenance', date: nowIso, paymentMethod: 'See receipt',
            hasReceipt: !!receipt, receiptUrl: receipt || null,
            sourceId: t.id, tenantId, createdAt: nowIso,
          });
          const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
          await setDoc(aRef, { id: aRef.id, ...auditEntry({
            action: 'maintenance.cost_logged', targetType: 'ticket', targetId: t.id,
            summary: `Maintenance materials $${(costCents / 100).toFixed(2)} logged for "${t.title}"${t.boothName ? ` (${t.boothName})` : ''}`,
            amount: costCents / 100, actor: { type: 'user', name: me },
          }) });
        } catch { toast({ variant: 'destructive', title: 'Materials not logged', description: 'The ticket is resolved — add the expense manually.' }); }
      }
      // Labor → the per-job worker's payable balance (payroll workers are
      // paid through the Staff page's payroll instead — no double-pay).
      if (status === 'resolved' && laborCents > 0 && t.assigneeId) {
        const w = workers.find((x: any) => x.id === t.assigneeId);
        if (w && w.payType !== 'payroll') {
          try {
            await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenanceWorkers', w.id), { unpaidLaborCents: increment(laborCents) });
            toast({ title: 'Resolved', description: `$${(laborCents / 100).toFixed(2)} labor added to ${w.name}'s balance — pay out from their profile.` });
          } catch { toast({ variant: 'destructive', title: 'Labor not accrued', description: `Note ${w.name}'s $${(laborCents / 100).toFixed(2)} manually.` }); }
        } else if (w) {
          toast({ title: 'Resolved', description: `${w.name} is on payroll — labor is covered by their wages, not accrued here.` });
        }
      } else if (status === 'resolved' && costCents > 0) {
        toast({ title: 'Resolved', description: `$${(costCents / 100).toFixed(2)} logged under Maintenance & Repairs${receipt ? ' with receipt' : ''}.` });
      }
      const updated = tickets.map((x: any) => x.id === t.id ? { ...x, status } : x);
      await syncBooth(t.boothId, updated);
      fireAndForget('notify-reporter', t.id);
      setResolveForId(null); setCostDraft(''); setLaborDraft(''); setReceiptUrl(null);
    }
  };

  const addNote = async (t: any) => {
    if (!noteDraft.trim() && !notePhoto) return;
    const entry: any = {};
    if (noteDraft.trim()) entry.note = noteDraft.trim().slice(0, 1000);
    if (notePhoto) entry.photoUrl = notePhoto;
    const patch: any = notePhoto ? { photoUrls: [...(Array.isArray(t.photoUrls) ? t.photoUrls : []), notePhoto] } : {};
    if (await patchTicket(t, patch, entry)) { setNoteDraft(''); setNotePhoto(null); }
  };

  // ── Preventive plans ─────────────────────────────────────────────────
  const savePlan = async () => {
    if (pSaving || !pForm.title.trim()) return;
    const everyDays = pForm.everyDays === 'custom'
      ? Math.max(1, Math.round(Number(pForm.customDays) || 0))
      : Math.round(Number(pForm.everyDays) || 30);
    if (!(everyDays > 0)) { toast({ variant: 'destructive', title: 'Set the interval' }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pForm.firstRun)) { toast({ variant: 'destructive', title: 'Pick a first-run date' }); return; }
    setPSaving(true);
    try {
      const booth = booths.find((b: any) => b.id === pForm.boothId);
      const resource = namedResources.find((r: any) => r.id === pForm.resourceId);
      const worker = activeWorkers.find((w: any) => w.id === pForm.assigneeId);
      const ref = doc(collection(firestore, 'tenants', tenantId, 'maintenancePlans'));
      await setDoc(ref, {
        id: ref.id, tenantId,
        title: pForm.title.trim().slice(0, 140),
        description: pForm.description.trim().slice(0, 1000),
        category: pForm.category, priority: pForm.priority,
        boothId: booth?.id || null, boothName: booth?.name || null,
        resourceId: resource?.id || null, resourceName: resource?.name || null,
        assigneeId: worker?.id || null, assigneeName: worker?.name || null,
        everyDays, nextRunAt: pForm.firstRun, lastRunAt: null,
        active: true, createdAt: new Date().toISOString(),
      });
      toast({ title: 'Plan saved', description: `First ticket opens ${pForm.firstRun}, then every ${everyDays} days — automatically.` });
      setPForm({ title: '', description: '', category: 'cleaning', priority: 'normal', boothId: '', resourceId: '', assigneeId: '', everyDays: '30', customDays: '', firstRun: todayISO() });
    } catch { toast({ variant: 'destructive', title: 'Could not save plan' }); }
    finally { setPSaving(false); }
  };
  const togglePlan = async (p: any) => {
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenancePlans', p.id), { active: p.active === false }); }
    catch { toast({ variant: 'destructive', title: 'Could not update plan' }); }
  };
  const runPlanNow = async (p: any) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenancePlans', p.id), { nextRunAt: todayISO() });
      toast({ title: 'Queued', description: 'The ticket opens on tonight\'s run — or create one manually for right now.' });
    } catch { toast({ variant: 'destructive', title: 'Could not queue' }); }
  };

  // ── Workers ─────────────────────────────────────────────────────────
  const addWorker = async () => {
    if (!wForm.name.trim()) return;
    try {
      const ref = doc(collection(firestore, 'tenants', tenantId, 'maintenanceWorkers'));
      await setDoc(ref, {
        id: ref.id, name: wForm.name.trim(), phone: wForm.phone.trim() || null, email: wForm.email.trim() || null,
        payType: wForm.payType === 'payroll' ? 'payroll' : 'per_job',
        unpaidLaborCents: 0, lastAssignedAt: null,
        token: newToken(), active: true, createdAt: new Date().toISOString(),
      });
      setWForm({ name: '', phone: '', email: '', payType: 'per_job' });
      toast({ title: 'Worker added', description: wForm.payType === 'payroll'
        ? 'Send them their portal link below. Add them on the Staff page too so payroll covers their wages.'
        : 'Send them their portal link below, then tap their name and set their hourly rate — their logged hours are priced at YOUR rate, never their own number.' });
    } catch { toast({ variant: 'destructive', title: 'Could not add worker' }); }
  };
  const workerLink = (w: any) => `${shareOrigin}/maintain/${tenantId}?t=${w.token}`;
  const rotateToken = async (w: any) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenanceWorkers', w.id), { token: newToken() });
      toast({ title: 'Link rotated', description: 'The old link no longer works — send the new one.' });
    } catch { toast({ variant: 'destructive', title: 'Could not rotate' }); }
  };
  const toggleWorker = async (w: any) => {
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenanceWorkers', w.id), { active: w.active === false });
    } catch { toast({ variant: 'destructive', title: 'Could not update' }); }
  };
  // The owner sets the hourly rate — techs log HOURS in their portal and
  // the server prices them at this rate. Techs can never invent a dollar
  // amount for their own labor.
  const setWorkerRate = async (w: any) => {
    const cur = (Number(w.hourlyRateCents) || 0) / 100;
    const v = window.prompt(`Hourly rate for ${w.name} ($/hr). Their logged hours are priced at this rate — they cannot set their own pay. Enter 0 to disable labor accrual:`, cur > 0 ? String(cur) : '');
    if (v === null) return;
    const dollars = Math.max(0, Number(v) || 0);
    if (dollars > 500) { toast({ variant: 'destructive', title: 'That rate looks too high', description: 'Enter dollars per hour, e.g. 45.' }); return; }
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenanceWorkers', w.id), { hourlyRateCents: Math.round(dollars * 100) });
      toast({ title: dollars > 0 ? `${w.name} → $${dollars.toFixed(2)}/hr` : `${w.name}'s rate cleared`, description: dollars > 0 ? 'Hours they log now accrue at this rate.' : 'Hours are logged for the record, but no labor accrues.' });
    } catch { toast({ variant: 'destructive', title: 'Could not save the rate' }); }
  };

  const setWorkerPayType = async (w: any, payType: 'payroll' | 'per_job') => {
    if ((w.payType || 'per_job') === payType) return;
    if (payType === 'payroll' && (w.unpaidLaborCents || 0) > 0) {
      toast({ variant: 'destructive', title: 'Pay out their balance first', description: `${w.name} has $${((w.unpaidLaborCents || 0) / 100).toFixed(2)} of unpaid labor — settle it before switching to payroll.` });
      return;
    }
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'maintenanceWorkers', w.id), { payType });
      toast({ title: payType === 'payroll' ? `${w.name} → payroll` : `${w.name} → per-job`,
        description: payType === 'payroll' ? 'Wages come from the Staff page — ticket labor is no longer accrued here.' : 'Labor on resolved tickets now accrues to a payout balance on this profile.' });
    } catch { toast({ variant: 'destructive', title: 'Could not update' }); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xs font-black uppercase tracking-widest flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Maintenance</h2>
        {openCount > 0 && <span className="h-5 min-w-5 px-1.5 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{openCount}</span>}
        <button onClick={() => setShowResolved(o => !o)} className="text-[10px] font-bold text-muted-foreground underline underline-offset-2">
          {showResolved ? 'hide resolved' : 'show resolved'}
        </button>
        <div className="ml-auto flex gap-2 flex-wrap">
          <button onClick={openRules} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center gap-1">
            <Shield className="h-3 w-3" /> Rules
          </button>
          <button onClick={() => setHistoryOpen(true)} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center gap-1">
            <FileClock className="h-3 w-3" /> History
          </button>
          <button onClick={() => setProvidersOpen(true)} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center gap-1">
            <BookUser className="h-3 w-3" /> Providers {providers.filter((p: any) => !p.archived).length > 0 ? providers.filter((p: any) => !p.archived).length : ''}
          </button>
          <button onClick={() => setPlansOpen(true)} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center gap-1">
            <CalendarClock className="h-3 w-3" /> Plans {plans.filter((p: any) => p.active !== false).length > 0 ? plans.filter((p: any) => p.active !== false).length : ''}
          </button>
          <button onClick={() => setWorkersOpen(true)} className="h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center gap-1">
            <Users className="h-3 w-3" /> Workers {activeWorkers.length > 0 ? activeWorkers.length : ''}
          </button>
          <button onClick={() => setCreateOpen(true)} className="h-8 px-3 rounded-lg bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest flex items-center gap-1">
            <Plus className="h-3 w-3" /> Ticket
          </button>
        </div>
      </div>

      {/* Running costs — what maintenance is actually costing, live */}
      {(spend.allMaterials > 0 || spend.allLabor > 0 || spend.owedLabor > 0) && (
        <div className="rounded-2xl border-2 bg-white p-3 flex gap-4 overflow-x-auto">
          {[
            { label: 'This month', value: `$${((spend.monthMaterials + spend.monthLabor) / 100).toFixed(0)}`, sub: `${spend.monthJobs} job${spend.monthJobs === 1 ? '' : 's'} · $${(spend.monthMaterials / 100).toFixed(0)} materials · $${(spend.monthLabor / 100).toFixed(0)} labor` },
            { label: 'All time', value: `$${((spend.allMaterials + spend.allLabor) / 100).toFixed(0)}`, sub: `$${(spend.allMaterials / 100).toFixed(0)} materials · $${(spend.allLabor / 100).toFixed(0)} labor · ${spend.receipts} receipt${spend.receipts === 1 ? '' : 's'}` },
            ...(spend.owedLabor > 0 ? [{ label: 'Owed to workers', value: `$${(spend.owedLabor / 100).toFixed(0)}`, sub: 'pay out from their profiles', tone: 'text-amber-600' }] : []),
          ].map((k: any) => (
            <div key={k.label} className="shrink-0 min-w-[130px]">
              <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">{k.label}</p>
              <p className={`text-lg font-black leading-tight ${k.tone || ''}`}>{k.value}</p>
              <p className="text-[9px] font-bold text-muted-foreground">{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          Nothing open. Issues reported by renters (their portal), from the floor (tap a station → Report an issue), or logged here all land in this one queue.
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((t: any) => {
            const overdue = isTicketOverdue(t);
            const expanded = expandedId === t.id;
            return (
              <div key={t.id} className={`rounded-2xl border-2 bg-white overflow-hidden ${overdue ? 'border-red-300' : ''}`}>
                <button onClick={() => { setExpandedId(expanded ? null : t.id); setNoteDraft(''); }} className="w-full text-left px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black truncate">{t.title}</p>
                      <p className="text-[10px] font-bold text-muted-foreground truncate">
                        {[t.boothName, t.resourceName, TICKET_CATEGORIES.find(c => c.value === t.category)?.label || t.category,
                          `by ${t.reporter?.name || '—'}`,
                          t.assigneeName ? `assigned ${t.assigneeName}` : 'unassigned',
                          fmtWhen(t.createdAt)].filter(Boolean).join(' · ')}
                      </p>
                      {overdue && <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mt-0.5">Overdue · was due {fmtWhen(t.dueAt)}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${TICKET_PRIORITY_TONES[t.priority as TicketPriority] || ''}`}>{TICKET_PRIORITY_LABELS[t.priority as TicketPriority] || t.priority}</span>
                      <span className={`text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${TICKET_STATUS_TONES[t.status as TicketStatus] || ''}`}>{TICKET_STATUS_LABELS[t.status as TicketStatus] || t.status}</span>
                    </div>
                  </div>
                </button>
                {expanded && (
                  <div className="border-t px-4 py-3 space-y-3">
                    {t.description && <p className="text-xs font-medium text-slate-600 whitespace-pre-wrap">{t.description}</p>}
                    {Array.isArray(t.photoUrls) && t.photoUrls.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {t.photoUrls.map((u: string, i: number) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" className="shrink-0">
                            <img src={u} alt="" className="h-16 w-16 rounded-xl object-cover border-2" />
                          </a>
                        ))}
                      </div>
                    )}
                    {/* Quote card — pending gets decision buttons; decided
                        shows the verdict; resolved shows quoted vs actual */}
                    {t.quote && (
                      <div className={`rounded-xl border-2 p-2.5 ${t.quote.status === 'approved' ? 'border-emerald-200 bg-emerald-50' : t.quote.status === 'declined' ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50'}`}>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                          Quote from {t.quote.by} · {t.quote.status === 'pending' ? 'awaiting your decision' : t.quote.status}
                        </p>
                        <p className="text-sm font-black mt-0.5">
                          ${((t.quote.totalCents || 0) / 100).toFixed(2)}
                          <span className="text-[10px] font-bold text-muted-foreground"> {[(t.quote.hours || 0) > 0 ? `${t.quote.hours}h labor` : null, (t.quote.materialsCents || 0) > 0 ? `$${(t.quote.materialsCents / 100).toFixed(0)} materials` : null].filter(Boolean).join(' + ')}</span>
                        </p>
                        {t.quote.note && <p className="text-[11px] font-medium text-slate-600 mt-0.5">{t.quote.note}</p>}
                        {t.quote.status === 'pending' && (
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => decideQuote(t, true)} className="flex-1 h-9 rounded-xl bg-emerald-600 text-white font-black uppercase text-[9px] tracking-widest">Approve · ${((t.quote.totalCents || 0) / 100).toFixed(0)}</button>
                            <button onClick={() => decideQuote(t, false)} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Decline</button>
                          </div>
                        )}
                        {t.quote.status === 'approved' && t.status === 'resolved' && ((t.costCents || 0) + (t.laborCents || 0)) > 0 && (
                          <p className={`text-[10px] font-black uppercase tracking-widest mt-1 ${((t.costCents || 0) + (t.laborCents || 0)) > (t.quote.totalCents || 0) ? 'text-amber-600' : 'text-emerald-700'}`}>
                            Actual ${(((t.costCents || 0) + (t.laborCents || 0)) / 100).toFixed(2)} vs quoted ${((t.quote.totalCents || 0) / 100).toFixed(2)}
                            {((t.costCents || 0) + (t.laborCents || 0)) > (t.quote.totalCents || 0) ? ` · $${((((t.costCents || 0) + (t.laborCents || 0)) - (t.quote.totalCents || 0)) / 100).toFixed(2)} over` : ' · on or under'}
                          </p>
                        )}
                      </div>
                    )}
                    {((t.costCents || 0) > 0 || (t.laborCents || 0) > 0 || (t.laborHours || 0) > 0) && (
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {[(t.costCents || 0) > 0 ? `Materials $${(t.costCents / 100).toFixed(2)} · in ledger` : null,
                          (t.laborCents || 0) > 0 ? `Labor $${(t.laborCents / 100).toFixed(2)}${(t.laborHours || 0) > 0 ? ` (${t.laborHours}h)` : ''}` : (t.laborHours || 0) > 0 ? `${t.laborHours}h logged · no rate set` : null].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <button onClick={() => printTicket(t)} className="text-[9px] font-black uppercase tracking-widest text-slate-400 underline underline-offset-2">
                      Print work order
                    </button>
                    {(t.updates || []).length > 0 && (
                      <div className="space-y-1">
                        {(t.updates || []).slice(-6).map((u: any, i: number) => (
                          <div key={i} className="text-[11px] font-medium text-slate-500">
                            <span className="font-black text-slate-700">{u.by}</span>
                            <span className="text-slate-400 text-[9px] uppercase font-black"> {u.byType}</span>
                            {u.status ? ` → ${TICKET_STATUS_LABELS[u.status as TicketStatus] || u.status}` : ''}
                            {u.note ? ` — ${u.note}` : ''}
                            <span className="text-slate-400"> · {fmtWhen(u.at)}</span>
                            {u.photoUrl && (
                              <a href={u.photoUrl} target="_blank" rel="noreferrer" className="block mt-1">
                                <img src={u.photoUrl} alt="" className="h-14 w-14 rounded-lg object-cover border-2" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {['open', 'in_progress'].includes(t.status) && (
                      <>
                        <div className="flex gap-2 flex-wrap items-center">
                          <select value={t.assigneeId || ''} onChange={(e) => e.target.value && assign(t, e.target.value)}
                            className="h-9 rounded-xl border-2 px-2 text-xs font-bold bg-white">
                            <option value="">{t.assigneeName ? `Assigned: ${t.assigneeName}` : 'Assign worker…'}</option>
                            {activeWorkers.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
                          </select>
                          {t.status === 'open' && (
                            <button onClick={() => setStatus(t, 'in_progress')} className="h-9 px-3 rounded-xl bg-indigo-600 text-white font-black uppercase text-[9px] tracking-widest">Start</button>
                          )}
                          {!t.quote && !t.quoteRequested && t.assigneeId && (
                            <button onClick={() => requestQuote(t)} className="h-9 px-3 rounded-xl border-2 border-indigo-300 text-indigo-700 font-black uppercase text-[9px] tracking-widest">Request quote</button>
                          )}
                          {t.quoteRequested && !t.quote && (
                            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 self-center">Quote requested…</span>
                          )}
                          <button onClick={() => { setResolveForId(resolveForId === t.id ? null : t.id); setCostDraft(''); setLaborDraft(''); setReceiptUrl(null); }}
                            className="h-9 px-3 rounded-xl bg-emerald-600 text-white font-black uppercase text-[9px] tracking-widest">Resolve</button>
                          <button onClick={() => setStatus(t, 'cancelled')} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Cancel</button>
                        </div>
                        {resolveForId === t.id && (
                          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-2.5 space-y-2">
                            <div className="flex gap-2 items-center flex-wrap">
                              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700 w-20">Materials $</span>
                              <input type="number" inputMode="decimal" min={0} value={costDraft} onChange={(e) => setCostDraft(e.target.value)}
                                placeholder="0 if none" autoFocus className="w-24 h-9 rounded-xl border-2 px-2 text-sm font-bold" />
                              <label className={`h-9 px-2.5 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest flex items-center cursor-pointer shrink-0 bg-white ${receiptUrl ? 'border-emerald-400 text-emerald-700' : 'text-slate-500'}`}>
                                {uploading ? '…' : receiptUrl ? 'Receipt ✓' : 'Receipt'}
                                <input type="file" accept="image/*" className="hidden"
                                  onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const url = await uploadPhoto(f); if (url) setReceiptUrl(url); } }} />
                              </label>
                            </div>
                            <div className="flex gap-2 items-center flex-wrap">
                              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700 w-20">Labor $</span>
                              <input type="number" inputMode="decimal" min={0} value={laborDraft} onChange={(e) => setLaborDraft(e.target.value)}
                                placeholder="0 if none" className="w-24 h-9 rounded-xl border-2 px-2 text-sm font-bold" />
                              <span className="text-[9px] font-bold text-emerald-700/70">
                                {(() => {
                                  const w = workers.find((x: any) => x.id === t.assigneeId);
                                  if (!w) return 'assign a worker to track labor';
                                  return w.payType === 'payroll' ? `${w.name} is on payroll — wages cover labor` : `adds to ${w.name}'s payout balance`;
                                })()}
                              </span>
                            </div>
                            <button onClick={() => setStatus(t, 'resolved', Math.round(Number(costDraft) * 100) || 0, Math.round(Number(laborDraft) * 100) || 0, receiptUrl)}
                              disabled={uploading}
                              className="h-9 px-3 rounded-xl bg-emerald-600 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">
                              Confirm resolve{Number(costDraft) > 0 ? ` · $${Number(costDraft).toFixed(0)} materials to ledger` : ''}{Number(laborDraft) > 0 ? ` · $${Number(laborDraft).toFixed(0)} labor` : ''}
                            </button>
                          </div>
                        )}
                        <div className="flex gap-2 items-center">
                          <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note (visible to reporter + tech)…"
                            className="flex-1 min-w-0 h-9 rounded-xl border-2 px-3 text-sm font-medium" />
                          <label className={`h-9 px-2.5 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest flex items-center cursor-pointer shrink-0 ${notePhoto ? 'border-emerald-300 text-emerald-700' : 'text-slate-500'}`}>
                            {uploading ? '…' : notePhoto ? 'Photo ✓' : 'Photo'}
                            <input type="file" accept="image/*" className="hidden"
                              onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const url = await uploadPhoto(f); if (url) setNotePhoto(url); } }} />
                          </label>
                          <button onClick={() => addNote(t)} disabled={(!noteDraft.trim() && !notePhoto) || uploading}
                            className="h-9 px-3 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40 shrink-0">Post</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── New ticket ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight">New maintenance ticket</DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              SLA starts now — urgent 4h · high 24h · normal 3d · low 7d
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5">
            <input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="What's broken? *" autoFocus
              className="w-full h-11 rounded-xl border-2 px-3.5 text-sm font-medium" />
            <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
              placeholder="Details — what happened, where exactly, anything the worker should bring…"
              className="w-full rounded-xl border-2 px-3.5 py-2.5 text-sm font-medium" />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} className="h-11 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                {TICKET_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <select value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value as TicketPriority }))} className="h-11 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                {(['urgent', 'high', 'normal', 'low'] as TicketPriority[]).map(p => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
              </select>
              <select value={form.boothId} onChange={(e) => setForm(f => ({ ...f, boothId: e.target.value }))} className="h-11 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                <option value="">No specific station</option>
                {booths.filter((b: any) => !['wall', 'door', 'plant'].includes(b.shape)).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select value={form.assigneeId} onChange={(e) => setForm(f => ({ ...f, assigneeId: e.target.value }))} className="h-11 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                <option value="">Assign later</option>
                {activeWorkers.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {namedResources.length > 0 && (
                <select value={form.resourceId} onChange={(e) => setForm(f => ({ ...f, resourceId: e.target.value }))} className="h-11 rounded-xl border-2 px-2 text-sm font-bold bg-white col-span-2">
                  <option value="">Room / equipment (optional — from Resources)</option>
                  {namedResources.map((r: any) => <option key={r.id} value={r.id}>{r.name}{r.type ? ` (${r.type})` : ''}</option>)}
                </select>
              )}
            </div>
            {/* Photos — show, don't describe */}
            <div className="flex gap-2 items-center flex-wrap">
              {createPhotos.map((u, i) => (
                <span key={i} className="relative">
                  <img src={u} alt="" className="h-14 w-14 rounded-xl object-cover border-2" />
                  <button onClick={() => setCreatePhotos(ps => ps.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-slate-900 text-white text-[10px] font-black leading-none">×</button>
                </span>
              ))}
              {createPhotos.length < 3 && (
                <label className="h-14 w-14 rounded-xl border-2 border-dashed flex items-center justify-center text-slate-400 cursor-pointer text-xl font-black">
                  {uploading ? '…' : '+'}
                  <input type="file" accept="image/*" className="hidden"
                    onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const url = await uploadPhoto(f); if (url) setCreatePhotos(ps => [...ps, url]); } }} />
                </label>
              )}
              <span className="text-[9px] font-bold text-muted-foreground">Up to 3 photos</span>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground">Urgent/high tickets on a station take it off the floor automatically until resolved.</p>
            <button onClick={createTicket} disabled={saving || uploading || !form.title.trim()}
              className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] disabled:opacity-40">
              {saving ? 'Creating…' : 'Create ticket'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Provider directory — the business rolodex ── */}
      <Dialog open={providersOpen} onOpenChange={setProvidersOpen}>
        <DialogContent className="max-w-sm rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight">Service providers</DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Plumber, HVAC, electrician — every contact in one home
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {providers.filter((p: any) => !p.archived).map((p: any) => {
              // A provider promoted to the portal is backed by a worker doc —
              // their job history and spend roll up here automatically.
              const linked = workers.find((w: any) => w.providerId === p.id);
              const lst = linked ? workerStats.get(linked.id) : null;
              return (
              <div key={p.id} className="rounded-2xl border-2 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate">{p.company}</p>
                    <p className="text-[10px] font-bold text-muted-foreground truncate">
                      {[p.trade, p.contactName].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 shrink-0">{p.trade}</span>
                </div>
                {lst && (lst.resolvedAll > 0 || lst.open > 0) && (
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {[
                      lst.open > 0 ? `${lst.open} open` : null,
                      `${lst.resolvedAll} job${lst.resolvedAll === 1 ? '' : 's'} done`,
                      lst.onTimePct !== null ? `${lst.onTimePct}% on time` : null,
                      lst.materialsCents > 0 ? `$${(lst.materialsCents / 100).toFixed(0)} materials` : null,
                      (linked.unpaidLaborCents || 0) > 0 ? `owed $${((linked.unpaidLaborCents || 0) / 100).toFixed(0)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
                {p.notes && <p className="text-[11px] font-medium text-slate-500 whitespace-pre-wrap">{p.notes}</p>}
                <div className="flex gap-1.5 items-center">
                  {p.phone && (
                    <a href={`tel:${p.phone}`} title="Call" className="h-9 w-9 rounded-xl border-2 flex items-center justify-center text-slate-500 hover:text-slate-900"><Phone className="h-4 w-4" /></a>
                  )}
                  {p.phone && (
                    <a href={`sms:${p.phone}`} title="Text" className="h-9 w-9 rounded-xl border-2 flex items-center justify-center text-slate-500 hover:text-slate-900"><MessageCircle className="h-4 w-4" /></a>
                  )}
                  {p.email && (
                    <a href={`mailto:${p.email}`} title="Email" className="h-9 w-9 rounded-xl border-2 flex items-center justify-center text-slate-500 hover:text-slate-900"><Mail className="h-4 w-4" /></a>
                  )}
                  {linked ? (
                    <span className="ml-auto h-9 px-2.5 rounded-xl bg-indigo-50 border-2 border-indigo-200 text-indigo-700 font-black uppercase text-[9px] tracking-widest shrink-0 flex items-center">Has portal</span>
                  ) : (
                    <button onClick={() => giveProviderPortal(p)} title="They get a portal link and can be assigned tickets"
                      className="ml-auto h-9 px-2.5 rounded-xl border-2 border-indigo-300 text-indigo-700 font-black uppercase text-[9px] tracking-widest shrink-0">
                      Give portal
                    </button>
                  )}
                  <button onClick={() => removeProvider(p)} className="h-9 px-2 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 underline underline-offset-2 shrink-0">Archive</button>
                </div>
              </div>
              );
            })}
            <div className="rounded-2xl border-2 border-dashed p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Add a provider</p>
              <input value={provForm.company} onChange={(e) => setProvForm(f => ({ ...f, company: e.target.value }))} placeholder="Company *" className="w-full h-10 rounded-xl border-2 px-3 text-sm font-medium" />
              <div className="grid grid-cols-2 gap-2">
                <input value={provForm.contactName} onChange={(e) => setProvForm(f => ({ ...f, contactName: e.target.value }))} placeholder="Contact person" className="h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                <select value={provForm.trade} onChange={(e) => setProvForm(f => ({ ...f, trade: e.target.value }))} className="h-10 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                  {PROVIDER_TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {provForm.trade === 'Other' && (
                  <input value={provForm.tradeOther} onChange={(e) => setProvForm(f => ({ ...f, tradeOther: e.target.value }))} placeholder="Trade" className="h-10 rounded-xl border-2 px-3 text-sm font-medium col-span-2" />
                )}
                <input value={provForm.phone} onChange={(e) => setProvForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                <input value={provForm.email} onChange={(e) => setProvForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="h-10 rounded-xl border-2 px-3 text-sm font-medium" />
              </div>
              <textarea value={provForm.notes} onChange={(e) => setProvForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                placeholder="Account #, rates, hours, who to ask for, warranty info…"
                className="w-full rounded-xl border-2 px-3 py-2 text-sm font-medium" />
              <button onClick={saveProvider} disabled={provSaving || !provForm.company.trim()}
                className="w-full h-10 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">
                {provSaving ? 'Saving…' : 'Save provider'}
              </button>
              <p className="text-[10px] font-bold text-muted-foreground">"Give portal" turns a provider into a worker: they get a ticket queue link and can be assigned jobs directly.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Preventive plans — recurring work that files its own tickets ── */}
      <Dialog open={plansOpen} onOpenChange={setPlansOpen}>
        <DialogContent className="max-w-sm rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight">Preventive maintenance</DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Recurring work opens its own tickets — nothing gets forgotten
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {plans.length > 0 && plans.map((p: any) => (
              <div key={p.id} className={`rounded-2xl border-2 p-3 space-y-1 ${p.active === false ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-2">
                  <p className="flex-1 min-w-0 text-sm font-black truncate">{p.title}</p>
                  <button onClick={() => togglePlan(p)} className="text-[9px] font-black uppercase tracking-widest text-slate-400 underline underline-offset-2 shrink-0">
                    {p.active === false ? 'Resume' : 'Pause'}
                  </button>
                </div>
                <p className="text-[10px] font-bold text-muted-foreground">
                  {PLAN_INTERVALS.find(x => x.days === p.everyDays)?.label || `Every ${p.everyDays} days`}
                  {p.boothName ? ` · ${p.boothName}` : ' · facility-wide'}
                  {p.assigneeName ? ` · ${p.assigneeName}` : ''}
                  {p.active !== false ? ` · next ${p.nextRunAt}` : ''}
                </p>
                {(Number(p.runCount) || 0) > 0 && (
                  <p className="text-[10px] font-bold text-muted-foreground">
                    Ran {p.runCount} time{Number(p.runCount) === 1 ? '' : 's'}{p.lastRunAt ? ` · last ${p.lastRunAt}` : ''} — full record in History
                  </p>
                )}
                {p.active !== false && (
                  <button onClick={() => runPlanNow(p)} className="text-[9px] font-black uppercase tracking-widest text-indigo-600 underline underline-offset-2">Run on tonight's sweep</button>
                )}
              </div>
            ))}
            <div className="rounded-2xl border-2 border-dashed p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">New plan</p>
              <input value={pForm.title} onChange={(e) => setPForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Deep-clean all stations *"
                className="w-full h-10 rounded-xl border-2 px-3 text-sm font-medium" />
              <textarea value={pForm.description} onChange={(e) => setPForm(f => ({ ...f, description: e.target.value }))} rows={2}
                placeholder="Checklist / instructions carried onto every generated ticket…"
                className="w-full rounded-xl border-2 px-3 py-2 text-sm font-medium" />
              <div className="grid grid-cols-2 gap-2">
                <select value={pForm.category} onChange={(e) => setPForm(f => ({ ...f, category: e.target.value }))} className="h-10 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                  {TICKET_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <select value={pForm.priority} onChange={(e) => setPForm(f => ({ ...f, priority: e.target.value as TicketPriority }))} className="h-10 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                  {(['normal', 'low', 'high'] as TicketPriority[]).map(p => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
                </select>
                <select value={pForm.everyDays} onChange={(e) => setPForm(f => ({ ...f, everyDays: e.target.value }))} className="h-10 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                  {PLAN_INTERVALS.map(x => <option key={x.days} value={String(x.days)}>{x.label}</option>)}
                  <option value="custom">Custom…</option>
                </select>
                {pForm.everyDays === 'custom' ? (
                  <input type="number" inputMode="numeric" min={1} value={pForm.customDays} onChange={(e) => setPForm(f => ({ ...f, customDays: e.target.value }))}
                    placeholder="days" className="h-10 rounded-xl border-2 px-2 text-sm font-bold" />
                ) : (
                  <input type="date" value={pForm.firstRun} onChange={(e) => setPForm(f => ({ ...f, firstRun: e.target.value }))}
                    className="h-10 rounded-xl border-2 px-2 text-sm font-bold" />
                )}
                {pForm.everyDays === 'custom' && (
                  <input type="date" value={pForm.firstRun} onChange={(e) => setPForm(f => ({ ...f, firstRun: e.target.value }))}
                    className="h-10 rounded-xl border-2 px-2 text-sm font-bold col-span-2" />
                )}
                <select value={pForm.boothId} onChange={(e) => setPForm(f => ({ ...f, boothId: e.target.value }))} className="h-10 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                  <option value="">Facility-wide</option>
                  {booths.filter((b: any) => !['wall', 'door', 'plant'].includes(b.shape)).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select value={pForm.assigneeId} onChange={(e) => setPForm(f => ({ ...f, assigneeId: e.target.value }))} className="h-10 rounded-xl border-2 px-2 text-sm font-bold bg-white">
                  <option value="">Assign later</option>
                  {activeWorkers.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {namedResources.length > 0 && (
                  <select value={pForm.resourceId} onChange={(e) => setPForm(f => ({ ...f, resourceId: e.target.value }))} className="h-10 rounded-xl border-2 px-2 text-sm font-bold bg-white col-span-2">
                    <option value="">Room / equipment (optional)</option>
                    {namedResources.map((r: any) => <option key={r.id} value={r.id}>{r.name}{r.type ? ` (${r.type})` : ''}</option>)}
                  </select>
                )}
              </div>
              <button onClick={savePlan} disabled={pSaving || !pForm.title.trim()}
                className="w-full h-11 rounded-xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40">
                {pSaving ? 'Saving…' : 'Save plan'}
              </button>
              <p className="text-[10px] font-bold text-muted-foreground">The nightly sweep opens the ticket on schedule, pre-assigned, with the SLA clock running — and texts the worker if SMS is set up.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Workers roster ── */}
      {/* ── APPROVAL RULES — the business writes its own policy ── */}
      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="max-w-sm rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight">Approval rules</DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Your thresholds, enforced automatically — leave blank to turn a rule off
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {([
              { key: 'auto' as const, title: 'Auto-approve small quotes', desc: 'Quotes at or under this amount approve instantly — techs get the green light without waiting on you.', prefix: 'Under $' },
              { key: 'quote' as const, title: 'Require a quote on big jobs', desc: 'A job can\'t be resolved above this total (materials + labor) unless you approved a quote first. The server blocks it, not the honor system.', prefix: 'Over $' },
              { key: 'receipt' as const, title: 'Require receipts on big purchases', desc: 'Materials above this amount can\'t be logged without a photo of the receipt attached to the ticket.', prefix: 'Over $' },
            ]).map((r) => (
              <div key={r.key} className="rounded-2xl border-2 p-3 space-y-1.5">
                <p className="text-xs font-black">{r.title}</p>
                <p className="text-[10px] font-bold text-muted-foreground">{r.desc}</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{r.prefix}</span>
                  <input type="number" inputMode="decimal" min={0} value={rulesDraft[r.key]}
                    onChange={(e) => setRulesDraft(d => ({ ...d, [r.key]: e.target.value }))}
                    placeholder="off" className="w-24 h-10 rounded-xl border-2 px-2 text-sm font-bold" />
                  {Number(rulesDraft[r.key]) > 0
                    ? <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">On</span>
                    : <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">Off</span>}
                </div>
              </div>
            ))}
            <button onClick={saveRules} disabled={rulesSaving}
              className="w-full h-11 rounded-xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40">
              {rulesSaving ? 'Saving…' : 'Save rules'}
            </button>
            <p className="text-[10px] font-bold text-muted-foreground">
              Rules apply to every worker and every ticket the moment you save. Techs see your thresholds in their portal before they hit them — warnings first, hard stops at the server.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── WORK ORDER HISTORY — the archive, with money attached ── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight">Work order history</DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Every finished job — searchable, printable, exportable
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <input value={hQuery} onChange={(e) => setHQuery(e.target.value)} placeholder="Search title, worker, place…"
                className="flex-1 min-w-[140px] h-10 rounded-xl border-2 px-3 text-sm font-medium" />
              <select value={hPlace} onChange={(e) => setHPlace(e.target.value)} className="h-10 rounded-xl border-2 px-2 text-xs font-bold bg-white">
                <option value="">All places</option>
                {historyPlaces.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <div className="flex rounded-xl border-2 overflow-hidden">
                {([['30', '30d'], ['90', '90d'], ['365', 'Year'], ['all', 'All']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setHRange(v)}
                    className={`h-10 px-2.5 text-[9px] font-black uppercase tracking-widest ${hRange === v ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>{label}</button>
                ))}
              </div>
            </div>
            {/* Totals for exactly what's filtered — answer "what did the
                pedicure chairs cost me this year" in two taps */}
            <div className="rounded-xl border-2 bg-slate-50 p-2.5 flex items-center gap-4 flex-wrap">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                {historyTotals.jobs} job{historyTotals.jobs === 1 ? '' : 's'} · ${(historyTotals.materials / 100).toFixed(0)} materials · ${(historyTotals.labor / 100).toFixed(0)} labor · ${((historyTotals.materials + historyTotals.labor) / 100).toFixed(0)} total
              </p>
              <button onClick={exportHistoryCsv} disabled={historyRows.length === 0}
                className="ml-auto h-8 px-3 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 disabled:opacity-40">
                Export CSV
              </button>
            </div>
            {historyRows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Nothing in this window — widen the period or clear the search.</p>
            ) : (
              <div className="space-y-1.5">
                {historyRows.slice(0, 100).map((t: any) => (
                  <div key={t.id} className="rounded-xl border-2 px-3 py-2 flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${t.status === 'resolved' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black truncate">{t.title}</p>
                      <p className="text-[10px] font-bold text-muted-foreground truncate">
                        {[[t.boothName, t.resourceName].filter(Boolean).join(' / '), t.assigneeName,
                          fmtWhen(t.resolvedAt || t.updatedAt),
                          (t.costCents || 0) > 0 ? `$${((t.costCents || 0) / 100).toFixed(0)} mat` : null,
                          (t.laborCents || 0) > 0 ? `$${((t.laborCents || 0) / 100).toFixed(0)} labor` : null,
                          t.status === 'cancelled' ? 'cancelled' : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <button onClick={() => printTicket(t)} className="h-8 px-2.5 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest text-slate-500 shrink-0">Print</button>
                  </div>
                ))}
                {historyRows.length > 100 && <p className="text-[10px] font-bold text-muted-foreground">Showing the latest 100 — narrow the filters or export the CSV for everything.</p>}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={workersOpen} onOpenChange={(o) => { setWorkersOpen(o); if (!o) setProfileWorkerId(null); }}>
        <DialogContent className="max-w-md rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight">Maintenance workers</DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Each gets a personal portal link — tap a name for their full profile
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* Rotation: one switch, honored by every ticket entry point */}
            <div className={`rounded-2xl border-2 p-3 flex items-center gap-3 ${autoAssign ? 'border-indigo-300 bg-indigo-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest">Auto-rotation</p>
                <p className="text-[10px] font-bold text-muted-foreground">
                  {autoAssign
                    ? 'New tickets go to the least-recently-assigned active worker — renter reports, floor reports, scheduled plans, and tickets made here.'
                    : 'Off — new tickets wait in the queue until you assign them.'}
                </p>
              </div>
              <button onClick={toggleRotation}
                className={`h-9 px-3 rounded-xl font-black uppercase text-[9px] tracking-widest shrink-0 ${autoAssign ? 'bg-indigo-600 text-white' : 'border-2 text-slate-600'}`}>
                {autoAssign ? 'On' : 'Turn on'}
              </button>
            </div>
            {workers.map((w: any) => {
              const st = workerStats.get(w.id) || { open: 0, resolved30: 0, resolvedAll: 0, onTimePct: null, avgHours: null, materialsCents: 0, overdueNow: 0, recent: [] };
              const balance = Math.max(0, Math.round(Number(w.unpaidLaborCents) || 0));
              const onPayroll = w.payType === 'payroll';
              const showProfile = profileWorkerId === w.id;
              return (
                <div key={w.id} className={`rounded-2xl border-2 overflow-hidden ${w.active === false ? 'opacity-50' : ''}`}>
                  <button onClick={() => setProfileWorkerId(showProfile ? null : w.id)} className="w-full text-left p-3">
                    <div className="flex items-center gap-2">
                      <p className="flex-1 min-w-0 text-sm font-black truncate">{w.name}</p>
                      {balance > 0 && <span className="text-[9px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-amber-100 text-amber-700 shrink-0">Owed ${(balance / 100).toFixed(0)}</span>}
                      {st.overdueNow > 0 && <span className="text-[9px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 bg-red-100 text-red-700 shrink-0">{st.overdueNow} overdue</span>}
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">{onPayroll ? 'Payroll' : 'Per-job'}</span>
                    </div>
                    <p className="text-[10px] font-bold text-muted-foreground mt-0.5">
                      {[w.phone, w.email, `${st.open} open`, `${st.resolved30} done in 30d`].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                  {showProfile && (
                    <div className="border-t px-3 py-3 space-y-3">
                      {/* KPIs from the ticket history — nothing entered by hand */}
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: 'Open now', value: String(st.open), tone: st.overdueNow > 0 ? 'text-red-600' : '' },
                          { label: 'Done · 30d', value: String(st.resolved30) },
                          { label: 'Done · all', value: String(st.resolvedAll) },
                          { label: 'On time', value: st.onTimePct === null ? '—' : `${st.onTimePct}%`, tone: st.onTimePct !== null && st.onTimePct < 70 ? 'text-amber-600' : '' },
                          { label: 'Avg turnaround', value: st.avgHours === null ? '—' : st.avgHours < 48 ? `${Math.round(st.avgHours)}h` : `${(st.avgHours / 24).toFixed(1)}d` },
                          { label: 'Materials', value: `$${(st.materialsCents / 100).toFixed(0)}` },
                        ].map((k) => (
                          <div key={k.label} className="rounded-xl border-2 p-2 text-center">
                            <p className={`text-base font-black leading-tight ${k.tone || ''}`}>{k.value}</p>
                            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">{k.label}</p>
                          </div>
                        ))}
                      </div>
                      {/* Pay setup — payroll lives on the Staff page; per-job accrues here */}
                      <div className="rounded-xl border-2 p-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="flex-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground">How they're paid</p>
                          <div className="flex rounded-lg border-2 overflow-hidden">
                            {(['per_job', 'payroll'] as const).map((pt) => (
                              <button key={pt} onClick={() => setWorkerPayType(w, pt)}
                                className={`h-7 px-2.5 text-[9px] font-black uppercase tracking-widest ${(w.payType || 'per_job') === pt ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>
                                {pt === 'per_job' ? 'Per job' : 'Payroll'}
                              </button>
                            ))}
                          </div>
                        </div>
                        {!onPayroll && (
                          <button onClick={() => setWorkerRate(w)}
                            className="w-full h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center justify-center gap-1.5">
                            {(w.hourlyRateCents || 0) > 0
                              ? <>Rate ${((w.hourlyRateCents || 0) / 100).toFixed(2)}/hr · change</>
                              : <>Set hourly rate — required before labor accrues</>}
                          </button>
                        )}
                        {onPayroll ? (
                          <p className="text-[10px] font-bold text-muted-foreground">Wages, hours, and payday run through the Staff page — labor on tickets is covered there, so nothing accrues here.</p>
                        ) : balance > 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs font-black text-amber-700">Unpaid labor: ${(balance / 100).toFixed(2)}</p>
                            <div className="flex gap-1.5 flex-wrap">
                              {['Cash', 'Zelle', 'Venmo', 'Check', 'Card'].map((mth) => (
                                <button key={mth} onClick={() => setPayoutMethod(mth)}
                                  className={`h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${payoutMethod === mth ? 'bg-slate-900 text-white' : 'border-2 text-slate-500'}`}>{mth}</button>
                              ))}
                            </div>
                            <button onClick={() => payOutLabor(w)}
                              className="w-full h-9 rounded-xl bg-emerald-600 text-white font-black uppercase text-[9px] tracking-widest">
                              Pay ${(balance / 100).toFixed(2)} · {payoutMethod} → Contract Labor
                            </button>
                          </div>
                        ) : (
                          <p className="text-[10px] font-bold text-muted-foreground">No unpaid labor. Log a Labor $ when resolving their tickets and it accrues here for one-tap payout.</p>
                        )}
                        {Array.isArray(w.laborPayments) && w.laborPayments.length > 0 && (
                          <div className="space-y-0.5 pt-1 border-t">
                            {w.laborPayments.slice(-3).reverse().map((p: any, i: number) => (
                              <p key={i} className="text-[10px] font-bold text-muted-foreground">Paid ${(p.amountCents / 100).toFixed(2)}{p.method ? ` · ${p.method}` : ''} · {fmtWhen(p.at)}</p>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Recent activity */}
                      {st.recent.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Recent jobs</p>
                          {st.recent.map((t: any) => (
                            <div key={t.id} className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${t.status === 'resolved' ? 'bg-emerald-500' : t.status === 'cancelled' ? 'bg-slate-300' : isTicketOverdue(t) ? 'bg-red-500' : 'bg-amber-500'}`} />
                              <span className="flex-1 min-w-0 truncate">{t.title}{t.boothName ? ` · ${t.boothName}` : ''}</span>
                              <span className="text-[9px] font-bold text-slate-400 shrink-0">{fmtWhen(t.resolvedAt || t.updatedAt || t.createdAt)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Access */}
                      <div className="flex gap-2">
                        {w.phone && (
                          <a href={`sms:${w.phone}?&body=${encodeURIComponent(`Your maintenance portal for the studio — open tickets, add notes, mark resolved: ${workerLink(w)}`)}`}
                            className="flex-1 h-9 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest flex items-center justify-center">Text link</a>
                        )}
                        <button onClick={() => { try { navigator.clipboard.writeText(workerLink(w)); toast({ title: 'Link copied' }); } catch { /* select manually */ } }}
                          className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700">Copy link</button>
                        <button onClick={() => rotateToken(w)} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-red-500">Rotate</button>
                      </div>
                      <button onClick={() => toggleWorker(w)} className="text-[9px] font-black uppercase tracking-widest text-slate-400 underline underline-offset-2">
                        {w.active === false ? 'Reactivate' : 'Deactivate'} {w.name}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="rounded-2xl border-2 border-dashed p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Add a worker</p>
              <input value={wForm.name} onChange={(e) => setWForm(f => ({ ...f, name: e.target.value }))} placeholder="Name *" className="w-full h-10 rounded-xl border-2 px-3 text-sm font-medium" />
              <div className="grid grid-cols-2 gap-2">
                <input value={wForm.phone} onChange={(e) => setWForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                <input value={wForm.email} onChange={(e) => setWForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="h-10 rounded-xl border-2 px-3 text-sm font-medium" />
              </div>
              <div className="flex rounded-xl border-2 overflow-hidden">
                {([
                  { v: 'per_job', label: 'Per job — pay per ticket' },
                  { v: 'payroll', label: 'Payroll — wages via Staff page' },
                ] as const).map((pt) => (
                  <button key={pt.v} onClick={() => setWForm(f => ({ ...f, payType: pt.v }))}
                    className={`flex-1 h-10 text-[9px] font-black uppercase tracking-widest px-2 ${wForm.payType === pt.v ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>
                    {pt.label}
                  </button>
                ))}
              </div>
              <button onClick={addWorker} disabled={!wForm.name.trim()} className="w-full h-10 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">Add worker</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MaintenanceSection;
