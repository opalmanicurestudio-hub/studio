
'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
  Trash2,
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
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Activity,
  Target,
  ListChecks,
  Clock,
  Film,
  Landmark
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
import { motion, AnimatePresence } from 'framer-motion';

const BillItemRow = ({
  bill,
  isEditing = false,
  onBillChange,
  onDelete,
}: {
  bill: { id: string; title: string; amount: number; isCustom?: boolean; dueDay?: number; paymentUrl?: string; lateFee?: number; lateByDay?: number; };
  isEditing?: boolean;
  onBillChange: (billId: string, field: string, value: any) => void;
  onDelete: (billId: string) => void;
}) => (
    <div className="flex flex-col p-4 rounded-2xl border-2 bg-background hover:border-primary/20 transition-all group">
      <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
              {bill.isCustom && isEditing ? (
                  <Input 
                    value={bill.title} 
                    onChange={(e) => onBillChange(bill.id, 'title', e.target.value)}
                    className="font-bold h-10 border-2 rounded-xl uppercase text-xs" 
                  />
              ) : (
                  <div className="flex flex-col text-left">
                    <Label className="font-black uppercase tracking-tight text-xs text-slate-900 truncate">{bill.title}</Label>
                     {!isEditing && (
                        <div className="flex items-center gap-2 text-muted-foreground mt-1 opacity-40">
                            {bill.dueDay && <div className="flex items-center gap-1 text-[8px] font-black uppercase"><Calendar className="w-2.5 h-2.5" /> Day {bill.dueDay}</div>}
                            {bill.lateFee && <div className="flex items-center gap-1 text-[8px] font-black uppercase text-destructive"><AlertTriangle className="w-2.5 h-2.5" /> ${bill.lateFee} Penalty</div>}
                        </div>
                    )}
                  </div>
              )}
          </div>
          <div className="flex items-center gap-2 w-32 shrink-0">
              <div className="relative flex-1">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-primary opacity-40" />
                <Input
                    type="number"
                    placeholder="0.00"
                    className="pl-8 h-10 rounded-xl border-2 font-black font-mono text-sm text-right bg-muted/5 shadow-inner"
                    disabled={!isEditing}
                    value={bill.amount || ''}
                    onChange={(e) => onBillChange(bill.id, 'amount', parseFloat(e.target.value) || 0)}
                />
              </div>
          </div>
      </div>
      {isEditing && (
         <Accordion type="single" collapsible className="w-full mt-4">
            <AccordionItem value="details" className="border-none">
                <AccordionTrigger className="text-[9px] font-black uppercase tracking-widest justify-start gap-2 p-0 hover:no-underline text-primary/60">Configure Logic & Alerts</AccordionTrigger>
                <AccordionContent className="pt-4 space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5 text-left">
                            <Label htmlFor={`dueDay-${bill.id}`} className="text-[8px] font-black uppercase text-muted-foreground ml-1">Due Day</Label>
                            <Input id={`dueDay-${bill.id}`} type="number" placeholder="1" value={bill.dueDay || ''} onChange={(e) => onBillChange(bill.id, 'dueDay', parseInt(e.target.value) || undefined)} className="h-9 rounded-lg border-2 font-black text-center" />
                        </div>
                        <div className="space-y-1.5 text-left">
                            <Label htmlFor={`paymentUrl-${bill.id}`} className="text-[8px] font-black uppercase text-muted-foreground ml-1">Payment URL</Label>
                             <div className="relative">
                                <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />
                                <Input id={`paymentUrl-${bill.id}`} placeholder="https://..." value={bill.paymentUrl || ''} onChange={(e) => onBillChange(bill.id, 'paymentUrl', e.target.value)} className="pl-7 h-9 rounded-lg border-2 font-medium text-[10px]" />
                            </div>
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5 text-left">
                            <Label htmlFor={`lateFee-${bill.id}`} className="text-[8px] font-black uppercase text-muted-foreground ml-1">Late Penalty ($)</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />
                                <Input id={`lateFee-${bill.id}`} type="number" placeholder="0.00" value={bill.lateFee || ''} onChange={(e) => onBillChange(bill.id, 'lateFee', parseFloat(e.target.value) || 0)} className="pl-7 h-9 rounded-lg border-2 font-black text-xs bg-white" />
                            </div>
                        </div>
                        <div className="space-y-1.5 text-left">
                            <Label htmlFor={`lateByDay-${bill.id}`} className="text-[8px] font-black uppercase text-muted-foreground ml-1">Late After (Days)</Label>
                            <div className="relative">
                                <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />
                                <Input id={`lateByDay-${bill.id}`} type="number" placeholder="0" value={bill.lateByDay || ''} onChange={(e) => onBillChange(bill.id, 'lateByDay', parseInt(e.target.value) || 0)} className="pl-7 h-9 rounded-lg border-2 font-black text-xs bg-white text-center" />
                            </div>
                        </div>
                     </div>
                      <div className="pt-2">
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-destructive font-black uppercase text-[9px] tracking-widest w-full hover:bg-destructive/5"
                            onClick={() => onDelete(bill.id)}
                        >
                            <Trash2 className="w-3 h-3 mr-2"/>Terminate Record
                        </Button>
                      </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      )}
    </div>
);

