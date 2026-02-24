
'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { type Staff, type Appointment, type Service } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Clock, Coffee, GripVertical, Mail, Phone, ShieldAlert, ChevronDown, MoreHorizontal, TrendingUp, ArrowUp, ArrowDown } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { format, differenceInMinutes, parseISO, isPast, differenceInDays, differenceInSeconds } from 'date-fns';
import { Reorder } from 'framer-motion';
import { formatPhoneNumber } from 'react-phone-number-input';
import { Separator } from '../ui/separator';
import Link from 'next/link';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Label } from '../ui/label';

interface StaffStatusCardProps {
  member: Staff & { stats: any },
  onEdit: (member: Staff) => void,
  onStatusChange: (staffId: string, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => void,
  onViewActivity: (member: Staff & { stats: any }) => void,
  pricingTiers: any[],
}

export const StaffStatusCard: React.FC<StaffStatusCardProps> = ({ member, onEdit, onStatusChange, onViewActivity, pricingTiers }) => {
    const [licenseInfo, setLicenseInfo] = useState<{
        isExpired: boolean;
        isExpiringSoon: boolean;
        daysUntilExpiry: number | null;
        expiryDate: Date | null;
    } | null>(null);

    useEffect(() => {
        if (!member.compliance?.licenseExpiry) return;
        const licenseExpiry = parseISO(member.compliance.licenseExpiry);
        if (licenseExpiry) {
            const daysUntil = differenceInDays(licenseExpiry, new Date());
            const expired = isPast(licenseExpiry);
            const expiringSoon = daysUntil <= 30 && !expired;

            setLicenseInfo({
                isExpired: expired,
                isExpiringSoon: expiringSoon,
                daysUntilExpiry: daysUntil,
                expiryDate: licenseExpiry,
            });
        }
    }, [member.compliance?.licenseExpiry]);
    
    const getInitials = (name: string) => {
        const parts = name.split(' ');
        if (parts.length > 1) {
            return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    const renderActionButtons = () => {
        if (!member.active) {
            return <Button className="w-full" onClick={() => onStatusChange(member.id, 'clock_in')}><Clock className="mr-2 h-4 w-4"/>Clock In</Button>
        }
        if (member.onBreak) {
            return <Button className="w-full" variant="outline" onClick={() => onStatusChange(member.id, 'break_end')}><Coffee className="mr-2 h-4 w-4"/>End Break</Button>
        }
        return (
            <div className="grid grid-cols-2 gap-2 w-full">
                <Button variant="outline" onClick={() => onStatusChange(member.id, 'break_start')}><Coffee className="mr-2 h-4 w-4"/>Start Break</Button>
                <Button variant="destructive" onClick={() => onStatusChange(member.id, 'clock_out')}><Clock className="mr-2 h-4 w-4"/>Clock Out</Button>
            </div>
        )
    }

    return (
        <Card className="text-center flex flex-col">
            <CardHeader className="p-4">
                 <div className="flex justify-between items-start">
                    <Badge variant={member.active ? (member.onBreak ? 'secondary' : 'default') : 'outline'} className={cn("capitalize", {
                        'bg-green-100 text-green-800 dark:bg-green-900/50': member.active && !member.onBreak,
                        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50': member.active && member.onBreak,
                    })}>
                        {member.active ? (member.onBreak ? 'On Break' : 'Clocked In') : 'Clocked Out'}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex-1 flex flex-col items-center">
                <Avatar className="w-24 h-24 mx-auto mb-4">
                    <AvatarImage src={member.avatarUrl} alt={member.name} data-ai-hint="person portrait" />
                    <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-semibold">{member.name}</h3>
                <div className="flex items-center justify-center gap-2">
                    <p className="text-sm text-muted-foreground capitalize">{member.role}</p>
                    {member.pricingTierId && <Badge variant="outline" className="capitalize">{pricingTiers.find(pt => pt.id === member.pricingTierId)?.name}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-2 space-y-1 text-center">
                    {member.email && (
                        <a href={`mailto:${member.email}`} className="flex items-center justify-center gap-2 hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>
                            <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{member.email}</span>
                        </a>
                    )}
                    {member.phone && (
                        <a href={`tel:${member.phone}`} className="flex items-center justify-center gap-2 hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>
                            <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{formatPhoneNumber(member.phone)}</span>
                        </a>
                    )}
                </div>
                <Separator className="my-4" />
                <div className="w-full text-left space-y-3 text-sm">
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Total Sales</span><span className="font-semibold">${member.stats.totalSales.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Tips</span><span className="font-semibold">${member.stats.tips.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Consumption</span><span className="font-semibold">${member.stats.consumptionValue.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center font-bold"><span className="text-primary">Est. Take-home</span><span className="text-primary">${member.stats.earnings.toFixed(2)}</span></div>
                </div>

                {licenseInfo && (licenseInfo.isExpired || licenseInfo.isExpiringSoon) && (
                    <div className="mt-4 text-left p-3 rounded-lg bg-destructive/10 text-destructive text-xs flex items-start gap-2">
                        <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="font-semibold">{licenseInfo.isExpired ? 'License Expired' : 'License Expiring Soon'}</p>
                            <p>
                                {licenseInfo.isExpired 
                                ? `Expired on ${format(licenseInfo.expiryDate!, 'MMM d, yyyy')}.`
                                : `Expires in ${licenseInfo.daysUntilExpiry} days on ${format(licenseInfo.expiryDate!, 'MMM d, yyyy')}.`
                                }
                            </p>
                        </div>
                    </div>
                )}
            </CardContent>
            <CardFooter className="p-2 border-t mt-auto flex flex-col gap-2">
                {renderActionButtons()}
                <div className="grid grid-cols-2 gap-2 w-full">
                    <Button variant="secondary" size="sm" onClick={() => onViewActivity(member)}>
                        Dashboard
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => onEdit(member)}>
                        Edit Profile
                    </Button>
                </div>
                 <Button asChild variant="link" size="sm" className="text-xs h-auto py-1 w-full">
                    <Link href={`/staff/${member.id}`}>View Public Profile</Link>
                </Button>
            </CardFooter>
        </Card>
    )
};
