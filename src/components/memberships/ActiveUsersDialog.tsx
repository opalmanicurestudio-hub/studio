'use client';

import React, { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type Membership, type Package } from '@/lib/data';
import { format, parseISO } from 'date-fns';
import { useInventory } from '@/context/InventoryContext';
import { Users, Sparkles, Calendar, ArrowRight, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface ActiveUsersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offering: Membership | Package | null;
}

export const ActiveUsersDialog: React.FC<ActiveUsersDialogProps> = ({ open, onOpenChange, offering }) => {
  const { clients } = useInventory();

  const activeClients = useMemo(() => {
    if (!offering || !clients) return [];

    if ('interval' in offering) { // It's a Membership
        return clients.filter(client => client.activeMembershipId === offering.id);
    } else { // It's a Package
        return clients.filter(client => client.activePackages?.some(p => p.packageId === offering.id));
    }
  }, [offering, clients]);

  if (!offering) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background flex flex-col max-h-[85vh] sm:max-h-[80vh]">
        <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left flex-shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Operations Suite</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
            Active Portfolio
          </DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
            Guests currently enrolled in: <strong className="text-foreground">{offering.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
            <div className="p-8 space-y-3">
                {activeClients.length > 0 ? (
                    activeClients.map(client => (
                        <Link 
                            key={client.id} 
                            href={`/clients/${client.id}`}
                            onClick={() => onOpenChange(false)}
                            className="block group"
                        >
                            <div className="flex items-center gap-4 p-4 rounded-2xl border-2 border-transparent hover:border-primary/10 hover:bg-primary/[0.02] transition-all bg-white shadow-sm">
                                <Avatar className="h-12 w-12 border-2 border-background shadow-lg rounded-xl shrink-0 transition-transform group-hover:scale-105">
                                    <AvatarImage src={client.avatarUrl} className="object-cover" />
                                    <AvatarFallback className="font-black text-sm bg-primary/10 text-primary">{(client.name || 'G').charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0 text-left">
                                    <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">{client.name}</p>
                                    {client.lastAppointment && (
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 flex items-center gap-1.5 mt-0.5">
                                        <Calendar className="w-2.5 h-2.5" />
                                        Audit Entry: {format(parseISO(client.lastAppointment), 'MMM d, yyyy')}
                                    </p>
                                    )}
                                </div>
                                <div className="p-2 rounded-full bg-primary/5 text-primary opacity-0 group-hover:opacity-100 transition-all">
                                    <ArrowRight className="w-4 h-4" />
                                </div>
                            </div>
                        </Link>
                    ))
                ) : (
                    <div className="py-20 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-4">
                        <Sparkles className="w-12 h-12" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No Active Enrollment</p>
                    </div>
                )}
            </div>
        </ScrollArea>

        <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex-shrink-0">
          <Button 
            className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 active:scale-95 transition-all" 
            onClick={() => onOpenChange(false)}
          >
            Acknowledge Registry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
