// src/app/aftercare/[tenantId]/[appointmentId]/page.tsx — A CLIENT'S AFTERCARE FOR ONE VISIT (approved design, canvas
// row 23 "the same blocks for clients"). The business, "After your {service} · from {provider}", then the aftercare
// document's blocks (lib/aftercare) — or the older plain-text aftercare. When the business uses Making it right, a
// "something not right?" box leads to the visit's "How was your visit?" page. Opened by the signed link in the thank-you
// message (?k=) or from the visit link (?t=, the visit's check-in token). Shows first names and the service only.
import { getAdminDb } from '@/lib/firebase-admin';
import { feedbackVisit, feedbackPath, visitAftercare } from '@/lib/visit-feedback';
import { settingsOf, aftercareFor } from '@/lib/making-it-right';
import { brandAccent } from '@/lib/brand-accent';
import { rebookSettingsOf } from '@/lib/client-screen';
import { aftercareSettingsOf, productsUsed, providerNoteOf, rebookWeeksOf } from '@/lib/aftercare';
import { AftercareView } from '@/components/documents/AftercareView';
import { renterBrand } from '@/lib/renter-aftercare';
import { renterCareSettings } from '@/lib/renter-docs';

export const dynamic = 'force-dynamic';
const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const font = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK, letterSpacing: '-0.01em' } as const;
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';

