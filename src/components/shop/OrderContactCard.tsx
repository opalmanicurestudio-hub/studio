'use client';

// The customer's own contact details on their order page: the email and mobile updates go to, and whether they come by
// text. A new email or mobile is confirmed with a 6-digit code sent to it (api/retail/self-serve contact_code /
// contact_confirm, lib/order-contact), so updates can't be sent somewhere by mistake; the old email hears about it.
// Texts can be turned off or on with one tap. Locked (an order held for review, never said why): they message the shop.
import React, { useState } from 'react';
import { Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Field = 'email' | 'phone';
type Props = {
  email: string;
  phoneEnding: string | null;
  textsOff: boolean;
  locked: boolean;
  selfServe: (payload: any) => Promise<any>;
  onChanged: () => void;
  notify: (t: { title: string; description?: string; bad?: boolean }) => void;
};

const chip = 'h-9 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest';

export function OrderContactCard({ email, phoneEnding, textsOff, locked, selfServe, onChanged, notify }: Props) {
  const [editing, setEditing] = useState<Field | null>(null);
  const [value, setValue] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sentNote, setSentNote] = useState('');
  const [busy, setBusy] = useState<null | 'send' | 'confirm' | 'texts'>(null);
  const [err, setErr] = useState('');

  const close = () => { setEditing(null); setValue(''); setVerificationId(null); setCode(''); setSentNote(''); setErr(''); };
  const open = (f: Field) => { close(); setEditing(f); };

  const send = async () => {
    if (!editing || busy) return;
    if (!value.trim()) { setErr(editing === 'email' ? 'Enter the new email address.' : 'Enter the new mobile number.'); return; }
    setBusy('send'); setErr('');
    try {
      const d = await selfServe({ action: 'contact_code', field: editing, value: value.trim() });
      setVerificationId(d.verificationId); setSentNote(d.message || 'We sent you a code.'); setCode('');
    } catch (e: any) { setErr(e?.message || 'That didn’t go through. Try again.'); }
    finally { setBusy(null); }
  };

  const confirm = async () => {
    if (!verificationId || busy) return;
    if (code.replace(/\D/g, '').length !== 6) { setErr('Enter the 6-digit code.'); return; }
    setBusy('confirm'); setErr('');
    try {
      const d = await selfServe({ action: 'contact_confirm', verificationId, code: code.replace(/\D/g, '') });
      notify({ title: 'Saved', description: d.message });
      close(); onChanged();
    } catch (e: any) { setErr(e?.message || 'That didn’t go through. Try again.'); }
    finally { setBusy(null); }
  };

  const toggleTexts = async () => {
    if (busy) return;
    setBusy('texts');
    try { const d = await selfServe({ action: 'texts', off: !textsOff }); notify({ title: textsOff ? 'Texts on' : 'Texts off', description: d.message }); onChanged(); }
    catch (e: any) { notify({ title: 'That didn’t go through', description: e?.message || 'Try again.', bad: true }); }
    finally { setBusy(null); }
  };

  const row = (label: string, shown: string, f: Field) => (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold">{shown}</p>
      </div>
      {!locked && editing !== f && (
        <Button variant="outline" size="sm" onClick={() => open(f)} className={chip}>
          {f === 'phone' && !phoneEnding ? 'Add' : 'Change'}
        </Button>)}
    </div>
  );

  return (
    <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
      <CardContent className="p-5 space-y-3">
        <p className="text-[11px] font-black uppercase tracking-widest">Your details</p>
        {row('Email', email || 'None added', 'email')}
        {row('Mobile', phoneEnding ? `Ending in ${phoneEnding}` : 'None added', 'phone')}
        {phoneEnding && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Updates by text</p>
              <p className="text-sm font-bold">{textsOff ? 'Off: updates come by email' : 'On'}</p>
            </div>
            <Button variant="outline" size="sm" disabled={busy === 'texts'} onClick={() => void toggleTexts()} className={chip}>
              {busy === 'texts' ? <Loader className="h-4 w-4 animate-spin" /> : textsOff ? 'Turn on' : 'Turn off'}
            </Button>
          </div>)}

        {editing && !verificationId && (
          <div className="space-y-2">
            <Input
              type={editing === 'email' ? 'email' : 'tel'}
              inputMode={editing === 'email' ? 'email' : 'tel'}
              autoComplete={editing === 'email' ? 'email' : 'tel'}
              aria-label={editing === 'email' ? 'New email address' : 'New mobile number'}
              placeholder={editing === 'email' ? 'New email address' : 'New mobile number'}
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setValue(e.target.value); setErr(''); }}
              className="h-11 rounded-xl border-2 font-bold text-sm"
            />
            <Button disabled={busy === 'send'} onClick={() => void send()} className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest">
              {busy === 'send' ? <Loader className="h-4 w-4 animate-spin" /> : editing === 'email' ? 'Email me a code' : 'Text me a code'}
            </Button>
            <Button variant="outline" onClick={close} className="w-full h-11 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest">Never mind</Button>
            <p className="text-[11px] font-bold text-muted-foreground">
              {editing === 'email' ? 'We’ll send a code to the new address to make sure it’s yours. The current email is told about the change.' : 'We’ll text a code to the new number to make sure it’s yours.'}
            </p>
          </div>)}

        {editing && verificationId && (
          <div className="space-y-2">
            <p className="text-[12px] font-bold">{sentNote}</p>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="6-digit code"
              placeholder="6-digit code"
              maxLength={7}
              value={code}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setCode(e.target.value.replace(/[^\d ]/g, '')); setErr(''); }}
              className="h-12 rounded-xl border-2 text-center font-black text-lg tracking-[0.4em] placeholder:text-sm placeholder:font-bold placeholder:tracking-normal"
            />
            <Button disabled={busy === 'confirm'} onClick={() => void confirm()} className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest">
              {busy === 'confirm' ? <Loader className="h-4 w-4 animate-spin" /> : 'Confirm'}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={busy === 'send'} onClick={() => void send()} className="h-11 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest">
                {busy === 'send' ? <Loader className="h-4 w-4 animate-spin" /> : 'Send a new code'}
              </Button>
              <Button variant="outline" onClick={close} className="h-11 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest">Never mind</Button>
            </div>
          </div>)}

        {err && <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-900">{err}</p>}
        {locked && <p className="text-[11px] font-bold text-muted-foreground">To change these, send the shop a message on this page.</p>}
      </CardContent>
    </Card>
  );
}
