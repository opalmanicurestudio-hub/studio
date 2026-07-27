// src/app/legal/terms/page.tsx
//
// CLARITYFLOW PLATFORM TERMS OF SERVICE — the subscription agreement for the
// SOFTWARE, between ClarityFlow and the studios that sign up for it.
//
// This is a DIFFERENT document from /terms:
//
//   /terms        → the terms an individual studio publishes for its own
//                   clients, including its SMS program terms.
//   /legal/terms  → THIS page. The SaaS subscription agreement. Link the
//                   marketing site's footer "Terms" link here.
//
// Section 7 (Messaging compliance) matters beyond housekeeping: it puts the
// consent, opt-out, and registration obligations on the studio that sends
// the messages, in writing, which is what a carrier or aggregator expects a
// messaging-capable platform to have.
//
// This document is deliberately GENERAL and product-facing. It names no
// individual studio. Put the registered company name in LEGAL_ENTITY once
// incorporated and it appears in the opening paragraph and contact block.
//
// ── EDIT THESE LINES ONLY ──────────────────────────────────────────────
// Set GOVERNING_STATE for a precise governing-law clause; leaving it ''
// keeps the clause accurate with neutral wording. '' hides address/phone.
const PLATFORM = 'ClarityFlow';
const LEGAL_ENTITY = '';       // registered company name, e.g. 'ClarityFlow, Inc.' — leave '' until incorporated
const CONTACT_EMAIL = 'opalmanicurestudio@gmail.com';  // replace with a product address (e.g. support@yourdomain.com) once a domain is verified
const BUSINESS_ADDRESS = '';   // e.g. '123 Main St, Suite 4, Atlanta, GA 30303'
const BUSINESS_PHONE = '';     // e.g. '(404) 555-0142'
const GOVERNING_STATE = '';    // e.g. 'Georgia'
const EFFECTIVE_DATE = 'July 27, 2026';
// ───────────────────────────────────────────────────────────────────────

const lawPhrase = GOVERNING_STATE
  ? `the laws of the State of ${GOVERNING_STATE}`
  : 'the laws of the state in which we are established';
const venuePhrase = GOVERNING_STATE
  ? `the state or federal courts located in ${GOVERNING_STATE}`
  : 'the state or federal courts serving the county in which we are established';

export const metadata = {
  title: `Platform Terms of Service — ${PLATFORM}`,
  description: `The subscription agreement between ${PLATFORM} and the studios that use it, including messaging compliance obligations.`,
};

