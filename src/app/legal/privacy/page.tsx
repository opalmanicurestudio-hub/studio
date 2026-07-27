// src/app/legal/privacy/page.tsx
//
// CLARITYFLOW PLATFORM PRIVACY POLICY — the policy for the SOFTWARE.
//
// v2 — restructured to match the depth of a real competitor policy in this
// exact market (GlossGenius), while staying TRUE to what this app actually
// does. Where GlossGenius sells/shares data for targeted advertising, this
// platform does not, and the policy says so plainly rather than copying
// their ad-tech disclosures. Nothing in here is aspirational: it was written
// against the code — no analytics or ad trackers are present, the
// subprocessors named are the ones actually wired in (Firebase, Vercel,
// Stripe, Twilio, Resend, Plaid, Gusto), and the delivery-tracking language
// describes the message-log feature as built.
//
// Structural notes worth keeping if this is ever edited:
//   • The scope box at the top mirrors how GlossGenius separates its
//     Professional-facing policy from the client-facing policy of each
//     Professional. That separation is what keeps a carrier reviewer from
//     reading two policies as two CONFLICTING policies for one brand.
//   • Section 3 ends with a blanket override excluding text-messaging
//     opt-in data and consent from EVERY disclosure category above it —
//     the same placement GlossGenius uses. Do not move it above the list;
//     its force comes from applying to all of them.
//   • Section 12 carries the state-privacy-law disclosures (categories,
//     recipients, purposes) as stacked blocks rather than a wide table, so
//     it stays readable on a phone.
//
// This is a DIFFERENT document from /privacy:
//   /privacy        → the policy an individual studio publishes for its own
//                     clients. Each studio is responsible for its own.
//   /legal/privacy  → this page. The product's policy, for the studios that
//                     subscribe to it. Link the marketing footer here.
//
// This document is deliberately GENERAL and product-facing. It names no
// individual studio. If the company is later incorporated, put the
// registered entity name in LEGAL_ENTITY and it will appear in the opening
// paragraph and the contact block automatically.
//
// ── EDIT THESE LINES ONLY ──────────────────────────────────────────────
const PLATFORM = 'ClarityFlow';
const LEGAL_ENTITY = '';       // registered company name, e.g. 'ClarityFlow, Inc.' — leave '' until incorporated
const CONTACT_EMAIL = 'opalmanicurestudio@gmail.com';  // replace with a product address (e.g. privacy@yourdomain.com) once a domain is verified
const BUSINESS_ADDRESS = '';   // e.g. '123 Main St, Suite 4, Atlanta, GA 30303'
const BUSINESS_PHONE = '';     // e.g. '(404) 555-0142'
const EFFECTIVE_DATE = 'July 27, 2026';
// ───────────────────────────────────────────────────────────────────────

export const metadata = {
  title: `Privacy Policy — ${PLATFORM}`,
  description: `How ${PLATFORM} collects, uses, and discloses information about the studios that subscribe to it, and how it handles the client records those studios store.`,
};

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-sm font-black uppercase tracking-widest">{children}</h2>
);
const H3 = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">{children}</h3>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm leading-relaxed">{children}</p>
);
const List = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="text-sm leading-relaxed list-disc pl-5 space-y-1.5">
    {items.map((it, i) => <li key={i}>{it}</li>)}
  </ul>
);

