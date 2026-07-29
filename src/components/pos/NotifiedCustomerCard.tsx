'use client';

/**
 * NotifiedCustomerCard — v2
 *
 * v2 — THE BLANK CARD.
 *
 * This component was returning null for every kiosk-created walk-in, which is
 * why the Called lane showed its header and count and then nothing at all.
 *
 *     const assignedStaff = staff?.find(s => s.id === walkIn.assignedStaffId);
 *     if (!assignedStaff) return null;
 *
 * `assignedStaffId` is written in exactly ONE place in the application: the
 * POS terminal's handleAssignStaff. The walk-in engine (api/walkins) writes
 * `staffId`, because that is the field the staff portal, the lobby board and
 * the board's own sort all read. So a guest who came through the kiosk had a
 * provider on her row under a different name, this lookup missed it, and the
 * card erased itself — taking Start Session with it. There was no path from
 * Called to In Service because there was no card to tap.
 *
 * Fixed three ways, in order of importance:
 *
 *   1. Read `staffId` FIRST and fall back to `assignedStaffId`, so rows from
 *      either writer resolve.
 *
 *   2. NEVER return null. A guest who has been called is standing in the
 *      studio waiting for a chair. If her provider cannot be resolved — a
 *      deleted staff record, a row that predates the field, a genuine
 *      unassigned call — the answer is to show the card with an UNASSIGNED
 *      chip and let the desk act on it. A card that deletes itself is the one
 *      failure mode a floor board must never have: the guest does not
 *      disappear from the lobby just because a lookup missed.
 *
 *   3. The timer read `walkIn.notifiedTimestamp`; the engine writes
 *      `notifiedAt`. Both are read now. It also called parseISO directly on
 *      the value, which throws on a Firestore Timestamp — safeDate handles all
 *      three shapes.
 *
 * ALSO FIXED
 *   - The arrival buttons compared `walkIn.status` against 'pending' /
 *     'arrived' / etc. Those are checkInStatus values — handleUpdateStatus
 *     writes checkInStatus — so the comparison was against the wrong field and
 *     no button ever showed as active. Compares checkInStatus now.
 *   - `assignedStaff.name.split(' ')[0]` threw on a staff record with no name.
 *   - customerName falls back to clientName; the engine writes both, older
 *     rows may carry only one.
 *   - No JSX comments (SWC).
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type WalkIn, type Service, Staff } from '@/lib/data';
import {
    Clock,
    SkipForward,
    Play,
    XCircle,
    Users,
    Cake,
    Award,
    Repeat,
    Car,
    MapPin,
    AlertTriangle,
    UserX,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { useInventory } from '@/context/InventoryContext';

/**
 * Firestore timestamps arrive as an ISO string, a Firestore Timestamp, or a
 * raw millisecond number depending on which writer produced the row. parseISO
 * only handles the first and throws on the second.
 */
const safeDate = (val: any): Date | null => {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val?.toDate === 'function') {
        try { const d = val.toDate(); return isNaN(d.getTime()) ? null : d; } catch { return null; }
    }
    if (typeof val === 'number') { const d = new Date(val); return isNaN(d.getTime()) ? null : d; }
    const d = new Date(String(val));
    return isNaN(d.getTime()) ? null : d;
};

const firstNameOf = (val: any): string => String(val || '').trim().split(/\s+/)[0] || '';

const statusOptions = [
    { value: 'pending', label: 'Reset to Pending', icon: Clock, color: 'text-slate-400' },
    { value: 'on_my_way', label: 'Mark as On My Way', icon: Car, color: 'text-blue-500' },
    { value: 'arrived', label: 'Mark as Arrived', icon: MapPin, color: 'text-green-500' },
    { value: 'running_late', label: 'Mark as Running Late', icon: AlertTriangle, color: 'text-amber-500' },
];

