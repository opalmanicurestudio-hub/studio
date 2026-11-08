// src/app/legal/sms/page.tsx — the text-message program terms every consent box links to. Each business on ClarityFlow
// is the sender of its own texts; this page says what the texts are, how often they come, what they can cost, and how
// to stop them, in the words carriers expect for a registered messaging program. It names no single business.
import Link from 'next/link';
import type { ReactNode } from 'react';

const PLATFORM = 'ClarityFlow';

export const metadata = {
  title: `Text message terms · ${PLATFORM}`,
  description: `How text messages from businesses that use ${PLATFORM} work: what they are, how often they come, and how to stop them.`,
};

const S = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-[17px] font-bold">{title}</h2>
    <div className="space-y-2 text-[15px] leading-[1.6]" style={{ color: '#3b3d42' }}>{children}</div>
  </section>
);

export default function SmsTermsPage() {
  return (
    <main className="min-h-screen bg-white px-5 py-10" style={{ color: '#16171a', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
      <div className="mx-auto max-w-[640px] space-y-7">
        <header className="space-y-2">
          <p className="text-[14px] font-semibold" style={{ color: '#6d7075' }}>{PLATFORM}</p>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">Text message terms</h1>
          <p className="text-[15px] leading-[1.6]" style={{ color: '#6d7075' }}>
            These terms cover text messages you agreed to receive from a business that runs its bookings, orders or
            memberships on {PLATFORM}. That business is the sender of its messages. {PLATFORM} is the software it uses
            to send them.
          </p>
        </header>

        <S title="What you’ll get">
          <p>Messages about your bookings, orders and account with that business: confirmations, reminders, changes,
            receipts, waitlist openings, and replies to messages you send. A business sends marketing texts only if you
            separately agreed to them.</p>
        </S>

        <S title="How often">
          <p>Message frequency varies with your bookings and account activity.</p>
        </S>

        <S title="Cost">
          <p>Message and data rates may apply, depending on your mobile plan.</p>
        </S>

        <S title="Stopping texts">
          <p>Reply STOP to any message to stop texts from that business. You may get one message confirming you’ve been
            unsubscribed. After that, that business won’t text you again unless you reply START to opt back in.</p>
          <p>Reply HELP for help. You can also ask the business directly through its booking page.</p>
        </S>

        <S title="Agreeing is optional">
          <p>Agreeing to texts is never a condition of booking or buying anything.</p>
        </S>

        <S title="Delivery">
          <p>Mobile carriers are not liable for delayed or undelivered messages. Delivery depends on networks outside
            the business’s and {PLATFORM}’s control.</p>
        </S>

        <S title="Your information">
          <p>Your phone number and consent are used only to send the messages described here, and are never sold or
            shared with others for their marketing. See the <Link className="underline" href="/legal/privacy">privacy
            policy</Link> for how information is handled.</p>
        </S>
      </div>
    </main>
  );
}
