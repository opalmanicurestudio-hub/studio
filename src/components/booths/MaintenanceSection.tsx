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
import { doc, setDoc, updateDoc, collection, onSnapshot } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useToast } from '@/hooks/use-toast';
import { auditEntry } from '@/lib/audit';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Wrench, Plus, Users, CalendarClock, BookUser, Phone, Mail, MessageCircle } from 'lucide-react';
import {
  dueAtFor, ticketBlocksBooth, isTicketOverdue, addDaysISO, PLAN_INTERVALS,
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
  firestore, storage, tenantId, locationId, booths, tickets, workers, plans, ownerName,
}: {
  firestore: any;
  storage?: any;
  tenantId: string;
  locationId?: string | null;
  booths: any[];
  tickets: any[];
  workers: any[];
  plans: any[];
  ownerName?: string;
}) {
  const { toast } = useToast();
  const me = ownerName || 'Owner';

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: 'equipment', priority: 'normal' as TicketPriority, boothId: '', resourceId: '', assigneeId: '' });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [workersOpen, setWorkersOpen] = useState(false);
  const [wForm, setWForm] = useState({ name: '', phone: '', email: '' });
  const [showResolved, setShowResolved] = useState(false);
  // Photos (owner-side: direct client Storage upload — the owner is authed)
  const [createPhotos, setCreatePhotos] = useState<string[]>([]);
  const [notePhoto, setNotePhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Resolve-with-cost inline confirm
  const [resolveForId, setResolveForId] = useState<string | null>(null);
  const [costDraft, setCostDraft] = useState('');
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
  const uploadPhoto = async (file: File): Promise<string | null> => {
    if (!storage) { toast({ variant: 'destructive', title: 'Uploads unavailable' }); return null; }
    if (!file.type.startsWith('image/')) { toast({ variant: 'destructive', title: 'Not an image' }); return null; }
    if (file.size > 5_000_000) { toast({ variant: 'destructive', title: 'Photo too large', description: 'Keep it under 5 MB.' }); return null; }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 60);
      const snap = await uploadBytes(storageRef(storage, `tenants/${tenantId}/tickets/owner/${Date.now()}-${safe}`), file);
      return await getDownloadURL(snap.ref);
    } catch { toast({ variant: 'destructive', title: 'Upload failed', description: 'Try a smaller image.' }); return null; }
    finally { setUploading(false); }
  };

  const activeWorkers = useMemo(() => workers.filter((w: any) => w.active !== false), [workers]);
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
        body: JSON.stringify({ action, tenantId, ticketId, origin: window.location.origin }),
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
      if (worker) fireAndForget('notify-assign', ref.id);
      toast({ title: 'Ticket created', description: worker ? `${worker.name} will be texted the details.` : 'Assign a worker to get it moving.' });
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
      fireAndForget('notify-assign', t.id);
      toast({ title: `Assigned to ${w.name}`, description: w.phone ? 'They\'ll get a text with the details.' : 'No phone on file — share their portal link directly.' });
    }
  };

  const setStatus = async (t: any, status: TicketStatus, costCents = 0) => {
    const patch: any = { status };
    if (status === 'resolved') {
      patch.resolvedAt = new Date().toISOString();
      if (costCents > 0) patch.costCents = costCents;
    }
    const entry: any = { status };
    if (status === 'resolved' && costCents > 0) entry.note = `Resolved · cost $${(costCents / 100).toFixed(2)}`;
    if (await patchTicket(t, patch, entry)) {
      // Cost → a real ledger expense, attributed to the ticket + station,
      // plus an audit entry. Maintenance spend becomes analyzable data.
      if (status === 'resolved' && costCents > 0) {
        try {
          const nowIso = new Date().toISOString();
          const txnRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
          await setDoc(txnRef, {
            id: txnRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
            amount: costCents / 100, category: 'Maintenance & Repairs',
            description: `Maintenance — ${t.title}${t.boothName ? ` (${t.boothName})` : ''}`,
            clientOrVendor: t.assigneeName || 'Maintenance', date: nowIso, paymentMethod: 'See receipt',
            hasReceipt: false, sourceId: t.id, tenantId, createdAt: nowIso,
          });
          const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
          await setDoc(aRef, { id: aRef.id, ...auditEntry({
            action: 'maintenance.cost_logged', targetType: 'ticket', targetId: t.id,
            summary: `Maintenance cost $${(costCents / 100).toFixed(2)} logged for "${t.title}"${t.boothName ? ` (${t.boothName})` : ''}`,
            amount: costCents / 100, actor: { type: 'user', name: me },
          }) });
          toast({ title: 'Resolved', description: `$${(costCents / 100).toFixed(2)} logged under Maintenance & Repairs.` });
        } catch { toast({ variant: 'destructive', title: 'Cost not logged', description: 'The ticket is resolved — add the expense in the ledger manually.' }); }
      }
      const updated = tickets.map((x: any) => x.id === t.id ? { ...x, status } : x);
      await syncBooth(t.boothId, updated);
      fireAndForget('notify-reporter', t.id);
      setResolveForId(null); setCostDraft('');
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
        token: newToken(), active: true, createdAt: new Date().toISOString(),
      });
      setWForm({ name: '', phone: '', email: '' });
      toast({ title: 'Worker added', description: 'Send them their portal link below.' });
    } catch { toast({ variant: 'destructive', title: 'Could not add worker' }); }
  };
  const workerLink = (w: any) => `${typeof window !== 'undefined' ? window.location.origin : ''}/maintain/${tenantId}?t=${w.token}`;
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xs font-black uppercase tracking-widest flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Maintenance</h2>
        {openCount > 0 && <span className="h-5 min-w-5 px-1.5 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{openCount}</span>}
        <button onClick={() => setShowResolved(o => !o)} className="text-[10px] font-bold text-muted-foreground underline underline-offset-2">
          {showResolved ? 'hide resolved' : 'show resolved'}
        </button>
        <div className="ml-auto flex gap-2 flex-wrap">
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
                    {typeof t.costCents === 'number' && t.costCents > 0 && (
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cost ${(t.costCents / 100).toFixed(2)} · logged to ledger</p>
                    )}
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
                          <button onClick={() => { setResolveForId(resolveForId === t.id ? null : t.id); setCostDraft(''); }}
                            className="h-9 px-3 rounded-xl bg-emerald-600 text-white font-black uppercase text-[9px] tracking-widest">Resolve</button>
                          <button onClick={() => setStatus(t, 'cancelled')} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Cancel</button>
                        </div>
                        {resolveForId === t.id && (
                          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-2.5 flex gap-2 items-center flex-wrap">
                            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Cost $</span>
                            <input type="number" inputMode="decimal" min={0} value={costDraft} onChange={(e) => setCostDraft(e.target.value)}
                              placeholder="0 if none" autoFocus className="w-24 h-9 rounded-xl border-2 px-2 text-sm font-bold" />
                            <button onClick={() => setStatus(t, 'resolved', Math.round(Number(costDraft) * 100) || 0)}
                              className="h-9 px-3 rounded-xl bg-emerald-600 text-white font-black uppercase text-[9px] tracking-widest">
                              Confirm resolve{Number(costDraft) > 0 ? ` · $${Number(costDraft).toFixed(0)} to ledger` : ''}
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
            {providers.filter((p: any) => !p.archived).map((p: any) => (
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
                  <button onClick={() => giveProviderPortal(p)} title="They get a portal link and can be assigned tickets"
                    className="ml-auto h-9 px-2.5 rounded-xl border-2 border-indigo-300 text-indigo-700 font-black uppercase text-[9px] tracking-widest shrink-0">
                    Give portal
                  </button>
                  <button onClick={() => removeProvider(p)} className="h-9 px-2 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 underline underline-offset-2 shrink-0">Archive</button>
                </div>
              </div>
            ))}
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
      <Dialog open={workersOpen} onOpenChange={setWorkersOpen}>
        <DialogContent className="max-w-sm rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight">Maintenance workers</DialogTitle>
            <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Each gets a personal portal link — rotate it to revoke access
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {workers.map((w: any) => (
              <div key={w.id} className={`rounded-2xl border-2 p-3 space-y-2 ${w.active === false ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-2">
                  <p className="flex-1 min-w-0 text-sm font-black truncate">{w.name}</p>
                  <button onClick={() => toggleWorker(w)} className="text-[9px] font-black uppercase tracking-widest text-slate-400 underline underline-offset-2 shrink-0">
                    {w.active === false ? 'Reactivate' : 'Deactivate'}
                  </button>
                </div>
                {w.phone && <p className="text-[10px] font-bold text-muted-foreground">{w.phone}{w.email ? ` · ${w.email}` : ''}</p>}
                <div className="flex gap-2">
                  {w.phone && (
                    <a href={`sms:${w.phone}?&body=${encodeURIComponent(`Your maintenance portal for the studio — open tickets, add notes, mark resolved: ${workerLink(w)}`)}`}
                      className="flex-1 h-9 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest flex items-center justify-center">Text link</a>
                  )}
                  <button onClick={() => { try { navigator.clipboard.writeText(workerLink(w)); toast({ title: 'Link copied' }); } catch { /* select manually */ } }}
                    className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700">Copy link</button>
                  <button onClick={() => rotateToken(w)} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-red-500">Rotate</button>
                </div>
              </div>
            ))}
            <div className="rounded-2xl border-2 border-dashed p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Add a worker</p>
              <input value={wForm.name} onChange={(e) => setWForm(f => ({ ...f, name: e.target.value }))} placeholder="Name *" className="w-full h-10 rounded-xl border-2 px-3 text-sm font-medium" />
              <div className="grid grid-cols-2 gap-2">
                <input value={wForm.phone} onChange={(e) => setWForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                <input value={wForm.email} onChange={(e) => setWForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="h-10 rounded-xl border-2 px-3 text-sm font-medium" />
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
