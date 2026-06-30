'use client';

/**
 * PrintTicket — v2
 *
 * v2:
 *   - FIX: the embedded print CSS scoped to `#print-ticket-area`, but the
 *     component's own outer div rendered with `id="ticket-area-content"`.
 *     In the POS "Ticket Issued" dialog there was no `#print-ticket-area`
 *     wrapper in the DOM at all — the CSS made everything visibility:hidden,
 *     found nothing to restore, and produced a blank page. The component
 *     worked in CheckInConfirmationDialog only accidentally, because that
 *     file happened to wrap it in a div with id="print-ticket-area". Fixed
 *     by scoping the print CSS to `#ticket-area-content` — now self-
 *     contained and correct regardless of where it is placed.
 *
 *   - NEW: add-on services. A booked Gel Overlay + Nail Art previously
 *     only printed the primary service's formula. Now accepts an optional
 *     `addOnServices` prop; each add-on that has its own products list gets
 *     its own formula section so every technician working the appointment
 *     has a complete prep sheet.
 *
 *   - NEW: provider name. Optional `staffName` field on TicketData — shown
 *     as a small "Assigned to" line so the ticket is useful even when it's
 *     handed across the room.
 *
 *   - NEW: check-in code. Prints the last 8 characters of checkInToken in
 *     large mono type at the bottom. Staff can type this into a lookup
 *     field (or scan a QR, once that exists) to pull up the appointment
 *     record from POS without searching by name.
 *
 * v1 — technician prep sheet: formula checklist, allergy/medical alerts,
 * guest context notes. NOT a client confirmation — see QuickBookForm's
 * SuccessScreen for that.
 */

import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { type Service, type Client, type Appointment } from '@/lib/data';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';
import { AlertTriangle, FlaskConical, MapPin, ShieldPlus, Clock, MessageSquare, User, Fingerprint } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';

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
  // v2 — optional additions. All backwards-compatible.
  addOnServices?: Service[];
  staffName?: string;
  // v3 — last visit's formula, used to pre-check matching product lines so
  // the technician doesn't start from a blank checklist for returning clients.
  previousFormula?: { id: string; quantityUsed?: number; quantity?: number; unit?: string }[];
}

interface PrintTicketProps {
  data: TicketData;
}

