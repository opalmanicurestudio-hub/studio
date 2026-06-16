import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// ─── functions/src/appointmentReadinessCheck.ts ───────────────────────────────
// Runs every hour. Checks all upcoming appointments across all tenants.
// For each appointment, checks which requirements are missing and fires
// configured automations (warn, block, auto-cancel).
//
// Cost profile:
//   Reads:  1 tenants query + N appointments per tenant (targeted, indexed)
//   Writes: Only when state changes — idempotent via automationState field
//   Free tier safe up to ~500 tenants

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

// ─── Types ────────────────────────────────────────────────────────────────────
type Severity = 'warn' | 'require' | 'auto_cancel';

type AutomationTrigger = {
  enabled:           boolean;
  severity:          Severity;
  firstWindowHours:  number;
  secondWindowHours?: number;
  canDisable:        boolean;
};

type AppointmentAutomations = {
  depositNotPaid:         AutomationTrigger;
  consentFormUnsigned:    AutomationTrigger;
  noCardOnFile:           AutomationTrigger;
  referencePhotosMissing: AutomationTrigger;
  healthFormMissing:      AutomationTrigger;
  outstandingBalance:     AutomationTrigger;
};

type AutomationState = {
  depositReminderSentAt?:      string | null;
  depositReminderCount?:       number;
  depositAutoCancelledAt?:     string | null;
  formReminderSentAt?:         string | null;
  formReminderCount?:          number;
  formGateActiveAt?:           string | null;
  cardReminderSentAt?:         string | null;
  cardRequiredAt?:             string | null;
  photoReminderSentAt?:        string | null;
  healthGateActiveAt?:         string | null;
  balanceNotifiedAt?:          string | null;
  lastCheckedAt?:              string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000);
const hoursAgo     = (iso: string)   => (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);

async function sendNotification(opts: {
  tenantId:    string;
  clientId?:   string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  appointmentId: string;
  type:        string;
  message:     string;
  link?:       string;
  action?:     string;
}) {
  // Write to notifications collection (owner sees in dashboard)
  const notifRef = db.collection(`tenants/${opts.tenantId}/notifications`).doc();
  await notifRef.set({
    id:            notifRef.id,
    type:          opts.type,
    message:       opts.message,
    link:          opts.link || `/planner`,
    appointmentId: opts.appointmentId,
    clientId:      opts.clientId || null,
    clientName:    opts.clientName || null,
    action:        opts.action || null,
    createdAt:     new Date().toISOString(),
    read:          false,
  });

  // Send SMS/email via existing notification API if client contact exists
  if (opts.clientEmail || opts.clientPhone) {
    try {
      await fetch(`${process.env.APP_URL}/api/notifications/appointment-automation`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.MIDDLEWARE_SECRET || '' },
        body:    JSON.stringify(opts),
      });
    } catch (err) {
      console.warn('[automation] Notification send failed:', err);
    }
  }
}

async function autoCancelAppointment(opts: {
  tenantId:      string;
  tenantName:    string;
  appointmentId: string;
  clientId?:     string;
  clientName?:   string;
  reason:        string;
  applyFee:      boolean;
  feeAmount?:    number;
}) {
  const batch = db.batch();
  const aptRef = db.collection(`tenants/${opts.tenantId}/appointments`).doc(opts.appointmentId);
  const now    = new Date().toISOString();

  batch.update(aptRef, {
    status:               'cancelled',
    cancellationReason:   'automation',
    cancellationNote:     opts.reason,
    cancelledAt:          now,
    cancelledBy:          'system',
    'automationState.depositAutoCancelledAt': now,
  });

  // Write cancellation fee to client if configured
  if (opts.applyFee && opts.feeAmount && opts.clientId) {
    const clientRef = db.collection(`tenants/${opts.tenantId}/clients`).doc(opts.clientId);
    batch.update(clientRef, {
      outstandingBalance: admin.firestore.FieldValue.increment(opts.feeAmount),
      unpaidFees: admin.firestore.FieldValue.arrayUnion({
        feeId:           `auto-cancel-${opts.appointmentId}`,
        appointmentId:   opts.appointmentId,
        appointmentDate: now,
        feeAmount:       opts.feeAmount,
        reason:          `Auto-cancellation: ${opts.reason}`,
      }),
    });
  }

  await batch.commit();

  // Notify owner
  await sendNotification({
    tenantId:      opts.tenantId,
    clientId:      opts.clientId,
    clientName:    opts.clientName,
    appointmentId: opts.appointmentId,
    type:          'auto_cancel',
    message:       `Auto-cancelled: ${opts.clientName || 'Client'} — ${opts.reason}${opts.feeAmount ? ` · $${opts.feeAmount.toFixed(2)} fee applied` : ''}`,
    action:        'view_appointment',
  });
}

