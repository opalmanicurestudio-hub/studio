
import { BillDefinition, billDefinitions } from './financial-data';
import { addDays, subDays, setHours, setMinutes, startOfDay } from 'date-fns';

export type Client = {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string;
  lifetimeValue: number;
  lastAppointment: string;
  notes?: string;
  medicalNotes?: string;
  allergyNotes?: string;
  sensoryNeeds?: string;
  inspirationPhotoUrl?: string;
  isMember?: boolean;
};

export type MaintenanceRecord = {
  id: string;
  date: string; // ISO date string
  description: string;
  cost: number;
  imageUrl?: string;
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
  products?: (InventoryItem & { quantityUsed: number })[]; // Add quantityUsed
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

export type LifespanTestResult = {
  actualLifespanMonths: number;
  totalMaintenanceCost: number;
  totalRevenue: number;
  roi: number;
};

export type InventoryItem = {
  id: string;
  name: string;
  type: 'professional' | 'retail' | 'equipment' | 'overhead';
  category: string;
  totalStock: number; // Full, unopened containers
  supplier: string;
  supplierUrl?: string;
  lifespanYears?: number;
  actualLifespanMonths?: number;
  lastTestResult?: LifespanTestResult;
  costPerUnit?: number; // Landed cost of one full container
  reorderPoint?: number;
  imageUrl?: string;
  
  // For partial usage tracking
  costingMethod?: 'uses' | 'size'; // How to deduct from a partial container
  size?: number; // e.g., 1000 for 1000ml
  unit?: 'ml' | 'oz' | 'g' | 'unit';
  estimatedUses?: number; // e.g., 100 uses per bottle
  
  partialContainerSize?: number; // Amount left in the open container (e.g., 750ml)
  partialContainerUses?: number; // Uses left in the open container (e.g., 80 uses)

  isExperimentActive?: boolean;
  experimentUses?: number;
  batches: Batch[];
  maintenanceHistory?: MaintenanceRecord[];
};

export type Appointment = {
  id: string;
  clientId: string;
  serviceId: string;
  startTime: Date;
  endTime: Date;
  status: 'confirmed' | 'completed' | 'cancelled' | 'deposit_pending';
};

export type Event = {
  id: string;
  title: string;
  type: 'personal' | 'business';
  startTime: Date;
  endTime: Date;
  notes?: string;
}

export type Quote = {
  id: string;
  quoteNumber: string;
  clientId: string;
  eventName: string;
  date: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'booked';
  total: number;
};

export type StockCorrection = {
  id: string;
  productId: string;
  date: string; // ISO date string
  change: number; // e.g., -20 for 20ml used, 1 for 1 new container
  unit: string;
  reason: string; // e.g., 'Appointment #123', 'Manual Count', 'Spoilage'
};


export type Bill = BillDefinition;
export const bills: Bill[] = billDefinitions;


export const clients: Client[] = [
  { id: 'cli-1', name: 'Eleanor Vance', email: 'eleanor@example.com', phone: '202-555-0198', avatarUrl: 'https://picsum.photos/seed/101/100/100', lifetimeValue: 2450.75, lastAppointment: '2024-05-15T10:00:00.000Z', notes: "Redken Shades EQ 1oz 9NB, 1oz 9G. Process for 20 minutes.", medicalNotes: 'Pregnant' },
  { id: 'cli-2', name: 'Marcus Holloway', email: 'marcus@example.com', phone: '310-555-0187', avatarUrl: 'https://picsum.photos/seed/102/100/100', lifetimeValue: 1890.00, lastAppointment: '2024-05-20T14:30:00.000Z', allergyNotes: 'Latex' },
  { id: 'cli-3', name: 'Anya Sharma', email: 'anya@example.com', phone: '773-555-0123', avatarUrl: 'https://picsum.photos/seed/103/100/100', lifetimeValue: 3200.50, lastAppointment: '2024-05-01T11:00:00.000Z' },
  { id: 'cli-4', name: 'Leo Gallagher', email: 'leo@example.com', phone: '415-555-0142', avatarUrl: 'https://picsum.photos/seed/104/100/100', lifetimeValue: 950.00, lastAppointment: '2024-04-22T16:00:00.000Z' },
  { id: 'cli-5', name: 'Sofia Chen', email: 'sofia@example.com', phone: '212-555-0165', avatarUrl: 'https://picsum.photos/seed/105/100/100', lifetimeValue: 4500.00, lastAppointment: '2024-05-18T09:30:00.000Z', sensoryNeeds: 'Prefers quiet' },
];

export const inventory: InventoryItem[] = [
  { id: 'inv-1', name: 'Nail File', type: 'professional', category: 'Tools', totalStock: 50, reorderPoint: 20, supplier: 'ProNailSupply', supplierUrl: 'https://www.nails-r-us.com/pro-files', batches: [{id: 'b1-1', stock: 50, costPerUnit: 0.25, receivedDate: '2024-05-01'}], costingMethod: 'uses', estimatedUses: 1, partialContainerUses: 50, unit: 'uses' },
  { id: 'inv-2', name: 'Cuticle Oil', type: 'professional', category: 'Care', totalStock: 1, reorderPoint: 25, supplier: 'ProNailSupply', batches: [{id: 'b2-1', stock: 1, costPerUnit: 15.00, receivedDate: '2024-05-01'}], costingMethod: 'size', size: 500, unit: 'ml', partialContainerSize: 350 },
  { id: 'inv-3', name: 'Base Coat Polish', type: 'professional', category: 'Color', totalStock: 30, reorderPoint: 10, supplier: 'ColorWorld', isExperimentActive: true, experimentUses: 22, estimatedUses: 30, batches: [{id: 'b3-1', stock: 30, costPerUnit: 0.50, receivedDate: '2024-05-01'}], costingMethod: 'uses', partialContainerUses: 8, unit: 'uses' },
  { id: 'inv-4', name: 'Top Coat Polish', type: 'professional', category: 'Color', totalStock: 30, reorderPoint: 10, supplier: 'ColorWorld', batches: [{id: 'b4-1', stock: 30, costPerUnit: 0.50, receivedDate: '2024-05-01'}], costingMethod: 'uses', partialContainerUses: 30, unit: 'uses' },
  { id: 'inv-5', name: 'Red Nail Polish', type: 'professional', category: 'Color', totalStock: 15, reorderPoint: 5, supplier: 'ColorWorld', batches: [{id: 'b5-1', stock: 15, costPerUnit: 0.80, receivedDate: '2024-05-01', expirationDate: '2024-06-30'}], costingMethod: 'uses', partialContainerUses: 15, unit: 'uses' },
  { id: 'inv-6', name: 'Lotion', type: 'professional', category: 'Care', totalStock: 0, reorderPoint: 20, supplier: 'BeautyCare', batches: [{id: 'b6-1', stock: 0, costPerUnit: 30.00, receivedDate: '2024-05-01'}], costingMethod: 'size', size: 1000, unit: 'ml', partialContainerSize: 50 },
  { id: 'inv-7', name: 'UV Gel Lamp', type: 'equipment', category: 'Tools', totalStock: 2, supplier: 'EquipPro', lifespanYears: 3, batches: [{id: 'b7-1', stock: 2, costPerUnit: 150.00, receivedDate: '2022-01-15'}], maintenanceHistory: [{ id: 'maint-1', date: '2023-08-01', description: 'Replaced UV bulb', cost: 25.00 }] },
  { id: 'inv-8', name: 'Disinfectant Wipes', type: 'overhead', category: 'Cleaning', totalStock: 5, reorderPoint: 2, supplier: 'CleanSupplies', batches: [{id: 'b8-1', stock: 5, costPerUnit: 10.00, receivedDate: '2024-06-01'}] },
  { id: 'inv-9', name: 'Retail Shine Serum', type: 'retail', category: 'Styling', totalStock: 12, reorderPoint: 5, supplier: 'BeautyCare', batches: [{id: 'b9-1', stock: 12, costPerUnit: 8.50, receivedDate: '2024-06-01'}] },
  { id: 'inv-10', name: 'Pro Color Tube 5N', type: 'professional', category: 'Color', totalStock: 2, reorderPoint: 5, supplier: 'ColorWorld', isExperimentActive: false, experimentUses: 0, estimatedUses: 25, batches: [{id: 'b10-1', stock: 2, costPerUnit: 7.00, receivedDate: '2024-06-01'}], costingMethod: 'uses', partialContainerUses: 25, unit: 'uses' },
];

export const services: Service[] = [
  { 
    id: 'svc-1', 
    name: 'Classic Manicure',
    type: 'service',
    category: 'Nails', 
    duration: 45,
    padBefore: 10,
    padAfter: 5,
    price: 45.00,
    cost: 3.50,
    profit: 41.50,
    margin: 92.2,
    imageUrl: 'https://picsum.photos/seed/svc1/200/200',
    products: [
      { ...inventory.find(i => i.id === 'inv-1')!, quantityUsed: 1 },
      { ...inventory.find(i => i.id === 'inv-2')!, quantityUsed: 5 }, // 5ml
      { ...inventory.find(i => i.id === 'inv-3')!, quantityUsed: 1 },
      { ...inventory.find(i => i.id === 'inv-4')!, quantityUsed: 1 },
      { ...inventory.find(i => i.id === 'inv-5')!, quantityUsed: 1 },
      { ...inventory.find(i => i.id === 'inv-6')!, quantityUsed: 10 }, // 10ml
    ],
    equipment: [
        inventory.find(i => i.id === 'inv-7')!
    ]
  },
];

const today = new Date();
export const appointments: Appointment[] = [
    // Today's appointments
  { id: 'apt-0', clientId: 'cli-4', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(today), 8), 0), endTime: setMinutes(setHours(startOfDay(today), 8), 50), status: 'completed' },
  { id: 'apt-1', clientId: 'cli-1', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(today), 9), 30), endTime: setMinutes(setHours(startOfDay(today), 10), 20), status: 'confirmed' },
  { id: 'apt-2', clientId: 'cli-2', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(today), 11), 0), endTime: setMinutes(setHours(startOfDay(today), 11), 50), status: 'completed' },
  { id: 'apt-6', clientId: 'cli-2', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(today), 14), 0), endTime: setMinutes(setHours(startOfDay(today), 14), 50), status: 'deposit_pending' },
  { id: 'apt-3', clientId: 'cli-3', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(today), 15), 0), endTime: setMinutes(setHours(startOfDay(today), 15), 50), status: 'confirmed' },
  { id: 'apt-5', clientId: 'cli-5', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(today), 16), 0), endTime: setMinutes(setHours(startOfDay(today), 16), 50), status: 'cancelled' },

  // Past appointments
  { id: 'apt-4', clientId: 'cli-1', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(subDays(today, 2)), 10), 0), endTime: setMinutes(setHours(startOfDay(subDays(today,2)), 10), 50), status: 'completed' },
  
  // Future appointments
  { id: 'apt-7', clientId: 'cli-3', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(addDays(today, 1)), 11), 0), endTime: setMinutes(setHours(startOfDay(addDays(today, 1)), 11), 50), status: 'confirmed' },
  { id: 'apt-8', clientId: 'cli-1', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(addDays(today, 3)), 10), 0), endTime: setMinutes(setHours(startOfDay(addDays(today, 3)), 10), 50), status: 'confirmed' },
];

