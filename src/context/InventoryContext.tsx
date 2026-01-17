'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { 
    inventory as initialInventory, 
    stockCorrections as initialStockCorrections, 
    type InventoryItem, 
    type StockCorrection,
    type Location as LocationType,
    type LocationType as LocType,
    clients as initialClients,
    type Client,
    appointments as initialAppointments,
    type Appointment,
    services as initialServices,
    type Service,
    initialLocations,
    initialLocationTypes
} from '@/lib/data';
import {
    billDefinitions as initialBillDefinitions,
    billInstances as initialBillInstances,
    transactions as initialTransactions,
    type BillDefinition as Bill,
    type BillInstance,
    type Transaction,
} from '@/lib/financial-data';


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
  setBillDefinitions: React.Dispatch<React.SetStateAction<Bill[]>>;
  billInstances: BillInstance[];
  setBillInstances: React.Dispatch<React.SetStateAction<BillInstance[]>>;
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  appointments: Appointment[];
  setAppointments: React.Dispatch<React.SetStateAction<Appointment[]>>;
  services: Service[];
  setServices: React.Dispatch<React.SetStateAction<Service[]>>;
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
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [services, setServices] = useState<Service[]>(initialServices);


  const addStockCorrection = (correction: StockCorrection) => {
    setStockCorrections(prev => [...prev, correction]);
  };

  const value = {
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
    setBillDefinitions,
    billInstances,
    setBillInstances,
    transactions,
    setTransactions,
    clients,
    setClients,
    appointments,
    setAppointments,
    services,
    setServices,
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
