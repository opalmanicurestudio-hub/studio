// src/app/terms/page.tsx
//
// TERMS & SMS PROGRAM TERMS — public page required by A2P 10DLC campaign
// review. Contains the specific SMS program disclosures carriers check:
// program description, frequency, rates, STOP/HELP, carrier liability,
// and a link to the privacy policy. Edit BUSINESS_NAME / CONTACT_EMAIL.

const BUSINESS_NAME = 'Opal Manicure Studio';
const CONTACT_EMAIL = 'opalmanicurestudio@gmail.com';

export const metadata = { title: `Terms & SMS Program — ${BUSINESS_NAME}` };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-50 px-5 py-10">
      <div className="max-w-2xl mx-auto space-y-6 text-slate-800">
        <header>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{BUSINESS_NAME}</p>
          <h1 className="text-3xl font-black tracking-tight mt-1">Terms of Service</h1>
          <p className="text-xs font-bold text-slate-400 mt-1">Effective date: July 26, 2026</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Services</h2>
          <p className="text-sm leading-relaxed">
            {BUSINESS_NAME} provides salon services, appointment booking, and booth/station rentals. Bookings,
            rentals, and payments are governed by the terms presented at the time of booking or in your rental
            agreement. By using our booking site, portals, or services you agree to these terms.
          </p>
        </section>

        <section className="space-y-3 rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h2 className="text-sm font-black uppercase tracking-widest">SMS program terms</h2>
          <p className="text-sm leading-relaxed">
            When you provide your mobile number and opt in — while booking online or in person, signing a rental
            agreement, or being onboarded as staff or a maintenance worker — you consent to receive service text
            messages from {BUSINESS_NAME}. The program sends account and service notifications, including:
            appointment reminders and booking confirmations, maintenance and work order status updates,
            one-time sign-in codes, rent and payment notices, and secure account links.
          </p>
          <p className="text-sm leading-relaxed">
            <strong>Message frequency varies</strong> based on your account activity.{' '}
            <strong>Message and data rates may apply</strong> depending on your mobile plan.
          </p>
          <p className="text-sm leading-relaxed">
            <strong>Opt out:</strong> reply <strong>STOP</strong> to any message to cancel. You may receive one
            final message confirming your opt-out. <strong>Help:</strong> reply <strong>HELP</strong> to any
            message, or contact us at {CONTACT_EMAIL}.
          </p>
          <p className="text-sm leading-relaxed">
            Consent to receive text messages is not a condition of purchasing any goods or services. Carriers
            (e.g., AT&amp;T, T-Mobile, Verizon) are not liable for delayed or undelivered messages. Your mobile
            information is handled as described in our{' '}
            <a className="underline font-bold" href="/privacy">Privacy Policy</a> and is never shared with third
            parties for marketing purposes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Payments, cancellations &amp; no-shows</h2>
          <p className="text-sm leading-relaxed">
            Payment, cancellation, refund, and no-show policies are shown at the time of booking and in rental
            agreements, and may include fees where disclosed. Booth rental terms, including rent schedules and
            house rules, are set out in each renter's signed agreement.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Acceptable use</h2>
          <p className="text-sm leading-relaxed">
            Portals and access links are personal to you — don't share sign-in links or codes. We may suspend
            access that is misused. Content you submit (like maintenance photos) must be yours to share and
            related to the services.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Changes &amp; contact</h2>
          <p className="text-sm leading-relaxed">
            We may update these terms; the current version always lives at this page. Questions:{' '}
            <a className="underline font-bold" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <footer className="pt-4 border-t text-[11px] font-bold text-slate-400">
          {BUSINESS_NAME} · <a className="underline" href="/privacy">Privacy Policy</a>
        </footer>
      </div>
    </div>
  );
}
