import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Types (mirrors src/lib/data.ts) ──────────────────────────────────────────
type AutomationSeverity = 'warn' | 'require' | 'auto_cancel';

type AutomationTrigger = {
  enabled: boolean;
  severity: AutomationSeverity;
  firstWindowHours: number;
  secondWindowHours?: number;
  canDisable: boolean;
};

type AppointmentAutomations = {
  depositNotPaid: AutomationTrigger;
  consentFormUnsigned: AutomationTrigger;
  noCardOnFile: AutomationTrigger;
  referencePhotosMissing: AutomationTrigger;
  healthFormMissing: AutomationTrigger;
  outstandingBalance: AutomationTrigger;
};

// ─── Firebase Admin init ───────────────────────────────────────────────────
function getAdminApp(): App {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toDate(val: any): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') return new Date(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
}

function hoursUntil(startTime: any, now: Date): number {
  return (toDate(startTime).getTime() - now.getTime()) / (1000 * 60 * 60);
}

type WindowResult = {
  updates: Record<string, any>;
  shouldSendReminder: boolean;
  shouldCancel: boolean;
  shouldActivateGate: boolean;
};

function evaluateWindow(
  trigger: AutomationTrigger | undefined,
  missing: boolean,
  hrsUntil: number,
  automationState: Record<string, any>,
  reminderField: string,
  escalationField?: string,
  reminderCountField?: string,
): WindowResult {
  const result: WindowResult = { updates: {}, shouldSendReminder: false, shouldCancel: false, shouldActivateGate: false };
  if (!trigger?.enabled || !missing) return result;

  const nowIso = new Date().toISOString();

  if (hrsUntil <= trigger.firstWindowHours && !automationState[reminderField]) {
    result.updates[`automationState.${reminderField}`] = nowIso;
    if (reminderCountField) {
      result.updates[`automationState.${reminderCountField}`] = (automationState[reminderCountField] || 0) + 1;
    }
    result.shouldSendReminder = true;
  }

  if (
    escalationField &&
    trigger.secondWindowHours !== undefined &&
    hrsUntil <= trigger.secondWindowHours &&
    !automationState[escalationField]
  ) {
    result.updates[`automationState.${escalationField}`] = nowIso;
    if (trigger.severity === 'auto_cancel') result.shouldCancel = true;
    else if (trigger.severity === 'require') result.shouldActivateGate = true;
  }

  return result;
}

async function notifyOwner(db: FirebaseFirestore.Firestore, tenantId: string, ownerUserId: string | undefined, title: string, message: string) {
  if (!ownerUserId) return;
  const id = nanoid();
  await db.collection('tenants').doc(tenantId).collection('notifications').doc(id).set({
    id,
    userId: ownerUserId,
    type: 'automation',
    message: `${title} — ${message}`,
    link: '/planner',
    createdAt: new Date().toISOString(),
    read: false,
  });
}

