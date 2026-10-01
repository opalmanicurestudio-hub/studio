'use client';
// src/lib/lounge-delivery.ts — DELIVERING A LOUNGE ORDER (one shared step: the dashboard and the Assist queue).
// Marks it delivered, binds it to the visit (or books a kiosk sale), counts a member perk — and settles STOCK:
//   · orders placed since the lounge route started moving stock AT ORDER TIME carry `stockMoved: true` → the item
//     itself is NOT taken off again (that double count is fixed here); a recipe item (e.g. a latte) still uses up its
//     ingredients, which the order step never touched;
//   · older orders without the mark are settled the old way, so none are missed.
import { collection, doc, writeBatch, increment, arrayUnion } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { safeNumber } from '@/lib/utils';

const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, sanitizeForFirestore(v)]));
};

export async function deliverRefreshment(firestore: any, tenantId: string, request: any, inventory: any[], user: any): Promise<boolean> {
  const item = (inventory || []).find((i: any) => i.id === request.itemId);
  if (!item) return false;
      const batch = writeBatch(firestore);
  const now = new Date().toISOString();
  const qty = safeNumber(request.quantity || 1);

  // 1. UPDATE REQUEST STATUS
  const requestRef = doc(firestore, `tenants/${tenantId}/refreshmentRequests`, request.id);
  batch.update(requestRef, sanitizeForFirestore({
      status: 'delivered',
      deliveredAt: now,
      deliveredBy: user?.uid || 'system'
  }));

  // 2. RECONCILE INVENTORY
  const hasRecipe = item.formula && item.formula.length > 0;
  const ingredients = hasRecipe
    ? item.formula.map((f: any) => ({ ...f, quantityUsed: safeNumber(f.quantityUsed) * qty }))
    : (request.stockMoved ? [] : [{ id: item.id, name: item.name, quantityUsed: qty, unit: item.unit || 'unit' }]);   // already taken off at order time

  ingredients.forEach((ingredient: any) => {
      const product: any = inventory.find((p: any) => p.id === ingredient.id);
      if (!product) return;

      const productRef = doc(firestore, `tenants/${tenantId}/inventory`, product.id);
      const updateData: any = {};
      let unitLabel = product.unit || 'units';
      
      if (product.costingMethod === 'uses') {
          unitLabel = product.useUnit || 'uses';
          let currentUses = safeNumber(product.partialContainerUses);
          let currentStock = safeNumber(product.totalStock);
          const usesPerContainer = safeNumber(product.estimatedUses) || 1;
          
          currentUses -= ingredient.quantityUsed;
          while (currentUses <= 0 && currentStock > 0) {
              currentStock -= 1;
              currentUses += usesPerContainer;
          }
          if (currentStock <= 0 && currentUses < 0) {
              currentStock = 0;
              currentUses = 0;
          }
          updateData.totalStock = currentStock;
          updateData.partialContainerUses = currentUses;
      } else if (product.costingMethod === 'size' && product.size) {
          unitLabel = product.unit || 'ml';
          let currentSize = safeNumber(product.partialContainerSize);
          let currentStock = safeNumber(product.totalStock);
          const sizePerContainer = safeNumber(product.size);
          currentSize -= ingredient.quantityUsed;
          while (currentSize <= 0 && currentStock > 0) {
              currentStock -= 1;
              currentSize += sizePerContainer;
          }
          if (currentStock <= 0 && currentSize < 0) {
              currentStock = 0;
              currentSize = 0;
          }
          updateData.totalStock = currentStock;
          updateData.partialContainerSize = currentSize;
      } else {
          updateData.totalStock = increment(-ingredient.quantityUsed);
      }

      batch.update(productRef, sanitizeForFirestore(updateData));

      const correctionRef = doc(collection(firestore, `tenants/${tenantId}/stockCorrections`));
      batch.set(correctionRef, sanitizeForFirestore({
          id: nanoid(),
          productId: product.id,
          date: now,
          change: -ingredient.quantityUsed,
          unit: unitLabel,
          reason: `Amenity Protocol: ${item.name} (x${qty}) for ${request.clientName}`,
          requestId: request.id
      }));
  });

  // 3. BIND TO APPOINTMENT (If exists)
  if (request.appointmentId && request.appointmentId !== 'guest-walkin') {
      const aptRef = doc(firestore, `tenants/${tenantId}/appointments/${request.appointmentId}`);
      batch.set(aptRef, {
          checkoutState: {
              refreshments: arrayUnion(sanitizeForFirestore({
                  id: item.id,
                  name: item.name,
                  price: safeNumber(request.priceAtRequest), 
                  deliveredAt: now,
                  quantity: qty,
                  isAccountedFor: true
              }))
          }
      }, { merge: true });
  } else if (request.isGuestKiosk && safeNumber(request.priceAtRequest) > 0) {
      // It's a guest kiosk order with a price. Create a transaction now since there's no appointment to bill later.
      const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
      batch.set(txnRef, sanitizeForFirestore({
          id: txnRef.id,
          date: now,
          description: `Lounge Guest Sale: ${item.name} (x${qty})`,
          clientOrVendor: request.clientName,
          type: 'income',
          context: 'Business',
          category: 'Hospitality Revenue',
          amount: safeNumber(request.priceAtRequest) * qty,
          paymentMethod: 'Guest Kiosk Entry',
          hasReceipt: false,
          tenantId
      }));
  }

  // 4. UPDATE PERK USAGE IN GUEST DOSSIER
  if (request.isRedemption && request.clientId && request.clientId !== 'guest-walkin') {
      const clientRef = doc(firestore, `tenants/${tenantId}/clients`, request.clientId);
      batch.update(clientRef, {
          [`subscription.perkUsage.${request.itemId}`]: increment(qty),
          'subscription.perkLastUsed': now,
          'subscription.status': 'active' 
      });
  }

  await batch.commit();
  return true;
}

/** "I'm bringing it over" — the guest sees someone is on the way (and gets a text). */
export function bringingRefreshmentPatch(user: any) { return { bringingOutAt: new Date().toISOString(), bringingOutBy: user?.displayName || 'Someone' }; }
