'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Staff } from '@/lib/data';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

export const BookingTeam = ({ tenantId, staff }: { tenantId: string; staff: Staff[] }) => {
  if (!staff || staff.length === 0) {
    return null;
  }

  const getInitials = (name?: string | null) => {
    if (!name || name.length < 2) return '??';
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <section id="team" className="space-y-6 scroll-mt-20">
      <h2 className="text-3xl font-bold text-center">Meet Our Team</h2>
      <ScrollArea>
        <div className="flex space-x-6 pb-4">
          {staff.map((member) => (
            <Link key={member.id} href={`/book/${tenantId}/${member.id}`} className="block group w-[320px] shrink-0">
                <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6 p-6 rounded-lg transition-all duration-300 group-hover:shadow-lg group-hover:-translate-y-1 h-full border group-hover:bg-muted/50">
                    <Avatar className="w-24 h-24 sm:w-32 sm:h-32 text-3xl shrink-0">
                        <AvatarImage src={member.avatarUrl} alt={member.name || 'Staff Member'}/>
                        <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                    </Avatar>
                    <div className="space-y-2">
                        <h3 className="text-xl font-bold group-hover:text-primary">{member.name || 'Team Member'}</h3>
                        <p className="text-sm font-medium text-primary">{member.specialties?.join(', ') || 'Professional'}</p>
                        <p className="text-sm text-muted-foreground line-clamp-4">{member.bio || 'A passionate professional dedicated to making you look and feel your best.'}</p>
                    </div>
                </div>
            </Link>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  );
};
