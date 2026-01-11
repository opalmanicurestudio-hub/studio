


export type BillDefinition = {
  id: string;
  name: string;
  amount: number;
  dueDay: number; // Day of the month
  startDate: string; // ISO date string, e.g., '2024-01-01'
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
  paymentMethod: string;
  paymentMethodIdentifier?: string;
  hasReceipt: boolean;
  receiptUrl?: string;
  relatedBillInstanceId?: string; // Link to a bill instance
  relatedEventId?: string; // Link to an event
};


export const billDefinitions: BillDefinition[] = [
  // Personal Bills
  { id: 'p1', name: 'Rent/Mortgage', amount: 2000, dueDay: 1, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Housing' },
  { id: 'p2', name: 'Property Taxes', amount: 0, dueDay: 15, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Housing' },
  { id: 'p3', name: 'HOA Fees', amount: 0, dueDay: 1, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Housing' },
  { id: 'p4', name: 'Insurance', amount: 150, dueDay: 10, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Housing' },
  { id: 'p5', name: 'Electric', amount: 100, dueDay: 20, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Utilities' },
  { id: 'p6', name: 'Water', amount: 50, dueDay: 20, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Utilities' },
  { id: 'p7', name: 'Gas', amount: 30, dueDay: 20, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Utilities' },
  { id: 'p8', name: 'Waste Management', amount: 25, dueDay: 20, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Utilities' },
  { id: 'p9', name: 'Internet Bill', amount: 80, dueDay: 5, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Internet & Phone' },
  { id: 'p10', name: 'Cell Phone Bill', amount: 90, dueDay: 15, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Internet & Phone' },
  { id: 'p11', name: 'Car Payment', amount: 350, dueDay: 25, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Transportation' },
  { id: 'p12', name: 'Car Insurance', amount: 150, dueDay: 15, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Transportation' },
  { id: 'p13', name: 'Student Loans', amount: 400, dueDay: 25, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Personal', category: 'Debt Repayment' },

  // Business Bills
  { id: 'b1', name: 'Studio Rent', amount: 1200, dueDay: 1, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Business', category: 'Rent & Facility' },
  { id: 'b2', name: 'Booking Software', amount: 49, dueDay: 5, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Business', category: 'Software & Systems' },
  { id: 'b3', name: 'Liability Insurance', amount: 100, dueDay: 20, startDate: '2024-01-01', billingCycle: 'monthly', context: 'Business', category: 'Rent & Facility' },
];

export const billInstances: BillInstance[] = [
    // --- YEAR-END ROLLOVER SCENARIO ---
    // A bill from last year that is still overdue
    { id: 'bi-dec-2023-insurance', billDefinitionId: 'b3', dueDate: '2023-12-20T00:00:00.000Z', status: 'overdue', amountDue: 100.00, amountPaid: 0 },
    
    // --- CURRENT YEAR SCENARIO ---
    // Scenario: June rent is past due for the current year
    { id: 'bi-june-rent', billDefinitionId: 'b1', dueDate: '2024-06-01T00:00:00.000Z', status: 'overdue', amountDue: 1200.00, amountPaid: 0 },
    // Scenario: July rent is due for the current year
    { id: 'bi-july-rent', billDefinitionId: 'b1', dueDate: '2024-07-01T00:00:00.000Z', status: 'paid', amountDue: 1200.00, amountPaid: 1200.00 },
    // Scenario: August rent is upcoming
    { id: 'bi-aug-rent', billDefinitionId: 'b1', dueDate: '2024-08-01T00:00:00.000Z', status: 'unpaid', amountDue: 1200.00, amountPaid: 0 },

    // Other examples
    { id: 'bi-july-personal-rent', billDefinitionId: 'p1', dueDate: '2024-07-01T00:00:00.000Z', status: 'paid', amountDue: 2000.00, amountPaid: 2000.00 },
    { id: 'bi-june-car-insurance', billDefinitionId: 'p12', dueDate: '2024-06-15T00:00:00.000Z', status: 'overdue', amountDue: 150.00, amountPaid: 0 },
    { id: 'bi-today-car-payment-unpaid', billDefinitionId: 'p11', dueDate: new Date().toISOString(), status: 'unpaid', amountDue: 350.00, amountPaid: 0 },
    { id: 'bi-today-booking-software-overdue', billDefinitionId: 'b2', dueDate: new Date().toISOString(), status: 'overdue', amountDue: 49.00, amountPaid: 0 },
];


export const transactions: Transaction[] = [
  // This is now mock data. The Ledger page fetches from Firestore.
  // You can use this to seed the database if needed.
  {
    id: 'txn-1',
    date: new Date().toISOString(),
    description: 'Parking for supply run',
    clientOrVendor: 'City Parking',
    type: 'expense',
    context: 'Business',
    category: 'Travel',
    amount: 8.50,
    paymentMethod: 'Business Credit Card',
    hasReceipt: false,
    relatedEventId: 'evt-3',
  },
  {
    id: 'txn-2',
    date: '2024-07-01T00:00:00.000Z',
    description: 'Payment for Studio Rent - July',
    clientOrVendor: 'Landlord',
    type: 'payment',
    context: 'Business',
    category: 'Rent & Facility',
    amount: 1200.00,
    paymentMethod: 'Business Checking',
    hasReceipt: true,
    relatedBillInstanceId: 'bi-july-rent',
  },
   {
    id: 'txn-event-expense',
    date: new Date().toISOString(),
    description: 'Expense for: Pick up supplies',
    clientOrVendor: 'ProNailSupply',
    type: 'expense' as const,
    context: 'Business',
    category: 'Supplies',
    amount: 75.50,
    paymentMethod: 'Business Credit Card',
    paymentMethodIdentifier: '**** 4567',
    hasReceipt: true,
    receiptUrl: 'https://picsum.photos/seed/receipt1/400/600',
    relatedEventId: 'evt-3'
  },
];
