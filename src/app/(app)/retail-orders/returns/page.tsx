// src/app/(app)/retail-orders/returns/page.tsx — THE OLD RETURN DESK, RETIRED. A return is started on the order itself
// (components/orders/StartReturnSheet) and checked in from there or from Problems, where returns on their way back are
// listed; old links and bookmarks land there.
import { redirect } from 'next/navigation';

export default function ReturnsPage() {
  redirect('/retail-orders/problems?show=returns');
}
