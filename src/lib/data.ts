
import { BillDefinition, billDefinitions } from './financial-data';

export type Client = {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string;
  lifetimeValue: number;
  lastAppointment: string;
  notes?: string;
};

export type Service = {
  id: string;
  name:string;
  type: 'service' | 'addon';
  category: string;
  duration: number; // in minutes
  padBefore?: number;
  padAfter?: number;
  price: number;
  cost: number;
  profit: number;
  margin: number;
  imageUrl?: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  type: 'professional' | 'retail' | 'equipment' | 'overhead';
  category?: 'Color' | 'Styling' | 'Care';
  stock: number;
  costPerUnit: number;
  supplier: string;
};

export type Appointment = {
  id: string;
  clientId: string;
  serviceId: string;
  startTime: Date;
  endTime: Date;
  status: 'confirmed' | 'completed' | 'canceled';
};

export type Quote = {
  id: string;
  quoteNumber: string;
  clientId: string;
  eventName: string;
  date: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'booked';
  total: number;
};

export type Bill = BillDefinition;
export const bills: Bill[] = [];


export const clients: Client[] = [];

export const services: Service[] = [
  {
    id: "svc-1",
    name: "Signature Haircut",
    type: "service",
    category: "Haircutting",
    duration: 60,
    padBefore: 0,
    padAfter: 15,
    price: 120.00,
    cost: 35.00,
    profit: 85.00,
    margin: 70.8,
  },
  {
    id: "svc-2",
    name: "All-Over Color",
    type: "service",
    category: "Color",
    duration: 120,
    padBefore: 10,
    padAfter: 20,
    price: 250.00,
    cost: 80.00,
    profit: 170.00,
    margin: 68.0,
  },
  {
    id: "svc-3",
    name: "Deep Conditioning Treatment",
    type: "addon",
    category: "Treatments",
    duration: 15,
    price: 45.00,
    cost: 10.00,
    profit: 35.00,
    margin: 77.8,
  }
];

export const inventory: InventoryItem[] = [];

export const appointments: Appointment[] = [];

export const quotes: Quote[] = [];
