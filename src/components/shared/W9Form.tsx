'use client';

/**
 * W9Form — v1
 *
 * The renter's W-9 submission form inside the portal Documents tab.
 * Walks through four steps: identity, address, TIN, and certification.
 * The TIN field is a standard <input type="password"> — the value is
 * never stored in any state beyond the local component, and is sent
 * directly to /api/booths/w9 which encrypts it server-side immediately.
 *
 * Once submitted successfully, shows the masked TIN (***-**-6789) and
 * allows updating if needed.
 *
 * CRITICAL security constraints (must never be relaxed):
 *  - TIN only lives in the controlled input's DOM node until submit
 *  - TIN is sent over HTTPS to the server route, never logged
 *  - Only the masked version is stored in component state after submit
 *  - No console.log of formData — it contains the TIN during submission
 */

import React, { useState } from 'react';

const ENTITY_TYPES = [
  'Individual / Sole proprietor',
  'Single-member LLC',
  'Partnership',
  'C Corporation',
  'S Corporation',
  'LLC taxed as C Corp',
  'LLC taxed as S Corp',
  'LLC taxed as Partnership',
  'Other',
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

interface Props {
  tenantId:    string;
  renterId:    string;
  existingW9?: {
    tinMasked:    string;
    tinType:      string;
    legalName:    string;
    businessName: string;
    address:      { street: string; city: string; state: string; zip: string };
    entityType:   string;
    certifiedAt:  string;
  } | null;
  onComplete: (masked: string) => void;
}

export function W9Form({ tenantId, renterId, existingW9, onComplete }: Props) {
  const [step, setStep]           = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState('');

  // Form fields — TIN kept as local state only, never persisted
  const [legalName, setLegalName]         = useState(existingW9?.legalName || '');
  const [businessName, setBusinessName]   = useState(existingW9?.businessName || '');
  const [entityType, setEntityType]       = useState(existingW9?.entityType || '');
  const [street, setStreet]               = useState(existingW9?.address?.street || '');
  const [city, setCity]                   = useState(existingW9?.address?.city || '');
  const [state, setState]                 = useState(existingW9?.address?.state || '');
  const [zip, setZip]                     = useState(existingW9?.address?.zip || '');
  const [tinType, setTinType]             = useState<'ssn' | 'ein'>(existingW9?.tinType as any || 'ssn');
  const [tin, setTin]                     = useState('');            // never persisted
  const [certified, setCertified]         = useState(false);

  const inputCls = "w-full h-12 rounded-xl border-2 px-4 text-sm font-medium focus:border-slate-900 outline-none transition-colors";
  const labelCls = "text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1";

  const steps = [
    {
      title: 'Your identity',
      subtitle: 'As it appears on your tax return',
      valid: legalName.trim().length > 1 && entityType !== '',
      content: (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Legal name *</label>
            <input className={inputCls} value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="Your legal name (as on your tax return)" />
          </div>
          <div>
            <label className={labelCls}>Business / DBA name</label>
            <input className={inputCls} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Leave blank if same as legal name" />
          </div>
          <div>
            <label className={labelCls}>Entity type *</label>
            <select className={inputCls + ' bg-white'} value={entityType} onChange={e => setEntityType(e.target.value)}>
              <option value="">Select your entity type</option>
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      ),
    },
    {
      title: 'Your address',
      subtitle: 'Must match your tax return',
      valid: street.trim() && city.trim() && state && zip.trim().length >= 5,
      content: (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Street address *</label>
            <input className={inputCls} value={street} onChange={e => setStreet(e.target.value)} placeholder="123 Main Street" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>City *</label>
              <input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="City" />
            </div>
            <div>
              <label className={labelCls}>State *</label>
              <select className={inputCls + ' bg-white'} value={state} onChange={e => setState(e.target.value)}>
                <option value="">State</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>ZIP code *</label>
            <input className={inputCls} value={zip} onChange={e => setZip(e.target.value)} placeholder="12345" maxLength={10} />
          </div>
        </div>
      ),
    },
    {
      title: 'Taxpayer ID',
      subtitle: 'SSN or EIN — encrypted immediately on our server',
      valid: tin.replace(/\D/g, '').length === 9,
      content: (
        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-3 space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Security notice</p>
            <p className="text-[11px] text-amber-700 leading-relaxed">Your TIN is encrypted on the server the moment you submit — it is never stored in plain text, never logged, and only the last 4 digits are visible after submission. Transmission is secured by HTTPS.</p>
          </div>
          <div>
            <label className={labelCls}>TIN type *</label>
            <div className="flex gap-3">
              {(['ssn','ein'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTinType(t)} className={`flex-1 h-11 rounded-xl border-2 font-black uppercase text-xs tracking-widest transition-colors ${tinType === t ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600'}`}>
                  {t === 'ssn' ? 'SSN (individual)' : 'EIN (business)'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>{tinType === 'ssn' ? 'Social Security Number' : 'Employer Identification Number'} *</label>
            <input
              type="password"
              autoComplete="off"
              className={inputCls}
              value={tin}
              onChange={e => setTin(e.target.value)}
              placeholder={tinType === 'ssn' ? '123-45-6789' : '12-3456789'}
              maxLength={11}
            />
            <p className="text-[10px] font-bold text-slate-400 mt-1">Format: {tinType === 'ssn' ? 'XXX-XX-XXXX' : 'XX-XXXXXXX'}</p>
          </div>
        </div>
      ),
    },
    {
      title: 'Certification',
      subtitle: 'Under penalties of perjury',
      valid: certified,
      content: (
        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 space-y-3 text-xs text-slate-700 leading-relaxed">
            <p className="font-black uppercase text-[10px] tracking-widest">Certify under penalties of perjury that:</p>
            <ol className="list-decimal list-inside space-y-2 text-[11px]">
              <li>The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me).</li>
              <li>I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the IRS that I am subject to backup withholding as a result of failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding.</li>
              <li>I am a U.S. citizen or other U.S. person.</li>
              <li>The FATCA exemption code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.</li>
            </ol>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={certified} onChange={e => setCertified(e.target.checked)} className="mt-0.5 h-5 w-5 rounded shrink-0" />
            <span className="text-xs font-bold text-slate-700 leading-relaxed">
              I certify, under penalties of perjury, that the information I provided is true, correct, and complete.
            </span>
          </label>
          <div className="rounded-xl border bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Summary</p>
            <div className="space-y-1 text-[11px] text-slate-600">
              <p><span className="font-bold">Legal name:</span> {legalName}</p>
              {businessName && <p><span className="font-bold">Business name:</span> {businessName}</p>}
              <p><span className="font-bold">Address:</span> {street}, {city}, {state} {zip}</p>
              <p><span className="font-bold">Entity type:</span> {entityType}</p>
              <p><span className="font-bold">TIN:</span> {tinType.toUpperCase()} ending ···{tin.replace(/\D/g,'').slice(-4)}</p>
            </div>
          </div>
        </div>
      ),
    },
  ];

  const currentStep = steps[step];

  const handleSubmit = async () => {
    if (!certified || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/booths/w9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, renterId, tinType,
          tin: tin.replace(/\D/g,''), // digits only to server
          legalName: legalName.trim(),
          businessName: businessName.trim(),
          address: { street: street.trim(), city: city.trim(), state, zip: zip.trim() },
          entityType,
          certifiedUnderPenalty: true,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || 'Submission failed — please try again.'); return; }
      setTin(''); // clear TIN from state immediately after successful submit
      onComplete(data.tinMasked);
    } catch {
      setError('Network error — please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-black transition-colors ${i === step ? 'bg-slate-900 text-white' : i < step ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
              {i < step ? '✓' : i + 1}
            </div>
            {i < steps.length - 1 && <div className={`h-0.5 w-6 rounded ${i < step ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          </div>
        ))}
        <p className="text-[10px] font-bold text-muted-foreground ml-1">{step + 1} of {steps.length}</p>
      </div>

      {/* Step content */}
      <div className="space-y-1">
        <h3 className="font-black text-base tracking-tight">{currentStep.title}</h3>
        <p className="text-[11px] font-bold text-muted-foreground">{currentStep.subtitle}</p>
      </div>

      {currentStep.content}

      {error && <p className="text-xs font-bold text-red-600 rounded-xl bg-red-50 border border-red-200 px-3 py-2">{error}</p>}

      {/* Navigation */}
      <div className="flex gap-3 pt-1">
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} className="h-11 px-4 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest text-slate-600">Back</button>
        )}
        {step < steps.length - 1 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!currentStep.valid}
            className="flex-1 h-11 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!currentStep.valid || submitting}
            className="flex-1 h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-40"
          >
            {submitting ? 'Encrypting & saving…' : 'Submit W-9 Information'}
          </button>
        )}
      </div>
    </div>
  );
}
