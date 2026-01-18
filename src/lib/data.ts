

import { BillDefinition, billDefinitions, billInstances, transactions } from './financial-data';
import { addDays, subDays, setHours, setMinutes, startOfDay } from 'date-fns';
import { nanoid } from 'nanoid';

export type Incident = {
    id: string;
    date: string;
    type: string;
    severity: 'Minor' | 'Moderate' | 'Severe';
    description: string;
    actionsTaken?: string;
    photoUrl?: string;
    appointmentId?: string; // Optional link to an appointment
};

export type ClientIntel = {
    hasIncidents?: boolean;
    incidents?: Incident[];
    referralSource?: string;
};

export type CustomFormula = {
  name: string;
  items: {
    productId: string;
    productName: string;
    quantityUsed: number;
    unit: string;
    note?: string;
  }[];
};

export type Client = {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string;
  lifetimeValue: number;
  lastAppointment: string;
  status?: 'active' | 'archived';
  notes?: string;
  customFormulas?: CustomFormula[];
  medicalNotes?: string;
  allergyNotes?: string;
  sensoryNeeds?: string;
  inspirationPhotoUrl?: string;
  intel?: ClientIntel;
  activeMembershipId?: string;
  activePackages?: {
    packageId: string;
    sessionsRemaining: number;
  }[];
  referralCode?: string;
  referredBy?: string;
  successfulReferrals?: string[];
  walletCredit?: number;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
  }
  birthday?: string;
};

export type LocationType = {
  id: string;
  name: string;
  icon: string;
};

export type Location = {
  id: string;
  name: string;
  locationTypeId: string;
  description?: string;
  environmentalNeeds?: string[];
  customNeeds?: string;
  photoUrl?: string;
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
  isPrivate?: boolean;
  confirmationMessage?: string;
  requiredFormIds?: string[];
  status?: 'active' | 'archived';
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
  status?: 'active' | 'archived';
  totalStock: number; // Full, unopened containers
  supplier: string;
  supplierUrl?: string;
  lifespanYears?: number;
  actualLifespanMonths?: number;
  lastTestResult?: LifespanTestResult;
  costPerUnit?: number; // Landed cost of one full container
  reorderPoint?: number;
  imageUrl?: string;
  primaryLocationId?: string;
  secondaryLocationIds?: string[];
  
  // For partial usage tracking
  costingMethod?: 'uses' | 'size'; // How to deduct from a partial container
  size?: number; // e.g., 1000 for 1000ml
  unit?: 'ml' | 'oz' | 'g' | 'unit';
  estimatedUses?: number; // e.g., 100 uses per bottle
  useUnit?: string; // e.g., 'pumps', 'sprays', 'drops'
  
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
  addOnIds?: string[];
  inspirationPhotoUrl?: string;
  absorbedCost?: number;
  incident?: Incident;
};

export type EventChecklistItem = {
  id: string;
  text: string;
  completed: boolean;
};

export type Event = {
  id: string;
  title: string;
  type: 'personal' | 'business' | 'blocked';
  startTime: Date;
  endTime: Date;
  notes?: string;
  location?: string;
  cost?: number;
  isWriteOff?: boolean;
  checklist?: EventChecklistItem[];
  quoteId?: string;
  clientId?: string;
  lineItems?: any[];
  travelExpenses?: number;
  projectFee?: number;
};

export type Quote = {
  id: string;
  quoteNumber?: string;
  clientId: string;
  eventName: string;
  eventDate: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'booked';
  lineItems: any[];
  travelExpenses: number;
  projectFee: number;
  notes?: string;
  totalHours?: number;
  createdAt: string;
  userId: string;
};

export type StockCorrection = {
  id: string;
  productId: string;
  date: string; // ISO date string
  change: number; // e.g., -20 for 20ml used, 1 for 1 new container
  unit: string;
  reason: string; // e.g., 'Appointment #123', 'Manual Count', 'Spoilage'
};

