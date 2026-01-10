
'use client';

import React, { useMemo, useState, KeyboardEvent } from 'react';
import { type Event, type EventChecklistItem } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Briefcase, User, MapPin, CheckSquare, Square, Edit, Trash2, Lock, PlusCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';

interface EventCardProps {
    event: Event,
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onAddChecklistItem: (eventId: string, text: string) => void;
    onRemoveChecklistItem: (eventId: string, checklistItemId: string) => void;
    onDeleteEvent: (eventId: string) => void;
    onEditEvent: (event: Event) => void;
}

export function EventCard({ 
    event,
    onChecklistItemToggle,
    onAddChecklistItem,
    onRemoveChecklistItem,
    onDeleteEvent,
    onEditEvent
}: EventCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [newChecklistItem, setNewChecklistItem] = useState('');

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
    
    const handleAddChecklistItem = () => {
        if (newChecklistItem.trim()) {
            onAddChecklistItem(event.id, newChecklistItem.trim());
            setNewChecklistItem('');
        }
    };
    
    const handleChecklistKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddChecklistItem();
        }
    };

    const cardContent = (
        <div 
            className={cn(
                "p-2 rounded-lg bg-card border w-full h-full flex flex-col cursor-pointer transition-all duration-300", 
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
            
            {isExpanded && (
                 <ScrollArea className="flex-grow mt-2 pr-2">
                    <div className="space-y-3">
                        {event.notes && <p className="text-xs text-muted-foreground">{event.notes}</p>}
                        {event.location && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <MapPin className="w-3 h-3" />
                                <span>{event.location}</span>
                            </div>
                        )}
                        {event.checklist && event.checklist.length > 0 && (
                            <div className="space-y-2 pt-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-medium text-xs flex items-center gap-1.5"><CheckSquare className="w-3.5 h-3.5" /> Checklist</h4>
                                    <span className="text-xs text-muted-foreground">{Math.round(checklistProgress)}%</span>
                                </div>
                                <Progress value={checklistProgress} className="h-1" />
                                <div className="space-y-1.5 pt-1">
                                    {event.checklist.map((item) => (
                                        <div key={item.id} className="flex items-center gap-2 text-xs">
                                            <Checkbox id={item.id} checked={item.completed} onCheckedChange={(checked) => onChecklistItemToggle(event.id, item.id, !!checked)} />
                                            <label htmlFor={item.id} className={cn("flex-1", item.completed && "line-through text-muted-foreground")}>{item.text}</label>
                                            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => onRemoveChecklistItem(event.id, item.id)}><Trash2 className="h-3 w-3"/></Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                         <div className="flex gap-2">
                            <Input 
                                placeholder="Add checklist item..."
                                value={newChecklistItem}
                                onChange={(e) => setNewChecklistItem(e.target.value)}
                                onKeyDown={handleChecklistKeyDown}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 text-xs"
                            />
                            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleAddChecklistItem(); }}><PlusCircle className="h-4 w-4"/></Button>
                        </div>
                    </div>
                </ScrollArea>
            )}

            {isExpanded && (
                 <div className="flex-shrink-0 mt-2 pt-2 border-t flex justify-end gap-2">
                    <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); onDeleteEvent(event.id); }} className="text-destructive"><Trash2 className="w-3 h-3 mr-1"/> Delete</Button>
                    <Button variant="outline" size="xs" onClick={(e) => { e.stopPropagation(); onEditEvent(event);}}><Edit className="w-3 h-3 mr-1"/> Edit</Button>
                </div>
            )}
        </div>
    );

    if (isExpanded) {
        return (
            <div className="absolute w-full h-full p-2 z-10">
                {cardContent}
            </div>
        )
    }

    return cardContent;
}
