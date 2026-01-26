
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Staff } from '@/lib/data';

export const BookingTeam = ({ staff }: { staff: Staff[] }) => {
  if (!staff || staff.length === 0) {
    return null;
  }

  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-bold text-center">Meet Our Team</h2>
      <div className="grid md:grid-cols-2 gap-8">
        {staff.map((member) => (
          <div key={member.id} className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6">
            <Avatar className="w-32 h-32 text-3xl">
              <AvatarImage src={member.avatarUrl} />
              <AvatarFallback>{member.name.substring(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <h3 className="text-xl font-bold">{member.name}</h3>
              <p className="text-sm font-medium text-primary">{member.specialties?.join(', ')}</p>
              <p className="text-sm text-muted-foreground">{member.bio || 'A passionate professional dedicated to making you look and feel your best.'}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
