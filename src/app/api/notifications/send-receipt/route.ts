import { NextRequest, NextResponse } from 'next/server';

import { staffOrServer } from '@/lib/route-guard';
import { brandedEmailHtml } from '@/lib/email-template';
import { isPlaceholderName } from '@/lib/visit-email';

// ─── /api/notifications/send-receipt/route.ts ─────────────────────────────────
// Sends a cash/card receipt by email (lib/notify) or text (lib/sms, the business's own texting).
// Falls back gracefully if neither is configured.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

type LineItem = { label: string; amount: number; staff?: string };

type ReceiptPayload = {
  clientName:    string;
  cashierName?:  string;
  studioName:    string;
  studioPhone:   string;
  lineItems:     LineItem[];
  subtotal:      number;
  tax:           number;
  tip:           number;
  discount:      number;
  recovery:      number;
  total:         number;
  tendered:      number;
  change:        number;
  paymentMethod: string;
  date:          string;
};

/* THE SAME EMAIL AS EVERY OTHER RECEIPT (api/receipts, board 15G): the shared shell, its rows, and the business's look,
 * which the sender puts on from its settings (lib/notify). */
function buildEmailHtml(r: ReceiptPayload, when: string): string {
  const $ = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
  const full = String(r.clientName || '').trim();
  const first = full && !isPlaceholderName(full) ? full.split(/\s+/)[0] : '';   // a walk-in's placeholder is no name
  const rows: { label: string; value: string; strong?: boolean; muted?: boolean }[] = [
    ...(r.lineItems || []).map((l) => ({ label: `${l.label}${l.staff ? ` (${l.staff})` : ''}`, value: $(l.amount) })),
    { label: 'Subtotal', value: $(r.subtotal), muted: true },
    ...(r.discount > 0 ? [{ label: 'Discount', value: `−${$(r.discount)}`, muted: true }] : []),
    ...(r.recovery > 0 ? [{ label: 'Service adjustment', value: `−${$(r.recovery)}`, muted: true }] : []),
    { label: 'Tax', value: $(r.tax), muted: true },
    ...(r.tip > 0 ? [{ label: 'Tip', value: $(r.tip), muted: true }] : []),
    { label: 'Total', value: $(r.total), strong: true },
    { label: r.paymentMethod ? `${r.paymentMethod} tendered` : 'Tendered', value: $(r.tendered), muted: true },
    ...(r.change > 0.005 ? [{ label: 'Change returned', value: $(r.change), muted: true }] : []),
  ];
  return brandedEmailHtml({ studioName: r.studioName || '', eyebrow: 'Receipt', title: first ? 'Thanks for coming in,' : 'Thanks for coming in', titleBold: first,
    preheader: `Your receipt for ${$(r.total)}, ${when}`,
    details: { big: when, lines: r.cashierName ? [`Served by ${r.cashierName}`] : [] },
    amounts: rows });
}

function buildSmsText(r: ReceiptPayload): string {
  const items = r.lineItems.map(l => `  ${l.label}: $${l.amount.toFixed(2)}`).join('\n');
  const lines = [
    // The business's name goes in front of every text it sends (lib/sms), so it isn't repeated here.
    `Your receipt, ${r.date}`,
    ``,
    items,
    ``,
    `Subtotal: $${r.subtotal.toFixed(2)}`,
    r.discount > 0   ? `Discount: -$${r.discount.toFixed(2)}`   : null,
    r.recovery > 0   ? `Adjustment: -$${r.recovery.toFixed(2)}` : null,
    `Tax: $${r.tax.toFixed(2)}`,
    r.tip > 0        ? `Tip: $${r.tip.toFixed(2)}`              : null,
    `Total: $${r.total.toFixed(2)}`,
    r.change > 0.005 ? `Change: $${r.change.toFixed(2)}`        : null,
    ``,
    (() => { const n = String(r.clientName || '').trim(); return n && !isPlaceholderName(n) ? `Thank you, ${n.split(/\s+/)[0]}!` : 'Thank you!'; })(),
    r.cashierName ? `Served by ${r.cashierName}` : null,
    r.studioPhone ? r.studioPhone : null,
  ].filter(Boolean).join('\n');
  return lines;
}

