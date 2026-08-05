'use client';

import {
  CircleUserRound, Grid3x3, LifeBuoy, Menu, PackageSearch, Store, Truck, X,
} from 'lucide-react';
import Link from 'next/link';
import React, { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// ─── ShopMenu ─────────────────────────────────────────────────────────────────
// The storefront's one navigation surface. A single scrolling page works at a
// dozen products and falls apart at sixty, so browsing gets a real home:
// categories jump straight into the catalog, and the account, order-lookup
// and policy links stop living only at the bottom of the page.
//
// Deliberately a Sheet rather than a top nav bar — thumbs reach the bottom of
// a phone, and the trigger sits in the header where it is expected. Every
// item is a real link, so it works with a screen reader and with a keyboard.

export interface ShopMenuProps {
  tenantId: string;
  shopName: string;
  categories?: string[];
  activeCategory?: string;
  policies?: { returns?: string; shipping?: string };
}

export function ShopMenu({ tenantId, shopName, categories = [], activeCategory }: ShopMenuProps) {
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="h-10 w-10 rounded-xl shrink-0"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-sm p-0 border-r-2">
          <SheetTitle className="sr-only">Shop menu</SheetTitle>

          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 border-b-2 px-5 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 bg-primary/10">
                <Store className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <p className="min-w-0 flex-1 truncate font-black uppercase tracking-tighter text-base leading-none">
                {shopName}
              </p>
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={close} className="h-9 w-9 rounded-xl">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <nav aria-label="Shop" className="flex-1 overflow-y-auto px-3 py-4">
              <p className="px-2 pb-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Browse
              </p>
              <Link
                href={`/shop/${tenantId}`}
                onClick={close}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold hover:bg-muted/60"
              >
                <Store className="h-4 w-4 shrink-0" aria-hidden="true" /> Home
              </Link>
              <Link
                href={`/shop/${tenantId}/catalog`}
                onClick={close}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold hover:bg-muted/60"
              >
                <Grid3x3 className="h-4 w-4 shrink-0" aria-hidden="true" /> All products
              </Link>

              {categories.length > 0 && (
                <>
                  <p className="px-2 pb-2 pt-5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                    Categories
                  </p>
                  {categories.map((c) => (
                    <Link
                      key={c}
                      href={`/shop/${tenantId}/catalog?category=${encodeURIComponent(c)}`}
                      onClick={close}
                      aria-current={activeCategory === c ? 'page' : undefined}
                      className={cn(
                        'flex items-center justify-between rounded-2xl px-3 py-3 text-sm font-bold hover:bg-muted/60',
                        activeCategory === c && 'bg-muted'
                      )}
                    >
                      {c}
                    </Link>
                  ))}
                </>
              )}

              <p className="px-2 pb-2 pt-5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Your orders
              </p>
              <Link
                href={`/shop/${tenantId}/account`}
                onClick={close}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold hover:bg-muted/60"
              >
                <CircleUserRound className="h-4 w-4 shrink-0" aria-hidden="true" /> Sign in / my orders
              </Link>
              <Link
                href={`/shop/${tenantId}/account`}
                onClick={close}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold hover:bg-muted/60"
              >
                <PackageSearch className="h-4 w-4 shrink-0" aria-hidden="true" /> Track an order
              </Link>

              <p className="px-2 pb-2 pt-5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Help
              </p>
              <Link
                href={`/shop/${tenantId}/catalog?category=__shipping`}
                onClick={close}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold hover:bg-muted/60"
              >
                <Truck className="h-4 w-4 shrink-0" aria-hidden="true" /> Shipping &amp; pickup
              </Link>
              <Link
                href={`/shop/${tenantId}/account`}
                onClick={close}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold hover:bg-muted/60"
              >
                <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden="true" /> Returns &amp; support
              </Link>
            </nav>

            <p className="border-t-2 px-5 py-4 text-[11px] font-bold text-muted-foreground">
              Powered by ClarityFlow
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
