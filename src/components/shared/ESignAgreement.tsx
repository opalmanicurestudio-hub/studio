'use client';

// src/components/shared/ESignAgreement.tsx
//
// Reusable type-to-sign agreement panel. Show the full agreement text, require
// the signer to type their legal name and check the acknowledgement box, then
// hand the typed name back via onSign. The CALLER persists it (usually with
// saveSignedDocument from '@/lib/esign') so this component stays about the UX.
//
// Used by both staff onboarding and renter onboarding — same signing surface
// everywhere, so the audit trail is consistent.

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader, PenLine, ShieldCheck, Check } from 'lucide-react';

interface ESignAgreementProps {
  title: string;
  agreementText: string;
  signerName?: string;          // prefill + (optionally) the name to match
  requireNameMatch?: boolean;   // typed name must equal signerName (case-insensitive)
  busy?: boolean;
  submitLabel?: string;
  onSign: (signedName: string) => void | Promise<void>;
  onCancel?: () => void;
}

export function ESignAgreement({
  title,
  agreementText,
  signerName = '',
  requireNameMatch = false,
  busy = false,
  submitLabel = 'Sign & Agree',
  onSign,
  onCancel,
}: ESignAgreementProps) {
  const [typedName, setTypedName] = useState(signerName || '');
  const [agreed, setAgreed] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);

  const nameOk = useMemo(() => {
    const t = typedName.trim();
    if (t.length < 2) return false;
    if (requireNameMatch && signerName) return t.toLowerCase() === signerName.trim().toLowerCase();
    return true;
  }, [typedName, requireNameMatch, signerName]);

  const canSign = nameOk && agreed && scrolledToEnd && !busy;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setScrolledToEnd(true);
  };

  const nowLabel = (() => {
    try {
      return new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    } catch { return ''; }
  })();

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="h-9 w-9 rounded-2xl bg-slate-900 flex items-center justify-center shrink-0">
          <PenLine className="h-4 w-4 text-white" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-black uppercase tracking-tight text-slate-900 leading-none truncate">{title}</h3>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-1">Please read fully before signing</p>
        </div>
      </div>

      {/* Agreement body */}
      <div
        onScroll={handleScroll}
        className="max-h-[42vh] overflow-y-auto rounded-2xl border-2 bg-muted/20 p-4 text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {agreementText}
      </div>
      {!scrolledToEnd && (
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 -mt-2">Scroll to the end to enable signing</p>
      )}

      {/* Acknowledge */}
      <button
        type="button"
        onClick={() => setAgreed(a => !a)}
        className="flex items-start gap-3 text-left rounded-2xl border-2 p-3.5 transition-colors hover:border-slate-300"
      >
        <span className={`mt-0.5 h-5 w-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${agreed ? 'bg-slate-900 border-slate-900' : 'border-slate-300'}`}>
          {agreed && <Check className="h-3.5 w-3.5 text-white" />}
        </span>
        <span className="text-[12px] font-semibold text-slate-700 leading-snug">
          I have read and agree to this {title}. I understand that typing my name below is a legal electronic signature.
        </span>
      </button>

      {/* Sign */}
      <div className="space-y-1.5">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type your full legal name</Label>
        <Input
          value={typedName}
          onChange={e => setTypedName(e.target.value)}
          placeholder="e.g., Alexander Smith"
          className="h-12 rounded-2xl border-2 font-semibold"
          style={{ fontFamily: "'Dancing Script', cursive", fontSize: '22px' }}
        />
        {requireNameMatch && signerName && typedName.trim() && !nameOk && (
          <p className="text-[10px] font-black uppercase tracking-widest text-destructive">Must match {signerName}</p>
        )}
        {nowLabel && <p className="text-[10px] font-medium text-muted-foreground">Signed {nowLabel}</p>}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] text-slate-400">
            Cancel
          </Button>
        )}
        <Button
          type="button"
          onClick={() => canSign && onSign(typedName.trim())}
          disabled={!canSign}
          className="flex-[2] h-12 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-lg shadow-primary/20"
        >
          {busy ? <Loader className="h-4 w-4 animate-spin" /> : <><ShieldCheck className="h-4 w-4 mr-1.5" /> {submitLabel}</>}
        </Button>
      </div>
    </div>
  );
}

export default ESignAgreement;
