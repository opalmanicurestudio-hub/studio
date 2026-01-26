
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Phone, Mail, MapPin } from 'lucide-react';
import { Tenant } from '@/lib/data';
import Image from 'next/image';

export const BookingContact = ({ tenant }: { tenant: Tenant | null }) => {
  return (
    <section id="contact" className="space-y-6 scroll-mt-20">
      <h2 className="text-3xl font-bold text-center">Contact & Location</h2>
      <Card className="overflow-hidden">
        <div className="grid md:grid-cols-2">
            <CardContent className="p-6 space-y-4">
                <h3 className="text-lg font-semibold">{tenant?.name || 'ClarityFlow Salon'}</h3>
                <div className="space-y-3 text-muted-foreground">
                    <a href="tel:555-123-4567" className="flex items-center gap-3 hover:text-primary">
                        <Phone className="w-4 h-4" />
                        <span>(555) 123-4567</span>
                    </a>
                    <a href="mailto:hello@clarityflow.app" className="flex items-center gap-3 hover:text-primary">
                        <Mail className="w-4 h-4" />
                        <span>hello@clarityflow.app</span>
                    </a>
                    <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 hover:text-primary">
                        <MapPin className="w-4 h-4 mt-1 flex-shrink-0" />
                        <span>
                            123 Beauty Lane<br />
                            Suite 100<br />
                            Los Angeles, CA 90028
                        </span>
                    </a>
                </div>
            </CardContent>
             <div className="relative aspect-video md:aspect-auto min-h-[250px]">
                <Image 
                    src="https://images.unsplash.com/photo-1569336415962-a42945097388?q=80&w=1287&auto=format&fit=crop"
                    alt="Map showing salon location"
                    fill
                    className="object-cover"
                    data-ai-hint="map location"
                />
            </div>
        </div>
      </Card>
    </section>
  );
};
