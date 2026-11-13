// src/app/(app)/retail/page.tsx — THE OLD RETAIL REGISTER, RETIRED. Selling happens at the desk now (/pos: Counter, and
// "Add to this sale" in checkout), where a product with a barcode is added by its scan (lib/register-scan); old links
// and bookmarks land there.
import { redirect } from 'next/navigation';

export default function RetailPage() {
  redirect('/pos');
}