export const events: Event[] = [
    { id: 'evt-1', title: 'Lunch with Mom', type: 'personal', startTime: setMinutes(setHours(startOfDay(today), 12), 30), endTime: setMinutes(setHours(startOfDay(today), 13), 30)},
    { id: 'evt-2', title: 'Content Planning', type: 'business', startTime: setMinutes(setHours(startOfDay(today), 9), 0), endTime: setMinutes(setHours(startOfDay(today), 9), 30), notes: 'Plan next week\'s social posts.'},
    { id: 'evt-3', title: 'Pick up supplies', type: 'business', startTime: setMinutes(setHours(startOfDay(today), 17), 0), endTime: setMinutes(setHours(startOfDay(today), 17), 30)},
    { id: 'evt-4', title: 'Dentist', type: 'personal', startTime: setMinutes(setHours(startOfDay(addDays(today, 2)), 15), 0), endTime: setMinutes(setHours(startOfDay(addDays(today, 2)), 16), 0)},
    { id: 'evt-5', title: 'Yoga Class', type: 'personal', startTime: setMinutes(setHours(startOfDay(today), 18), 0), endTime: setMinutes(setHours(startOfDay(today), 19), 0)},
];

export const quotes: Quote[] = [
  { id: 'q-1', quoteNumber: 'Q-001', clientId: 'cli-4', eventName: 'Summer Gala', date: '2024-06-01', status: 'sent', total: 1500.00 },
  { id: 'q-2', quoteNumber: 'Q-002', clientId: 'cli-5', eventName: 'Wedding Prep', date: '2024-06-05', status: 'accepted', total: 2150.00 },
  { id: 'q-3', quoteNumber: 'Q-003', clientId: 'cli-1', eventName: 'Corporate Headshots', date: '2024-06-10', status: 'declined', total: 800.00 },
  { id: 'q-4', quoteNumber: 'Q-004', clientId: 'cli-2', eventName: 'Music Video Shoot', date: '2024-06-12', status: 'draft', total: 2600.00 },
];

export const stockCorrections: StockCorrection[] = [
    { id: 'sc-1', productId: 'inv-3', date: '2024-07-20T11:50:00Z', change: -1, unit: 'use', reason: 'Appointment #apt-2' },
    { id: 'sc-2', productId: 'inv-2', date: '2024-07-20T11:50:00Z', change: -5, unit: 'ml', reason: 'Appointment #apt-2' },
    { id: 'sc-3', productId: 'inv-9', date: '2024-07-19T18:00:00Z', change: -1, unit: 'unit', reason: 'Retail Sale' },
    { id: 'sc-4', productId: 'inv-3', date: '2024-07-18T12:00:00Z', change: 30, unit: 'uses', reason: 'Shipment #SH-001' },
    { id: 'sc-5', productId: 'inv-5', date: '2024-07-17T15:30:00Z', change: -1, unit: 'use', reason: 'Internal Use/Test' },
];

    

    
