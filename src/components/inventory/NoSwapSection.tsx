'use client';
// src/components/inventory/NoSwapSection.tsx — NEVER SWAP THIS PRODUCT (lib/retail-swap). For something made to order,
// or only right as it is: when it's out at packing it's refunded, never swapped, and it's never offered as anyone
// else's swap. A listing's setting covers each of its variants. Saved on the product itself.
import * as React from 'react';
import { Switch } from '@/components/ui/switch';

export function NoSwapSection({ product, onSave }: { product: any; onSave: (patch: any) => Promise<void> | void }) {
  const [on, setOn] = React.useState<boolean>(product?.noSwap === true);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setOn(product?.noSwap === true); }, [product?.noSwap]);
  const set = async (v: boolean) => {
    const was = on; setOn(v); setBusy(true);
    try { await onSave({ noSwap: v }); } catch { setOn(was); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-start justify-between gap-3 rounded-[1.5rem] border-2 p-5">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">Never swap this product</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">For something made to order, or only right as it is. If it’s out when an order is packed, it’s refunded, and it’s never offered as a swap for something else.</p>
      </div>
      <Switch aria-label="Never swap this product" checked={on} disabled={busy} onCheckedChange={(v: boolean) => void set(v)} />
    </div>
  );
}
