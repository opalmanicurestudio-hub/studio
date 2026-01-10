
'use client';

import { type Event } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Briefcase, User } from 'lucide-react';
import { format } from 'date-fns';

export function EventCard({ event }: { event: Event }) {

    const typeStyles = {
        personal: 'bg-purple-100 dark:bg-purple-900/30 border-purple-500',
        business: 'bg-gray-100 dark:bg-gray-900/30 border-gray-500',
    }

    const Icon = event.type === 'personal' ? User : Briefcase;

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
            {event.notes && (
                <p className="text-xs text-muted-foreground pt-2 border-t">{event.notes}</p>
            )}
        </div>
    );
}
