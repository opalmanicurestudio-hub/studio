
import { BillDefinition, billDefinitions, billInstances, transactions } from './financial-data';
import { addDays, subDays, setHours, setMinutes, startOfDay, parseISO } from 'date-fns';
import { nanoid } from 'nanoid';

export type Incident = {
    id: string;
    date: string;
    type: string;
    severity: 'Minor' | 'Moderate' | 'Severe';
    description: string;
    actionsTaken?: string;
    photoUrls?: string[];
    appointmentId?: string; 
};

export type ClientIntel = {
    hasIncidents?: boolean;
    incidents?: Incident[];
    referralSource?: string;
};

export type CustomFormula = {
  id: string;
  name: string;
  date: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    costPerUnit: number;
  }[];
  notes?: string;
};

export type DayHours = {
    enabled: boolean;
    start: string;
    end: string;
};

export type Staff = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone?: string;
  role: 'admin' | 'staff' | 'owner';
  pricingTierId?: string;
  avatarUrl: string;
  payStructure: 'commission' | 'hourly' | 'salary' | 'hourly_plus_commission';
  commissionRate: number; 
  retailCommissionRate?: number; 
  hourlyRate?: number;
  services?: string[];
  bio?: string;
  specialties?: string[];
  instagramUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  twitterUrl?: string;
  pinterestUrl?: string;
  youtubeUrl?: string;
  portfolioUrl?: string;
  portfolioImageUrls?: string[];
  yearsOfExperience?: number;
  clientCount?: number;
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
  };
  availability?: {
    week: {
      sunday: DayHours;
      monday: DayHours;
      tuesday: DayHours;
      wednesday: DayHours;
      thursday: DayHours;
      friday: DayHours;
      saturday: DayHours;
    }
  };
  availabilityNotes?: string;
  preferences?: string;
  compliance?: {
    licenseNumber?: string;
    licenseExpiry?: string; 
    documentUrl?: string;
  };
  assignedFormIds?: string[];
  active?: boolean;
  showOnPublicPage?: boolean;
  onBreak?: boolean;
  breakStartTime?: string; 
  status?: 'idle' | 'busy';
  lastServedTimestamp?: string;
  turnOrder?: number;
  skillSet?: string[];
  pin?: string;
};

export type ActivityLog = {
    id: string;
    staffId: string;
    type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
    timestamp: string; 
    durationMinutes?: number;
};

export type WaivedFee = {
    feeId: string;
    appointmentId: string;
    appointmentDate: string;
    feeAmount: number;
    reason: string;
    waivedBy: string; 
    waivedByName?: string;
    waivedAt: string; 
};

export type Redemption = {
    id: string;
    clientId: string;
    type: 'membership' | 'package';
    offeringId: string;
    offeringName: string;
    serviceId: string;
    serviceName: string;
    date: string; 
    staffId?: string;
    isForfeit?: boolean;
};

export type CardOnFile = {
    brand: string;
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    token: string; 
};

