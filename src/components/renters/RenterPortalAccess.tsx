'use client';
// src/components/renters/RenterPortalAccess.tsx — A RENTER'S PORTAL SIGN-IN, from their profile. Send them a fresh
// personal link (it works for 30 days), or turn off every link they've been sent and sign them out, for a lost
// phone or a forwarded email. They can still sign in with a code sent to their own phone or email. Managers only;
// the server checks (api/booths/notify portal-invite, portal-revoke).
import * as React from 'react';
import { useToast } from '@/hooks/use-toast';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const day = (iso: any) => { const d = new Date(String(iso || '')); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

export function RenterPortalAccess({ tenantId, renter }: { tenantId: string; renter: any }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<'' | 'send' | 'off'>('');
  const [ask, setAsk] = React.useState(false);
  const first = String(renter?.firstName || renter?.name || '').trim().split(' ')[0] || 'They';
  const reachable = /@/.test(String(renter?.email || '')) || String(renter?.phone || '').replace(/\D/g, '').length >= 7;

  const call = async (action: 'portal-invite' | 'portal-revoke') => {
    const r = await fetch('/api/booths/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ action, tenantId, renterId: renter.id }) });
    return r.json().catch(() => ({}));
  };
  const send = async () => {
    setBusy('send');
    try {
      const d: any = await call('portal-invite');
      const how = [d?.status === 'sent' ? 'email' : '', d?.sms === 'sent' ? 'text' : ''].filter(Boolean).join(' and ');
      if (d?.ok) toast({ title: 'Portal link sent', description: `${first} has a new link by ${how}. It works for 30 days.` });
      else toast({ title: 'Not sent', description: d?.error || 'There’s no email or phone on their record that we could reach.' });
    } catch { toast({ title: 'Not sent', description: 'Try again in a moment.' }); }
    setBusy('');
  };
  const turnOff = async () => {
    setBusy('off');
    try {
      const d: any = await call('portal-revoke');
      if (d?.ok) { toast({ title: 'Links turned off', description: `${first} is signed out, and the links sent so far no longer work.` }); setAsk(false); }
      else toast({ title: 'Not turned off', description: d?.error || 'Try again in a moment.' });
    } catch { toast({ title: 'Not turned off', description: 'Try again in a moment.' }); }
    setBusy('');
  };

  const hasLinks = renter?.portalInviteStatus === 'accepted' || renter?.portalInviteStatus === 'sent';
  const status = renter?.portalInviteStatus === 'accepted' ? `Signed in${renter?.portalFirstSeenAt ? ` first on ${day(renter.portalFirstSeenAt)}` : ''}`
    : renter?.portalInviteStatus === 'sent' ? `Link sent${renter?.portalInviteSentAt ? ` ${day(renter.portalInviteSentAt)}` : ''}, not opened yet`
    : 'No link sent yet';

  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-[15px] font-semibold text-[#16171a] dark:text-foreground">Renter portal</p>
      <p className="mt-0.5 text-[13.5px] text-muted-foreground">{status}. Each link works for 30 days.{renter?.portalLinksOffAt ? ` Links last turned off ${day(renter.portalLinksOffAt)}.` : ''}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-11 rounded-xl text-[14px]" disabled={!!busy || !reachable} onClick={send}>
          {busy === 'send' ? 'Sending…' : hasLinks ? 'Send a new link' : 'Send portal link'}
        </Button>
        {hasLinks && <Button type="button" variant="ghost" className="h-11 rounded-xl text-[14px] text-muted-foreground" disabled={!!busy} onClick={() => setAsk(true)}>Turn off links</Button>}
      </div>
      {!reachable && <p className="mt-2 text-[13px] text-[#b45309]">Add an email or phone number to send a link.</p>}

      <AlertDialog open={ask} onOpenChange={(v) => { if (!v && !busy) setAsk(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off {first}’s portal links?</AlertDialogTitle>
            <AlertDialogDescription>
              Every link sent so far stops working and {first === 'They' ? 'they’re' : `${first} is`} signed out of the portal. They can still sign in with a code sent to their own phone or email, and the next link you send works as usual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy} className="h-11">Keep</AlertDialogCancel>
            <AlertDialogAction disabled={!!busy} onClick={(e) => { e.preventDefault(); void turnOff(); }} className="h-11 bg-[#b42318] text-white hover:bg-[#9a1e14]">{busy === 'off' ? 'Turning off…' : 'Turn off links'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
