'use client';

import React from 'react';
import { format, parseISO } from 'date-fns';
import Image from 'next/image';
import { type Service } from '@/lib/data';
import { Scissors, CheckCircle, User, Clock, Sparkles } from 'lucide-react';

export interface WalkInTicketData {
  id: string;
  name: string;
  services: Service[];
  queuePosition: number;
  checkInTime: string;
  notes?: string;
  // studio branding passed from kiosk settings
  studioName?: string;
  studioLogoUrl?: string;
  groupName?: string;   // e.g. "Sofia's Party"
  groupTotal?: number;  // total guests in group
}

const getServiceIcon = (serviceName: string) => {
  const n = serviceName.toLowerCase();
  if (n.includes('cut') || n.includes('trim')) return <Scissors className="w-3 h-3" />;
  if (n.includes('color') || n.includes('polish') || n.includes('gel') || n.includes('manicure') || n.includes('balayage')) return <Sparkles className="w-3 h-3" />;
  if (n.includes('facial')) return <User className="w-3 h-3" />;
  return <Clock className="w-3 h-3" />;
};

export const PrintWalkInTicket: React.FC<{ data: WalkInTicketData }> = ({ data }) => {
  const totalDuration = data.services.reduce((acc, s) => acc + (s.duration || 0) + (s.padBefore || 0) + (s.padAfter || 0), 0);
  const checkInDate = (() => { try { return parseISO(data.checkInTime); } catch { return new Date(); } })();

  return (
    <div className="bg-white text-black font-sans w-[280px] mx-auto select-none" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── STUDIO HEADER ─────────────────────────────────────────────── */}
      <div className="flex flex-col items-center pt-5 pb-4 px-4 gap-2">
        {data.studioLogoUrl ? (
          <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-gray-100 shadow-sm">
            <Image src={data.studioLogoUrl} alt={data.studioName || 'Studio'} fill className="object-cover" />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={1.5} />
          </div>
        )}
        <div className="text-center">
          <p className="font-black uppercase tracking-tighter text-sm leading-none">{data.studioName || 'Studio'}</p>
          <p className="text-gray-400 text-[10px] mt-0.5">{format(checkInDate, 'EEEE, MMM d · h:mm a')}</p>
        </div>
      </div>

      {/* ── DASHED DIVIDER ────────────────────────────────────────────── */}
      <div className="border-t border-dashed border-gray-300 mx-3" />

      {/* ── QUEUE POSITION — BIG NUMBER ───────────────────────────────── */}
      <div className="text-center py-5 px-4">
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-400 mb-1">Queue Position</p>
        <p className="text-8xl font-black leading-none tracking-tighter text-gray-900">{data.queuePosition}</p>
      </div>

      {/* ── DASHED DIVIDER ────────────────────────────────────────────── */}
      <div className="border-t border-dashed border-gray-300 mx-3" />

      {/* ── GUEST INFO ────────────────────────────────────────────────── */}
      <div className="px-4 py-4 space-y-1">
        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Guest</p>
        <p className="text-xl font-black uppercase tracking-tight leading-tight text-gray-900">{data.name}</p>
        {data.groupName && (
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            {data.groupName}{data.groupTotal && data.groupTotal > 1 ? ` · Party of ${data.groupTotal}` : ''}
          </p>
        )}
      </div>

      {/* ── DASHED DIVIDER ────────────────────────────────────────────── */}
      <div className="border-t border-dashed border-gray-300 mx-3" />

      {/* ── SERVICES ──────────────────────────────────────────────────── */}
      <div className="px-4 py-4 space-y-2">
        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400 mb-2">Services</p>
        {data.services.map(s => (
          <div key={s.id} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-gray-700 min-w-0">
              {getServiceIcon(s.name)}
              <span className="text-xs font-semibold truncate">{s.name}</span>
            </div>
            <span className="text-[10px] text-gray-400 shrink-0 font-mono">{(s.duration || 0) + (s.padBefore || 0) + (s.padAfter || 0)}m</span>
          </div>
        ))}
        <div className="border-t border-dashed border-gray-200 mt-2 pt-2 flex justify-between items-center">
          <span className="text-[10px] font-black uppercase tracking-wide text-gray-500">Est. Total Time</span>
          <span className="text-[10px] font-black font-mono text-gray-700">{totalDuration}m</span>
        </div>
      </div>

      {/* ── NOTES (if any) ────────────────────────────────────────────── */}
      {data.notes && (
        <>
          <div className="border-t border-dashed border-gray-300 mx-3" />
          <div className="px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400 mb-1">Notes</p>
            <p className="text-[10px] text-gray-600 leading-relaxed">{data.notes}</p>
          </div>
        </>
      )}

      {/* ── DASHED DIVIDER ────────────────────────────────────────────── */}
      <div className="border-t border-dashed border-gray-300 mx-3" />

      {/* ── QR CODE ───────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center py-5 px-4 gap-2">
        <Image
          src={`https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(`walkin:${data.id}`)}&format=png&margin=0`}
          alt="Ticket QR"
          width={110}
          height={110}
          className="rounded-lg"
        />
        <p className="text-[9px] text-gray-400 text-center leading-relaxed max-w-[180px]">
          Scan at checkout or show this ticket to your provider.
        </p>
        <p className="text-[8px] font-mono text-gray-300 uppercase tracking-wider">{data.id.toUpperCase().slice(-8)}</p>
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 text-center py-3 px-4">
        <p className="text-[9px] text-gray-400 uppercase tracking-widest">Thank you for your patience</p>
      </div>

    </div>
  );
};