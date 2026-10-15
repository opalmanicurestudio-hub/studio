'use client';
// src/components/visit/VerifyCard.tsx — "IS THIS YOU?" on the client's visit link (and after booking online).
// A link proves only that someone has the link. Before anything private opens (the message thread, notifications,
// moving on to their next appointment, or a visit whose contact details are over a year old), the client confirms a
// 6-digit code sent to the phone or email on their record. This phone is then trusted for 90 days (lib/client-verify).
// Everything goes through /api/appt: verify_status → verify_start → verify_check, and not_me for "Not you?".
// Also here: the phone's own id (one per browser, sent with every private request), the "Not you?" link with its
// confirm sheet, and the calm full-page notices for a link that has been turned off.
import * as React from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', RED = '#b42318';
const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
const RESEND_AFTER = 30;

// ── This phone's id ───────────────────────────────────────────────────────────
// One id per browser, kept on the phone. Once a code is confirmed the server trusts this id for 90 days.
const DEVICE_KEY = 'cf_visit_device';
let memoryDevice = '';
const newId = () => {
  try { if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') return (crypto as any).randomUUID() as string; } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};
const clean = (s: any) => String(s || '').replace(/[^\w-]/g, '').slice(0, 80);
/** This phone's id for visit links (created the first time it's needed). */
export function visitDevice(): string {
  if (typeof window === 'undefined') return '';
  let id = '';
  try { id = clean(localStorage.getItem(DEVICE_KEY)); } catch { /* private mode */ }
  if (!id) id = memoryDevice;
  if (!id) { id = clean(newId()); try { localStorage.setItem(DEVICE_KEY, id); } catch { /* private mode: this visit only */ } }
  memoryDevice = id;
  return id;
}
/** After a code is confirmed: keep the id the server trusted, so they always match. */
export function saveVisitDevice(id: any) {
  const v = clean(id); if (!v) return;
  memoryDevice = v;
  try { localStorage.setItem(DEVICE_KEY, v); } catch { /* private mode */ }
}

type Link = { tenantId: string; apptId: string; k: string };
type Res = { ok?: boolean; error?: string; code?: string; [key: string]: any };
/** One /api/appt call with this page's link and this phone's id. A turned-off link is reported through onRevoked. */
export async function visitCall(link: Link, payload: any, onRevoked?: () => void): Promise<Res> {
  try {
    const r = await fetch('/api/appt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: link.tenantId, apptId: link.apptId, k: link.k, device: visitDevice(), ...payload }) });
    const d: Res = await r.json().catch(() => ({ ok: false }));
    if (d?.code === 'revoked') onRevoked?.();
    return d || { ok: false };
  } catch { return { ok: false, error: 'We couldn’t connect. Please check your connection and try again.' }; }
}

const platformOf = () => { if (typeof navigator === 'undefined') return 'Other'; const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) ? 'iPhone' : /Android/i.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : 'Other'; };
const telOf = (p?: string | null) => String(p || '').replace(/[^\d+]/g, '');

// ── Small pieces in the visit look ────────────────────────────────────────────
const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: 18, border: `1px solid ${LINE}`, color: INK, fontFamily: FONT, boxShadow: '0 1px 2px rgba(22,23,26,.04)' };
function Pill({ children, onClick, disabled, tone = 'solid', type = 'button' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'solid' | 'soft' | 'danger'; type?: 'button' | 'submit' }) {
  const style: React.CSSProperties = tone === 'solid' ? { background: INK, color: '#fff' } : tone === 'danger' ? { background: RED, color: '#fff' } : { background: SOFT, color: INK };
  return <button type={type} onClick={onClick} disabled={disabled} className="inline-flex min-h-12 w-full items-center justify-center rounded-full px-6 py-3 text-[15px] font-semibold transition active:scale-[.98] disabled:opacity-50" style={style}>{children}</button>;
}
const Muted = ({ children }: { children: React.ReactNode }) => <p className="text-[14px] leading-relaxed" style={{ color: MUTED }}>{children}</p>;
const ErrorLine = ({ text }: { text: string }) => text ? <p className="text-[14px]" role="alert" style={{ color: RED }}>{text}</p> : null;
const TextLink = ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="text-[14px] underline underline-offset-4 disabled:no-underline disabled:opacity-60" style={{ color: MUTED }}>{children}</button>
);

