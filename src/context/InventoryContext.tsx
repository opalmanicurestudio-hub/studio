
'use client';

import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { 
    inventory as initialInventory, 
    stockCorrections as initialStockCorrections, 
    type InventoryItem, 
    type StockCorrection,
    type Location as LocationType,
    type LocationType as LocType,
} from '@/lib/data';

// Define initial locations and location types
const initialLocationTypes: LocType[] = [
  { id: 'lt-1', name: 'General Storage', icon: 'Box' },
  { id: 'lt-2', name: 'Retail Display', icon: 'Store' },
  { id: 'lt-3', name: 'Workstation', icon: 'ClipboardList' },
];

const initialLocations: LocationType[] = [
  { id: 'loc-1', name: 'Back Room - Shelf A', locationTypeId: 'lt-1', description: 'Main storage for backstock color and developers.' },
  { id: 'loc-2', name: 'Retail Display - Front', locationTypeId: 'lt-2', description: 'Client-facing retail shelves.' },
  { id: 'loc-3', name: 'Styling Station 1', locationTypeId: 'lt-3' },
];


interface InventoryContextType {
  inventory: InventoryItem[];
  setInventory: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  stockCorrections: StockCorrection[];
  setStockCorrections: React.Dispatch<React.SetStateAction<StockCorrection[]>>;
  addStockCorrection: (correction: StockCorrection) => void;
  locations: LocationType[];
  setLocations: React.Dispatch<React.SetStateAction<LocationType[]>>;
  locationTypes: LocType[];
  setLocationTypes: React.Dispatch<React.SetStateAction<LocType[]>>;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export const InventoryProvider = ({ children }: { children: ReactNode }) => {
  const [inventory, setInventory] = useState<InventoryItem[]>(initialInventory);
  const [stockCorrections, setStockCorrections] = useState<StockCorrection[]>(initialStockCorrections);
  const [locations, setLocations] = useState<LocationType[]>(initialLocations);
  const [locationTypes, setLocationTypes] = useState<LocType[]>(initialLocationTypes);


  const addStockCorrection = useCallback((correction: StockCorrection) => {
    setStockCorrections(prev => [...prev, correction]);
  }, []);

  const value = {
    inventory,
    setInventory,
    stockCorrections,
    setStockCorrections,
    addStockCorrection,
    locations,
    setLocations,
    locationTypes,
    setLocationTypes
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
