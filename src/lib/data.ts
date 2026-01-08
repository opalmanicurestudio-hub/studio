
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

export type Batch = {
  id: string;
  stock: number;
  costPerUnit: number;
  receivedDate: string; // ISO date string
  expirationDate?: string; // ISO date string
};

export type InventoryItem = {
  id: string;
  name: string;
  type: 'professional' | 'retail' | 'equipment' | 'overhead';
  category: string;
  totalStock: number;
  supplier: string;
  lifespanYears?: number;
  isExperimentActive?: boolean;
  experimentUses?: number;
  estimatedUses?: number;
  batches: Batch[];
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
export const bills: Bill[] = billDefinitions;


export const clients: Client[] = [
  { id: 'cli-1', name: 'Eleanor Vance', email: 'eleanor@example.com', phone: '202-555-0198', avatarUrl: 'https://picsum.photos/seed/101/100/100', lifetimeValue: 2450.75, lastAppointment: '2024-05-15T10:00:00.000Z' },
  { id: 'cli-2', name: 'Marcus Holloway', email: 'marcus@example.com', phone: '310-555-0187', avatarUrl: 'https://picsum.photos/seed/102/100/100', lifetimeValue: 1890.00, lastAppointment: '2024-05-20T14:30:00.000Z' },
  { id: 'cli-3', name: 'Anya Sharma', email: 'anya@example.com', phone: '773-555-0123', avatarUrl: 'https://picsum.photos/seed/103/100/100', lifetimeValue: 3200.50, lastAppointment: '2024-05-01T11:00:00.000Z' },
  { id: 'cli-4', name: 'Leo Gallagher', email: 'leo@example.com', phone: '415-555-0142', avatarUrl: 'https://picsum.photos/seed/104/100/100', lifetimeValue: 950.00, lastAppointment: '2024-04-22T16:00:00.000Z' },
  { id: 'cli-5', name: 'Sofia Chen', email: 'sofia@example.com', phone: '212-555-0165', avatarUrl: 'https://picsum.photos/seed/105/100/100', lifetimeValue: 4500.00, lastAppointment: '2024-05-18T09:30:00.000Z' },
];

export const inventory: InventoryItem[] = [
  { id: 'inv-1', name: 'Nail File', type: 'professional', category: 'Tools', totalStock: 50, supplier: 'ProNailSupply', batches: [{id: 'b1-1', stock: 50, costPerUnit: 0.25, receivedDate: '2024-05-01'}] },
  { id: 'inv-2', name: 'Cuticle Oil', type: 'professional', category: 'Care', totalStock: 100, supplier: 'ProNailSupply', batches: [{id: 'b2-1', stock: 100, costPerUnit: 0.15, receivedDate: '2024-05-01'}] },
  { id: 'inv-3', name: 'Base Coat Polish', type: 'professional', category: 'Color', totalStock: 30, supplier: 'ColorWorld', isExperimentActive: true, experimentUses: 22, estimatedUses: 30, batches: [{id: 'b3-1', stock: 30, costPerUnit: 0.50, receivedDate: '2024-05-01'}] },
  { id: 'inv-4', name: 'Top Coat Polish', type: 'professional', category: 'Color', totalStock: 30, supplier: 'ColorWorld', batches: [{id: 'b4-1', stock: 30, costPerUnit: 0.50, receivedDate: '2024-05-01'}] },
  { id: 'inv-5', name: 'Red Nail Polish', type: 'professional', category: 'Color', totalStock: 15, supplier: 'ColorWorld', batches: [{id: 'b5-1', stock: 15, costPerUnit: 0.80, receivedDate: '2024-05-01'}] },
  { id: 'inv-6', name: 'Lotion', type: 'professional', category: 'Care', totalStock: 100, supplier: 'BeautyCare', batches: [{id: 'b6-1', stock: 100, costPerUnit: 0.30, receivedDate: '2024-05-01'}] },
  { id: 'inv-7', name: 'UV Gel Lamp', type: 'equipment', category: 'Tools', totalStock: 2, supplier: 'EquipPro', lifespanYears: 3, batches: [{id: 'b7-1', stock: 2, costPerUnit: 150.00, receivedDate: '2024-01-15'}] },
  { id: 'inv-8', name: 'Disinfectant Wipes', type: 'overhead', category: 'Cleaning', totalStock: 5, supplier: 'CleanSupplies', batches: [{id: 'b8-1', stock: 5, costPerUnit: 10.00, receivedDate: '2024-06-01'}] },
  { id: 'inv-9', name: 'Retail Shine Serum', type: 'retail', category: 'Styling', totalStock: 12, supplier: 'BeautyCare', batches: [{id: 'b9-1', stock: 12, costPerUnit: 8.50, receivedDate: '2024-06-01'}] },
  { id: 'inv-10', name: 'Pro Color Tube 5N', type: 'professional', category: 'Color', totalStock: 20, supplier: 'ColorWorld', isExperimentActive: false, experimentUses: 0, estimatedUses: 25, batches: [{id: 'b10-1', stock: 20, costPerUnit: 7.00, receivedDate: '2024-06-01'}] },
];

export const services: Service[] = [
  { 
    id: 'svc-1', 
    name: 'Classic Manicure',
    type: 'service',
    category: 'Nails', 
    duration: 45,
    padAfter: 5,
    price: 45.00,
    cost: 3.50,
    profit: 41.50,
    margin: 92.2,
    imageUrl: 'https://picsum.photos/seed/svc1/200/200',
    products: inventory.filter(i => ['inv-1', 'inv-2', 'inv-3', 'inv-4', 'inv-5', 'inv-6'].includes(i.id))
  },
];


export const appointments: Appointment[] = [
  { id: 'apt-1', clientId: 'cli-1', serviceId: 'svc-1', startTime: new Date('2024-07-20T10:00:00'), endTime: new Date('2024-07-20T10:45:00'), status: 'confirmed' },
  { id: 'apt-2', clientId: 'cli-2', serviceId: 'svc-1', startTime: new Date('2024-07-20T11:00:00'), endTime: new Date('2024-07-20T11:45:00'), status: 'completed' },
  { id: 'apt-3', clientId: 'cli-3', serviceId: 'svc-1', startTime: new Date('2024-07-21T14:00:00'), endTime: new Date('2024-07-21T14:45:00'), status: 'confirmed' },
  { id: 'apt-4', clientId: 'cli-1', serviceId: 'svc-1', startTime: new Date('2024-06-15T10:00:00'), endTime: new Date('2024-06-15T10:45:00'), status: 'completed' },
  { id: 'apt-5', clientId: 'cli-5', serviceId: 'svc-1', startTime: new Date('2024-07-22T13:00:00'), endTime: new Date('2024-07-22T13:45:00'), status: 'canceled' },
];

export const quotes: Quote[] = [
  { id: 'q-1', quoteNumber: 'Q-001', clientId: 'cli-4', eventName: 'Summer Gala', date: '2024-06-01', status: 'sent', total: 1500.00 },
  { id: 'q-2', quoteNumber: 'Q-002', clientId: 'cli-5', eventName: 'Wedding Prep', date: '2024-06-05', status: 'accepted', total: 2150.00 },
  { id: 'q-3', quoteNumber: 'Q-003', clientId: 'cli-1', eventName: 'Corporate Headshots', date: '2024-06-10', status: 'declined', total: 800.00 },
  { id: 'q-4', quoteNumber: 'Q-004', clientId: 'cli-2', eventName: 'Music Video Shoot', date: '2024-06-12', status: 'draft', total: 2600.00 },
];