export type Membership = {
  id: string;
  name: string;
  description?: string;
  price: number;
  interval: 'monthly' | 'yearly';
  isPrivate: boolean;
  includedServices?: Service[];
  includedAddOns?: Service[];
  includedProducts?: InventoryItem[];
  retailDiscount?: number;
  forfeitOnLateCancel: boolean;
  forfeitOnNoShow: boolean;
  allowRollover: boolean;
};

export type Package = {
  id: string;
  name: string;
  serviceId: string;
  sessions: number;
  price: number;
  expiresInMonths: number;
  isPrivate: boolean;
};

export type FormField = {
  id: string;
  type: 'heading' | 'paragraph' | 'short-text' | 'long-text' | 'multiple-choice' | 'checkboxes' | 'image-upload' | 'signature';
  label: string;
  options?: string[];
};

export type ConsentForm = {
  id: string;
  title: string;
  category: 'Intake' | 'Waiver' | 'Release' | 'General';
  clientsSigned: number;
  totalClients: number;
  isPasswordProtected: boolean;
  notifyOnEdit: boolean;
  fields?: FormField[];
};


export type Bill = BillDefinition;
export const bills: Bill[] = billDefinitions;


export { billDefinitions, billInstances, transactions };

export const clients: Client[] = [
  { 
    id: 'cli-1', 
    name: 'Eleanor Vance', 
    email: 'eleanor@example.com', 
    phone: '202-555-0198', 
    avatarUrl: 'https://picsum.photos/seed/101/100/100', 
    lifetimeValue: 2450.75, 
    lastAppointment: '2024-07-19T10:00:00.000Z',
    birthday: '1990-05-15',
    notes: "Prefers sitting near the window.",
    customFormulas: [
      {
        name: 'Standard Root Touch-up',
        items: [
          { productId: 'inv-10', productName: 'Pro Color Tube 5N', quantityUsed: 1, unit: 'oz', note: 'Apply to roots first.' },
          { productId: 'inv-3', productName: 'Base Coat Polish', quantityUsed: 1, unit: 'oz' },
        ]
      },
      {
        name: 'Summer Highlights',
        items: [
          { productId: 'inv-10', productName: 'Pro Color Tube 9G', quantityUsed: 2, unit: 'oz' },
          { productId: 'inv-11', productName: '20 Vol Developer', quantityUsed: 2, unit: 'oz', note: 'Use foils.' },
        ]
      }
    ],
    medicalNotes: 'Pregnant',
    inspirationPhotoUrl: 'https://images.unsplash.com/photo-1596796242339-3c368369b139?w=400',
    referralCode: 'ELEANOR10',
    successfulReferrals: ['Leo Gallagher'],
    walletCredit: 10,
  },
  { 
    id: 'cli-2', 
    name: 'Marcus Holloway', 
    email: 'marcus@example.com', 
    phone: '310-555-0187', 
    avatarUrl: 'https://picsum.photos/seed/102/100/100', 
    lifetimeValue: 1890.00, 
    lastAppointment: '2024-05-20T14:30:00.000Z', 
    allergyNotes: 'Latex', 
    referralCode: 'MARCUS15',
    activePackages: [{ packageId: 'pkg-2', sessionsRemaining: 2 }],
  },
  { id: 'cli-3', name: 'Anya Sharma', email: 'anya@example.com', phone: '773-555-0123', avatarUrl: 'https://picsum.photos/seed/103/100/100', lifetimeValue: 3200.50, lastAppointment: '2024-05-01T11:00:00.000Z', referralCode: 'ANYA20', status: 'archived' },
  { id: 'cli-4', name: 'Leo Gallagher', email: 'leo@example.com', phone: '415-555-0142', avatarUrl: 'https://picsum.photos/seed/104/100/100', lifetimeValue: 950.00, lastAppointment: '2024-04-22T16:00:00.000Z', referredBy: 'Eleanor Vance', referralCode: 'LEO5' },
  { 
    id: 'cli-5', 
    name: 'Sofia Chen', 
    email: 'sofia@example.com', 
    phone: '212-555-0165', 
    avatarUrl: 'https://picsum.photos/seed/105/100/100', 
    lifetimeValue: 4500.00, 
    lastAppointment: '2024-05-18T09:30:00.000Z', 
    sensoryNeeds: 'Prefers quiet', 
    activeMembershipId: 'mem-1',
    referralCode: 'SOFIA25' 
  },
];

