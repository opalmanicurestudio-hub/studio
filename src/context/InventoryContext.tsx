
'use client';

import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo } from 'react';
import { 
    inventory as initialInventory, 
    stockCorrections as initialStockCorrections, 
    type InventoryItem, 
    type StockCorrection,
    type Location as LocationType,
    type LocationType as LocType,
    clients as initialClients,
    type Client,
} from '@/lib/data';
import {
    billDefinitions as initialBillDefinitions,
    billInstances as initialBillInstances,
    transactions as initialTransactions,
    type BillDefinition as Bill,
    type BillInstance,
    type Transaction,
} from '@/lib/financial-data';


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
  billDefinitions: Bill[];
  billInstances: BillInstance[];
  setBillInstances: React.Dispatch<React.SetStateAction<BillInstance[]>>;
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export const InventoryProvider = ({ children }: { children: ReactNode }) => {
  const [inventory, setInventory] = useState<InventoryItem[]>(initialInventory);
  const [stockCorrections, setStockCorrections] = useState<StockCorrection[]>(initialStockCorrections);
  const [locations, setLocations] = useState<LocationType[]>(initialLocations);
  const [locationTypes, setLocationTypes] = useState<LocType[]>(initialLocationTypes);

  const [billDefinitions, setBillDefinitions] = useState<Bill[]>(initialBillDefinitions);
  const [billInstances, setBillInstances] = useState<BillInstance[]>(initialBillInstances);
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [clients, setClients] = useState<Client[]>(initialClients);


  const addStockCorrection = useCallback((correction: StockCorrection) => {
    setStockCorrections(prev => [...prev, correction]);
  }, []);

  const value = useMemo(() => ({
    inventory,
    setInventory,
    stockCorrections,
    setStockCorrections,
    addStockCorrection,
    locations,
    setLocations,
    locationTypes,
    setLocationTypes,
    billDefinitions,
    billInstances,
    setBillInstances,
    transactions,
    setTransactions,
    clients,
    setClients,
  }), [
    inventory, 
    stockCorrections, 
    addStockCorrection, 
    locations, 
    locationTypes, 
    billDefinitions, 
    billInstances, 
    transactions, 
    clients
  ]);

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
