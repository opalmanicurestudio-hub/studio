
'use client';

import { useInventory } from '@/context/InventoryContext';
import { useParams } from 'next/navigation';
import ProductDetailPage from '../(detail)/product/[id]/page';
import EquipmentDetailPage from '../(detail)/equipment/[id]/page';

export default function InventoryDetailPageSelector() {
  const { id } = useParams<{ id: string }>();
  const { inventory } = useInventory();
  
  const item = inventory.find((p) => p.id === id);

  if (!item) {
    // This part should ideally lead to a 404 page.
    // For now, it will just show a message.
    return <div>Item not found</div>;
  }

  // This is a temporary client-side routing logic.
  // In a more robust app, this might be handled by different URL structures like /inventory/product/[id] vs /inventory/equipment/[id]
  if (item.type === 'equipment') {
    return <EquipmentDetailPage />;
  }

  return <ProductDetailPage />;
}