export const inventory: InventoryItem[] = [
  { id: 'inv-1', name: 'Nail File', type: 'professional', category: 'Tools', totalStock: 50, reorderPoint: 20, supplier: 'ProNailSupply', supplierUrl: 'https://www.nails-r-us.com/pro-files', batches: [{id: 'b1-1', stock: 50, costPerUnit: 0.25, receivedDate: '2024-05-01'}], costingMethod: 'uses', estimatedUses: 1, partialContainerUses: 50, unit: 'uses', primaryLocationId: 'loc-3' },
  { id: 'inv-2', name: 'Cuticle Oil', type: 'professional', category: 'Care', totalStock: 1, reorderPoint: 25, supplier: 'ProNailSupply', batches: [{id: 'b2-1', stock: 1, costPerUnit: 15.00, receivedDate: '2024-05-01'}], costingMethod: 'size', size: 500, unit: 'ml', partialContainerSize: 350, primaryLocationId: 'loc-1' },
  { id: 'inv-3', name: 'Base Coat Polish', type: 'professional', category: 'Color', totalStock: 30, reorderPoint: 10, supplier: 'ColorWorld', isExperimentActive: true, experimentUses: 22, estimatedUses: 30, batches: [{id: 'b3-1', stock: 30, costPerUnit: 0.50, receivedDate: '2024-05-01'}], costingMethod: 'uses', partialContainerUses: 8, unit: 'uses', primaryLocationId: 'loc-1' },
  { id: 'inv-4', name: 'Top Coat Polish', type: 'professional', category: 'Color', totalStock: 30, reorderPoint: 10, supplier: 'ColorWorld', batches: [{id: 'b4-1', stock: 30, costPerUnit: 0.50, receivedDate: '2024-05-01'}], costingMethod: 'uses', partialContainerUses: 30, unit: 'uses', primaryLocationId: 'loc-1' },
  { id: 'inv-5', name: 'Red Nail Polish', type: 'professional', category: 'Color', totalStock: 15, reorderPoint: 5, supplier: 'ColorWorld', batches: [{id: 'b5-1', stock: 15, costPerUnit: 0.80, receivedDate: '2024-05-01', expirationDate: '2024-06-30'}], costingMethod: 'uses', partialContainerUses: 15, unit: 'uses', primaryLocationId: 'loc-1' },
  { id: 'inv-6', name: 'Lotion', type: 'professional', category: 'Care', totalStock: 0, reorderPoint: 20, supplier: 'BeautyCare', batches: [{id: 'b6-1', stock: 0, costPerUnit: 30.00, receivedDate: '2024-05-01'}], costingMethod: 'size', size: 1000, unit: 'ml', partialContainerSize: 50, primaryLocationId: 'loc-1', status: 'archived' },
  { id: 'inv-7', name: 'UV Gel Lamp', type: 'equipment', category: 'Tools', totalStock: 2, supplier: 'EquipPro', lifespanYears: 3, batches: [{id: 'b7-1', stock: 2, costPerUnit: 150.00, receivedDate: '2022-01-15'}], maintenanceHistory: [{ id: 'maint-1', date: '2023-08-01', description: 'Replaced UV bulb', cost: 25.00 }], primaryLocationId: 'loc-3' },
  { id: 'inv-8', name: 'Disinfectant Wipes', type: 'overhead', category: 'Cleaning', totalStock: 5, reorderPoint: 2, supplier: 'CleanSupplies', batches: [{id: 'b8-1', stock: 5, costPerUnit: 10.00, receivedDate: '2024-06-01'}] },
  { id: 'inv-9', name: 'Retail Shine Serum', type: 'retail', category: 'Styling', totalStock: 12, reorderPoint: 5, supplier: 'BeautyCare', batches: [{id: 'b9-1', stock: 12, costPerUnit: 8.50, receivedDate: '2024-06-01'}], primaryLocationId: 'loc-2' },
  { id: 'inv-10', name: 'Pro Color Tube 5N', type: 'professional', category: 'Color', totalStock: 2, reorderPoint: 5, supplier: 'ColorWorld', isExperimentActive: false, experimentUses: 0, estimatedUses: 25, batches: [{id: 'b10-1', stock: 2, costPerUnit: 7.00, receivedDate: '2024-06-01'}], costingMethod: 'uses', partialContainerUses: 25, unit: 'uses', primaryLocationId: 'loc-1' },
  { id: 'inv-11', name: '20 Vol Developer', type: 'professional', category: 'Color', totalStock: 1, reorderPoint: 1, supplier: 'ColorWorld', batches: [{id: 'b11-1', stock: 1, costPerUnit: 12.00, receivedDate: '2024-06-01'}], costingMethod: 'size', size: 1000, unit: 'ml', partialContainerSize: 800, primaryLocationId: 'loc-1' },
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
    ],
    isPrivate: false,
  },
  { 
    id: 'svc-2', 
    name: 'Signature Haircut',
    type: 'service',
    category: 'Hair', 
    duration: 60,
    padAfter: 15,
    price: 85.00,
    cost: 5.00,
    profit: 80.00,
    margin: 94.1,
    imageUrl: 'https://picsum.photos/seed/haircut/200/200',
    isPrivate: true,
  },
   { 
    id: 'svc-3', 
    name: 'All-Over Color',
    type: 'service',
    category: 'Hair', 
    duration: 120,
    padAfter: 30,
    price: 250.00,
    cost: 35.00,
    profit: 215.00,
    margin: 86.0,
    imageUrl: 'https://picsum.photos/seed/haircolor/200/200',
    isPrivate: false,
  },
  { 
    id: 'svc-4', 
    name: 'Deep Cleansing Facial',
    type: 'service',
    category: 'Skincare', 
    duration: 75,
    price: 120.00,
    cost: 15.00,
    profit: 105.00,
    margin: 87.5,
    imageUrl: 'https://picsum.photos/seed/facial/200/200',
    isPrivate: false,
  },
  { 
    id: 'svc-5', 
    name: 'Balayage',
    type: 'service',
    category: 'Hair', 
    duration: 180,
    padAfter: 30,
    price: 350.00,
    cost: 50.00,
    profit: 300.00,
    margin: 85.7,
    imageUrl: 'https://picsum.photos/seed/balayage/200/200',
    isPrivate: false,
  },
  { 
    id: 'svc-6', 
    name: 'Men\'s Haircut',
    type: 'service',
    category: 'Hair', 
    duration: 45,
    padAfter: 10,
    price: 50.00,
    cost: 2.00,
    profit: 48.00,
    margin: 96.0,
    imageUrl: 'https://picsum.photos/seed/menscut/200/200',
    isPrivate: false,
  },
  { 
    id: 'svc-7', 
    name: 'Gel-X Manicure',
    type: 'service',
    category: 'Nails', 
    duration: 90,
    padBefore: 10,
    padAfter: 10,
    price: 95.00,
    cost: 12.00,
    profit: 83.00,
    margin: 87.4,
    imageUrl: 'https://picsum.photos/seed/gelx/200/200',
    isPrivate: false,
  },
  { 
    id: 'svc-8', 
    name: 'Eyebrow Wax',
    type: 'service',
    category: 'Skincare', 
    duration: 15,
    price: 25.00,
    cost: 1.50,
    profit: 23.50,
    margin: 94.0,
    imageUrl: 'https://picsum.photos/seed/eyebrow/200/200',
    isPrivate: false,
  },
  { 
    id: 'svc-9', 
    name: 'Root Touch-Up',
    type: 'service',
    category: 'Hair', 
    duration: 90,
    padAfter: 20,
    price: 120.00,
    cost: 20.00,
    profit: 100.00,
    margin: 83.3,
    imageUrl: 'https://picsum.photos/seed/root-touchup/200/200',
    isPrivate: false,
  },
  { 
    id: 'svc-10', 
    name: 'Toner / Gloss',
    type: 'service',
    category: 'Hair', 
    duration: 45,
    price: 75.00,
    cost: 10.00,
    profit: 65.00,
    margin: 86.7,
    imageUrl: 'https://picsum.photos/seed/toner/200/200',
    isPrivate: false,
  },
  { 
    id: 'svc-11', 
    name: 'Blowout',
    type: 'service',
    category: 'Hair', 
    duration: 45,
    price: 60.00,
    cost: 5.00,
    profit: 55.00,
    margin: 91.7,
    imageUrl: 'https://picsum.photos/seed/blowout/200/200',
    isPrivate: false,
  },
  { 
    id: 'svc-12', 
    name: 'Updo / Styling',
    type: 'service',
    category: 'Hair', 
    duration: 60,
    price: 90.00,
    cost: 8.00,
    profit: 82.00,
    margin: 91.1,
    imageUrl: 'https://picsum.photos/seed/updo/200/200',
    isPrivate: false,
    status: 'archived',
  },
  { 
    id: 'svc-addon-1', 
    name: 'Gel Polish',
    type: 'addon',
    category: 'Nails', 
    duration: 15,
    price: 20.00,
    cost: 2.50,
    profit: 17.50,
    margin: 87.5,
    isPrivate: false,
  },
  { 
    id: 'svc-addon-2', 
    name: 'Deep Conditioning Treatment',
    type: 'addon',
    category: 'Hair', 
    duration: 20,
    price: 35.00,
    cost: 8.00,
    profit: 27.00,
    margin: 77.1,
    isPrivate: false,
  },
  { 
    id: 'svc-addon-3', 
    name: 'Hot Stone Massage',
    type: 'addon',
    category: 'Body', 
    duration: 15,
    price: 25.00,
    cost: 1.00,
    profit: 24.00,
    margin: 96.0,
    isPrivate: false,
  },
  {
    id: 'svc-addon-4',
    name: 'Olaplex Treatment',
    type: 'addon',
    category: 'Hair',
    duration: 15,
    price: 40.00,
    cost: 10.00,
    profit: 30.00,
    margin: 75.0,
    isPrivate: false,
  },
];

