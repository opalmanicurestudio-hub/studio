'use client';
// src/components/inventory/ProsOnlySection.tsx — FOR LICENSED PROS ONLY. A product (and each of its variants) can be
// sold only to customers with a license on file (lib/pro-license): checkout asks for one, the window board and the shop
// say "Pros only", and the register and pick list show whether the customer has one. Saved on the product itself.
import * as React from 'react';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';

export function ProsOnlySection({ product, onSave }: { product: any; onSave: (patch: any) => Promise<void> | void }) {
  const [on, setOn] = React.useState<boolean>(product?.prosOnly === true);
  const [busy, setBusy] = React.useState(false);
  const set = async (v: boolean) => {
    const was = on; setOn(v); setBusy(true);
    try { await onSave({ prosOnly: v }); } catch { setOn(was); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-start justify-between gap-3 rounded-[1.5rem] border-2 p-5">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">For licensed pros only</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Sold only to customers with a license on file. Checkout asks for one, and the shop and window board say Pros only. Licenses are checked in <Link href="/retail-orders/licenses" className="underline underline-offset-2">Licenses</Link>.</p>
      </div>
      <Switch aria-label="For licensed pros only" checked={on} disabled={busy} onCheckedChange={(v: boolean) => void set(v)} />
    </div>
  );
}