// ── "Is this you?" ─────────────────────────────────────────────────────────────
type Option = { channel: 'sms' | 'email'; label: string };
type Stage = 'checking' | 'prompt' | 'choose' | 'code' | 'done' | 'none' | 'failed';

export type VerifyCardProps = Link & {
  /** Heading on the card. */
  title?: string;
  /** One line under the heading. */
  intro?: string;
  /** Start as a short prompt with a button (an optional step); the code is only sent once they tap it. */
  prompt?: { title: string; text: string; button: string };
  /** Only offer these ways to send the code (e.g. ['sms'] for "Confirm your number"). */
  channels?: ('sms' | 'email')[];
  /** Called once this phone is confirmed (or already was). Reload the private thing here. */
  onVerified: () => void;
  /** The link has been turned off. */
  onRevoked?: () => void;
  /** Shows "Not you? Let us know" inside the card; called with the message to show instead of the page. */
  onNotMe?: (message: string) => void;
  businessName?: string | null;
  businessPhone?: string | null;
};

export function VerifyCard(p: VerifyCardProps) {
  const link = { tenantId: p.tenantId, apptId: p.apptId, k: p.k };
  const [stage, setStage] = React.useState<Stage>('checking');
  const [options, setOptions] = React.useState<Option[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [sent, setSent] = React.useState<{ id: string; to: string; channel: 'sms' | 'email'; at: number } | null>(null);
  const [code, setCode] = React.useState('');
  const [now, setNow] = React.useState(Date.now());
  const done = React.useRef(false);
  const cb = React.useRef(p); cb.current = p;
  const codeRef = React.useRef<HTMLInputElement | null>(null);

  const finish = React.useCallback(() => { if (done.current) return; done.current = true; cb.current.onVerified(); }, []);

  const status = React.useCallback(async () => {
    setErr(''); setStage('checking');
    const r = await visitCall(link, { action: 'verify_status' }, () => cb.current.onRevoked?.());
    if (r?.code === 'revoked') return;
    if (!r?.ok) { setErr(r?.error || 'We couldn’t check this just now. Please try again.'); setStage('failed'); return; }
    if (r.trusted) { finish(); return; }
    const wanted = cb.current.channels;
    const list: Option[] = (Array.isArray(r.options) ? r.options : []).filter((o: any) => o && (o.channel === 'sms' || o.channel === 'email') && (!wanted || wanted.includes(o.channel)));
    setOptions(list);
    setStage(!list.length ? 'none' : cb.current.prompt ? 'prompt' : 'choose');
  }, [p.tenantId, p.apptId, p.k, finish]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void status(); }, [status]);

  // The resend countdown.
  React.useEffect(() => {
    if (stage !== 'code' || !sent) return;
    const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t);
  }, [stage, sent]);
  React.useEffect(() => { if (stage === 'code') codeRef.current?.focus(); }, [stage]);

  const start = async (channel: 'sms' | 'email') => {
    if (busy) return; setBusy(true); setErr('');
    const r = await visitCall(link, { action: 'verify_start', channel }, () => cb.current.onRevoked?.());
    setBusy(false);
    if (r?.code === 'revoked') return;
    if (!r?.ok || !r.verificationId) { setErr(r?.error || 'We couldn’t send a code just now. Please try again.'); return; }
    setSent({ id: String(r.verificationId), to: String(r.sentTo || (channel === 'sms' ? 'your phone' : 'your email')), channel: (r.channel === 'email' ? 'email' : r.channel === 'sms' ? 'sms' : channel), at: Date.now() });
    setNow(Date.now()); setCode(''); setStage('code');
  };

  const check = async (value = code) => {
    const digits = value.replace(/\D/g, '');
    if (busy || !sent || digits.length !== 6) return;
    setBusy(true); setErr('');
    const r = await visitCall(link, { action: 'verify_check', verificationId: sent.id, code: digits, platform: platformOf() }, () => cb.current.onRevoked?.());
    setBusy(false);
    if (r?.code === 'revoked') return;
    if (!r?.ok) { setErr(r?.error || 'That code doesn’t match. Please check it and try again.'); return; }
    if (r.device) saveVisitDevice(r.device);
    setStage('done');
    setTimeout(finish, 1600);
  };

  const wait = sent ? Math.max(0, RESEND_AFTER - Math.floor((now - sent.at) / 1000)) : 0;
  const biz = p.businessName || 'us';
  const call = telOf(p.businessPhone);
  const notMe = p.onNotMe ? <div className="pt-1 text-center"><NotMeLink {...link} businessName={p.businessName} onDone={p.onNotMe} onRevoked={p.onRevoked} /></div> : null;

  if (stage === 'checking') return <section className="space-y-2 p-5" style={cardStyle} aria-busy="true"><Muted>One moment…</Muted></section>;

  if (stage === 'prompt' && p.prompt) return (
    <section className="space-y-3 p-5" style={cardStyle}>
      <p className="text-[16px] font-semibold">{p.prompt.title}</p>
      <Muted>{p.prompt.text}</Muted>
      <Pill tone="soft" onClick={() => setStage('choose')}>{p.prompt.button}</Pill>
    </section>
  );

  return (
    <section className="space-y-4 p-5" style={cardStyle} aria-live="polite">
      {stage !== 'done' && <div className="space-y-1">
        <p className="text-[17px] font-semibold">{p.title || 'Is this you?'}</p>
        {stage === 'choose' && <Muted>{p.intro || 'To keep your details private, we’ll send a 6-digit code to the phone or email we have for you.'}</Muted>}
      </div>}

      {stage === 'failed' && <>
        <ErrorLine text={err} />
        <Pill tone="soft" onClick={() => void status()}>Try again</Pill>
      </>}

      {stage === 'none' && <>
        <Muted>{p.channels?.length === 1 && p.channels[0] === 'sms'
          ? `We can’t send a text to the number on your booking. If you’d like to update it, please contact ${biz}.`
          : `We don’t have a phone number or email we can send a code to. Please contact ${biz} and we’ll be happy to help.`}</Muted>
        {call && <a href={`tel:${call}`} className="block text-[15px] font-semibold underline underline-offset-4">Call {p.businessPhone}</a>}
      </>}

      {stage === 'choose' && <>
        <p className="text-[14px] font-semibold">Where should we send your code?</p>
        <div className="grid gap-2">
          {options.map((o, i) => <Pill key={o.channel} tone={i === 0 ? 'solid' : 'soft'} disabled={busy} onClick={() => void start(o.channel)}>{o.label}</Pill>)}
        </div>
        {busy && <Muted>Sending your code…</Muted>}
        <ErrorLine text={err} />
      </>}

      {stage === 'code' && sent && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <p className="text-[15px]">We sent a code to {sent.to}.</p>
        <label className="block space-y-1.5">
          <span className="text-[14px] font-semibold">Your 6-digit code</span>
          <input ref={codeRef} value={code} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} aria-invalid={!!err}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); setErr(''); if (v.length === 6) void check(v); }}
            className="h-14 w-full rounded-full px-5 text-center text-[22px] font-semibold tracking-[0.4em] outline-none"
            style={{ background: SOFT, border: `1px solid ${err ? RED : LINE}`, color: INK, fontFamily: FONT }} />
        </label>
        <ErrorLine text={err} />
        <Pill type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm'}</Pill>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {wait > 0 ? <span className="text-[14px]" style={{ color: MUTED }}>You can ask for a new code in {wait} second{wait === 1 ? '' : 's'}.</span>
            : <TextLink disabled={busy} onClick={() => void start(sent.channel)}>Send a new code</TextLink>}
          {options.length > 1 && <TextLink disabled={busy} onClick={() => { setErr(''); setStage('choose'); }}>Send it another way</TextLink>}
        </div>
      </form>}

      {stage === 'done' && <div className="flex items-start gap-3" role="status">
        <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] text-white" style={{ background: GREEN }}>✓</span>
        <p className="text-[15px] font-semibold" style={{ color: GREEN }}>Thank you, this phone is now confirmed for 90 days.</p>
      </div>}

      {stage !== 'done' && notMe}
    </section>
  );
}