const today = new Date();
export const appointments: Appointment[] = [
    // Today's appointments
  { id: 'apt-0', clientId: 'cli-4', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(today), 8), 0), endTime: setMinutes(setHours(startOfDay(today), 8), 50), status: 'completed', absorbedCost: 0 },
  { id: 'apt-1', clientId: 'cli-1', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(subDays(today,1)), 9), 30), endTime: setMinutes(setHours(startOfDay(subDays(today,1)), 10), 20), status: 'confirmed', inspirationPhotoUrl: 'https://images.unsplash.com/photo-1596796242339-3c368369b139?w=400', absorbedCost: 0 },
  { id: 'apt-2', clientId: 'cli-2', serviceId: 'svc-7', startTime: setMinutes(setHours(startOfDay(today), 11), 0), endTime: setMinutes(setHours(startOfDay(today), 12), 30), status: 'completed', addOnIds: ['svc-addon-1'], absorbedCost: 0 },
  { id: 'apt-6', clientId: 'cli-2', serviceId: 'svc-7', startTime: setMinutes(setHours(startOfDay(today), 14), 0), endTime: setMinutes(setHours(startOfDay(today), 15), 30), status: 'confirmed', absorbedCost: 0 },
  { id: 'apt-3', clientId: 'cli-3', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(today), 15), 0), endTime: setMinutes(setHours(startOfDay(today), 15), 50), status: 'confirmed', absorbedCost: 0 },
  { id: 'apt-5', clientId: 'cli-5', serviceId: 'svc-4', startTime: setMinutes(setHours(startOfDay(today), 16), 0), endTime: setMinutes(setHours(startOfDay(today), 17), 15), status: 'confirmed', absorbedCost: 0 },

  // Past appointments
  { id: 'apt-4', clientId: 'cli-1', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(subDays(today, 2)), 10), 0), endTime: setMinutes(setHours(startOfDay(subDays(today,2)), 10), 50), status: 'completed', absorbedCost: 0 },
  
  // Future appointments
  { id: 'apt-7', clientId: 'cli-3', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(addDays(today, 1)), 11), 0), endTime: setMinutes(setHours(startOfDay(addDays(today, 1)), 11), 50), status: 'confirmed', absorbedCost: 0 },
  { id: 'apt-8', clientId: 'cli-1', serviceId: 'svc-1', startTime: setMinutes(setHours(startOfDay(addDays(today, 3)), 10), 0), endTime: setMinutes(setHours(startOfDay(addDays(today, 3)), 10), 50), status: 'confirmed', absorbedCost: 0 },
];

