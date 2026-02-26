'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ShieldPlus, AlertTriangle, Ear, Edit, Mail, Phone, ShieldAlert, Ban, Award } from 'lucide-react';
import { type Client } from '@/lib/data';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { formatPhoneNumber } from 'react-phone-number-input';

export const ClientCard = ({ client, isSelected, onSelect }: { client: Client, isSelected: boolean, onSelect: () => void }) => {
    const lastAppointment = useMemo(() => {
        if (!client.lastAppointment) return null;
        return new Date(client.lastAppointment);
    }, [client.lastAppointment]);
    
    const getInitials = (name: string) => {
        const parts = name.split(' ');
        if (parts.length > 1) {
            return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    // Ensure we handle Firestore FieldValues and potential corrupted data safely
    const safeLTV = useMemo(() => {
        const rawLtv = client.lifetimeValue;
        if (typeof rawLtv === 'object' || rawLtv === null || rawLtv === undefined) {
            return 0;
        }
        const val = Number(rawLtv);
        return isNaN(val) ? 0 : val;
    }, [client.lifetimeValue]);

    return (
        <Card className={cn(
            "transition-all duration-200 hover:shadow-lg hover:-translate-y-1 flex flex-col",
            isSelected && "border-primary ring-2 ring-primary",
            (client.activeMembershipId || client.subscription) && "border-indigo-500/30 bg-indigo-500/[0.02]"
        )}>
            <CardContent className="p-4 space-y-4 flex-1">
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
                        <AvatarFallback>{getInitials(client.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <Link href={`/clients/${client.id}`} className="group">
                            <p className="font-semibold text-lg group-hover:underline truncate">{client.name}</p>
                        </Link>
                        <div className="text-xs text-muted-foreground mt-2 space-y-1">
                            {client.email && (
                                <a href={`mailto:${client.email}`} className="flex items-center gap-2 hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>
                                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span className="truncate">{client.email}</span>
                                </a>
                            )}
                            {client.phone && (
                                <a href={`tel:${client.phone}`} className="flex items-center gap-2 hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>
                                    <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span className="truncate">{formatPhoneNumber(client.phone)}</span>
                                </a>
                            )}
                        </div>
                    </div>
                </div>
                 <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                        <span className='text-muted-foreground'>Lifetime Value</span>
                        <Badge variant="outline" className="font-mono text-base">${safeLTV.toFixed(2)}</Badge>
                    </div>
                    {lastAppointment && (
                        <div className="flex items-center justify-between">
                            <span className='text-muted-foreground'>Last seen</span>
                            <span className="font-medium">{formatDistanceToNow(lastAppointment, { addSuffix: true })}</span>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2 border-t pt-3">
                    <TooltipProvider>
                         {client.intel?.hasIncidents && (
                            <Tooltip>
                                <TooltipTrigger><ShieldAlert className="w-5 h-5 text-purple-500" /></TooltipTrigger>
                                <TooltipContent><p>Client has incident history</p></TooltipContent>
                            </Tooltip>
                         )}
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
                          {Array.isArray(client.intel?.incidents) && client.intel.incidents.some(i => i.type === 'No-Show') && (
                            <Tooltip>
                                <TooltipTrigger><Ban className="w-5 h-5 text-gray-500" /></TooltipTrigger>
                                <TooltipContent><p>No-Show History</p></TooltipContent>
                            </Tooltip>
                         )}
                    </TooltipProvider>

                    <div className="flex-1 flex wrap gap-1 justify-end">
                        {(client.activeMembershipId || client.subscription) && (
                            <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
                                <Award className="w-3 h-3 mr-1" />
                                Member
                            </Badge>
                        )}
                    </div>
                </div>
            </CardContent>
            <CardFooter className="p-2 border-t bg-muted/50">
                <Button variant="ghost" asChild className="w-full">
                    <Link href={`/clients/${client.id}`}>
                        <Edit className="mr-2 h-4 w-4" /> View / Edit Details
                    </Link>
                </Button>
            </CardFooter>
        </Card>
    )
}
