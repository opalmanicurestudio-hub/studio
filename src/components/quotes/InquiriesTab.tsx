'use client';

/**
 * InquiriesTab
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop this as a tab inside src/app/(app)/quotes/page.tsx
 *
 * Reads from: tenants/{tenantId}/quoteRequests
 * On "Convert to Quote": navigates to /quotes/new?from={requestId}
 * (The quote builder reads the ?from param and pre-fills everything)
 *
 * Export: <InquiriesTab tenantId={tenantId} />
 */

import React, { useState, useMemo } from 'react';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import {
    Inbox, ArrowRight, Check, Clock, Eye, X, Star, Loader,
    Phone, Mail, MessageSquare, Calendar, MapPin, Users, DollarSign,
    Scissors, Search, Filter, ChevronDown, ChevronUp, Copy,
    AlertTriangle, CheckCircle2, XCircle, Zap, RefreshCw,
    ExternalLink, Building, Plane, Car, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
    Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

// ─── Types ────────────────────────────────────────────────────────────────────
type InquiryStatus = 'new' | 'reviewing' | 'quoted' | 'converted' | 'closed';

const STATUS_CONFIG: Record<InquiryStatus, { label: string; color: string; dot: string }> = {
    new:       { label: 'New',       color: 'bg-violet-50 border-violet-200 text-violet-700', dot: 'bg-violet-500 animate-pulse' },
    reviewing: { label: 'Reviewing', color: 'bg-blue-50 border-blue-200 text-blue-700',       dot: 'bg-blue-400' },
    quoted:    { label: 'Quoted',    color: 'bg-amber-50 border-amber-200 text-amber-700',    dot: 'bg-amber-400' },
    converted: { label: 'Converted', color: 'bg-green-50 border-green-200 text-green-700',    dot: 'bg-green-500' },
    closed:    { label: 'Closed',    color: 'bg-slate-100 border-slate-200 text-slate-500',   dot: 'bg-slate-300' },
};

const BUDGET_LABELS: Record<string, string> = {
    under_500:  'Under $500',
    '500_1000': '$500 – $1,000',
    '1000_2500':'$1,000 – $2,500',
    '2500_5000':'$2,500 – $5,000',
    '5000_10000':'$5,000 – $10,000',
    over_10000: '$10,000+',
    flexible:   'Flexible',
};

const TIMELINE_LABELS: Record<string, string> = {
    asap:      'ASAP',
    '1_month': 'Within 1 month',
    '3_months':'1–3 months',
    '6_months':'3–6 months',
    '1_year':  '6–12 months',
    over_year: '1+ year away',
};

// ─── Inquiry Row Card ─────────────────────────────────────────────────────────
const InquiryCard = ({
    inquiry,
    onOpen,
    onQuickConvert,
    onMarkReviewing,
}: {
    inquiry: any;
    onOpen: (i: any) => void;
    onQuickConvert: (i: any) => void;
    onMarkReviewing: (i: any) => void;
}) => {
    const status = STATUS_CONFIG[inquiry.status as InquiryStatus] || STATUS_CONFIG.new;
    const isNew = inquiry.status === 'new' || !inquiry.viewed;
    const isHighPriority = inquiry.priority === 'high';

    return (
        <Card
            className={cn(
                'border-2 rounded-[2rem] overflow-hidden cursor-pointer transition-all hover:shadow-md group',
                isNew ? 'border-violet-200 bg-violet-50/30' : 'border-slate-200 bg-white',
                isHighPriority && 'ring-2 ring-amber-300/50'
            )}
            onClick={() => onOpen(inquiry)}
        >
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="h-10 w-10 rounded-xl border-2 border-white shadow-sm shrink-0">
                            <AvatarFallback className={cn(
                                'font-black text-[11px] rounded-xl',
                                isNew ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
                            )}>
                                {(inquiry.firstName || inquiry.fullName || '?')[0].toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <p className="font-black text-sm text-slate-900 truncate">
                                    {inquiry.fullName || `${inquiry.firstName} ${inquiry.lastName}`}
                                </p>
                                {isNew && (
                                    <span className="shrink-0 w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                                )}
                                {isHighPriority && (
                                    <Badge variant="outline" className="h-4 px-1.5 text-[8px] font-black border-amber-300 text-amber-700 bg-amber-50 shrink-0">
                                        HIGH VALUE
                                    </Badge>
                                )}
                            </div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase truncate">
                                {inquiry.email}
                            </p>
                        </div>
                    </div>
                    <Badge variant="outline" className={cn('h-6 px-2.5 font-black text-[9px] uppercase tracking-widest border shrink-0 flex items-center gap-1.5', status.color)}>
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', status.dot)} />
                        {status.label}
                    </Badge>
                </div>

                {/* Event summary */}
                <div className="space-y-1.5">
                    <p className="font-black text-sm text-slate-800 uppercase tracking-tight truncate">
                        {inquiry.eventName || inquiry.eventType || 'Unnamed Event'}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {inquiry.eventDate && (
                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                                <Calendar className="w-3 h-3 opacity-40" />
                                {format(new Date(inquiry.eventDate + 'T12:00:00'), 'MMM d, yyyy')}
                            </span>
                        )}
                        {inquiry.guestCount > 0 && (
                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                                <Users className="w-3 h-3 opacity-40" />
                                {inquiry.guestCount} guests
                            </span>
                        )}
                        {inquiry.budgetRange && (
                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                                <DollarSign className="w-3 h-3 opacity-40" />
                                {BUDGET_LABELS[inquiry.budgetRange] || inquiry.budgetRange}
                            </span>
                        )}
                    </div>
                </div>

                {/* Services */}
                {inquiry.interestedServices?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {inquiry.interestedServices.slice(0, 3).map((svc: any) => (
                            <Badge key={svc.id} variant="outline" className="h-5 px-2 text-[9px] font-black border-slate-200 text-slate-500">
                                {svc.name}
                            </Badge>
                        ))}
                        {inquiry.interestedServices.length > 3 && (
                            <Badge variant="outline" className="h-5 px-2 text-[9px] font-black border-slate-200 text-slate-400">
                                +{inquiry.interestedServices.length - 3} more
                            </Badge>
                        )}
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-dashed border-slate-200">
                    <p className="text-[9px] font-bold text-slate-400">
                        {inquiry.submittedAt
                            ? formatDistanceToNow(parseISO(inquiry.submittedAt), { addSuffix: true })
                            : 'Recently'}
                    </p>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {inquiry.status === 'new' && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest border-2"
                                onClick={(e) => { e.stopPropagation(); onMarkReviewing(inquiry); }}
                            >
                                <Eye className="w-3 h-3 mr-1" /> Review
                            </Button>
                        )}
                        {(inquiry.status === 'new' || inquiry.status === 'reviewing') && (
                            <Button
                                size="sm"
                                className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest shadow-md shadow-primary/20"
                                onClick={(e) => { e.stopPropagation(); onQuickConvert(inquiry); }}
                            >
                                <Zap className="w-3 h-3 mr-1" /> Build Quote
                            </Button>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

// ─── Detail Sheet ─────────────────────────────────────────────────────────────
const InquiryDetailSheet = ({
    inquiry,
    open,
    onOpenChange,
    onConvert,
    onUpdateStatus,
    onCopyShareLink,
}: {
    inquiry: any | null;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onConvert: (i: any) => void;
    onUpdateStatus: (id: string, status: InquiryStatus) => void;
    onCopyShareLink: (i: any) => void;
}) => {
    if (!inquiry) return null;
    const status = STATUS_CONFIG[inquiry.status as InquiryStatus] || STATUS_CONFIG.new;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col border-l-0 sm:border-l bg-background overflow-hidden">
                <SheetHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                            <SheetTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                                {inquiry.fullName || `${inquiry.firstName} ${inquiry.lastName}`}
                            </SheetTitle>
                            <SheetDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                                Submitted {inquiry.submittedAt
                                    ? format(parseISO(inquiry.submittedAt), 'MMM d, yyyy · h:mm a')
                                    : 'Recently'}
                            </SheetDescription>
                        </div>
                        <Badge variant="outline" className={cn('h-7 px-3 font-black text-[9px] uppercase tracking-widest border flex items-center gap-1.5 shrink-0', status.color)}>
                            <span className={cn('w-2 h-2 rounded-full', status.dot)} />
                            {status.label}
                        </Badge>
                    </div>
                </SheetHeader>

                <ScrollArea className="flex-1 min-h-0">
                    <div className="p-8 space-y-8 text-left">

                        {/* Contact */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Contact Information</p>
                            <div className="grid grid-cols-1 gap-2">
                                <a href={`mailto:${inquiry.email}`} className="flex items-center gap-3 p-3 rounded-2xl border-2 bg-white hover:border-primary/20 transition-all">
                                    <Mail className="w-4 h-4 text-primary/40 shrink-0" />
                                    <span className="font-bold text-sm text-slate-700">{inquiry.email}</span>
                                    <ExternalLink className="w-3 h-3 text-slate-300 ml-auto" />
                                </a>
                                <a href={`tel:${inquiry.phone}`} className="flex items-center gap-3 p-3 rounded-2xl border-2 bg-white hover:border-primary/20 transition-all">
                                    <Phone className="w-4 h-4 text-primary/40 shrink-0" />
                                    <span className="font-bold text-sm text-slate-700">{inquiry.phone}</span>
                                    <ExternalLink className="w-3 h-3 text-slate-300 ml-auto" />
                                </a>
                                <div className="flex items-center gap-3 p-3 rounded-2xl border-2 bg-muted/5">
                                    <MessageSquare className="w-4 h-4 text-primary/40 shrink-0" />
                                    <div className="text-left">
                                        <p className="font-black text-[9px] uppercase tracking-widest text-muted-foreground">Preferred Contact</p>
                                        <p className="font-bold text-sm text-slate-700 capitalize">{inquiry.preferredContact || 'Email'}</p>
                                    </div>
                                    {inquiry.bestTime && (
                                        <>
                                            <Clock className="w-4 h-4 text-primary/40 shrink-0 ml-4" />
                                            <div className="text-left">
                                                <p className="font-black text-[9px] uppercase tracking-widest text-muted-foreground">Best Time</p>
                                                <p className="font-bold text-sm text-slate-700">{inquiry.bestTime}</p>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        <Separator className="border-dashed" />

                        {/* Event */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Event Details</p>
                            <div className="grid grid-cols-2 gap-3">
                                <InfoTile icon={Calendar} label="Date" value={
                                    inquiry.eventDate
                                        ? format(new Date(inquiry.eventDate + 'T12:00:00'), 'MMMM d, yyyy')
                                        : 'TBD'
                                } />
                                {inquiry.alternateDateA && (
                                    <InfoTile icon={Calendar} label="Alt Date" value={
                                        format(new Date(inquiry.alternateDateA + 'T12:00:00'), 'MMMM d, yyyy')
                                    } />
                                )}
                                <InfoTile icon={Users} label="Total Guests" value={inquiry.guestCount?.toString() || '—'} />
                                <InfoTile icon={Scissors} label="# Needing Services" value={inquiry.partySize?.toString() || '—'} />
                                {inquiry.startTime && <InfoTile icon={Clock} label="Start Time" value={inquiry.startTime} />}
                                {inquiry.endTime && <InfoTile icon={Clock} label="End Time" value={inquiry.endTime} />}
                            </div>
                            {inquiry.eventLocation && (
                                <div className="flex items-start gap-3 p-3 rounded-2xl border-2 bg-muted/5">
                                    <MapPin className="w-4 h-4 text-primary/40 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-black text-[9px] uppercase tracking-widest text-muted-foreground">Location</p>
                                        <p className="font-bold text-sm text-slate-700">{inquiry.eventLocation}</p>
                                        {inquiry.venueType && (
                                            <p className="text-[10px] font-bold text-primary/60 uppercase mt-0.5">{inquiry.venueType.replace('_', '-')}</p>
                                        )}
                                    </div>
                                </div>
                            )}
                            {inquiry.travelRequired && inquiry.travelDetails && (
                                <div className="flex items-start gap-3 p-3 rounded-2xl border-2 bg-blue-50 border-blue-100">
                                    <Plane className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-black text-[9px] uppercase tracking-widest text-blue-600">Destination / Travel Required</p>
                                        <p className="font-bold text-sm text-blue-800">{inquiry.travelDetails}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <Separator className="border-dashed" />

                        {/* Services */}
                        {(inquiry.interestedServices?.length > 0 || inquiry.customServiceNote) && (
                            <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Requested Services</p>
                                {inquiry.interestedServices?.length > 0 && (
                                    <div className="space-y-2">
                                        {inquiry.interestedServices.map((svc: any) => (
                                            <div key={svc.id} className="flex items-center justify-between p-3 rounded-2xl border-2 bg-white">
                                                <p className="font-black text-sm text-slate-900 uppercase tracking-tight">{svc.name}</p>
                                                {svc.price > 0 && (
                                                    <p className="font-black font-mono text-sm text-primary">${svc.price}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {inquiry.customServiceNote && (
                                    <div className="p-4 rounded-2xl border-2 border-dashed bg-muted/5">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Custom Note</p>
                                        <p className="font-medium text-sm text-slate-700 leading-relaxed">{inquiry.customServiceNote}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <Separator className="border-dashed" />

                        {/* Budget & Timeline */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Investment</p>
                            <div className="grid grid-cols-2 gap-3">
                                <InfoTile icon={DollarSign} label="Budget" value={BUDGET_LABELS[inquiry.budgetRange] || inquiry.budgetRange || '—'} />
                                <InfoTile icon={Clock} label="Timeline" value={TIMELINE_LABELS[inquiry.timeline] || inquiry.timeline || '—'} />
                                {inquiry.readyToDeposit !== null && inquiry.readyToDeposit !== undefined && (
                                    <InfoTile
                                        icon={inquiry.readyToDeposit ? CheckCircle2 : Clock}
                                        label="Ready to Deposit"
                                        value={inquiry.readyToDeposit ? 'Yes — ready to book' : 'Needs more info'}
                                        valueColor={inquiry.readyToDeposit ? 'text-green-600' : 'text-slate-500'}
                                    />
                                )}
                                {inquiry.referralSource && (
                                    <InfoTile icon={Star} label="Found Us Via" value={inquiry.referralSource} />
                                )}
                            </div>
                        </div>

                        {/* Special Requests */}
                        {inquiry.specialRequests && (
                            <>
                                <Separator className="border-dashed" />
                                <div className="space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Special Requests</p>
                                    <div className="p-4 rounded-2xl border-2 border-dashed bg-muted/5">
                                        <p className="font-medium text-sm text-slate-700 leading-relaxed">{inquiry.specialRequests}</p>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Inspiration */}
                        {inquiry.inspirationLinks && (
                            <>
                                <Separator className="border-dashed" />
                                <div className="space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Inspiration</p>
                                    <div className="p-4 rounded-2xl border-2 border-dashed bg-muted/5">
                                        <p className="font-medium text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{inquiry.inspirationLinks}</p>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Status changer */}
                        <Separator className="border-dashed" />
                        <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Update Status</p>
                            <div className="flex flex-wrap gap-2">
                                {(Object.keys(STATUS_CONFIG) as InquiryStatus[]).map(s => (
                                    <Button
                                        key={s}
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                            'h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2 transition-all',
                                            inquiry.status === s ? 'border-slate-900 bg-slate-900 text-white' : ''
                                        )}
                                        onClick={() => onUpdateStatus(inquiry.id, s)}
                                    >
                                        {STATUS_CONFIG[s].label}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </div>
                </ScrollArea>

                {/* Footer CTAs */}
                <div className="p-8 pt-4 border-t bg-muted/5 flex-shrink-0 space-y-3">
                    {(inquiry.status === 'new' || inquiry.status === 'reviewing') && (
                        <Button
                            className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20"
                            onClick={() => onConvert(inquiry)}
                        >
                            <Zap className="mr-2 h-4 w-4" />
                            Build Quote from This Inquiry
                        </Button>
                    )}
                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            className="flex-1 h-12 rounded-2xl font-black uppercase text-[9px] tracking-widest border-2"
                            onClick={() => onCopyShareLink(inquiry)}
                        >
                            <Copy className="mr-2 h-3.5 w-3.5" /> Copy Inquiry Link
                        </Button>
                        <Button
                            variant="outline"
                            className="flex-1 h-12 rounded-2xl font-black uppercase text-[9px] tracking-widest border-2"
                            onClick={() => onOpenChange(false)}
                        >
                            Close
                        </Button>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
};

// ─── Info tile helper ─────────────────────────────────────────────────────────
const InfoTile = ({
    icon: Icon, label, value, valueColor,
}: { icon: any; label: string; value: string; valueColor?: string }) => (
    <div className="p-3 rounded-2xl border-2 bg-muted/5 space-y-1 text-left">
        <div className="flex items-center gap-1.5">
            <Icon className="w-3 h-3 text-primary/40" />
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
        </div>
        <p className={cn('font-black text-sm text-slate-900', valueColor)}>{value}</p>
    </div>
);

// ─── Main InquiriesTab component ──────────────────────────────────────────────
export const InquiriesTab = ({ tenantId }: { tenantId: string }) => {
    const { firestore } = useFirebase();
    const router = useRouter();
    const { toast } = useToast();

    const requestsQ = useMemoFirebase(
        () => tenantId ? collection(firestore, `tenants/${tenantId}/quoteRequests`) : null,
        [firestore, tenantId]
    );
    const { data: requests, isLoading } = useCollection<any>(requestsQ);

    const [search,       setSearch]       = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selected,     setSelected]     = useState<any | null>(null);
    const [sheetOpen,    setSheetOpen]    = useState(false);

    const filtered = useMemo(() => {
        if (!requests) return [];
        return requests
            .filter(r => {
                const q = search.toLowerCase();
                const matchesSearch = !search ||
                    (r.fullName || '').toLowerCase().includes(q) ||
                    (r.email || '').toLowerCase().includes(q) ||
                    (r.eventName || '').toLowerCase().includes(q) ||
                    (r.phone || '').includes(q);
                const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => {
                // New + high priority first
                const pa = a.priority === 'high' ? 1 : 0;
                const pb = b.priority === 'high' ? 1 : 0;
                if (pb !== pa) return pb - pa;
                return (b.submittedAt || '').localeCompare(a.submittedAt || '');
            });
    }, [requests, search, statusFilter]);

    const stats = useMemo(() => {
        if (!requests) return { total: 0, newCount: 0, highValue: 0, converted: 0 };
        return {
            total:     requests.length,
            newCount:  requests.filter(r => r.status === 'new' || !r.viewed).length,
            highValue: requests.filter(r => r.priority === 'high').length,
            converted: requests.filter(r => r.status === 'converted').length,
        };
    }, [requests]);

    const handleOpen = (inquiry: any) => {
        setSelected(inquiry);
        setSheetOpen(true);
        // Mark as viewed
        if (!inquiry.viewed && firestore && tenantId) {
            updateDocumentNonBlocking(
                doc(firestore, `tenants/${tenantId}/quoteRequests`, inquiry.id),
                { viewed: true, status: inquiry.status === 'new' ? 'reviewing' : inquiry.status }
            );
        }
    };

    const handleConvert = (inquiry: any) => {
        // Mark as converted + navigate to quote builder pre-filled
        if (firestore && tenantId) {
            updateDocumentNonBlocking(
                doc(firestore, `tenants/${tenantId}/quoteRequests`, inquiry.id),
                { status: 'quoted' }
            );
        }
        setSheetOpen(false);
        router.push(`/quotes/new?from=${inquiry.id}`);
    };

    const handleMarkReviewing = (inquiry: any) => {
        if (!firestore || !tenantId) return;
        updateDocumentNonBlocking(
            doc(firestore, `tenants/${tenantId}/quoteRequests`, inquiry.id),
            { status: 'reviewing', viewed: true }
        );
        toast({ title: "Marked as Reviewing" });
    };

    const handleUpdateStatus = (id: string, status: InquiryStatus) => {
        if (!firestore || !tenantId) return;
        updateDocumentNonBlocking(
            doc(firestore, `tenants/${tenantId}/quoteRequests`, id),
            { status }
        );
        if (selected?.id === id) setSelected((prev: any) => ({ ...prev, status }));
        toast({ title: `Status updated to ${STATUS_CONFIG[status].label}` });
    };

    const handleCopyShareLink = (inquiry: any) => {
        const url = `${window.location.origin}/inquiry/${tenantId}`;
        navigator.clipboard.writeText(url);
        toast({ title: "Inquiry Link Copied", description: "Share this link so clients can submit requests." });
    };

    return (
        <div className="space-y-6">
            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    { label: 'Total Inquiries', value: stats.total,     highlight: false },
                    { label: 'Unread',           value: stats.newCount,  highlight: stats.newCount > 0 },
                    { label: 'High Value',       value: stats.highValue, highlight: false },
                    { label: 'Converted',        value: stats.converted, highlight: false },
                ].map(s => (
                    <div key={s.label} className={cn(
                        'p-4 rounded-[1.5rem] border-2 text-left',
                        s.highlight ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'
                    )}>
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{s.label}</p>
                        <p className={cn('text-3xl font-black mt-0.5', s.highlight ? 'text-violet-700' : 'text-slate-900')}>{s.value}</p>
                    </div>
                ))}
            </div>

            {/* Share link callout */}
            <div className="flex items-center justify-between gap-4 p-4 rounded-2xl border-2 border-dashed border-primary/20 bg-primary/[0.02]">
                <div className="space-y-0.5 text-left">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary">Your Inquiry Link</p>
                    <p className="text-[10px] font-bold text-muted-foreground opacity-60">
                        Share this URL so prospective clients can submit a request
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2 shrink-0"
                    onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/inquiry/${tenantId}`);
                        toast({ title: "Link Copied!" });
                    }}
                >
                    <Copy className="w-3 h-3 mr-1.5" /> Copy Link
                </Button>
            </div>

            {/* Filters */}
            <div className="flex gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                    <Input
                        placeholder="SEARCH BY NAME, EMAIL OR EVENT..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-12 h-12 rounded-2xl border-2 font-black uppercase text-xs tracking-widest bg-white"
                    />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest w-40 bg-white shrink-0">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-2 shadow-xl">
                        <SelectItem value="all"       className="font-bold">All</SelectItem>
                        <SelectItem value="new"       className="font-bold">New</SelectItem>
                        <SelectItem value="reviewing" className="font-bold">Reviewing</SelectItem>
                        <SelectItem value="quoted"    className="font-bold">Quoted</SelectItem>
                        <SelectItem value="converted" className="font-bold">Converted</SelectItem>
                        <SelectItem value="closed"    className="font-bold">Closed</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* List */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                    <Loader className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Loading Inquiries...</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-24 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-6">
                    <Inbox className="w-16 h-16" />
                    <div className="space-y-2">
                        <p className="font-black uppercase tracking-widest text-sm">
                            {search || statusFilter !== 'all' ? 'No matches found' : 'Inbox is clear'}
                        </p>
                        <p className="text-xs font-bold uppercase tracking-widest opacity-60">
                            Share your inquiry link to start receiving requests
                        </p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filtered.map(req => (
                        <InquiryCard
                            key={req.id}
                            inquiry={req}
                            onOpen={handleOpen}
                            onQuickConvert={handleConvert}
                            onMarkReviewing={handleMarkReviewing}
                        />
                    ))}
                </div>
            )}

            {/* Detail sheet */}
            <InquiryDetailSheet
                inquiry={selected}
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                onConvert={handleConvert}
                onUpdateStatus={handleUpdateStatus}
                onCopyShareLink={handleCopyShareLink}
            />
        </div>
    );
};

export default InquiriesTab;