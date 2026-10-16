'use client';
// Settings → Links & embeds — for businesses with their own website: the booking link, a paste-in Book button, and a
// live menu that never goes stale. Everything here opens the same booking flow; bookings carry "website" as their channel.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { SettingsPage, Section, Row, Toggle } from '@/components/settings/settings-ui';
import { useFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { agentPolicy, assistantAddon } from '@/lib/agent-access';
import { klairSettings } from '@/lib/klair';
import { bookingLink } from '@/lib/share-links';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function Snippet({ code, label }: { code: string; label: string }) {
  const [done, setDone] = React.useState(false);
  return (<div className="space-y-2">
    <pre className="overflow-x-auto rounded-2xl p-4 text-[13px] leading-relaxed" style={{ background: 'var(--soft)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} aria-label={label}>{code}</pre>
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setDone(true); setTimeout(() => setDone(false), 1800); } catch { window.prompt('Copy this', code); } }} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{done ? 'Copied' : `Copy the ${label}`}</button>
  </div>);
}

export default function EmbedsPage() {
  const { selectedTenant } = useTenant(); const { services } = useInventory(); const tenantId = selectedTenant?.id || ''; const { firestore } = useFirebase() as any;
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : ''; const bookOrigin = (selectedTenant as any)?.publicOrigin || appOrigin;
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light'); const [layout, setLayout] = React.useState<'list' | 'cards'>('list'); const [cats, setCats] = React.useState<string[]>([]); const [svc, setSvc] = React.useState('');
  const categories = React.useMemo(() => Array.from(new Set((services || []).filter((s: any) => s.status !== 'archived' && !s.isPrivate && s.type !== 'addon').map((s: any) => String(s.category || 'Services')))).sort(), [services]);
  const bookable = (services || []).filter((s: any) => s.status !== 'archived' && !s.isPrivate && s.type !== 'addon');
  const script = `<script src="${appOrigin}/embed.js" data-business="${tenantId}"></script>`;
  const button = `${script}\n<a class="cf-book"${svc ? ` data-service="${svc}"` : ''} href="${bookingLink(bookOrigin, tenantId, { serviceId: svc || null, src: 'website' })}">Book now</a>`;
  const menu = `${script}\n<div data-cf-menu data-theme="${theme}" data-layout="${layout}"${cats.length ? ` data-categories="${esc(cats.join(','))}"` : ''}></div>`;
  const previewRef = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(() => { const f = previewRef.current; if (!f) return; f.srcdoc = `<!doctype html><html><body style="margin:16px;background:${theme === 'dark' ? '#1c1917' : '#fff'}">${menu.replace(script, `<script src="${appOrigin}/embed.js" data-business="${tenantId}"></script>`)}</body></html>`; }, [menu, script, theme, appOrigin, tenantId]);
  return (
    <SettingsPage title="Links & embeds" help="Keep your own website and let people book from it. The button and the menu open the same booking flow, in an overlay on your page, and bookings made this way show as “website” in Reports.">
      <Section title="Your booking link">
        <Row label="Front door" help="For your Google Business Profile (“Book online”), Instagram bio and emails. Add a service, category or provider link from the Services page’s row menu.">
          <code className="break-all text-[14px]">{bookingLink(bookOrigin, tenantId, {})}</code>
        </Row>
        <Row label="Gift cards" help={(selectedTenant as any)?.giftCardSettings?.online ? 'Where anyone can buy a gift card — add it to your website menu, Instagram bio and Google profile.' : 'Turn on selling online in Gift cards → Online shop & designs, then share this link.'}>
          <code className="break-all text-[14px]">{`${bookOrigin.replace(/\/+$/, '')}/gift/${encodeURIComponent(tenantId)}`}</code>
        </Row>
      </Section>
      <Section title="A Book button for your website" help="Paste this where you want the button — Squarespace, Wix, WordPress and Shopify all accept a code block. Style it however you like; the class “cf-book” is what makes it work.">
        <Row label="Which service?" help="Leave it blank for a button that opens your whole menu."><select value={svc} onChange={(e) => setSvc(e.target.value)} className="h-11 rounded-xl border px-3 text-[15px]" style={{ borderColor: 'var(--line)' }}><option value="">Any service — opens the menu</option>{bookable.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Row>
        <Snippet code={button} label="button code" />
      </Section>
      <Section title="Your live menu on your website" help="Shows your current services, prices and lengths, straight from here. Change a price or hide a service, and every website using it updates. Each service gets a Book button.">
        <Row label="Look" inline><select value={theme} onChange={(e) => setTheme(e.target.value as any)} className="h-11 rounded-xl border px-3 text-[15px]" style={{ borderColor: 'var(--line)' }}><option value="light">Light background</option><option value="dark">Dark background</option></select>
          <select value={layout} onChange={(e) => setLayout(e.target.value as any)} className="ml-2 h-11 rounded-xl border px-3 text-[15px]" style={{ borderColor: 'var(--line)' }}><option value="list">List</option><option value="cards">Cards with photos</option></select></Row>
        <Row label="Categories" help="None selected = all of them."><div className="flex flex-wrap gap-2">{categories.map((c) => <button key={c} type="button" aria-pressed={cats.includes(c)} onClick={() => setCats((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={cats.includes(c) ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)' }}>{c}</button>)}</div></Row>
        <Snippet code={menu} label="menu code" />
        <Row label="Preview" help="How it will look on a plain page. Your site’s fonts and colours apply on your site."><iframe ref={previewRef} title="Menu preview" className="h-96 w-full rounded-2xl border" style={{ borderColor: 'var(--line)' }} /></Row>
      </Section>
      <Section id="assistants" title="AI assistants" help="More people ask an assistant to find and book things for them. These let an assistant read your menu and open times, the same facts as your booking page, so it can point clients to you.">
        {(() => { const t: any = selectedTenant || {}; const p = agentPolicy(t); const addon = assistantAddon(t);
          const save = (k: string, v: any) => { if (!firestore || !tenantId) return; void updateDoc(doc(firestore, 'tenants', tenantId), { [`agents.${k}`]: v }).catch(() => {}); };
          return (<>
            <Row label="Let assistants see my menu and open times" help="Free. Services, prices, lengths, team and policies, plus real open times. Never who else is booked or anything about your clients."><Toggle checked={p.menu} onChange={(v) => save('menu', v)} label="Let assistants see my menu and open times" /></Row>
            <Row label="Let assistants hold a time for a client" help={addon ? `The client gets one text to confirm it themselves; the time is held for ${p.holdMinutes} minutes and nothing is booked or charged until they do. Consultation, request-only and members-only services are never held.` : 'Part of the ClarityFlow Assistant add-on.'}><Toggle checked={p.holds} disabled={!addon || !p.menu} onChange={(v) => save('holds', v)} label="Let assistants hold a time for a client" /></Row>
            <Row label={`Your own assistant: ${klairSettings(t).name}`} help={addon ? 'Talk or type to her from any screen: move visits, ask clients to confirm, send links, book again. Money always waits for your OK.' : 'Part of the ClarityFlow Assistant add-on.'}><Toggle checked={klairSettings(t).on} disabled={!addon} onChange={(v) => { if (!firestore || !tenantId) return; void updateDoc(doc(firestore, 'tenants', tenantId), { 'klair.enabled': v }).catch(() => {}); }} label="Turn the assistant on" /></Row>
            {addon && <>
              <Row label="Her name" help="Call her anything. She listens for this name too."><input defaultValue={klairSettings(t).name} maxLength={24} onBlur={(e) => { const v = e.target.value.trim(); if (firestore && tenantId) void updateDoc(doc(firestore, 'tenants', tenantId), { 'klair.name': v || null }).catch(() => {}); }} aria-label="Assistant name" className="h-11 w-48 rounded-xl border px-3 text-[15px]" style={{ borderColor: 'var(--line)' }} /></Row>
              <Row label="Her voice" help="Used for short spoken replies when someone talks to her."><span className="flex flex-wrap items-center gap-2">
                <select defaultValue={klairSettings(t).voice} onChange={(e) => { if (firestore && tenantId) void updateDoc(doc(firestore, 'tenants', tenantId), { 'klair.voice': e.target.value }).catch(() => {}); }} aria-label="Assistant voice" className="h-11 rounded-xl border px-3 text-[15px]" style={{ borderColor: 'var(--line)' }}><option value="warm">Warm</option><option value="bright">Bright</option><option value="calm">Calm</option></select>
                <button type="button" onClick={() => { try { const u = new SpeechSynthesisUtterance(`Hi, I'm ${klairSettings(t).name}. Sam Patel, moving to Thursday at 3. Shall I?`); window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch { /* no voice */ } }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Hear her</button></span></Row>
              <Row label="Speak replies" help="Off: she answers on screen only. She never says money amounts or private notes out loud."><Toggle checked={klairSettings(t).speak} onChange={(v) => { if (firestore && tenantId) void updateDoc(doc(firestore, 'tenants', tenantId), { 'klair.speak': v }).catch(() => {}); }} label="Speak replies" /></Row>
            </>}
            <Row label="Where assistants look" help="Share these if someone asks how assistants can book with you."><div className="space-y-1 text-[14px]"><code className="block break-all">{`${appOrigin}/book/${tenantId}/llms.txt`}</code><code className="block break-all">{`${appOrigin}/api/agents/${tenantId}`}</code></div></Row>
          </>); })()}
      </Section>
      <Section title="Good to know">
        <ul className="list-disc space-y-1 pl-5 text-[14px]">
          <li>Hidden services, members-only rules and deposits work exactly as on your booking page.</li>
          <li>Renters’ services aren’t included — they share their own page.</li>
          <li>Open-in-new-tab and middle-click still work: every button is a real link.</li>
          <li>If a site blocks the overlay, the button opens the booking page in a new tab instead.</li>
        </ul>
      </Section>
    </SettingsPage>);
}
