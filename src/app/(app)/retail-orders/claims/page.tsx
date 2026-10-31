// src/app/(app)/retail-orders/claims/page.tsx — THE OLD CLAIMS PAGE, RETIRED. Problem reports are decided in Problems
// now, beside everything else about the order (components/orders/ClaimCard); old links and bookmarks land there.
import { redirect } from 'next/navigation';

export default function ClaimsPage() {
  redirect('/retail-orders/problems?show=claims');
}
