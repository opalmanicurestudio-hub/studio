'use client';

import { useMemo } from 'react';
import { type Event, type EventChecklistItem } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Briefcase, User, MapPin, CheckSquare, Square, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';

export function EventCard({ event }: { event: Event }) {

    const typeStyles = {
        personal: 'bg-purple-100 dark:bg-purple-900/30 border-purple-500',
        business: 'bg-gray-100 dark:bg-gray-900/30 border-gray-500',
    }

    const Icon = event.type === 'personal' ? User : Briefcase;
    
    const checklistProgress = useMemo(() => {
        if (!event.checklist || event.checklist.length === 0) return 0;
        const completed = event.checklist.filter(item => item.completed).length;
        return (completed / event.checklist.length) * 100;
    }, [event.checklist]);

    return (
        <div className={cn("p-4 rounded-lg bg-card border flex flex-col gap-3", typeStyles[event.type])}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-background/50 rounded-full">
                       <Icon className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                        <p className="font-semibold text-sm">{event.title}</p>
                        <p className="text-xs text-muted-foreground">
                            {format(event.startTime, 'h:mm a')} - {format(event.endTime, 'h:mm a')}
                        </p>
                    </div>
                </div>
            </div>
            
            <div className="space-y-3">
                {event.location && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        <span>{event.location}</span>
                    </div>
                )}
                
                {event.isWriteOff && (
                    <Badge variant="outline" className="flex items-center gap-1.5 w-fit bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-600/30">
                        <DollarSign className="w-3 h-3" /> Business Write-off
                    </Badge>
                )}

                {event.notes && (
                    <p className="text-xs text-muted-foreground pt-2 border-t">{event.notes}</p>
                )}

                {event.checklist && event.checklist.length > 0 && (
                    <div className="space-y-2 pt-2 border-t">
                        <div className="flex items-center justify-between">
                             <h4 className="font-medium text-xs flex items-center gap-1.5">
                                <CheckSquare className="w-3.5 h-3.5" /> Checklist
                            </h4>
                            <span className="text-xs text-muted-foreground">{Math.round(checklistProgress)}%</span>
                        </div>
                        <Progress value={checklistProgress} className="h-1" />
                        <div className="space-y-1.5 pt-1">
                            {event.checklist.slice(0, 2).map((item) => (
                                <div key={item.id} className="flex items-center gap-2 text-xs">
                                    {item.completed ? <CheckSquare className="w-3.5 h-3.5 text-muted-foreground" /> : <Square className="w-3.5 h-3.5 text-muted-foreground" />}
                                    <span className={cn(item.completed && "line-through text-muted-foreground")}>{item.text}</span>
                                </div>
                            ))}
                            {event.checklist.length > 2 && (
                                <p className="text-xs text-muted-foreground pl-5">+ {event.checklist.length - 2} more items</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