// ── "Not you? Let us know" ─────────────────────────────────────────────────────
export function NotMeLink(p: Link & { businessName?: string | null; onDone: (message: string) => void; onRevoked?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const yesRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!open) return; yesRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setOpen(false); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [open, busy]);

  const go = async () => {
    setBusy(true); setErr('');
    const r = await visitCall(p, { action: 'not_me' }, p.onRevoked);
    setBusy(false);
    if (r?.code === 'revoked') return;
    if (!r?.ok) { setErr(r?.error || 'We couldn’t send that just now. Please try again.'); return; }
    setOpen(false);
    p.onDone(String(r.message || 'Thank you for letting us know. We’ve stopped messages to this number, and this link no longer works.'));
  };

  return <>
    <button type="button" onClick={() => { setErr(''); setOpen(true); }} className="text-[13px] underline underline-offset-4" style={{ color: MUTED, fontFamily: FONT }}>Not you? Let us know</button>
    {open && <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" style={{ background: 'rgba(22,23,26,.45)', fontFamily: FONT }} onClick={() => { if (!busy) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="notme-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 p-6 text-left" style={{ background: '#fff', color: INK, borderRadius: '18px 18px 0 0', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
        <p id="notme-title" className="text-[18px] font-semibold">Not you?</p>
        <p className="text-[15px] leading-relaxed" style={{ color: MUTED }}>This will stop messages to this number and turn off this link. {p.businessName || 'The business'} will be told so they can fix it.</p>
        <ErrorLine text={err} />
        <div className="grid gap-2">
          <button ref={yesRef} type="button" onClick={() => void go()} disabled={busy} className="min-h-12 w-full rounded-full px-6 py-3 text-[15px] font-semibold text-white disabled:opacity-50" style={{ background: RED }}>{busy ? 'Sending…' : 'Yes, this isn’t me'}</button>
          <button type="button" onClick={() => setOpen(false)} disabled={busy} className="min-h-12 w-full rounded-full px-6 py-3 text-[15px] font-semibold disabled:opacity-50" style={{ background: SOFT, color: INK }}>Cancel</button>
        </div>
      </div>
    </div>}
  </>;
}

