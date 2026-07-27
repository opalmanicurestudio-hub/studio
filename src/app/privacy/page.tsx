// src/app/privacy/page.tsx
//
// PRIVACY POLICY — the ONE public privacy policy for this business, and the
// exact URL submitted as PrivacyPolicyUrl on the A2P 10DLC campaign.
//
// v3 — full professional policy, still built around Twilio's Error 30908
// review checklist:
//   1. The mobile-messaging section sits FIRST, above the fold, clearly
//      labeled, so a reviewer landing on this URL sees it immediately.
//   2. It uses Twilio's own passing language verbatim: "We do not share,
//      sell, or provide your mobile phone number or messaging consent data
//      to third parties or affiliates for marketing or promotional
//      purposes."  The SAME sentence appears word-for-word on /terms.
//   3. It states what data is collected and how it is used FOR MESSAGING
//      specifically (not just generally).
//   4. It carries the message-frequency line and "Message and data rates
//      may apply" INSIDE the policy itself (carriers check the policy, not
//      only the opt-in form).
//   5. Every other section that mentions sharing explicitly CARVES OUT
//      mobile numbers and consent data, so no sentence on the page can be
//      read as contradicting the non-sharing promise — that inconsistency
//      is a documented 30908 cause.
//   6. A "single policy" note tells the reviewer this page supersedes any
//      other document, killing the duplicate/conflicting-policy cause.
//   7. Named subprocessors, retention, security, minors, and state privacy
//      rights are all disclosed — what a reviewer expects of a real policy
//      rather than a template.
//
// Anchor #sms exists so the campaign's message_flow can link straight to
// the messaging disclosures: .../privacy#sms
//
// ── EDIT THESE FOUR LINES ONLY ─────────────────────────────────────────
// BUSINESS_ADDRESS and BUSINESS_PHONE are optional but RECOMMENDED: a
// verifiable address and phone on the policy page materially help A2P
// brand/campaign review. Leave a value as '' to hide that line entirely.
const BUSINESS_NAME = 'Opal Manicure Studio';
const CONTACT_EMAIL = 'opalmanicurestudio@gmail.com';
const BUSINESS_ADDRESS = '';   // e.g. '123 Main St, Suite 4, Atlanta, GA 30303'
const BUSINESS_PHONE = '';     // e.g. '(404) 555-0142'
const EFFECTIVE_DATE = 'July 27, 2026';
// ───────────────────────────────────────────────────────────────────────

