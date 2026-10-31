// src/app/(app)/retail-orders/support/page.tsx — THE OLD MESSAGE INBOX, RETIRED. Every customer message about an order
// (from their order page, a reply by email, or a text, lib/order-texts) is answered in Problems under Messages and on
// the order itself, where store credit for the trouble (lib/goodwill-credit), reply drafts and the team's notes about a
// customer (components/orders/CustomerFlag) now live; old links and bookmarks land there.
import { redirect } from 'next/navigation';

export default function SupportPage() {
  redirect('/retail-orders/problems?show=messages');
}
