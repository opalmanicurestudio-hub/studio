'use client';

// src/components/shared/SmsConsent.tsx
//
// THE SMS OPT-IN BLOCK — drop this under any public phone field. It
// renders everything carriers require of a web-form opt-in, verbatim:
//   • consent checkbox, NEVER pre-selected
//   • clear description of message types
//   • message frequency line
//   • "message and data rates may apply"
//   • HELP / STOP instructions
//   • links to Terms and Privacy Policy
//   • "consent is not a condition of purchase"
// Booking still works with the box unchecked — consent is genuinely
// optional, which is exactly what the registration promises.

export function SmsConsent({
  checked, onChange, businessName = 'the studio',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  businessName?: string;
}) {
  return (
    <div className="rounded-xl border-2 bg-slate-50/60 px-3.5 py-3 space-y-1.5">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-2 accent-slate-900 shrink-0"
        />
        <span className="text-[11px] font-bold text-slate-700 leading-snug">
          Yes — text me booking confirmations, appointment reminders, and account
          updates from {businessName} at the number above.
        </span>
      </label>
      <p className="text-[10px] font-medium text-slate-400 leading-snug pl-6">
        Message frequency varies by account activity. Message &amp; data rates may
        apply. Reply HELP for help, STOP to cancel any time. Consent is not a
        condition of booking or purchase. See our{' '}
        <a href="/terms" target="_blank" rel="noreferrer" className="underline">SMS Terms</a>{' '}
        and{' '}
        <a href="/privacy" target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>.
      </p>
    </div>
  );
}

export default SmsConsent;