export type Client = {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string;
  lifetimeValue: number;
  lastAppointment: string;
  status?: 'active' | 'archived' | 'banned';
  notes?: {
    goals?: string;
    routine?: string;
    history?: string;
    general?: string;
  };
  customFormulas?: CustomFormula[];
  medicalNotes?: string;
  allergyNotes?: string;
  sensoryNeeds?: string;
  inspirationPhotoUrl?: string;
  intel?: ClientIntel;
  activeMembershipId?: string;
  subscription?: {
    membershipId: string;
    status: 'active' | 'past_due' | 'canceled';
    nextBillingDate: string;
    perkLastUsed?: string;
    perkUsage?: { [itemId: string]: number };
  };
  cardOnFile?: CardOnFile;
  activePackages?: {
    packageId: string;
    sessionsRemaining: number;
  }[];
  referralCode?: string;
  referredBy?: string;
  successfulReferrals?: string[];
  walletCredit?: number;
  outstandingBalance?: number;
  unpaidFees?: {
    feeId: string;
    appointmentId: string;
    appointmentDate: string;
    feeAmount: number;
    reason: string;
    staffId?: string;
  }[];
  waivedFees?: WaivedFee[];
  banReason?: string;
  bannedAt?: string;
  bannedBy?: string;
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

export type SubscriptionInstance = {
    id: string;
    clientId: string;
    clientName: string;
    membershipId: string;
    membershipName: string;
    amount: number;
    dueDate: string;
    status: 'pending' | 'paid' | 'failed' | 'cancelled';
    transactionId?: string;
    settledAt?: string;
    paymentMethod?: string;
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
  date: string; 
  description: string;
  cost: number;
  imageUrl?: string;
};

export type ServiceTier = {
    tierId: string;
    price: number;
    durationMinutes: number;
};

export type Service = {
  id: string;
  name:string;
  type: 'service' | 'addon';
  category: string;
  duration: number; 
  padBefore?: number;
  padAfter?: number;
  serviceTiers?: ServiceTier[];
  price: number; 
  cost: number;
  profit: number;
  margin: number;
  imageUrl?: string;
  products?: (InventoryItem & { quantityUsed: number })[]; 
  description?: string;
  isPrivate?: boolean;
  confirmationMessage?: string;
  requiredFormIds?: string[];
  status?: 'active' | 'archived';
  bottomColor?: string;
  depositType?: 'none' | 'deposit' | 'full' | 'breakeven';
  depositSubType?: 'flat' | 'percentage';
  depositAmount?: number;
  requiredSkills?: string[];
  compatibleAddOnIds?: string[];
  capacity?: number;
  fixedCost?: number;
  costPerAttendee?: number;
  requiredResourceIds?: string[];
  // Policy Overrides
  cancellationWindowHours?: number;
  customCancellationFee?: number;
};

export type Batch = {
  id: string;
  stock: number;
  costPerUnit: number;
  receivedDate: string; 
  expirationDate?: string; 
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
  totalStock: number; 
  supplier: string;
  supplierUrl?: string;
  lifespanYears?: number;
  actualLifespanMonths?: number;
  lastTestResult?: LifespanTestResult;
  costPerUnit?: number; 
  reorderPoint?: number;
  imageUrl?: string;
  primaryLocationId?: string;
  secondaryLocationIds?: string[];
  
  costingMethod?: 'uses' | 'size'; 
  size?: number; 
  unit?: 'ml' | 'oz' | 'g' | 'unit';
  estimatedUses?: number; 
  useUnit?: string; 
  
  partialContainerSize?: number; 
  partialContainerUses?: number; 

  isExperimentActive?: boolean;
  experimentUses?: number;
  batches: Batch[];
  maintenanceHistory?: MaintenanceRecord[];
  
  msrp?: number;
  markdownPrice?: number;
  wholesalePrice?: number;
  packagingCost?: number;
  shippingCostToCustomer?: number;
  internalNotes?: string;
  sku?: string;
  restockingMarkup?: number;
};

export type AppointmentCheckoutState = {
    formula: {
        id: string;
        name: string;
        quantity: number;
        unit: string;
        costPerUnit: number;
    }[];
    retailItems: any[];
    addOnServices: Service[];
    actualDuration: number;
    serviceStaffOverrides: Record<string, string>;
    completedServiceIds?: string[];
    concurrentServiceIds?: string[]; 
    tipAllocations: Record<string, number>;
    tipAmount: number;
    additionalCharge: number;
    absorbedCost: number;
    redeemedRetailDiscount?: boolean;
    reviewNotes?: string;
    saveAsCustomFormula?: boolean;
    customFormulaName?: string;
};

export type Appointment = {
  id: string;
  tenantId: string;
  clientId: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  serviceId: string;
  staffId?: string;
  startTime: any;
  endTime: any;
  status: 'confirmed' | 'completed' | 'cancelled' | 'deposit_pending' | 'ready_for_checkout' | 'servicing';
  source: 'online' | 'walk-in' | 'manual';
  addOnIds?: string[];
  inspirationPhotoUrl?: string;
  incident?: Incident;
  inventoryProcessed?: boolean;
  isWalkIn?: boolean;
  actualStartTime?: any;
  actualEndTime?: any;
  checkoutState?: AppointmentCheckoutState;
  checkInStatus?: 'pending' | 'on_my_way' | 'arrived' | 'running_late' | 'auto_cancelled';
  checkInToken?: string;
  lateTimeMinutes?: number;
  automatedRescheduleOffered?: boolean;
  requiredResourceIds?: string[];
  recurrenceId?: string;
  cancellationReason?: 'late' | 'no-show' | 'client_request' | 'other';
  cancellationFeeApplied?: number;
  cancellationFeeWaived?: boolean;
  cancellationPaymentStatus?: 'paid' | 'unpaid' | 'waived';
  waivedBy?: string;
  waivedReason?: string;
  waivedAt?: string;
  revenue?: number;
  tipAmount?: number;
  discountAmount?: number;
  appliedDiscountCode?: string;
  isPotentialAlias?: boolean;
  matchedClientId?: string;
  isSecondary?: boolean;
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
  startTime: any;
  endTime: any;
  allDay?: boolean;
  staffIds?: string[];
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
  status?: 'pending' | 'approved';
  approvedBy?: string;
  approvedAt?: string;
};

export type Order = {
  id: string;
  supplier: string;
  orderDate: string; 
  status: 'Draft' | 'Placed' | 'Shipped' | 'Partially Received' | 'Received' | 'Cancelled';
  trackingNumber?: string;
  trackingUrl?: string;
  expectedArrivalDate?: string; 
  items: {
    productId: string;
    productName: string;
    quantity: number;
    costPerUnit: number;
    receivedQuantity?: number;
  }[];
  notes?: string;
  invoiceUrl?: string;
  paymentMethod?: string;
  paymentContext?: 'Business' | 'Personal';
  paymentMethodIdentifier?: string;
  shippingCost?: number;
  taxCost?: number;
  discounts?: number;
};

export type Quote = {
  id: string;
  quoteNumber?: string;
  clientId: string;
  eventName: string;
  eventDate: string;
  eventLocation: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
  };
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'booked';
  lineItems: any[];
  travelExpenses: number;
  projectFee: number;
  notes?: string;
  totalHours?: number;
  createdAt: string;
  sentAt?: string; 
  userId: string;
  requiredFormIds?: string[];
  staffPayouts: {
      staffId: string;
      name: string;
      amount: number;
  }[];
  depositAmount: number;
  depositType: 'percentage' | 'flat';
  paymentTerms: 'on_receipt' | 'net_15' | 'net_30';
  clientSecret: string;
};

