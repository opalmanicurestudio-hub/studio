
'use client';

import React from 'react';
import { type Event } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Briefcase, User, Lock, MapPin, CheckSquare, MoreHorizontal, FileText, Upload, Link as LinkIcon } from 'lucide-react';
import { format } from 'date-fns';
import { Progress } from '../ui/progress';
import { Checkbox } from '../ui/checkbox';
import { Separator } from '../ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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


interface EventCardProps {
    event: Event,
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
}

const EventDetailsContent = ({ event, onChecklistItemToggle }: EventCardProps) => {
    const completedCount = React.useMemo(() => event.checklist?.filter(item => item.completed).length || 0, [event.checklist]);
    const totalCount = React.useMemo(() => event.checklist?.length || 0, [event.checklist]);

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <h4 className="font-medium text-sm">Details</h4>
                {event.notes && <p className="text-sm text-muted-foreground">{event.notes}</p>}
                {event.location && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4" />
                        <span>{event.location}</span>
                    </div>
                )}
            </div>

            {event.checklist && event.checklist.length > 0 && (
                <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                        <h4 className="font-medium flex items-center gap-2"><CheckSquare className="w-4 h-4"/> Checklist</h4>
                        <span className="text-muted-foreground">{completedCount}/{totalCount} completed</span>
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
                <h4 className="font-medium text-sm flex items-center gap-2"><LinkIcon className="w-4 h-4"/> Linked Transactions</h4>
                <div className="p-4 text-center border-2 border-dashed rounded-lg">
                    <p className="text-sm text-muted-foreground mb-2">No transactions linked.</p>
                    <Button variant="outline" size="sm">Assign Transaction</Button>
                </div>
            </div>
            
            <div className="space-y-3">
                <h4 className="font-medium text-sm flex items-center gap-2"><Upload className="w-4 h-4"/> Receipts</h4>
                <div className="p-4 text-center border-2 border-dashed rounded-lg">
                    <p className="text-sm text-muted-foreground mb-2">No receipts uploaded.</p>
                    <ImageUpload onImageUploaded={(url) => console.log('Receipt uploaded:', url)} />
                </div>
            </div>
        </div>
    )
}

export function EventCard({ 
    event,
    onChecklistItemToggle,
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
    
    const checklistProgress = React.useMemo(() => {
        if (!event.checklist || event.checklist.length === 0) return null;
        const completed = event.checklist.filter(item => item.completed).length;
        const total = event.checklist.length;
        return {
            progress: (completed / total) * 100,
            text: `${completed}/${total}`
        };
    }, [event.checklist]);

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
              {/* Minimal content for the card itself can go here if needed */}
            </div>
            
            <div className="flex-shrink-0 mt-auto pt-2">
                {checklistProgress && (
                    <div className="space-y-1">
                        <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                            <span>Checklist</span>
                            <span>{checklistProgress.text}</span>
                        </div>
                        <Progress value={checklistProgress.progress} className="h-1" />
                    </div>
                )}
            </div>
        </div>
    );
    
    return (
        <Sheet>
            <SheetTrigger asChild>{TriggerCard}</SheetTrigger>
            <SheetContent side={isMobile ? "bottom" : "right"} className={cn(isMobile ? "h-[90dvh]" : "sm:max-w-md", "flex flex-col")}>
                 <SheetHeader className="pr-6">
                    <SheetTitle>{event.title}</SheetTitle>
                    <SheetDescription>
                         {format(event.startTime, 'EEEE, LLL d')} &middot; {format(event.startTime, 'h:mm a')} - {format(event.endTime, 'h:mm a')}
                    </SheetDescription>
                </SheetHeader>
                <Separator />
                <ScrollArea className="flex-1 -mr-6 pr-6">
                    <EventDetailsContent event={event} onChecklistItemToggle={onChecklistItemToggle} />
                </ScrollArea>
                <SheetFooter className="pt-4 border-t">
                    <Button variant="outline" className="w-full">Edit Event</Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
