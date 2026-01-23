

'use client';

import React from 'react';
import { format, parseISO } from 'date-fns';
import Image from 'next/image';
import { type Service } from '@/lib/data';
import { Separator } from '@/components/ui/separator';
import { ClarityFlowLogo } from '../shared/AppSidebar';
import { Clock, Scissors, CheckCircle, User } from 'lucide-react';

export interface WalkInTicketData {
  id: string;
  name: string;
  services: Service[];
  queuePosition: number;
  checkInTime: string;
}

const getServiceIcon = (serviceName: string) => {
    const name = serviceName.toLowerCase();
    if (name.includes('cut') || name.includes('trim')) return <Scissors className="w-4 h-4 text-gray-500" />;
    if (name.includes('color') || name.includes('polish') || name.includes('gel') || name.includes('manicure') || name.includes('balayage')) return <CheckCircle className="w-4 h-4 text-gray-500" />;
    if (name.includes('facial')) return <User className="w-4 h-4 text-gray-500" />;
    return <Clock className="w-4 h-4 text-gray-500" />;
};


export const PrintWalkInTicket: React.FC<{ data: WalkInTicketData }> = ({ data }) => {
  const totalDuration = data.services.reduce((acc, s) => acc + s.duration, 0);

  return (
    <div className="p-4 bg-white text-black font-sans text-sm w-[280px] mx-auto">
        <div className="text-center space-y-2 mb-3">
            <div className="flex justify-center">
                <ClarityFlowLogo />
            </div>
            <p className="font-bold">ClarityFlow Salon</p>
            <p className="text-gray-500 text-xs">{format(parseISO(data.checkInTime), 'MMM d, yyyy h:mm a')}</p>
        </div>
        
        <Separator className="my-3 border-dashed border-black" />

        <div className="text-center space-y-2 my-4">
             <p className="text-xs text-gray-600">Your Spot in Line</p>
             <h1 className="text-7xl font-extrabold text-primary leading-none">{data.queuePosition}</h1>
        </div>

        <div className="text-center">
             <p className="text-lg font-semibold">{data.name}</p>
        </div>
        
        <Separator className="my-3 border-dashed border-black" />

        <div className="mb-3">
            <h2 className="font-semibold mb-2">Requested Services</h2>
            <div className="space-y-1.5 text-xs">
            {data.services.map(s => (
                <div key={s.id} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        {getServiceIcon(s.name)}
                        <span>{s.name}</span>
                    </div>
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

        <Separator className="my-3 border-dashed border-black" />

        <div className="text-center space-y-2">
            <div className="flex justify-center">
                <Image
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(`clarityflow://walk-in/${data.id}`)}`}
                    alt={`QR code for ticket ${data.id}`}
                    width={120}
                    height={120}
                />
            </div>
            <p className="text-center text-gray-600 text-[10px] leading-tight max-w-[180px] mx-auto">Scan this code at the front desk when you are ready to check out.</p>
        </div>

        <div className="text-center mt-4">
            <p className="text-xs text-gray-500">Thank you for your patience!</p>
        </div>
    </div>
  );
};
