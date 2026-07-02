'use client';

/**
 * PrintTicket — v4
 *
 * v4 — unambiguous check-in code:
 *   - The printed/displayed check-in code now prefers `appointment.shortCode`
 *     (generated from a restricted alphabet that excludes visually
 *     ambiguous characters — no 0/O, no 1/I/L) over the old
 *     `checkInToken.slice(-8)` approach. The old approach inherited
 *     whatever characters nanoid's default alphabet produced, which are
 *     genuinely indistinguishable in a lot of ticket-printer fonts once
 *     printed — a customer could type a perfectly legible code that was
 *     simply the wrong character and get a false "not found" for a
 *     completely valid appointment. Falls back to the legacy slice for any
 *     appointment that predates shortCode, so old tickets don't just break.
 *
 * v3 — full redesign:
 *   - Allergy/medical strip is now the FIRST visual element, rendered before
 *     even the client name, in a high-contrast red bar that's impossible to
 *     miss when a stack of tickets is fanned on the station. In v2 it sat
 *     below the header — technically present but easy to scan past.
 *   - Studio branding: studio name and "Tech Prep Sheet" label printed at
 *     the top. Every ticket is identifiable even when separated.
 *   - Visit count: shows "Visit #N" (count of non-cancelled appointments for
 *     this client) so the technician knows immediately whether this is an
 *     established client with known preferences or someone new. Requires
 *     the optional `visitCount` prop from the parent.
 *   - Pre-fill callout: when formula was pre-loaded from the prior visit,
 *     a green "↩ Pre-loaded from last visit" banner appears above the
 *     checklist and pre-checked items render on a green background so they're
 *     visually distinct from items the tech manually checks in this session.
 *   - Station/chair assignment: optional `stationName` field on TicketData,
 *     shown in the meta row so "Chair 3" is printed and doesn't need to be
 *     communicated verbally.
 *   - QR code: generated entirely in-browser via the `qrcode` npm package
 *     (canvas → data URL, zero network calls, no blank-print risk). Falls
 *     back gracefully to the text code alone if the package isn't installed
 *     or canvas isn't available.
 *     To enable: `npm install qrcode` + `npm install --save-dev @types/qrcode`
 *
 * v2:
 *   - Fixed print CSS (scoped to #ticket-area-content instead of
 *     #print-ticket-area which was never in the DOM in the POS dialog).
 *   - Add-on formulas: separate checklist per add-on service.
 *   - Provider name in header.
 *   - 8-char check-in code at bottom.
 *
 * v1 — technician prep sheet: formula checklist, allergy/medical alerts,
 * guest context notes. NOT a client-facing confirmation.
 */

import React, { useState, useEffect, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { type Service, type Client, type Appointment } from '@/lib/data';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { AlertTriangle, FlaskConical, MapPin, ShieldPlus, MessageSquare, User, Fingerprint, Repeat, MapPinned } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { cn } from '@/lib/utils';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
        try { return parseISO(val); } catch { return new Date(val); }
    }
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

export interface TicketData {
  business: {
    name: string;
    phone: string;
  };
  client: Client;
  appointment: Appointment;
  service: Service;
  addOnServices?: Service[];
  staffName?: string;
  previousFormula?: { id: string; quantityUsed?: number; quantity?: number; unit?: string }[];
  // v3 additions — all optional, all graceful when absent
  visitCount?: number;       // total non-cancelled visits for this client
  stationName?: string;      // e.g. "Chair 3" — assigned at check-in
}

interface PrintTicketProps {
  data: TicketData;
}

