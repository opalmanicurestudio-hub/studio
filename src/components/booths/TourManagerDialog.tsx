'use client';

// src/components/booths/TourManagerDialog.tsx
//
// Full lifecycle management for a single booth tour (a boothApplications doc
// with kind:'tour'): confirm, reschedule, check the visitor in, record the
// outcome (showed / no-show + interest + notes), and spin off a follow-up
// task. Everything writes back to the tour record so the planner and CRM stay
// in sync, and the outcome drives the tour → rental KPIs.

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { doc, setDoc, collection } from 'firebase/firestore';
import { Calendar, Clock, CheckCircle2, XCircle, LogIn, RotateCcw, Printer, FileText, UserPlus } from 'lucide-react';
import { visitorConfirmationHtml, staffPrepSheetHtml, openPrintable, resolveTourPrintoutConfig, TourPrintoutConfig } from '@/lib/tour-printouts';

interface TourManagerDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  firestore: any;
  tenantId: string;
  tour: any;              // boothApplications doc, kind:'tour'
  studioName?: string | null;
  studioPhone?: string | null;
  studioEmail?: string | null;
  studioAddress?: string | null;
  printConfig?: TourPrintoutConfig | null;   // owner-customized sheet copy
  onConvert?: (tour: any) => void;           // convert this visitor to a renter
  onDone?: () => void;
  /* The tours/{id} doc this visit is booked against, when there is one.
   * This dialog has always written to boothApplications only, which was fine
   * while the hub was the only place tours were read. The calendar, the slot
   * checker and the pipeline's status strip all read tours/{id} — so a
   * reschedule or a no-show recorded here has to land in BOTH or the two
   * disagree, and the one people trust is the one on screen. */
  tourId?: string | null;
  /* Who is operating this dialog. Every lifecycle action is stamped with it,
   * so the history can say "confirmed by Dana" rather than leaving the shop to
   * guess which of them dealt with it. */
  actorName?: string | null;
  /* People who can host a visit — the roster, so a tour can be handed to a
   * specific person instead of belonging to nobody. */
  hosts?: { id: string; name: string }[];
}

const t12 = (hhmm: string): string => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return hhmm || '';
  let h = Number(m[1]); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
};
const fmtWhen = (iso?: string | null): string => {
  if (!iso) return 'No time set';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'No time set';
  try { return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso; }
};

