

'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DollarSign,
  PlusCircle,
  Home,
  Heart,
  Car,
  ShoppingCart,
  Sparkles,
  Building,
  Monitor,
  Briefcase,
  Wifi,
  MoreHorizontal,
  PiggyBank,
  Gift,
  Dog,
  Baby,
  Landmark,
  Trash2,
  Phone,
  Film,
  Megaphone,
  CreditCard,
  Receipt,
  Package,
  Edit,
  Save,
  Globe,
  Calculator,
  Info,
  Check,
  Link as LinkIcon,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useFirebase, useCollection, useMemoFirebase, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch, query, where } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { useTenant } from '@/context/TenantContext';
import { type Tenant } from '@/lib/data';

const BillItemRow = ({
  bill,
  isEditing = false,
  onBillChange,
}: {
  bill: { title: string; amount: number; isCustom?: boolean; dueDay?: number; paymentUrl?: string; lateFee?: number; lateByDay?: number; };
  isEditing?: boolean;
  onBillChange: (billTitle: string, field: string, value: any) => void;
}) => (
    <div className="flex flex-col p-3 rounded-lg border bg-background hover:bg-muted/50 transition-colors">
      <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
              {bill.isCustom && isEditing ? (
                  <Input defaultValue={bill.title} className="font-semibold border-dashed h-9" disabled={!isEditing} />
              ) : (
                  <div className="flex items-center gap-2">
                    <Label className="font-medium pt-2 block truncate">{bill.title}</Label>
                     {!isEditing && (
                        <TooltipProvider>
                            <div className="flex items-center gap-1.5 text-muted-foreground pt-1.5">
                                {bill.dueDay && (
                                    <Tooltip>
                                        <TooltipTrigger><Calendar className="w-3.5 h-3.5" /></TooltipTrigger>
                                        <TooltipContent><p>Due day set</p></TooltipContent>
                                    </Tooltip>
                                )}
                                {bill.lateFee && (
                                     <Tooltip>
                                        <TooltipTrigger><AlertTriangle className="w-3.5 h-3.5" /></TooltipTrigger>
                                        <TooltipContent><p>Late fee set</p></TooltipContent>
                                    </Tooltip>
                                )}
                                {bill.paymentUrl && (
                                     <Tooltip>
                                        <TooltipTrigger><LinkIcon className="w-3.5 h-3.5" /></TooltipTrigger>
                                        <TooltipContent><p>Payment link saved</p></TooltipContent>
                                    </Tooltip>
                                )}
                            </div>
                        </TooltipProvider>
                    )}
                  </div>
              )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto max-w-[150px]">
              <div className="relative flex-1">
              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                  type="number"
                  placeholder="0.00"
                  className="pl-8"
                  disabled={!isEditing}
                  value={bill.amount || ''}
                  onChange={(e) => onBillChange(bill.title, 'amount', parseFloat(e.target.value) || 0)}
              />
              </div>
          </div>
      </div>
      {isEditing && (
         <Accordion type="single" collapsible className="w-full mt-2">
            <AccordionItem value="details" className="border-0">
                <AccordionTrigger className="text-xs justify-start gap-2 p-1 hover:no-underline text-muted-foreground">Set Due Date, Alerts & Links</AccordionTrigger>
                <AccordionContent className="pt-4 space-y-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor={`dueDay-${bill.title}`} className="text-xs">Due Day</Label>
                            <Input id={`dueDay-${bill.title}`} type="number" placeholder="e.g., 1" value={bill.dueDay || ''} onChange={(e) => onBillChange(bill.title, 'dueDay', parseInt(e.target.value) || undefined)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`paymentUrl-${bill.title}`} className="text-xs">Payment URL</Label>
                             <div className="relative">
                                <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input id={`paymentUrl-${bill.title}`} placeholder="https://..." value={bill.paymentUrl || ''} onChange={(e) => onBillChange(bill.title, 'paymentUrl', e.target.value)} className="pl-8" />
                            </div>
                        </div>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor={`lateByDay-${bill.title}`} className="text-xs">Late After (Days)</Label>
                            <Input id={`lateByDay-${bill.title}`} type="number" placeholder="e.g., 5" value={bill.lateByDay || ''} onChange={(e) => onBillChange(bill.title, 'lateByDay', parseInt(e.target.value) || undefined)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`lateFee-${bill.title}`} className="text-xs">Late Fee</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input id={`lateFee-${bill.title}`} type="number" placeholder="0.00" value={bill.lateFee || ''} onChange={(e) => onBillChange(bill.title, 'lateFee', parseFloat(e.target.value) || undefined)} className="pl-8" />
                            </div>
                        </div>
                     </div>
                      {bill.isCustom && (
                        <Button variant="outline" size="sm" className="text-destructive w-full"><Trash2 className="w-4 h-4 mr-2"/>Delete Custom Cost</Button>
                      )}
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      )}
    </div>
);

const lifestyleCategoriesTemplate = [
  { name: 'Housing', icon: <Home className="w-5 h-5 text-primary" />, bills: [ { title: "Rent/Mortgage", amount: 0, dueDay: 1 }, { title: "Property Taxes", amount: 0, dueDay: 15 }, { title: "HOA Fees", amount: 0, dueDay: 1 }, { title: "Insurance (Homeowner's/Renter's)", amount: 0, dueDay: 10 } ]},
  { name: 'Utilities', icon: <Receipt className="w-5 h-5 text-primary" />, bills: [ { title: "Electric", amount: 0, dueDay: 20 }, { title: "Water", amount: 0, dueDay: 20 }, { title: "Gas", amount: 0, dueDay: 20 }, { title: "Waste Management", amount: 0, dueDay: 20 } ]},
  { name: 'Internet & Phone', icon: <Wifi className="w-5 h-5 text-primary" />, bills: [{ title: 'Internet Bill', amount: 0, dueDay: 5 }, { title: 'Cell Phone Bill', amount: 0, dueDay: 15 }] },
  { name: 'Streaming & Subscriptions', icon: <Film className="w-5 h-5 text-primary" />, bills: [ { title: "Netflix", amount: 0, dueDay: 1 }, { title: "Spotify", amount: 0, dueDay: 1 }, { title: "News Subscription", amount: 0, dueDay: 1 }, { title: "Cloud Storage (iCloud, Google Drive, etc.)", amount: 0, dueDay: 1 } ]},
  { name: 'Food', icon: <ShoppingCart className="w-5 h-5 text-primary" />, bills: [{ title: 'Groceries', amount: 0, dueDay: 1 }, { title: 'Restaurants', amount: 0, dueDay: 1 }] },
  { name: 'Transportation', icon: <Car className="w-5 h-5 text-primary" />, bills: [ { title: "Car Payment", amount: 0, dueDay: 25 }, { title: "Car Insurance", amount: 0, dueDay: 15 }, { title: "Gas/Fuel", amount: 0, dueDay: 1 }, { title: "Public Transit", amount: 0, dueDay: 1 } ]},
  { name: 'Health & Wellness', icon: <Heart className="w-5 h-5 text-primary" />, bills: [ { title: "Personal Health Insurance", amount: 0, dueDay: 1 }, { title: "Gym Membership", amount: 0, dueDay: 1 }, { title: "Therapy/Counseling", amount: 0, dueDay: 1 }, { title: "Medication", amount: 0, dueDay: 1 } ]},
  { name: 'Debt Repayment', icon: <CreditCard className="w-5 h-5 text-primary" />, bills: [ { title: "Student Loans", amount: 0, dueDay: 25 }, { title: "Credit Card Payments", amount: 0, dueDay: 1 }, { title: "Buy Now, Pay Later (e.g., Klarna, Afterpay)", amount: 0, dueDay: 1 } ]},
  { name: 'Family & Childcare', icon: <Baby className="w-5 h-5 text-primary" />, bills: [ { title: "Childcare / Daycare", amount: 0, dueDay: 1 }, { title: "Kids' Activities", amount: 0, dueDay: 1 }, { title: "Child Support", amount: 0, dueDay: 1 } ]},
  { name: 'Pets', icon: <Dog className="w-5 h-5 text-primary" />, bills: [{ title: 'Pet Food & Supplies', amount: 0, dueDay: 1 }, { title: 'Pet Insurance', amount: 0, dueDay: 1 }] },
  { name: 'Personal Spending', icon: <Sparkles className="w-5 h-5 text-primary" />, bills: [ { title: "Shopping (Clothes, etc.)", amount: 0, dueDay: 1 }, { title: "Entertainment (Movies, Concerts, etc.)", amount: 0, dueDay: 1 }, { title: "Hobbies & Recreation", amount: 0, dueDay: 1 }, { title: "Personal Care (Haircuts, etc. that you don't do yourself)", amount: 0, dueDay: 1 } ]},
  { name: 'Gifts & Donations', icon: <Gift className="w-5 h-5 text-primary" />, bills: [{ title: 'Gifts', amount: 0, dueDay: 1 }, { title: 'Donations', amount: 0, dueDay: 1 }] },
  { name: 'Financial Goals', icon: <PiggyBank className="w-5 h-5 text-primary" />, bills: [ { title: "Personal Savings", amount: 0, dueDay: 1 }, { title: "Retirement (IRA/401k contributions)", amount: 0, dueDay: 1 } ]},
];

const businessCategoriesTemplate = [
   { name: "Rent & Facility", icon: <Building className="w-5 h-5 text-primary"/>, bills: [ {title: "Studio Rent/Mortgage", amount: 0, dueDay: 1}, {title: "Business Insurance (Liability, Property)", amount: 0, dueDay: 20} ]},
   { name: "Utilities", icon: <Receipt className="w-5 h-5 text-primary"/>, bills: [{title: "Electric", amount: 0, dueDay: 20}, {title: "Water", amount: 0, dueDay: 20}, {title: "Gas", amount: 0, dueDay: 20}, {title: "Waste Management", amount: 0, dueDay: 20}] },
   { name: "Capital Equipment", icon: <Briefcase className="w-5 h-5 text-primary" />, bills: [] },
   { name: "Software & Systems", icon: <Monitor className="w-5 h-5 text-primary"/>, bills: [ {title: "Booking Software (e.g., ClarityFlow itself, Acuity, Square)", amount: 0, dueDay: 5}, {title: "Website Hosting", amount: 0, dueDay: 1}, {title: "Email Marketing (e.g., Mailchimp, ConvertKit)", amount: 0, dueDay: 1} ]},
   { name: "Tech & Comms", icon: <Phone className="w-5 h-5 text-primary"/>, bills: [{title: "Business Phone Line", amount: 0, dueDay: 1}] },
   { name: "Professional & Admin", icon: <Briefcase className="w-5 h-5 text-primary"/>, bills: [{title: "Accountant/Bookkeeper", amount: 0, dueDay: 1}, {title: "Licensing & Dues", amount: 0, dueDay: 1}] },
   { name: "Marketing & Growth", icon: <Megaphone className="w-5 h-5 text-primary"/>, bills: [{title: "Social Media Ads", amount: 0, dueDay: 1}, {title: "Print Materials (Business Cards, Flyers)", amount: 0, dueDay: 1}] },
   { name: "Retail & Marketing Materials", icon: <Package className="w-5 h-5 text-primary"/>, bills: [{title: "Packaging & Bags", amount: 0, dueDay: 1}] },
   { name: "Business Debt", icon: <Landmark className="w-5 h-5 text-primary"/>, bills: [{title: "Business Loan", amount: 0, dueDay: 1}, {title: "Tax Debt Payment", amount: 0, dueDay: 1}] },
   { name: "Miscellaneous", icon: <Sparkles className="w-5 h-5 text-primary"/>, bills: [{title: "Bank Fees", amount: 0, isCustom: true, dueDay: 1}] }
];

const deepCopyTemplate = (template: any[]) => {
  // Omit the 'icon' property from each category before saving to Firestore.
  return template.map(({ icon, ...category }) => ({
    ...category,
    bills: category.bills.map((bill: any) => ({ ...bill }))
  }));
};


const BillEditor = ({
  categories,
  isEditing,
  onBillChange,
}: {
  categories: {
    name: string;
    icon: React.ReactNode;
    bills: { title: string; amount: number; isCustom?: boolean; dueDay?: number; paymentUrl?: string; lateFee?: number; lateByDay?: number; }[];
  }[];
  isEditing: boolean;
  onBillChange: (categoryName: string, billTitle: string, field: string, value: any) => void;
}) => {
  const total = useMemo(() => {
    return categories.reduce((acc, category) => {
      return acc + category.bills.reduce((billAcc, bill) => billAcc + (bill.amount || 0), 0);
    }, 0);
  }, [categories]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <Accordion type="multiple" defaultValue={['category-0']} className="w-full space-y-4">
          {categories.map((category, index) => (
            <AccordionItem key={category.name} value={`category-${index}`} className="border-b-0">
              <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline">
                <div className="flex items-center gap-3">
                  {category.icon}
                  <span className="font-semibold">{category.name}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4 space-y-2">
                  {category.bills.map((bill) => (
                    <BillItemRow
                      key={bill.title}
                      bill={bill}
                      isEditing={isEditing}
                      onBillChange={(billTitle, field, value) => onBillChange(category.name, billTitle, field, value)}
                    />
                  ))}
              </AccordionContent>
            </AccordionItem>
          ))}
           <AccordionItem value="custom" className="border-b-0 mt-4">
              <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <span className="font-semibold">Custom Costs</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4">
                  <div className="flex flex-col items-start gap-4">
                      {isEditing && (
                          <Button variant="outline"><PlusCircle className="w-4 h-4 mr-2" />Add Custom Cost</Button>
                      )}
                  </div>
              </AccordionContent>
            </AccordionItem>
        </Accordion>
      </CardContent>
      <CardFooter className="bg-muted/50 p-4 justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Monthly Total</p>
          <p className="text-2xl font-bold">${total.toFixed(2)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Annual Total</p>
          <p className="text-xl font-semibold text-muted-foreground">${(total * 12).toFixed(2)}</p>
        </div>
      </CardFooter>
    </Card>
  );
};


const LifestyleTab = ({
  isEditing,
  profileData,
  onBillChange,
}: {
  isEditing: boolean;
  profileData: any;
  onBillChange: (categoryName: string, billTitle: string, field: string, value: any) => void;
}) => {
  if (!profileData) return null;
  return (
    <div>
      <div className="mt-6">
        <BillEditor
          categories={profileData.categories}
          isEditing={isEditing}
          onBillChange={onBillChange}
        />
      </div>
    </div>
  );
};

const BusinessTab = ({
  isEditing,
  profileData,
  onBillChange,
}: {
  isEditing: boolean;
  profileData: any;
  onBillChange: (categoryName: string, billTitle: string, field: string, value: any) => void;
}) => {
  if (!profileData) return null;
  return (
    <div>
      <div className="mt-6">
        <BillEditor
          categories={profileData.categories}
          isEditing={isEditing}
          onBillChange={onBillChange}
        />
      </div>
    </div>
  );
};

const FinancialProfileManager = ({
  activeTab,
  profiles,
  setProfiles,
  isEditing,
  renamingProfileId,
  setRenamingProfileId,
  onDeleteProfile,
}: {
  activeTab: string;
  profiles: any;
  setProfiles: any;
  isEditing: boolean;
  renamingProfileId: string | null;
  setRenamingProfileId: (id: string | null) => void;
  onDeleteProfile: (id: string) => void;
}) => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const profileKey = `${activeTab}Profiles`;
  const currentProfiles = profiles[profileKey] || [];
  const [tempName, setTempName] = useState('');
  
  const getActiveProfileId = () => currentProfiles.find((p:any) => p.isActive)?.id;

  const handleAddProfile = () => {
    const newProfileName = `New ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Profile`;
    
    let newProfileData;
    if (activeTab === 'lifestyle') {
      newProfileData = { categories: deepCopyTemplate(lifestyleCategoriesTemplate) };
    } else if (activeTab === 'business') {
      newProfileData = { categories: deepCopyTemplate(businessCategoriesTemplate) };
    } else {
        return; // Should not happen for this page
    }

    const newProfile = {
      id: `${activeTab.slice(0, 2)}${Date.now()}`,
      name: newProfileName,
      isActive: false,
      isPublic: activeTab === 'schedule' ? false : undefined,
      ...newProfileData
    };

    setProfiles((prev:any) => ({
      ...prev,
      [profileKey]: [...prev[profileKey], newProfile],
    }));
  };
  
  const handleSetActive = async (id: string) => {
    if (isEditing || !firestore || !tenantId) return;
    const batch = writeBatch(firestore);
    currentProfiles.forEach((p: any) => {
        const profileDocRef = doc(firestore, `tenants/${tenantId}/${profileKey}/${p.id}`);
        if (p.id === id) {
            if (!p.isActive) batch.update(profileDocRef, { isActive: true });
        } else {
            if (p.isActive) batch.update(profileDocRef, { isActive: false });
        }
    });
    await batch.commit();
  }

  const handleStartRename = (profile: any) => {
    setRenamingProfileId(profile.id);
    setTempName(profile.name);
  };

  const handleConfirmRename = () => {
    if (!renamingProfileId) return;
    setProfiles((prev: any) => ({
      ...prev,
      [profileKey]: prev[profileKey].map((p: any) => 
        p.id === renamingProfileId ? { ...p, name: tempName } : p
      ),
    }));
    setRenamingProfileId(null);
    setTempName('');
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="capitalize">{activeTab} Profiles</CardTitle>
        <CardDescription>Manage your financial scenarios.</CardDescription>
      </CardHeader>
      <CardContent className="p-2">
        <div className="space-y-1">
          {currentProfiles.map((profile:any) => (
            <div
              key={profile.id}
              className={cn(
                'group/item relative transition-opacity',
                isEditing && !profile.isActive && 'opacity-50'
              )}
            >
              {renamingProfileId === profile.id ? (
                 <div className="flex items-center gap-1 p-1">
                    <Input
                      value={tempName}
                      autoFocus
                      onChange={(e) => setTempName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirmRename();
                        if (e.key === 'Escape') setRenamingProfileId(null);
                      }}
                      className="w-full h-8"
                    />
                    <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={handleConfirmRename}>
                        <Check className="h-4 w-4" />
                    </Button>
                </div>
              ) : (
                <Button
                  variant={profile.isActive ? 'secondary' : 'ghost'}
                  className="w-full justify-start h-auto py-2"
                  onClick={() => handleSetActive(profile.id)}
                  disabled={isEditing}
                >
                  <span className="flex-1 text-left truncate">{profile.name}</span>
                  {profile.isActive && (
                    <Badge variant={isEditing ? "default" : "secondary"} className={cn("ml-2", isEditing && "bg-primary")}>
                      {isEditing ? 'Editing' : 'Active'}
                    </Badge>
                  )}
                </Button>
              )}

              {renamingProfileId !== profile.id && (
                <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 ml-1 shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleStartRename(profile)}>Rename</DropdownMenuItem>
                        <DropdownMenuItem>Duplicate</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDeleteProfile(profile.id)} className="text-destructive" disabled={currentProfiles.length <= 1}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
      {isEditing && (
          <CardFooter className="p-2 border-t">
            <Button variant="outline" className="w-full" onClick={handleAddProfile}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add New Profile
            </Button>
          </CardFooter>
      )}
    </Card>
  );
};


const TmhrBreakdownCard = ({ lifestyleTotal, businessTotal, totalHours, firestore, selectedTenant }: { lifestyleTotal: number; businessTotal: number; totalHours: number; firestore: any, selectedTenant: Tenant | null }) => {
    const { toast } = useToast();
    const totalCosts = lifestyleTotal + businessTotal;
    const tmhr = totalHours > 0 ? totalCosts / totalHours : 0;
    
    const handleSetDefaultRate = () => {
        if (!selectedTenant || !firestore) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Cannot save rate. No business selected.',
            });
            return;
        }

        const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
        updateDocumentNonBlocking(tenantRef, { tmhr });

        toast({
            title: 'Default Rate Saved',
            description: `Your TMHR of $${tmhr.toFixed(2)}/hr has been set as the default for this business.`,
        });
    };

    return (
    <Card>
        <CardHeader>
            <CardTitle>Financial Snapshot</CardTitle>
            <CardDescription>Your True Minimum Hourly Rate (TMHR)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <Card className="bg-primary/10 border-primary/20 text-center p-6">
                <p className="text-sm text-primary font-semibold">TMHR</p>
                <p className="text-6xl font-bold text-primary">${tmhr.toFixed(2)}</p>
            </Card>
            <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex justify-between">
                    <span>Lifestyle Cost / Hour:</span>
                    <span className="font-mono">${(totalHours > 0 ? lifestyleTotal / totalHours : 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span>Business Cost / Hour:</span>
                    <span className="font-mono">${(totalHours > 0 ? businessTotal / totalHours : 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 mt-2">
                    <span>Billable Hours / Month:</span>
                    <span className="font-mono">{totalHours.toFixed(2)}</span>
                </div>
            </div>
        </CardContent>
        <CardFooter>
            <Button className="w-full" onClick={handleSetDefaultRate}>Set as Default Rate</Button>
        </CardFooter>
    </Card>
    );
};

export default function FinancialFoundationPage() {
    const { firestore, user } = useFirebase();
    const { selectedTenant, isLoading: isTenantContextLoading } = useTenant();
    const tenantId = selectedTenant?.id;
    const [isEditing, setIsEditing] = useState(false);
    const [activeTab, setActiveTab] = useState('lifestyle');
    const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
    const { toast } = useToast();

    const lifestyleProfilesQuery = useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/lifestyleProfiles`) : null, [firestore, tenantId]);
    const businessProfilesQuery = useMemoFirebase(() => tenantId ? collection(firestore, `tenants/${tenantId}/businessProfiles`) : null, [firestore, tenantId]);
    const scheduleProfilesQuery = useMemoFirebase(() => tenantId ? query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isActive", "==", true)) : null, [firestore, tenantId]);

    const { data: lifestyleProfilesData, isLoading: lifestyleProfilesLoading } = useCollection(lifestyleProfilesQuery);
    const { data: businessProfilesData, isLoading: businessProfilesLoading } = useCollection(businessProfilesQuery);
    const { data: scheduleProfilesData, isLoading: scheduleProfilesLoading } = useCollection(scheduleProfilesQuery);
    
    const [profiles, setProfiles] = useState({
      lifestyleProfiles: [],
      businessProfiles: [],
      scheduleProfiles: []
    });

    useEffect(() => {
        if (lifestyleProfilesLoading || !firestore || !user || !tenantId) return;
        
        if (lifestyleProfilesData && lifestyleProfilesData.length === 0) {
            const defaultProfileId = nanoid();
            const defaultProfile = {
                id: defaultProfileId,
                name: 'Default Lifestyle',
                isActive: true,
                categories: deepCopyTemplate(lifestyleCategoriesTemplate)
            };
            const profileDocRef = doc(firestore, `tenants/${tenantId}/lifestyleProfiles/${defaultProfileId}`);
            setDocumentNonBlocking(profileDocRef, defaultProfile, {});
        } else if (lifestyleProfilesData && lifestyleProfilesData.length > 0) {
            const hasActiveProfile = lifestyleProfilesData.some(p => p.isActive);
            if (!hasActiveProfile) {
                const firstProfile = lifestyleProfilesData[0];
                const profileDocRef = doc(firestore, `tenants/${tenantId}/lifestyleProfiles/${firstProfile.id}`);
                updateDocumentNonBlocking(profileDocRef, { isActive: true });
            }
        }
    }, [lifestyleProfilesLoading, lifestyleProfilesData, firestore, user, tenantId]);

    useEffect(() => {
        if (businessProfilesLoading || !firestore || !user || !tenantId) return;

        if (businessProfilesData && businessProfilesData.length === 0) {
            const defaultProfileId = nanoid();
            const defaultProfile = {
                id: defaultProfileId,
                name: 'Default Business',
                isActive: true,
                categories: deepCopyTemplate(businessCategoriesTemplate)
            };
            const profileDocRef = doc(firestore, `tenants/${tenantId}/businessProfiles/${defaultProfileId}`);
            setDocumentNonBlocking(profileDocRef, defaultProfile, {});
        } else if (businessProfilesData && businessProfilesData.length > 0) {
             const hasActiveProfile = businessProfilesData.some(p => p.isActive);
            if (!hasActiveProfile) {
                const firstProfile = businessProfilesData[0];
                const profileDocRef = doc(firestore, `tenants/${tenantId}/businessProfiles/${firstProfile.id}`);
                updateDocumentNonBlocking(profileDocRef, { isActive: true });
            }
        }
    }, [businessProfilesLoading, businessProfilesData, firestore, user, tenantId]);

    useEffect(() => {
        setProfiles({
            lifestyleProfiles: lifestyleProfilesData || [],
            businessProfiles: businessProfilesData || [],
            scheduleProfiles: scheduleProfilesData || [],
        });
    }, [lifestyleProfilesData, businessProfilesData, scheduleProfilesData]);


    const [backupProfiles, setBackupProfiles] = useState(profiles);

    const activeLifestyleProfile = useMemo(() => profiles.lifestyleProfiles.find((p: any) => p.isActive), [profiles.lifestyleProfiles]);
    const activeBusinessProfile = useMemo(() => profiles.businessProfiles.find((p: any) => p.isActive), [profiles.businessProfiles]);
    const activeScheduleProfile = useMemo(() => profiles.scheduleProfiles.find((p: any) => p.isActive), [profiles.scheduleProfiles]);


    const handleBillChange = useCallback((profileType: 'lifestyle' | 'business', categoryName: string, billTitle: string, field: string, value: any) => {
        const profileKey = `${profileType}Profiles` as const;

        setProfiles((prev: any) => {
            const newProfiles = prev[profileKey].map((p: any) => {
                if (p.isActive) {
                    const newCategories = p.categories.map((cat: any) => {
                        if (cat.name === categoryName) {
                            const newBills = cat.bills.map((bill: any) => {
                                if (bill.title === billTitle) {
                                    return { ...bill, [field]: value };
                                }
                                return bill;
                            });
                            return { ...cat, bills: newBills };
                        }
                        return cat;
                    });
                    return { ...p, categories: newCategories };
                }
                return p;
            });

            return { ...prev, [profileKey]: newProfiles };
        });
    }, []);

    const totalBillableHours = useMemo(() => {
        if (!activeScheduleProfile) return 0;
        
        const timeToMinutes = (timeStr: string) => {
            if (!timeStr) return 0;
            const [time, period] = timeStr.split(' ');
            let [hours, minutes] = time.split(':').map(Number);
            if (period === 'PM' && hours < 12) hours += 12;
            if (period === 'AM' && hours === 12) hours = 0;
            return hours * 60 + minutes;
        };

        const weeklyMinutes = Object.values(activeScheduleProfile.week).reduce((acc: number, day: any) => {
            if (day.enabled) {
                const startMinutes = timeToMinutes(day.start);
                const endMinutes = timeToMinutes(day.end);
                return acc + (endMinutes - startMinutes);
            }
            return acc;
        }, 0);
        
        const weeklyHours = weeklyMinutes / 60;
        
        const totalWorkDaysInYear = 52 * Object.values(activeScheduleProfile.week).filter((d: any) => d.enabled).length;
        const totalDaysOff = activeScheduleProfile.timeOff.vacationDays + activeScheduleProfile.timeOff.holidays;
        
        const effectiveDaysOff = Math.min(totalDaysOff, totalWorkDaysInYear > 0 ? totalWorkDaysInYear : 0);

        const workDayPercentage = totalWorkDaysInYear > 0 ? (totalWorkDaysInYear - effectiveDaysOff) / totalWorkDaysInYear : 0;
        
        const avgMonthlyHours = (weeklyHours * 52 / 12) * workDayPercentage;

        return avgMonthlyHours > 0 ? avgMonthlyHours : 0;
    }, [activeScheduleProfile]);


    const handleEditToggle = () => {
        if (!isEditing) {
            setBackupProfiles(JSON.parse(JSON.stringify(profiles)));
            setIsEditing(true);
        } else {
            // Save logic here
            if (firestore) {
                 Object.entries(profiles).forEach(([profileKey, profileList]) => {
                    (profileList as any[]).forEach((profile: any) => {
                        if (!tenantId) return;
                        const profileRef = doc(firestore, `tenants/${tenantId}/${profileKey}/${profile.id}`);
                        const { icon, ...profileData } = profile; // Omit icon before saving
                        setDocumentNonBlocking(profileRef, profileData, { merge: true });
                    });
                });
            }
            setIsEditing(false);
        }
    };

    const handleCancel = () => {
        setProfiles(backupProfiles);
        setIsEditing(false);
    };

    const lifestyleTotal = useMemo(() => {
        if (!activeLifestyleProfile || !activeLifestyleProfile.categories) return 0;
        return activeLifestyleProfile.categories.reduce((acc: number, category: any) => {
            return acc + category.bills.reduce((billAcc: number, bill: any) => billAcc + (bill.amount || 0), 0);
        }, 0);
    }, [activeLifestyleProfile]);

    const businessTotal = useMemo(() => {
        if (!activeBusinessProfile || !activeBusinessProfile.categories) return 0;
        return activeBusinessProfile.categories.reduce((acc: number, category: any) => {
            return acc + category.bills.reduce((billAcc: number, bill: any) => billAcc + (bill.amount || 0), 0);
        }, 0);
    }, [activeBusinessProfile]);
    
    const handleDeleteProfile = (profileId: string) => {
        if (!firestore || !tenantId) return;

        const profileKey = `${activeTab}Profiles`;
        const currentProfiles = profiles[profileKey as keyof typeof profiles] as any[];

        if (currentProfiles.length <= 1) {
            toast({
                variant: 'destructive',
                title: 'Cannot Delete',
                description: 'You must have at least one profile per category.',
            });
            return;
        }

        const profileToDelete = currentProfiles.find((p) => p.id === profileId);
        if (!profileToDelete) return;
        
        const profileDocRef = doc(firestore, `tenants/${tenantId}/${profileKey}`, profileId);
        deleteDocumentNonBlocking(profileDocRef);

        if (profileToDelete.isActive) {
            const nextActiveProfile = currentProfiles.find((p) => p.id !== profileId);
            if (nextActiveProfile) {
                const nextActiveRef = doc(firestore, `tenants/${tenantId}/${profileKey}`, nextActiveProfile.id);
                updateDocumentNonBlocking(nextActiveRef, { isActive: true });
            }
        }
    };


  return (
    <div className="w-full">
      <AppHeader title="Financial Foundation" />
        <div className="p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
                  <div>
                    <h1 className="text-3xl font-bold">Your True Minimum Hourly Rate</h1>
                    <p className="text-muted-foreground mt-2 max-w-3xl">
                        The bedrock of your entire business. This is the exact amount you must earn per hour to cover all your expenses and fund your desired lifestyle.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isEditing ? (
                        <>
                            <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                            <Button onClick={handleEditToggle}><Save className="mr-2"/>Save Changes</Button>
                        </>
                    ) : (
                        <Button onClick={handleEditToggle}><Edit className="mr-2"/>Edit Profiles</Button>
                    )}
                  </div>
                </div>

                <Tabs defaultValue="lifestyle" className="w-full" onValueChange={setActiveTab}>
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="lifestyle">1. Lifestyle Costs</TabsTrigger>
                        <TabsTrigger value="business">2. Business Costs</TabsTrigger>
                    </TabsList>
                    
                     <div className="grid lg:grid-cols-[320px,1fr] gap-8 items-start mt-6">
                        <div className="lg:sticky lg:top-24 space-y-6">
                           <FinancialProfileManager 
                                  activeTab={activeTab} 
                                  profiles={profiles}
                                  setProfiles={setProfiles}
                                  isEditing={isEditing}
                                  renamingProfileId={renamingProfileId}
                                  setRenamingProfileId={setRenamingProfileId}
                                  onDeleteProfile={handleDeleteProfile}
                              />
                            <TmhrBreakdownCard 
                                lifestyleTotal={lifestyleTotal} 
                                businessTotal={businessTotal} 
                                totalHours={totalBillableHours}
                                firestore={firestore}
                                selectedTenant={selectedTenant}
                            />
                        </div>
                        <div className="lg:col-span-1">
                            <TabsContent value="lifestyle" className="m-0">
                               <LifestyleTab
                                 isEditing={isEditing}
                                 profileData={activeLifestyleProfile}
                                 onBillChange={(categoryName, billTitle, field, value) => handleBillChange('lifestyle', categoryName, billTitle, field, value)}
                               />
                            </TabsContent>
                            <TabsContent value="business" className="m-0">
                               <BusinessTab
                                 isEditing={isEditing}
                                 profileData={activeBusinessProfile}
                                 onBillChange={(categoryName, billTitle, field, value) => handleBillChange('business', categoryName, billTitle, field, value)}
                               />
                            </TabsContent>
                        </div>
                    </div>
                </Tabs>
            </div>
        </div>
    </div>
  );
}