export const events: Event[] = [
    { id: 'evt-1', title: 'Lunch with Mom', type: 'personal', startTime: setMinutes(setHours(startOfDay(today), 12), 30), endTime: setMinutes(setHours(startOfDay(today), 13), 30)},
    { id: 'evt-2', title: 'Content Planning', type: 'business', cost: 0, startTime: setMinutes(setHours(startOfDay(today), 9), 0), endTime: setMinutes(setHours(startOfDay(today), 9), 30), notes: 'Plan next week\'s social posts.', isWriteOff: true},
    { id: 'evt-3', title: 'Pick up supplies', type: 'business', cost: 150, startTime: setMinutes(setHours(startOfDay(today), 17), 0), endTime: setMinutes(setHours(startOfDay(today), 17), 30), location: 'ProNailSupply Downtown', isWriteOff: true, checklist: [{id: 'cl-1', text: 'Nail Files', completed: false}, {id: 'cl-2', text: 'Cuticle Oil', completed: false}]},
    { id: 'evt-4', title: 'Dentist', type: 'personal', startTime: setMinutes(setHours(startOfDay(addDays(today, 2)), 15), 0), endTime: setMinutes(setHours(startOfDay(addDays(today, 2)), 16), 0)},
    { id: 'evt-5', title: 'Yoga Class', type: 'personal', startTime: setMinutes(setHours(startOfDay(today), 18), 0), endTime: setMinutes(setHours(startOfDay(today), 19), 0)},
    { id: 'evt-6', title: 'Unavailable', type: 'blocked', startTime: setMinutes(setHours(startOfDay(addDays(today, 1)), 14), 0), endTime: setMinutes(setHours(startOfDay(addDays(today, 1)), 16), 0)},
    { 
        id: 'evt-7', 
        title: "Sofia's Wedding Prep",
        type: 'business',
        clientId: 'cli-5',
        startTime: setMinutes(setHours(startOfDay(addDays(today, 2)), 9), 0),
        endTime: setMinutes(setHours(startOfDay(addDays(today, 2)), 13), 0),
        location: "The Grand Ballroom",
        notes: "Booked from Quote #q-2. \n\nFull bridal party hair and makeup.",
        quoteId: 'q-2',
        lineItems: [
            { id: 'svc-12', name: 'Updo / Styling', price: 90, cost: 8 },
            { id: 'svc-12', name: 'Updo / Styling', price: 90, cost: 8 },
            { id: 'svc-12', name: 'Updo / Styling', price: 90, cost: 8 },
        ],
        travelExpenses: 150,
        projectFee: 20,
    }
];