export function TourManagerDialog({ open, onOpenChange, firestore, tenantId, tour, tourId, actorName, hosts, studioName, studioPhone, studioEmail, studioAddress, printConfig, onConvert, onDone }: TourManagerDialogProps) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(tour?.tourNotes || '');
  const [rescheduling, setRescheduling] = useState(false);
  const [rDate, setRDate] = useState(tour?.tourStartIso ? String(tour.tourStartIso).slice(0, 10) : '');
  const [rTime, setRTime] = useState('10:00');
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [interest, setInterest] = useState('');
  const [nextStep, setNextStep] = useState('');

  const ref = () => doc(firestore, 'tenants', tenantId, 'boothApplications', tour.id);
  const nowIso = () => new Date().toISOString();
  const status = tour?.status || 'new';

  /* What the tours doc should say, given a change to the application. Only
   * the fields the scheduler and the pipeline actually read — never a blind
   * copy, which would drag application-only fields into the calendar. */
  const tourMirror = (data: any): any | null => {
    const out: any = {};
    if (data.status === 'confirmed') out.status = 'confirmed';
    if (data.status === 'checked_in') { out.status = 'checked_in'; out.checkedInAt = data.tourCheckedInAt || nowIso(); }
    if (data.hostId !== undefined) { out.hostId = data.hostId; out.hostName = data.hostName || null; }
    if (data.status === 'no_show') { out.status = 'no_show'; out.decidedAt = data.tourOutcome?.at || nowIso(); }
    if (data.status === 'closed') { out.status = 'completed'; out.decidedAt = data.tourOutcome?.at || nowIso(); }
    if (data.tourStartIso) {
      const st = new Date(data.tourStartIso);
      if (!isNaN(st.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        out.date = `${st.getFullYear()}-${pad(st.getMonth() + 1)}-${pad(st.getDate())}`;
        out.time = `${pad(st.getHours())}:${pad(st.getMinutes())}`;
        out.rescheduledAt = data.rescheduledAt || nowIso();
        out.status = 'confirmed';
      }
    }
    return Object.keys(out).length ? out : null;
  };

  const patch = async (data: any) => {
    if (busy) return;
    setBusy(true);
    try {
      await setDoc(ref(), data, { merge: true });
      const mirror = tourId ? tourMirror(data) : null;
      if (mirror) {
        try {
          await setDoc(doc(firestore, 'tenants', tenantId, 'tours', tourId as string), mirror, { merge: true });
        } catch { /* the application write stands; the strip re-syncs on next edit */ }
      }
      onDone?.();
    }
    catch { /* surfaced by caller's live data */ }
    finally { setBusy(false); }
  };

  const by = () => (actorName ? { by: actorName } : {});

  // Confirming here now does what approving in the pipeline does: it tells the
  // visitor. The two were the same decision reached from different screens,
  // and only one of them was speaking to the person waiting on the answer.
  const confirm = async () => {
    await patch({ status: 'confirmed', confirmedAt: nowIso(), confirmedBy: actorName || null });
    if (tourId) {
      try {
        await fetch('/api/booths/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tour-decision', tenantId, tourId, decision: 'approve' }),
        });
      } catch { /* the confirmation stands */ }
    }
  };

  // Check-in is the arrival stamp: they are HERE. It sends nothing — the
  // person is standing in front of you — but it does move the tour doc, so
  // the floor and the calendar agree with the pipeline.
  const checkIn = () => patch({ status: 'checked_in', tourCheckedInAt: nowIso(), checkedInBy: actorName || null });

  const noShow = () => patch({ status: 'no_show', tourOutcome: { showed: false, at: nowIso(), ...by() } }).then(() => onOpenChange(false));

  const assignHost = (h: { id: string; name: string } | null) =>
    patch({ hostId: h?.id || null, hostName: h?.name || null, hostAssignedAt: nowIso(), hostAssignedBy: actorName || null });

  const saveReschedule = async () => {
    if (!rDate || !/^\d{2}:\d{2}$/.test(rTime)) return;
    // Remember where it was, so the message can say what changed.
    const previousIso = tour?.tourStartIso || null;
    const st = new Date(`${rDate}T${rTime}:00`);
    const en = new Date(st.getTime() + 30 * 60000);
    const d = new Date(`${rDate}T00:00:00`);
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    await patch({
      tourStartIso: st.toISOString(), tourEndIso: en.toISOString(),
      tourSlot: `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()} · ${t12(rTime)}`,
      tourTimeTBD: false, rescheduledAt: nowIso(),
      status: status === 'no_show' || status === 'closed' ? 'confirmed' : status,
    });
    // Tell them. Moving somebody's visit in silence is how a confirmed tour
    // turns into a no-show — and this dialog has always moved it in silence.
    // Best-effort: the new time is already saved either way.
    if (tourId) {
      try {
        await fetch('/api/booths/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tour-rescheduled', tenantId, tourId, previousIso }),
        });
      } catch { /* the move stands */ }
    }
    setRescheduling(false);
  };

  const saveNotes = () => patch({ tourNotes: notes });

  // Printouts — build from the live tour (include any unsaved notes so the prep
  // sheet reflects what's on screen) and open a print-ready page in a new tab.
  const studio = {
    name: studioName || undefined,
    phone: studioPhone || undefined,
    email: studioEmail || undefined,
    address: studioAddress || undefined,
  };
  const printVisitor = () => openPrintable(visitorConfirmationHtml(tour || {}, studio, printConfig));
  const printPrep = () => openPrintable(staffPrepSheetHtml({ ...(tour || {}), tourNotes: notes || tour?.tourNotes }, studio, printConfig));

  // Outcome chips read the SAME config as the printed prep sheet, so what you
  // capture in-app always matches the sheet (and the Hot-leads KPI).
  const cfg = resolveTourPrintoutConfig(printConfig);

  const completeTour = async () => {
    await patch({
      status: 'closed',
      tourOutcome: { showed: true, interest: interest || null, nextStep: nextStep || null, notes: notes || null, at: nowIso(), by: actorName || null },
    });
    // Spin off a follow-up task when there's a next step.
    if (nextStep && nextStep !== 'None') {
      try {
        const tRef = doc(collection(firestore, `tenants/${tenantId}/tasks`));
        await setDoc(tRef, {
          id: tRef.id, title: `${nextStep} — ${tour.name || 'tour visitor'}`,
          kind: 'tour_followup', relatedTourId: tour.id,
          contactName: tour.name || null, contactPhone: tour.phone || null, contactEmail: tour.email || null,
          done: false, createdAt: nowIso(),
        });
      } catch { /* task is best-effort */ }
    }
    onOpenChange(false);
  };

  const StatusBadge = () => {
    const map: Record<string, { t: string; c: string }> = {
      new: { t: 'Requested', c: 'bg-sky-100 text-sky-700' },
      in_review: { t: 'Contacted', c: 'bg-amber-100 text-amber-700' },
      confirmed: { t: 'Confirmed', c: 'bg-indigo-100 text-indigo-700' },
      checked_in: { t: 'Checked in', c: 'bg-emerald-100 text-emerald-700' },
      closed: { t: 'Toured', c: 'bg-slate-900 text-white' },
      no_show: { t: 'No-show', c: 'bg-red-100 text-red-700' },
    };
    const s = map[status] || map.new;
    return <span className={`text-[9px] font-black uppercase tracking-widest rounded-full px-2 py-0.5 ${s.c}`}>{s.t}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[2rem] border-2 shadow-2xl p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-3 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-lg font-black uppercase tracking-tighter">Tour · {tour?.name || 'Visitor'}</DialogTitle>
            <StatusBadge />
          </div>
          <DialogDescription className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
            {tour?.boothName || 'Space'} · {fmtWhen(tour?.tourStartIso)}
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Contact */}
          <div className="flex gap-2">
            {tour?.phone && <a href={`tel:${tour.phone}`} className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center">Call</a>}
            {tour?.phone && <a href={`sms:${tour.phone}`} className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center">Text</a>}
            {tour?.email && <a href={`mailto:${tour.email}`} className="flex-1 h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center">Email</a>}
          </div>

          {/* Printouts */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={printVisitor} className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50"><Printer className="w-3.5 h-3.5" /> Visitor confirmation</button>
            <button onClick={printPrep} className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50"><FileText className="w-3.5 h-3.5" /> Prep sheet</button>
          </div>

          {/* Convert to renter — the post-tour bridge */}
          {onConvert && status !== 'converted' && !tour?.convertedRenterId && (tour?.name || tour?.phone || tour?.email) && (
            <button
              onClick={() => onConvert(tour)}
              className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5"
            >
              <UserPlus className="w-4 h-4" /> Convert to renter
            </button>
          )}
          {(status === 'converted' || tour?.convertedRenterId) && (
            <div className="rounded-xl bg-emerald-50 border-2 border-emerald-200 px-3 py-2 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">✓ Converted to renter</p>
            </div>
          )}

          {/* Reschedule */}
          <div className="rounded-2xl border-2 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> When</p>
              <button onClick={() => setRescheduling(v => !v)} className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> {rescheduling ? 'Close' : 'Reschedule'}</button>
            </div>
            {!rescheduling ? (
              <p className="text-sm font-bold text-slate-800">{fmtWhen(tour?.tourStartIso)}{tour?.tourTimeTBD ? ' · time to confirm' : ''}</p>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input type="date" value={rDate} onChange={e => setRDate(e.target.value)} className="flex-1 h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                  <input type="time" value={rTime} onChange={e => setRTime(e.target.value)} className="w-28 h-10 rounded-xl border-2 px-3 text-sm font-medium" />
                </div>
                <Button onClick={saveReschedule} disabled={busy || !rDate} className="w-full h-10 rounded-xl font-black uppercase tracking-widest text-[10px]">Save new time</Button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Notes</p>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={saveNotes} rows={2} placeholder="What did they want, first impressions, follow-up…" className="w-full rounded-xl border-2 px-3 py-2 text-sm font-medium resize-none" />
          </div>

          {Array.isArray(hosts) && hosts.length > 0 && (
            <div className="rounded-2xl border-2 p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Who is showing them round
              </p>
              <div className="flex flex-wrap gap-1.5">
                {hosts.map((h) => {
                  const on = tour?.hostId === h.id;
                  return (
                    <button key={h.id} type="button" disabled={busy}
                      onClick={() => assignHost(on ? null : h)}
                      aria-pressed={on}
                      className={`h-10 px-3 rounded-full border-2 text-[10px] font-black uppercase tracking-wide transition-colors ${on ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600'}`}>
                      {h.name}
                    </button>
                  );
                })}
              </div>
              {tour?.hostName && (
                <p className="text-[10px] font-bold text-muted-foreground">
                  {tour.hostName} is hosting{tour.hostAssignedBy ? ` — assigned by ${tour.hostAssignedBy}` : ''}.
                </p>
              )}
            </div>
          )}

          {/* Lifecycle actions */}
          {!outcomeOpen ? (
            <div className="grid grid-cols-2 gap-2">
              {(status === 'new' || status === 'in_review') && (
                <Button onClick={confirm} disabled={busy} className="h-11 rounded-xl font-black uppercase tracking-widest text-[10px]"><CheckCircle2 className="w-4 h-4 mr-1" /> Confirm</Button>
              )}
              {(status === 'confirmed' || status === 'new' || status === 'in_review') && (
                <Button onClick={checkIn} disabled={busy} variant="outline" className="h-11 rounded-xl font-black uppercase tracking-widest text-[10px] border-2"><LogIn className="w-4 h-4 mr-1" /> Check in</Button>
              )}
              <Button onClick={() => setOutcomeOpen(true)} disabled={busy} className="h-11 rounded-xl font-black uppercase tracking-widest text-[10px] bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="w-4 h-4 mr-1" /> Mark toured</Button>
              <Button onClick={noShow} disabled={busy} variant="outline" className="h-11 rounded-xl font-black uppercase tracking-widest text-[10px] border-2 text-red-600 border-red-300"><XCircle className="w-4 h-4 mr-1" /> No-show</Button>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 p-3.5 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Tour outcome</p>
              <div>
                <p className="text-[10px] font-bold text-slate-500 mb-1">Interest level</p>
                <div className="flex flex-wrap gap-1.5">
                  {cfg.interestLevels.map(v => (
                    <button key={v} type="button" onClick={() => setInterest(v)} className={`h-8 px-3 rounded-full border-2 text-[10px] font-black uppercase tracking-wide ${interest === v ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600'}`}>{v}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 mb-1">Next step</p>
                <div className="flex flex-wrap gap-1.5">
                  {cfg.nextSteps.map(v => (
                    <button key={v} type="button" onClick={() => setNextStep(v)} className={`h-8 px-3 rounded-full border-2 text-[10px] font-black uppercase tracking-wide ${nextStep === v ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600'}`}>{v}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={() => setOutcomeOpen(false)} variant="ghost" className="flex-1 h-10 rounded-xl font-black uppercase tracking-widest text-[10px] text-slate-400">Back</Button>
                <Button onClick={completeTour} disabled={busy} className="flex-[2] h-10 rounded-xl font-black uppercase tracking-widest text-[10px] bg-emerald-600 hover:bg-emerald-700">Save outcome{nextStep && nextStep !== 'None' ? ' + task' : ''}</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TourManagerDialog;
