'use client';

import React, { useState, useMemo } from 'react';
import { type Event, type EventChecklistItem } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Briefcase, User, Lock, MapPin, CheckSquare, DollarSign, Edit, Link, FilePlus, Receipt, FileText, ListChecks } from 'lucide-react';
import { format } from 'date-fns';
import { Checkbox } from '../ui/checkbox';
import { Separator } from '../ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
  SheetFooter
} from '@/components/ui/sheet';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { ImageUpload } from '../shared/ImageUpload';
import { AddTransactionDialog } from './AddTransactionDialog';
import { type Transaction } from '@/lib/financial-data';
import { Progress } from '../ui/progress';

interface EventCardProps {
    event: Event,
    transactions: Transaction[],
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onUpdateEvent: (updatedEvent: Event) => void;
    onEditEvent: (event: Event) => void;
    onAddTransaction: (transaction: any) => void;
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
            <div className='p-6 text-center flex-1 flex flex-col items-center justify-center'>
                 <Lock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                 <h3 className='font-semibold text-lg'>Blocked Time</h3>
                 <p className='text-muted-foreground'>This time is marked as unavailable.</p>
            </div>
        )
    }

    return (
        <>
            <ScrollArea className="flex-1 -mr-6 pr-6">
                <div className="p-6 space-y-6">
                    <div className="space-y-3">
                        <h4 className="font-medium text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-primary"/> Details</h4>
                        {event.notes && <p className="text-sm text-muted-foreground">{event.notes}</p>}
                        
                        <div className='flex flex-col gap-2 text-sm text-muted-foreground'>
                            {event.location && (
                                <div className="flex items-center gap-2">
                                    <MapPin className="w-4 h-4 flex-shrink-0" />
                                    <span>{event.location}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {event.checklist && event.checklist.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <h4 className="font-medium flex items-center gap-2"><ListChecks className="w-4 h-4 text-primary"/> Checklist</h4>
                            </div>
                            <div className="space-y-2">
                            {event.checklist.map((item) => (
                                <div key={item.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
                                    <Checkbox id={item.id} checked={item.completed} onCheckedChange={(checked) => onChecklistItemToggle(event.id, item.id, !!checked)} />
                                    <label htmlFor={item.id} className={cn("text-sm flex-1", item.completed && "line-through text-muted-foreground")}>{item.text}</label>
                                </div>
                            ))}
                            </div>
                        </div>
                    )}
                    
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <h4 className="font-medium text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary"/> Financials</h4>
                             <Button variant="outline" size="sm" onClick={onLogExpenseClick}><FilePlus className="w-4 h-4 mr-2"/> Log Expense</Button>
                        </div>
                        {transactions.length > 0 ? (
                             <div className="space-y-2">
                                {transactions.map(t => (
                                    <div key={t.id} className="flex justify-between items-center bg-muted/50 p-3 rounded-md">
                                        <div className='text-sm'>
                                            <p className='font-medium'>{t.description}</p>
                                            <p className='text-xs text-muted-foreground'>{t.paymentMethod}</p>
                                        </div>
                                        <p className="font-semibold text-sm text-destructive">-${t.amount.toFixed(2)}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground text-center p-4 border rounded-md">No expenses logged for this event.</p>
                        )}
                    </div>
                </div>
            </ScrollArea>
             <SheetFooter className="p-4 pt-4 border-t pr-6">
                <Button variant="outline" className="w-full" onClick={() => onEditEvent(event)}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Event
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
}: EventCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
    const isMobile = useIsMobile();

    const typeStyles = {
        personal: 'bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-300',
        business: 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300',
        blocked: 'border-gray-500/30',
    };

    let Icon;
    switch(event.type) {
        case 'personal': Icon = User; break;
        case 'business': Icon = Briefcase; break;
        case 'blocked': Icon = Lock; break;
    }

    const totalCost = transactions.reduce((acc, t) => acc + t.amount, 0);

    const handleLogExpenseClick = () => {
        setIsSheetOpen(false);
        setTimeout(() => {
            setIsAddTransactionOpen(true);
        }, 150); // Delay to allow sheet to close before dialog opens
    };
    
    const checklistProgress = useMemo(() => {
        if (!event.checklist || event.checklist.length === 0) return 0;
        const completed = event.checklist.filter(item => item.completed).length;
        return (completed / event.checklist.length) * 100;
    }, [event.checklist]);

    const TriggerCard = (
        <div 
            className={cn(
                "p-3 rounded-lg bg-card border w-full h-full flex flex-col cursor-pointer transition-all duration-300 overflow-hidden", 
                typeStyles[event.type],
                event.type === 'blocked' && "bg-[repeating-linear-gradient(-45deg,hsl(var(--card)),hsl(var(--card))_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]"
            )}
        >
            <div className="flex items-start justify-between gap-2 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <p className="font-semibold text-sm truncate flex-1">{event.title}</p>
                </div>
            </div>
            
            <div className='flex-grow mt-2 overflow-y-auto space-y-2'>
                {event.notes && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{event.notes}</p>
                )}
            </div>

            <div className="mt-auto pt-2 flex items-end justify-between">
                <p className="text-xs text-muted-foreground">{format(event.startTime, 'h:mm a')} - {format(event.endTime, 'h:mm a')}</p>
                {event.type !== 'blocked' && (
                    <div className="space-y-2">
                        {totalCost > 0 && (
                            <div className="flex items-center justify-end gap-1 text-xs font-semibold text-destructive">
                                <DollarSign className="w-3 h-3" />
                                <span>{totalCost.toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
    
    const DialogOrSheet = isMobile ? Sheet : Sheet;
    const DialogOrSheetContent = isMobile ? SheetContent : SheetContent;

    return (
        <>
            <DialogOrSheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>{TriggerCard}</SheetTrigger>
                <DialogOrSheetContent side={isMobile ? "bottom" : "right"} className={cn(isMobile ? "h-[90dvh]" : "sm:max-w-md", "flex flex-col p-0")}>
                    <SheetHeader className="p-6 pb-4">
                        <SheetTitle>{event.title}</SheetTitle>
                        <SheetDescription>
                            {format(event.startTime, 'EEEE, LLL d')} &middot; {format(event.startTime, 'h:mm a')} - {format(event.endTime, 'h:mm a')}
                        </SheetDescription>
                    </SheetHeader>
                    <Separator />
                    <EventDetailsContent 
                        event={event} 
                        transactions={transactions} 
                        onChecklistItemToggle={onChecklistItemToggle} 
                        onUpdateEvent={onUpdateEvent} 
                        onEditEvent={onEditEvent} 
                        onLogExpenseClick={handleLogExpenseClick}
                    />
                </DialogOrSheetContent>
            </DialogOrSheet>

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