// ── Full-page notices ─────────────────────────────────────────────────────────
/** A calm full page: a turned-off link, or the thank-you after "Not you?". */
export function VisitNotice({ title, body, businessName, businessPhone }: { title: string; body: React.ReactNode; businessName?: string | null; businessPhone?: string | null }) {
  const call = telOf(businessPhone);
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10" style={{ background: '#ffffff', color: INK, fontFamily: FONT }}>
      <main className="w-full max-w-md space-y-4 p-6 text-center" style={cardStyle}>
        {businessName && <p className="text-[13px] font-semibold" style={{ color: MUTED }}>{businessName}</p>}
        <h1 className="text-[22px] font-semibold">{title}</h1>
        <div className="text-[15px] leading-relaxed" style={{ color: MUTED }}>{body}</div>
        {call && <a href={`tel:${call}`} className="inline-flex min-h-12 w-full items-center justify-center rounded-full px-6 text-[15px] font-semibold" style={{ background: SOFT, color: INK }}>Call {businessPhone}</a>}
      </main>
    </div>
  );
}

export function LinkOffView({ businessName, businessPhone }: { businessName?: string | null; businessPhone?: string | null }) {
  return <VisitNotice title="This link has been turned off" businessName={businessName} businessPhone={businessPhone}
    body={<>Please contact {businessName || 'us'} for a new one.</>} />;
}

// ── After booking online: "Confirm your number" (optional) ─────────────────────
/** For a new client, or a phone never confirmed: an optional code on the confirmation screen, against the new booking. */
export function ConfirmNumberCard({ verify, businessName }: { verify?: Link | null; businessName?: string | null }) {
  const [hidden, setHidden] = React.useState(false);
  if (!verify?.tenantId || !verify.apptId || !verify.k || hidden) return null;
  return <VerifyCard {...verify} channels={['sms']} businessName={businessName} onVerified={() => setHidden(true)} onRevoked={() => setHidden(true)}
    title="Confirm your number" intro="We’ll text a 6-digit code to the number on your booking."
    prompt={{ title: 'Confirm your number', text: 'This is optional. A quick code lets us know your reminders and updates are reaching the right phone.', button: 'Text me a code' }} />;
}
