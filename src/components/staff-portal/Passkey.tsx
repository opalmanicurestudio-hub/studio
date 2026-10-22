'use client';
// Face ID, Touch ID or fingerprint sign-in on a person's own phone (lib/passkeys). The phone's lock checks it's them; the server
// checks the phone. Nothing is stored here except a note that this phone has been set up for this person.
import * as React from 'react';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

const NOTE = (t: string) => `cf_portal_passkey_${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
// A web page can't tell which an Apple device has (the iPhone Duo, an iPhone SE and many iPads and Macs use Touch ID),
// so it names both.
export const faceLabel = () => (typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? 'Face ID or Touch ID' : 'fingerprint');
export const passkeyOnPhone = (tenantId: string, staffId?: string | null) => { try { return browserSupportsWebAuthn() && !!staffId && read(NOTE(tenantId)) === staffId; } catch { return false; } };
const post = async (body: any, token?: string | null) => fetch('/api/portal/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Couldn’t reach the sign-in service.' }));

/** Signs in with this phone's passkey. Returns the person (already signed in to the app) or a message to show. */
export async function signInWithPasskey(tenantId: string): Promise<{ ok: true; staff: any } | { ok: false; error: string; cancelled?: boolean }> {
  const o: any = await post({ action: 'passkey-options', tenantId }); if (!o?.ok) return { ok: false, error: o?.error || 'Signing in with your phone isn’t available right now.' };
  let response: any; try { response = await startAuthentication({ optionsJSON: o.options }); } catch { return { ok: false, error: '', cancelled: true }; }
  const d: any = await post({ action: 'passkey-login', tenantId, challengeId: o.challengeId, response });
  if (!d?.ok || !d.staff || !d.customToken) { if (/isn’t set up/.test(String(d?.error || ''))) write(NOTE(tenantId), null); return { ok: false, error: d?.error || 'Sign-in didn’t finish. Use your PIN.' }; }
  const { getAuth, signInWithCustomToken } = await import('firebase/auth');
  try { await signInWithCustomToken(getAuth(), d.customToken); } catch { return { ok: false, error: 'Sign-in failed. Check your connection and try again.' }; }
  write(NOTE(tenantId), d.staff.id); return { ok: true, staff: d.staff };
}

/** "Sign in with Face ID or Touch ID on this phone": add it, see the phones you've added, remove one. For their account page. */
export function PasskeySetup({ tenantId, staffId }: { tenantId: string; staffId: string }) {
  const [list, setList] = React.useState<any[] | null>(null); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState('');
  const [here, setHere] = React.useState(false); const [ok, setOk] = React.useState(false);
  const token = async () => { const { getAuth } = await import('firebase/auth'); return getAuth().currentUser?.getIdToken().catch(() => null) ?? null; };
  const load = React.useCallback(async () => { const d: any = await post({ action: 'passkey-list', tenantId }, await token()); setList(d?.ok ? d.passkeys : []); }, [tenantId]);
  React.useEffect(() => { try { setOk(browserSupportsWebAuthn()); } catch { setOk(false); } setHere(passkeyOnPhone(tenantId, staffId)); load(); }, [tenantId, staffId, load]);
  if (!ok) return null;
  const add = async () => {
    setBusy(true); setMsg(''); const tk = await token();
    const o: any = await post({ action: 'passkey-register-options', tenantId }, tk); if (!o?.ok) { setBusy(false); setMsg(o?.error || 'That didn’t work.'); return; }
    let response: any; try { response = await startRegistration({ optionsJSON: o.options }); } catch (e: any) { setBusy(false); setMsg(/exclude|already/i.test(String(e?.name || e?.message || '')) ? 'This phone is already set up.' : ''); return; }
    const name = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'This device';
    const d: any = await post({ action: 'passkey-register', tenantId, challengeId: o.challengeId, response, name }, tk); setBusy(false);
    if (!d?.ok) { setMsg(d?.error || 'That didn’t work.'); return; } write(NOTE(tenantId), staffId); setHere(true); setMsg(`Done. Next time, sign in with ${faceLabel()}.`); load();
  };
  const remove = async (id: string) => { setBusy(true); await post({ action: 'passkey-remove', tenantId, id }, await token()); setBusy(false); load(); };
  return (
    <div className="rounded-[18px] border border-[#ececee] bg-white p-4">
      <p className="text-[15px] font-semibold">Sign in with {faceLabel()}</p>
      <p className="mt-0.5 text-[13px] text-[#6d7075]">On your own phone, skip the PIN. Your phone checks it’s you; your face or fingerprint never leaves it.</p>
      {!here && <button type="button" disabled={busy} onClick={add} className="mt-3 h-11 w-full rounded-[14px] bg-[#16171a] text-[14px] font-semibold text-white disabled:opacity-50">{busy ? 'One moment…' : `Use ${faceLabel()} on this phone`}</button>}
      {msg && <p className="mt-2 text-[13px]">{msg}</p>}
      {(list || []).length > 0 && <div className="mt-3 space-y-1.5">{list!.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-[#f5f5f7] px-3 py-2 text-[13px]">
          <span>{p.name}<span className="block text-[11.5px] text-[#6d7075]">Added {new Date(p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}{p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</span></span>
          <button type="button" disabled={busy} onClick={() => remove(p.id)} className="text-[12.5px] font-semibold text-[#b42318]">Remove</button></div>))}</div>}
    </div>);
}
