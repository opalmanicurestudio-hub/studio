'use client';
// src/components/booths/BoothNoShowRow.tsx — THE BOOTH NO-SHOW FEE AS A ROW IN BOOTH SETTINGS: what happens today
// when a renter doesn't show, and Change, which opens the fee window on the booth page. Read from its own field
// (lib/booth-no-show), never from the booking no-show policy clients read.
import { Button } from '@/components/ui/button';
import { boothNoShowPolicyOf } from '@/lib/booth-no-show';

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export function BoothNoShowRow({ tenant, onChange }: { tenant: any; onChange: () => void }) {
  const p = boothNoShowPolicyOf(tenant);
  const charged = p.enabled && p.feeCents > 0;
  return (
    <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border p-4">
      <div className="min-w-0">
        <p className="text-[15px] font-medium">No-show fee</p>
        <p className="text-[13.5px] text-muted-foreground">{charged ? `A no-show is charged ${dollars(p.feeCents)} to the card on file.` : 'No-shows are flagged for you, never charged.'}</p>
      </div>
      <Button variant="outline" className="shrink-0 rounded-full" onClick={onChange}>Change</Button>
    </div>
  );
}
