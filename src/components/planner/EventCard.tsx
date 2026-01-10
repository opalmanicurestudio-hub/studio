
'use client';

import React from 'react';
import { type Event } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Briefcase, User, Lock, MapPin, CheckSquare, MoreHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { Progress } from '../ui/progress';
import { Checkbox } from '../ui/checkbox';
import { Separator } from '../ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface EventCardProps {
    event: Event,
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
}

export function EventCard({ 
    event,
    onChecklistItemToggle,
}: EventCardProps) {

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
        if (!event.checklist || event.checklist.length === 0) return 0;
        const completed = event.checklist.filter(item => item.completed).length;
        return (completed / event.checklist.length) * 100;
    }, [event.checklist]);

    const completedCount = React.useMemo(() => event.checklist?.filter(item => item.completed).length || 0, [event.checklist]);
    const totalCount = React.useMemo(() => event.checklist?.length || 0, [event.checklist]);

    return (
        <Popover>
            <PopoverTrigger asChild>
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
                        {event.checklist && event.checklist.length > 0 && (
                            <div className="space-y-1">
                                <Progress value={checklistProgress} className="h-1" />
                            </div>
                        )}
                    </div>
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-80" side="right" align="start">
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <h4 className="font-semibold leading-none">{event.title}</h4>
                        <p className="text-sm text-muted-foreground">
                            {format(event.startTime, 'h:mm a')} - {format(event.endTime, 'h:mm a')}
                        </p>
                    </div>
                    <Separator />
                    {event.notes && <p className="text-sm text-muted-foreground">{event.notes}</p>}
                    {event.location && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <MapPin className="w-4 h-4" />
                            <span>{event.location}</span>
                        </div>
                    )}
                    {event.checklist && event.checklist.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <h5 className="font-medium flex items-center gap-2"><CheckSquare className="w-4 h-4"/> Checklist</h5>
                                <span className="text-muted-foreground">{completedCount}/{totalCount} completed</span>
                            </div>
                            <div className="space-y-2">
                            {event.checklist.map((item) => (
                                <div key={item.id} className="flex items-center gap-3">
                                    <Checkbox id={item.id} checked={item.completed} onCheckedChange={(checked) => onChecklistItemToggle(event.id, item.id, !!checked)} />
                                    <label htmlFor={item.id} className={cn("text-sm flex-1", item.completed && "line-through text-muted-foreground")}>{item.text}</label>
                                </div>
                            ))}
                            </div>
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