export const stockCorrections: StockCorrection[] = [
    { id: 'sc-1', productId: 'inv-3', date: '2024-07-20T11:50:00Z', change: -1, unit: 'use', reason: 'Appointment #apt-2' },
    { id: 'sc-2', productId: 'inv-2', date: '2024-07-20T11:50:00Z', change: -5, unit: 'ml', reason: 'Appointment #apt-2' },
    { id: 'sc-3', productId: 'inv-9', date: '2024-07-19T18:00:00Z', change: -1, unit: 'unit', reason: 'Retail Sale' },
    { id: 'sc-4', productId: 'inv-3', date: '2024-07-18T12:00:00Z', change: 30, unit: 'uses', reason: 'Shipment #SH-001' },
    { id: 'sc-5', productId: 'inv-5', date: '2024-07-17T15:30:00Z', change: -1, unit: 'use', reason: 'Internal Use/Test' },
];

export const memberships: Membership[] = [
    {
      id: 'mem-1',
      name: 'VIP Glow Club',
      description: 'Exclusive monthly perks for our most loyal clients.',
      price: 99,
      interval: 'monthly',
      isPrivate: false,
      includedServices: [services.find(s => s.id === 'svc-4')!], // Deep Cleansing Facial
      includedAddOns: [services.find(s => s.id === 'svc-addon-3')!],
      includedProducts: [inventory.find(i => i.id === 'inv-9')!],
      retailDiscount: 10,
      forfeitOnLateCancel: true,
      forfeitOnNoShow: true,
      allowRollover: false,
    },
      {
      id: 'mem-2',
      name: 'The Colorist',
      description: 'Keep your color fresh and vibrant.',
      price: 150,
      interval: 'monthly',
      isPrivate: true,
      includedServices: [services.find(s => s.id === 'svc-9')!, services.find(s => s.id === 'svc-10')!], // Root Touch-up + Toner
      includedAddOns: [services.find(s => s.id === 'svc-addon-2')!],
      includedProducts: [],
      retailDiscount: 15,
      forfeitOnLateCancel: true,
      forfeitOnNoShow: true,
      allowRollover: true,
    },
];
  
