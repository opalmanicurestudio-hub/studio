

'use client';

import React, { useState, useMemo, useCallback } from 'react';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

const BillItemCard = ({
  bill,
  isEditing = false,
  onAmountChange,
}: {
  bill: { title: string; amount: number; isCustom?: boolean };
  isEditing?: boolean;
  onAmountChange: (newAmount: number) => void;
}) => (
  <Card className="w-full">
    <CardContent className="p-4">
      <div className="space-y-3">
        <div className="flex justify-between items-start gap-2">
          <div className="space-y-1 flex-1">
            {bill.isCustom && isEditing ? (
              <Input defaultValue={bill.title} className="font-semibold border-dashed h-9" disabled={!isEditing} />
            ) : (
              <Label className="font-semibold text-base pt-2 block">{bill.title}</Label>
            )}
            <div className="relative">
              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                placeholder="0.00"
                className="pl-8"
                disabled={!isEditing}
                value={bill.amount || ''}
                onChange={(e) => onAmountChange(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
          {bill.isCustom && isEditing && (
            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive-foreground hover:bg-destructive shrink-0 -mr-2">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
        {isEditing && (
          <div className='pt-2 space-y-3'>
            <div className="space-y-1.5">
              <Label className="text-xs">Payment URL</Label>
              <Input placeholder="https://" className="h-8 text-xs" disabled={!isEditing} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Due Day</Label>
                <Input type="number" placeholder="1" className="h-8 text-xs" disabled={!isEditing} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Late By</Label>
                <Input type="number" placeholder="5" className="h-8 text-xs" disabled={!isEditing} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Late Fee</Label>
                <Input type="number" placeholder="10.00" className="h-8 text-xs" disabled={!isEditing} />
              </div>
            </div>
          </div>
        )}
      </div>
    </CardContent>
  </Card>
);

const lifestyleCategoriesTemplate = [
  { name: 'Housing', icon: <Home className="w-5 h-5 text-primary" />, bills: [ { title: "Rent/Mortgage", amount: 0 }, { title: "Property Taxes", amount: 0 }, { title: "HOA Fees", amount: 0 }, { title: "Insurance (Homeowner's/Renter's)", amount: 0 } ]},
  { name: 'Utilities', icon: <Receipt className="w-5 h-5 text-primary" />, bills: [ { title: "Electric", amount: 0 }, { title: "Water", amount: 0 }, { title: "Gas", amount: 0 }, { title: "Waste Management", amount: 0 } ]},
  { name: 'Internet & Phone', icon: <Wifi className="w-5 h-5 text-primary" />, bills: [{ title: 'Internet Bill', amount: 0 }, { title: 'Cell Phone Bill', amount: 0 }] },
  { name: 'Streaming & Subscriptions', icon: <Film className="w-5 h-5 text-primary" />, bills: [ { title: "Netflix", amount: 0 }, { title: "Spotify", amount: 0 }, { title: "News Subscription", amount: 0 }, { title: "Cloud Storage (iCloud, Google Drive, etc.)", amount: 0 } ]},
  { name: 'Food', icon: <ShoppingCart className="w-5 h-5 text-primary" />, bills: [{ title: 'Groceries', amount: 0 }, { title: 'Restaurants', amount: 0 }] },
  { name: 'Transportation', icon: <Car className="w-5 h-5 text-primary" />, bills: [ { title: "Car Payment", amount: 0 }, { title: "Car Insurance", amount: 0 }, { title: "Gas/Fuel", amount: 0 }, { title: "Public Transit", amount: 0 } ]},
  { name: 'Health & Wellness', icon: <Heart className="w-5 h-5 text-primary" />, bills: [ { title: "Personal Health Insurance", amount: 0 }, { title: "Gym Membership", amount: 0 }, { title: "Therapy/Counseling", amount: 0 }, { title: "Medication", amount: 0 } ]},
  { name: 'Debt Repayment', icon: <CreditCard className="w-5 h-5 text-primary" />, bills: [ { title: "Student Loans", amount: 0 }, { title: "Credit Card Payments", amount: 0 }, { title: "Buy Now, Pay Later (e.g., Klarna, Afterpay)", amount: 0 } ]},
  { name: 'Family & Childcare', icon: <Baby className="w-5 h-5 text-primary" />, bills: [ { title: "Childcare / Daycare", amount: 0 }, { title: "Kids' Activities", amount: 0 }, { title: "Child Support", amount: 0 } ]},
  { name: 'Pets', icon: <Dog className="w-5 h-5 text-primary" />, bills: [{ title: 'Pet Food & Supplies', amount: 0 }, { title: 'Pet Insurance', amount: 0 }] },
  { name: 'Personal Spending', icon: <Sparkles className="w-5 h-5 text-primary" />, bills: [ { title: "Shopping (Clothes, etc.)", amount: 0 }, { title: "Entertainment (Movies, Concerts, etc.)", amount: 0 }, { title: "Hobbies & Recreation", amount: 0 }, { title: "Personal Care (Haircuts, etc. that you don't do yourself)", amount: 0 } ]},
  { name: 'Gifts & Donations', icon: <Gift className="w-5 h-5 text-primary" />, bills: [{ title: 'Gifts', amount: 0 }, { title: 'Donations', amount: 0 }] },
  { name: 'Financial Goals', icon: <PiggyBank className="w-5 h-5 text-primary" />, bills: [ { title: "Personal Savings", amount: 0 }, { title: "Retirement (IRA/401k contributions)", amount: 0 } ]},
];

const businessCategoriesTemplate = [
   { name: "Rent & Facility", icon: <Building className="w-5 h-5 text-primary"/>, bills: [ {title: "Studio Rent/Mortgage", amount: 0}, {title: "Business Insurance (Liability, Property)", amount: 0} ]},
   { name: "Utilities", icon: <Receipt className="w-5 h-5 text-primary"/>, bills: [{title: "Electric", amount: 0}, {title: "Water", amount: 0}, {title: "Gas", amount: 0}, {title: "Waste Management", amount: 0}] },
   { name: "Capital Equipment", icon: <Briefcase className="w-5 h-5 text-primary" />, bills: [] },
   { name: "Software & Systems", icon: <Monitor className="w-5 h-5 text-primary"/>, bills: [ {title: "Booking Software (e.g., ClarityFlow itself, Acuity, Square)", amount: 0}, {title: "Website Hosting", amount: 0}, {title: "Email Marketing (e.g., Mailchimp, ConvertKit)", amount: 0} ]},
   { name: "Tech & Comms", icon: <Phone className="w-5 h-5 text-primary"/>, bills: [{title: "Business Phone Line", amount: 0}] },
   { name: "Professional & Admin", icon: <Briefcase className="w-5 h-5 text-primary"/>, bills: [{title: "Accountant/Bookkeeper", amount: 0}, {title: "Licensing & Dues", amount: 0}] },
   { name: "Marketing & Growth", icon: <Megaphone className="w-5 h-5 text-primary"/>, bills: [{title: "Social Media Ads", amount: 0}, {title: "Print Materials (Business Cards, Flyers)", amount: 0}] },
   { name: "Retail & Marketing Materials", icon: <Package className="w-5 h-5 text-primary"/>, bills: [{title: "Packaging & Bags", amount: 0}] },
   { name: "Business Debt", icon: <Landmark className="w-5 h-5 text-primary"/>, bills: [{title: "Business Loan", amount: 0}, {title: "Tax Debt Payment", amount: 0}] },
   { name: "Miscellaneous", icon: <Sparkles className="w-5 h-5 text-primary"/>, bills: [{title: "Bank Fees", amount: 0, isCustom: true}] }
];

const deepCopyTemplate = (template: any[]) => {
  return template.map(category => ({
    ...category,
    icon: category.icon, // Keep the icon as a React element
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
    bills: { title: string; amount: number; isCustom?: boolean }[];
  }[];
  isEditing: boolean;
  onBillChange: (categoryName: string, billTitle: string, newAmount: number) => void;
}) => {
  const total = useMemo(() => {
    return categories.reduce((acc, category) => {
      return acc + category.bills.reduce((billAcc, bill) => billAcc + (bill.amount || 0), 0);
    }, 0);
  }, [categories]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <Accordion type="multiple" defaultValue={['category-0']} className="w-full">
          {categories.map((category, index) => (
            <AccordionItem key={category.name} value={`category-${index}`} className="border-b-0">
              <AccordionTrigger className="p-3 bg-muted/50 rounded-md hover:no-underline">
                <div className="flex items-center gap-3">
                  {category.icon}
                  <span className="font-semibold">{category.name}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                      {category.bills.map((bill) => (
                        <BillItemCard
                          key={bill.title}
                          bill={bill}
                          isEditing={isEditing}
                          onAmountChange={(newAmount) => onBillChange(category.name, bill.title, newAmount)}
                        />
                      ))}
                  </div>
              </AccordionContent>
            </AccordionItem>
          ))}
           <AccordionItem value="custom" className="border-b-0 mt-2">
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
  onBillChange: (categoryName: string, billTitle: string, newAmount: number) => void;
}) => {
  if (!profileData) return null;
  return (
    <div>
      <h2 className="text-2xl font-semibold">What does it cost to be you?</h2>
      <p className="text-muted-foreground mt-2">Log all your monthly personal living expenses to establish your lifestyle cost.</p>
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
  onBillChange: (categoryName: string, billTitle: string, newAmount: number) => void;
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

const DayScheduleRow = ({ day, dayData, onDayChange, isEditing }: { day: string; dayData: any; onDayChange: any; isEditing: boolean }) => {
  const timeOptions = Array.from({ length: (22 - 8) * 2 + 1 }, (_, i) => {
    const hour = Math.floor(i / 2) + 8;
    const minute = i % 2 === 0 ? '00' : '30';
    const period = hour < 12 ? 'AM' : 'PM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minute} ${period}`;
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4 p-4 border-b">
      <div className="flex items-center gap-3 w-full sm:w-28">
        <Switch
          id={`switch-${day}`}
          checked={dayData.enabled}
          onCheckedChange={(checked) => onDayChange('enabled', checked)}
          disabled={!isEditing}
        />
        <Label htmlFor={`switch-${day}`} className="font-semibold text-base">{day}</Label>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-4 w-full">
        <Select
          value={dayData.start}
          onValueChange={(value) => onDayChange('start', value)}
          disabled={!isEditing || !dayData.enabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeOptions.map(time => <SelectItem key={`${day}-start-${time}`} value={time}>{time}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={dayData.end}
          onValueChange={(value) => onDayChange('end', value)}
          disabled={!isEditing || !dayData.enabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeOptions.map(time => <SelectItem key={`${day}-end-${time}`} value={time}>{time}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

const ScheduleTab = ({ isEditing, scheduleData, onScheduleChange, onTimeOffChange }: { isEditing: boolean; scheduleData: any; onScheduleChange: any; onTimeOffChange: any }) => (
    <div>
        <h2 className="text-2xl font-semibold">How much time do you have to earn?</h2>
        <p className="text-muted-foreground mt-2">Define your available work hours to calculate your total billable time.</p>
        <div className="mt-6">
            <Card>
                <CardContent className="p-0 divide-y">
                    {Object.entries(scheduleData.week).map(([day, dayData]: [string, any]) => (
                        <DayScheduleRow 
                            key={day} 
                            day={day} 
                            dayData={dayData} 
                            onDayChange={(field: string, value: any) => onScheduleChange(day, field, value)}
                            isEditing={isEditing} 
                        />
                    ))}
                </CardContent>
            </Card>
            <Card className="mt-6">
                <CardHeader><CardTitle>Time Off</CardTitle></CardHeader>
                <CardContent className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label>Vacation Days / Year</Label>
                        <Input 
                            type="number" 
                            value={scheduleData.timeOff.vacationDays}
                            onChange={(e) => onTimeOffChange('vacationDays', parseInt(e.target.value) || 0)} 
                            disabled={!isEditing} 
                        />
                    </div>
                     <div className="space-y-2">
                        <Label>Statutory Holidays / Year</Label>
                        <Input 
                            type="number" 
                            value={scheduleData.timeOff.holidays}
                            onChange={(e) => onTimeOffChange('holidays', parseInt(e.target.value) || 0)} 
                            disabled={!isEditing} 
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    </div>
)

const FinancialProfileManager = ({
  activeTab,
  profiles,
  setProfiles,
  isEditing,
  renamingProfileId,
  setRenamingProfileId,
}: {
  activeTab: string;
  profiles: any;
  setProfiles: any;
  isEditing: boolean;
  renamingProfileId: string | null;
  setRenamingProfileId: (id: string | null) => void;
}) => {
  const profileKey = `${activeTab}Profiles`;
  const currentProfiles = profiles[profileKey];
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
        newProfileData = {
            week: {
                Monday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Tuesday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Wednesday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Thursday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Friday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Saturday: { enabled: false, start: '9:00 AM', end: '5:00 PM' },
                Sunday: { enabled: false, start: '9:00 AM', end: '5:00 PM' },
            },
            timeOff: { vacationDays: 0, holidays: 0 },
        };
    }

    const newProfile = {
      id: `${activeTab.slice(0, 2)}${Date.now()}`,
      name: newProfileName,
      isActive: false,
      isPro: activeTab !== 'schedule',
      isPublic: activeTab === 'schedule' ? false : undefined,
      ...newProfileData
    };

    setProfiles((prev:any) => ({
      ...prev,
      [profileKey]: [...prev[profileKey], newProfile],
    }));
  };
  
  const handleSetActive = (id: string) => {
    if (isEditing) return;
    setProfiles((prev: any) => ({
        ...prev,
        [profileKey]: prev[profileKey].map((p: any) => ({
            ...p,
            isActive: p.id === id,
        }))
    }))
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
    <Card className="lg:sticky top-24">
      <CardHeader>
        <CardTitle className="capitalize">{activeTab} Profiles</CardTitle>
        <CardDescription>Manage your financial scenarios.</CardDescription>
      </CardHeader>
      <CardContent className="p-2">
        <div className="space-y-1">
          {currentProfiles.map((profile:any) => (
            <div key={profile.id} className="group/item relative">
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
                  disabled={isEditing && profile.id !== getActiveProfileId()}
                >
                  <span className="flex-1 text-left truncate">{profile.name}</span>
                  {profile.isPro && !profile.isActive && <Badge variant="outline" className="ml-2">Pro</Badge>}
                  {activeTab === 'schedule' && profile.isPublic && (
                    <Globe className="h-4 w-4 text-muted-foreground ml-2" />
                  )}
                  {profile.isActive && <Badge variant="default" className="ml-2">Active</Badge>}
                </Button>
              )}

              {isEditing && profile.id === getActiveProfileId() && renamingProfileId !== profile.id && (
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
                        {activeTab === 'schedule' && <DropdownMenuItem>Set as Public</DropdownMenuItem>}
                        <DropdownMenuItem className="text-destructive" disabled={currentProfiles.length <= 1}>Delete</DropdownMenuItem>
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
                {(activeTab === 'lifestyle' || activeTab === 'business') && <Badge className="ml-auto">Pro</Badge>}
            </Button>
          </CardFooter>
      )}
    </Card>
  );
};


const TmhrBreakdownCard = ({ lifestyleTotal, businessTotal, totalHours }: { lifestyleTotal: number; businessTotal: number; totalHours: number; }) => {
    const { toast } = useToast();
    const totalCosts = lifestyleTotal + businessTotal;
    const tmhr = totalHours > 0 ? totalCosts / totalHours : 0;
    
    const handleSetDefaultRate = () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('tmhr', tmhr.toFixed(2));
            toast({
                title: 'Default Rate Saved',
                description: `Your TMHR of $${tmhr.toFixed(2)}/hr has been set as the default.`,
            });
        }
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
                    <span>Total Billable Hours / Month:</span>
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
    const [isEditing, setIsEditing] = useState(false);
    const [activeTab, setActiveTab] = useState('lifestyle');
    const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
    
    const [profiles, setProfiles] = useState({
      lifestyleProfiles: [
        { id: 'ls1', name: 'Default Lifestyle', isActive: true, isPro: false, categories: deepCopyTemplate(lifestyleCategoriesTemplate) },
      ],
      businessProfiles: [
        { id: 'bs1', name: 'Default Business', isActive: true, isPro: false, categories: deepCopyTemplate(businessCategoriesTemplate) },
      ],
      scheduleProfiles: [
        { 
            id: 'sc1', 
            name: 'Standard 35hr/wk', 
            isActive: true, 
            isPublic: true,
            week: {
                Monday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Tuesday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Wednesday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Thursday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Friday: { enabled: true, start: '9:00 AM', end: '5:00 PM' },
                Saturday: { enabled: false, start: '9:00 AM', end: '5:00 PM' },
                Sunday: { enabled: false, start: '9:00 AM', end: '5:00 PM' },
            },
            timeOff: { vacationDays: 0, holidays: 0 },
        },
        { 
            id: 'sc2', 
            name: 'Aggressive 45hr/wk', 
            isActive: false, 
            isPublic: false,
            week: {
                Monday: { enabled: true, start: '8:00 AM', end: '6:00 PM' },
                Tuesday: { enabled: true, start: '8:00 AM', end: '6:00 PM' },
                Wednesday: { enabled: true, start: '8:00 AM', end: '6:00 PM' },
                Thursday: { enabled: true, start: '8:00 AM', end: '6:00 PM' },
                Friday: { enabled: true, start: '8:00 AM', end: '6:00 PM' },
                Saturday: { enabled: true, start: '10:00 AM', end: '3:00 PM' },
                Sunday: { enabled: false, start: '9:00 AM', end: '5:00 PM' },
            },
            timeOff: { vacationDays: 10, holidays: 8 },
        }
      ]
    });

    const [backupProfiles, setBackupProfiles] = useState(profiles);

    const activeLifestyleProfile = useMemo(() => profiles.lifestyleProfiles.find(p => p.isActive), [profiles.lifestyleProfiles]);
    const activeBusinessProfile = useMemo(() => profiles.businessProfiles.find(p => p.isActive), [profiles.businessProfiles]);
    const activeScheduleProfile = useMemo(() => profiles.scheduleProfiles.find(p => p.isActive), [profiles.scheduleProfiles]);


    const handleBillChange = useCallback((profileType: 'lifestyle' | 'business', categoryName: string, billTitle: string, newAmount: number) => {
        const profileKey = `${profileType}Profiles` as const;

        setProfiles(prev => {
            const newProfiles = prev[profileKey].map(p => {
                if (p.isActive) {
                    const newCategories = p.categories.map(cat => {
                        if (cat.name === categoryName) {
                            const newBills = cat.bills.map(bill => {
                                if (bill.title === billTitle) {
                                    return { ...bill, amount: newAmount };
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

    const handleScheduleChange = useCallback((day: string, field: string, value: any) => {
        setProfiles(prev => ({
            ...prev,
            scheduleProfiles: prev.scheduleProfiles.map(p => 
                p.isActive ? {
                    ...p,
                    week: {
                        ...p.week,
                        [day]: { ...p.week[day as keyof typeof p.week], [field]: value }
                    }
                } : p
            )
        }))
    }, []);
    
    const handleTimeOffChange = useCallback((field: string, value: number) => {
        setProfiles(prev => ({
            ...prev,
            scheduleProfiles: prev.scheduleProfiles.map(p => 
                p.isActive ? {
                    ...p,
                    timeOff: { ...p.timeOff, [field]: value }
                } : p
            )
        }))
    }, []);

    const totalBillableHours = useMemo(() => {
        if (!activeScheduleProfile) return 0;
        
        const timeToMinutes = (timeStr: string) => {
            const [time, period] = timeStr.split(' ');
            let [hours, minutes] = time.split(':').map(Number);
            if (period === 'PM' && hours < 12) hours += 12;
            if (period === 'AM' && hours === 12) hours = 0;
            return hours * 60 + minutes;
        };

        const weeklyMinutes = Object.values(activeScheduleProfile.week).reduce((acc, day) => {
            if (day.enabled) {
                const startMinutes = timeToMinutes(day.start);
                const endMinutes = timeToMinutes(day.end);
                return acc + (endMinutes - startMinutes);
            }
            return acc;
        }, 0);
        
        const weeklyHours = weeklyMinutes / 60;
        
        const totalWorkDaysInYear = 52 * Object.values(activeScheduleProfile.week).filter(d => d.enabled).length;
        const totalDaysOff = activeScheduleProfile.timeOff.vacationDays + activeScheduleProfile.timeOff.holidays;
        
        // Ensure totalDaysOff doesn't exceed totalWorkDaysInYear
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
            // This would be where a save to backend would happen
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


  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Financial Foundation" />
      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
            <div className="p-4 md:p-8">
                <div className="max-w-6xl mx-auto">
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
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="lifestyle">1. Lifestyle</TabsTrigger>
                            <TabsTrigger value="business">2. Business</TabsTrigger>
                            <TabsTrigger value="schedule">3. Schedule</TabsTrigger>
                        </TabsList>
                        
                         <div className="grid lg:grid-cols-3 xl:grid-cols-4 gap-8 items-start mt-6">
                            <div className="lg:col-span-1 space-y-6">
                               <Card className="block">
                                  <FinancialProfileManager 
                                      activeTab={activeTab} 
                                      profiles={profiles}
                                      setProfiles={setProfiles}
                                      isEditing={isEditing}
                                      renamingProfileId={renamingProfileId}
                                      setRenamingProfileId={setRenamingProfileId}
                                  />
                               </Card>
                            </div>
                            <div className="lg:col-span-2 xl:col-span-3">
                                <TabsContent value="lifestyle" className="m-0">
                                   <LifestyleTab
                                     isEditing={isEditing}
                                     profileData={activeLifestyleProfile}
                                     onBillChange={(categoryName, billTitle, newAmount) => handleBillChange('lifestyle', categoryName, billTitle, newAmount)}
                                   />
                                </TabsContent>
                                <TabsContent value="business" className="m-0">
                                   <BusinessTab
                                     isEditing={isEditing}
                                     profileData={activeBusinessProfile}
                                     onBillChange={(categoryName, billTitle, newAmount) => handleBillChange('business', categoryName, billTitle, newAmount)}
                                   />
                                </TabsContent>
                                <TabsContent value="schedule" className="m-0">
                                   {activeScheduleProfile && <ScheduleTab 
                                    isEditing={isEditing}
                                    scheduleData={activeScheduleProfile}
                                    onScheduleChange={handleScheduleChange}
                                    onTimeOffChange={handleTimeOffChange}
                                   />}
                                </TabsContent>
                            </div>
                        </div>
                    </Tabs>
                    
                    <Separator className="my-12" />
                    
                    <div className="mt-8 space-y-6 max-w-md mx-auto">
                        <TmhrBreakdownCard lifestyleTotal={lifestyleTotal} businessTotal={businessTotal} totalHours={totalBillableHours}/>
                    </div>
                </div>
            </div>
        </ScrollArea>
      </main>
    </div>
  );
}

    

    
