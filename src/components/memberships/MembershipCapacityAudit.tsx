'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, AlertTriangle, Users, Clock, Sparkles, Zap, Info, CheckCircle2 } from 'lucide-react';
import { type Membership, type Client, type Staff, type Service } from '@/lib/data';
import { cn } from '@/lib/utils';

interface MembershipCapacityAuditProps {
    memberships: Membership[];
    clients: Client[];
    staff: Staff[];
    services: Service[];
    scheduleProfiles: any[];
    isLoading?: boolean;
}

export const MembershipCapacityAudit: React.FC<MembershipCapacityAuditProps> = ({
    memberships,
    clients,
    staff,
    services,
    scheduleProfiles,
    isLoading
}) => {
    const audit = useMemo(() => {
        if (!memberships || !clients || !staff || !services) return null;

        // 1. Calculate Monthly Liability (Hours promised to members)
        let totalMonthlyLiabilityMinutes = 0;
        clients.forEach(client => {
            const mId = client.activeMembershipId || client.subscription?.membershipId;
            if (!mId) return;

            const membership = memberships.find(m => m.id === mId);
            if (!membership) return;

            const perks = [
                ...(membership.includedServices || []),
                ...(membership.includedAddOns || [])
            ];
            
            perks.forEach(perk => {
                const svc = services.find(s => s.id === perk.id);
                if (svc) {
                    totalMonthlyLiabilityMinutes += (((svc.duration || 0) + (svc.padBefore || 0) + (svc.padAfter || 0)) * (perk.quantity || 1));
                }
            });
        });

        // 2. Calculate Total Studio Monthly Capacity (Hours available)
        // Aggregated from active staff weekly hours * 4.33
        const activeStaff = staff.filter(s => s.active !== false);
        let totalWeeklyCapacityMinutes = 0;

        activeStaff.forEach(member => {
            const week = member.availability?.week;
            if (!week) return;

            Object.values(week).forEach((day: any) => {
                if (day.enabled && day.start && day.end) {
                    const [startT, startP] = day.start.split(' ');
                    const [endT, endP] = day.end.split(' ');
                    
                    const getMinutes = (time: string, period: string) => {
                        let [h, m] = time.split(':').map(Number);
                        if (period === 'PM' && h < 12) h += 12;
                        if (period === 'AM' && h === 12) h = 0;
                        return h * 60 + m;
                    };

                    const duration = getMinutes(endT, endP) - getMinutes(startT, startP);
                    totalWeeklyCapacityMinutes += duration;
                }
            });
        });

        const totalMonthlyCapacityHours = (totalWeeklyCapacityMinutes * 4.33) / 60;
        const totalMonthlyLiabilityHours = totalMonthlyLiabilityMinutes / 60;
        const loadPercentage = totalMonthlyCapacityHours > 0 ? (totalMonthlyLiabilityHours / totalMonthlyCapacityHours) * 100 : 0;

        return {
            liability: totalMonthlyLiabilityHours,
            capacity: totalMonthlyCapacityHours,
            load: loadPercentage,
            staffCount: activeStaff.length,
            memberCount: clients.filter(c => c.activeMembershipId || c.subscription?.membershipId).length
        };
    }, [memberships, clients, staff, services]);

    if (!audit || audit.capacity === 0) return null;

    const status = audit.load < 50 ? 'safe' : audit.load < 75 ? 'balanced' : 'critical';

    return (
        <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-8 opacity-5 transition-opacity group-hover:opacity-10">
                <ShieldCheck className="w-32 h-32 text-primary" />
            </div>
            
            <CardHeader className="p-6 md:p-8 pb-4 text-left">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-primary rounded-xl">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Capacity Safeguard</span>
                </div>
                <CardTitle className="text-xl md:text-3xl font-black uppercase tracking-tighter leading-none">Subscription Liability Audit</CardTitle>
                <CardDescription className="text-xs md:text-sm font-medium text-slate-600 max-w-xl mt-2">
                    Ensuring studio fulfillment capacity for {audit.memberCount} active subscribers across {audit.staffCount} technicians.
                </CardDescription>
            </CardHeader>

            <CardContent className="p-6 md:p-8 pt-4 space-y-10">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end">
                    <div className="space-y-4 md:col-span-2">
                        <div className="flex justify-between items-end mb-2">
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest opacity-60">Membership Load Velocity</p>
                                <p className={cn(
                                    "text-4xl md:text-6xl font-black tracking-tighter font-mono",
                                    status === 'safe' ? 'text-primary' : status === 'balanced' ? 'text-indigo-600' : 'text-destructive'
                                )}>
                                    {audit.load.toFixed(1)}%
                                </p>
                            </div>
                            <Badge className={cn(
                                "h-6 px-3 border-none font-black text-[9px] uppercase tracking-widest shadow-lg",
                                status === 'safe' ? 'bg-green-500' : status === 'balanced' ? 'bg-indigo-600' : 'bg-destructive animate-pulse'
                            )}>
                                {status === 'safe' ? 'Operational Flow' : status === 'balanced' ? 'Optimal Yield' : 'Capacity Alert'}
                            </Badge>
                        </div>
                        <div className="h-4 w-full bg-muted rounded-full overflow-hidden border-2 border-white shadow-inner p-0.5">
                            <div 
                                className={cn(
                                    "h-full rounded-full transition-all duration-1000",
                                    status === 'safe' ? 'bg-green-500' : status === 'balanced' ? 'bg-primary' : 'bg-destructive'
                                )}
                                style={{ width: `${audit.load}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-40 px-1">
                            <span>0% Load</span>
                            <span>50% Target</span>
                            <span>100% Saturation</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-2xl bg-white border-2 border-primary/10 shadow-sm text-left">
                            <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60 flex items-center gap-1.5 mb-1"><Clock className="w-3 h-3"/> Liability</p>
                            <p className="text-lg md:text-xl font-black font-mono tracking-tighter text-slate-900">{audit.liability.toFixed(0)}h</p>
                        </div>
                        <div className="p-4 rounded-2xl bg-white border-2 border-primary/10 shadow-sm text-left">
                            <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60 flex items-center gap-1.5 mb-1"><Users className="w-3 h-3"/> Capacity</p>
                            <p className="text-lg md:text-xl font-black font-mono tracking-tighter text-slate-900">{audit.capacity.toFixed(0)}h</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-dashed border-primary/20">
                    <div className="flex items-start gap-4 text-left">
                        <div className="p-3 bg-white rounded-2xl shadow-inner border border-primary/10 shrink-0">
                            <Zap className="w-5 h-5 text-primary" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase text-slate-900">Availability Buffer</p>
                            <p className="text-[11px] font-medium text-slate-500 leading-relaxed">You have <strong>{(audit.capacity - audit.liability).toFixed(0)} hours</strong> of uncommitted monthly capacity for new member acquisition and retail walk-ins.</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-4 text-left">
                        <div className="p-3 bg-white rounded-2xl shadow-inner border border-primary/10 shrink-0">
                            <Info className="w-5 h-5 text-primary shrink-0 mt-0.5 opacity-40" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase text-slate-900">Strategic Guidance</p>
                            <p className="text-[11px] font-medium text-slate-500 leading-relaxed uppercase tracking-tight">
                                {status === 'safe' ? "Load is optimal. Aggressively market high-tier memberships to secure recurring revenue." : 
                                 status === 'balanced' ? "Load is balanced. Focus on high-margin retail sales to supplement the booked schedule." : 
                                 "Saturation detected. Consider adding a technician or increasing membership rates to restore studio flow."}
                            </p>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};