// ─── Check a single appointment ───────────────────────────────────────────────
async function checkAppointment(
  tenantId:    string,
  tenant:      any,
  appointment: any,
  automations: AppointmentAutomations,
) {
  const now          = new Date();
  const aptStart     = new Date(appointment.startTime);
  const hoursUntil   = (aptStart.getTime() - now.getTime()) / (1000 * 60 * 60);
  const state: AutomationState = appointment.automationState || {};
  const stateUpdates: Record<string, any> = {};
  const clientId     = appointment.clientId;
  const aptId        = appointment.id;

  // Skip if appointment is in the past or already cancelled/completed
  if (hoursUntil < 0 || ['cancelled','completed'].includes(appointment.status)) return;

  // Skip if checked very recently (within 50 minutes) and no urgent deadline
  if (state.lastCheckedAt && hoursAgo(state.lastCheckedAt) < 0.83 && hoursUntil > 2) return;

  // Fetch client for contact info and balance
  let client: any = null;
  if (clientId) {
    const clientSnap = await db.collection(`tenants/${tenantId}/clients`).doc(clientId).get();
    client = clientSnap.exists ? clientSnap.data() : null;
  }

  // ── 1. Deposit not paid ────────────────────────────────────────────────────
  const auto = automations;
  if (auto.depositNotPaid.enabled && appointment.depositAmountCents > 0 && appointment.depositStatus !== 'paid') {
    const cfg = auto.depositNotPaid;

    // First reminder window reached
    if (hoursUntil <= cfg.firstWindowHours && !state.depositReminderSentAt) {
      await sendNotification({
        tenantId, clientId, clientName: client?.name,
        clientEmail: client?.email, clientPhone: client?.phone,
        appointmentId: aptId, type: 'deposit_reminder',
        message: `Deposit reminder sent to ${client?.name || 'client'} — $${(appointment.depositAmountCents / 100).toFixed(2)} due`,
        action: 'resend_completion_link',
      });
      stateUpdates['automationState.depositReminderSentAt'] = now.toISOString();
      stateUpdates['automationState.depositReminderCount']  = (state.depositReminderCount || 0) + 1;
    }

    // Second window — escalate or auto-cancel
    if (cfg.secondWindowHours !== undefined && hoursUntil <= cfg.secondWindowHours && !state.depositAutoCancelledAt) {
      if (cfg.severity === 'auto_cancel') {
        await autoCancelAppointment({
          tenantId, tenantName: tenant.name, appointmentId: aptId,
          clientId, clientName: client?.name,
          reason:    'Deposit not received',
          applyFee:  !!tenant.cancellationFee,
          feeAmount: tenant.cancellationFee || 0,
        });
        return; // stop checking this appointment
      } else if (cfg.severity === 'require') {
        stateUpdates['readinessFlags.depositRequired'] = true;
      }
    }
  }

  // ── 2. Consent form unsigned ───────────────────────────────────────────────
  if (auto.consentFormUnsigned.enabled) {
    const requiredFormIds: string[] = appointment.requiredFormIds || [];
    const signedFormIds: string[]   = (appointment.signedForms || []).map((f: any) => f.formId);
    const unsignedCount = requiredFormIds.filter(id => !signedFormIds.includes(id)).length;

    if (unsignedCount > 0) {
      const cfg = auto.consentFormUnsigned;

      if (hoursUntil <= cfg.firstWindowHours && !state.formReminderSentAt) {
        await sendNotification({
          tenantId, clientId, clientName: client?.name,
          clientEmail: client?.email, clientPhone: client?.phone,
          appointmentId: aptId, type: 'form_reminder',
          message: `Form reminder: ${client?.name || 'Client'} has ${unsignedCount} unsigned form${unsignedCount > 1 ? 's' : ''}`,
          action: 'resend_completion_link',
        });
        stateUpdates['automationState.formReminderSentAt'] = now.toISOString();
        stateUpdates['automationState.formReminderCount']  = (state.formReminderCount || 0) + 1;
      }

      // Second window — gate at check-in or auto-cancel
      if (cfg.secondWindowHours !== undefined && hoursUntil <= cfg.secondWindowHours) {
        if (cfg.severity === 'auto_cancel' && !state.depositAutoCancelledAt) {
          await autoCancelAppointment({
            tenantId, tenantName: tenant.name, appointmentId: aptId,
            clientId, clientName: client?.name,
            reason: `Required consent form not signed`,
            applyFee: false, feeAmount: 0,
          });
          return;
        } else {
          // Set gate flag — appointment details sheet will block service start
          stateUpdates['readinessFlags.formGateActive']  = true;
          stateUpdates['automationState.formGateActiveAt'] = now.toISOString();
        }
      }
    }
  }

  // ── 3. No card on file ─────────────────────────────────────────────────────
  if (auto.noCardOnFile.enabled) {
    const hasCard = !!(client?.cardOnFile?.paymentMethodId || client?.cardOnFile?.token);
    if (!hasCard) {
      const cfg = auto.noCardOnFile;

      if (hoursUntil <= cfg.firstWindowHours && !state.cardReminderSentAt) {
        await sendNotification({
          tenantId, clientId, clientName: client?.name,
          clientEmail: client?.email, clientPhone: client?.phone,
          appointmentId: aptId, type: 'card_reminder',
          message: `No card on file: ${client?.name || 'Client'} — sending secure link`,
          action: 'resend_completion_link',
        });
        stateUpdates['automationState.cardReminderSentAt'] = now.toISOString();
      }

      if (cfg.secondWindowHours !== undefined && hoursUntil <= cfg.secondWindowHours && cfg.severity === 'require') {
        stateUpdates['readinessFlags.cardRequired'] = true;
        stateUpdates['automationState.cardRequiredAt'] = now.toISOString();
      }
    }
  }

  // ── 4. Reference photos missing ────────────────────────────────────────────
  if (auto.referencePhotosMissing.enabled) {
    const photosRequested = appointment.completionStatus === 'pending' ||
      (appointment.fileRequirements || []).length > 0;
    const photosReceived  = (appointment.requirementFiles || []).some(
      (rf: any) => (rf.files || []).length > 0
    );

    if (photosRequested && !photosReceived) {
      const cfg = auto.referencePhotosMissing;

      if (hoursUntil <= cfg.firstWindowHours && !state.photoReminderSentAt) {
        await sendNotification({
          tenantId, clientId, clientName: client?.name,
          clientEmail: client?.email, clientPhone: client?.phone,
          appointmentId: aptId, type: 'photo_reminder',
          message: `Inspiration photos missing: ${client?.name || 'Client'} — resending request`,
          action: 'resend_completion_link',
        });
        stateUpdates['automationState.photoReminderSentAt'] = now.toISOString();
        // Flag for extended consultation buffer on schedule
        stateUpdates['readinessFlags.needsConsultationBuffer'] = true;
      }
    }
  }

  // ── 5. Health / allergy disclosure missing (always enforced) ───────────────
  // This is a hard gate regardless of the enabled flag — health is non-negotiable
  const healthDisclosed = !!(client?.allergyNotes || client?.medicalNotes ||
    appointment.healthDisclosedAt || appointment.signedForms?.some(
      (f: any) => f.formTitle?.toLowerCase().includes('health') ||
                  f.formTitle?.toLowerCase().includes('intake') ||
                  f.formTitle?.toLowerCase().includes('allergy')
    ));

  if (!healthDisclosed && auto.healthFormMissing.enabled) {
    const cfg = auto.healthFormMissing;

    if (hoursUntil <= cfg.firstWindowHours && !state.healthGateActiveAt) {
      await sendNotification({
        tenantId, clientId, clientName: client?.name,
        appointmentId: aptId, type: 'health_gate',
        message: `Health disclosure missing for ${client?.name || 'Client'} — service blocked until collected`,
        action: 'view_appointment',
      });
      stateUpdates['readinessFlags.healthGateActive']      = true;
      stateUpdates['automationState.healthGateActiveAt']   = now.toISOString();
    }
  }

  // ── 6. Outstanding balance ─────────────────────────────────────────────────
  if (auto.outstandingBalance.enabled && (client?.outstandingBalance || 0) > 0) {
    const cfg = auto.outstandingBalance;

    if (!state.balanceNotifiedAt) {
      await sendNotification({
        tenantId, clientId, clientName: client?.name,
        appointmentId: aptId, type: 'outstanding_balance',
        message: `Outstanding balance: ${client?.name || 'Client'} owes $${Number(client.outstandingBalance).toFixed(2)}`,
        action: 'view_client',
      });
      stateUpdates['automationState.balanceNotifiedAt'] = now.toISOString();

      if (cfg.severity === 'require') {
        stateUpdates['readinessFlags.balanceRequired'] = true;
      }
    }
  }

  // ── Write state updates if anything changed ────────────────────────────────
  stateUpdates['automationState.lastCheckedAt'] = now.toISOString();

  if (Object.keys(stateUpdates).length > 1) { // more than just lastCheckedAt
    await db.collection(`tenants/${tenantId}/appointments`).doc(aptId).update(stateUpdates);
  } else {
    // Just update lastCheckedAt with a lightweight write
    await db.collection(`tenants/${tenantId}/appointments`).doc(aptId).update({
      'automationState.lastCheckedAt': now.toISOString(),
    });
  }
}

