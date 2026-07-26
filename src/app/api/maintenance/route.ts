/**
 * /api/maintenance — the maintenance ticket system's server surface.
 *
 * Serves the TECH PORTAL (token-authed maintenance workers) and the
 * NOTIFICATION automations. Owner/staff mutations happen client-side
 * under Firestore rules; renters go through /api/portal/renter; techs
 * and notifications come through here with the Admin SDK.
 *
 * POST { action, tenantId, ... }
 *   'worker-view'    { token }                    → worker + their queue
 *   'worker-update'  { token, ticketId, status?, note? }
 *                    → appends to the public thread, moves status,
 *                      auto-notifies the reporter (SMS if configured)
 *                      and the owner.
 *   'notify-assign'  { ticketId }                 → texts the assigned
 *                      tech their ticket + portal link. Called after the
 *                      owner assigns; deduped per (ticket, assignee).
 *   'notify-reporter'{ ticketId }                 → texts the reporter
 *                      the latest status. Called after owner-side status
 *                      changes; dedupe via lastReporterNotifyStatus.
 *
 * Security: worker token is the auth (rotate to revoke). notify-* take
 * only a ticketId and send predefined content to addresses already on
 * the ticket — nothing attacker-controllable beyond triggering a resend,
 * and dedupe stamps make even that a no-op.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { smsConfigured, sendTenantSms } from '@/lib/sms';
import { ticketBlocksBooth, TICKET_STATUS_LABELS, normalizeRules, timedMinutesOf, fmtMinutes } from '@/lib/maintenance';
import { uploadTicketPhotoFromDataUrl } from '@/lib/maintenance-server';

async function findWorker(db: FirebaseFirestore.Firestore, tenantId: string, token: string) {
  if (!token || String(token).length < 12) return null;
  const snap = await db.collection(`tenants/${tenantId}/maintenanceWorkers`)
    .where('token', '==', String(token)).limit(1).get();
  if (snap.empty) return null;
  const w = { id: snap.docs[0].id, ...(snap.docs[0].data() as any) };
  return w.active === false ? null : w;
}

// Keep the floor honest: any serious unfinished ticket holds its booth in
// 'maintenance'; when the last one clears, the booth returns to service and
// displayStatus re-derives reality (occupied if leased, vacant otherwise).
async function syncBoothFromTickets(db: FirebaseFirestore.Firestore, tenantId: string, boothId: string | null | undefined) {
  if (!boothId) return;
  try {
    const open = await db.collection(`tenants/${tenantId}/tickets`)
      .where('boothId', '==', boothId).get();
    const blocking = open.docs.some((d) => ticketBlocksBooth(d.data() as any));
    const bRef = db.doc(`tenants/${tenantId}/booths/${boothId}`);
    const bSnap = await bRef.get();
    if (!bSnap.exists) return;
    const b = bSnap.data() as any;
    if (blocking && b.status !== 'maintenance') {
      await bRef.set({ status: 'maintenance', updatedAt: new Date().toISOString() }, { merge: true });
    } else if (!blocking && b.status === 'maintenance') {
      await bRef.set({ status: 'vacant', maintenanceNote: null, maintenanceReportedAt: null, updatedAt: new Date().toISOString() }, { merge: true });
    }
  } catch { /* floor sync is best-effort — the ticket is the source of truth */ }
}

