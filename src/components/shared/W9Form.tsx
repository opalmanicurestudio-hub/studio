'use client';
import { staffAuthHeader } from '@/lib/staff-fetch';

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
import { Check } from 'lucide-react';
import { W9_ENTITY_TYPES } from '@/lib/w9-entity-types';

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
  /** How the W-9 is sent. The staff portal posts to /api/booths/w9 (the default); the renter portal sends it through
   *  its own session (/api/portal/renter, action w9-save). Either way only the masked number comes back. */
  submit?: (payload: Record<string, any>) => Promise<{ ok: boolean; error?: string; tinMasked?: string }>;
}

export function W9Form({ tenantId, renterId, existingW9, onComplete, submit }: Props) {
  const uid = React.useId();
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

  const inputCls = "w-full h-12 rounded-xl border px-4 text-sm font-medium focus:border-[#16171a] outline-none transition-colors";
  const labelCls = "text-[13px] font-semibold text-[#6d7075] block mb-1";

  const steps = [
    {
      title: 'Your identity',
      subtitle: 'As it appears on your tax return',
      valid: legalName.trim().length > 1 && entityType !== '',
      content: (
        <div className="space-y-4">
          <div>
            <label htmlFor={`${uid}-f1`} className={labelCls}>Legal name *</label>
            <input id={`${uid}-f1`} className={inputCls} value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="Your legal name (as on your tax return)" />
          </div>
          <div>
            <label htmlFor={`${uid}-f2`} className={labelCls}>Business / DBA name</label>
            <input id={`${uid}-f2`} className={inputCls} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Leave blank if same as legal name" />
          </div>
          <div>
            <label htmlFor={`${uid}-f3`} className={labelCls}>Entity type *</label>
            <select id={`${uid}-f3`} className={inputCls + ' bg-white'} value={entityType} onChange={e => setEntityType(e.target.value)}>
              <option value="">Select your entity type</option>
              {W9_ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
            <label htmlFor={`${uid}-f4`} className={labelCls}>Street address *</label>
            <input id={`${uid}-f4`} className={inputCls} value={street} onChange={e => setStreet(e.target.value)} placeholder="123 Main Street" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-f5`} className={labelCls}>City *</label>
              <input id={`${uid}-f5`} className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="City" />
            </div>
            <div>
              <label htmlFor={`${uid}-f6`} className={labelCls}>State *</label>
              <select id={`${uid}-f6`} className={inputCls + ' bg-white'} value={state} onChange={e => setState(e.target.value)}>
                <option value="">State</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor={`${uid}-f7`} className={labelCls}>ZIP code *</label>
            <input id={`${uid}-f7`} className={inputCls} value={zip} onChange={e => setZip(e.target.value)} placeholder="12345" maxLength={10} />
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
          <div className="rounded-2xl border border-[#f3d9bd] bg-[#fdf6ee] p-3 space-y-1">
            <p className="text-[13px] font-semibold text-[#b45309]">Security notice</p>
            <p className="text-[14px] text-[#b45309] leading-relaxed">Your TIN is encrypted on the server the moment you submit — it is never stored in plain text, never logged, and only the last 4 digits are visible after submission. Transmission is secured by HTTPS.</p>
          </div>
          <div>
            <label className={labelCls}>TIN type *</label>
            <div className="flex gap-3">
              {(['ssn','ein'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTinType(t)} className={`flex-1 h-11 rounded-xl border font-semibold text-[13px] transition-colors ${tinType === t ? 'bg-[#16171a] text-white border-[#16171a]' : 'border-[#ececee] text-[#6d7075]'}`}>
                  {t === 'ssn' ? 'SSN (individual)' : 'EIN (business)'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor={`${uid}-f8`} className={labelCls}>{tinType === 'ssn' ? 'Social Security Number' : 'Employer Identification Number'} *</label>
            <input id={`${uid}-f8`}
              inputMode="numeric"
              type="password"
              autoComplete="off"
              className={inputCls}
              value={tin}
              onChange={e => setTin(e.target.value)}
              placeholder={tinType === 'ssn' ? '123-45-6789' : '12-3456789'}
              maxLength={11}
            />
            <p className="text-[13px] font-medium text-[#6d7075] mt-1">Format: {tinType === 'ssn' ? 'XXX-XX-XXXX' : 'XX-XXXXXXX'}</p>
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
          <div className="rounded-2xl border border-[#ececee] bg-[#f5f5f7] p-4 space-y-3 text-[13px] text-[#16171a] leading-relaxed">
            <p className="font-semibold text-[13px]">Certify under penalties of perjury that:</p>
            <ol className="list-decimal list-inside space-y-2 text-[14px]">
              <li>The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me).</li>
              <li>I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the IRS that I am subject to backup withholding as a result of failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding.</li>
              <li>I am a U.S. citizen or other U.S. person.</li>
              <li>The FATCA exemption code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.</li>
            </ol>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={certified} onChange={e => setCertified(e.target.checked)} className="mt-0.5 h-5 w-5 rounded shrink-0" />
            <span className="text-[13px] font-medium text-[#16171a] leading-relaxed">
              I certify, under penalties of perjury, that the information I provided is true, correct, and complete.
            </span>
          </label>
          <div className="rounded-xl border bg-[#f5f5f7] px-4 py-3">
            <p className="text-[13px] font-semibold text-[#6d7075] mb-2">Summary</p>
            <div className="space-y-1 text-[14px] text-[#6d7075]">
              <p><span className="font-medium">Legal name:</span> {legalName}</p>
              {businessName && <p><span className="font-medium">Business name:</span> {businessName}</p>}
              <p><span className="font-medium">Address:</span> {street}, {city}, {state} {zip}</p>
              <p><span className="font-medium">Entity type:</span> {entityType}</p>
              <p><span className="font-medium">TIN:</span> {tinType.toUpperCase()} ending ···{tin.replace(/\D/g,'').slice(-4)}</p>
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
      const payload = {
        tenantId, renterId, tinType,
        tin: tin.replace(/\D/g,''), // digits only to server
        legalName: legalName.trim(),
        businessName: businessName.trim(),
        address: { street: street.trim(), city: city.trim(), state, zip: zip.trim() },
        entityType,
        certifiedUnderPenalty: true,
      };
      const data = submit ? await submit(payload) : await (await fetch('/api/booths/w9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
        body: JSON.stringify(payload),
      })).json();
      if (!data.ok) { setError(data.error || 'Submission failed — please try again.'); return; }
      setTin(''); // clear TIN from state immediately after successful submit
      onComplete(data.tinMasked || '');
    } catch {
      setError('Network error — please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[13px] font-semibold transition-colors ${i === step ? 'bg-[#16171a] text-white' : i < step ? 'bg-[#1f7a4d] text-white' : 'bg-[#f5f5f7] text-[#6d7075]'}`}>
              {i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </div>
            {i < steps.length - 1 && <div className={`h-0.5 w-6 rounded ${i < step ? 'bg-[#1f7a4d]' : 'bg-[#ececee]'}`} />}
          </div>
        ))}
        <p className="ml-1 text-[13px] font-medium text-[#6d7075]">{step + 1} of {steps.length}</p>
      </div>

      <div className="space-y-1">
        <h3 className="font-semibold text-base tracking-tight">{currentStep.title}</h3>
        <p className="text-[14px] text-[#6d7075]">{currentStep.subtitle}</p>
      </div>

      {currentStep.content}

      {error && <p className="text-[13px] font-medium text-[#b45309] rounded-xl bg-[#fdf6ee] border border-[#f3d9bd] px-3 py-2">{error}</p>}

      <div className="flex gap-3 pt-1">
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} className="h-11 px-4 rounded-2xl border font-semibold text-[13px] text-[#6d7075]">Back</button>
        )}
        {step < steps.length - 1 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!currentStep.valid}
            className="flex-1 h-11 rounded-2xl bg-[#16171a] text-white font-semibold text-[13px] disabled:opacity-40"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!currentStep.valid || submitting}
            className="flex-1 h-11 rounded-full bg-[#16171a] text-white font-semibold text-[15px] disabled:opacity-40"
          >
            {submitting ? 'Saving…' : 'Save my W-9'}
          </button>
        )}
      </div>
    </div>
  );
}
