'use client';
// src/components/rent/RenterTaxes.tsx — A RENTER'S TAX SET-ASIDE (Money, Your business, Taxes to set aside; included in
// rent; api/portal/renter-taxes, lib/renter-taxes). The screen is the same one the owner's Taxes tab uses
// (components/money/TaxSetAside), from what the renter earns through ClarityFlow less their write-offs.
import * as React from 'react';
import { OpenScreenContext } from '@/components/rent/shared';
import { TaxSetAside } from '@/components/money/TaxSetAside';

export function RenterTaxes({ tenantId, token }: { tenantId: string; token: string }) {
  const openScreen = React.useContext(OpenScreenContext);
  const post = React.useCallback(async (body: any) => {
    try { const r = await fetch('/api/portal/renter-taxes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, tenantId, token }) }); return await r.json(); }
    catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId, token]);
  return <TaxSetAside who="renter" post={post} onWriteOffs={openScreen ? () => openScreen({ view: 'writeoffs' }) : null} />;
}