// ─── Main exported function ───────────────────────────────────────────────────
export const appointmentReadinessCheck = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub
  .schedule('every 60 minutes')
  .timeZone('America/New_York')
  .onRun(async () => {
    const now       = new Date();
    const in72Hours = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    console.log('[readiness-check] Starting run at', now.toISOString());

    // Fetch all tenants that have automations configured
    const tenantsSnap = await db.collection('tenants').get();
    let totalChecked  = 0;
    let totalActioned = 0;

    for (const tenantDoc of tenantsSnap.docs) {
      const tenant      = tenantDoc.data();
      const tenantId    = tenantDoc.id;
      const automations: AppointmentAutomations = {
        ...defaultAutomations(),
        ...(tenant.appointmentAutomations || {}),
      };

      try {
        // Targeted query — only upcoming, only relevant statuses
        // This is the cost-efficient path: max ~10 reads per tenant
        const aptsSnap = await db.collection(`tenants/${tenantId}/appointments`)
          .where('startTime', '>=', now.toISOString())
          .where('startTime', '<=', in72Hours.toISOString())
          .where('status', 'in', ['confirmed', 'deposit_pending'])
          .get();

        for (const aptDoc of aptsSnap.docs) {
          const apt = { id: aptDoc.id, ...aptDoc.data() };
          try {
            await checkAppointment(tenantId, tenant, apt, automations);
            totalChecked++;
          } catch (err) {
            console.error(`[readiness-check] Error on apt ${aptDoc.id}:`, err);
          }
        }
      } catch (err) {
        console.error(`[readiness-check] Error on tenant ${tenantId}:`, err);
      }
    }

    console.log(`[readiness-check] Complete — checked ${totalChecked} appointments`);
    return null;
  });

// Default automations (mirrors the UI defaults)
function defaultAutomations(): AppointmentAutomations {
  return {
    depositNotPaid:         { enabled: true,  severity: 'auto_cancel', firstWindowHours: 24, secondWindowHours: 48, canDisable: true },
    consentFormUnsigned:    { enabled: true,  severity: 'require',     firstWindowHours: 48, secondWindowHours: 2,  canDisable: true },
    noCardOnFile:           { enabled: true,  severity: 'warn',        firstWindowHours: 72, secondWindowHours: 24, canDisable: true },
    referencePhotosMissing: { enabled: true,  severity: 'warn',        firstWindowHours: 48, canDisable: true },
    healthFormMissing:      { enabled: true,  severity: 'require',     firstWindowHours: 48, canDisable: false },
    outstandingBalance:     { enabled: true,  severity: 'require',     firstWindowHours: 0,  canDisable: true },
  };
}
