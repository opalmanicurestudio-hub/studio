'use client';

import React from 'react';
import { format, parseISO } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { type Client, type ConsentForm, type Tenant } from '@/lib/data';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface PrintableConsentFormProps {
  tenant: Tenant | null;
  client: Client;
  consent: any; // The signed consent record
  formTemplate?: ConsentForm | null;
}

export const PrintableConsentForm: React.FC<PrintableConsentFormProps> = ({
  tenant,
  client,
  consent,
  formTemplate,
}) => {
  if (!consent) return null;

  const fieldIds = formTemplate?.fields?.map(f => f.id) || Object.keys(consent.formData || {});

  return (
    <div className="p-8 bg-white text-black font-sans text-sm max-w-4xl mx-auto print:p-0" id="consent-print-record">
      <style jsx global>{`
        @media print {
          body {
            background-color: white !important;
            -webkit-print-color-adjust: exact;
          }
          body * {
            visibility: hidden;
          }
          #consent-print-area, #consent-print-area * {
            visibility: visible;
          }
          #consent-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Header Section */}
      <div className="flex justify-between items-start mb-8 border-b-2 border-black pb-6">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-tight">{tenant?.name || 'ClarityFlow Business'}</h1>
          <p className="text-gray-600 mt-1">Official Consent Record</p>
        </div>
        <div className="text-right text-xs">
          <p><strong>Date Signed:</strong> {format(parseISO(consent.signedAt), 'PPP p')}</p>
          <p><strong>Record ID:</strong> {consent.id.toUpperCase()}</p>
        </div>
      </div>

      {/* Client Information */}
      <div className="grid grid-cols-2 gap-8 mb-8 bg-gray-50 p-4 rounded-lg">
        <div>
          <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Client Details</h2>
          <p className="text-lg font-bold">{client.name}</p>
          <p className="text-gray-600">{client.email}</p>
          <p className="text-gray-600">{client.phone}</p>
        </div>
        <div className="text-right">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Form Category</h2>
          <p className="text-lg font-bold">{consent.formTitle}</p>
          <Badge variant="outline" className="mt-1 border-black text-black">{formTemplate?.category || 'General'}</Badge>
        </div>
      </div>

      {/* Form Responses */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold border-b pb-2">Form Responses</h2>
        <div className="grid grid-cols-1 gap-y-6 pt-2">
          {fieldIds.map((id: string) => {
            const field = formTemplate?.fields?.find(f => f.id === id);
            const label = field?.label || id;
            const answer = consent.formData ? consent.formData[id] : undefined;

            if (field?.type === 'heading') {
              return <h3 key={id} className="text-lg font-bold pt-4 border-b-2 border-gray-100 pb-1">{label}</h3>;
            }
            if (field?.type === 'paragraph') {
              return <p key={id} className="text-sm text-gray-600 leading-relaxed italic">{label}</p>;
            }
            if (field?.type === 'signature') {
              return null; // Handle signature at the bottom
            }

            return (
              <div key={id} className="space-y-1.5 break-inside-avoid">
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">{label}</p>
                <div className="text-base font-medium border-l-2 border-gray-200 pl-4 py-1">
                  {answer !== undefined ? (
                    Array.isArray(answer) ? answer.join(', ') : String(answer)
                  ) : (
                    <span className="text-gray-300 italic">No response provided</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Signature Section */}
      <div className="mt-16 pt-8 border-t-2 border-black break-inside-avoid">
        <h2 className="text-xl font-bold mb-8">Acknowledgment & Signature</h2>
        <div className="flex flex-col md:flex-row justify-between items-end gap-12">
          <div className="flex-1 w-full max-w-md">
            {Object.entries(consent.formData || {}).map(([id, val]: [string, any]) => {
              const field = formTemplate?.fields?.find(f => f.id === id);
              if (field?.type === 'signature' && typeof val === 'string' && val.startsWith('data:image')) {
                return (
                  <div key={id} className="space-y-4">
                    <div className="relative w-full aspect-[3/1] bg-white">
                      <Image src={val} alt="Digital Signature" fill className="object-contain" />
                    </div>
                    <div className="border-t border-black pt-2">
                      <p className="text-xs font-bold uppercase">Client Signature</p>
                      <p className="text-sm">{client.name}</p>
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
          <div className="text-right text-xs text-gray-400">
            <p>Digitally signed via ClarityFlow Secure Kiosk</p>
            <p>IP Address logged & verified</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 pt-4 border-t border-gray-100 text-center text-[10px] text-gray-400">
        <p>This is a legally binding electronic record. Page 1 of 1</p>
      </div>
    </div>
  );
};

const Badge = ({ children, className, variant }: any) => (
  <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter border", className)}>
    {children}
  </span>
);