
'use client';

import { useInventory } from '@/context/InventoryContext';
import { useParams } from 'next/navigation';
import ProductDetailPage from './product/[id]/page';
import EquipmentDetailPage from './equipment/[id]/page';

export default function InventoryDetailLayout() {
  const { id } = useParams<{ id: string }>();
  const { inventory } = useInventory();
  
  const item = inventory.find((p) => p.id === id);

  if (!item) {
    return <div>Item not found</div>;
  }

  if (item.type === 'equipment') {
    return <EquipmentDetailPage />;
  }

  return <ProductDetailPage />;
}
