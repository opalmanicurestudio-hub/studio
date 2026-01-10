

'use client';

import React, { useState } from 'react';
import { type Event, type EventChecklistItem } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Briefcase, User, Lock, MapPin, CheckSquare, DollarSign, Edit, Link, FilePlus, Receipt } from 'lucide-react';
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

interface EventCardProps {
    event: Event,
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onUpdateEvent: (updatedEvent: Event) => void;
    onEditEvent: (event: Event) => void;
    onAddTransaction: (transaction: any) => void;
}

const EventDetailsContent = ({ event, onChecklistItemToggle, onUpdateEvent, onEditEvent, onAddTransaction }: {
    event: Event,
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onUpdateEvent: (updatedEvent: Event) => void;
    onEditEvent: (event: Event) => void;
    onAddTransaction: (transaction: any) => void;
}) => {
    const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
    
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
                    <div className="space-y-2">
                        <h4 className="font-medium text-sm">Details</h4>
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
                                <h4 className="font-medium flex items-center gap-2"><CheckSquare className="w-4 h-4"/> Checklist</h4>
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
                    
                    <Separator />

                     <div className="space-y-3">
                        <h4 className="font-medium text-sm flex items-center gap-2"><DollarSign className="w-4 h-4"/> Financials</h4>
                        {event.cost && event.cost > 0 && (
                             <div className="flex items-center justify-between p-3 rounded-md bg-muted/50 text-sm">
                                <span className="font-medium">Associated Cost</span>
                                <span className="font-semibold">${event.cost.toFixed(2)}</span>
                            </div>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setIsAddTransactionOpen(true)}><FilePlus className="w-4 h-4 mr-2"/> Log an Expense</Button>
                    </div>

                    
                    <Separator />
                    
                    <div className="space-y-3">
                        <h4 className="font-medium text-sm flex items-center gap-2"><Receipt className="w-4 h-4"/> Receipts</h4>
                        <div className="p-4 text-center border-2 border-dashed rounded-lg">
                            <p className="text-sm text-muted-foreground mb-2">No receipts uploaded.</p>
                            <ImageUpload onImageUploaded={(url) => console.log('Receipt uploaded:', url)} />
                        </div>
                    </div>
                </div>
            </ScrollArea>
             <SheetFooter className="pt-4 border-t pr-6">
                <Button variant="outline" className="w-full" onClick={() => onEditEvent(event)}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Event
                </Button>
            </SheetFooter>
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

export function EventCard({ 
    event,
    onChecklistItemToggle,
    onUpdateEvent,
    onEditEvent,
    onAddTransaction,
}: EventCardProps) {

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
    
    const TriggerCard = (
        <div 
            className={cn(
                "p-2 rounded-lg bg-card border w-full h-full flex flex-col cursor-pointer transition-all duration-300 overflow-hidden", 
                typeStyles[event.type],
                event.type === 'blocked' && "bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]"
            )}
        >
            <div className="flex items-start justify-between gap-2 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <p className="font-semibold text-xs truncate flex-1">{event.title}</p>
                </div>
                <p className="text-xs text-muted-foreground flex-shrink-0">{format(event.startTime, 'h:mm a')}</p>
            </div>
            
            <div className="flex-grow mt-2 overflow-y-auto">
            </div>
        </div>
    );
    
    const DialogOrSheet = isMobile ? Sheet : Sheet;
    const DialogOrSheetContent = isMobile ? SheetContent : SheetContent;

    return (
        <DialogOrSheet>
            <SheetTrigger asChild>{TriggerCard}</SheetTrigger>
            <DialogOrSheetContent side={isMobile ? "bottom" : "right"} className={cn(isMobile ? "h-[90dvh]" : "sm:max-w-md", "flex flex-col p-0")}>
                 <SheetHeader className="p-6 pb-4">
                    <SheetTitle>{event.title}</SheetTitle>
                    <SheetDescription>
                         {format(event.startTime, 'EEEE, LLL d')} &middot; {format(event.startTime, 'h:mm a')} - {format(event.endTime, 'h:mm a')}
                    </SheetDescription>
                </SheetHeader>
                <Separator />
                <EventDetailsContent event={event} onChecklistItemToggle={onChecklistItemToggle} onUpdateEvent={onUpdateEvent} onEditEvent={onEditEvent} onAddTransaction={onAddTransaction} />
            </DialogOrSheetContent>
        </DialogOrSheet>
    )
}
