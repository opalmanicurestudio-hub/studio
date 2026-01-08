
export type BillDefinition = {
  id: string;
  name: string;
  amount: number;
  dueDay: number; // Day of the month
  billingCycle: 'monthly' | 'annually' | 'quarterly' | 'weekly';
  context: 'Business' | 'Personal';
  category: string;
  paymentUrl?: string;
  lateByDay?: number;
  lateFee?: number;
};

export type BillInstance = {
  id: string;
  billDefinitionId: string;
  dueDate: string; // ISO date string
  status: 'unpaid' | 'partially-paid' | 'paid' | 'overdue';
  amountDue: number;
  amountPaid: number;
};

export type Transaction = {
  id: string;
  date: string; // ISO date string
  description: string;
  clientOrVendor: string;
  type: 'income' | 'expense' | 'reversal' | 'payment';
  context: 'Business' | 'Personal';
  category: string;
  amount: number;
  hasReceipt: boolean;
  relatedBillInstanceId?: string; // Link to a bill instance
};


export const billDefinitions: BillDefinition[] = [
  // Personal Bills
  { id: 'p1', name: 'Rent/Mortgage', amount: 2000, dueDay: 1, billingCycle: 'monthly', context: 'Personal', category: 'Housing' },
  { id: 'p2', name: 'Property Taxes', amount: 0, dueDay: 15, billingCycle: 'monthly', context: 'Personal', category: 'Housing' },
  { id: 'p3', name: 'HOA Fees', amount: 0, dueDay: 1, billingCycle: 'monthly', context: 'Personal', category: 'Housing' },
  { id: 'p4', name: 'Insurance', amount: 150, dueDay: 10, billingCycle: 'monthly', context: 'Personal', category: 'Housing' },
  { id: 'p5', name: 'Electric', amount: 100, dueDay: 20, billingCycle: 'monthly', context: 'Personal', category: 'Utilities' },
  { id: 'p6', name: 'Water', amount: 50, dueDay: 20, billingCycle: 'monthly', context: 'Personal', category: 'Utilities' },
  { id: 'p7', name: 'Gas', amount: 30, dueDay: 20, billingCycle: 'monthly', context: 'Personal', category: 'Utilities' },
  { id: 'p8', name: 'Waste Management', amount: 25, dueDay: 20, billingCycle: 'monthly', context: 'Personal', category: 'Utilities' },
  { id: 'p9', name: 'Internet Bill', amount: 80, dueDay: 5, billingCycle: 'monthly', context: 'Personal', category: 'Internet & Phone' },
  { id: 'p10', name: 'Cell Phone Bill', amount: 90, dueDay: 15, billingCycle: 'monthly', context: 'Personal', category: 'Internet & Phone' },
  { id: 'p11', name: 'Car Payment', amount: 350, dueDay: 25, billingCycle: 'monthly', context: 'Personal', category: 'Transportation' },
  { id: 'p12', name: 'Car Insurance', amount: 150, dueDay: 15, billingCycle: 'monthly', context: 'Personal', category: 'Transportation' },
  { id: 'p13', name: 'Student Loans', amount: 400, dueDay: 25, billingCycle: 'monthly', context: 'Personal', category: 'Debt Repayment' },

  // Business Bills
  { id: 'b1', name: 'Studio Rent', amount: 1200, dueDay: 1, billingCycle: 'monthly', context: 'Business', category: 'Rent & Facility' },
  { id: 'b2', name: 'Booking Software', amount: 49, dueDay: 5, billingCycle: 'monthly', context: 'Business', category: 'Software & Systems' },
  { id: 'b3', name: 'Liability Insurance', amount: 100, dueDay: 20, billingCycle: 'monthly', context: 'Business', category: 'Rent & Facility' },
];

export const billInstances: BillInstance[] = [
    { id: 'bi1', billDefinitionId: 'b1', dueDate: '2024-07-01', status: 'paid', amountDue: 1200.00, amountPaid: 1200.00 },
    { id: 'bi2', billDefinitionId: 'p1', dueDate: '2024-07-01', status: 'paid', amountDue: 2000.00, amountPaid: 2000.00 },
    { id: 'bi3', billDefinitionId: 'p12', dueDate: '2024-06-15', status: 'overdue', amountDue: 150.00, amountPaid: 0 },
    { id: 'bi4', billDefinitionId: 'p11', dueDate: '2024-07-25', status: 'partially-paid', amountDue: 350.00, amountPaid: 200.00 },
    { id: 'bi5', billDefinitionId: 'b2', dueDate: '2024-08-05', status: 'unpaid', amountDue: 49.00, amountPaid: 0 },
];


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
    id: 't-pay1',
    date: '2024-07-01',
    description: 'Payment for Studio Rent (July)',
    clientOrVendor: 'City Properties',
    type: 'payment',
    context: 'Business',
    category: 'Rent',
    amount: 1200.00,
    hasReceipt: true,
    relatedBillInstanceId: 'bi1',
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
    id: 't-pay2',
    date: '2024-07-26',
    description: 'Partial payment for Car Loan',
    clientOrVendor: 'Auto Finance Co.',
    type: 'payment',
    context: 'Personal',
    category: 'Transportation',
    amount: 200.00,
    hasReceipt: false,
    relatedBillInstanceId: 'bi4'
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
