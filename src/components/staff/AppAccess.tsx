'use client';
// src/components/staff/AppAccess.tsx — WHETHER THIS PERSON CAN SIGN IN TO THE APP (not just the portal / time clock PIN).
// Invite emails them a link to set a password; their role comes from this profile and is kept in step by the server.
// Turning access off leaves their PIN working. All changes go through /api/staff/access (managers only).
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';

export async function accessCall(tenantId: string, staffId: string, action: 'invite' | 'sync' | 'revoke', email?: string) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const res = await fetch('/api/staff/access', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ tenantId, staffId, action, email }) });
  return (await res.json().catch(() => ({ ok: false, error: 'Something went wrong.' }))) as { ok: boolean; message?: string; error?: string; link?: string };
}

/** Keep their app role in step after a profile save or archive. Quiet — nothing to say when they have no login. */
export function syncAppAccess(tenantId: string | undefined, staffId: string | undefined) {
  if (!tenantId || !staffId) return;
  accessCall(tenantId, staffId, 'sync').catch(() => {});
}

export function AppAccess({ member }: { member: any }) {
  const { selectedTenant } = useTenant() as any; const { toast } = useToast();
  const [email, setEmail] = React.useState<string>(String(member?.email || ''));
  const [state, setState] = React.useState<string>(String(member?.appAccess || (member?.authUid ? 'active' : '')));
  const [busy, setBusy] = React.useState(false); const [link, setLink] = React.useState('');
  React.useEffect(() => { setEmail(String(member?.email || '')); setState(String(member?.appAccess || (member?.authUid ? 'active' : ''))); setLink(''); }, [member?.id]);
  if (!member?.id || !selectedTenant?.id) return null;
  const renter = member.isRenter === true || member.role === 'renter';
  if (renter) return null;
  const go = async (action: 'invite' | 'revoke') => {
    setBusy(true);
    try {
      const r = await accessCall(selectedTenant.id, member.id, action, email);
      if (!r.ok) { toast({ variant: 'destructive', title: 'Not changed', description: r.error }); return; }
      setState(action === 'invite' ? 'invited' : 'off'); setLink(r.link && !/emailed/i.test(String(r.message)) ? r.link : '');
      toast({ title: action === 'invite' ? 'App access on' : 'App access off', description: r.message });
    } finally { setBusy(false); }
  };
  const on = state === 'invited' || state === 'active';
  return (
    <div className="space-y-3 rounded-2xl border p-4 text-left">
      <div>
        <p className="text-[14px] font-[700]">App access</p>
        <p className="text-[12px] text-muted-foreground">
          {on ? `They can sign in to the app with their email. What they see follows their role (${member.role || 'staff'}).`
            : state === 'off' ? 'Turned off. Their PIN still works for the time clock and staff portal.'
            : 'They use their PIN for the time clock and staff portal. Invite them if they also need to sign in to the app — for example a manager or front desk.'}
        </p>
      </div>
      {member.archived ? <p className="text-[12px] text-muted-foreground">Archived team members can’t have app access.</p> : (
        <div className="flex flex-col gap-2 sm:flex-row">
          {!on && <Input type="email" aria-label="Their email for signing in" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="h-10 rounded-xl" />}
          {on ? <>
              <Button type="button" variant="outline" disabled={busy} className="h-10 rounded-xl" onClick={() => go('invite')}>Send the invite again</Button>
              <Button type="button" variant="outline" disabled={busy} className="h-10 rounded-xl text-destructive" onClick={() => go('revoke')}>Turn off app access</Button>
            </> : <Button type="button" disabled={busy || !email.trim()} className="h-10 rounded-xl" onClick={() => go('invite')}>{state === 'off' ? 'Turn back on and invite' : 'Invite to the app'}</Button>}
        </div>)}
      {link && <div className="space-y-1"><p className="text-[12px] text-muted-foreground">Email isn’t set up, so send them this link yourself:</p>
        <div className="flex gap-2"><Input readOnly value={link} className="h-9 rounded-xl text-[12px]" aria-label="Invite link" />
          <Button type="button" variant="outline" className="h-9 rounded-xl" onClick={() => { navigator.clipboard?.writeText(link); toast({ title: 'Link copied' }); }}>Copy</Button></div></div>}
    </div>);
}