// In-browser QR code generator using the `qrcode` npm package.
// Renders asynchronously into a canvas, then converts to a data URL image.
// If the package isn't installed or canvas fails, renders nothing (no crash).
function QRCodeCanvas({ value, size = 72 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    (async () => {
      try {
        const QRCode = (await import('qrcode')).default;
        const url = await QRCode.toDataURL(value, {
          width: size * 2,        // 2× for print sharpness
          margin: 1,
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        setDataUrl(url);
      } catch {
        // Package not installed — fallback renders below
      }
    })();
  }, [value, size]);

  if (!dataUrl) return null;
  return (
    <img
      src={dataUrl}
      alt="Scan to look up"
      width={size}
      height={size}
      className="rounded"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

// Formula section — extracted to avoid duplicating checklist logic for
// primary service + each add-on.
const FormulaSection = ({
  service,
  appointment,
  inventory,
  locations,
  checkedItems,
  onCheckChange,
  prefix,
  preCheckedKeys,
}: {
  service: Service;
  appointment: Appointment;
  inventory: any[];
  locations: any[];
  checkedItems: Set<string>;
  onCheckChange: (id: string) => void;
  prefix: string;
  preCheckedKeys: Set<string>;
}) => {
  const products = service.products || [];
  if (products.length === 0) {
    return (
      <p className="text-gray-400 text-[10px] font-bold uppercase pl-4 italic">
        Standard procedural tools — no listed formula.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {products.map((item: any, index: number) => {
        const product = inventory.find((p: any) => p.id === item.id);
        const location = locations.find((l: any) => l.id === product?.primaryLocationId);
        const itemNote = appointment.checkoutState?.formula?.find((f: any) => f.id === item.id)?.note;
        const key = `${prefix}-${index}`;
        const isPreFilled = preCheckedKeys.has(key);
        const isChecked = checkedItems.has(key);
        return (
          <div
            key={key}
            className={cn(
              'flex items-start gap-3 p-2 rounded-lg transition-colors',
              isPreFilled ? 'bg-green-50' : 'hover:bg-gray-50',
            )}
          >
            <Checkbox
              id={`fi-${key}`}
              checked={isChecked}
              onCheckedChange={() => onCheckChange(key)}
              className={cn(
                'print:border-gray-400 mt-0.5',
                isPreFilled && isChecked && 'data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600',
              )}
            />
            <Label htmlFor={`fi-${key}`} className="flex flex-col w-full cursor-pointer gap-0.5">
              <div className="flex justify-between w-full items-center">
                <div>
                  <span className={cn(
                    'font-bold uppercase text-[11px]',
                    isPreFilled ? 'text-green-800' : 'text-slate-800',
                  )}>{item.name}</span>
                  {location && (
                    <p className="text-[9px] text-gray-400 flex items-center gap-1 uppercase font-bold mt-0.5">
                      <MapPin className="w-2 h-2" />{location.name}
                    </p>
                  )}
                </div>
                <span className={cn(
                  'font-black font-mono text-[11px]',
                  isPreFilled ? 'text-green-700' : 'text-slate-500',
                )}>
                  {item.quantityUsed || item.quantity}{item.unit}
                </span>
              </div>
              {itemNote && (
                <div className="flex items-start gap-1.5 pt-1 mt-0.5 border-t border-dashed border-gray-100">
                  <MessageSquare className="w-2.5 h-2.5 text-gray-300 mt-0.5 shrink-0" />
                  <p className="text-[9px] font-medium text-gray-500 italic leading-tight">"{itemNote}"</p>
                </div>
              )}
            </Label>
          </div>
        );
      })}
    </div>
  );
};

export const PrintTicket: React.FC<PrintTicketProps> = ({ data }) => {
  const {
    business,
    client,
    service,
    appointment,
    addOnServices = [],
    staffName,
    previousFormula = [],
    visitCount,
    stationName,
  } = data;
  const { inventory, locations } = useInventory();

  const preCheckedKeys = React.useMemo(() => {
    const set = new Set<string>();
    if (!previousFormula.length) return set;
    (service.products || []).forEach((item: any, index: number) => {
      if (previousFormula.some(p => p.id === item.id)) set.add(`primary-${index}`);
    });
    addOnServices.forEach((addOn, addonIdx) => {
      (addOn.products || []).forEach((item: any, index: number) => {
        if (previousFormula.some(p => p.id === item.id)) set.add(`addon-${addonIdx}-${index}`);
      });
    });
    return set;
  }, [previousFormula, service.products, addOnServices]);

  const [checkedItems, setCheckedItems] = useState<Set<string>>(() => new Set(preCheckedKeys));

  const handleCheckChange = (key: string) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const displayDate = safeDate(appointment.startTime || (appointment as any).checkInTime);

  // FIX (v4): prefer the unambiguous-alphabet shortCode over slicing
  // checkInToken. checkInToken uses nanoid's default alphabet, which
  // includes characters (0/O, 1/I/L) that are genuinely indistinguishable
  // in a lot of printed ticket fonts — shortCode is generated specifically
  // to avoid that. Falls back to the old slice for appointments booked
  // before shortCode existed, so previously-printed tickets aren't the only
  // thing that breaks if this ships mid-shift.
  const checkInCode = (appointment as any).shortCode
    ? String((appointment as any).shortCode).toUpperCase()
    : appointment.checkInToken
      ? appointment.checkInToken.slice(-8).toUpperCase()
      : null;
  const checkInUrl = typeof window !== 'undefined' && appointment.checkInToken
    ? `${window.location.origin}/check-in/${appointment.checkInToken}`
    : null;

  const hasAlerts = !!(client.allergyNotes || client.medicalNotes);
  const hasPrefill = preCheckedKeys.size > 0;
  const isReturning = (visitCount || 0) > 1;

  return (
    <div
      id="ticket-area-content"
      className="bg-white text-black font-sans text-sm max-w-sm mx-auto print:max-w-none"
    >
      <style>{`
        @media print {
          body { background-color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body * { visibility: hidden; }
          #ticket-area-content, #ticket-area-content * { visibility: visible; }
          #ticket-area-content { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      {/* ── Brand bar ────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 px-4 py-3 flex items-center justify-between print:bg-slate-900">
        <div>
          <p className="text-white text-[11px] font-black uppercase tracking-widest">{business.name}</p>
          <p className="text-slate-500 text-[8px] font-bold uppercase tracking-wider mt-0.5">Tech Prep Sheet</p>
        </div>
        <div className="text-right">
          <p className="text-slate-400 text-[8px] font-bold uppercase">{format(displayDate, 'EEE MMM d')}</p>
          <p className="text-white text-[11px] font-mono font-bold">{format(displayDate, 'h:mm a')}</p>
        </div>
      </div>

      {/* ── Allergy/medical FIRST — v3 ───────────────────────────────────
          In v2 this came after the header. Moved to position 1 so it's
          the first thing a tech sees when they pick up the ticket. */}
      {hasAlerts && (
        <div className="border-b-2 border-red-200 bg-red-50 px-4 py-3 space-y-1.5 print:bg-red-50">
          {client.allergyNotes && (
            <div className="flex items-start gap-2 text-red-800">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-red-600" />
              <p className="text-[11px] font-bold leading-snug">
                <span className="font-black uppercase text-[9px] tracking-wider text-red-600 mr-1.5">Allergy</span>
                {client.allergyNotes}
              </p>
            </div>
          )}
          {client.medicalNotes && (
            <div className="flex items-start gap-2 text-red-900">
              <ShieldPlus className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-red-700" />
              <p className="text-[11px] font-bold leading-snug">
                <span className="font-black uppercase text-[9px] tracking-wider text-red-700 mr-1.5">Medical</span>
                {client.medicalNotes}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="p-4 space-y-4">

        {/* ── Client + Service header ───────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-black uppercase tracking-tight text-slate-900 leading-none truncate">{service.name}</p>
            {addOnServices.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {addOnServices.map(a => (
                  <span key={a.id} className="text-[9px] font-black uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                    + {a.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-black uppercase text-slate-900 leading-none">{client.name}</p>
            <div className="flex items-center justify-end gap-1.5 mt-1.5">
              {isReturning ? (
                <span className="text-[9px] font-black uppercase bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Repeat className="w-2.5 h-2.5" /> Visit #{visitCount}
                </span>
              ) : (
                <span className="text-[9px] font-black uppercase bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  New client
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Meta row: provider + station ─────────────────────────────── */}
        {(staffName || stationName) && (
          <div className="flex items-center gap-3 text-[10px] text-slate-400 font-bold uppercase">
            {staffName && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" /> {staffName}
              </span>
            )}
            {stationName && (
              <span className="flex items-center gap-1 text-blue-600 font-black">
                <MapPinned className="w-3 h-3" /> {stationName}
              </span>
            )}
          </div>
        )}

        {/* ── Pre-fill notice ───────────────────────────────────────────── */}
        {hasPrefill && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <Repeat className="w-3.5 h-3.5 text-green-600 shrink-0" />
            <p className="text-[10px] font-black text-green-700 uppercase tracking-wide">
              Formula pre-loaded from last visit — confirm before starting
            </p>
          </div>
        )}

        {/* ── Primary service formula ───────────────────────────────────── */}
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
            <FlaskConical className="h-3 w-3" />
            {addOnServices.length > 0 ? `${service.name} Formula` : 'Service Formula'}
          </p>
          <FormulaSection
            service={service}
            appointment={appointment}
            inventory={inventory}
            locations={locations}
            checkedItems={checkedItems}
            onCheckChange={handleCheckChange}
            prefix="primary"
            preCheckedKeys={preCheckedKeys}
          />
        </div>

        {/* ── Add-on formulas ───────────────────────────────────────────── */}
        {addOnServices.filter(s => (s.products || []).length > 0).map((addOn, idx) => (
          <div key={addOn.id}>
            <Separator className="mb-3" />
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
              <FlaskConical className="h-3 w-3" />
              {addOn.name} Formula
            </p>
            <FormulaSection
              service={addOn}
              appointment={appointment}
              inventory={inventory}
              locations={locations}
              checkedItems={checkedItems}
              onCheckChange={handleCheckChange}
              prefix={`addon-${idx}`}
              preCheckedKeys={preCheckedKeys}
            />
          </div>
        ))}

        {/* ── Guest context notes ───────────────────────────────────────── */}
        {client.notes && (
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Guest Context</p>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p className="text-slate-600 text-[11px] leading-relaxed font-medium italic">
                "{(client.notes as any).general || 'No general notes.'}"
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Check-in code + QR ───────────────────────────────────────────── */}
      {checkInCode && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.15em] text-slate-400 flex items-center gap-1 mb-1">
              <Fingerprint className="w-2.5 h-2.5" /> Check-in code
            </p>
            <p className="font-mono font-black text-xl tracking-[0.25em] text-slate-900">{checkInCode}</p>
            <p className="text-[8px] text-slate-400 mt-0.5">Type at POS desk to pull up record</p>
          </div>
          {checkInUrl && <QRCodeCanvas value={checkInUrl} size={64} />}
        </div>
      )}

      <div className="text-center py-3 border-t border-slate-100">
        <p className="text-slate-300 text-[7px] font-black uppercase tracking-[0.3em]">ClarityFlow Studio OS</p>
      </div>
    </div>
  );
};
