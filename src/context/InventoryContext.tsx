
'use client';

import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { 
    inventory as initialInventory, 
    stockCorrections as initialStockCorrections, 
    type InventoryItem, 
    type StockCorrection 
} from '@/lib/data';

interface InventoryContextType {
  inventory: InventoryItem[];
  setInventory: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  stockCorrections: StockCorrection[];
  setStockCorrections: React.Dispatch<React.SetStateAction<StockCorrection[]>>;
  addStockCorrection: (correction: StockCorrection) => void;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export const InventoryProvider = ({ children }: { children: ReactNode }) => {
  const [inventory, setInventory] = useState<InventoryItem[]>(initialInventory);
  const [stockCorrections, setStockCorrections] = useState<StockCorrection[]>(initialStockCorrections);

  const addStockCorrection = useCallback((correction: StockCorrection) => {
    setStockCorrections(prev => [...prev, correction]);
  }, []);

  const value = {
    inventory,
    setInventory,
    stockCorrections,
    setStockCorrections,
    addStockCorrection,
  };

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
};

export const useInventory = () => {
  const context = useContext(InventoryContext);
  if (context === undefined) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
};