// ─── Main handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirestore(getAdminApp());
  const now = new Date();
  const summary: any[] = [];
  const errors: any[] = [];

  const tenantsSnap = await db.collection('tenants').get();

  for (const tenantDoc of tenantsSnap.docs) {
    const tenant = tenantDoc.data() as any;
    const automations: AppointmentAutomations | undefined = tenant.appointmentAutomations;
    if (!automations) continue; // tenant has never configured automations — skip entirely

    const tenantId = tenantDoc.id;

    let aptsSnap;
    try {
      aptsSnap = await db
        .collection('tenants').doc(tenantId).collection('appointments')
        .where('status', 'in', ['confirmed', 'deposit_pending'])
        .get();
    } catch (e: any) {
      errors.push({ tenantId, stage: 'fetch_appointments', error: e.message });
      continue;
    }

    for (const aptDoc of aptsSnap.docs) {
      try {
        const apt = aptDoc.data() as any;
        const hrsUntil = hoursUntil(apt.startTime, now);
        if (hrsUntil < 0) continue; // appointment already started/passed

        const [serviceSnap, clientSnap] = await Promise.all([
          apt.serviceId
            ? db.collection('tenants').doc(tenantId).collection('services').doc(apt.serviceId).get()
            : Promise.resolve(null),
          apt.clientId
            ? db.collection('tenants').doc(tenantId).collection('clients').doc(apt.clientId).get()
            : Promise.resolve(null),
        ]);
        const service = serviceSnap?.exists ? (serviceSnap.data() as any) : null;
        const client = clientSnap?.exists ? (clientSnap.data() as any) : null;

        const automationState = apt.automationState || {};
        const readinessFlags = { ...(apt.readinessFlags || {}) };
        const updates: Record<string, any> = {};
        const cancelReasons: string[] = [];
        const notifications: { title: string; message: string }[] = [];

        // ── depositNotPaid ──────────────────────────────────────────────
        {
          const missing = (apt.depositAmountCents || 0) > 0 && apt.depositStatus !== 'paid';
          readinessFlags.depositRequired = missing;
          const r = evaluateWindow(automations.depositNotPaid, missing, hrsUntil, automationState, 'depositReminderSentAt', 'depositAutoCancelledAt', 'depositReminderCount');
          Object.assign(updates, r.updates);
          if (r.shouldSendReminder) notifications.push({ title: 'Deposit reminder', message: `${apt.clientName || 'A client'}'s deposit is still unpaid ahead of their appointment.` });
          if (r.shouldCancel) cancelReasons.push('unpaid deposit');
        }

        // ── consentFormUnsigned ──────────────────────────────────────────
        if (service?.requiredFormIds?.length) {
          const signedIds = new Set((apt.signedForms || []).map((f: any) => f.formId));
          const missing = service.requiredFormIds.some((id: string) => !signedIds.has(id));
          readinessFlags.formGateActive = missing;
          const r = evaluateWindow(automations.consentFormUnsigned, missing, hrsUntil, automationState, 'formReminderSentAt', 'formGateActiveAt', 'formReminderCount');
          Object.assign(updates, r.updates);
          if (r.shouldSendReminder) notifications.push({ title: 'Consent form reminder', message: `${apt.clientName || 'A client'} still has an unsigned consent form.` });
          if (r.shouldCancel) cancelReasons.push('unsigned consent form');
          if (r.shouldActivateGate) notifications.push({ title: 'Check-in will be blocked', message: `${apt.clientName || 'A client'}'s consent form must be signed before service can start.` });
        }

        // ── noCardOnFile ─────────────────────────────────────────────────
        {
          const missing = !client?.cardOnFile;
          readinessFlags.cardRequired = missing;
          const r = evaluateWindow(automations.noCardOnFile, missing, hrsUntil, automationState, 'cardReminderSentAt', 'cardRequiredAt');
          Object.assign(updates, r.updates);
          if (r.shouldSendReminder) notifications.push({ title: 'No card on file', message: `${apt.clientName || 'A client'} hasn't saved a card ahead of their appointment.` });
          if (r.shouldCancel) cancelReasons.push('no card on file');
          if (r.shouldActivateGate) notifications.push({ title: 'Check-in will be blocked', message: `${apt.clientName || 'A client'} needs a card on file before service can start.` });
        }

        // ── referencePhotosMissing (reminder only — no escalation window in this trigger) ──
        {
          const photoReq = (apt.requirementFiles || []).find((f: any) => f.requirementId === 'inspo');
          const missing = !!photoReq && (!photoReq.files || photoReq.files.length === 0);
          const r = evaluateWindow(automations.referencePhotosMissing, missing, hrsUntil, automationState, 'photoReminderSentAt');
          Object.assign(updates, r.updates);
          if (r.shouldSendReminder) notifications.push({ title: 'Reference photos missing', message: `${apt.clientName || 'A client'} hasn't uploaded the reference photos you requested.` });
        }

        // ── healthFormMissing (single-stage — only one field exists for this trigger) ──
        {
          const missing = !apt.healthDisclosedAt;
          readinessFlags.healthGateActive = missing;
          const t = automations.healthFormMissing;
          if (t?.enabled && missing && hrsUntil <= t.firstWindowHours && !automationState.healthGateActiveAt) {
            updates['automationState.healthGateActiveAt'] = now.toISOString();
            notifications.push({ title: 'Health disclosure missing', message: `${apt.clientName || 'A client'} hasn't completed their health/allergy disclosure.` });
          }
        }

        // ── outstandingBalance (notify only — doesn't gate this appointment, see note above) ──
        {
          const missing = (client?.outstandingBalance || 0) > 0;
          readinessFlags.balanceRequired = missing;
          const t = automations.outstandingBalance;
          if (t?.enabled && missing && !automationState.balanceNotifiedAt) {
            updates['automationState.balanceNotifiedAt'] = now.toISOString();
            notifications.push({ title: 'Outstanding balance', message: `${apt.clientName || 'A client'} has an outstanding balance of $${(client?.outstandingBalance || 0).toFixed(2)}.` });
          }
        }

        if (Object.keys(updates).length === 0) continue;

        updates['automationState.lastCheckedAt'] = now.toISOString();
        updates['readinessFlags'] = readinessFlags;

        if (cancelReasons.length > 0) {
          updates['status'] = 'cancelled';
          updates['checkInStatus'] = 'auto_cancelled';
          updates['cancellationReason'] = 'automation';
          notifications.push({ title: 'Appointment auto-cancelled', message: `${apt.clientName || 'A client'}'s appointment was cancelled automatically due to ${cancelReasons.join(' and ')}.` });
        }

        await db.collection('tenants').doc(tenantId).collection('appointments').doc(aptDoc.id).update(updates);

        for (const n of notifications) {
          await notifyOwner(db, tenantId, tenant.userId, n.title, n.message);
        }

        summary.push({ tenantId, appointmentId: aptDoc.id, fieldsUpdated: Object.keys(updates), cancelled: cancelReasons.length > 0 });
      } catch (e: any) {
        errors.push({ tenantId, appointmentId: aptDoc.id, error: e.message });
      }
    }
  }

  return NextResponse.json({ checkedAt: now.toISOString(), appointmentsUpdated: summary.length, summary, errors });
}
