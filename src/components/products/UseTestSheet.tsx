'use client';
// src/components/products/UseTestSheet.tsx — HOW MANY USES DOES A CONTAINER REALLY GIVE? Start the test when a new
// container is opened; every use recorded after that (checkout, the provider's hand-off, a use logged by hand) is counted
// (lib/usage moveStock). End it when the container is empty: the count is shown against what the product says, with what
// each would make one use cost, and the real number can become the product's own, so every cost per use follows it.
import * as React from 'react';
import { doc, type Firestore } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase';
import { perContainer, unitLabel } from '@/lib/product-cost';
import { Btn, C, Sheet, muted } from '@/components/orders/ui';

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

/** Only a product used by the dose (counted by uses or by amount) has a container to test. */
export const canTestUses = (p: any) => (p?.costingMethod === 'uses' || p?.costingMethod === 'size') && String(p?.type) !== 'equipment';

export function startUseTest(fs: Firestore, tenantId: string, product: any, by = '') {
  updateDocumentNonBlocking(doc(fs, 'tenants', tenantId, 'inventory', String(product.id)), { isExperimentActive: true, experimentUses: 0, experimentStartedAt: new Date().toISOString(), ...(by ? { experimentStartedBy: by } : {}) });
}

export function UseTestSheet({ fs, tenantId, product, onClose, onDone }: { fs: Firestore; tenantId: string; product: any; onClose: () => void; onDone?: (msg: string) => void }) {
  const unit = unitLabel(product);
  const word = product?.costingMethod === 'uses' ? 'uses' : unit;
  const said = perContainer(product);
  const got = Math.round((Number(product?.experimentUses) || 0) * 100) / 100;
  const cost = Number(product?.costPerUnit) || 0;
  const field = product?.costingMethod === 'uses' ? 'estimatedUses' : 'size';
  const finish = (apply: boolean) => {
    const result = { kind: 'uses', counted: got, expected: said, unit, startedAt: product?.experimentStartedAt || null, endedAt: new Date().toISOString(), applied: apply };
    // A smaller container than set: what the open one is said to hold can't be more than a full one.
    const openField = product?.costingMethod === 'uses' ? 'partialContainerUses' : 'partialContainerSize';
    const openNow = Number(product?.[openField]) || 0;
    updateDocumentNonBlocking(doc(fs, 'tenants', tenantId, 'inventory', String(product.id)), { isExperimentActive: false, lastTestResult: result, ...(apply && got > 0 ? { [field]: got, ...(openNow > got ? { [openField]: got } : {}) } : {}) });
    onDone?.(apply && got > 0 ? `${product.name} now counts ${got} ${word} a container.` : `The test for ${product.name} has ended.`);
    onClose();
  };
  const off = said && got > 0 ? Math.round(((got - said) / said) * 100) : null;
  return (
    <Sheet title="End the uses test" sub={String(product?.name || '')} onClose={onClose}>
      <div className="mt-2 flex flex-col gap-4">
        <p className="m-0 text-[15px]">
          Since {product?.experimentStartedAt ? new Date(product.experimentStartedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'the test started'}, {got} {word} were recorded.
          {said ? ` The product says a container holds ${said}.` : ' The product doesn’t say how many a container holds yet.'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-4" style={{ background: C.soft }}>
            <p className="m-0 text-[13px]" style={muted}>As set now</p>
            <p className="m-0 mt-1 text-[22px] font-light tabular-nums">{said ? money(cost / said) : '—'}</p>
            <p className="m-0 text-[13px]" style={muted}>{said ? `${said} ${word} a container` : 'not set'}</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: C.soft }}>
            <p className="m-0 text-[13px]" style={muted}>From the test</p>
            <p className="m-0 mt-1 text-[22px] font-light tabular-nums">{got > 0 ? money(cost / got) : '—'}</p>
            <p className="m-0 text-[13px]" style={off !== null && Math.abs(off) >= 10 ? { color: C.warn } : muted}>{got > 0 ? `${got} ${word}${off !== null ? `, ${off > 0 ? `${off}% more` : `${-off}% fewer`} than set` : ''}` : 'nothing recorded'}</p>
          </div>
        </div>
        <p className="m-0 text-[14px]" style={muted}>End it once the container is empty. Using the test’s number changes this product’s cost per use everywhere: service margins, visit profit and the restocking fund.</p>
        {got > 0 && <Btn kind="primary" className="w-full" onClick={() => finish(true)}>Use {got} {word} a container</Btn>}
        <Btn kind="soft" className="w-full" onClick={() => finish(false)}>{got > 0 ? `Keep ${said ?? 'it'} and end the test` : 'End the test'}</Btn>
      </div>
    </Sheet>
  );
}
