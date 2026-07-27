// src/app/terms/page.tsx
//
// TERMS OF SERVICE & SMS PROGRAM TERMS — the public terms page linked from
// every SMS opt-in form and from the privacy policy.
//
// v2 — professional terms, and deliberately CONSISTENT with /privacy for
// A2P 10DLC review. Two rules were followed:
//   • The non-sharing sentence here is WORD-FOR-WORD identical to the one
//     in the privacy policy. Reviewers flag campaigns where two pages say
//     nearly-but-not-quite the same thing about mobile data.
//   • The SMS program section carries every disclosure carriers check, in
//     one block: brand name, program description and message types, "message
//     frequency varies", "message and data rates may apply", STOP and HELP
//     instructions, consent-not-a-condition-of-purchase, carrier
//     non-liability, and a direct link to the privacy policy.
//
// Anchor #sms lets the campaign message_flow link straight here too.
//
// ── EDIT THESE FIVE LINES ONLY ─────────────────────────────────────────
// Set GOVERNING_STATE to your state for a precise governing-law clause. If
// you leave it '', the clause stays accurate with neutral wording instead.
// BUSINESS_ADDRESS / BUSINESS_PHONE are optional but recommended — a
// verifiable address and phone help A2P brand review. '' hides the line.
const BUSINESS_NAME = 'Opal Manicure Studio';
const CONTACT_EMAIL = 'opalmanicurestudio@gmail.com';
const BUSINESS_ADDRESS = '';   // e.g. '123 Main St, Suite 4, Atlanta, GA 30303'
const BUSINESS_PHONE = '';     // e.g. '(404) 555-0142'
const GOVERNING_STATE = '';    // e.g. 'Georgia'
const EFFECTIVE_DATE = 'July 27, 2026';
// ───────────────────────────────────────────────────────────────────────

const lawPhrase = GOVERNING_STATE
  ? `the laws of the State of ${GOVERNING_STATE}`
  : 'the laws of the state in which the studio operates';
const venuePhrase = GOVERNING_STATE
  ? `the state or federal courts located in ${GOVERNING_STATE}`
  : 'the state or federal courts serving the county in which the studio operates';

