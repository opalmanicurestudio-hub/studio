

'use client';

import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, ShieldPlus, AlertTriangle, Ear } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { type Client } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export const ClientCard = ({ client, isSelected, onSelect }: { client: Client, isSelected: boolean, onSelect: () => void }) => {
    const lastAppointment = useMemo(() => {
        if (!client.lastAppointment) return null;
        return new Date(client.lastAppointment);
    }, [client.lastAppointment]);

    return (
        <Card className={cn(
            "transition-all duration-200 hover:shadow-lg hover:-translate-y-1",
            isSelected && "border-primary ring-2 ring-primary"
        )}>
            <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                    <div className="flex items-center pt-1">
                        <Checkbox
                            id={`select-${client.id}`}
                            checked={isSelected}
                            onCheckedChange={onSelect}
                            aria-label={`Select ${client.name}`}
                        />
                    </div>
                     <Avatar className="w-16 h-16 border">
                        <AvatarImage src={client.avatarUrl} alt={client.name} data-ai-hint="person portrait" className="object-cover"/>
                        <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <Link href={`/clients/${client.id}`} className="group">
                            <p className="font-semibold text-lg group-hover:underline truncate">{client.name}</p>
                        </Link>
                        {lastAppointment && (
                            <p className="text-sm text-muted-foreground">Last seen: {formatDistanceToNow(lastAppointment, { addSuffix: true })}</p>
                        )}
                    </div>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" className="-mt-1 h-8 w-8 flex-shrink-0">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Toggle menu</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                             <DropdownMenuItem asChild>
                                <Link href={`/clients/${client.id}`}>View/Edit Details</Link>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <div className="flex items-center justify-between text-sm">
                    <span className='text-muted-foreground'>Lifetime Value</span>
                    <Badge variant="outline" className="font-mono text-base">${(client.lifetimeValue || 0).toFixed(2)}</Badge>
                </div>
                <div className="flex items-center gap-2 border-t pt-3">
                    <TooltipProvider>
                         {client.medicalNotes && (
                            <Tooltip>
                                <TooltipTrigger><ShieldPlus className="w-5 h-5 text-red-500" /></TooltipTrigger>
                                <TooltipContent><p>Medical Alert</p></TooltipContent>
                            </Tooltip>
                         )}
                         {client.allergyNotes && (
                             <Tooltip>
                                <TooltipTrigger><AlertTriangle className="w-5 h-5 text-orange-500" /></TooltipTrigger>
                                <TooltipContent><p>Allergy Alert</p></TooltipContent>
                            </Tooltip>
                         )}
                          {client.sensoryNeeds && (
                             <Tooltip>
                                <TooltipTrigger><Ear className="w-5 h-5 text-blue-500" /></TooltipTrigger>
                                <TooltipContent><p>Sensory Needs</p></TooltipContent>
                            </Tooltip>
                         )}
                    </TooltipProvider>

                    <div className="flex-1 flex flex-wrap gap-1 justify-end">
                        {!!client.activeMembershipId && <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">Member</Badge>}
                        <Badge variant="secondary">VIP</Badge>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

    