// Renders a formula section for one service (primary or add-on).
// Extracted so it can be called once for the primary service and once per
// add-on without duplicating the checklist logic.
const FormulaSection = ({
  service,
  appointment,
  inventory,
  locations,
  checkedItems,
  onCheckChange,
  prefix,
}: {
  service: Service;
  appointment: Appointment;
  inventory: any[];
  locations: any[];
  checkedItems: Set<string>;
  onCheckChange: (id: string) => void;
  prefix: string;
}) => {
  const products = service.products || [];
  if (products.length === 0) {
    return (
      <p className="text-gray-500 text-[10px] font-bold uppercase pl-4 italic">
        Standard procedural tools.
      </p>
    );
  }
  return (
    <div className="space-y-2 pl-2">
      {products.map((item: any, index: number) => {
        const product = inventory.find((p: any) => p.id === item.id);
        const location = locations.find((l: any) => l.id === product?.primaryLocationId);
        const itemNote = appointment.checkoutState?.formula?.find((f: any) => f.id === item.id)?.note;
        const key = `${prefix}-${index}`;
        return (
          <div key={key} className="flex items-start gap-3 p-2 rounded-md hover:bg-gray-50 print:hover:bg-transparent border-b last:border-none pb-3 mb-3">
            <Checkbox
              id={`formula-item-${key}`}
              checked={checkedItems.has(key)}
              onCheckedChange={() => onCheckChange(key)}
              className="print:border-gray-400 mt-1"
            />
            <Label htmlFor={`formula-item-${key}`} className="flex flex-col w-full cursor-pointer gap-1">
              <div className="flex justify-between w-full">
                <div className="text-left">
                  <span className="font-bold uppercase text-[11px]">{item.name}</span>
                  {location && (
                    <p className="text-[9px] text-gray-500 flex items-center gap-1 uppercase font-bold">
                      <MapPin className="w-2.5 h-2.5" />{location.name}
                    </p>
                  )}
                </div>
                <span className="font-black font-mono text-xs">{item.quantityUsed || item.quantity}{item.unit}</span>
              </div>
              {itemNote && (
                <div className="flex items-start gap-2 pt-1 mt-1 border-t border-dashed">
                  <MessageSquare className="w-3 h-3 text-gray-400 mt-0.5" />
                  <p className="text-[10px] font-medium text-gray-600 italic leading-tight">"{itemNote}"</p>
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
  const { client, service, appointment, addOnServices = [], staffName, previousFormula = [] } = data;
  const { inventory, locations } = useInventory();

  // v3 — pre-check items from the previous visit's formula. If the product
  // id and quantity match, it's almost certainly the same formula — the
  // technician can glance and confirm rather than re-building from scratch.
  const preChecked = React.useMemo(() => {
    const set = new Set<string>();
    if (!previousFormula.length) return set;
    (service.products || []).forEach((item: any, index: number) => {
      const prev = previousFormula.find(p => p.id === item.id);
      if (prev) set.add(`primary-${index}`);
    });
    (addOnServices || []).forEach((addOn, addonIdx) => {
      (addOn.products || []).forEach((item: any, index: number) => {
        const prev = previousFormula.find(p => p.id === item.id);
        if (prev) set.add(`addon-${addonIdx}-${index}`);
      });
    });
    return set;
  }, [previousFormula, service.products, addOnServices]);

  const [checkedItems, setCheckedItems] = useState<Set<string>>(() => new Set(preChecked));

  const handleCheckChange = (itemId: string) => {
    const next = new Set(checkedItems);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    setCheckedItems(next);
  };

  const displayDate = safeDate(appointment.startTime || (appointment as any).checkInTime);

  // v2 — short display code derived from the full checkInToken (same
  // approach as QuickBookForm's SuccessScreen). Staff can type this to
  // look up the appointment; no new infrastructure needed.
  const checkInCode = appointment.checkInToken
    ? appointment.checkInToken.slice(-8).toUpperCase()
    : null;

  return (
    <div className="p-4 bg-white text-black font-sans text-sm max-w-md mx-auto print:p-0" id="ticket-area-content">
      {/* v2 FIX: CSS now scopes to #ticket-area-content — the id this
          component actually renders with — instead of #print-ticket-area,
          which was never present in the DOM in the POS "Ticket Issued"
          dialog (causing blank-page prints). */}
      <style>{`
        @media print {
          body {
            background-color: white !important;
            -webkit-print-color-adjust: exact;
          }
          body * {
            visibility: hidden;
          }
          #ticket-area-content, #ticket-area-content * {
            visibility: visible;
          }
          #ticket-area-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>

      <div className="text-center space-y-1 mb-6">
        <h1 className="text-2xl font-bold uppercase tracking-tight">{service.name}</h1>
        {addOnServices.length > 0 && (
          <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">
            + {addOnServices.map(s => s.name).join(' · ')}
          </p>
        )}
        <p className="text-base font-black uppercase">{client.name}</p>
        <p className="text-gray-600 font-mono text-xs">{format(displayDate, 'MMM d, yyyy h:mm a')}</p>
        {/* v2 — provider name */}
        {staffName && (
          <p className="text-[10px] font-black uppercase text-gray-500 flex items-center justify-center gap-1">
            <User className="w-3 h-3" /> {staffName}
          </p>
        )}
      </div>

      {(client.allergyNotes || client.medicalNotes) && (
        <Card className="mb-4 bg-yellow-50 border-yellow-200 print:border-gray-200">
          <CardContent className="p-3 space-y-2">
            {client.allergyNotes && (
              <div className="flex items-start gap-2 text-yellow-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p className="text-sm"><strong>Allergy Alert:</strong> {client.allergyNotes}</p>
              </div>
            )}
            {client.medicalNotes && (
              <div className="flex items-start gap-2 text-red-800">
                <ShieldPlus className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p className="text-sm"><strong>Medical Alert:</strong> {client.medicalNotes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {/* Primary service formula */}
        <div>
          <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 flex items-center gap-2">
            <FlaskConical className="h-3.5 w-3.5" />
            {addOnServices.length > 0 ? `${service.name} Formula` : 'Service Formula'}
          </h2>
          <FormulaSection
            service={service}
            appointment={appointment}
            inventory={inventory}
            locations={locations}
            checkedItems={checkedItems}
            onCheckChange={handleCheckChange}
            prefix="primary"
          />
        </div>

        {/* v2 — add-on formulas, one section per add-on that has products */}
        {addOnServices.filter(s => (s.products || []).length > 0).map((addOn, idx) => (
          <div key={addOn.id}>
            <Separator className="my-3" />
            <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 flex items-center gap-2">
              <FlaskConical className="h-3.5 w-3.5" />
              {addOn.name} Formula
            </h2>
            <FormulaSection
              service={addOn}
              appointment={appointment}
              inventory={inventory}
              locations={locations}
              checkedItems={checkedItems}
              onCheckChange={handleCheckChange}
              prefix={`addon-${idx}`}
            />
          </div>
        ))}

        {client.notes && (
          <div>
            <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Guest Context</h2>
            <div className="p-3 bg-gray-100 rounded-lg print:bg-gray-50 text-left">
              <p className="text-gray-700 text-xs leading-relaxed font-medium italic">
                "{client.notes.general || 'No general dossier notes.'}"
              </p>
            </div>
          </div>
        )}
      </div>

      {/* v2 — check-in code for POS lookup / future QR scanning */}
      {checkInCode && (
        <div className="mt-6 pt-4 border-t border-dashed text-center space-y-1">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 flex items-center justify-center gap-1">
            <Fingerprint className="w-3 h-3" /> Check-in code
          </p>
          <p className="font-mono font-black text-2xl tracking-[0.3em] text-gray-900">{checkInCode}</p>
        </div>
      )}

      <div className="text-center mt-10 border-t border-dashed pt-4">
        <p className="text-gray-400 text-[8px] font-black uppercase tracking-[0.3em]">ClarityFlow Studio OS</p>
      </div>
    </div>
  );
};
