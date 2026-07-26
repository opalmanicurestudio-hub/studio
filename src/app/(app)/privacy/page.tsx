// src/app/privacy/page.tsx
//
// PRIVACY POLICY — public page required by A2P 10DLC campaign review.
// Carriers specifically look for the clause stating that mobile numbers
// and SMS consent are never shared with third parties for marketing.
// Edit BUSINESS_NAME (and CONTACT_EMAIL) to your business identity.

const BUSINESS_NAME = 'Opal Manicure Studio';
const CONTACT_EMAIL = 'opalmanicurestudio@gmail.com';

export const metadata = { title: `Privacy Policy — ${BUSINESS_NAME}` };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 px-5 py-10">
      <div className="max-w-2xl mx-auto space-y-6 text-slate-800">
        <header>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{BUSINESS_NAME}</p>
          <h1 className="text-3xl font-black tracking-tight mt-1">Privacy Policy</h1>
          <p className="text-xs font-bold text-slate-400 mt-1">Effective date: July 26, 2026</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Information we collect</h2>
          <p className="text-sm leading-relaxed">
            When you book an appointment or rental, rent a booth, join our team, or contact us, we collect the
            information you provide: your name, phone number, email address, appointment and booking details,
            payment records, and messages you send us. Payment card processing is handled by our payment
            processor (Stripe); we do not store full card numbers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">How we use it</h2>
          <p className="text-sm leading-relaxed">
            We use your information to run the business you're interacting with: confirming and reminding you of
            appointments and bookings, managing booth rentals and rent payments, coordinating maintenance and
            repairs, providing secure access links to your account, and responding when you contact us.
          </p>
        </section>

        <section className="space-y-2 rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h2 className="text-sm font-black uppercase tracking-widest">Text messaging (SMS)</h2>
          <p className="text-sm leading-relaxed">
            If you provide your mobile number and opt in, we send service text messages such as appointment
            reminders, booking confirmations, maintenance status updates, one-time sign-in codes, and account
            links. Message frequency varies by account activity. Message and data rates may apply. Reply STOP
            at any time to opt out, or HELP for help.
          </p>
          <p className="text-sm leading-relaxed font-bold">
            No mobile information will be shared with third parties or affiliates for marketing or promotional
            purposes. Text messaging originator opt-in data and consent will not be shared with any third
            parties, excluding aggregators and providers of the text message services necessary to deliver the
            messages.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Sharing</h2>
          <p className="text-sm leading-relaxed">
            We share information only with the service providers required to operate (payment processing,
            messaging delivery, and hosting), when the law requires it, or with your direction. We do not sell
            personal information.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Your choices</h2>
          <p className="text-sm leading-relaxed">
            You can opt out of text messages at any time by replying STOP. You may request a copy or deletion of
            your personal information by contacting us at {CONTACT_EMAIL}. We retain records as needed for
            legitimate business and legal purposes (for example, payment and tax records).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Contact</h2>
          <p className="text-sm leading-relaxed">
            Questions about this policy: <a className="underline font-bold" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <footer className="pt-4 border-t text-[11px] font-bold text-slate-400">
          {BUSINESS_NAME} · See also our <a className="underline" href="/terms">Terms &amp; SMS Program Terms</a>
        </footer>
      </div>
    </div>
  );
}
