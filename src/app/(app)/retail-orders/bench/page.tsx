// src/app/(app)/retail-orders/bench/page.tsx
// Packing happens inside each order now (components/orders/workspace): scan the tote or the slip on the orders screen
// and it opens ready to pack, with the second scan at the box when the shop asks for it. Old links and bookmarks land
// there.
import { redirect } from 'next/navigation';

export default function BenchRedirect() {
  redirect('/retail-orders');
}
