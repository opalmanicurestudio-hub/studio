'use client';

import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { type Service, type Client, type Appointment } from '@/lib/data';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';
import { AlertTriangle, FlaskConical, MapPin, ShieldPlus, Clock } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
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
}

interface PrintTicketProps {
  data: TicketData;
}

export const PrintTicket: React.FC<PrintTicketProps> = ({ data }) => {
  const { client, service, appointment } = data;
  const { inventory, locations } = useInventory();
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const handleCheckChange = (itemId: string) => {
    const newCheckedItems = new Set(checkedItems);
    if (newCheckedItems.has(itemId)) {
      newCheckedItems.delete(itemId);
    } else {
      newCheckedItems.add(itemId);
    }
    setCheckedItems(newCheckedItems);
  };

  // Handle both appointment startTime and walk-in checkInTime
  const displayDate = safeDate(appointment.startTime || (appointment as any).checkInTime);

  return (
    <div className="p-4 bg-white text-black font-sans text-sm max-w-md mx-auto print:p-0" id="ticket-area-content">
       <style>{`
        @media print {
          body {
            background-color: white !important;
            -webkit-print-color-adjust: exact;
          }
          body * {
            visibility: hidden;
          }
          #print-ticket-area, #print-ticket-area * {
            visibility: visible;
          }
          #print-ticket-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
      <div className="text-center space-y-1 mb-6">
        <h1 className="text-2xl font-bold uppercase tracking-tight">{service.name}</h1>
        <p className="text-base font-black uppercase">{client.name}</p>
        <p className="text-gray-600 font-mono text-xs">{format(displayDate, 'MMM d, yyyy h:mm a')}</p>
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
        <div>
            <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 flex items-center gap-2">
                <FlaskConical className="h-3.5 w-3.5"/> 
                Service Formula
            </h2>
            <div className="space-y-2 pl-2">
                {(service.products && service.products.length > 0) ? (
                    service.products.map((item, index) => {
                        const product = inventory.find(p => p.id === item.id);
                        const location = locations.find(l => l.id === product?.primaryLocationId);
                        return (
                            <div key={index} className="flex items-start gap-3 p-2 rounded-md hover:bg-gray-50 print:hover:bg-transparent">
                                <Checkbox 
                                    id={`formula-item-${index}`}
                                    checked={checkedItems.has(`formula-${index}`)}
                                    onCheckedChange={() => handleCheckChange(`formula-${index}`)}
                                    className="print:border-gray-400 mt-1"
                                />
                                <Label htmlFor={`formula-item-${index}`} className="flex justify-between w-full cursor-pointer">
                                    <div className="text-left">
                                        <span className="font-bold uppercase text-[11px]">{item.name}</span>
                                        {location && <p className="text-[9px] text-gray-500 flex items-center gap-1 uppercase font-bold"><MapPin className="w-2.5 h-2.5" />{location.name}</p>}
                                    </div>
                                    <span className="font-black font-mono text-xs">{item.quantityUsed}{item.unit}</span>
                                </Label>
                            </div>
                        )
                    })
                ) : (
                    <p className="text-gray-500 text-[10px] font-bold uppercase pl-4 italic">Standard procedural tools.</p>
                )}
            </div>
        </div>

        {client.notes && (
             <div>
                <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Guest Context</h2>
                <div className="p-3 bg-gray-100 rounded-lg print:bg-gray-50 text-left">
                    <p className="text-gray-700 text-xs leading-relaxed font-medium italic">"{client.notes.general || 'No general dossier notes.'}"</p>
                </div>
            </div>
        )}

      </div>
       <div className="text-center mt-10 border-t border-dashed pt-4">
        <p className="text-gray-400 text-[8px] font-black uppercase tracking-[0.3em]">ClarityFlow Studio OS</p>
      </div>
    </div>
  );
};