async function notifyOwner(db: FirebaseFirestore.Firestore, tenantId: string, message: string) {
  try {
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({ id: nRef.id, type: 'maintenance', read: false, createdAt: new Date().toISOString(), link: '/booths', message });
  } catch { /* best-effort */ }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId } = body || {};
    if (!action || !tenantId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();

    // ── Tech portal: my queue + my history ────────────────────────────
    if (action === 'worker-view') {
      const worker = await findWorker(db, tenantId, body.token);
      if (!worker) return NextResponse.json({ ok: false, error: 'Invalid or revoked link — ask the studio for a new one.' }, { status: 401 });
      const snap = await db.collection(`tenants/${tenantId}/tickets`).get();
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const isHelperOn = (t: any) => (t.helpers || []).some((h: any) => h.id === worker.id);
      const tickets = all
        .filter((t) => ['open', 'in_progress'].includes(t.status) && (!t.assigneeId || t.assigneeId === worker.id || isHelperOn(t)))
        .sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''));
      // Their track record travels with them: last 20 finished jobs, so a
      // tech can reference past work and reprint any work order on site.
      const history = all
        .filter((t) => t.status === 'resolved' && t.assigneeId === worker.id)
        .sort((a, b) => (b.resolvedAt || '').localeCompare(a.resolvedAt || ''))
        .slice(0, 20);
      let studioName = 'The studio';
      let rules: any = { autoApproveUnderCents: 0, requireQuoteOverCents: 0, receiptRequiredOverCents: 0 };
      try {
        const t = await db.doc(`tenants/${tenantId}`).get();
        studioName = (t.data() as any)?.name || (t.data() as any)?.businessName || studioName;
        rules = normalizeRules((t.data() as any)?.maintenanceRules);
      } catch { /* cosmetic */ }
      // Staff first names only — so a request can say WHO has the problem
      // ("blow dryer at Maya's chair") without exposing contact details.
      let staffNames: string[] = [];
      try {
        const sSnap = await db.collection(`tenants/${tenantId}/staff`).get();
        staffNames = sSnap.docs
          .map((d) => (d.data() as any))
          .filter((s) => (s.name || '').trim() && s.active !== false && !s.archived)
          .map((s) => String(s.name).trim())
          .sort();
      } catch { /* names are a nicety */ }
      // Minimal reporter exposure: name only — techs don't need contacts.
      return NextResponse.json({
        ok: true, studioName, rules, staffNames,
        worker: {
          id: worker.id, name: worker.name,
          payType: worker.payType === 'payroll' ? 'payroll' : 'per_job',
          unpaidLaborCents: Math.max(0, Math.round(Number(worker.unpaidLaborCents) || 0)),
          unpaidMaterialsCents: Math.max(0, Math.round(Number(worker.unpaidMaterialsCents) || 0)),
          hourlyRateCents: Math.max(0, Math.round(Number(worker.hourlyRateCents) || 0)),
        },
        tickets: tickets.map((t) => ({
          id: t.id, title: t.title, description: t.description,
          category: t.category, priority: t.priority, status: t.status,
          boothName: t.boothName || null, resourceName: t.resourceName || null,
          dueAt: t.dueAt, createdAt: t.createdAt,
          reporterName: t.reporter?.name || 'Studio',
          assignedToMe: t.assigneeId === worker.id,
          helping: isHelperOn(t) && t.assigneeId !== worker.id,
          quote: t.quote || null,
          quoteRequested: !!t.quoteRequested,
          requestMeta: t.requestMeta || null,
          openRequests: Array.isArray(t.openRequests) ? t.openRequests : [],
          workSessions: Array.isArray(t.workSessions) ? t.workSessions : [],
          photoUrls: Array.isArray(t.photoUrls) ? t.photoUrls : [],
          updates: (t.updates || []).map((u: any) => ({ at: u.at, by: u.by, byType: u.byType, note: u.note || null, status: u.status || null, photoUrl: u.photoUrl || null })),
        })),
        history: history.map((t) => ({
          id: t.id, title: t.title, category: t.category, priority: t.priority, status: t.status,
          boothName: t.boothName || null, resourceName: t.resourceName || null,
          createdAt: t.createdAt, resolvedAt: t.resolvedAt, dueAt: t.dueAt,
          costCents: t.costCents || 0, laborCents: t.laborCents || 0, laborHours: t.laborHours || 0,
          reporterName: t.reporter?.name || 'Studio', description: t.description || '',
          photoUrls: Array.isArray(t.photoUrls) ? t.photoUrls : [],
          updates: (t.updates || []).map((u: any) => ({ at: u.at, by: u.by, byType: u.byType, note: u.note || null, status: u.status || null, photoUrl: u.photoUrl || null })),
        })),
      });
    }

    // ── Tech portal: REQUEST something ─────────────────────────────────
    // "Need more caulk", "buy a replacement filter", "key to the supply
    // closet" — techs shouldn't have to text you and hope you remember.
    // A request is a normal ticket (category 'request'): it lands in your
    // queue, has a thread, notifies you, and resolving it with a
    // Materials $ logs the purchase to the ledger in the same motion.
    if (action === 'worker-request') {
      const worker = await findWorker(db, tenantId, body.token);
      if (!worker) return NextResponse.json({ ok: false, error: 'Invalid or revoked link.' }, { status: 401 });
      const title = String(body.title || '').trim().slice(0, 140);
      const detail = String(body.detail || '').trim().slice(0, 1000);
      if (!title) return NextResponse.json({ ok: false, error: 'Say what you need in a few words.' }, { status: 400 });
      // STRUCTURED context — the difference between "need caulk" and a
      // decision the owner can make from their phone in five seconds:
      // what kind, how many, by when, roughly how much, for which job,
      // and which staff member is affected.
      const kind = ['materials', 'tool', 'access', 'help', 'other'].includes(body.kind) ? body.kind : 'other';
      const qty = String(body.qty || '').trim().slice(0, 60);
      const neededBy = /^\d{4}-\d{2}-\d{2}$/.test(String(body.neededBy || '')) ? String(body.neededBy) : null;
      const estCostCents = Math.min(5_000_000, Math.max(0, Math.round(Number(body.estCostCents) || 0)));
      const forStaff = Array.isArray(body.forStaff) ? body.forStaff.map((s: any) => String(s).slice(0, 60)).slice(0, 8) : [];
      let relatedTicketId: string | null = null;
      let relatedTicketTitle: string | null = null;
      let relatedBoothId: string | null = null;
      let relatedBoothName: string | null = null;
      if (body.relatedTicketId) {
        try {
          const rt = await db.doc(`tenants/${tenantId}/tickets/${String(body.relatedTicketId)}`).get();
          if (rt.exists) {
            const rd = rt.data() as any;
            relatedTicketId = rt.id; relatedTicketTitle = rd.title || null;
            relatedBoothId = rd.boothId || null; relatedBoothName = rd.boothName || null;
          }
        } catch { /* linkage is a bonus */ }
      }
      const nowIso = new Date().toISOString();
      const kindLabel = ({ materials: 'Materials / parts', tool: 'Tool / equipment', access: 'Access / keys', help: 'Extra hands', other: 'Request' } as any)[kind];
      const metaBits = [
        qty ? `qty: ${qty}` : null,
        neededBy ? `needed by ${neededBy}` : null,
        estCostCents > 0 ? `est. $${(estCostCents / 100).toFixed(2)}` : null,
        forStaff.length ? `for ${forStaff.join(', ')}` : null,
      ].filter(Boolean).join(' · ');

      // JOB-LINKED REQUEST → it lives on THAT work order's thread. One
      // job, one thread, one paper trail — never a second ticket to
      // reconcile against the first.
      if (relatedTicketId) {
        const rRef = db.doc(`tenants/${tenantId}/tickets/${relatedTicketId}`);
        const rSnap = await rRef.get();
        const rt = rSnap.data() as any;
        let photoUrl: string | null = null;
        let photoError: string | undefined;
        if (typeof body.photoData === 'string' && body.photoData.startsWith('data:image')) {
          const up = await uploadTicketPhotoFromDataUrl(tenantId, relatedTicketId, body.photoData);
          photoUrl = up.url; photoError = up.error;
        }
        const reqEntry = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          kind, kindLabel, title, qty: qty || null, neededBy, estCostCents,
          forStaff, by: worker.name, at: nowIso, status: 'open' as const,
        };
        await rRef.set({
          openRequests: [...(Array.isArray(rt.openRequests) ? rt.openRequests : []), reqEntry],
          updates: [...(rt.updates || []), { at: nowIso, by: worker.name, byType: 'tech', note: `${kindLabel} request for this job: "${title}"${metaBits ? ` — ${metaBits}` : ''}${detail ? ` · ${detail.slice(0, 200)}` : ''}`, ...(photoUrl ? { photoUrl } : {}) }],
          ...(photoUrl ? { photoUrls: [...(Array.isArray(rt.photoUrls) ? rt.photoUrls : []), photoUrl] } : {}),
          updatedAt: nowIso,
        }, { merge: true });
        await notifyOwner(db, tenantId, `${kindLabel} request on "${rt.title}"${rt.boothName ? ` (${rt.boothName})` : ''} from ${worker.name}: "${title}"${metaBits ? ` (${metaBits})` : ''}${photoUrl ? ' · photo attached' : ''}`);
        await logAuditAdmin(db, tenantId, {
          action: 'maintenance.request_filed', targetType: 'ticket', targetId: relatedTicketId,
          summary: `${worker.name} (tech) requested on "${rt.title}": "${title}"${estCostCents > 0 ? ` · est. $${(estCostCents / 100).toFixed(2)}` : ''}`,
          ...(estCostCents > 0 ? { amount: estCostCents / 100 } : {}),
          actor: { type: 'user', name: worker.name, role: 'tech', via: 'maintenance-portal' },
        });
        return NextResponse.json({ ok: true, ticketId: relatedTicketId, appended: true, photoError });
      }

      // Standalone request → its own ticket, as before.
      const ref = db.collection(`tenants/${tenantId}/tickets`).doc();
      let photoUrl: string | null = null;
      let photoError: string | undefined;
      if (typeof body.photoData === 'string' && body.photoData.startsWith('data:image')) {
        const up = await uploadTicketPhotoFromDataUrl(tenantId, ref.id, body.photoData);
        photoUrl = up.url; photoError = up.error;
      }
      const { dueAtFor } = await import('@/lib/maintenance');
      await ref.set({
        id: ref.id, tenantId, locationId: null,
        title, description: detail, category: 'request', priority: neededBy && neededBy <= nowIso.slice(0, 10) ? 'high' : 'normal', status: 'open',
        boothId: relatedBoothId, boothName: relatedBoothName, resourceId: null, resourceName: null,
        requestMeta: { kind, kindLabel, qty: qty || null, neededBy, estCostCents, forStaff, relatedTicketId, relatedTicketTitle },
        photoUrls: photoUrl ? [photoUrl] : [],
        reporter: { type: 'tech', name: worker.name, phone: worker.phone || '' },
        assigneeId: null, assigneeName: null,
        updates: [{ at: nowIso, by: worker.name, byType: 'tech', note: `${kindLabel} request${metaBits ? ` — ${metaBits}` : ''}`, status: 'open', ...(photoUrl ? { photoUrl } : {}) }],
        createdAt: nowIso, updatedAt: nowIso, dueAt: neededBy ? `${neededBy}T23:59:59.000Z` : dueAtFor('normal'), resolvedAt: null,
      });
      await notifyOwner(db, tenantId, `${kindLabel} request from ${worker.name}: "${title}"${metaBits ? ` (${metaBits})` : ''}${photoUrl ? ' · photo attached' : ''}`);
      await logAuditAdmin(db, tenantId, {
        action: 'maintenance.request_filed', targetType: 'ticket', targetId: ref.id,
        summary: `${worker.name} (tech) requested: "${title}"${estCostCents > 0 ? ` · est. $${(estCostCents / 100).toFixed(2)}` : ''}`,
        ...(estCostCents > 0 ? { amount: estCostCents / 100 } : {}),
        actor: { type: 'user', name: worker.name, role: 'tech', via: 'maintenance-portal' },
      });
      return NextResponse.json({ ok: true, ticketId: ref.id, photoError });
    }

    // ── Tech portal: THE JOB CLOCK ─────────────────────────────────────
    // Start when the wrench comes out, stop when it goes away. Sessions
    // stack on the ticket; every start/stop lands on the thread; starting
    // claims the ticket and moves it to in-progress. The timer is evidence
    // for the hours claimed at resolve — not a leash.
    if (action === 'worker-timer') {
      const worker = await findWorker(db, tenantId, body.token);
      if (!worker) return NextResponse.json({ ok: false, error: 'Invalid or revoked link.' }, { status: 401 });
      const { ticketId } = body;
      const op = body.op === 'stop' ? 'stop' : 'start';
      if (!ticketId) return NextResponse.json({ ok: false, error: 'Missing ticketId.' }, { status: 400 });
      const ref = db.doc(`tenants/${tenantId}/tickets/${ticketId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
      const t = snap.data() as any;
      if (t.assigneeId && t.assigneeId !== worker.id && !(t.helpers || []).some((h: any) => h.id === worker.id)) {
        return NextResponse.json({ ok: false, error: 'This ticket is assigned to someone else.' }, { status: 403 });
      }
      const nowIso = new Date().toISOString();
      // Location stamp — proof of presence, captured fail-soft. A denied
      // permission or a basement with no GPS records null, never a block.
      const loc = body.loc && Number.isFinite(Number(body.loc.lat)) && Number.isFinite(Number(body.loc.lng))
        ? { lat: Number(body.loc.lat), lng: Number(body.loc.lng), acc: Math.round(Number(body.loc.acc) || 0) }
        : null;
      const sessions: any[] = Array.isArray(t.workSessions) ? [...t.workSessions] : [];
      const openIdx = sessions.findIndex((s) => !s.endAt);
      if (op === 'start') {
        if (openIdx >= 0) return NextResponse.json({ ok: true, already: true, timedMinutes: timedMinutesOf({ workSessions: sessions }, Date.now()) });
        sessions.push({ startAt: nowIso, by: worker.name, startLoc: loc });
        await ref.set({
          workSessions: sessions,
          assigneeId: t.assigneeId || worker.id,
          assigneeName: t.assigneeName || worker.name,
          ...(t.status === 'open' ? { status: 'in_progress' } : {}),
          updates: [...(t.updates || []), { at: nowIso, by: worker.name, byType: 'tech', note: `Clock started${loc ? ' · location recorded' : ' · no location available'}`, ...(t.status === 'open' ? { status: 'in_progress' } : {}) }],
          updatedAt: nowIso,
        }, { merge: true });
        if (t.status === 'open') await syncBoothFromTickets(db, tenantId, t.boothId);
        return NextResponse.json({ ok: true, timedMinutes: timedMinutesOf({ workSessions: sessions }, Date.now()) });
      }
      // stop
      if (openIdx < 0) return NextResponse.json({ ok: true, already: true, timedMinutes: timedMinutesOf({ workSessions: sessions }, Date.now()) });
      sessions[openIdx] = { ...sessions[openIdx], endAt: nowIso, endLoc: loc };
      const sessionMin = Math.max(1, Math.round((new Date(nowIso).getTime() - new Date(sessions[openIdx].startAt).getTime()) / 60000));
      const totalMin = timedMinutesOf({ workSessions: sessions }, Date.now());
      const patch: any = {
        workSessions: sessions,
        updates: [...(t.updates || []), { at: nowIso, by: worker.name, byType: 'tech', note: `Clock stopped — ${fmtMinutes(sessionMin)} this session · ${fmtMinutes(totalMin)} total on the job${loc ? ' · location recorded' : ''}` }],
        updatedAt: nowIso,
      };
      // AGREEMENT WATCH: the approved quote's hours are the deal. The
      // first time timed work passes them, everyone hears about it —
      // thread note + owner notification, exactly once.
      if (t.quote?.status === 'approved' && (t.quote.hours || 0) > 0 && totalMin > t.quote.hours * 60 && !t.agreementOverNotified) {
        patch.agreementOverNotified = true;
        patch.updates.push({ at: nowIso, by: 'Agreement', byType: 'system', note: `Timed work (${fmtMinutes(totalMin)}) has passed the agreed ${t.quote.hours}h — the studio has been notified.` });
        await notifyOwner(db, tenantId, `"${t.title}"${t.boothName ? ` (${t.boothName})` : ''}: ${worker.name}'s timed work (${fmtMinutes(totalMin)}) just passed the agreed ${t.quote.hours}h ($${((t.quote.totalCents || 0) / 100).toFixed(2)}). Check in before it grows.`);
      }
      await ref.set(patch, { merge: true });
      return NextResponse.json({ ok: true, timedMinutes: totalMin });
    }

    // ── Tech portal: SUBMIT A QUOTE ────────────────────────────────────
    // Priced BEFORE work starts: estimated hours (priced at the OWNER-set
    // rate — techs still can't invent labor dollars), expected materials,
    // and a note. Lands on the ticket as 'pending'; the owner approves or
    // declines from their queue and the tech gets a text either way.
    if (action === 'worker-quote') {
      const worker = await findWorker(db, tenantId, body.token);
      if (!worker) return NextResponse.json({ ok: false, error: 'Invalid or revoked link.' }, { status: 401 });
      const { ticketId } = body;
      if (!ticketId) return NextResponse.json({ ok: false, error: 'Missing ticketId.' }, { status: 400 });
      const ref = db.doc(`tenants/${tenantId}/tickets/${ticketId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
      const t = snap.data() as any;
      if (t.assigneeId && t.assigneeId !== worker.id && !(t.helpers || []).some((h: any) => h.id === worker.id)) {
        return NextResponse.json({ ok: false, error: 'This ticket is assigned to someone else.' }, { status: 403 });
      }
      const hours = Math.min(200, Math.max(0, Number(body.hours) || 0));
      const materialsCents = Math.min(5_000_000, Math.max(0, Math.round(Number(body.materialsCents) || 0)));
      const note = String(body.note || '').trim().slice(0, 500);
      const rateCents = Math.max(0, Math.round(Number(worker.hourlyRateCents) || 0));
      const laborCents = worker.payType !== 'payroll' && rateCents > 0 ? Math.round(hours * rateCents) : 0;
      const totalCents = materialsCents + laborCents;
      if (totalCents <= 0 && hours <= 0) {
        return NextResponse.json({ ok: false, error: 'Give the quote some substance — hours or materials.' }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      // The BUSINESS'S OWN RULE: quotes at/under their threshold skip the
      // owner entirely — small jobs get an instant green light.
      let rules: any = {};
      try { rules = normalizeRules(((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.maintenanceRules); } catch { /* rules off */ }
      const autoApproved = rules.autoApproveUnderCents > 0 && totalCents <= rules.autoApproveUnderCents;
      await ref.set({
        quote: { hours, materialsCents, laborCents, totalCents, note: note || null, by: worker.name, at: nowIso, status: autoApproved ? 'approved' : 'pending', decidedAt: autoApproved ? nowIso : null },
        quoteRequested: false,
        // A tech quoting an unassigned ticket claims it, same as touching it.
        assigneeId: t.assigneeId || worker.id,
        assigneeName: t.assigneeName || worker.name,
        updates: [...(t.updates || []),
          { at: nowIso, by: worker.name, byType: 'tech', note: `Quoted: ${hours > 0 ? `${hours}h` : ''}${hours > 0 && materialsCents > 0 ? ' + ' : ''}${materialsCents > 0 ? `$${(materialsCents / 100).toFixed(2)} materials` : ''}${laborCents > 0 ? ` = $${(totalCents / 100).toFixed(2)} total` : ''}${note ? ` — ${note}` : ''}` },
          ...(autoApproved ? [{ at: nowIso, by: 'Rules', byType: 'system', note: `Auto-approved — under the studio's $${(rules.autoApproveUnderCents / 100).toFixed(0)} threshold` }] : []),
        ],
        updatedAt: nowIso,
      }, { merge: true });
      await notifyOwner(db, tenantId, autoApproved
        ? `Quote auto-approved (your under-$${(rules.autoApproveUnderCents / 100).toFixed(0)} rule): ${worker.name} on "${t.title}" — $${(totalCents / 100).toFixed(2)}.`
        : `Quote from ${worker.name} on "${t.title}"${t.boothName ? ` (${t.boothName})` : ''}: $${(totalCents / 100).toFixed(2)}${hours > 0 ? ` (${hours}h${materialsCents > 0 ? ` + $${(materialsCents / 100).toFixed(2)} materials` : ''})` : ''} — approve or decline in Maintenance.`);
      await logAuditAdmin(db, tenantId, {
        action: 'maintenance.quote_submitted', targetType: 'ticket', targetId: ticketId,
        summary: `${worker.name} quoted $${(totalCents / 100).toFixed(2)} on "${t.title}"`,
        amount: totalCents / 100,
        actor: { type: 'user', name: worker.name, role: 'tech', via: 'maintenance-portal' },
      });
      return NextResponse.json({ ok: true, laborCents, totalCents, autoApproved });
    }

    // ── Automation: tell the tech the quote verdict ────────────────────
    // Owner approves/declines client-side; this just delivers the text.
    // Dedupe via quoteNotifiedStatus so repeat calls are no-ops.
    if (action === 'notify-quote') {
      const { ticketId } = body;
      if (!ticketId) return NextResponse.json({ ok: false, error: 'Missing ticketId.' }, { status: 400 });
      const ref = db.doc(`tenants/${tenantId}/tickets/${ticketId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
      const t = snap.data() as any;
      let sent = false;
      // Case 1: owner requested a quote → nudge the assignee to price it.
      if (t.quoteRequested && t.assigneeId && t.quoteRequestNotified !== t.assigneeId) {
        const w = (await db.doc(`tenants/${tenantId}/maintenanceWorkers/${t.assigneeId}`).get()).data() as any;
        if (w?.phone && smsConfigured()) {
          const r = await sendTenantSms(db, tenantId, w.phone,
            `Please send a quote before starting "${t.title}"${t.boothName ? ` at ${t.boothName}` : ''} — there's a Send quote button on the ticket in your portal.`);
          sent = r.ok;
        }
        await ref.set({ quoteRequestNotified: t.assigneeId }, { merge: true });
        return NextResponse.json({ ok: true, sent });
      }
      // Case 2: owner decided → tell the tech the verdict.
      if (t.quote && ['approved', 'declined'].includes(t.quote.status) && t.quoteNotifiedStatus !== t.quote.status && t.assigneeId) {
        const w = (await db.doc(`tenants/${tenantId}/maintenanceWorkers/${t.assigneeId}`).get()).data() as any;
        if (w?.phone && smsConfigured()) {
          const r = await sendTenantSms(db, tenantId, w.phone,
            t.quote.status === 'approved'
              ? `Quote APPROVED for "${t.title}" — $${((t.quote.totalCents || 0) / 100).toFixed(2)}. Go ahead when ready.`
              : `Quote declined for "${t.title}" — hold off. The studio will follow up${t.quote.declineNote ? `: ${t.quote.declineNote}` : '.'}`);
          sent = r.ok;
        }
        await ref.set({ quoteNotifiedStatus: t.quote.status }, { merge: true });
      }
      return NextResponse.json({ ok: true, sent });
    }

    // ── Tech portal: progress a ticket ────────────────────────────────
    // Accepts any combination of: a status move, a note, a photo (base64
    // data URL, uploaded server-side), and — when resolving — a cost that
    // flows straight into the ledger as a Maintenance & Repairs expense.
    if (action === 'worker-update') {
      const worker = await findWorker(db, tenantId, body.token);
      if (!worker) return NextResponse.json({ ok: false, error: 'Invalid or revoked link.' }, { status: 401 });
      const { ticketId } = body;
      const status = ['in_progress', 'resolved'].includes(body.status) ? body.status : null;
      const note = String(body.note || '').slice(0, 1000).trim();
      const hasPhoto = typeof body.photoData === 'string' && body.photoData.startsWith('data:image');
      // Techs can move the deadline ("parts arrive Thursday") — date only,
      // never backdated below now, and it lands on the thread for everyone.
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dueAt || '')) ? String(body.dueAt) : null;
      if (!ticketId || (!status && !note && !hasPhoto && !dueDate && !(Number(body.laborHours) > 0))) {
        return NextResponse.json({ ok: false, error: 'Add a note, a photo, hours, a new deadline, or a status change.' }, { status: 400 });
      }
      const ref = db.doc(`tenants/${tenantId}/tickets/${ticketId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
      const t = snap.data() as any;
      if (t.assigneeId && t.assigneeId !== worker.id && !(t.helpers || []).some((h: any) => h.id === worker.id)) {
        return NextResponse.json({ ok: false, error: 'This ticket is assigned to someone else.' }, { status: 403 });
      }
      const nowIso = new Date().toISOString();

      // Photo first (fail-soft — a bad photo never blocks the update).
      let photoUrl: string | null = null;
      let photoError: string | undefined;
      if (hasPhoto) {
        const up = await uploadTicketPhotoFromDataUrl(tenantId, ticketId, body.photoData);
        photoUrl = up.url; photoError = up.error;
      }

      const update: any = { at: nowIso, by: worker.name, byType: 'tech' };
      if (note) update.note = note;
      if (status) update.status = status;
      if (photoUrl) update.photoUrl = photoUrl;
      const patch: any = {
        updates: [...(t.updates || []), update],
        updatedAt: nowIso,
        // A tech touching an unassigned ticket claims it — no dispatcher needed.
        assigneeId: t.assigneeId || worker.id,
        assigneeName: t.assigneeName || worker.name,
      };
      if (photoUrl) patch.photoUrls = [...(Array.isArray(t.photoUrls) ? t.photoUrls : []), photoUrl];

      // Deadline move: end of the chosen day, never into the past.
      if (dueDate && !status) {
        const newDue = `${dueDate}T23:59:59.000Z`;
        if (newDue > nowIso) {
          patch.dueAt = newDue;
          update.note = [update.note, `Deadline moved to ${dueDate}`].filter(Boolean).join(' · ');
        }
      }

      // Costs at resolution → real money records, attributed to the ticket
      // (and its station) so maintenance spend is analyzable. Materials
      // become a ledger expense.
      //
      // LABOR IS NOT SELF-PRICED. Techs submit HOURS; the dollar amount is
      // computed HERE from the hourly rate the OWNER set on their worker
      // profile. Any dollar figure a client sends is ignored, so a tech
      // cannot invent their own pay. No rate on file → nothing accrues and
      // the tech is told to ask the studio. Hours are capped at 24/job.
      const costCents = status === 'resolved' ? Math.max(0, Math.round(Number(body.costCents) || 0)) : 0;
      // WHO PAID for the materials decides WHEN it's an expense:
      // 'studio' — studio money already left (studio card / cash given) →
      //            ledger expense now; the bank feed's near-match will
      //            reconcile the card line to it, no double count.
      // 'tech'   — the tech fronted their own money → the studio owes a
      //            REIMBURSEMENT. Nothing hits the ledger yet; it accrues
      //            on the worker's balance and books at payout, when the
      //            studio's cash actually moves.
      const paidBy: 'studio' | 'tech' = body.paidBy === 'tech' ? 'tech' : 'studio';
      // Hours can be logged at RESOLVE (the assignee) or MID-JOB with no
      // status change (helpers on a multi-worker job, or a multi-visit
      // job). Either way each worker's hours price at THEIR OWN rate and
      // accrue to THEIR OWN balance; the ticket accumulates totals plus a
      // per-worker breakdown in laborEntries.
      const laborHours = Math.min(24, Math.max(0, Number(body.laborHours) || 0));
      const rateCents = Math.max(0, Math.round(Number(worker.hourlyRateCents) || 0));
      const laborCents = laborHours > 0 && rateCents > 0 && worker.payType !== 'payroll'
        ? Math.round(laborHours * rateCents) : 0;
      // Only the ASSIGNEE moves status — helpers contribute, they don't close.
      if (status && t.assigneeId && t.assigneeId !== worker.id) {
        return NextResponse.json({ ok: false, error: `Only ${t.assigneeName || 'the assigned worker'} can change this job's status — add your notes and hours instead.` }, { status: 403 });
      }

      // Mileage: miles × the studio's per-mile rate (0 rate = no mileage).
      let rules: any = { mileageRateCents: 0 };
      if (status === 'resolved') {
        try { rules = normalizeRules(((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.maintenanceRules); } catch { /* rules off */ }
      }
      const miles = status === 'resolved' ? Math.min(500, Math.max(0, Number(body.miles) || 0)) : 0;
      const mileageCents = miles > 0 && (rules.mileageRateCents || 0) > 0 ? Math.round(miles * rules.mileageRateCents) : 0;

      // ── THE BUSINESS'S OWN APPROVAL RULES, enforced at the gate ───────
      // The portal warns early, but this is the wall: a resolve that
      // violates the studio's thresholds is rejected with the reason.
      if (status === 'resolved' && (costCents > 0 || laborCents > 0)) {
        const actual = costCents + laborCents;
        if (rules.requireQuoteOverCents > 0 && actual > rules.requireQuoteOverCents && t.quote?.status !== 'approved') {
          return NextResponse.json({ ok: false, error: `This studio requires an approved quote for jobs over $${(rules.requireQuoteOverCents / 100).toFixed(0)} — send a quote and wait for approval before resolving at $${(actual / 100).toFixed(2)}.` }, { status: 422 });
        }
        const hasAnyPhoto = !!photoUrl || (Array.isArray(t.photoUrls) && t.photoUrls.length > 0);
        if (rules.receiptRequiredOverCents > 0 && costCents > rules.receiptRequiredOverCents && !hasAnyPhoto) {
          return NextResponse.json({ ok: false, error: `This studio requires a receipt photo for materials over $${(rules.receiptRequiredOverCents / 100).toFixed(0)} — attach the receipt and resolve again.` }, { status: 422 });
        }
      }
      // Labor accumulates on the ticket — totals plus who-did-what.
      if (laborHours > 0) {
        patch.laborHours = Math.max(0, Number(t.laborHours) || 0) + laborHours;
        if (laborCents > 0) patch.laborCents = Math.max(0, Number(t.laborCents) || 0) + laborCents;
        patch.laborEntries = [...(Array.isArray(t.laborEntries) ? t.laborEntries : []),
          { workerId: worker.id, name: worker.name, hours: laborHours, cents: laborCents, at: nowIso }];
        if (!status) update.note = [update.note, `Logged ${laborHours}h${laborCents > 0 ? ` ($${(laborCents / 100).toFixed(2)})` : ''}`].filter(Boolean).join(' · ');
      }
      if (status) {
        patch.status = status;
        if (status === 'resolved') {
          patch.resolvedAt = nowIso;
          if (costCents > 0) { patch.costCents = Math.max(0, Number(t.costCents) || 0) + costCents; patch.materialsPaidBy = paidBy; }
          if (miles > 0) { patch.mileage = miles; if (mileageCents > 0) patch.mileageCents = mileageCents; }
          // Auto-stop a running clock — resolving IS stopping work.
          const sessions: any[] = Array.isArray(t.workSessions) ? [...t.workSessions] : [];
          const openIdx = sessions.findIndex((s) => !s.endAt);
          if (openIdx >= 0) {
            sessions[openIdx] = { ...sessions[openIdx], endAt: nowIso };
            patch.workSessions = sessions;
          }
        }
      }
      await ref.set(patch, { merge: true });

      let laborNote: string | null = null;
      if (laborHours > 0 && worker.payType === 'payroll') {
        laborNote = `${laborHours}h logged — covered by wages (payroll)`;
      } else if (laborHours > 0 && rateCents <= 0) {
        laborNote = `${laborHours}h logged — no hourly rate on file, nothing accrued`;
      } else if (laborCents > 0) {
        try {
          const { FieldValue } = await import('firebase-admin/firestore');
          await db.doc(`tenants/${tenantId}/maintenanceWorkers/${worker.id}`).set(
            { unpaidLaborCents: FieldValue.increment(laborCents) }, { merge: true });
          laborNote = `${laborHours}h × $${(rateCents / 100).toFixed(2)}/hr = $${(laborCents / 100).toFixed(2)} to ${worker.name}'s payout balance`;
        } catch { laborNote = 'could not accrue — log it manually'; }
      }
      // Mileage reimbursement rides the same payout balance (payroll
      // workers' mileage is flagged for their next paycheck instead).
      let mileageNote: string | null = null;
      if (mileageCents > 0) {
        if (worker.payType === 'payroll') {
          mileageNote = `${miles} mi = $${(mileageCents / 100).toFixed(2)} — add to their next payroll run`;
        } else {
          try {
            const { FieldValue } = await import('firebase-admin/firestore');
            await db.doc(`tenants/${tenantId}/maintenanceWorkers/${worker.id}`).set(
              { unpaidLaborCents: FieldValue.increment(mileageCents) }, { merge: true });
            mileageNote = `${miles} mi × $${(rules.mileageRateCents / 100).toFixed(2)} = $${(mileageCents / 100).toFixed(2)} to the payout balance`;
          } catch { mileageNote = `${miles} mi — could not accrue, log manually`; }
        }
      } else if (miles > 0) {
        mileageNote = `${miles} mi logged — no mileage rate set in Rules`;
      }
      // Agreement check at the finish line: resolving past the approved
      // quote is allowed (reality happens) but never silent.
      const overAgreement = t.quote?.status === 'approved' && (t.quote.totalCents || 0) > 0
        && (costCents + laborCents) > t.quote.totalCents;

      let materialsNote: string | null = null;
      if (costCents > 0 && paidBy === 'studio') {
        // Studio money already left → real expense, book it now.
        try {
          const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
          await txnRef.set({
            id: txnRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
            amount: costCents / 100, category: 'Maintenance & Repairs',
            description: `Maintenance — ${t.title}${t.boothName ? ` (${t.boothName})` : ''} · resolved by ${worker.name}`,
            clientOrVendor: worker.name, date: nowIso, paymentMethod: 'See receipt',
            // A photo attached alongside a costed resolution IS the receipt —
            // it rides the ledger entry, so tax time is a click, not a hunt.
            hasReceipt: !!photoUrl, receiptUrl: photoUrl || null,
            sourceId: ticketId, tenantId, createdAt: nowIso,
          });
          materialsNote = `$${(costCents / 100).toFixed(2)} studio-paid (logged to ledger)`;
        } catch { materialsNote = `$${(costCents / 100).toFixed(2)} — ledger write failed, log manually`; }
      } else if (costCents > 0 && paidBy === 'tech') {
        // Tech fronted it → a debt, not an expense. Accrues until payout.
        try {
          const { FieldValue } = await import('firebase-admin/firestore');
          await db.doc(`tenants/${tenantId}/maintenanceWorkers/${worker.id}`).set(
            { unpaidMaterialsCents: FieldValue.increment(costCents) }, { merge: true });
          materialsNote = `$${(costCents / 100).toFixed(2)} fronted by ${worker.name} — reimbursement owed, books at payout`;
        } catch { materialsNote = `$${(costCents / 100).toFixed(2)} fronted — could not accrue, note it manually`; }
      }

      await syncBoothFromTickets(db, tenantId, t.boothId);
      await notifyOwner(db, tenantId,
        `Maintenance: ${worker.name} ${status === 'resolved' ? 'RESOLVED' : status === 'in_progress' ? 'started' : dueDate && !status ? `moved the deadline on` : 'updated'} "${t.title}"${t.boothName ? ` (${t.boothName})` : ''}${materialsNote ? ` · materials: ${materialsNote}` : ''}${laborNote ? ` · labor: ${laborNote}` : ''}${mileageNote ? ` · mileage: ${mileageNote}` : ''}${overAgreement ? ` · OVER THE AGREED QUOTE ($${(((costCents + laborCents) - (t.quote.totalCents || 0)) / 100).toFixed(2)} above $${((t.quote.totalCents || 0) / 100).toFixed(2)})` : ''}${note ? ` — "${note.slice(0, 100)}"` : ''}${photoUrl ? ' · photo attached' : ''}`);
      // Keep the reporter in the loop automatically.
      if (t.reporter?.phone && smsConfigured() && status) {
        await sendTenantSms(db, tenantId, t.reporter.phone,
          `Update on your maintenance request "${t.title}": ${TICKET_STATUS_LABELS[status as keyof typeof TICKET_STATUS_LABELS]}${note ? ` — ${note.slice(0, 120)}` : ''}`);
      }
      await logAuditAdmin(db, tenantId, {
        action: 'maintenance.ticket_updated', targetType: 'ticket', targetId: ticketId,
        summary: `${worker.name} (tech) ${status ? `→ ${status}` : 'noted'} on "${t.title}"${costCents > 0 ? ` · $${(costCents / 100).toFixed(2)}` : ''}`,
        ...(costCents > 0 ? { amount: costCents / 100 } : {}),
        actor: { type: 'user', name: worker.name, role: 'tech', via: 'maintenance-portal' },
      });
      return NextResponse.json({ ok: true, photoUrl, photoError });
    }

    // ── Automation: text HELPERS their invite to the job ──────────────
    // Called after the owner adds a helper; texts every helper who hasn't
    // been notified yet (dedupe via helperNotifiedIds).
    if (action === 'notify-helper') {
      const { ticketId } = body;
      if (!ticketId) return NextResponse.json({ ok: false, error: 'Missing ticketId.' }, { status: 400 });
      const ref = db.doc(`tenants/${tenantId}/tickets/${ticketId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
      const t = snap.data() as any;
      const notified: string[] = Array.isArray(t.helperNotifiedIds) ? [...t.helperNotifiedIds] : [];
      let sent = 0;
      let base = '';
      try { base = String(((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.publicOrigin || '').replace(/\/+$/, ''); } catch { /* fall back */ }
      if (!base && process.env.VERCEL_PROJECT_PRODUCTION_URL) base = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
      if (!base) base = String(body.origin || '').replace(/\/+$/, '');
      for (const h of (t.helpers || [])) {
        if (notified.includes(h.id)) continue;
        try {
          const w = (await db.doc(`tenants/${tenantId}/maintenanceWorkers/${h.id}`).get()).data() as any;
          if (w?.phone && smsConfigured()) {
            const link = base ? ` Details: ${base}/maintain/${tenantId}?t=${w.token}` : '';
            const r = await sendTenantSms(db, tenantId, w.phone,
              `You've been added to help on "${t.title}"${t.boothName ? ` at ${t.boothName}` : ''}${t.assigneeName ? ` (lead: ${t.assigneeName})` : ''}. Log your own hours on the job.${link}`);
            if (r.ok) sent++;
          }
          notified.push(h.id);
        } catch { /* next helper */ }
      }
      await ref.set({ helperNotifiedIds: notified }, { merge: true });
      return NextResponse.json({ ok: true, sent });
    }

    // ── Automation: text the assigned tech their ticket ───────────────
    if (action === 'notify-assign') {
      const { ticketId } = body;
      if (!ticketId) return NextResponse.json({ ok: false, error: 'Missing ticketId.' }, { status: 400 });
      const ref = db.doc(`tenants/${tenantId}/tickets/${ticketId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
      const t = snap.data() as any;
      if (!t.assigneeId) return NextResponse.json({ ok: false, error: 'Ticket has no assignee.' }, { status: 400 });
      if (t.assignNotifiedFor === t.assigneeId) return NextResponse.json({ ok: true, already: true });
      const wSnap = await db.doc(`tenants/${tenantId}/maintenanceWorkers/${t.assigneeId}`).get();
      const w = wSnap.exists ? (wSnap.data() as any) : null;
      let sent = false;
      if (w?.phone && smsConfigured()) {
        // Permanent domain, automatically: manual override → Vercel's
        // production-domain env var → the caller's origin as last resort
        // (a preview URL that would die on the next deploy).
        let base = '';
        try { base = String(((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.publicOrigin || '').replace(/\/+$/, ''); } catch { /* fall back */ }
        if (!base && process.env.VERCEL_PROJECT_PRODUCTION_URL) base = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
        if (!base) base = String(body.origin || '').replace(/\/+$/, '');
        const link = base ? ` Details: ${base}/maintain/${tenantId}?t=${w.token}` : '';
        const r = await sendTenantSms(db, tenantId, w.phone,
          `New ${t.priority} ticket: "${t.title}"${t.boothName ? ` at ${t.boothName}` : ''}.${link}`);
        sent = r.ok;
      }
      await ref.set({ assignNotifiedFor: t.assigneeId }, { merge: true });
      return NextResponse.json({ ok: true, sent });
    }

    // ── Automation: tell the reporter where their ticket stands ───────
    if (action === 'notify-reporter') {
      const { ticketId } = body;
      if (!ticketId) return NextResponse.json({ ok: false, error: 'Missing ticketId.' }, { status: 400 });
      const ref = db.doc(`tenants/${tenantId}/tickets/${ticketId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
      const t = snap.data() as any;
      if (t.lastReporterNotifyStatus === t.status) return NextResponse.json({ ok: true, already: true });
      let sent = false;
      // Renters hear about their reported issues; techs hear about their
      // filed requests ("approved & bought" = resolved). Same loop-closer.
      if (t.reporter?.phone && ['renter', 'tech'].includes(t.reporter?.type) && smsConfigured()) {
        const r = await sendTenantSms(db, tenantId, t.reporter.phone,
          `Update on your ${t.category === 'request' ? 'request' : 'maintenance request'} "${t.title}": ${TICKET_STATUS_LABELS[t.status as keyof typeof TICKET_STATUS_LABELS] || t.status}.`);
        sent = r.ok;
      }
      await ref.set({ lastReporterNotifyStatus: t.status }, { merge: true });
      return NextResponse.json({ ok: true, sent });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[maintenance] POST failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — try again.' }, { status: 500 });
  }
}
