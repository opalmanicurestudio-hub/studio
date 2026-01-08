

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
  products?: InventoryItem[];
  equipment?: InventoryItem[];
  description?: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  type: 'professional' | 'retail' | 'equipment' | 'overhead';
  category?: 'Color' | 'Styling' | 'Care';
  stock: number;
  costPerUnit: number;
  supplier: string;
  lifespanYears?: number;
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

export const services: Service[] = [];

export const inventory: InventoryItem[] = [];

export const appointments: Appointment[] = [];

export const quotes: Quote[] = [];
