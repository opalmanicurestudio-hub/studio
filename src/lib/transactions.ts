
export type Transaction = {
  id: string;
  date: string;
  description: string;
  clientOrVendor: string;
  type: 'income' | 'expense' | 'reversal';
  context: 'Business' | 'Personal';
  category: string;
  amount: number;
  hasReceipt: boolean;
};

export const transactions: Transaction[] = [
  {
    id: '1',
    date: '2024-07-22',
    description: 'Service Payment: Balayage',
    clientOrVendor: 'Carla Rossi',
    type: 'income',
    context: 'Business',
    category: 'Service Revenue',
    amount: 350.00,
    hasReceipt: false,
  },
  {
    id: '2',
    date: '2024-07-22',
    description: 'Retail Sale: Shine Serum',
    clientOrVendor: 'Carla Rossi',
    type: 'income',
    context: 'Business',
    category: 'Retail Revenue',
    amount: 35.00,
    hasReceipt: false,
  },
  {
    id: '3',
    date: '2024-07-21',
    description: 'Supplies Order',
    clientOrVendor: 'SalonSupply Co.',
    type: 'expense',
    context: 'Business',
    category: 'Supplies',
    amount: 145.50,
    hasReceipt: true,
  },
  {
    id: '4',
    date: '2024-07-20',
    description: 'Groceries',
    clientOrVendor: 'SuperMart',
    type: 'expense',
    context: 'Personal',
    category: 'Food',
    amount: 88.23,
    hasReceipt: true,
  },
  {
    id: '5',
    date: '2024-07-20',
    description: 'Studio Rent',
    clientOrVendor: 'City Properties',
    type: 'expense',
    context: 'Business',
    category: 'Rent',
    amount: 1200.00,
    hasReceipt: false,
  },
  {
    id: '6',
    date: '2024-07-19',
    description: 'Service Payment: Signature Haircut',
    clientOrVendor: 'Alia Johnson',
    type: 'income',
    context: 'Business',
    category: 'Service Revenue',
    amount: 85.00,
    hasReceipt: false,
  },
  {
    id: '7',
    date: '2024-07-18',
    description: 'Refund: Canceled Appointment',
    clientOrVendor: 'Ben Carter',
    type: 'reversal',
    context: 'Business',
    category: 'Refunds',
    amount: 50.00,
    hasReceipt: false,
  },
  {
    id: '8',
    date: '2024-07-17',
    description: 'Internet Bill',
    clientOrVendor: 'ConnectFast',
    type: 'expense',
    context: 'Personal',
    category: 'Utilities',
    amount: 65.00,
    hasReceipt: false,
  },
];
