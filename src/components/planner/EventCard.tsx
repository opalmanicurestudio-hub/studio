
'use client';

import React, { useMemo, useState, KeyboardEvent } from 'react';
import { type Event, type EventChecklistItem } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Briefcase, User, MapPin, CheckSquare, Trash2, Lock, Edit, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { ScrollArea } from '../ui/scroll-area';

interface EventCardProps {
    event: Event,
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onDeleteEvent: (eventId: string) => void;
    onEditEvent: (event: Event) => void;
}

export function EventCard({ 
    event,
    onChecklistItemToggle,
    onDeleteEvent,
    onEditEvent
}: EventCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    const typeStyles = {
        personal: 'bg-blue-500/10 border-blue-500/30',
        business: 'bg-purple-500/10 border-purple-500/30',
        blocked: 'border-gray-500/30',
    };

    let Icon;
    switch(event.type) {
        case 'personal': Icon = User; break;
        case 'business': Icon = Briefcase; break;
        case 'blocked': Icon = Lock; break;
    }
    
    const checklistProgress = useMemo(() => {
        if (!event.checklist || event.checklist.length === 0) return 0;
        const completed = event.checklist.filter(item => item.completed).length;
        return (completed / event.checklist.length) * 100;
    }, [event.checklist]);

    const completedCount = useMemo(() => event.checklist?.filter(item => item.completed).length || 0, [event.checklist]);
    const totalCount = useMemo(() => event.checklist?.length || 0, [event.checklist]);

    return (
        <div 
            className={cn(
                "p-2 rounded-lg bg-card border w-full h-full flex flex-col cursor-pointer transition-all duration-300 overflow-hidden", 
                typeStyles[event.type],
                event.type === 'blocked' && "bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]"
            )}
            onClick={() => setIsExpanded(!isExpanded)}
        >
            <div className="flex items-start justify-between gap-2 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <p className="font-semibold text-xs truncate flex-1">{event.title}</p>
                </div>
                <p className="text-xs text-muted-foreground flex-shrink-0">{format(event.startTime, 'h:mm a')}</p>
            </div>
            
            <div className="flex-grow mt-2 overflow-y-auto" style={{ display: isExpanded ? 'block' : 'none' }}>
              <ScrollArea className="h-full pr-2">
                <div className="space-y-3">
                    {event.notes && <p className="text-xs text-muted-foreground">{event.notes}</p>}
                    {event.location && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            <span>{event.location}</span>
                        </div>
                    )}
                    {event.checklist && event.checklist.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                            {event.checklist.map((item) => (
                                <div key={item.id} className="flex items-center gap-2 text-xs" onClick={e => e.stopPropagation()}>
                                    <Checkbox id={item.id} checked={item.completed} onCheckedChange={(checked) => onChecklistItemToggle(event.id, item.id, !!checked)} />
                                    <label htmlFor={item.id} className={cn("flex-1", item.completed && "line-through text-muted-foreground")}>{item.text}</label>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
              </ScrollArea>
            </div>
            
            <div className="flex-shrink-0 mt-auto pt-2">
                 {event.checklist && event.checklist.length > 0 && (
                     <div className="space-y-1">
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                             <div className="flex items-center gap-1.5"><CheckSquare className="w-3.5 h-3.5"/><span>Checklist</span></div>
                             <span>{completedCount}/{totalCount}</span>
                        </div>
                        <Progress value={checklistProgress} className="h-1" />
                    </div>
                )}
                 {isExpanded && (
                    <div className="flex justify-end gap-2 mt-2">
                        <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); onDeleteEvent(event.id); }} className="text-destructive"><Trash2 className="w-3 h-3 mr-1"/> Delete</Button>
                    </div>
                )}
            </div>
        </div>
    );
}
