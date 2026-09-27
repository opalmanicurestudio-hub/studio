'use client';
// src/components/academy/SchoolWebsite.tsx
//
// ACADEMY → WEBSITE — the school's public website (/school/{tenantId}).
// Programs, costs, dates, places left, instructors, clinic services and open
// jobs come from your records automatically; here you add the words, photos
// and choices only you can make. Tour times are the business's ONE tour
// schedule (booth tours use the same one).

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { DEFAULT_THANK_YOU } from '@/lib/donor-letters';
import { deviceId } from '@/lib/device';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const area = 'min-h-24 w-full rounded-xl border-2 border-border/60 bg-background p-3 text-sm';
const usd = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const TABS: [string, string][] = [['basics', 'Basics'], ['photos', 'Photos'], ['programs', 'Program costs'], ['stories', 'Stories & FAQ'], ['funding', 'Funding'], ['donors', 'Donors'], ['tours', 'Tours'], ['disclosures', 'Disclosures'], ['inbox', 'Inbox']];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A list of small records — defined out here so typing never loses focus. */
function ListEditor({ items, onChange, blank, fields, addLabel, max = 12 }: { items: any[]; onChange: (v: any[]) => void; blank: any; fields: [string, string, 'text' | 'area' | 'money' | 'date'][]; addLabel: string; max?: number }) {
  const set = (i: number, k: string, v: any) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="space-y-2">
      {items.map((x, i) => (
        <div key={i} className="space-y-1.5 rounded-xl bg-background p-2.5">
          {fields.map(([k, label, kind]) => (
            <label key={k} className="block text-[12px] font-bold">{label}
              {kind === 'area' ? <textarea className={area} value={x[k] || ''} onChange={(e) => set(i, k, e.target.value)} />
                : kind === 'money' ? <input className={field} inputMode="decimal" value={x[k] ? String(x[k] / 100) : ''} onChange={(e) => set(i, k, Math.round((Number(e.target.value.replace(/[^0-9.]/g, '')) || 0) * 100))} placeholder="0.00" />
                : <input className={field} type={kind === 'date' ? 'date' : 'text'} value={x[k] || ''} onChange={(e) => set(i, k, e.target.value)} />}
            </label>
          ))}
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-[12px] font-bold text-red-700">Remove</button>
        </div>
      ))}
      {items.length < max && <button type="button" onClick={() => onChange([...items, { ...blank }])} className="h-9 rounded-full bg-muted px-3 text-[12px] font-bold">+ {addLabel}</button>}
    </div>
  );
}
function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <section className="space-y-2 rounded-2xl bg-muted/40 p-4"><div><p className="font-black">{title}</p>{hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}</div>{children}</section>;
}
const shrink = (file: File, max = 1600) => new Promise<string>((res, rej) => { const img = new Image(); img.onload = () => { let w = img.width, h = img.height; const k = Math.min(1, max / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d')!.drawImage(img, 0, 0, w, h); let q = 0.82, out = c.toDataURL('image/jpeg', q); while (out.length > 580_000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); } res(out); }; img.onerror = () => rej(new Error('That isn’t an image we can read.')); img.src = URL.createObjectURL(file); });

export function SchoolWebsite({ tenantId }: { tenantId: string }) {
  const [d, setD] = useState<any>(null); const [s, setS] = useState<any>(null); const [tours, setTours] = useState<any>(null);
  const [tab, setTab] = useState('basics'); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [msgs, setMsgs] = useState<any[] | null>(null); const [prog, setProg] = useState('');
  const load = (r: any) => { if (r.ok) { setD(r); setS(r.settings); setTours(r.tours); setProg((p) => p || r.programs[0]?.id || ''); } else setErr(r.error || 'Couldn’t load.'); };
  useEffect(() => { api({ action: 'site-get', tenantId }).then(load); }, [tenantId]);
  useEffect(() => { if (tab === 'inbox' && !msgs) api({ action: 'site-messages', tenantId }).then((r) => setMsgs(r.ok ? r.messages : [])); }, [tab, msgs, tenantId]);
  if (!d || !s) return err ? <p className="text-sm text-red-700">{err}</p> : null;
  const set = (patch: any) => setS({ ...s, ...patch });
  const save = async (next = s, done = 'Saved.') => { setBusy(true); setErr(''); setMsg(''); const r = await api({ action: 'site-save', tenantId, settings: next }); setBusy(false); if (r.ok) { load(r); setMsg(done); } else setErr(r.error || 'Couldn’t save.'); };
  const img = (id: string) => `/api/school/image?t=${encodeURIComponent(tenantId)}&id=${id}`;
  const px = s.programExtras[prog] || { examFees: [], otherCosts: [], licensing: '', schedule: '' };
  const setPx = (patch: any) => set({ programExtras: { ...s.programExtras, [prog]: { ...px, ...patch } } });
  const pr = d.programs.find((p: any) => p.id === prog); const t = pr?.tuition || {};
  const schoolTotal = (t.tuitionCents || 0) + (t.registrationFeeCents || 0) + (t.kitCents || 0) + px.otherCosts.reduce((n: number, l: any) => n + (l.cents || 0), 0);
  const examTotal = px.examFees.reduce((n: number, l: any) => n + (l.cents || 0), 0);

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-foreground/10 p-4">
        <div className="min-w-0 flex-1"><p className="font-black">🌐 Your school website</p><p className="truncate text-[12px] text-muted-foreground">{d.siteUrl}</p></div>
        <a href={d.siteUrl} target="_blank" rel="noreferrer" className="h-10 rounded-full border-2 px-4 text-sm font-bold leading-9">Preview</a>
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(d.siteUrl); setMsg('Link copied.'); } catch { /* ignore */ } }} className="h-10 rounded-full border-2 px-4 text-sm font-bold">Copy link</button>
        <button type="button" disabled={busy} onClick={() => save({ ...s, published: !s.published }, s.published ? 'Unpublished — search engines are asked to skip it.' : 'Published! 🎉')} className={`h-10 rounded-full px-5 text-sm font-bold ${s.published ? 'bg-emerald-100 text-emerald-900' : 'bg-foreground text-background'}`}>{s.published ? '● Published' : 'Publish'}</button>
      </section>
      <p className="text-[12px] text-muted-foreground">Programs, full costs, start dates, places left, instructors (team members with the role “instructor”), clinic services, open jobs and featured student work come from your records automatically.</p>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-9 shrink-0 rounded-full px-3 text-[13px] font-bold ${tab === k ? 'bg-foreground text-background' : 'bg-muted'}`}>{l}{k === 'inbox' && d.newMessages ? ` · ${d.newMessages}` : ''}</button>)}</div>

      {tab === 'basics' && <>
        <Card title="Home page" hint="Your first impression — a clear promise and who it’s for.">
          <input className={field} value={s.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="e.g. Become a licensed nail technician in 9 months" aria-label="Headline" />
          <textarea className={area} value={s.message} onChange={(e) => set({ message: e.target.value })} placeholder="A few sentences about your school, your students and what makes you different." aria-label="Message" />
        </Card>
        <Card title="Why choose us" hint="Up to 6 short points."><ListEditor items={s.whyUs} onChange={(v) => set({ whyUs: v })} blank={{ title: '', text: '' }} fields={[['title', 'Title', 'text'], ['text', 'Text', 'area']]} addLabel="Point" max={6} /></Card>
        <Card title="Contact" hint="We tell visitors how quickly you’ll reply, and remind your team.">
          <label className="block text-[12px] font-bold">Reply within (hours)<input type="number" min={1} max={168} className={field} value={s.contact.respondHours} onChange={(e) => set({ contact: { ...s.contact, respondHours: Number(e.target.value) } })} /></label>
          <label className="block text-[12px] font-bold">Opening hours (shown on the site)<input className={field} value={s.contact.hoursText} onChange={(e) => set({ contact: { ...s.contact, hoursText: e.target.value } })} placeholder="Mon–Fri 9–5 · Sat 10–2" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.contact.textOk} onChange={(e) => set({ contact: { ...s.contact, textOk: e.target.checked } })} /> People can text us</label>
        </Card>
        <Card title="Location"><input className={field} value={s.location.directions} onChange={(e) => set({ location: { ...s.location, directions: e.target.value } })} placeholder="Directions (e.g. next to the library, 2nd floor)" aria-label="Directions" /><input className={field} value={s.location.parking} onChange={(e) => set({ location: { ...s.location, parking: e.target.value } })} placeholder="Parking" aria-label="Parking" /></Card>
        <Card title="Social">{(['instagram', 'facebook', 'tiktok'] as const).map((k) => <input key={k} className={field} value={s.social[k]} onChange={(e) => set({ social: { ...s.social, [k]: e.target.value } })} placeholder={`${k[0].toUpperCase() + k.slice(1)} (@name or link)`} aria-label={k} />)}</Card>
      </>}

      {tab === 'photos' && <Card title="Photos" hint="Real photos of your school, classroom and clinic. The first one is your main photo — tap ★ to change it. Photos are resized on your device.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{s.photos.map((ph: any) => <div key={ph.id} className="space-y-1 rounded-xl bg-background p-2">
          <img src={img(ph.id)} alt={ph.caption || 'School photo'} className="aspect-[4/3] w-full rounded-lg object-cover" />
          <input className={field} value={ph.caption} onChange={(e) => set({ photos: s.photos.map((x: any) => (x.id === ph.id ? { ...x, caption: e.target.value } : x)) })} placeholder="Caption" aria-label="Caption" />
          <div className="flex gap-1"><button type="button" onClick={() => set({ heroPhotoId: ph.id })} className={`h-8 flex-1 rounded-lg text-[12px] font-bold ${s.heroPhotoId === ph.id ? 'bg-foreground text-background' : 'border-2'}`}>{s.heroPhotoId === ph.id ? '★ Main photo' : '☆ Make main'}</button>
            <button type="button" onClick={async () => { if (!window.confirm('Remove this photo?')) return; setBusy(true); const r = await api({ action: 'site-image-remove', tenantId, id: ph.id }); setBusy(false); load(r); }} className="h-8 rounded-lg px-2 text-[12px] font-bold text-red-700">Remove</button></div>
        </div>)}</div>
        <label className="inline-flex h-10 cursor-pointer items-center rounded-full bg-foreground px-4 text-sm font-bold text-background">{busy ? 'Uploading…' : '+ Add photos'}<input type="file" accept="image/*" multiple className="hidden" onChange={async (e) => { const files = [...(e.target.files || [])]; e.target.value = ''; setBusy(true); setErr(''); for (const f of files) { try { const r = await api({ action: 'site-image-add', tenantId, dataUrl: await shrink(f) }); if (!r.ok) { setErr(r.error); break; } load(r); } catch (x: any) { setErr(x?.message || 'Couldn’t add that photo.'); } } setBusy(false); }} /></label>
      </Card>}

      {tab === 'programs' && (d.programs.length === 0 ? <p className="text-sm text-muted-foreground">Add a program first (Set up → Programs).</p> : <>
        <select className={field} value={prog} onChange={(e) => setProg(e.target.value)} aria-label="Program">{d.programs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <Card title="Other school costs" hint="Anything students pay the school beyond tuition, registration and kit (set those in Programs) — e.g. books, uniform."><ListEditor items={px.otherCosts} onChange={(v) => setPx({ otherCosts: v })} blank={{ label: '', cents: 0 }} fields={[['label', 'What', 'text'], ['cents', 'Amount ($)', 'money']]} addLabel="Cost" max={8} /></Card>
        <Card title="Exam and licence fees" hint="Paid to the licensing board, not the school — shown separately so the total is honest."><ListEditor items={px.examFees} onChange={(v) => setPx({ examFees: v })} blank={{ label: '', cents: 0 }} fields={[['label', 'What (e.g. State board exam)', 'text'], ['cents', 'Amount ($)', 'money']]} addLabel="Fee" max={8} /></Card>
        <Card title="Schedule and licensing"><textarea className={area} value={px.schedule} onChange={(e) => setPx({ schedule: e.target.value })} placeholder="e.g. Day classes Mon–Thu 9–3; evening option Tue/Thu 5–9 and Saturdays" aria-label="Schedule" /><textarea className={area} value={px.licensing} onChange={(e) => setPx({ licensing: e.target.value })} placeholder="e.g. Graduates are eligible to take the state board exam for a manicurist licence…" aria-label="Licensing" /></Card>
        <div className="rounded-2xl border-2 p-4 text-sm"><p className="font-black">What visitors will see</p>
          {!t.tuitionCents ? <p className="text-muted-foreground">No tuition set for this program yet (Set up → Programs → tuition). The site will say “Ask us for current costs”.</p> : <>
            <p>School costs: <b>{usd(schoolTotal)}</b>{examTotal ? <> · board fees: <b>{usd(examTotal)}</b></> : null}</p><p className="text-lg">Total cost: <b>{usd(schoolTotal + examTotal)}</b></p></>}
        </div>
      </>)}

      {tab === 'stories' && <>
        <Card title="Graduate stories" hint="Only share a graduate’s words and photo with their permission."><ListEditor items={s.stories} onChange={(v) => set({ stories: v })} blank={{ name: '', program: '', year: '', quote: '', photoId: null }} fields={[['name', 'Name (as they’d like it shown)', 'text'], ['program', 'Program', 'text'], ['year', 'Year', 'text'], ['quote', 'In their words', 'area']]} addLabel="Story" /></Card>
        <Card title="Common questions" hint="Shown on Admissions & costs."><ListEditor items={s.faq} onChange={(v) => set({ faq: v })} blank={{ q: '', a: '' }} fields={[['q', 'Question', 'text'], ['a', 'Answer', 'area']]} addLabel="Question" max={20} /></Card>
      </>}

      {tab === 'funding' && <>
        <p className="rounded-xl bg-amber-50 p-3 text-[12px] text-amber-900">The funding page always tells visitors that eligibility varies and funding isn’t guaranteed.</p>
        <Card title="Your scholarships"><ListEditor items={s.scholarships} onChange={(v) => set({ scholarships: v })} blank={{ name: '', amountCents: 0, description: '', eligibility: '', deadline: '', fund: '' }} fields={[['name', 'Name', 'text'], ['amountCents', 'Up to ($)', 'money'], ['description', 'About it', 'area'], ['eligibility', 'Who can apply', 'text'], ['deadline', 'Deadline', 'date'], ['fund', 'Paid from fund (a fund name from Donors — blank = General)', 'text']]} addLabel="Scholarship" /></Card>
        <Card title="Outside scholarships" hint="Only list ones you’ve checked. Update “last checked” when you re-check — it’s shown to visitors."><ListEditor items={s.outsideScholarships} onChange={(v) => set({ outsideScholarships: v })} blank={{ name: '', url: '', amount: '', notes: '', lastChecked: new Date().toISOString().slice(0, 10) }} fields={[['name', 'Name', 'text'], ['url', 'Link (https://…)', 'text'], ['amount', 'Amount (e.g. up to $1,000)', 'text'], ['notes', 'Notes', 'area'], ['lastChecked', 'Last checked', 'date']]} addLabel="Scholarship" max={20} /></Card>
        <Card title="Workforce funding"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.workforce.show} onChange={(e) => set({ workforce: { ...s.workforce, show: e.target.checked } })} /> Show a workforce funding section</label>{s.workforce.show && <textarea className={area} value={s.workforce.text} onChange={(e) => set({ workforce: { ...s.workforce, text: e.target.value } })} aria-label="Workforce funding text" />}</Card>
      </>}

      {tab === 'donors' && <>
        <Card title="Support our students page"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.donors.enabled} onChange={(e) => set({ donors: { ...s.donors, enabled: e.target.checked } })} /> Show a page for donors and business sponsors</label></Card>
        {s.donors.enabled && <>
          <Card title="What gifts support"><ListEditor items={s.donors.funds} onChange={(v) => set({ donors: { ...s.donors, funds: v } })} blank={{ name: '', text: '' }} fields={[['name', 'Fund', 'text'], ['text', 'What it does', 'area']]} addLabel="Fund" max={8} /></Card>
          <Card title="How awards are decided"><textarea className={area} value={s.donors.howAwarded} onChange={(e) => set({ donors: { ...s.donors, howAwarded: e.target.value } })} placeholder="e.g. A committee of two instructors and the director reviews requests monthly, using published criteria…" /></Card>
          <Card title="How gifts have been used" hint="Share totals and outcomes — never students’ names without permission."><textarea className={area} value={s.donors.useReport} onChange={(e) => set({ donors: { ...s.donors, useReport: e.target.value } })} /></Card>
          <Card title="Thank-you letter" hint="Emailed with the receipt after every gift, signed by your director with the school seal. Use {first}, {name}, {business}, {amount}, {fund}, {date} and {school} — they’re filled in for each donor.">
            <textarea className={`${area} min-h-48`} value={s.donors.thankYou || DEFAULT_THANK_YOU} onChange={(e) => set({ donors: { ...s.donors, thankYou: e.target.value } })} aria-label="Thank-you letter" />
            <button type="button" onClick={() => set({ donors: { ...s.donors, thankYou: '' } })} className="text-[12px] font-bold underline">Use the standard letter</button>
          </Card>
          <Card title="Sponsor wall" hint="Business donors can add their logo after giving; it appears once you approve it (Academy → Funding → Sponsors). Bigger supporters appear first and larger.">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.donors.logoOffer} onChange={(e) => set({ donors: { ...s.donors, logoOffer: e.target.checked } })} /> Offer business donors a place on the sponsor wall</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.donors.sponsorStrip} onChange={(e) => set({ donors: { ...s.donors, sponsorStrip: e.target.checked } })} /> Show a “Supported by” strip on the home page</label>
            <p className="text-[12px] font-bold">Tiers <span className="font-normal text-muted-foreground">— by total given</span></p>
            <ListEditor items={s.donors.tiers} onChange={(v) => set({ donors: { ...s.donors, tiers: v } })} blank={{ name: '', minCents: 0 }} fields={[['name', 'Tier name', 'text'], ['minCents', 'From ($)', 'money']]} addLabel="Tier" max={5} />
          </Card>
          <Card title="Tax status" hint="Gifts are only described as tax-deductible if the receiving organisation qualifies.">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.donors.nonprofit} onChange={(e) => set({ donors: { ...s.donors, nonprofit: e.target.checked } })} /> The organisation receiving gifts is a tax-exempt nonprofit (e.g. 501(c)(3))</label>
            {s.donors.nonprofit && <input className={field} value={s.donors.ein} onChange={(e) => set({ donors: { ...s.donors, ein: e.target.value } })} placeholder="EIN (e.g. 12-3456789)" aria-label="EIN" />}
            <p className="text-[12px] text-muted-foreground">{s.donors.nonprofit && s.donors.ein ? 'The page will say gifts may be tax-deductible to the extent allowed by law.' : 'The page will say gifts are not tax-deductible.'}</p>
          </Card>
        </>}
      </>}

      {tab === 'tours' && tours && <Card title="Tour times" hint="Your business’s one tour schedule — booth tours use the same times, so nothing is double-booked. Booked tours show on the planner and school tours land in Admissions.">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tours.toursEnabled} onChange={(e) => setTours({ ...tours, toursEnabled: e.target.checked })} /> Offer tours</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tours.tourAutoConfirm} onChange={(e) => setTours({ ...tours, tourAutoConfirm: e.target.checked })} /> Confirm tours automatically (off = you approve each one)</label>
        <div className="flex flex-wrap gap-1.5">{DAYS.map((l, i) => <button key={l} type="button" aria-pressed={tours.tourDays.includes(i)} onClick={() => setTours({ ...tours, tourDays: tours.tourDays.includes(i) ? tours.tourDays.filter((x: number) => x !== i) : [...tours.tourDays, i].sort() })} className={`h-9 w-12 rounded-lg text-[12px] font-bold ${tours.tourDays.includes(i) ? 'bg-foreground text-background' : 'border-2'}`}>{l}</button>)}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-[12px] font-bold">From<input type="time" className={field} value={tours.tourWindowStart} onChange={(e) => setTours({ ...tours, tourWindowStart: e.target.value })} /></label>
          <label className="text-[12px] font-bold">Until<input type="time" className={field} value={tours.tourWindowEnd} onChange={(e) => setTours({ ...tours, tourWindowEnd: e.target.value })} /></label>
          <label className="text-[12px] font-bold">Minutes each<input type="number" min={10} max={180} className={field} value={tours.tourDurationMins} onChange={(e) => setTours({ ...tours, tourDurationMins: Number(e.target.value) })} /></label>
          <label className="text-[12px] font-bold">Hours’ notice<input type="number" min={0} max={168} className={field} value={tours.bookingLeadHours} onChange={(e) => setTours({ ...tours, bookingLeadHours: Number(e.target.value) })} /></label>
        </div>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(''); const r = await api({ action: 'tour-settings-save', tenantId, tours }); setBusy(false); if (r.ok) { load(r); setMsg('Tour times saved.'); } else setErr(r.error); }} className="h-10 rounded-full bg-foreground px-5 text-sm font-bold text-background">Save tour times</button>
      </Card>}

      {tab === 'disclosures' && <Card title="Disclosures" hint="If your state or accreditor requires published information (e.g. completion, placement or licensure rates), put it here. Use # for headings and - for lists. A Disclosures link appears in the footer."><textarea className={`${area} min-h-60`} value={s.disclosures} onChange={(e) => set({ disclosures: e.target.value })} /></Card>}

      {tab === 'inbox' && <Card title="Website messages" hint="Donors, sponsors and general questions. Admissions, funding and scholarship questions go straight to Admissions.">
        {msgs === null ? <p className="text-sm text-muted-foreground">Loading…</p> : msgs.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet.</p> :
          msgs.map((m) => <div key={m.id} className={`space-y-1 rounded-xl p-3 text-sm ${m.status === 'done' ? 'bg-background opacity-60' : 'bg-background'}`}>
            <p><b>{m.name}</b> · {m.topic} · {new Date(m.createdAt).toLocaleString()}</p>
            <p className="text-[13px]">Prefers <b>{m.contactBy}</b>{m.bestTime ? ` (${m.bestTime})` : ''} · {[m.phone && <a key="p" href={`tel:${m.phone}`} className="underline">{m.phone}</a>, m.email && <a key="e" href={`mailto:${m.email}`} className="underline">{m.email}</a>].filter(Boolean).reduce((a: any[], x: any, i: number) => (i ? [...a, ' · ', x] : [x]), [])}</p>
            {m.message && <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">“{m.message}”</p>}
            <button type="button" onClick={async () => { const next = m.status === 'done' ? 'new' : 'done'; await api({ action: 'site-message-status', tenantId, id: m.id, status: next }); setMsgs(msgs.map((x) => (x.id === m.id ? { ...x, status: next } : x))); }} className="h-8 rounded-lg border-2 px-3 text-[12px] font-bold">{m.status === 'done' ? 'Reopen' : 'Mark handled'}</button>
          </div>)}
      </Card>}

      {err && <p className="text-sm text-red-700">{err}</p>}{msg && <p className="text-sm text-emerald-800">{msg}</p>}
      {!['tours', 'inbox'].includes(tab) && <button type="button" disabled={busy} onClick={() => save()} className="sticky bottom-3 h-11 rounded-full bg-foreground px-6 text-sm font-bold text-background shadow-lg disabled:opacity-40">{busy ? 'Saving…' : 'Save website'}</button>}
    </div>
  );
}