export const NotifiedCustomerCard: React.FC<any> = ({ walkIn, staff, onStartService, onSkip, onCancel, onReturnToQueue, onUpdateStatus }) => {
    const { selectedTenant } = useTenant();
    const { clients } = useInventory();
    const [timeSinceNotified, setTimeSinceNotified] = useState('');
    const [isOverTime, setIsOverTime] = useState(false);

    const isWalkIn = true;

    /**
     * `notifiedAt` is the engine's field, `notifiedTimestamp` is the POS
     * terminal's. handleAssignStaff writes both; the kiosk route writes only
     * the first. Reading both is what makes the elapsed time show up at all.
     */
    const notifiedValue = walkIn?.notifiedAt || walkIn?.notifiedTimestamp || null;

    useEffect(() => {
        const notifiedAt = safeDate(notifiedValue);
        if (!notifiedAt) {
            setTimeSinceNotified('');
            setIsOverTime(false);
            return;
        }
        const updateTimer = () => {
            const minutes = Math.max(0, Math.floor((Date.now() - notifiedAt.getTime()) / 60000));
            setTimeSinceNotified(`${minutes}m`);
            const limit = Number(selectedTenant?.queueSkipTimeMinutes) || 0;
            setIsOverTime(limit > 0 && minutes > limit);
        };
        updateTimer();
        const interval = setInterval(updateTimer, 30000);
        return () => clearInterval(interval);
    }, [notifiedValue, selectedTenant]);

    const client = useMemo(() => clients?.find(c => c.id === walkIn?.clientId), [walkIn?.clientId, clients]);

    const isBirthdayToday = useMemo(() => {
        if (!client?.birthday) return false;
        const birth = safeDate(client.birthday);
        if (!birth) return false;
        const today = new Date();
        return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
    }, [client]);

    const isMember = !!(client?.activeMembershipId || client?.subscription);
    const hasPackage = (client?.activePackages?.length || 0) > 0;

    /**
     * staffId first. See the header — this single line is the whole bug.
     */
    const providerId = walkIn?.staffId || walkIn?.assignedStaffId || null;
    const assignedStaff = useMemo(
        () => (providerId ? (staff || []).find((s: any) => String(s.id) === String(providerId)) : null),
        [staff, providerId],
    );

    /**
     * The row carries a provider name of its own. If the staff record cannot be
     * resolved we can still tell the desk who this guest was sent to, rather
     * than showing nothing.
     */
    const providerLabel = firstNameOf(assignedStaff?.name || walkIn?.staffName);

    const displayName = walkIn?.customerName || walkIn?.clientName || 'Walk-in guest';

    return (
        <Card className={cn(
            'transition-all border-4 rounded-2xl overflow-hidden shadow-sm',
            isOverTime ? 'border-destructive bg-destructive/[0.03] animate-pulse' : 'border-green-500/20 bg-white',
        )}>
            <CardContent className="p-5 space-y-4">
                <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-left">
                            {isBirthdayToday && <Cake className="h-3.5 w-3.5 text-pink-500 animate-bounce shrink-0" />}
                            <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{displayName}</p>
                            {isMember && (
                                <Badge className="bg-indigo-600 text-white border-none text-[7px] font-black uppercase h-4 px-1.5 shadow-sm">
                                    <Award className="w-2 h-2 mr-0.5" /> MEM
                                </Badge>
                            )}
                            {hasPackage && (
                                <Badge className="bg-teal-600 text-white border-none text-[7px] font-black uppercase h-4 px-1.5 shadow-sm">
                                    <Repeat className="w-2 h-2 mr-0.5" /> PKG
                                </Badge>
                            )}
                        </div>

                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 text-[9px] font-black uppercase h-5">
                                {timeSinceNotified ? `Called ${timeSinceNotified} ago` : 'Called'}
                            </Badge>
                            {isOverTime && <Badge variant="destructive" className="animate-pulse h-5 text-[9px] uppercase font-black">CRITICAL: SKIP READY</Badge>}
                        </div>

                        {walkIn?.serviceName && (
                            <p className="text-[11px] font-bold text-muted-foreground mt-1.5 truncate">{walkIn.serviceName}</p>
                        )}

                        {providerLabel ? (
                            <div className="flex items-center gap-2 mt-4 p-2 rounded-xl bg-primary/5 border-2 border-primary/10 w-fit">
                                <Avatar className="h-7 w-7 border-2 border-background shadow-inner rounded-lg">
                                    <AvatarImage src={assignedStaff?.avatarUrl} className="object-cover" />
                                    <AvatarFallback className="text-[9px] font-black">{providerLabel.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 pr-2 text-left">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground leading-none mb-0.5">Professional</p>
                                    <p className="text-[11px] font-black text-primary uppercase tracking-tight truncate">{providerLabel}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 mt-4 p-2 rounded-xl bg-amber-500/5 border-2 border-amber-500/20 w-fit">
                                <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                                    <UserX className="w-3.5 h-3.5 text-amber-600" />
                                </div>
                                <div className="min-w-0 pr-2 text-left">
                                    <p className="text-[8px] font-black uppercase text-muted-foreground leading-none mb-0.5">Professional</p>
                                    <p className="text-[11px] font-black text-amber-700 uppercase tracking-tight">Unassigned</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex gap-1.5 p-2 bg-muted/20 rounded-xl border-2 border-transparent">
                    {statusOptions.map((status) => {
                        const Icon = status.icon;
                        const isActive = walkIn?.checkInStatus === status.value;
                        return (
                            <TooltipProvider key={status.value}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant={isActive ? 'default' : 'outline'}
                                            size="icon"
                                            className={cn('h-8 w-8 rounded-xl border-2 transition-all', isActive ? 'shadow-md' : 'text-muted-foreground/40 hover:border-primary/20')}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onUpdateStatus(walkIn.id, isWalkIn, status.value);
                                            }}
                                        >
                                            <Icon className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="rounded-xl border-2 font-black text-[10px] uppercase tracking-widest">{status.label}</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        );
                    })}
                </div>
            </CardContent>

            <div className="p-2 pt-0 grid grid-cols-1 gap-2">
                <Button
                    size="sm"
                    className="w-full h-12 rounded-xl font-black uppercase text-xs tracking-[0.2em] shadow-xl shadow-primary/20"
                    onClick={() => onStartService(walkIn.id)}
                >
                    <Play className="w-4 h-4 mr-2" /> Start Session
                </Button>

                <div className="grid grid-cols-3 gap-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" className="h-10 rounded-lg border-2 w-full" onClick={() => onReturnToQueue(walkIn.id)}>
                                    <Users className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px]">Return to Queue</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" className="h-10 rounded-lg border-2 text-amber-600 hover:bg-amber-50 w-full" onClick={() => onSkip(walkIn.id)}>
                                    <SkipForward className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px]">Mark No-Show</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" className="h-10 rounded-lg border-2 text-destructive hover:bg-destructive/5 w-full" onClick={() => onCancel(walkIn.id)}>
                                    <XCircle className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-black uppercase text-[10px]">Terminate Walk-in</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>
        </Card>
    );
};
