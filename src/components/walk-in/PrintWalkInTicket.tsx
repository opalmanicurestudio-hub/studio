

'use client';

import React from 'react';
import { format, parseISO } from 'date-fns';
import Image from 'next/image';
import { type Service } from '@/lib/data';
import { Separator } from '@/components/ui/separator';
import { ClarityFlowLogo } from '../shared/AppSidebar';
import { Clock, List } from 'lucide-react';

export interface WalkInTicketData {
  id: string;
  name: string;
  services: Service[];
  queuePosition: number;
  checkInTime: string;
}

export const PrintWalkInTicket: React.FC<{ data: WalkInTicketData }> = ({ data }) => {
  const totalDuration = data.services.reduce((acc, s) => acc + s.duration, 0);

  return (
    <div className="p-4 bg-white text-black font-sans text-sm w-[302px] mx-auto">
        <div className="text-center space-y-4 mb-4">
            <div className="flex justify-center">
                <ClarityFlowLogo />
            </div>
            <p className="text-xs text-gray-600">You are number</p>
            <h1 className="text-8xl font-extrabold text-primary -my-2">{data.queuePosition}</h1>
            <p className="text-lg font-bold">in the queue</p>
            <p className="text-xs text-gray-500">Checked in at {format(parseISO(data.checkInTime), 'h:mm a')}</p>
        </div>

        <Separator className="my-4 border-dashed border-black" />

        <div className="mb-4">
            <p className="text-lg font-semibold">{data.name}</p>
        </div>

        <div className="mb-4">
            <h2 className="font-semibold mb-2 flex items-center gap-2"><List className="w-4 h-4"/> Services</h2>
            <div className="space-y-2">
            {data.services.map(s => (
                <div key={s.id} className="flex justify-between text-xs">
                    <span>{s.name}</span>
                    <span className="text-gray-600">{s.duration} min</span>
                </div>
            ))}
            </div>
             <Separator className="my-2 border-dashed" />
             <div className="flex justify-between font-semibold text-xs">
                <span>Est. Total Time</span>
                <span>{totalDuration} min</span>
            </div>
        </div>

        <Separator className="my-4 border-dashed border-black" />

        <div className="text-center">
            <div className="flex justify-center">
                <Image
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`clarityflow://walk-in/${data.id}`)}`}
                    alt={`QR code for ticket ${data.id}`}
                    width={150}
                    height={150}
                />
            </div>
            <p className="text-center text-xs text-gray-600 mt-2">Scan with the front desk to check out.</p>
        </div>

        <div className="text-center mt-6">
            <p className="text-xs text-gray-500">Thank you for your patience!</p>
        </div>
    </div>
  );
};
