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
    note?: string;
  }[];
  notes?: string;
};

export type DayHours = {
    enabled: boolean;
    start: string;
    end: string;
    accessTier?: 'all' | 'returning' | 'members';
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

export type ActivityLogType = ActivityLog['type'];

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
    type: 'membership' | 'package' | 'gift';
    offeringId: string;
    offeringName: string;
    serviceId: string;
    serviceName: string;
    date: string;
    staffId?: string;
    isForfeit?: boolean;
    isRollover?: boolean;
};

export type CardOnFile = {
    brand: string;
    last4: string;
    expiryMonth?: number;
    expiryYear?: number;
    expMonth?: number;
    expYear?: number;
    token: string;
    customerId?: string;
    paymentMethodId?: string;
    savedAt?: string;
    source?: string;
};

export type OneTimePerk = {
    id: string;
    name: string;
    type: 'service' | 'product';
    grantedAt: string;
    reason: string;
    grantedBy: string;
    isRedeemed?: boolean;
    redeemedAt?: string;
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
  banMessage?: string;
  cancellationCount?: number;
  noShowCount?: number;
  rescheduleCount?: number;
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
  oneTimePerks?: OneTimePerk[];
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
  };
  birthday?: string;
  // Dispute tracking
  hasOpenDispute?: boolean;
  disputeCount?: number;
  lastDisputeAt?: string;
  lastDisputeReason?: string;
};

export type SubscriptionInstance = {
    id: string;
    clientId: string;
    clientName: string;
    membershipId: string;
    membershipName: string;
    amount: number;
    dueDate: string;
    status: 'pending' | 'paid' | 'failed' | 'canceled';
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
  name: string;
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
  depositAppliesToBalance?: boolean; // default true — set false for fees that don't reduce the checkout total
  requiredSkills?: string[];
  compatibleAddOnIds?: string[];
  capacity?: number;
  fixedCost?: number;
  costPerAttendee?: number;
  requiredResourceIds?: string[];
  customCancellationFee?: number;
  cancellationWindowHours?: number;
  cancellationFeeMode?: 'inherit' | 'matrix' | 'flat' | 'percentage';
  cancellationFeeValue?: number;
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
  description?: string;
  type: 'professional' | 'retail' | 'equipment' | 'overhead' | 'refreshment';
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
  price?: number;
  showInConcierge?: boolean;
  isMembersOnly?: boolean;
  formula?: {
      id: string;
      name: string;
      quantityUsed: number;
      unit: string;
      costPerUnit?: number;
  }[];
  markdownPrice?: number;
  wholesalePrice?: number;
  packagingCost?: number;
  shippingCostToCustomer?: number;
  internalNotes?: string;
  sku?: string;
  restockingMarkup?: number;
  manufacturerName?: string;
  manufacturerContactName?: string;
  manufacturerEmail?: string;
  manufacturerPhone?: string;
  manufacturingSop?: string;
  labelTemplateUrl?: string;
  labelImageUrl?: string;
  moq?: number;
  leadTimeDays?: number;
};

