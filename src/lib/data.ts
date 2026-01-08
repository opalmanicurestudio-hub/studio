
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
  price: number;
  cost: number;
  profit: number;
  margin: number;
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
}

export const clients: Client[] = [
  {
    id: '1',
    name: 'Alia Johnson',
    email: 'alia.j@example.com',
    phone: '555-0101',
    avatarUrl: 'https://picsum.photos/seed/101/100/100',
    lifetimeValue: 1250.75,
    lastAppointment: '2023-10-15',
  },
  {
    id: '2',
    name: 'Ben Carter',
    email: 'ben.c@example.com',
    phone: '555-0102',
    avatarUrl: 'https://picsum.photos/seed/102/100/100',
    lifetimeValue: 875.00,
    lastAppointment: '2023-10-20',
  },
  {
    id: '3',
    name: 'Carla Rossi',
    email: 'carla.r@example.com',
    phone: '555-0103',
    avatarUrl: 'https://picsum.photos/seed/103/100/100',
    lifetimeValue: 2300.50,
    lastAppointment: '2023-10-18',
  },
   {
    id: '4',
    name: 'David Chen',
    email: 'david.c@example.com',
    phone: '555-0104',
    avatarUrl: 'https://picsum.photos/seed/104/100/100',
    lifetimeValue: 450.00,
    lastAppointment: '2023-09-30',
  },
  {
    id: '5',
    name: 'Elena Rodriguez',
    email: 'elena.r@example.com',
    phone: '555-0105',
    avatarUrl: 'https://picsum.photos/seed/105/100/100',
    lifetimeValue: 1600.25,
    lastAppointment: '2023-10-22',
  }
];

export const services: Service[] = [
  {
    id: '1',
    name: 'Signature Haircut',
    type: 'service',
    category: 'Cutting',
    duration: 60,
    price: 85,
    cost: 15,
    profit: 70,
    margin: 82.35,
  },
  {
    id: '2',
    name: 'Full Color',
    type: 'service',
    category: 'Color',
    duration: 120,
    price: 250,
    cost: 45,
    profit: 205,
    margin: 82,
  },
  {
    id: '3',
    name: 'Balayage',
    type: 'service',
    category: 'Color',
    duration: 180,
    price: 350,
    cost: 60,
    profit: 290,
    margin: 82.86,
  },
  {
    id: '4',
    name: 'Deep Conditioning Treatment',
    type: 'service',
    category: 'Treatments',
    duration: 30,
    price: 60,
    cost: 10,
    profit: 50,
    margin: 83.33,
  },
  {
    id: '5',
    name: 'Toner / Gloss',
    type: 'addon',
    category: 'Color',
    duration: 30,
    price: 50,
    cost: 12,
    profit: 38,
    margin: 76,
  },
  {
    id: '6',
    name: 'Silent Appointment',
    type: 'addon',
    category: 'Experience',
    duration: 0,
    price: 0,
    cost: 0,
    profit: 0,
    margin: 0,
  },
  {
    id: '7',
    name: 'Extra Time',
    type: 'addon',
    category: 'Timing',
    duration: 15,
    price: 20,
    cost: 5,
    profit: 15,
    margin: 75,
  }
];

export const inventory: InventoryItem[] = [
    { id: '1', name: 'Pro Color Tube 5N', type: 'professional', category: 'Color', stock: 25, costPerUnit: 8.50, supplier: 'SalonSupply Co.' },
    { id: '2', name: 'Pro Developer 20vol', type: 'professional', category: 'Color', stock: 8, costPerUnit: 12.00, supplier: 'SalonSupply Co.' },
    { id: '3', name: 'Retail Shine Serum', type: 'retail', stock: 30, costPerUnit: 14.00, supplier: 'BeautyWares' },
    { id: '4', name: 'Retail Hold Hairspray', type: 'retail', stock: 18, costPerUnit: 11.50, supplier: 'BeautyWares' },
    { id: '5', name: 'Styling Chair', type: 'equipment', stock: 2, costPerUnit: 1200.00, supplier: 'EquipPros' },
    { id: '6', name: 'Pro Shampoo (Gallon)', type: 'professional', category: 'Care', stock: 4, costPerUnit: 45.00, supplier: 'SalonSupply Co.' },
    { id: '7', name: 'Paper Towels', type: 'overhead', stock: 50, costPerUnit: 1.00, supplier: 'General Supplies' },
    { id: '8', name: 'Cleaning Spray', type: 'overhead', stock: 5, costPerUnit: 3.00, supplier: 'General Supplies' },
    { id: '9', name: 'Pro Mousse', type: 'professional', category: 'Styling', stock: 15, costPerUnit: 9.75, supplier: 'SalonSupply Co.' },
    { id: '10', name: 'Pro Conditioner (Gallon)', type: 'professional', category: 'Care', stock: 0, costPerUnit: 48.00, supplier: 'SalonSupply Co.' },
];

export const appointments: Appointment[] = Array.from({ length: 21 }, (_, i) => {
    let dayOffset = Math.floor(i / 3);
    const hour = 9 + Math.floor(Math.random() * 8); // 9am to 5pm
    const minute = Math.random() > 0.5 ? 30 : 0;
    
    const client = clients[i % clients.length];
    let service = services[i % services.length];

    // Ensure we don't only have add-ons as primary services
    if (service.type === 'addon') {
        service = services.filter(s => s.type === 'service')[i % services.filter(s => s.type === 'service').length];
    }
    
    const today = new Date();
    const currentDayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
    
    // Make appointments for today
    if (i < 4) {
        dayOffset = currentDayOfWeek;
    } else {
        // Distribute other appointments across the week relative to today
        dayOffset = (currentDayOfWeek + i) % 7;
    }
    
    const targetDay = new Date();
    targetDay.setDate(today.getDate() - currentDayOfWeek + dayOffset);


    const startTime = new Date(targetDay);
    startTime.setHours(hour, minute, 0, 0);

    const endTime = new Date(startTime);
    endTime.setMinutes(startTime.getMinutes() + service.duration);
    
    let status: Appointment['status'] = 'confirmed';
    if (startTime < today && dayOffset < currentDayOfWeek) {
        status = 'completed';
    } else if (i % 10 === 0) { // Randomly cancel some
        status = 'canceled';
    }


    return {
        id: `apt${i}`,
        clientId: client.id,
        serviceId: service.id,
        startTime,
        endTime,
        status: status,
    };
}).sort((a,b) => a.startTime.getTime() - b.startTime.getTime());

export const quotes: Quote[] = [
  { id: '1', quoteNumber: 'Q-2024-001', clientId: '3', eventName: 'Carla & Mark\'s Wedding', date: '2024-09-14', status: 'accepted', total: 1850.00 },
  { id: '2', quoteNumber: 'Q-2024-002', clientId: '5', eventName: 'Rodriguez Family Photoshoot', date: '2024-08-20', status: 'sent', total: 600.00 },
  { id: '3', quoteNumber: 'Q-2024-003', clientId: '1', eventName: 'Gala Prep Package', date: '2024-07-30', status: 'draft', total: 450.00 },
  { id: '4', quoteNumber: 'Q-2024-004', clientId: '2', eventName: 'Corporate Headshots - Onsite', date: '2024-08-10', status: 'declined', total: 2200.00 },
  { id: '5', quoteNumber: 'Q-2024-005', clientId: '4', eventName: 'Birthday Glam Session', date: '2024-07-28', status: 'booked', total: 300.00 },
];
