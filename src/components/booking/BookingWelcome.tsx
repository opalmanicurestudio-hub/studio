'use client';

import { Tenant } from '@/lib/data';

export const BookingWelcome = ({ tenant }: { tenant: Tenant | null }) => {
  return (
    <section id="welcome" className="space-y-6 text-center">
      <h2 className="text-3xl font-bold">Welcome to {tenant?.name || 'Our Salon'}</h2>
      <p className="text-muted-foreground max-w-2xl mx-auto">
        We're thrilled to have you. Our team of dedicated professionals is here to provide you with an exceptional experience. Browse our services, meet our talented staff, and book your appointment with confidence. We look forward to seeing you!
      </p>
    </section>
  );
};