export const metadata = {
  title: `Privacy Policy — ${BUSINESS_NAME}`,
  description: `The privacy policy for ${BUSINESS_NAME}, including how mobile phone numbers and SMS consent data are collected, used, and never shared or sold.`,
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 px-5 py-10">
      <div className="max-w-2xl mx-auto space-y-6 text-slate-800">
        <header>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{BUSINESS_NAME}</p>
          <h1 className="text-3xl font-black tracking-tight mt-1">Privacy Policy</h1>
          <p className="text-xs font-bold text-slate-400 mt-1">Effective date: {EFFECTIVE_DATE}</p>
          <p className="text-xs font-medium text-slate-500 mt-3 leading-relaxed">
            This page is the single, official, publicly accessible privacy policy for {BUSINESS_NAME}. It is not
            behind a login and requires no account to read. It supersedes and replaces any earlier or separate
            privacy document, and it applies to our website, our online booking and check-in pages, our client,
            staff and renter portals, and our text (SMS) messaging program.
          </p>
        </header>

        {/* ── Messaging first: this is the section carrier review looks for ── */}
        <section id="sms" className="space-y-3 rounded-2xl border-2 border-slate-900 bg-white p-5">
          <h2 className="text-sm font-black uppercase tracking-widest">Mobile phone numbers &amp; text messaging (SMS)</h2>

          <p className="text-sm leading-relaxed font-bold">
            We do not share, sell, or provide your mobile phone number or messaging consent data to third parties
            or affiliates for marketing or promotional purposes.
          </p>
          <p className="text-sm leading-relaxed">
            Text messaging originator opt-in data and consent are not shared with any third party, excluding
            aggregators and the messaging service providers strictly necessary to transmit the messages you asked
            us to send. Those providers act only on our instructions, may use the information only to deliver our
            messages, and may not use it for their own purposes.
          </p>

          <div className="space-y-1.5 pt-1">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">What we collect for messaging</h3>
            <p className="text-sm leading-relaxed">
              To send you text messages we collect your mobile phone number, your name, the date and time you gave
              consent, the page or form where you gave it, and the delivery status of the messages we send you (for
              example delivered, failed, or opted out). We collect this only from you — directly, when you enter
              your number into one of our booking, check-in, rental, or account forms and check the consent box, or
              when you text us first. We do not buy, rent, import, or append phone number lists, and we do not
              obtain numbers from data brokers or third-party lead sellers.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">How we use it</h3>
            <p className="text-sm leading-relaxed">
              Your mobile number and consent record are used for one purpose: sending you the service messages you
              opted in to receive, and keeping a record that proves you opted in. Those messages are appointment
              confirmations, appointment reminders and changes, check-in and arrival updates, booth-rental and rent
              notices, maintenance and work-order status updates, one-time sign-in codes, and secure links to your
              own appointment or account. We do not use your mobile number for advertising, we do not text you on
              behalf of any other business, and we do not use it to build profiles for anyone else.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Consent, frequency, and cost</h3>
            <p className="text-sm leading-relaxed">
              Consent is given by you and is never a condition of booking or purchase. Message frequency varies by
              account activity. Message and data rates may apply. Reply STOP to any message to opt out at any time,
              or HELP for help. You may also email {CONTACT_EMAIL} to be removed. Opting out stops texts only — you
              can still book with us, and we can still reach you by email or phone.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">If you text us</h3>
            <p className="text-sm leading-relaxed">
              Messages you send to us, including any photos you attach, are stored with your appointment or account
              record so we can respond and keep an accurate service history. Please do not send payment card
              numbers or sensitive personal information by text.
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Other information we collect</h2>
          <p className="text-sm leading-relaxed">
            When you book an appointment, reserve a station, rent a booth, join our team as staff or a maintenance
            worker, or contact us, we also collect the other information you provide: your name and email address,
            appointment, reservation and booking details, service preferences and notes relevant to your service,
            forms or documents we ask you to complete, payment records, and the messages you send us. If you use
            one of our portals we record sign-in activity for that account. Our website host also keeps standard
            technical logs, such as IP address and browser type, to keep the site secure and working.
          </p>
          <p className="text-sm leading-relaxed">
            Payment card processing is handled entirely by our payment processor. We never see or store your full
            card number; we retain only the receipt record and the last four digits.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">How we use that information</h2>
          <p className="text-sm leading-relaxed">
            We use it to run the business you are interacting with: confirming and reminding you of appointments,
            reservations and bookings, checking you in, collecting deposits and payments, managing booth rentals
            and rent, coordinating maintenance and repairs, providing secure links to your own records, keeping the
            service history and financial records the law requires us to keep, and responding when you contact us.
            We do not sell your information, and we do not use it for advertising or for automated decisions that
            affect your legal rights.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Email communications</h2>
          <p className="text-sm leading-relaxed">
            Our service emails — confirmations, reminders, receipts, document requests — may record whether the
            email was delivered, opened, or whether a link in it was clicked. We use this only to confirm that a
            message actually reached you and to correct a bad address, never to profile you or to target
            advertising.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Sharing</h2>
          <p className="text-sm leading-relaxed">
            We do not sell personal information, and we do not share it for marketing or promotional purposes. We
            disclose information only to the service providers required to operate our business, and only to the
            extent each one needs to perform its service for us: payment processing (Stripe), text message
            delivery (Twilio), email delivery (Resend), and website hosting and data storage (Vercel and Google
            Cloud / Firebase). Each acts on our instructions under contract. We may also disclose information when
            the law requires it, to protect the safety or rights of people, or when you direct us to.
          </p>
          <p className="text-sm leading-relaxed font-bold">
            This applies with no exception to mobile phone numbers and SMS consent data, which are never shared,
            sold, or provided to third parties or affiliates for marketing or promotional purposes, as stated
            above.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">How long we keep it</h2>
          <p className="text-sm leading-relaxed">
            We keep appointment, reservation, and rental records for as long as you are a client or renter and
            afterward for as long as needed for legitimate business and legal purposes — for example payment, tax,
            and dispute records, and proof of messaging consent. Records of a text-message opt-out are kept
            indefinitely so that we do not message you again by mistake. When information is no longer needed, we
            delete it or remove the details that identify you.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Security</h2>
          <p className="text-sm leading-relaxed">
            Information is stored with reputable hosting and database providers, transmitted over encrypted
            connections, and access is limited to the people who need it to do their job. Portal and appointment
            links are private to you — please do not forward them. No system is perfectly secure, so if a breach
            affects your information we will notify you as the law requires.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Children</h2>
          <p className="text-sm leading-relaxed">
            Our website, booking tools, and text program are intended for adults. We do not knowingly collect
            personal information from children under 13, and we do not knowingly send text messages to a number
            provided by a child. A parent or guardian may book on a minor's behalf using the adult's own contact
            details. If you believe a child has given us information, contact us and we will delete it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Your rights and choices</h2>
          <p className="text-sm leading-relaxed">
            You may ask us for a copy of the personal information we hold about you, ask us to correct it, or ask
            us to delete it, subject to records we must keep by law. You can stop text messages at any time by
            replying STOP, and you can unsubscribe from non-essential email using the link in the email. Depending
            on where you live you may have additional rights under state privacy law, including the right to know
            what we collect, the right to delete, the right to correct, and the right not to be discriminated
            against for exercising those rights. Because we do not sell personal information or share it for
            cross-context behavioral advertising, there is nothing for you to opt out of on that front. To make a
            request, email {CONTACT_EMAIL}; we may need to verify your identity before we act.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Changes to this policy</h2>
          <p className="text-sm leading-relaxed">
            If we change this policy we will update the effective date at the top of this page, and the current
            version will always live at this same address. Material changes to how we handle mobile numbers or
            messaging consent will be described here before they take effect.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest">Contact us</h2>
          <p className="text-sm leading-relaxed">
            Questions about this policy, about your information, or about the text messages you receive from us:
          </p>
          <p className="text-sm leading-relaxed">
            <strong>{BUSINESS_NAME}</strong><br />
            {BUSINESS_ADDRESS ? <>{BUSINESS_ADDRESS}<br /></> : null}
            {BUSINESS_PHONE ? <>{BUSINESS_PHONE}<br /></> : null}
            <a className="underline font-bold" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <footer className="pt-4 border-t text-[11px] font-bold text-slate-400">
          {BUSINESS_NAME} · See also our <a className="underline" href="/terms">Terms &amp; SMS Program Terms</a>
        </footer>
      </div>
    </div>
  );
}
