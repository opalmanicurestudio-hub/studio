
'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Printer, QrCode, ArrowRight, LayoutGrid, Tag, Coffee } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';
import { ClarityFlowLogo } from '../shared/AppSidebar';

interface PrintStationCardsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  tenantName: string;
  logoUrl?: string;
}

const StationCard = ({ 
    tenantId, 
    tenantName, 
    logoUrl, 
    seatNumber 
}: { 
    tenantId: string; 
    tenantName: string; 
    logoUrl?: string; 
    seatNumber: number 
}) => {
    const orderUrl = useMemo(() => {
        const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
        return `${baseUrl}/concierge/${tenantId}?seat=${seatNumber}`;
    }, [tenantId, seatNumber]);

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(orderUrl)}`;

    return (
        <div className="bg-white border-2 border-slate-900 rounded-[2rem] p-8 flex flex-col items-center justify-between gap-6 w-[300px] h-[450px] mx-auto break-inside-avoid shadow-sm print:shadow-none print:m-4">
            <div className="text-center space-y-3">
                <div className="relative w-12 h-12 mx-auto overflow-hidden rounded-xl bg-muted/5 border flex items-center justify-center">
                    {logoUrl ? (
                        <Image src={logoUrl} alt={tenantName} fill className="object-cover" />
                    ) : (
                        <ClarityFlowLogo className="w-8 h-8" />
                    )}
                </div>
                <p className="font-black uppercase tracking-tighter text-sm leading-tight">{tenantName}</p>
                <div className="h-px w-12 bg-slate-900/10 mx-auto" />
            </div>

            <div className="space-y-4 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Station Identity</p>
                <h2 className="text-7xl font-black tracking-tighter text-slate-900">#{seatNumber}</h2>
            </div>

            <div className="space-y-6 text-center">
                <div className="p-3 bg-white rounded-2xl shadow-xl border-2 border-slate-900/5">
                    <img src={qrUrl} alt="Ordering QR Code" className="w-24 h-24 mx-auto" />
                </div>
                <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-900">Scan to Order</p>
                    <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60 leading-relaxed px-4">
                        Unlock artisanal refreshments and studio amenities directly from your device.
                    </p>
                </div>
            </div>

            <div className="pt-2">
                <p className="text-[7px] font-black text-slate-300 uppercase tracking-[0.4em]">ClarityFlow Concierge</p>
            </div>
        </div>
    );
};

export const PrintStationCardsDialog: React.FC<PrintStationCardsDialogProps> = ({
  open,
  onOpenChange,
  tenantId,
  tenantName,
  logoUrl,
}) => {
  const [numStations, setNumStations] = useState(10);

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background flex flex-col h-[90dvh]">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <QrCode className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Collateral Generator</span>
          </div>
          <DialogTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Concierge Station Cards</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">Generate high-fidelity ordering tokens for your lounge.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
            <div className="p-8 border-b bg-white/50 flex flex-col sm:flex-row items-center justify-between gap-6 shrink-0">
                <div className="space-y-2 w-full sm:w-64 text-left">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Number of Stations</Label>
                    <div className="flex gap-2">
                        <Input 
                            type="number" 
                            value={numStations} 
                            onChange={e => setNumStations(Math.max(1, parseInt(e.target.value) || 1))}
                            className="h-12 rounded-xl border-2 font-black text-center text-lg shadow-inner bg-muted/5"
                        />
                        <Button variant="outline" className="h-12 px-6 rounded-xl border-2 font-black uppercase text-[10px]" onClick={() => setNumStations(numStations + 5)}>+ 5</Button>
                    </div>
                </div>
                <div className="p-4 rounded-2xl border-2 border-dashed bg-muted/10 flex items-start gap-3 max-w-sm">
                    <Info className="w-4 h-4 text-primary shrink-0 mt-0.5 opacity-40" />
                    <p className="text-[9px] font-bold text-slate-600 uppercase leading-relaxed tracking-tight">
                        Each card generates a unique ordering link that pre-identifies the guest's location for your technical team.
                    </p>
                </div>
            </div>

            <ScrollArea className="flex-1 bg-muted/20">
                <div className="p-8 grid grid-cols-1 sm:grid-cols-2 gap-8 print:block" id="station-cards-print-area">
                    {Array.from({ length: numStations }).map((_, i) => (
                        <StationCard 
                            key={i}
                            tenantId={tenantId}
                            tenantName={tenantName}
                            logoUrl={logoUrl}
                            seatNumber={i + 1}
                        />
                    ))}
                </div>
            </ScrollArea>
        </div>

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 shrink-0">
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-14 flex-1 font-black uppercase tracking-widest text-[10px] text-slate-400">Cancel</Button>
            <Button onClick={handlePrint} className="h-14 flex-[2] rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 group">
                <Printer className="mr-3 h-5 w-5" />
                Print Collateral Archive
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <style jsx global>{`
        @media print {
            body * { visibility: hidden !important; }
            #station-cards-print-area, #station-cards-print-area * { 
                visibility: visible !important;
            }
            #station-cards-print-area {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                background: white !important;
            }
            @page {
                size: portrait;
                margin: 0.5in;
            }
        }
      `}</style>
    </Dialog>
  );
};