export const packages: Package[] = [
    {
      id: 'pkg-1',
      name: 'Package of 5 Blowouts',
      serviceId: 'svc-11',
      sessions: 5,
      price: 250, // 5 * 60 = 300, so a $50 discount
      expiresInMonths: 6,
      isPrivate: false,
    },
    {
      id: 'pkg-2',
      name: 'Gel-X Loyalty Pack',
      serviceId: 'svc-7',
      sessions: 3,
      price: 255, // 3 * 95 = 285, so a $30 discount
      expiresInMonths: 4,
      isPrivate: false,
    }
];

export const consentForms: ConsentForm[] = [
  {
    id: 'form-1',
    title: 'New Client Intake Form',
    category: 'Intake',
    clientsSigned: 18,
    totalClients: 25,
    isPasswordProtected: false,
    notifyOnEdit: true,
    fields: [
        { id: 'f1', type: 'short-text', label: 'Full Name' },
        { id: 'f2', type: 'short-text', label: 'Email Address' },
        { id: 'f3', type: 'paragraph', label: 'Please list any known allergies or medical conditions.' },
        { id: 'f4', type: 'long-text', label: '' },
        { id: 'f5', type: 'signature', label: 'Client Signature' },
    ]
  },
  {
    id: 'form-2',
    title: 'Chemical Service Waiver',
    category: 'Waiver',
    clientsSigned: 12,
    totalClients: 15,
    isPasswordProtected: true,
    notifyOnEdit: true,
  },
  {
    id: 'form-3',
    title: 'Photo & Video Release',
    category: 'Release',
    clientsSigned: 22,
    totalClients: 25,
    isPasswordProtected: false,
    notifyOnEdit: false,
  },
  {
    id: 'form-4',
    title: 'General Liability Waiver',
    category: 'Waiver',
    clientsSigned: 25,
    totalClients: 25,
    isPasswordProtected: false,
    notifyOnEdit: false,
  },
];


export const initialLocationTypes: LocationType[] = [
  { id: 'lt-1', name: 'General Storage', icon: 'Box' },
  { id: 'lt-2', name: 'Retail Display', icon: 'Store' },
  { id: 'lt-3', name: 'Workstation', icon: 'ClipboardList' },
];

export const initialLocations: Location[] = [
  { id: 'loc-1', name: 'Back Room - Shelf A', locationTypeId: 'lt-1', description: 'Main storage for backstock color and developers.' },
  { id: 'loc-2', name: 'Retail Display - Front', locationTypeId: 'lt-2', description: 'Client-facing retail shelves.' },
  { id: 'loc-3', name: 'Styling Station 1', locationTypeId: 'lt-3' },
];


export { nanoid };

    