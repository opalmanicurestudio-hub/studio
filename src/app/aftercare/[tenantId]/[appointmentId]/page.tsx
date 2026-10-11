// src/app/aftercare/[tenantId]/[appointmentId]/page.tsx — A CLIENT'S AFTERCARE FOR ONE VISIT (approved design, canvas
// row 23 "the same blocks for clients"). The business, "After your {service} · from {provider}", then the aftercare
// document's blocks (lib/aftercare) — or the older plain-text aftercare. When the business uses Making it right, a
// "something not right?" box leads to the visit's "How was your visit?" page. Opened by the signed link in the thank-you
// message (?k=) or from the visit link (?t=, the visit's check-in token). Shows first names and the service only.
import { getAdminDb } from '@/lib/firebase-admin';
import { feedbackVisit, feedbackPath, visitAftercare } from '@/lib/visit-feedback';
import { settingsOf, aftercareFor } from '@/lib/making-it-right';
import { brandAccent } from '@/lib/brand-accent';
import { AftercareView } from '@/components/documents/AftercareView';

export const dynamic = 'force-dynamic';
const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const font = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK, letterSpacing: '-0.01em' } as const;
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';

export default async function AftercarePage({ params, searchParams }: { params: Promise<{ tenantId: string; appointmentId: string }>; searchParams: Promise<{ k?: string; t?: string }> }) {
  const { tenantId, appointmentId } = await params; const sp = await searchParams;
  const db = getAdminDb(); const v = await feedbackVisit(db, tenantId, appointmentId, sp.k || null, sp.t || null);
  const shell = (body: React.ReactNode) => <div style={{ ...font, background: '#f7f7f8', minHeight: '100vh' }}><div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 20px 60px' }}>{body}</div></div>;
  if (!v) return shell(<div style={{ paddingTop: 40 }}><p style={{ fontSize: 20 }}>This link isn’t valid.</p><p style={{ color: MUTED }}>Use the link in your message, or ask us for a new one.</p></div>);
  const a = v.a; const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const prov: any = a.staffId ? (await db.doc(`tenants/${tenantId}/staff/${a.staffId}`).get()).data() || null : null;
  const isRenterVisit = !!prov && (prov.isRenter === true || prov.role === 'renter');
  const care = await visitAftercare(db, tenantId, a, tenant, isRenterVisit, isRenterVisit ? '' : (tenant.makingItRight ? aftercareFor(settingsOf(tenant), a.serviceId) : ''));
  const accent = brandAccent(tenant); const name = String(tenant.name || tenant.businessName || 'Your visit'); const logo = tenant.logoUrl || tenant.logo || null;
  const mir = !isRenterVisit && !!tenant.makingItRight && tenant.makingItRight?.channels?.survey !== false;
  const howHref = mir ? (sp.k ? feedbackPath(tenantId, appointmentId) : `/how/${tenantId}/${appointmentId}?t=${encodeURIComponent(String(sp.t || ''))}`) : '';
  const service = String(a.serviceName || 'your visit'); const from = first(a.staffName);
  return <AftercareView name={name} logo={logo} accent={accent} service={service} from={from} doc={care.doc} text={care.text} howHref={howHref}
    bookHref={!isRenterVisit && a.serviceId ? `/book/${tenantId}?service=${encodeURIComponent(String(a.serviceId))}` : ''} />;
}