export const metadata = {
  title: `Terms of Service & SMS Program — ${BUSINESS_NAME}`,
  description: `Terms of service for ${BUSINESS_NAME}, including the full SMS program terms: message types, frequency, rates, and how to opt out.`,
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-50 px-5 py-10">
      <div className="max-w-2xl mx-auto space-y-6 text-slate-800">
        <header>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{BUSINESS_NAME}</p>
          <h1 className="text-3xl font-black tracking-tight mt-1">Terms of Service</h1>
          <p className="text-xs font-bold text-slate-400 mt-1">Effective date: {EFFECTIVE_DATE}</p>
          <p className="text-xs font-medium text-slate-500 mt-3 leading-relaxed">
            These are the terms for {BUSINESS_NAME} — our services, our website and booking tools, and our text
            (SMS) messaging program. They are publicly accessible and require no account to read. How we handle
            your information is described in our{' '}
            <a className="underline font-bold" href="/privacy">Privacy Policy</a>, which is the single privacy
            policy for this business.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">1. Who we are, and agreement to these terms</h2>
          <p className="text-sm leading-relaxed">
            {BUSINESS_NAME} provides salon and nail services, online and in-person appointment booking, station and
            booth reservations, and booth/station rentals to licensed professionals. By using our website, booking
            pages, check-in links, or portals, or by receiving services from us, you agree to these terms. If you do
            not agree, please do not use them.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">2. Eligibility</h2>
          <p className="text-sm leading-relaxed">
            You must be at least 18 years old to book, to open an account or portal, or to opt in to text messages.
            A parent or legal guardian may book a service for a minor using the adult's own name and contact
            details, and must accompany the minor to the appointment unless we have agreed otherwise in writing.
          </p>
        </section>

        {/* ── SMS program terms: the block carrier review reads ── */}
        <section id="sms" className="space-y-3 rounded-2xl border-2 border-slate-900 bg-white p-5">
          <h2 className="text-sm font-black uppercase tracking-widest">3. SMS program terms</h2>
          <p className="text-sm leading-relaxed">
            <strong>Program.</strong> {BUSINESS_NAME} operates an account and service notification text program.
            When you provide your mobile number and opt in — by checking the consent box while booking online, at
            check-in, when signing a rental agreement, when being onboarded as staff or a maintenance worker, or by
            texting us first — you consent to receive text messages from {BUSINESS_NAME} at that number. The
            consent box is never pre-checked, and booking works whether or not you check it.
          </p>
          <p className="text-sm leading-relaxed">
            <strong>Message types.</strong> Appointment confirmations and reminders; appointment changes,
            cancellations, and running-late notices; check-in and arrival updates; deposit, payment, and receipt
            notices; reservation and booth-rental notices including rent reminders; maintenance and work-order
            status updates; one-time sign-in codes; and secure links to your own appointment or account.
          </p>
          <p className="text-sm leading-relaxed">
            <strong>Message frequency varies</strong> based on your account activity.{' '}
            <strong>Message and data rates may apply</strong> depending on your mobile plan and carrier.
          </p>
          <p className="text-sm leading-relaxed">
            <strong>Opt out.</strong> Reply <strong>STOP</strong> to any message to cancel at any time. You may
            receive one final message confirming that you have been unsubscribed. You may also email{' '}
            {CONTACT_EMAIL} to be removed. Opting out stops text messages only — you can still book with us, and we
            can still reach you by email or phone.
          </p>
          <p className="text-sm leading-relaxed">
            <strong>Help.</strong> Reply <strong>HELP</strong> to any message, or contact us at {CONTACT_EMAIL}
            {BUSINESS_PHONE ? ` or ${BUSINESS_PHONE}` : ''}.
          </p>
          <p className="text-sm leading-relaxed">
            <strong>Consent is not a condition</strong> of purchasing any goods or services, or of booking an
            appointment. Carriers, including AT&amp;T, T-Mobile, Verizon, and their affiliates, are not liable for
            delayed or undelivered messages. Supported carriers may change without notice.
          </p>
          <p className="text-sm leading-relaxed font-bold">
            We do not share, sell, or provide your mobile phone number or messaging consent data to third parties
            or affiliates for marketing or promotional purposes.
          </p>
          <p className="text-sm leading-relaxed">
            Your mobile information is handled as described in our{' '}
            <a className="underline font-bold" href="/privacy#sms">Privacy Policy</a>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">4. Appointments, deposits &amp; payment</h2>
          <p className="text-sm leading-relaxed">
            Prices, service durations, deposit requirements, and any forms or documents we need from you before your
            visit are shown when you book and in the confirmation we send. A deposit, where required, is applied as
            credit toward the price of your service. Payment is due at the time of service unless we have agreed
            otherwise. We accept the payment methods shown at booking; card payments are processed by our payment
            processor, and by providing a card you authorize us to charge it for the services you book and for any
            fees disclosed to you under section 5.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">5. Changes, cancellations &amp; no-shows</h2>
          <p className="text-sm leading-relaxed">
            You may reschedule or cancel using the link in your confirmation, or by contacting us. The cancellation
            window, any late-cancellation or no-show fee, and the deadline for changes are disclosed to you at the
            time of booking and shown again on your appointment page before you confirm a change, so you always see
            what applies before anything is charged. Arriving significantly late may mean we have to shorten or
            reschedule your service to protect the appointments after yours. If we ever need to cancel or move your
            appointment, we will contact you and you will not be charged a fee.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">6. Reservations &amp; booth rentals</h2>
          <p className="text-sm leading-relaxed">
            Day passes and hourly station reservations are subject to the rate, duration, and house rules shown when
            you reserve. Longer-term booth and station rentals are governed by the individual rental agreement each
            renter signs, which controls rent amount and schedule, deposits, insurance and licensing requirements,
            access, and house rules; where that agreement and these terms differ, the signed agreement controls for
            that renter. Renters are independent professionals responsible for their own licensing, taxes, tools,
            and client relationships.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">7. Health, safety &amp; service results</h2>
          <p className="text-sm leading-relaxed">
            Please tell us before your service about any allergies, sensitivities, skin or nail conditions,
            infections, injuries, pregnancy, or medications that could affect it. We may decline or modify a service
            when it would not be safe or sanitary to perform. Cosmetic services carry inherent risks and results
            vary between individuals, so we cannot guarantee a specific outcome or how long it lasts. Nothing we
            provide is medical advice or treatment. If you are unhappy with a service, contact us within seven days
            and we will do our best to correct it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">8. Acceptable use of our site and portals</h2>
          <p className="text-sm leading-relaxed">
            Appointment links, check-in links, portal access, and sign-in codes are personal to you — do not share
            or forward them. Do not attempt to access another person's records, disrupt or probe our systems, scrape
            our pages, or use our booking tools to make reservations you do not intend to keep. We may suspend or
            remove access that is misused. Anything you submit to us, such as photos attached to a maintenance
            request or a service note, must be yours to share and relevant to the service; you keep ownership of it
            and give us permission to use it only for providing and documenting that service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">9. Our content</h2>
          <p className="text-sm leading-relaxed">
            Our name, logo, site design, photographs, and written content belong to us or our licensors and may not
            be copied or used commercially without our written permission.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">10. Disclaimers &amp; limitation of liability</h2>
          <p className="text-sm leading-relaxed">
            Our website, booking tools, and portals are provided as they are, without warranties of any kind, and we
            do not promise they will always be uninterrupted or error-free. To the fullest extent the law allows,
            {' '}{BUSINESS_NAME} is not liable for indirect, incidental, special, or consequential damages, or for
            lost profits, arising from your use of our site or services, and our total liability for any claim is
            limited to the amount you paid us for the service the claim relates to. Some states do not allow certain
            limitations, so parts of this section may not apply to you. Nothing here limits liability that cannot be
            limited by law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">11. Governing law</h2>
          <p className="text-sm leading-relaxed">
            These terms are governed by {lawPhrase}, without regard to its conflict-of-law rules. Any dispute that
            is not resolved informally will be brought in {venuePhrase}, and both of us consent to that venue. We
            would much rather hear from you first — most issues are resolved with a single email to {CONTACT_EMAIL}.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">12. Changes, severability &amp; contact</h2>
          <p className="text-sm leading-relaxed">
            We may update these terms; the current version always lives at this address, with the effective date at
            the top. If any provision is found unenforceable, the rest stays in effect. Together with our privacy
            policy and any signed rental agreement, these terms are the complete agreement between us about their
            subject matter.
          </p>
          <p className="text-sm leading-relaxed">
            <strong>{BUSINESS_NAME}</strong><br />
            {BUSINESS_ADDRESS ? <>{BUSINESS_ADDRESS}<br /></> : null}
            {BUSINESS_PHONE ? <>{BUSINESS_PHONE}<br /></> : null}
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