export type WalkIn = {
  id: string;
  groupId: string; 
  groupName?: string; 
  isPrimaryContact?: boolean; 
  clientId?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerBirthday?: string;
  serviceIds: string[];
  requiredSkills: string[];
  estimatedDuration: number;
  checkInTime: string; 
  queueOrder?: number;
  notifiedTimestamp?: string; 
  serviceStartTime?: string; 
  serviceEndTime?: string; 
  status: 'waiting' | 'notified' | 'assigned' | 'servicing' | 'completed' | 'skipped' | 'cancelled' | 'ready_for_checkout';
  assignedStaffId?: string;
  notes?: string;
  preferredStaffId?: string;
  waitForPreferredStaff?: boolean;
  isPotentialAlias?: boolean;
  matchedClientId?: string;
};

export type StockCorrection = {
  id: string;
  productId: string;
  date: string; 
  change: number; 
  unit: string;
  reason: string; 
};

export type MembershipPerk = {
    id: string;
    name: string;
    quantity: number;
}

export type Membership = {
  id: string;
  name: string;
  description?: string;
  price: number;
  interval: 'monthly' | 'yearly';
  isPrivate: boolean;
  includedServices?: MembershipPerk[];
  includedAddOns?: MembershipPerk[];
  includedProducts?: MembershipPerk[];
  retailDiscount?: number;
  retailDiscountLimit?: number; 
  applicableProductIds?: string[];
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
  retailDiscount?: number;
  applicableProductIds?: string[];
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
  clientsSigned?: number;
  totalClients?: number;
  isPasswordProtected: boolean;
  notifyOnEdit: boolean;
  fields?: FormField[];
};

export type TicketData = {
  business: {
    name: string;
    phone: string;
  };
  client: Client;
  appointment: Appointment;
  service: Service;
};

export type BookingFAQItem = {
    id: string;
    question: string;
    answer: string;
};

export type BookingGalleryItem = {
    id: string;
    url: string;
    caption?: string;
};

export type BookingPageSettings = {
    heroImageUrl?: string;
    heroTitle?: string;
    heroSubtitle?: string;
    welcomeMessage?: string;
    primaryColor?: string;
    showTeam?: boolean;
    showReviews?: boolean;
    showFaq?: boolean;
    showGallery?: boolean;
    showMemberships?: boolean;
    showPackages?: boolean;
    servicesSectionTitle?: string;
    teamSectionTitle?: string;
    faqSectionTitle?: string;
    reviewsSectionTitle?: string;
    gallerySectionTitle?: string;
    policiesSectionTitle?: string;
    contactSectionTitle?: string;
    faqs?: BookingFAQItem[];
    gallery?: BookingGalleryItem[];
};