export default function PlatformPrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 px-5 py-10">
      <div className="max-w-2xl mx-auto space-y-6 text-slate-800">
        <header>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{PLATFORM}</p>
          <h1 className="text-3xl font-black tracking-tight mt-1">Platform Privacy Policy</h1>
          <p className="text-xs font-bold text-slate-400 mt-1">Effective date: {EFFECTIVE_DATE}</p>
          <p className="text-sm leading-relaxed text-slate-600 mt-3">
            {PLATFORM}{LEGAL_ENTITY ? <> (“{LEGAL_ENTITY}”, “we”, “us”)</> : <> (“we”, “us”)</>} provides booking,
            payment, rental, and business-management software (the “Services”) to salons, studios, spas, and the
            beauty and wellness professionals who work in them (“Subscribers”). This policy explains how we collect,
            use, and disclose personal information from and about Subscribers.
          </p>
          <p className="text-xs font-medium text-slate-500 mt-2 leading-relaxed">
            This page is publicly accessible and requires no account to read.
          </p>
        </header>

        <section className="space-y-2 rounded-2xl border-2 border-slate-900 bg-white p-5">
          <H>Scope — are you a salon client rather than a studio owner?</H>
          <P>
            This policy applies only to information we collect from and about Subscribers. It does not apply to
            information about the individuals who interact with a Subscriber — for example someone who books an
            appointment, checks in, reserves a station, or receives a text message from a salon that uses{' '}
            {PLATFORM}. If you are that person, the policy that governs your information is <em>that salon's own</em>{' '}
            privacy policy; it is linked from the booking page you used and from the messages you receive. Contact
            the salon or studio directly with questions or to exercise rights you may have. If you are not sure who
            that is, the business name appears on the booking page you used, on your receipt, and in every message you
            receive.
          </P>
        </section>

        <section className="space-y-2">
          <H>1. The two roles we play</H>
          <P>
            For information about a <strong>Subscriber</strong> — the studio, salon, or owner who signs up for and
            pays for the Services — we are the business responsible for that information, and this policy describes
            what we do with it.
          </P>
          <P>
            For <strong>Customer Data</strong> — the records a Subscriber creates or uploads about its own clients,
            staff, booth renters, maintenance workers, appointments, reservations, documents, and payments — we act
            only as a service provider on that Subscriber's instructions. The Subscriber decides what to collect,
            how long to keep it, who at the studio may see it, and what messages go out. We do not own that data, we
            do not decide how it is used, and we do not use it for our own purposes. If you are one of those clients,
            staff members, or renters, direct requests about your information to the studio; we assist the studio in
            carrying them out.
          </P>
        </section>

        <section className="space-y-3">
          <H>2. The information we collect</H>

          <div className="space-y-1.5">
            <H3>a. Information you provide directly to us</H3>
            <P>We collect information you give us when you register for an account, subscribe, contact support, submit content about your business, or authorize an integration. It may include:</P>
            <List items={[
              <><strong>Identifiers and contact information</strong> — your name, business name, email address, phone number, mailing or business address, and your username and password.</>,
              <><strong>Business information</strong> — your business type and hours, locations, stations and booths, services with their names, descriptions, durations and prices, deposit and cancellation policies, payment preferences, professional or cosmetology license numbers where you record them, and photographs you choose to upload.</>,
              <><strong>Financial information</strong> — subscription billing details, and the bank or card connection details needed to accept payments, collected through our payment processor. We do not receive or store full payment card numbers.</>,
              <><strong>Transactional information</strong> — records of your subscription purchases and of the transactions you process through the Services.</>,
              <><strong>Support communications</strong> — the messages, screenshots, and details you send us when you ask for help.</>,
            ]} />
          </div>

          <div className="space-y-1.5">
            <H3>b. Information from other sources</H3>
            <P>
              We may receive information about you from our payment processor in connection with verifying your
              identity, enabling payouts, and troubleshooting — for example the tax identification number or bank
              details you gave the processor directly. Where a Subscriber invites you to join its account as a staff
              member, renter, or administrator, we receive the contact details that Subscriber entered for you. We do
              not buy personal information from data brokers, and we do not append or enrich Subscriber records from
              third-party datasets.
            </P>
          </div>

          <div className="space-y-1.5">
            <H3>c. Information we collect automatically</H3>
            <P>
              When you use the Services we and our hosting providers record technical and usage information: IP
              address, browser type and version, operating system, device type, access times, pages and features
              used, referring pages, and error reports. The application also writes an audit trail recording which
              account created or changed a record and when. We use this to keep the Services secure and working, to
              investigate abuse and errors, and to understand which features need attention. We do not use
              advertising or cross-site tracking technologies — see section 4.
            </P>
          </div>

          <div className="space-y-1.5">
            <H3>d. Information we derive</H3>
            <P>
              We may draw limited inferences from what we already hold, such as approximate location from an IP
              address for security purposes, or the kind of business you run from the services you offer. We do not
              use inferences to profile you for advertising or to make decisions that affect your legal rights.
            </P>
          </div>

          <div className="space-y-1.5">
            <H3>e. What we do not collect</H3>
            <P>
              We do not collect precise device geolocation, we do not collect biometric information, and we do not
              ask for Social Security numbers. Where a Subscriber's own payroll integration requires sensitive
              identifiers, those are collected by that provider under its own terms, not by us.
            </P>
          </div>
        </section>

        <section className="space-y-2">
          <H>3. How we use the information we collect</H>
          <P>We use it for the following business purposes:</P>
          <List items={[
            'To provide the Services — creating and authenticating your account, hosting your studio\'s data, running booking, scheduling, rental, payment, and messaging features, and enabling the integrations you connect.',
            'To process your subscription payments and to keep billing and tax records.',
            'To respond to your questions and provide customer support and troubleshooting.',
            'To send you administrative messages about your account, billing, security, service changes, and updates to our terms or this policy — these are part of the Services rather than marketing.',
            'To send you product news or offers, where you have asked to receive them; you can unsubscribe at any time.',
            'To keep the Services secure — verifying identity, detecting and preventing fraud and abuse, investigating security incidents, and enforcing our terms.',
            'To maintain, analyze, and improve reliability, performance, and features, and to develop new ones.',
            'To comply with our legal obligations and to establish or defend legal claims.',
          ]} />
          <P>
            We do not sell Subscriber information. We do not use it for targeted advertising, and we do not use
            Customer Data to market anything to anyone.
          </P>
        </section>

        <section className="space-y-2">
          <H>4. When we disclose the information we collect</H>
          <P>We disclose information in these situations, and no others:</P>
          <List items={[
            <><strong>Vendors and service providers.</strong> To the providers that operate parts of the Services on our behalf, each under contract, each acting on our instructions, and each limited to its stated purpose: Google Cloud and Firebase (database hosting and authentication), Vercel (application hosting), Stripe (payment processing), Twilio (text message delivery), Resend (email delivery), and — only where a Subscriber connects them — Plaid (bank data) and Gusto (payroll).</>,
            <><strong>With your consent or at your direction.</strong> For example when you connect an integration, invite someone to your account, or ask us to share something on your behalf.</>,
            <><strong>Protection of {PLATFORM} and others.</strong> Where we believe in good faith it is necessary to protect or defend the rights, safety, or property of {PLATFORM}, our Subscribers, or others, or to enforce our terms.</>,
            <><strong>Legal process and authorities.</strong> Where required by applicable law, regulation, or legal process, such as a subpoena, warrant, or court order.</>,
            <><strong>Professional advisors.</strong> To our legal, accounting, insurance, and other advisors where necessary to obtain advice or manage our business.</>,
            <><strong>Business transfer.</strong> In connection with a merger, financing, or sale of all or part of our business — in which case this policy continues to apply to the information transferred.</>,
            <><strong>Aggregated or de-identified information.</strong> Information that cannot reasonably be used to identify you. We will not attempt to re-identify it.</>,
          ]} />
          <p className="text-sm leading-relaxed font-bold">
            All of the above categories exclude text messaging originator opt-in data and consent; this information
            will not be shared with any third parties.
          </p>
          <P>
            We do not disclose Customer Data to advertisers or data brokers, we do not disclose one Subscriber's data
            to another Subscriber, and we do not contact a Subscriber's clients, staff, or renters on our own
            initiative.
          </P>
        </section>

        <section className="space-y-2">
          <H>5. Cookies, analytics, and advertising</H>
          <P>
            We use only the cookies and local storage needed to keep you signed in, keep your session secure, and
            remember basic preferences. We do not run third-party advertising networks, ad pixels, or cross-site
            analytics on the Services, we do not participate in interest-based or cross-context behavioral
            advertising, and we do not sell or share personal information for those purposes — so there is no
            ad-targeting opt-out for you to exercise here. We honor recognized opt-out preference signals such as
            Global Privacy Control. If we ever add analytics or advertising technology, we will update this policy
            and provide the choices the law requires before doing so.
          </P>
        </section>

        <section className="space-y-3 rounded-2xl border-2 border-slate-200 bg-white p-4">
          <H>6. Text messages and mobile numbers</H>
          <P>
            The Services let a studio send service text messages to its own clients, staff, and renters —
            appointment confirmations and reminders, check-in and arrival updates, rent and maintenance notices,
            one-time sign-in codes, and secure links to a person's own record. The studio is the sender: it collects
            the consent, it decides what goes out, and it is responsible for complying with messaging law and carrier
            rules. We transmit those messages through a licensed messaging provider and record delivery status so the
            studio can prove a message was sent and can see when one failed.
          </P>
          <p className="text-sm leading-relaxed font-bold">
            We do not share, sell, or provide your mobile phone number or messaging consent data to third parties
            or affiliates for marketing or promotional purposes.
          </p>
          <P>
            Opt-out requests are honored automatically. When someone replies STOP, the platform records the opt-out
            and stops sending to that number, and that record is kept so the number is not messaged again by mistake.
            Message frequency varies by account activity, and message and data rates may apply. Mobile numbers and
            consent records are never used for advertising by us or by any provider we use; messaging and email
            providers act only on our instructions to deliver the studio's message and may not use the information
            for their own purposes.
          </P>
        </section>

        <section className="space-y-2">
          <H>7. Email delivery tracking</H>
          <P>
            Service emails sent through the Services may record whether the message was delivered, opened, or
            whether a link in it was clicked. This exists so a studio can confirm that a confirmation or reminder
            actually arrived and can correct a mistyped address. It is not used to profile recipients or to target
            advertising, and it is visible only to the studio that sent the message.
          </P>
        </section>

        <section className="space-y-2">
          <H>8. Your choices</H>
          <List items={[
            'Account information: you can review and update most of your account and business information by signing in.',
            'Marketing email: you can unsubscribe using the link in any marketing email. We will still send administrative messages about your account, billing, and changes to our terms or this policy.',
            'Text messages: reply STOP to any message to stop receiving texts at that number.',
            'Cookies: most browsers accept cookies by default and let you remove or block them. Blocking the cookies we use will prevent you from staying signed in.',
            'Closing your account: contact us and we will close it and delete your data as described in section 10.',
          ]} />
        </section>

        <section className="space-y-2">
          <H>9. Security</H>
          <P>
            Data is transmitted over encrypted connections and stored with reputable cloud providers. Access is
            controlled per studio and per role, administrative access is limited to those who need it, and the
            application writes an audit trail of sensitive changes. Portal, check-in, and appointment links are
            single-purpose and private to the person they were sent to. No system is perfectly secure; if a breach
            affects Subscriber information or Customer Data we will notify the affected Subscriber promptly and
            provide the detail that Subscriber needs to meet its own notification duties.
          </P>
        </section>

        <section className="space-y-2">
          <H>10. Data retention</H>
          <P>
            We keep information for as long as needed for the purposes described in this policy. While a subscription
            is active we keep Customer Data for as long as the Subscriber keeps it. After a subscription ends the
            Subscriber has a reasonable window to export its data, after which we delete or de-identify it, except
            where we must retain records by law or need them to resolve a dispute or enforce our agreements. Billing
            and tax records are kept for the periods the law requires. Records of a text-message opt-out are kept
            indefinitely so that number is never messaged again. Backups cycle out on a rolling schedule.
          </P>
        </section>

        <section className="space-y-2">
          <H>11. Children</H>
          <P>
            You must be at least 18 to use the Services. We do not knowingly collect personal information from
            children under 13, and we do not knowingly collect, sell, or share personal information about consumers
            under 16. A studio that records a minor's appointment is responsible for having the parent's or
            guardian's permission. If you believe a child has provided us information, contact us at{' '}
            {CONTACT_EMAIL} and we will delete it.
          </P>
        </section>

        <section className="space-y-2">
          <H>12. Links to other sites and services</H>
          <P>
            The Services may link to other websites or services, including the payment, banking, and payroll
            providers you choose to connect. We are not responsible for their content or practices, and the
            information you give them is governed by their privacy policies rather than this one. We encourage you to
            read them.
          </P>
        </section>

        <section className="space-y-3">
          <H>13. Additional information for residents of certain U.S. states</H>
          <P>
            Several states, including California, Virginia, Colorado, Connecticut, and Texas, give their residents
            specific privacy rights and require additional disclosures. If you are a resident of one of those states,
            this section applies to you. It describes our practices today and over the preceding twelve months.
          </P>

          <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 space-y-3">
            <div className="space-y-1.5">
              <H3>Categories of personal information we collect</H3>
              <List items={[
                'Identifiers — name, business name, postal address, email address, telephone number, account username.',
                'Commercial information — subscription and transaction records, services and prices you configure, bookings and rentals processed.',
                'Financial information — billing records, payout and bank connection details held by our payment processor.',
                'Internet or other electronic network activity — pages and features used, access times, error reports, audit-trail entries.',
                'Geolocation — approximate location inferred from IP address only; we do not collect precise device location.',
                'Audio, electronic, visual, or similar information — photographs you upload, and support chat or email transcripts.',
                'Professional or employment-related information — business contact details and professional or cosmetology license numbers you record.',
                'Inferences — limited inferences such as business type or approximate location, used for security and support.',
              ]} />
            </div>

            <div className="space-y-1.5">
              <H3>Categories of recipients</H3>
              <List items={[
                'Vendors and service providers (hosting, database, payment processing, message and email delivery, and any bank or payroll integration you connect).',
                'Law enforcement or others involved in legal proceedings, where required by law.',
                'Parties to whom disclosure is needed to protect the rights or safety of us or others.',
                'Professional advisors.',
                'A successor in connection with a business transfer.',
                'Anyone you consent to or direct us to share with.',
              ]} />
            </div>

            <div className="space-y-1.5">
              <H3>Purposes</H3>
              <P>
                Providing and servicing the Services; account authentication; customer support; billing and payment
                processing; security, fraud prevention, and incident investigation; auditing and error reporting;
                maintaining, improving, and developing the Services; internal research; legal compliance; and the
                other purposes described in section 3.
              </P>
            </div>

            <div className="space-y-1.5">
              <H3>Sale, sharing, and targeted advertising</H3>
              <P>
                We do not sell personal information, we do not share it for cross-context behavioral advertising, and
                we do not use it for targeted advertising. There is therefore no opt-out for you to submit. We also
                do not use or disclose sensitive personal information for the purpose of inferring characteristics
                about you.
              </P>
            </div>
          </div>

          <div className="space-y-1.5">
            <H3>Your rights</H3>
            <P>
              Depending on your state of residence you may have the right to know what personal information we hold
              about you and how we use and disclose it, to receive a copy of it, to correct it, to delete it, and to
              not be discriminated against for exercising any of these rights. To make a request, email{' '}
              <a className="underline font-bold" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the
              nature of your request. We will acknowledge it within the period the law allows and may need to verify
              your identity before acting; we may decline a request where the law permits, for example where a record
              must be retained.
            </P>
            <P>
              <strong>Appeals.</strong> If we deny your request you may appeal by replying to our decision and asking
              for a review. We will respond in writing with the outcome and our reasons. If you disagree with the
              result, you may contact the attorney general in the state where you reside.
            </P>
            <P>
              <strong>Authorized agents.</strong> An agent may submit a request on your behalf, but must provide
              proof of authority — such as a signed permission or a valid power of attorney — and we may also ask you
              to confirm the agent's authority directly.
            </P>
          </div>
        </section>

        <section className="space-y-2">
          <H>14. Non-U.S. users</H>
          <P>
            The Services are intended for use within the United States, and the platform and its data are hosted
            there. If you access the Services from outside the United States, you understand that your information
            will be transferred to and processed in the United States.
          </P>
        </section>

        <section className="space-y-2">
          <H>15. Updates to this policy</H>
          <P>
            We may change this policy to reflect changes in the law, in our practices, or in the Services. We will
            update the effective date above, and the current version will always live at this address. Where a change
            is material we will give Subscribers appropriate notice before it takes effect. By continuing to use the
            Services you confirm you have read the current version.
          </P>
        </section>

        <section className="space-y-2">
          <H>16. Contact us</H>
          <P>
            Questions about this policy or our practices:
          </P>
          <P>
            <strong>{LEGAL_ENTITY || PLATFORM}</strong><br />
            {BUSINESS_ADDRESS ? <>{BUSINESS_ADDRESS}<br /></> : null}
            {BUSINESS_PHONE ? <>{BUSINESS_PHONE}<br /></> : null}
            <a className="underline font-bold" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </P>
        </section>

        <footer className="pt-4 border-t text-[11px] font-bold text-slate-400 space-x-3">
          <span>{PLATFORM}</span>
          <a className="underline" href="/legal/terms">Platform Terms</a>
        </footer>
      </div>
    </div>
  );
}