const lifestyleCategoriesTemplate = [
  { name: 'Housing', icon: <Home className="w-5 h-5 text-primary" />, bills: [ { title: "Rent/Mortgage", amount: 0, dueDay: 1 }, { title: "Property Taxes", amount: 0, dueDay: 15 }, { title: "HOA Fees", amount: 0, dueDay: 1 }, { title: "Insurance", amount: 0, dueDay: 10 } ]},
  { name: 'Utilities', icon: <Receipt className="w-5 h-5 text-primary" />, bills: [ { title: "Electric", amount: 0, dueDay: 20 }, { title: "Water", amount: 0, dueDay: 20 }, { title: "Gas", amount: 0, dueDay: 20 }, { title: "Waste Management", amount: 0, dueDay: 20 } ]},
  { name: 'Internet & Phone', icon: <Wifi className="w-5 h-5 text-primary" />, bills: [{ title: 'Internet Bill', amount: 0, dueDay: 5 }, { title: 'Cell Phone Bill', amount: 0, dueDay: 15 }] },
  { name: 'Lifestyle & Subscriptions', icon: <Film className="w-5 h-5 text-primary" />, bills: [ { title: "Entertainment", amount: 0, dueDay: 1 }, { title: "Streaming", amount: 0, dueDay: 1 }, { title: "Gym/Health", amount: 0, dueDay: 1 } ]},
  { name: 'Food & Essentials', icon: <ShoppingCart className="w-5 h-5 text-primary" />, bills: [{ title: 'Groceries', amount: 0, dueDay: 1 }, { title: 'Dining', amount: 0, dueDay: 1 }] },
  { name: 'Transportation', icon: <Car className="w-5 h-5 text-primary" />, bills: [ { title: "Car Payment", amount: 0, dueDay: 25 }, { title: "Car Insurance", amount: 0, dueDay: 15 }, { title: "Gas/Fuel", amount: 0, dueDay: 1 } ]},
  { name: 'Debt & Goals', icon: <PiggyBank className="w-5 h-5 text-primary" />, bills: [ { title: "Debt Repayment", amount: 0, dueDay: 25 }, { title: "Savings Contributions", amount: 0, dueDay: 1 } ]},
];

