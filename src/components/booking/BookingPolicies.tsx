
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tenant } from '@/lib/data';

export const BookingPolicies = ({ tenant }: { tenant: Tenant | null }) => {
  if (!tenant) return null;
  const hasPolicies = tenant.cancellationPolicy || tenant.lateArrivalPolicy || tenant.noShowPolicy;

  if (!hasPolicies) return null;

  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-bold text-center">Our Policies</h2>
      <Card>
        <CardContent className="p-6 space-y-4 text-sm text-muted-foreground">
          {tenant.cancellationPolicy && (
            <div>
              <h4 className="font-semibold text-foreground mb-1">Cancellation Policy</h4>
              <p>{tenant.cancellationPolicy}</p>
            </div>
          )}
          {tenant.lateArrivalPolicy && (
            <div>
              <h4 className="font-semibold text-foreground mb-1">Late Arrival Policy</h4>
              <p>{tenant.lateArrivalPolicy}</p>
            </div>
          )}
           {tenant.noShowPolicy && (
            <div>
              <h4 className="font-semibold text-foreground mb-1">No-Show Policy</h4>
              <p>{tenant.noShowPolicy}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};
