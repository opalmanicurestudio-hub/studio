import { redirect } from 'next/navigation';

// ─── /print/product-labels/[tenantId]?ids=a,b,c ───────────────────────────────
// Product labels are printed from Inventory now (/inventory/labels): a barcode a laser scanner reads next to the QR
// code, at a label size that fits the sheet or the label printer, with the price the shop charges. An old link opens
// that page with the same products.

export const dynamic = 'force-dynamic';

export default async function ProductLabelsPage({ searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<{ ids?: string }> }) {
  const { ids } = await searchParams;
  const list = String(ids || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,160}$/.test(s)).slice(0, 200);
  redirect(list.length ? `/inventory/labels?ids=${list.map(encodeURIComponent).join(',')}` : '/inventory/labels');
}