export async function POST(req: NextRequest) {
  try {
    const { contact, type, receipt, tenantId } = await req.json() as {
      contact: string;
      type:    'email' | 'sms';
      receipt: ReceiptPayload;
      tenantId?: string;
    };
    if (!(await staffOrServer(req, String(tenantId || '')))) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });   // staff, or our own server — never the public

    if (!contact || !receipt) {
      return NextResponse.json({ error: 'Missing contact or receipt data' }, { status: 400 });
    }

    if (type === 'email') {
      // Policy gate — an owner who switched receipts off in Messages does
      // not get them sent anyway from a route that predates the setting.
      try {
        const { gateMessage } = await import('@/lib/message-policy');
        const gate = await gateMessage(getAdminDb(), String(tenantId || ''), 'receipt');
        if (!gate.send) return NextResponse.json({ ok: false, reason: gate.reason });
      } catch { /* fail open — never lose a receipt over a settings lookup */ }
      // Through the mailroom. This used to POST to Resend from a hardcoded
      // receipts@<domain> address with its own env name (RESEND_FROM_DOMAIN,
      // the FOURTH name for the same setting in this codebase) — and never
      // reached the delivery log, so a customer asking "where's my receipt?"
      // had no answer. The policy gate above is kept; the log now records the
      // send itself.
      if (!tenantId) {
        return NextResponse.json({ ok: false, reason: 'Missing tenant' }, { status: 400 });
      }
      const { sendNotification } = await import('@/lib/notify');
      const sent = await sendNotification(getAdminDb(), {
        tenantId: String(tenantId), channel: 'email', to: contact,
        subject: String(receipt.studioName || '').trim() ? `Your receipt from ${String(receipt.studioName).trim()}` : 'Your receipt',
        // The time of the sale in the business's own time zone (the screen's date string can be in any format).
        html: buildEmailHtml(receipt, await (async () => { try {
          const { tenantTimeZone, formatShortDay, formatTime } = await import('@/lib/tenant-time');
          const z = tenantTimeZone(((await getAdminDb().doc(`tenants/${tenantId}`).get()).data() as any) || {}); const now = new Date();
          return `${formatShortDay(now, z)} · ${formatTime(now, z)}`; } catch { return 'Today'; } })()),
        kind: 'receipt',
        recipientType: 'client',
        recipientName: receipt.clientName || null,
      });
      if (!sent.ok) {
        console.error('[send-receipt] not sent:', sent.status, sent.error);
        return NextResponse.json({ ok: false, reason: sent.error || sent.status });
      }
      return NextResponse.json({ ok: true, emailSent: true });
    }

    if (type === 'sms') {
      // The business's own texting, like every other text it sends (lib/sms sendTenantSms): its number, a client who
      // replied STOP never gets one, it's in the message log, and it counts toward its texting. This used to call the
      // texting provider straight from the platform's settings, so none of that applied. Receipts switched off in
      // Messages stay off.
      if (!tenantId) return NextResponse.json({ ok: false, reason: 'Missing tenant' }, { status: 400 });
      try {
        const { gateMessage } = await import('@/lib/message-policy');
        const gate = await gateMessage(getAdminDb(), String(tenantId), 'receipt');
        if (!gate.send) return NextResponse.json({ ok: false, reason: gate.reason });
      } catch { /* fail open — never lose a receipt over a settings lookup */ }
      const { sendTenantSms } = await import('@/lib/sms');
      const sent = await sendTenantSms(getAdminDb(), String(tenantId), contact, buildSmsText(receipt), undefined,
        { kind: 'receipt', recipientType: 'client', recipientName: receipt.clientName || null });
      if (!sent.ok) {
        console.error('[send-receipt] text not sent:', sent.error);
        return NextResponse.json({ ok: false, reason: sent.error || 'The text didn’t go out.' });
      }
      return NextResponse.json({ ok: true, smsSent: true });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });

  } catch (err: any) {
    console.error('[send-receipt]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
