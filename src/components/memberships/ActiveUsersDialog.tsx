
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Active Clients for {offering.name}</DialogTitle>
          <DialogDescription>
            A list of all clients who currently have this {('interval' in offering) ? 'membership' : 'package'}.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-72">
            <div className="space-y-4 pr-6">
                {activeClients.length > 0 ? (
                    activeClients.map(client => (
                        <div key={client.id} className="flex items-center gap-4">
                            <Avatar>
                                <AvatarImage src={client.avatarUrl} />
                                <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                                <p className="font-semibold">{client.name}</p>
                                {client.lastAppointment && (
                                  <p className="text-sm text-muted-foreground">Joined: {format(parseISO(client.lastAppointment), 'MMM d, yyyy')}</p>
                                )}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="flex items-center justify-center h-full pt-10">
                        <p className="text-muted-foreground">No clients have this offering yet.</p>
                    </div>
                )}
            </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
