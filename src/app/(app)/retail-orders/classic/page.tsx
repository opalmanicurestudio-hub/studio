// src/app/(app)/retail-orders/classic/page.tsx
// The previous orders board. Everything it did is on the orders screen and inside each order now; old links and
// bookmarks land there.
import { redirect } from 'next/navigation';

export default function ClassicRedirect() {
  redirect('/retail-orders');
}