export type Tenant = {
  id: string;
  name: string;
  userId: string;
  subscriptionStatus: 'active' | 'inactive' | 'trialing' | 'past_due' | 'canceled';
  subscriptionTier: 'none' | 'solo' | 'studio' | 'enterprise';
  queueSkipTimeMinutes?: number;
  lateArrivalGracePeriod?: number;
  lateArrivalFee?: number;
  autoCancelLateArrivals?: boolean;
  cancellationFee?: number;
  cancellationWindowHours?: number;
  noShowFee?: number;
  allowDiscountStacking?: boolean;
  requireTillWitness?: boolean;
  cancellationPolicy?: string;
  noShowPolicy?: string;
  lateArrivalPolicy?: string;
  bookingSlotInterval?: 15 | 30 | 60;
  referrerReward?: number;
  newClientDiscount?: number;
  smsNotificationMessage?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  pricingTiers?: {
    apprentice?: string;
    junior?: string;
    senior?: string;
    master?: string;
  };
  tmhr?: number;
  bookingPageSettings?: BookingPageSettings;
  lateInconveniencePremium?: number;
  employerTaxBurdenPct?: number;
  // Global Recovery Policy
  defaultCancellationMode?: 'matrix' | 'flat';
  defaultRescheduleMode?: 'matrix' | 'flat';
};

export type Resource = {
  id: string;
  name: string;
  type: 'room' | 'equipment';
  capacity?: number;
  inventoryItemId?: string;
  isOutOfService?: boolean;
  amenities?: string[];
  maintenanceNotes?: string;
};

export type Bill = BillDefinition;
export const bills: Bill[] = billDefinitions;

export type SpoilageItem = {
  productId: string;
  productName: string;
  batchId: string;
  stock: number;
  costPerUnit: number;
  expirationDate: string;
};

export type Discount = {
  id: string;
  code: string;
  description?: string;
  type: 'percentage' | 'fixed';
  value: number;
  usageLimit: number; 
  usageCount: number;
  isActive: boolean;
  validFrom?: string;
  validUntil?: string;
  applicableServiceIds?: string[];
  limitOnePerCustomer?: boolean;
  usedByClientIds?: string[];
  automation?: {
    trigger: 'none' | 'new_client' | 'loyalty' | 're_engagement' | 'birthday';
    appointmentThreshold?: number;
    daysSinceLastVisit?: number;
  };
};

export type Campaign = {
  id: string;
  name: string;
  subject?: string;
  subjectB?: string;
  body: string;
  imageUrl?: string;
  targetAudience: 'all' | 'new' | 'loyal' | 'inactive_90' | 'specific' | 'birthday';
  targetClientIds?: string[];
  discountId?: string;
  status: 'draft' | 'sent';
  sentAt?: string; 
  type: 'email' | 'sms';
  recipientCount?: number;
  openRate?: number;
  clickRate?: number;
  generatedRevenue?: number;
};

export type Review = {
  id: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  clientAvatarUrl?: string;
  staffId: string;
  serviceId: string;
  serviceName: string;
  rating: number;
  text: string;
  isPublic: boolean;
  isFeatured: boolean;
  createdAt: string; 
};

export type PricingTier = {
    id: string;
    name: string;
    rank: number;
};

export type PartyMember = { 
    id: string; 
    name: string; 
    serviceIds: string[];
    phone?: string;
    email?: string;
    birthday?: string;
    isPrimary?: boolean;
    preferredStaffId?: string;
    waitForPreferredStaff?: boolean;
};

export type Notification = {
  id: string;
  userId: string;
  type: string;
  message: string;
  link: string;
  createdAt: string; 
  read: boolean;
};

export type TillDenominations = {
    bills_100: number;
    bills_50: number;
    bills_20: number;
    bills_10: number;
    bills_5: number;
    bills_1: number;
    coins_25: number;
    coins_10: number;
    coins_05: number;
    coins_01: number;
};

export type TillSession = {
    id: string;
    openedAt: string;
    openedBy: string;
    closedAt?: string;
    closedBy?: string;
    verifiedBy?: string;
    status: 'open' | 'closed';
    openingFloat: number;
    expectedCash: number;
    totalCashSales?: number;
    totalCashTips?: number;
    totalCashRefunds?: number;
    cashTipsByStaff?: Record<string, number>;
    actualCash?: number;
    cashToDeposit?: number;
    nextDayFloat?: number;
    discrepancy?: number;
    openingDenominations: TillDenominations;
    closingDenominations?: TillDenominations;
    nextDayDenominations?: TillDenominations;
    depositDenominations?: TillDenominations;
    notes?: string;
    openedBySignature?: string;
    closedBySignature?: string;
    verifiedBySignature?: string;
};

export const getServicePrice = (service: Service | undefined, staffMember: Staff | undefined): number => {
    if (!service) return 0;
    if (!staffMember || !staffMember.pricingTierId || !service.serviceTiers) {
        return service.price || 0;
    }
    const tierPrice = service.serviceTiers.find(t => t.tierId === staffMember.pricingTierId);
    return tierPrice ? tierPrice.price : (service.price || 0);
};

export { nanoid };