const businessCategoriesTemplate = [
   { name: "Rent & Facility", icon: <Building className="w-5 h-5 text-primary"/>, bills: [ {title: "Studio Rent", amount: 0, dueDay: 1}, {title: "Business Insurance", amount: 0, dueDay: 20} ]},
   { name: "Utilities", icon: <Receipt className="w-5 h-5 text-primary"/>, bills: [{title: "Electric", amount: 0, dueDay: 20}, {title: "Water", amount: 0, dueDay: 20}, {title: "Internet", amount: 0, dueDay: 20}] },
   { name: "Systems & Admin", icon: <Monitor className="w-5 h-5 text-primary"/>, bills: [ {title: "Booking Software", amount: 0, dueDay: 5}, {title: "Marketing", amount: 0, dueDay: 1}, {title: "Admin/Professional", amount: 0, dueDay: 1} ]},
   { name: "Supplies & Inventory", icon: <Package className="w-5 h-5 text-primary"/>, bills: [{title: "Backbar Reserve", amount: 0, dueDay: 1}] },
   { name: "Business Debt", icon: <Landmark className="w-5 h-5 text-primary"/>, bills: [{title: "Loans", amount: 0, dueDay: 1}, {title: "Tax Reserve", amount: 0, dueDay: 1}] },
];

const deepCopyTemplate = (template: any[]) => {
  return template.map(({ icon, ...category }) => ({
    ...category,
    bills: category.bills.map((bill: any) => ({ ...bill, id: nanoid() }))
  }));
};

