
'use client';

import React from 'react';
import { format, parseISO } from 'date-fns';
import Image from 'next/image';
import { type Service } from '@/lib/data';

export interface WalkInTicketData {
  id: string;
  name: string;
  services: Service[];
  queuePosition: number;
  checkInTime: string;
}

export const PrintWalkInTicket: React.FC<{ data: WalkInTicketData }> = ({ data }) => {
  return (
    <div className="p-4 bg-white text-black font-sans text-sm w-[302px] mx-auto">
      <div className="text-center space-y-2 mb-4">
        <h1 className="text-2xl font-bold">Walk-in Ticket</h1>
        <p className="text-lg">Position: <span className="font-bold text-2xl">#{data.queuePosition}</span></p>
        <p className="text-xs text-gray-600">Checked in at {format(parseISO(data.checkInTime), 'h:mm a')}</p>
      </div>

      <div className="border-t border-b border-dashed border-black py-2 my-2">
        <p className="text-lg font-semibold">{data.name}</p>
      </div>

      <div className="mb-4">
        <p className="font-semibold mb-1">Services:</p>
        <ul className="list-disc list-inside text-xs">
          {data.services.map(s => <li key={s.id}>{s.name}</li>)}
        </ul>
      </div>
      
      <div className="flex justify-center">
        <Image
            src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(`clarityflow://walk-in/${data.id}`)}`}
            alt={`QR code for ticket ${data.id}`}
            width={120}
            height={120}
        />
      </div>
       <p className="text-center text-xs text-gray-500 mt-2">Scan to view details</p>
    </div>
  );
};