export default async function AftercarePage({ params, searchParams }: { params: Promise<{ tenantId: string; appointmentId: string }>; searchParams: Promise<{ k?: string; t?: string; c?: string; lang?: string; by?: string }> }) {
  const { tenantId, appointmentId } = await params; const sp = await searchParams;
  const db = getAdminDb(); const v = await feedbackVisit(db, tenantId, appointmentId, sp.k || null, sp.t || null);
  const shell = (body: React.ReactNode) => <div style={{ ...font, background: '#f7f7f8', minHeight: '100vh' }}><div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 20px 60px' }}>{body}</div></div>;
  if (!v) return shell(<div style={{ paddingTop: 40 }}><p style={{ fontSize: 20 }}>This link isn’t valid.</p><p style={{ color: MUTED }}>Use the link in your message, or ask us for a new one.</p></div>);
  { const { stampLinkView } = await import('@/lib/link-views'); await stampLinkView(v.ref, v.a, 'aftercare', { staff: (sp as any).by === 'desk' }); }
  const a = v.a; const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const prov: any = a.staffId ? (await db.doc(`tenants/${tenantId}/staff/${a.staffId}`).get()).data() || null : null;
  const isRenterVisit = !!prov && (prov.isRenter === true || prov.role === 'renter');
  // The business's choices (Settings → Aftercare); a renter's visit follows the renter (their own portal).
  const S = aftercareSettingsOf(tenant); const on = isRenterVisit || S.on;
  const care = on ? await visitAftercare(db, tenantId, a, tenant, isRenterVisit, isRenterVisit ? '' : (tenant.makingItRight ? aftercareFor(settingsOf(tenant), a.serviceId) : '')) : { doc: null, text: null };
  // In another language, when the client picks one (translated once per document version, then kept).
  let shown = care; if (sp.lang) { try { const { translatedAftercare } = await import('@/lib/aftercare-translate'); shown = (await translatedAftercare(db, tenantId, care, String(sp.lang))) || care; } catch { shown = care; } }
  const langBase = `/aftercare/${tenantId}/${appointmentId}?${sp.k ? `k=${encodeURIComponent(String(sp.k))}` : `t=${encodeURIComponent(String(sp.t || ''))}`}${sp.c === '1' ? '&c=1' : ''}`;
  // A renter's client sees the renter's business, not the studio's.
  const rb = isRenterVisit ? await renterBrand(db, tenantId, prov) : null;
  const RS = isRenterVisit && a.staffId ? await renterCareSettings(db, tenantId, String(a.staffId)) : null;
  const accent = brandAccent(tenant); const name = rb ? rb.name : String(tenant.name || tenant.businessName || 'Your visit'); const logo = rb ? rb.logo : tenant.logoUrl || tenant.logo || null;
  const mir = !isRenterVisit && !!tenant.makingItRight && tenant.makingItRight?.channels?.survey !== false;
  const visitQ = sp.k ? `k=${encodeURIComponent(String(sp.k))}` : `t=${encodeURIComponent(String(sp.t || ''))}`;
  const howHref = mir ? (sp.k ? feedbackPath(tenantId, appointmentId) : `/how/${tenantId}/${appointmentId}?${visitQ}`) : '';
  const service = String(a.serviceName || 'your visit'); const from = first(a.staffName);
  const tz = tenant.timezone || 'America/New_York';
  const when = a.startTime ? new Date(a.startTime).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz }) : '';
  const svc: any = a.serviceId ? (await db.doc(`tenants/${tenantId}/services/${a.serviceId}`).get()).data() || null : null; const weeks = rebookWeeksOf(svc);
  const note = (isRenterVisit ? !!RS?.providerNote : S.providerNote) && providerNoteOf(a) ? { text: providerNoteOf(a)!, by: first(a.aftercareNote?.byName) || from || null } : null;
  const used = (isRenterVisit ? !!RS?.showProducts : S.showProducts) ? productsUsed(a) : [];
  // Take home: shop products this service uses that the online shop sells (studio visits only, when the shop is on).
  let takeHome: { name: string; price: number; href: string; image?: string | null }[] = [];
  if (!isRenterVisit && svc && Array.isArray(svc.products) && svc.products.length) { try { const { moduleEnabled } = await import('@/lib/modules'); if (moduleEnabled(tenant, 'retail')) {
    const { isStorefrontVisible } = await import('@/lib/retail-orders');
    const { choiceFor, variantPriceCents } = await import('@/lib/variants');
    const read = async (id: string) => { const d = await db.doc(`tenants/${tenantId}/inventory/${id}`).get(); return d.exists ? { id: d.id, ...(d.data() || {}) } as any : null; };
    const items = (await Promise.all(svc.products.slice(0, 12).map((p: any) => (p?.id ? read(String(p.id)) : null)))).filter(Boolean);
    // A variant (the exact one this service used, say) is offered inside its listing, with it picked, at the price it sells
    // for (lib/variants); anything else the shop sells on its own, at its price.
    const offers = await Promise.all(items.map(async (it: any) => {
      if (it.type !== 'retail' || it.status === 'archived') return null;
      const parent = it.parentId && it.parentId !== it.id ? await read(String(it.parentId)) : null;
      const c = parent ? choiceFor(parent, it.id) : null;
      if (parent && c) return isStorefrontVisible(parent) ? { name: `${String(parent.name || 'Product')} \u00b7 ${c.choice.label}`, price: variantPriceCents(it, parent) / 100, href: `/shop/${tenantId}/product/${parent.id}?choice=${encodeURIComponent(c.choice.id)}`, image: it.imageUrl || (Array.isArray(it.imageUrls) && it.imageUrls[0]) || parent.imageUrl || (Array.isArray(parent.imageUrls) && parent.imageUrls[0]) || null } : null;
      return isStorefrontVisible(it) ? { name: String(it.name || 'Product'), price: Number(it.msrp) || 0, href: `/shop/${tenantId}/product/${it.id}`, image: it.imageUrl || (Array.isArray(it.imageUrls) && it.imageUrls[0]) || it.image || null } : null;
    }));
    takeHome = offers.filter(Boolean).slice(0, 4) as any; } } catch { takeHome = []; } }
  const photo = (Array.isArray(a.afterPhotoUrls) ? a.afterPhotoUrls : []).find((u: any) => typeof u === 'string' && /^https:\/\//.test(u)) || null;
  const checkIn = sp.c === '1' || a.checkInSentAt ? { tenantId, appointmentId, k: sp.k, t: sp.t, answered: a.aftercareCheckIn?.answer || null,
    reportHref: mir ? `/how/${tenantId}/${appointmentId}?${visitQ}&start=report` : '' } : null;
  return <AftercareView name={name} logo={logo} accent={accent} service={service} from={from} when={when} doc={shown.doc} text={shown.text} langBase={(care.doc || care.text) ? langBase : null} lang={String(sp.lang || '')} howHref={howHref} note={note} used={used} takeHome={takeHome} photo={photo} checkIn={sp.c === '1' ? checkIn : null}
    bookLabel={weeks ? `Book again in ${weeks} week${weeks === 1 ? '' : 's'}` : undefined}
    rebookToken={!isRenterVisit && a.checkInToken && a.status === 'completed' && rebookSettingsOf(tenant).on && rebookSettingsOf(tenant).visitLink ? String(a.checkInToken) : null}
    bookHref={!isRenterVisit && a.serviceId ? `/book/${tenantId}?service=${encodeURIComponent(String(a.serviceId))}` : ''} />;
}