export type AppointmentCheckoutState = {
    formula: {
        id: string;
        name: string;
        quantity: number;
        unit: string;
        costPerUnit: number;
        note?: string;
    }[];
    refreshments?: {
        id: string;
        name: string;
        price: number;
        deliveredAt: string;
        quantity?: number;
        isAccountedFor?: boolean;
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
    adjustments?: {
        rescheduleFee: number;
        timeOverage: number;
        materialOverage: number;
    };
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
  checkInStatusTimestamp?: string;
  checkInToken?: string;
  lateTimeMinutes?: number;
  automatedRescheduleOffered?: boolean;
  requiredResourceIds?: string[];
  recurrenceId?: string;
  cancellationReason?: 'late' | 'no-show' | 'client_request' | 'other' | 'automation';
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
  isHotSlot?: boolean;
  notes?: string;
  isEscalated?: boolean;
  resolutionNotes?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  // Completion link fields
  completionStatus?: 'pending' | 'complete';
  depositAmountCents?: number;
  depositStatus?: 'pending' | 'paid' | 'none';
  signedForms?: { formId: string; formTitle: string; formData: Record<string, any> }[];
  requirementFiles?: { requirementId: string; label: string; files: any[] }[];
  healthDisclosedAt?: string;
  // Automation fields written by Cloud Function
  automationState?: {
    depositReminderSentAt?: string | null;
    depositReminderCount?: number;
    depositAutoCancelledAt?: string | null;
    formReminderSentAt?: string | null;
    formReminderCount?: number;
    formGateActiveAt?: string | null;
    cardReminderSentAt?: string | null;
    cardRequiredAt?: string | null;
    photoReminderSentAt?: string | null;
    healthGateActiveAt?: string | null;
    balanceNotifiedAt?: string | null;
    lastCheckedAt?: string;
  };
  readinessFlags?: {
    healthGateActive?: boolean;
    formGateActive?: boolean;
    depositRequired?: boolean;
    cardRequired?: boolean;
    balanceRequired?: boolean;
    needsConsultationBuffer?: boolean;
  };
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
  isEscalated?: boolean;
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
};

export type Membership = {
  id: string;
  name: string;
  description?: string;
  price: number;
  interval: 'monthly' | 'yearly';
  isPrivate: boolean;
  noCommitment?: boolean;
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
  requiresSignature?: boolean;  // if true, signature collected at POS checkout
  content?: string;             // plain text fallback when no structured fields
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

// ─── Page Builder types ───────────────────────────────────────────────────────
export type SectionType =
  | 'nav'
  | 'hero'
  | 'trust'
  | 'services'
  | 'team'
  | 'reviews'
  | 'gallery'
  | 'beforeafter'
  | 'memberships'
  | 'packages'
  | 'giftcards'
  | 'quote'
  | 'newclient'
  | 'faq'
  | 'policies'
  | 'contact'
  | 'events'
  | 'referral'
  | 'story'
  | 'instagram'
  | 'waitlist';

export interface PageSection {
  id:      string;
  type:    SectionType;
  enabled: boolean;
  visible?: boolean;
  order:   number;
  config:  Record<string, any>;
}

export interface PageBuilderConfig {
  sections:    PageSection[];
  accentColor: string;
  bgColor:     string;
  headingFont: string;
  bodyFont:    string;
}

export type BookingTheme =
  | 'editorial'
  | 'soft_spa'
  | 'dark_glam'
  | 'bold_studio'
  | 'minimal_clean';

export type BookingPageSettings = {
    logoUrl?: string;
    wordmarkUrl?: string;
    showWordmark?: boolean;
    heroImageUrl?: string;
    heroTitle?: string;
    heroSubtitle?: string;
    welcomeMessage?: string;
    primaryColor?: string;
    theme?: BookingTheme;
    pageConfig?: PageBuilderConfig;
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

export type KioskSettings = {
    logoUrl?: string;
    wordmarkUrl?: string;
    showWordmark?: boolean;
    welcomeMessage?: string;
    primaryColor?: string;
    theme?: 'light' | 'dark' | 'rose' | 'sage' | 'slate';
    useSpecificHours?: boolean;
    kioskSchedule?: {
        [day: string]: DayHours;
    };
};

export type RecoveryPreset = {
    id: string;
    label: string;
    type: 'fixed' | 'percentage';
    value: number;
};

// ─── Appointment automation types ─────────────────────────────────────────────
export type AutomationSeverity = 'warn' | 'require' | 'auto_cancel';

export type AutomationTrigger = {
  enabled:           boolean;
  severity:          AutomationSeverity;
  firstWindowHours:  number;
  secondWindowHours?: number;
  canDisable:        boolean;
};

export type AppointmentAutomations = {
  depositNotPaid:         AutomationTrigger;
  consentFormUnsigned:    AutomationTrigger;
  noCardOnFile:           AutomationTrigger;
  referencePhotosMissing: AutomationTrigger;
  healthFormMissing:      AutomationTrigger;
  outstandingBalance:     AutomationTrigger;
};

export type Tenant = {
  id: string;
  name: string;
  userId: string;
  subscriptionStatus: 'active' | 'inactive' | 'trialing' | 'past_due' | 'canceled';
  subscriptionTier: 'none' | 'solo' | 'studio' | 'enterprise';

  // ── Queue & Late Arrival ───────────────────────────────────────────────
  queueSkipTimeMinutes?: number;
  lateArrivalGracePeriod?: number;
  lateArrivalFee?: number;
  autoCancelLateArrivals?: boolean;
  lateInconveniencePremium?: number;

  // ── Cancellation & No-Show ─────────────────────────────────────────────
  cancellationFee?: number;
  cancellationWindowHours?: number;
  noShowFee?: number;
  cancellationPolicy?: string;
  noShowPolicy?: string;
  lateArrivalPolicy?: string;
  defaultCancellationMode?: 'matrix' | 'flat' | 'percentage';
  defaultRescheduleMode?: 'matrix' | 'flat';
  allowGuestFeeDeferral?: boolean;

  // ── Scheduling ─────────────────────────────────────────────────────────
  bookingSlotInterval?: 15 | 30 | 60;
  tightSchedulingEnabled?: boolean;
  morningAnchorEnabled?: boolean;
  flashYieldEnabled?: boolean;
  guardianProtocolEnabled?: boolean;

  // ── Discounts & Rewards ────────────────────────────────────────────────
  allowDiscountStacking?: boolean;
  referrerReward?: number;
  newClientDiscount?: number;

  // ── Hospitality & Amenities ────────────────────────────────────────────
  refreshmentServiceEnabled?: boolean;
  complimentaryAmenityLimit?: number;
  wifiNetwork?: string;
  wifiPassword?: string;

  // ── Notifications ──────────────────────────────────────────────────────
  smsNotificationMessage?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;

  // ── Pricing ────────────────────────────────────────────────────────────
  pricingTiers?: {
    apprentice?: string;
    junior?: string;
    senior?: string;
    master?: string;
  };
  tmhr?: number;
  employerTaxBurdenPct?: number;

  // ── Payment ────────────────────────────────────────────────────────────
  requireTillWitness?: boolean;
  paymentGateway?: 'none' | 'stripe' | 'square';
  gatewayApiKey?: string;
  autoProcessMemberships?: boolean;
  depositsLive?: boolean;

  // ── Recovery & Governance ──────────────────────────────────────────────
  maxAutonomousRecoveryAmount?: number;
  maxAutonomousRecoveryPercent?: number;
  escalationPolicy?: string;
  recoveryPresets?: RecoveryPreset[];

  // ── Appointment automations ────────────────────────────────────────────
  appointmentAutomations?: AppointmentAutomations;

  // ── Dispute tracking (sidebar badge) ──────────────────────────────────
  openDisputeCount?: number;

  // ── Stripe ─────────────────────────────────────────────────────────────
  stripeAccountId?: string;
  stripeCustomerId?: string;
  stripeOnboardingComplete?: boolean;
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  currentPeriodEnd?: string;
  trialEnd?: string;
  planId?: string;
  gracePeriodEndsAt?: string;
  accessLocked?: boolean;
  lastPaymentAt?: string;
  trialEndingWarningSent?: boolean;
  stripeAccountUpdatedAt?: string;

  // ── Booking page ───────────────────────────────────────────────────────
  bookingPageSettings?: BookingPageSettings;

  // ── Kiosk ──────────────────────────────────────────────────────────────
  kioskSettings?: KioskSettings;

  // ── Studio location ────────────────────────────────────────────────────
  studioAddress?: string;
  studioAddressParts?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  studioLocation?: {
    lat: number;
    lng: number;
  };

  // ── Geo-fence ──────────────────────────────────────────────────────────
  geoFenceEnabled?: boolean;
  geoFenceRadiusMeters?: number;
  geoFenceBreakRadiusMeters?: number;
  geoFenceFailBehavior?: 'warn' | 'block';

  // ── Time clock ─────────────────────────────────────────────────────────
  earlyClockInMinutes?: number;
  requireAppointmentToClockIn?: boolean;
  blockClockInOnExpiredLicense?: boolean;
  minimumShiftMinutes?: number;
  requireManagerOverrideForLateClockIn?: boolean;
  dailyOvertimeHours?: number;
  overtimeThresholdHours?: number;
  overtimeMultiplier?: number;
  autoClockOutHours?: number;
  overtimeAlertHours?: number;
  minimumBreakMinutes?: number;
  maximumBreakMinutes?: number;
  requiredBreakAfterHours?: number;
  paidBreakMinutes?: number;

  // ── Cancellation policy text (for completion page) ─────────────────────
  cancellationPolicyText?: string;
  depositPolicy?: { version?: string };
  refundPolicy?: string;
  ownerEmail?: string;
  email?: string;
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

export type RefreshmentRequest = {
    id: string;
    tenantId: string;
    clientId: string;
    clientName: string;
    itemId: string;
    itemName: string;
    quantity: number;
    status: 'pending' | 'delivered' | 'cancelled';
    requestedAt: string;
    deliveredAt?: string;
    deliveredBy?: string;
    stationName?: string;
    staffName?: string;
    priceAtRequest?: number;
    isRedemption?: boolean;
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

export type ScheduleProfile = {
  id: string;
  name: string;
  isActive: boolean;
  isPublic?: boolean;
  bookingSlotInterval?: number;
  week: {
      sunday: DayHours;
      monday: DayHours;
      tuesday: DayHours;
      wednesday: DayHours;
      thursday: DayHours;
      friday: DayHours;
      saturday: DayHours;
  };
  timeOff?: {
      vacationDays: number;
      holidays: number;
  };
};

export const getServicePrice = (
  service: Service | undefined,
  staffMember: Staff | undefined
): number => {
    if (!service) return 0;
    if (!staffMember || !staffMember.pricingTierId || !service.serviceTiers) {
        return service.price || 0;
    }
    const tierPrice = service.serviceTiers.find(t => t.tierId === staffMember.pricingTierId);
    return tierPrice ? tierPrice.price : (service.price || 0);
};

export { nanoid };

// ─── STUDIO EVENT TYPE ────────────────────────────────────────────────────────
export type StudioEvent = {
  id: string;
  tenantId: string;
  name: string;
  date: string;
  venue?: string;
  description?: string;
  status: 'upcoming' | 'active' | 'completed' | 'cancelled';
  capacity?: number;
  orderingDeadline?: string;
  menuNote?: string;
  menuItems?: {
    id: string;
    name: string;
    description?: string;
    category: string;
    courseNumber: number;
    isVegan?: boolean;
    isGlutenFree?: boolean;
    supplies?: { inventoryId: string; qty: number }[];
  }[];
  courses?: {
    courseNumber: number;
    name: string;
    menuItems: string[];
  }[];
  createdAt: string;
  createdBy?: string;
};
