'use client';
// src/components/consents/PrintableConsentForm.tsx — A SIGNED FORM AS A PRINTED RECORD: the business, the client, the
// form, then the record itself (components/consents/SignedFormRecord: each answer under its question, the signature as
// drawn or typed, who signed and any guardian, where and when). Ink on white; plain words.
import React from 'react';
import { type Client, type ConsentForm, type Tenant } from '@/lib/data';
import { SignedFormRecord } from '@/components/consents/SignedFormRecord';

interface PrintableConsentFormProps {
  tenant: Tenant | null;
  client: Client;
  consent: any; // The signed consent record
  formTemplate?: ConsentForm | null;
}

export const PrintableConsentForm: React.FC<PrintableConsentFormProps> = ({ tenant, client, consent, formTemplate }) => {
  if (!consent) return null;
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-[14px] text-[#16171a] print:p-0" id="consent-print-area" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`@media print { body * { visibility: hidden; } #consent-print-area, #consent-print-area * { visibility: visible; } #consent-print-area { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
      <div className="flex items-start justify-between gap-6 pb-5" style={{ borderBottom: '1px solid #ececee' }}>
        <div><p className="text-[22px] font-semibold">{tenant?.name || 'Signed form'}</p><p className="text-[13px] text-[#6d7075]">A signed form, as kept on file</p></div>
        <div className="text-right text-[13px]"><p className="font-semibold">{client?.name}</p>{client?.email && <p className="text-[#6d7075]">{client.email}</p>}{client?.phone && <p className="text-[#6d7075]">{client.phone}</p>}</div>
      </div>
      <h1 className="mb-4 mt-6 text-[20px] font-semibold">{consent.formTitle || formTemplate?.title || 'Form'}</h1>
      <SignedFormRecord record={consent} form={formTemplate || null} />
    </div>
  );
};