const BillEditor = ({
  categories,
  isEditing,
  onBillChange,
  onAddBillItem,
  onDeleteBillItem,
}: {
  categories: {
    name: string;
    icon: React.ReactNode;
    bills: { id: string; title: string; amount: number; isCustom?: boolean; dueDay?: number; paymentUrl?: string; lateFee?: number; lateByDay?: number; }[];
  }[];
  isEditing: boolean;
  onBillChange: (categoryName: string, billId: string, field: string, value: any) => void;
  onAddBillItem: (categoryName: string) => void;
  onDeleteBillItem: (categoryName: string, billId: string) => void;
}) => {
  const total = useMemo(() => {
    return categories.reduce((acc, category) => {
      return acc + category.bills.reduce((billAcc, bill) => billAcc + (bill.amount || 0), 0);
    }, 0);
  }, [categories]);

  return (
    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
      <CardHeader className="bg-muted/5 border-b p-6 sm:p-8 text-left">
        <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2"><ListChecks className="w-4 h-4 text-primary" /> Manifest Entry</CardTitle>
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Quantify your recurring monthly load.</CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-8">
        <Accordion type="multiple" defaultValue={['category-0']} className="w-full space-y-4">
          {categories.map((category, index) => (
            <AccordionItem key={`category-${category.name}-${index}`} value={`category-${index}`} className="border-2 rounded-2xl overflow-hidden bg-white">
              <AccordionTrigger className="p-4 bg-muted/30 hover:no-underline font-black uppercase text-[10px] tracking-widest text-slate-900 group">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white rounded-xl shadow-inner border border-border/50 group-data-[state=open]:bg-primary group-data-[state=open]:text-white transition-all duration-500">
                    {category.icon}
                  </div>
                  <span>{category.name}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="p-4 space-y-3">
                  {category.bills.map((bill, billIndex) => (
                    <BillItemRow
                      key={`bill-${bill.id || `virtual-${billIndex}`}`}
                      bill={bill}
                      isEditing={isEditing}
                      onBillChange={(billId, field, value) => onBillChange(category.name, billId, field, value)}
                      onDelete={(billId) => onDeleteBillItem(category.name, billId)}
                    />
                  ))}
                  {isEditing && (
                    <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full h-10 rounded-xl border-dashed border-2 font-black uppercase text-[9px] tracking-widest bg-muted/5 hover:bg-muted/10 transition-all mt-2"
                        onClick={() => onAddBillItem(category.name)}
                    >
                        <PlusCircle className="mr-2 h-3.5 w-3.5 opacity-40" /> Append Custom Item
                    </Button>
                  )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
      <CardFooter className="bg-primary/5 p-6 sm:p-8 border-t-2 border-primary/10 flex justify-between items-center">
        <div className="text-left">
          <p className="text-[10px] font-black uppercase text-primary tracking-widest opacity-60">Cycle Cumulative</p>
          <p className="text-3xl font-black font-mono tracking-tighter text-primary">${total.toFixed(2)}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-40">Annual Run-Rate</p>
          <p className="text-xl font-black font-mono tracking-tighter text-slate-900">${(total * 12).toFixed(0)}</p>
        </div>
      </CardFooter>
    </Card>
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
}: any) => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const profileKey = `${activeTab}Profiles`;
  const currentProfiles = profiles[profileKey] || [];
  const [tempName, setTempName] = useState('');
  
  const handleAddProfile = () => {
    const newProfileName = `New ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Scenario`;
    let newProfileData = activeTab === 'lifestyle' ? { categories: deepCopyTemplate(lifestyleCategoriesTemplate) } : { categories: deepCopyTemplate(businessCategoriesTemplate) };

    const newProfile = { id: `${activeTab.slice(0, 2)}${Date.now()}`, name: newProfileName, isActive: false, ...newProfileData };
    setProfiles((prev: any) => ({ ...prev, [profileKey]: [...prev[profileKey], newProfile] }));
  };
  
  const handleSetActive = async (id: string) => {
    if (isEditing || !firestore || !tenantId) return;
    const batch = writeBatch(firestore);
    currentProfiles.forEach((p: any) => {
        const profileDocRef = doc(firestore, `tenants/${tenantId}/${profileKey}/${p.id}`);
        batch.update(profileDocRef, { isActive: p.id === id });
    });
    await batch.commit();
  }

  return (
    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
      <CardHeader className="bg-muted/5 border-b p-6 text-left">
        <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2"><Briefcase className="w-4 h-4 text-primary" /> {activeTab} Portfolios</CardTitle>
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Manage your financial scenarios.</CardDescription>
      </CardHeader>
      <CardContent className="p-4 space-y-2">
          {currentProfiles.map((profile: any) => (
            <div key={`profile-mgr-${profile.id}`} className={cn("relative group transition-all rounded-2xl border-2 p-3 flex items-center justify-between", profile.isActive ? "border-primary bg-primary/5 shadow-sm" : "border-transparent bg-background hover:bg-muted/30")}>
              {renamingProfileId === profile.id ? (
                 <div className="flex-1 flex items-center gap-2">
                    <Input value={tempName} autoFocus onChange={(e) => setTempName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setRenamingProfileId(null)} className="h-9 rounded-xl border-2 font-bold uppercase text-xs" />
                    <Button size="icon" className="h-9 w-9 rounded-xl shadow-lg" onClick={() => setRenamingProfileId(null)}><Check className="h-4 w-4" /></Button>
                </div>
              ) : (
                <button className="flex-1 text-left min-w-0" onClick={() => handleSetActive(profile.id)} disabled={isEditing}>
                  <p className={cn("font-black uppercase tracking-tight text-[11px] truncate", profile.isActive ? "text-primary" : "text-slate-900")}>{profile.name}</p>
                  {profile.isActive && <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Active Matrix</p>}
                </button>
              )}
              {!isEditing && renamingProfileId !== profile.id && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl"><MoreHorizontal className="h-4 w-4 opacity-40"/></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1"><DropdownMenuItem onClick={() => { setRenamingProfileId(profile.id); setTempName(profile.name); }} className="font-bold text-[10px] uppercase tracking-widest">Rename</DropdownMenuItem><DropdownMenuItem onClick={() => onDeleteProfile(profile.id)} className="text-destructive font-bold text-[10px] uppercase tracking-widest">Terminate</DropdownMenuItem></DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
      </CardContent>
      {isEditing && (
          <CardFooter className="p-4 pt-0">
            <Button variant="outline" className="w-full h-11 rounded-xl border-2 border-dashed font-black uppercase text-[10px] tracking-widest shadow-inner bg-muted/5" onClick={handleAddProfile}><PlusCircle className="mr-2 h-4 w-4 text-primary opacity-40" /> New Scenario</Button>
          </CardFooter>
      )}
    </Card>
  );
};

const TmhrBreakdownCard = ({ lifestyleTotal, businessTotal, totalHours, firestore, selectedTenant }: any) => {
    const { toast } = useToast();
    const totalCosts = lifestyleTotal + businessTotal;
    const tmhr = totalHours > 0 ? totalCosts / totalHours : 0;
    
    const handleSetDefaultRate = () => {
        if (!selectedTenant || !firestore) return;
        const tenantRef = doc(firestore, 'tenants', selectedTenant.id);
        updateDocumentNonBlocking(tenantRef, { tmhr });
        toast({ title: 'Foundation Synchronized', description: `TMHR of $${tmhr.toFixed(2)}/hr set as studio standard.` });
    };

    return (
    <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
        <div className="absolute top-0 right-0 p-8 opacity-5 transition-opacity group-hover:opacity-10"><Sparkles className="w-32 h-32 text-primary" /></div>
        <CardHeader className="p-8 pb-4 text-left">
            <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2"><Target className="w-3 h-3" />Alpha Metric</CardTitle>
            <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Strategic Studio Foundation</CardDescription>
        </CardHeader>
        <CardContent className="p-8 pt-0 space-y-8 text-left">
            <div className="text-center space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">Minimum Yield / Hour</p>
                <p className="text-6xl sm:text-8xl font-black text-primary tracking-tighter font-mono leading-none">${tmhr.toFixed(2)}</p>
            </div>
            <div className="space-y-4 pt-4 border-t-2 border-dashed border-primary/10">
                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60"><span>Personal Draw / Hr</span> <span className="font-mono text-slate-900">${(totalHours > 0 ? lifestyleTotal / totalHours : 0).toFixed(2)}</span></div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60"><span>OpEx Load / Hr</span> <span className="font-mono text-slate-900">${(totalHours > 0 ? businessTotal / totalHours : 0).toFixed(2)}</span></div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-primary"><span>Billable Load</span> <span className="font-mono text-xs">{totalHours.toFixed(1)}h/mo</span></div>
            </div>
        </CardContent>
        <CardFooter className="p-8 pt-0">
            <Button className="w-full h-14 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-primary/20 transition-all active:scale-95" onClick={handleSetDefaultRate}>Commit as Studio Standard</Button>
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
    
    const [profiles, setProfiles] = useState<any>({ lifestyleProfiles: [], businessProfiles: [], scheduleProfiles: [] });

    useEffect(() => {
        if (lifestyleProfilesLoading || !firestore || !user || !tenantId) return;
        if (lifestyleProfilesData && lifestyleProfilesData.length === 0) {
            const id = nanoid();
            setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/lifestyleProfiles/${id}`), { id, name: 'Core Lifestyle', isActive: true, categories: deepCopyTemplate(lifestyleCategoriesTemplate) }, {});
        }
    }, [lifestyleProfilesLoading, lifestyleProfilesData, firestore, user, tenantId]);

    useEffect(() => {
        if (businessProfilesLoading || !firestore || !user || !tenantId) return;
        if (businessProfilesData && businessProfilesData.length === 0) {
            const id = nanoid();
            setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/businessProfiles/${id}`), { id, name: 'Studio Overhead', isActive: true, categories: deepCopyTemplate(businessCategoriesTemplate) }, {});
        }
    }, [businessProfilesLoading, businessProfilesData, firestore, user, tenantId]);

    useEffect(() => {
        // Map over data to ensure all nested bills have IDs for robust rendering
        const ensureBillIds = (profilesList: any[]) => {
            return (profilesList || []).map(p => ({
                ...p,
                categories: (p.categories || []).map((cat: any) => ({
                    ...cat,
                    bills: (cat.bills || []).map((bill: any) => ({
                        ...bill,
                        id: bill.id || nanoid()
                    }))
                }))
            }));
        };

        setProfiles({
            lifestyleProfiles: ensureBillIds(lifestyleProfilesData || []),
            businessProfiles: ensureBillIds(businessProfilesData || []),
            scheduleProfiles: scheduleProfilesData || [],
        });
    }, [lifestyleProfilesData, businessProfilesData, scheduleProfilesData]);

    const activeLifestyleProfile = useMemo(() => profiles.lifestyleProfiles.find((p: any) => p.isActive), [profiles.lifestyleProfiles]);
    const activeBusinessProfile = useMemo(() => profiles.businessProfiles.find((p: any) => p.isActive), [profiles.businessProfiles]);
    const activeScheduleProfile = useMemo(() => profiles.scheduleProfiles.find((p: any) => p.isActive), [profiles.scheduleProfiles]);

    const handleBillChange = useCallback((profileType: 'lifestyle' | 'business', categoryName: string, billId: string, field: string, value: any) => {
        const key = `${profileType}Profiles`;
        setProfiles((prev: any) => ({
            ...prev,
            [key]: prev[key].map((p: any) => p.isActive ? {
                ...p,
                categories: p.categories.map((cat: any) => cat.name === categoryName ? {
                    ...cat,
                    bills: cat.bills.map((bill: any) => bill.id === billId ? { ...bill, [field]: value } : bill)
                } : cat)
            } : p)
        }));
    }, []);

    const handleAddBillItem = useCallback((profileType: 'lifestyle' | 'business', categoryName: string) => {
        const key = `${profileType}Profiles`;
        setProfiles((prev: any) => ({
            ...prev,
            [key]: prev[key].map((p: any) => p.isActive ? {
                ...p,
                categories: p.categories.map((cat: any) => cat.name === categoryName ? {
                    ...cat,
                    bills: [...cat.bills, { id: nanoid(), title: 'NEW ITEM', amount: 0, isCustom: true, dueDay: 1 }]
                } : cat)
            } : p)
        }));
    }, []);

    const handleDeleteBillItem = useCallback((profileType: 'lifestyle' | 'business', categoryName: string, billId: string) => {
        const key = `${profileType}Profiles`;
        setProfiles((prev: any) => ({
            ...prev,
            [key]: prev[key].map((p: any) => p.isActive ? {
                ...p,
                categories: p.categories.map((cat: any) => cat.name === categoryName ? {
                    ...cat,
                    bills: cat.bills.filter((b: any) => b.id !== billId)
                } : cat)
            } : p)
        }));
    }, []);

    const totalBillableHours = useMemo(() => {
        if (!activeScheduleProfile) return 0;
        const timeToMinutes = (timeStr: string) => {
            if (!timeStr) return 0;
            const [time, period] = timeStr.split(' ');
            let [h, m] = time.split(':').map(Number);
            if (period === 'PM' && h < 12) h += 12;
            if (period === 'AM' && h === 12) h = 0;
            return h * 60 + m;
        };
        const weeklyMinutes = Object.values(activeScheduleProfile.week).reduce((acc: number, day: any) => day.enabled ? acc + (timeToMinutes(day.end) - timeToMinutes(day.start)) : acc, 0);
        const weeklyHours = weeklyMinutes / 60;
        const totalWorkDaysInYear = 52 * Object.values(activeScheduleProfile.week).filter((d: any) => d.enabled).length;
        const totalDaysOff = activeScheduleProfile.timeOff.vacationDays + activeScheduleProfile.timeOff.holidays;
        const workDayPercentage = totalWorkDaysInYear > 0 ? (totalWorkDaysInYear - totalDaysOff) / totalWorkDaysInYear : 0;
        return (weeklyHours * 52 / 12) * workDayPercentage;
    }, [activeScheduleProfile]);

    const handleEditToggle = () => {
        if (isEditing) {
            if (firestore) {
                 Object.entries(profiles).forEach(([key, list]) => {
                    (list as any[]).forEach((p: any) => {
                        if (!tenantId) return;
                        updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/${key}/${p.id}`), p);
                    });
                });
            }
            toast({ title: 'Foundation Updated' });
        }
        setIsEditing(!isEditing);
    };

    const lifestyleTotal = useMemo(() => (activeLifestyleProfile?.categories || []).reduce((acc: number, c: any) => acc + (c.bills || []).reduce((ba: number, b: any) => ba + (b.amount || 0), 0), 0), [activeLifestyleProfile]);
    const businessTotal = useMemo(() => (activeBusinessProfile?.categories || []).reduce((acc: number, c: any) => acc + (c.bills || []).reduce((ba: number, b: any) => ba + (b.amount || 0), 0), 0), [activeBusinessProfile]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Foundation Analysis" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 text-left">
            <div className="space-y-1">
                <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Yield Architecture</h1>
                <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">TMHR Calculation & Core Economics</p>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
                {isEditing ? (
                    <>
                        <Button variant="ghost" onClick={() => setIsEditing(false)} className="flex-1 sm:w-auto h-14 font-black uppercase text-[10px] tracking-widest text-slate-400">Cancel</Button>
                        <Button onClick={handleEditToggle} className="flex-1 sm:w-auto h-14 px-8 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20"><Save className="mr-2 h-4 w-4" />Save Architecture</Button>
                    </>
                ) : (
                    <Button onClick={handleEditToggle} className="w-full sm:w-auto h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20"><Edit className="mr-2 h-4 w-4" />Modify Profiles</Button>
                )}
            </div>
        </div>

        <Tabs defaultValue="lifestyle" className="w-full" onValueChange={setActiveTab}>
            <div className="flex flex-col space-y-8">
                <div className="w-full overflow-x-auto pb-2 scrollbar-hide">
                    <TabsList className="inline-flex bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner gap-1.5 mb-2">
                        <TabsTrigger value="lifestyle" className="px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">1. Lifestyle Target</TabsTrigger>
                        <TabsTrigger value="business" className="px-8 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">2. Studio Overhead</TabsTrigger>
                    </TabsList>
                </div>
                
                <div className="grid lg:grid-cols-3 xl:grid-cols-4 gap-10 items-start">
                    <div className="lg:col-span-1 space-y-8">
                        <FinancialProfileManager 
                            activeTab={activeTab} 
                            profiles={profiles}
                            setProfiles={setProfiles}
                            isEditing={isEditing}
                            renamingProfileId={renamingProfileId}
                            setRenamingProfileId={setRenamingProfileId}
                            onDeleteProfile={(id: string) => {
                                if (!tenantId) return;
                                deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/${activeTab}Profiles/${id}`));
                            }}
                        />
                        <TmhrBreakdownCard 
                            lifestyleTotal={lifestyleTotal} 
                            businessTotal={businessTotal} 
                            totalHours={totalBillableHours}
                            firestore={firestore}
                            selectedTenant={selectedTenant}
                        />
                    </div>
                    <div className="lg:col-span-2 xl:col-span-3">
                        <TabsContent value="lifestyle" className="m-0 animate-in fade-in duration-500">
                            <BillEditor
                                categories={activeLifestyleProfile?.categories || []}
                                isEditing={isEditing}
                                onBillChange={(cat, bid, field, val) => handleBillChange('lifestyle', cat, bid, field, val)}
                                onAddBillItem={(cat) => handleAddBillItem('lifestyle', cat)}
                                onDeleteBillItem={(cat, bid) => handleDeleteBillItem('lifestyle', cat, bid)}
                            />
                        </TabsContent>
                        <TabsContent value="business" className="m-0 animate-in fade-in duration-500">
                            <BillEditor
                                categories={activeBusinessProfile?.categories || []}
                                isEditing={isEditing}
                                onBillChange={(cat, bid, field, val) => handleBillChange('business', cat, bid, field, val)}
                                onAddBillItem={(cat) => handleAddBillItem('business', cat)}
                                onDeleteBillItem={(cat, bid) => handleDeleteBillItem('business', cat, bid)}
                            />
                        </TabsContent>
                    </div>
                </div>
            </div>
        </Tabs>
      </main>
    </div>
  );
}
