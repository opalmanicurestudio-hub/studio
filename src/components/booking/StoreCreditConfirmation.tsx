'use client';

/**
 * StoreCreditConfirmation
 *
 * Surface 4: Booking confirmation email / completion link
 *
 * This is the CLIENT-FACING message shown after studio-cancels and
 * issues store credit. Rendered in:
 *   - The cancellation confirmation email (as an HTML block)
 *   - The /complete/[tenantId]/[token] page after studio cancels
 *
 * Props:
 *   creditAmount   — dollars
 *   expiresAt      — ISO string or null
 *   studioName
 *   reason         — why studio cancelled (shown to client)
 */

import React from 'react';
import { Wallet, Clock, ArrowRight } from 'lucide-react';
import { formatCreditExpiry, isCreditExpiringSoon } from '@/hooks/useStoreCredit';
import { cn } from '@/lib/utils';

interface Props {
  creditAmount: number;
  expiresAt: string | null;
  studioName: string;
  reason?: string;
  bookingUrl?: string; // link back to booking page so client can rebook
}

export const StoreCreditConfirmation: React.FC<Props> = ({
  creditAmount,
  expiresAt,
  studioName,
  reason,
  bookingUrl,
}) => {
  const expiringSoon = isCreditExpiringSoon(expiresAt, 30);
  const expiryText   = formatCreditExpiry(expiresAt);

  return (
    <div className="rounded-[2rem] border-4 border-green-200 bg-gradient-to-br from-green-50 to-white overflow-hidden shadow-lg">

      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-green-100">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-2xl bg-green-500 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-green-600">
              {studioName}
            </p>
            <p className="text-lg font-black uppercase tracking-tight text-slate-900 leading-none">
              Store Credit Issued
            </p>
          </div>
        </div>
      </div>

      {/* Amount */}
      <div className="px-6 py-5 text-center border-b border-green-100">
        <p className="text-[9px] font-black uppercase tracking-widest text-green-600 mb-1">
          Your credit balance
        </p>
        <p className="text-5xl font-black font-mono text-green-700 tracking-tighter">
          ${creditAmount.toFixed(2)}
        </p>
        {expiresAt ? (
          <p className={cn(
            'text-[10px] font-bold uppercase tracking-widest mt-2 flex items-center justify-center gap-1',
            expiringSoon ? 'text-amber-600' : 'text-green-600 opacity-60',
          )}>
            <Clock className="w-3 h-3" />
            {expiryText}
          </p>
        ) : (
          <p className="text-[10px] font-bold uppercase tracking-widest mt-2 text-green-600 opacity-60">
            Never expires
          </p>
        )}
      </div>

      {/* Body */}
      <div className="px-6 py-5 space-y-3">
        {reason && (
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed">
            Your appointment was cancelled ({reason}). We've added ${creditAmount.toFixed(2)} to your
            account as a store credit — it will be applied automatically at your next checkout.
          </p>
        )}
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed">
          No action needed. When you book your next visit, your credit will appear at checkout and
          be deducted from your total.
        </p>
      </div>

      {/* Rebook CTA */}
      {bookingUrl && (
        <div className="px-6 pb-6">
          <a
            href={bookingUrl}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-black uppercase text-[10px] tracking-widest transition-colors shadow-lg shadow-green-500/20"
          >
            Book Your Next Visit <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      )}
    </div>
  );
};

// ── Email HTML version (for Resend / Nodemailer) ──────────────────────────────
// Call this server-side to generate the email body block.
export function storeCreditEmailBlock(opts: {
  creditAmount: number;
  expiresAt: string | null;
  studioName: string;
  reason?: string;
  bookingUrl?: string;
}): string {
  const { creditAmount, expiresAt, studioName, reason, bookingUrl } = opts;
  const expiryLine = expiresAt
    ? `<p style="font-size:11px;color:#16a34a;margin:4px 0 0;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;">Valid until ${new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>`
    : `<p style="font-size:11px;color:#16a34a;margin:4px 0 0;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;">Never expires</p>`;

  return `
    <div style="border:3px solid #bbf7d0;border-radius:20px;overflow:hidden;background:linear-gradient(135deg,#f0fdf4,#ffffff);margin:24px 0;">
      <div style="background:#16a34a;padding:20px 24px;">
        <p style="margin:0;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.2em;color:#dcfce7;">${studioName}</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:-0.05em;color:#ffffff;">Store Credit Issued</p>
      </div>
      <div style="padding:24px;text-align:center;border-bottom:1px solid #bbf7d0;">
        <p style="margin:0;font-size:48px;font-weight:900;color:#15803d;font-family:monospace;letter-spacing:-0.05em;">$${creditAmount.toFixed(2)}</p>
        ${expiryLine}
      </div>
      <div style="padding:20px 24px;">
        ${reason ? `<p style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;line-height:1.6;margin:0 0 12px;">Your appointment was cancelled (${reason}). We've added $${creditAmount.toFixed(2)} to your account.</p>` : ''}
        <p style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;line-height:1.6;margin:0;">No action needed. Your credit will be applied automatically at your next checkout.</p>
        ${bookingUrl ? `<a href="${bookingUrl}" style="display:block;margin-top:16px;padding:14px 24px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;text-align:center;">Book Your Next Visit →</a>` : ''}
      </div>
    </div>
  `;
}
