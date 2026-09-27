// src/app/school/[tenantId]/contact/page.tsx — book a tour, or ask a question.
import type { Metadata } from 'next';
import { getSite } from '../data';
import { Section } from '@/components/school/Site';
import { TourPicker, InquiryForm } from '@/components/school/Forms';
export const metadata: Metadata = { title: 'Contact & tours' };
export default async function Contact({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { tenantId } = await params; const q = await searchParams; const site = (await getSite(tenantId))!; const S = site.settings;
  const programs = site.programs.map((p) => ({ id: p.id, name: p.name }));
  return (
    <Section eyebrow="Contact" title={<>Visit us, or <b>just ask</b></>}>
      <div className="grid gap-8 lg:grid-cols-2">
        <div id="tour" className="space-y-3"><h2 className="text-2xl">Book a <b>tour</b></h2><p className="text-stone-600">See the classroom and student clinic, meet an instructor, and ask about programs, costs and funding.</p><TourPicker tenantId={tenantId} programs={programs} programId={q.program} /></div>
        <div className="space-y-3"><h2 className="text-2xl">Send a <b>message</b></h2><p className="text-stone-600">Short and simple — tell us how you’d like us to reach you.</p><InquiryForm tenantId={tenantId} programs={programs} topic={q.topic} programId={q.program} respondHours={S.contact.respondHours} textOk={S.contact.textOk} />
          <div className="flex flex-wrap gap-2 pt-2 text-sm">{site.phone && <a href={`tel:${site.phone}`} className="rounded-full bg-white px-4 py-2.5 shadow-sm">📞 {site.phone}</a>}{site.phone && S.contact.textOk && <a href={`sms:${site.phone}`} className="rounded-full bg-white px-4 py-2.5 shadow-sm">💬 Text us</a>}{site.email && <a href={`mailto:${site.email}`} className="rounded-full bg-white px-4 py-2.5 shadow-sm">✉️ {site.email}</a>}</div>
          {S.contact.hoursText && <p className="text-sm text-stone-600">🕐 {S.contact.hoursText}</p>}
        </div>
      </div>
    </Section>
  );
}
