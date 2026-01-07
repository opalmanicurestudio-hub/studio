
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
    duration: 60,
    price: 85,
    cost: 15,
    profit: 70,
    margin: 82.35,
  },
  {
    id: '2',
    name: 'Full Color',
    duration: 120,
    price: 250,
    cost: 45,
    profit: 205,
    margin: 82,
  },
  {
    id: '3',
    name: 'Balayage',
    duration: 180,
    price: 350,
    cost: 60,
    profit: 290,
    margin: 82.86,
  },
  {
    id: '4',
    name: 'Deep Conditioning Treatment',
    duration: 30,
    price: 60,
    cost: 10,
    profit: 50,
    margin: 83.33,
  },
];

export const inventory: InventoryItem[] = [
    { id: 'inv1', name: 'Pro Color Tube 5N', type: 'professional', stock: 25, costPerUnit: 8.50, supplier: 'SalonSupply Co.' },
    { id: 'inv2', name: 'Pro Developer 20vol', type: 'professional', stock: 10, costPerUnit: 12.00, supplier: 'SalonSupply Co.' },
    { id: 'inv3', name: 'Retail Shine Serum', type: 'retail', stock: 30, costPerUnit: 14.00, supplier: 'BeautyWares' },
    { id: 'inv4', name: 'Retail Hold Hairspray', type: 'retail', stock: 18, costPerUnit: 11.50, supplier: 'BeautyWares' },
    { id: 'inv5', name: 'Styling Chair', type: 'equipment', stock: 2, costPerUnit: 1200.00, supplier: 'EquipPros' },
    { id: 'inv6', name: 'Pro Shampoo (Gallon)', type: 'professional', stock: 4, costPerUnit: 45.00, supplier: 'SalonSupply Co.' },
    { id: 'inv7', name: 'Paper Towels', type: 'overhead', stock: 50, costPerUnit: 1.00, supplier: 'General Supplies' },
    { id: 'inv8', name: 'Cleaning Spray', type: 'overhead', stock: 5, costPerUnit: 3.00, supplier: 'General Supplies' },
];

export const appointments: Appointment[] = Array.from({ length: 21 }, (_, i) => {
    const day = Math.floor(i / 3);
    const hour = 10 + (i % 3) * 2;
    const client = clients[i % clients.length];
    const service = services[i % services.length];

    const today = new Date();
    const currentDayOfWeek = today.getDay();
    const daysSinceSunday = currentDayOfWeek;
    const firstDayOfWeek = new Date(today.setDate(today.getDate() - daysSinceSunday));

    const startTime = new Date(firstDayOfWeek);
    startTime.setDate(firstDayOfWeek.getDate() + day);
    startTime.setHours(hour, 0, 0, 0);

    const endTime = new Date(startTime);
    endTime.setMinutes(startTime.getMinutes() + service.duration);
    
    return {
        id: `apt${i}`,
        clientId: client.id,
        serviceId: service.id,
        startTime,
        endTime,
        status: i < 18 ? 'completed' : 'confirmed',
    };
});
