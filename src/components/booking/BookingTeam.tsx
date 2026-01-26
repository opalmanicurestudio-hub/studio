
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Staff } from '@/lib/data';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export const BookingTeam = ({ tenantId, staff }: { tenantId: string; staff: Staff[] }) => {
  if (!staff || staff.length === 0) {
    return null;
  }

  return (
    <section id="team" className="space-y-6 scroll-mt-20">
      <h2 className="text-3xl font-bold text-center">Meet Our Team</h2>
      <div className="grid md:grid-cols-2 gap-8">
        {staff.map((member) => (
          <Link key={member.id} href={`/book/${tenantId}/${member.id}`} className="block group">
            <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6 p-6 rounded-lg transition-all duration-300 group-hover:shadow-lg group-hover:-translate-y-1 group-hover:bg-muted/50">
              <Avatar className="w-32 h-32 text-3xl">
                <AvatarImage src={member.avatarUrl} />
                <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <h3 className="text-xl font-bold group-hover:text-primary">{member.name}</h3>
                <p className="text-sm font-medium text-primary">{member.specialties?.join(', ')}</p>
                <p className="text-sm text-muted-foreground">{member.bio || 'A passionate professional dedicated to making you look and feel your best.'}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
};
