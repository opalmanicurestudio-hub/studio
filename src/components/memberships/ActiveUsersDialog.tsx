
'use client';

import React from 'react';
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
import { clients, type Membership, type Package } from '@/lib/data';
import { format } from 'date-fns';

interface ActiveUsersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offering: Membership | Package | null;
}

export const ActiveUsersDialog: React.FC<ActiveUsersDialogProps> = ({ open, onOpenChange, offering }) => {
  if (!offering) return null;

  // Mock data for which clients have which offering
  const activeClients = clients.slice(0, Math.floor(Math.random() * clients.length) + 1);

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
                {activeClients.map(client => (
                    <div key={client.id} className="flex items-center gap-4">
                        <Avatar>
                            <AvatarImage src={client.avatarUrl} />
                            <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <p className="font-semibold">{client.name}</p>
                            <p className="text-sm text-muted-foreground">Joined: {format(new Date(client.lastAppointment), 'MMM d, yyyy')}</p>
                        </div>
                    </div>
                ))}
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
