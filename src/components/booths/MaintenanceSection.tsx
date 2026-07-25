'use client';

// src/components/booths/MaintenanceSection.tsx
//
// The owner's maintenance command center — lives in the Booth Hub's
// Operations tab. One queue for every issue, however it arrived (renter
// portal, floor tap, or logged here), with SLA deadlines, assignment,
// a public per-ticket thread, and the worker roster with their portal
// links. Server automations (SMS to techs and reporters) are triggered
// fire-and-forget via /api/maintenance.

import React, { useMemo, useState } from 'react';
import { doc, setDoc, updateDoc, collection } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Wrench, Plus, Users } from 'lucide-react';
import {
  dueAtFor, ticketBlocksBooth, isTicketOverdue,
  TICKET_STATUS_LABELS, TICKET_STATUS_TONES, TICKET_PRIORITY_LABELS, TICKET_PRIORITY_TONES, TICKET_CATEGORIES,
  type TicketPriority, type TicketStatus,
} from '@/lib/maintenance';

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
  firestore, tenantId, locationId, booths, tickets, workers, ownerName,
}: {
  firestore: any;
  tenantId: string;
  locationId?: string | null;
  booths: any[];
  tickets: any[];
  workers: any[];
  ownerName?: string;
}) {
  const { toast } = useToast();
  const me = ownerName || 'Owner';

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: 'equipment', priority: 'normal' as TicketPriority, boothId: '', assigneeId: '' });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [workersOpen, setWorkersOpen] = useState(false);
  const [wForm, setWForm] = useState({ name: '', phone: '', email: '' });
  const [showResolved, setShowResolved] = useState(false);

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
      const worker = activeWorkers.find((w: any) => w.id === form.assigneeId);
      const ref = doc(collection(firestore, 'tenants', tenantId, 'tickets'));
      const ticket: any = {
        id: ref.id, tenantId, locationId: locationId || null,
        title: form.title.trim().slice(0, 140),
        description: form.description.trim().slice(0, 2000),
        category: form.category, priority: form.priority, status: 'open',
        boothId: booth?.id || null, boothName: booth?.name || null,
        reporter: { type: 'owner', name: me },
        assigneeId: worker?.id || null, assigneeName: worker?.name || null,
        updates: [{ at: nowIso, by: me, byType: 'owner', note: 'Ticket created', status: 'open' }],
        createdAt: nowIso, updatedAt: nowIso, dueAt: dueAtFor(form.priority), resolvedAt: null,
      };
      await setDoc(ref, ticket);
      await syncBooth(ticket.boothId, [...tickets, ticket]);
      if (worker) fireAndForget('notify-assign', ref.id);
      toast({ title: 'Ticket created', description: worker ? `${worker.name} will be texted the details.` : 'Assign a worker to get it moving.' });
      setCreateOpen(false);
      setForm({ title: '', description: '', category: 'equipment', priority: 'normal', boothId: '', assigneeId: '' });
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

  const setStatus = async (t: any, status: TicketStatus) => {
    const patch: any = { status };
    if (status === 'resolved') patch.resolvedAt = new Date().toISOString();
    if (await patchTicket(t, patch, { status })) {
      const updated = tickets.map((x: any) => x.id === t.id ? { ...x, status } : x);
      await syncBooth(t.boothId, updated);
      fireAndForget('notify-reporter', t.id);
    }
  };

  const addNote = async (t: any) => {
    if (!noteDraft.trim()) return;
    if (await patchTicket(t, {}, { note: noteDraft.trim().slice(0, 1000) })) setNoteDraft('');
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
        <div className="ml-auto flex gap-2">
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
                        {[t.boothName, TICKET_CATEGORIES.find(c => c.value === t.category)?.label || t.category,
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
                    {(t.updates || []).length > 0 && (
                      <div className="space-y-1">
                        {(t.updates || []).slice(-6).map((u: any, i: number) => (
                          <p key={i} className="text-[11px] font-medium text-slate-500">
                            <span className="font-black text-slate-700">{u.by}</span>
                            <span className="text-slate-400 text-[9px] uppercase font-black"> {u.byType}</span>
                            {u.status ? ` → ${TICKET_STATUS_LABELS[u.status as TicketStatus] || u.status}` : ''}
                            {u.note ? ` — ${u.note}` : ''}
                            <span className="text-slate-400"> · {fmtWhen(u.at)}</span>
                          </p>
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
                          <button onClick={() => setStatus(t, 'resolved')} className="h-9 px-3 rounded-xl bg-emerald-600 text-white font-black uppercase text-[9px] tracking-widest">Resolve</button>
                          <button onClick={() => setStatus(t, 'cancelled')} className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-500">Cancel</button>
                        </div>
                        <div className="flex gap-2">
                          <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note (visible to reporter + tech)…"
                            className="flex-1 h-9 rounded-xl border-2 px-3 text-sm font-medium" />
                          <button onClick={() => addNote(t)} disabled={!noteDraft.trim()} className="h-9 px-3 rounded-xl bg-slate-900 text-white font-black uppercase text-[9px] tracking-widest disabled:opacity-40">Post</button>
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
            </div>
            <p className="text-[10px] font-bold text-muted-foreground">Urgent/high tickets on a station take it off the floor automatically until resolved.</p>
            <button onClick={createTicket} disabled={saving || !form.title.trim()}
              className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] disabled:opacity-40">
              {saving ? 'Creating…' : 'Create ticket'}
            </button>
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
