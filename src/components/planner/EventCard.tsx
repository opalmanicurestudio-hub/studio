'use client';

import React, { useState, useMemo } from 'react';
import { type Event, type EventChecklistItem } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Briefcase, User, Lock, MapPin, CheckSquare, DollarSign, Edit, Link, FilePlus, Receipt, FileText, ListChecks, Check, X, Sparkles } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { Checkbox } from '../ui/checkbox';
import { Separator } from '../ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { AddTransactionDialog } from './AddTransactionDialog';
import { type Transaction } from '@/lib/financial-data';
import { useTenant } from '@/context/TenantContext';
import { useUser } from '@/firebase';
import { Badge } from '@/components/ui/badge';

interface EventCardProps {
    event: Event,
    transactions: Transaction[],
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onUpdateEvent: (updatedEvent: Event) => void;
    onEditEvent: (event: Event) => void;
    onAddTransaction: (transaction: any) => void;
    onDeleteEvent: (eventId: string) => void;
}

const EventDetailsContent = ({ event, transactions, onChecklistItemToggle, onEditEvent, onLogExpenseClick }: {
    event: Event,
    transactions: Transaction[],
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onEditEvent: (event: Event) => void;
    onLogExpenseClick: () => void;
}) => {
    if (event.type === 'blocked') {
        return (
            <div className='p-12 text-center flex-1 flex flex-col items-center justify-center opacity-40'>
                 <Lock className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                 <h3 className='font-black uppercase tracking-widest text-sm'>Access Restricted</h3>
                 <p className='text-xs font-bold uppercase tracking-tight'>This slot is blocked for studio operations.</p>
            </div>
        )
    }

    return (
        <>
            <ScrollArea className="flex-1">
                <div className="p-8 space-y-10">
                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 text-primary opacity-40"/> Session Dossier
                        </h4>
                        {event.notes && <p className="text-sm font-medium text-slate-700 leading-relaxed italic">"{event.notes}"</p>}
                        
                        {event.location && (
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/50 border-2">
                                <MapPin className="w-3.5 h-3.5 text-primary opacity-40" />
                                <span className="text-[10px] font-black uppercase tracking-tight">{event.location}</span>
                            </div>
                        )}
                    </div>

                    {event.checklist && event.checklist.length > 0 && (
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                                <ListChecks className="w-3.5 h-3.5 text-primary opacity-40"/> Operations Checklist
                            </h4>
                            <div className="grid gap-2">
                            {event.checklist.map((item) => (
                                <div key={item.id} className="flex items-center gap-3 p-4 rounded-2xl bg-muted/20 border-2 transition-all hover:bg-muted/30 group">
                                    <Checkbox id={item.id} checked={item.completed} onCheckedChange={(checked) => onChecklistItemToggle(event.id, item.id, !!checked)} className="h-5 w-5 border-2" />
                                    <label htmlFor={item.id} className={cn("text-xs font-bold uppercase tracking-tight flex-1 cursor-pointer", item.completed && "line-through text-muted-foreground opacity-40")}>{item.text}</label>
                                </div>
                            ))}
                            </div>
                        </div>
                    )}
                    
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                                <DollarSign className="w-3.5 h-3.5 text-primary opacity-40"/> Resource Allocation
                            </h4>
                             <Button variant="ghost" size="sm" onClick={onLogExpenseClick} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5">
                                <FilePlus className="w-3 h-3 mr-1.5"/> Log Expense
                            </Button>
                        </div>
                        {transactions.length > 0 ? (
                             <div className="grid gap-2">
                                {transactions.map(t => (
                                    <div key={t.id} className="flex justify-between items-center bg-muted/20 p-4 rounded-2xl border-2">
                                        <div className='min-w-0'>
                                            <p className='font-black text-[11px] uppercase tracking-tight truncate'>{t.description}</p>
                                            <p className='text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-40'>{t.paymentMethod}</p>
                                        </div>
                                        <p className="font-black font-mono text-sm text-destructive tracking-tighter">-${t.amount.toFixed(2)}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-10 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                <Receipt className="w-8 h-8" />
                                <p className="text-[10px] font-black uppercase tracking-widest">No Expenditures</p>
                            </div>
                        )}
                    </div>
                </div>
            </ScrollArea>
             <SheetFooter className="p-8 pt-4 border-t bg-background flex-shrink-0">
                <Button variant="outline" className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] border-2" onClick={onEditEvent}>
                    <Edit className="w-4 h-4 mr-2" />
                    Modify Event
                </Button>
            </SheetFooter>
        </>
    )
}

export function EventCard({ 
    event,
    transactions,
    onChecklistItemToggle,
    onUpdateEvent,
    onEditEvent,
    onAddTransaction,
    onDeleteEvent,
}: EventCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
    const isMobile = useIsMobile();
    const { user, role } = useTenant();
    const isOwnerOrAdmin = role === 'owner' || role === 'admin';
    
    const duration = differenceInMinutes(event.endTime, event.startTime);

    const typeStyles = {
        personal: 'bg-blue-500/10 border-blue-500/30 text-blue-800',
        business: 'bg-primary/5 border-primary/20 text-primary',
        blocked: 'border-slate-300',
    };

    let Icon = Briefcase;
    if (event.type === 'personal') Icon = User;
    if (event.type === 'blocked') Icon = Lock;

    const totalCost = transactions.reduce((acc, t) => acc + t.amount, 0);

    const handleLogExpenseClick = () => {
        setIsSheetOpen(false);
        setTimeout(() => {
            setIsAddTransactionOpen(true);
        }, 150);
    };
    
    const TriggerCard = (
        <div 
            className={cn(
                "p-3 rounded-xl bg-card border-2 w-full h-full flex flex-col cursor-pointer transition-all duration-300 overflow-hidden relative group", 
                typeStyles[event.type],
                event.type === 'blocked' && "bg-[repeating-linear-gradient(-45deg,hsl(var(--card)),hsl(var(--card))_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]",
                event.status === 'pending' && 'opacity-60 hover:opacity-100 border-dashed'
            )}
        >
            <div className="flex items-start justify-between gap-2 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground opacity-40 flex-shrink-0 mt-0.5" />
                    <p className="font-black uppercase tracking-tight text-[11px] truncate flex-1 leading-none">{event.title}</p>
                </div>
                {event.status === 'pending' && <Badge variant="outline" className="text-[8px] h-4 px-1.5 uppercase font-black bg-white/50">REQ</Badge>}
            </div>
            
            <div className='flex-grow mt-2 overflow-hidden'>
                {event.notes && (
                    <p className="text-[10px] font-bold text-muted-foreground line-clamp-2 leading-relaxed italic opacity-60">"{event.notes}"</p>
                )}
            </div>

            <div className="mt-auto pt-2 flex items-end justify-between">
                {duration >= 30 ? (
                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-40 tracking-[0.1em]">{format(event.startTime, 'h:mm a')}</p>
                ) : <div />}
                {event.type !== 'blocked' && totalCost > 0 && (
                    <div className="flex items-center gap-1 text-[10px] font-black text-destructive tracking-tighter px-1.5 py-0.5 rounded bg-destructive/5 border border-destructive/10">
                        <DollarSign className="w-2.5 h-2.5" />
                        <span>{totalCost.toFixed(2)}</span>
                    </div>
                )}
            </div>
            {isOwnerOrAdmin && event.status === 'pending' && (
                <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <p className="text-[9px] font-black uppercase tracking-widest mb-1">Approval Required</p>
                    <div className="flex w-full gap-2">
                        <Button size="xs" variant="destructive" className="flex-1 h-8 rounded-lg font-black text-[8px] uppercase" onClick={(e) => { e.stopPropagation(); onDeleteEvent(event.id); }}>
                            Deny
                        </Button>
                        <Button size="xs" className="flex-1 h-8 rounded-lg font-black text-[8px] uppercase shadow-lg shadow-primary/20" onClick={(e) => { e.stopPropagation(); onUpdateEvent({ ...event, status: 'approved', approvedBy: user?.uid, approvedAt: new Date().toISOString() }); }}>
                            Approve
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
    
    return (
        <>
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <div className="h-full" onClick={() => setIsSheetOpen(true)}>
                    {TriggerCard}
                </div>
                <SheetContent side={isMobile ? "bottom" : "right"} className={cn(isMobile ? "h-[90vh] rounded-t-[3rem]" : "sm:max-w-xl", "flex flex-col p-0 border-none bg-background shadow-3xl")}>
                    <SheetHeader className="p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left">
                        <div className="flex items-center gap-3 mb-2">
                            <Sparkles className="w-5 h-5 text-primary" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Event Dossier</span>
                        </div>
                        <SheetTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900">{event.title}</SheetTitle>
                        <SheetDescription className="text-xs font-bold uppercase tracking-widest opacity-60">
                            {format(event.startTime, 'EEEE, LLL d')} &middot; {format(event.startTime, 'h:mm a')} - {format(event.endTime, 'h:mm a')}
                        </SheetDescription>
                    </SheetHeader>
                    <EventDetailsContent 
                        event={event} 
                        transactions={transactions} 
                        onChecklistItemToggle={onChecklistItemToggle} 
                        onEditEvent={() => { setIsSheetOpen(false); setTimeout(() => onEditEvent(event), 150); }}
                        onLogExpenseClick={handleLogExpenseClick}
                    />
                </SheetContent>
            </Sheet>

            <AddTransactionDialog
                open={isAddTransactionOpen}
                onOpenChange={setIsAddTransactionOpen}
                event={event}
                onConfirm={(newTransaction) => {
                    onAddTransaction(newTransaction);
                    setIsAddTransactionOpen(false);
                }}
            />
        </>
    )
}