export default function PlatformTermsPage() {
  return (
    <div className="min-h-screen bg-slate-50 px-5 py-10">
      <div className="max-w-2xl mx-auto space-y-6 text-slate-800">
        <header>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{PLATFORM}</p>
          <h1 className="text-3xl font-black tracking-tight mt-1">Platform Terms of Service</h1>
          <p className="text-xs font-bold text-slate-400 mt-1">Effective date: {EFFECTIVE_DATE}</p>
          <p className="text-xs font-medium text-slate-500 mt-3 leading-relaxed">
            This is the agreement between you — the studio, salon, spa, or professional subscribing to {PLATFORM} —
            and {PLATFORM}{LEGAL_ENTITY ? <> (“{LEGAL_ENTITY}”, “we”, “us”)</> : <> (“we”, “us”)</>}. How we handle
            information is described in our{' '}
            <a className="underline font-bold" href="/legal/privacy">Platform Privacy Policy</a>.
          </p>
        </header>

        <section className="space-y-2 rounded-2xl border-2 border-slate-900 bg-white p-5">
          <h2 className="text-sm font-black uppercase tracking-widest">Are you a salon client, not a studio owner?</h2>
          <p className="text-sm leading-relaxed">
            If you booked an appointment or received a message from a salon or studio that uses {PLATFORM}, these are
            not your terms. The terms of your visit — deposits, cancellations, and the text-message program you
            consented to — are that business's own, and are published on the booking page you used. Contact that
            business directly; {PLATFORM} is the software it runs on, not the provider of your service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">1. Definitions</h2>
          <p className="text-sm leading-relaxed">
            <strong>Service</strong> means the {PLATFORM} software platform, its websites, portals, booking pages,
            and related tools. <strong>Subscriber</strong> or <strong>you</strong> means the business or person that
            creates an account. <strong>Customer Data</strong> means everything you or your team put into the
            Service about your own business and people — clients, staff, booth renters, maintenance workers,
            appointments, reservations, documents, and payment records. <strong>End Client</strong> means a client,
            staff member, renter, or other individual whose record you keep in the Service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">2. Agreement, eligibility &amp; authority</h2>
          <p className="text-sm leading-relaxed">
            By creating an account, subscribing, or using the Service you agree to these terms. You must be at least
            18 and, if you are signing up on behalf of a business, you confirm you are authorized to bind that
            business. You agree to give accurate account and billing information and to keep it current.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">3. Your account &amp; your team</h2>
          <p className="text-sm leading-relaxed">
            You are responsible for everything that happens under your account, including what the staff, renters,
            and administrators you invite do with it. Keep credentials, portal links, and one-time codes
            confidential, give each person their own access rather than sharing a login, remove access promptly when
            someone leaves, and tell us right away if you suspect unauthorized use.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">4. Subscriptions, fees &amp; renewal</h2>
          <p className="text-sm leading-relaxed">
            Plans, features, and prices are those shown when you subscribe. Subscriptions are billed in advance on a
            recurring basis and renew automatically for the same period until cancelled. By subscribing you
            authorize us to charge your payment method for the recurring fee, applicable taxes, and any usage-based
            charges disclosed to you. Fees are exclusive of taxes, which are your responsibility. If a payment fails
            we may retry it and may suspend access until it clears. We may change prices with at least thirty days'
            notice before the change takes effect on your next renewal; if you don't accept the change, you may
            cancel before then.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">5. Cancellation &amp; refunds</h2>
          <p className="text-sm leading-relaxed">
            You may cancel at any time; cancellation takes effect at the end of the current billing period and the
            Service remains available until then. Fees already paid are not refundable except where the law requires
            it or where we have agreed otherwise in writing. Any free trial converts to a paid subscription at the
            end of the trial unless you cancel first.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">6. Customer Data — yours, not ours</h2>
          <p className="text-sm leading-relaxed">
            You own your Customer Data. You grant us only the permission needed to host, process, transmit, back up,
            and display it in order to provide the Service to you and to act on your instructions. You are
            responsible for the data you collect: for having the right to collect and use it, for the accuracy of
            what you enter, for publishing your own privacy policy and client-facing terms, for obtaining any
            consents your clients must give, and for honoring their requests about their own information. We handle
            Customer Data as described in our{' '}
            <a className="underline font-bold" href="/legal/privacy">Platform Privacy Policy</a>. You are
            responsible for keeping your own copies of anything you need to retain; export tools are provided for
            that purpose.
          </p>
        </section>

        {/* ── The compliance section a carrier or aggregator expects to see ── */}
        <section id="messaging" className="space-y-3 rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h2 className="text-sm font-black uppercase tracking-widest">7. Messaging compliance — you are the sender</h2>
          <p className="text-sm leading-relaxed">
            The Service can send text messages and emails to your End Clients on your behalf. For every such message
            you are the sender and the party responsible for its legality. We provide the tooling; we do not
            originate your messages, choose their recipients, or write their content.
          </p>
          <p className="text-sm leading-relaxed">
            You agree that you will: obtain and keep proof of each recipient's prior express consent before texting
            them, in the manner required by the Telephone Consumer Protection Act, applicable state law, CTIA
            guidelines, and carrier rules; never treat consent as a condition of purchase; disclose message types,
            that message frequency varies, and that message and data rates may apply at the point of opt-in; honor
            STOP, UNSUBSCRIBE, CANCEL, END, and QUIT immediately and never message a number that has opted out;
            answer HELP requests; register your brand and campaign where required for A2P messaging and keep that
            registration accurate; send only messages consistent with the registered use case; and respect quiet
            hours and volume limits that apply to you.
          </p>
          <p className="text-sm leading-relaxed">
            You will not use the Service to send unsolicited marketing, deceptive or misleading content, content
            relating to sex, hate, alcohol, firearms, tobacco, cannabis, or controlled substances, high-risk
            financial offers, or anything prohibited by a carrier or messaging provider. You will not use it to
            message people whose numbers you bought, rented, scraped, or otherwise did not collect yourself.
          </p>
          <p className="text-sm leading-relaxed">
            We may suspend messaging on your account immediately if we receive a carrier or provider complaint, if
            your traffic is flagged as spam, or if we reasonably believe a violation is occurring. Carriers and
            messaging providers are not liable for delayed or undelivered messages, and neither are we; delivery
            depends on networks outside our control.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">8. Acceptable use</h2>
          <p className="text-sm leading-relaxed">
            Do not use the Service to break the law or infringe anyone's rights; do not upload malicious code; do
            not probe, scan, overload, or attempt to gain unauthorized access to the Service or to another
            Subscriber's data; do not scrape or systematically extract data other than your own; do not reverse
            engineer, copy, or resell the Service or offer it as your own product without our written agreement; and
            do not share access credentials outside your business. We may suspend or terminate accounts used this
            way, with notice where practical and immediately where the risk requires it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">9. Payments, payroll &amp; third-party integrations</h2>
          <p className="text-sm leading-relaxed">
            Card payments, bank connections, and payroll features are provided through third parties — currently
            Stripe, Plaid, and Gusto — and your use of them is also subject to their own terms and to their
            approval. We are not a bank, a money transmitter, a payment processor, a payroll provider, or a tax
            adviser. Amounts you collect from your clients, the fees you charge them, refunds, disputes and
            chargebacks, rent you collect from renters, worker classification, wage calculations, and tax filings
            remain entirely your responsibility. Reports, payroll drafts, and financial figures the Service produces
            are conveniences to be reviewed by you or your accountant, not professional advice, and you are
            responsible for verifying them before relying on or filing them. If a third-party service changes or
            becomes unavailable, the related feature may change or stop working.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">10. Your relationships with your people</h2>
          <p className="text-sm leading-relaxed">
            The Service helps you manage employees, independent booth renters, contractors, and clients, but it does
            not make us a party to any of those relationships. Rental agreements, employment and contractor
            arrangements, licensing and insurance requirements, house rules, and service outcomes are between you
            and those people. We do not provide legal, tax, employment, insurance, or licensing advice.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">11. Our intellectual property, and your feedback</h2>
          <p className="text-sm leading-relaxed">
            The Service — its software, design, name, and content — belongs to us and our licensors, and nothing here
            transfers ownership of it. You receive a limited, non-exclusive, non-transferable right to use it while
            your subscription is active. If you send us feedback or suggestions, we may use them to improve the
            Service without obligation or payment to you.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">12. Availability, support &amp; new features</h2>
          <p className="text-sm leading-relaxed">
            We work to keep the Service available and to fix problems promptly, but we do not promise uninterrupted
            availability, and maintenance, provider outages, and events beyond our control will occasionally
            interrupt it. Support is provided by email at {CONTACT_EMAIL}. We may add, change, or discontinue
            features; where a change materially reduces core functionality you rely on, we will give reasonable
            notice. Features labelled beta or preview are provided as they are and may change or be withdrawn.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">13. Term, termination &amp; what happens to your data</h2>
          <p className="text-sm leading-relaxed">
            These terms apply while you have an account. You may cancel as described above. We may suspend or
            terminate your account for material breach, non-payment, or unlawful use, and will give notice and a
            chance to cure where the circumstances reasonably allow it. After termination you will have a reasonable
            window to export your Customer Data, after which we may delete it as described in the Platform Privacy
            Policy. Sections that by their nature should survive — ownership, fees already owed, disclaimers,
            liability limits, indemnity, and governing law — survive termination.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">14. Disclaimers</h2>
          <p className="text-sm leading-relaxed">
            The Service is provided as it is and as available, without warranties of any kind, whether express or
            implied, including implied warranties of merchantability, fitness for a particular purpose, and
            non-infringement. We do not warrant that the Service will be error-free, that data will always be
            available or perfectly accurate, or that every message will be delivered. You are responsible for
            keeping your own backups of data that matters to your business.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">15. Limitation of liability</h2>
          <p className="text-sm leading-relaxed">
            To the fullest extent the law allows, we are not liable for indirect, incidental, special, punitive, or
            consequential damages, or for lost profits, lost revenue, lost bookings, lost goodwill, or lost or
            corrupted data, even if we were told such damages were possible. Our total liability for all claims
            arising out of or relating to the Service is limited to the amount you paid us for the Service in the
            twelve months before the event giving rise to the claim. Some jurisdictions do not allow certain
            limitations, so parts of this section may not apply to you, and nothing here limits liability that
            cannot be limited by law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">16. Indemnity</h2>
          <p className="text-sm leading-relaxed">
            You will defend and indemnify us against claims, penalties, and costs arising from your Customer Data,
            your messages and the consents behind them, your relationships with your clients, staff, and renters,
            your services, and your use of the Service in breach of these terms — including claims under
            telemarketing, messaging, privacy, wage, or consumer protection law that arise from your conduct.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">17. Governing law &amp; disputes</h2>
          <p className="text-sm leading-relaxed">
            These terms are governed by {lawPhrase}, without regard to its conflict-of-law rules. Before filing
            anything, both of us agree to try to resolve the dispute informally by contacting the other and allowing
            thirty days to work it out. Disputes that remain will be brought in {venuePhrase}, and both of us
            consent to that venue. Each of us waives any right to bring or participate in a class or representative
            action against the other.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">18. Changes, notices &amp; general</h2>
          <p className="text-sm leading-relaxed">
            We may update these terms; the current version always lives at this address with the effective date at
            the top, and we will notify Subscribers of material changes before they take effect — continuing to use
            the Service after that means you accept them. Notices to you may be sent to your account email. You may
            not assign these terms without our consent; we may assign them in connection with a merger or sale of
            the business. Neither of us is liable for delays caused by events beyond reasonable control. If a
            provision is unenforceable, the rest stays in effect. These terms, the Platform Privacy Policy, and the
            plan details shown at subscription are the entire agreement between us about the Service, and neither of
            us is the other's partner, agent, or employee.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">19. Contact us</h2>
          <p className="text-sm leading-relaxed">
            <strong>{LEGAL_ENTITY || PLATFORM}</strong><br />
            {BUSINESS_ADDRESS ? <>{BUSINESS_ADDRESS}<br /></> : null}
            {BUSINESS_PHONE ? <>{BUSINESS_PHONE}<br /></> : null}
            <a className="underline font-bold" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <footer className="pt-4 border-t text-[11px] font-bold text-slate-400 space-x-3">
          <span>{PLATFORM}</span>
          <a className="underline" href="/legal/privacy">Platform Privacy Policy</a>
        </footer>
      </div>
    </div>
  );
}
