'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DollarSign, PlusCircle, Home, Car, ShoppingCart, Sparkles,
  Building, Monitor, Briefcase, Wifi, MoreHorizontal, PiggyBank,
  Trash2, Receipt, Package, Save, Check, Link as LinkIcon,
  Calendar, AlertTriangle, Target, ListChecks, Clock, Film,
  Landmark, Percent, Pencil, RotateCcw,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  useFirebase, useCollection, useMemoFirebase,
  deleteDocumentNonBlocking, updateDocumentNonBlocking,
} from '@/firebase';
import { collection, doc, writeBatch, query, where, setDoc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { useTenant } from '@/context/TenantContext';

const CATEGORY_ICON_MAP: Record<string, React.ReactNode> = {
  'Housing':                   <Home         className="w-5 h-5 text-primary" />,
  'Utilities':                 <Receipt      className="w-5 h-5 text-primary" />,
  'Internet & Phone':          <Wifi         className="w-5 h-5 text-primary" />,
  'Lifestyle & Subscriptions': <Film         className="w-5 h-5 text-primary" />,
  'Food & Essentials':         <ShoppingCart className="w-5 h-5 text-primary" />,
  'Transportation':            <Car          className="w-5 h-5 text-primary" />,
  'Debt & Goals':              <PiggyBank    className="w-5 h-5 text-primary" />,
  'Rent & Facility':           <Building     className="w-5 h-5 text-primary" />,
  'Systems & Admin':           <Monitor      className="w-5 h-5 text-primary" />,
  'Supplies & Inventory':      <Package      className="w-5 h-5 text-primary" />,
  'Business Debt':             <Landmark     className="w-5 h-5 text-primary" />,
};
const getCategoryIcon = (name: string): React.ReactNode =>
  CATEGORY_ICON_MAP[name] ?? <ListChecks className="w-5 h-5 text-primary" />;

const LIFESTYLE_TEMPLATE = [
  { name: 'Housing', bills: [{ title: 'Rent / Mortgage', amount: 0, dueDay: 1 }, { title: 'Renters / Home Insurance', amount: 0, dueDay: 10 }, { title: 'Property Taxes', amount: 0, dueDay: 15 }, { title: 'HOA Fees', amount: 0, dueDay: 1 }] },
  { name: 'Utilities', bills: [{ title: 'Electric', amount: 0, dueDay: 20 }, { title: 'Water', amount: 0, dueDay: 20 }, { title: 'Gas / Heat', amount: 0, dueDay: 20 }, { title: 'Waste Management', amount: 0, dueDay: 20 }] },
  { name: 'Internet & Phone', bills: [{ title: 'Internet Bill', amount: 0, dueDay: 5 }, { title: 'Cell Phone Bill', amount: 0, dueDay: 15 }] },
  { name: 'Lifestyle & Subscriptions', bills: [{ title: 'Streaming (Netflix / Hulu etc)', amount: 0, dueDay: 1 }, { title: 'Gym / Health Membership', amount: 0, dueDay: 1 }, { title: 'Entertainment / Hobbies', amount: 0, dueDay: 1 }, { title: 'Amazon / Other Shopping', amount: 0, dueDay: 1 }] },
  { name: 'Food & Essentials', bills: [{ title: 'Groceries', amount: 0, dueDay: 1 }, { title: 'Dining Out', amount: 0, dueDay: 1 }, { title: 'Personal Care', amount: 0, dueDay: 1 }] },
  { name: 'Transportation', bills: [{ title: 'Car Payment', amount: 0, dueDay: 25 }, { title: 'Car Insurance', amount: 0, dueDay: 15 }, { title: 'Gas / Fuel', amount: 0, dueDay: 1 }, { title: 'Parking / Tolls', amount: 0, dueDay: 1 }] },
  { name: 'Debt & Goals', bills: [{ title: 'Student Loan', amount: 0, dueDay: 1 }, { title: 'Credit Card Min.', amount: 0, dueDay: 25 }, { title: 'Savings Contribution', amount: 0, dueDay: 1 }, { title: 'Emergency Fund', amount: 0, dueDay: 1 }] },
];

const BUSINESS_TEMPLATE = [
  { name: 'Rent & Facility', bills: [{ title: 'Studio Rent', amount: 0, dueDay: 1 }, { title: 'Business Insurance', amount: 0, dueDay: 20 }, { title: 'Parking / Building Fees', amount: 0, dueDay: 1 }] },
  { name: 'Utilities', bills: [{ title: 'Electric', amount: 0, dueDay: 20 }, { title: 'Water', amount: 0, dueDay: 20 }, { title: 'Internet', amount: 0, dueDay: 20 }] },
  { name: 'Systems & Admin', bills: [{ title: 'Booking Software', amount: 0, dueDay: 5 }, { title: 'Point of Sale / POS', amount: 0, dueDay: 1 }, { title: 'Marketing / Ads', amount: 0, dueDay: 1 }, { title: 'Accounting Software', amount: 0, dueDay: 1 }, { title: 'Website / Domain', amount: 0, dueDay: 1 }] },
  { name: 'Supplies & Inventory', bills: [{ title: 'Backbar / Product Reserve', amount: 0, dueDay: 1 }, { title: 'Tools & Equipment', amount: 0, dueDay: 1 }, { title: 'Sanitation Supplies', amount: 0, dueDay: 1 }] },
  { name: 'Business Debt', bills: [{ title: 'Business Loan', amount: 0, dueDay: 1 }, { title: 'Tax Reserve (set aside)', amount: 0, dueDay: 1 }, { title: 'Credit Card (biz)', amount: 0, dueDay: 25 }] },
];

const stampIds = (template: typeof LIFESTYLE_TEMPLATE) =>
  template.map((cat) => ({ ...cat, bills: cat.bills.map((bill) => ({ ...bill, id: nanoid() })) }));

const makeDefaultLifestyle = () => ({ id: nanoid(), name: 'Core Lifestyle', isActive: true, categories: stampIds(LIFESTYLE_TEMPLATE) });
const makeDefaultBusiness  = () => ({ id: nanoid(), name: 'Studio Overhead', isActive: true, categories: stampIds(BUSINESS_TEMPLATE) });

const ensureBillIds = (list: any[]) =>
  (list || []).map((p) => ({ ...p, categories: (p.categories || []).map((cat: any) => ({ ...cat, bills: (cat.bills || []).map((bill: any) => ({ ...bill, id: bill.id || nanoid() })) })) }));

const hasValidData = (list: any[]) =>
  list?.some((p) => (p.categories || []).some((c: any) => (c.bills || []).length > 0));

const BillItemRow = ({ bill, isEditing = false, onBillChange, onDelete }: {
  bill: { id: string; title: string; amount: number; isCustom?: boolean; dueDay?: number; paymentUrl?: string; lateFee?: number; lateByDay?: number };
  isEditing?: boolean;
  onBillChange: (billId: string, field: string, value: any) => void;
  onDelete: (billId: string) => void;
}) => (
  <div className="flex flex-col p-3 sm:p-4 rounded-2xl border-2 bg-background hover:border-primary/20 transition-all group">
    <div className="flex items-center justify-between gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        {bill.isCustom && isEditing ? (
          <Input value={bill.title} onChange={(e) => onBillChange(bill.id, 'title', e.target.value)} className="font-bold h-9 sm:h-10 border-2 rounded-xl uppercase text-[10px] sm:text-xs" />
        ) : (
          <div className="flex flex-col text-left">
            <Label className="font-black uppercase tracking-tight text-[10px] sm:text-xs text-slate-900 truncate">{bill.title}</Label>
            {!isEditing && (
              <div className="flex items-center gap-2 text-muted-foreground mt-0.5 opacity-40">
                {bill.dueDay && <span className="flex items-center gap-1 text-[7px] sm:text-[8px] font-black uppercase"><Calendar className="w-2 h-2 sm:w-2.5 sm:h-2.5" /> Day {bill.dueDay}</span>}
                {!!bill.lateFee && <span className="flex items-center gap-1 text-[7px] sm:text-[8px] font-black uppercase text-destructive"><AlertTriangle className="w-2 h-2 sm:w-2.5 sm:h-2.5" /> ${bill.lateFee} late fee</span>}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 w-24 sm:w-32 shrink-0">
        <div className="relative flex-1">
          <DollarSign className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 h-3 w-3 sm:h-3.5 sm:w-3.5 text-primary opacity-40" />
          <Input type="number" placeholder="0.00" className="pl-6 sm:pl-8 h-9 sm:h-10 rounded-xl border-2 font-black font-mono text-[11px] sm:text-sm text-right bg-muted/5 shadow-inner" disabled={!isEditing} value={bill.amount || ''} onChange={(e) => onBillChange(bill.id, 'amount', parseFloat(e.target.value) || 0)} />
        </div>
      </div>
    </div>
    {isEditing && (
      <Accordion type="single" collapsible className="w-full mt-3 sm:mt-4">
        <AccordionItem value="details" className="border-none">
          <AccordionTrigger className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest justify-start gap-2 p-0 hover:no-underline text-primary/60">Configure Logic &amp; Alerts</AccordionTrigger>
          <AccordionContent className="pt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-1.5 text-left">
                <Label className="text-[8px] font-black uppercase text-muted-foreground ml-1">Due Day of Month</Label>
                <Input type="number" placeholder="1" value={bill.dueDay || ''} onChange={(e) => onBillChange(bill.id, 'dueDay', parseInt(e.target.value) || undefined)} className="h-9 rounded-lg border-2 font-black text-center text-xs" />
              </div>
              <div className="space-y-1.5 text-left">
                <Label className="text-[8px] font-black uppercase text-muted-foreground ml-1">Payment URL</Label>
                <div className="relative">
                  <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />
                  <Input placeholder="https://..." value={bill.paymentUrl || ''} onChange={(e) => onBillChange(bill.id, 'paymentUrl', e.target.value)} className="pl-7 h-9 rounded-lg border-2 font-medium text-[9px] sm:text-[10px]" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-1.5 text-left">
                <Label className="text-[8px] font-black uppercase text-muted-foreground ml-1">Late Penalty ($)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />
                  <Input type="number" placeholder="0.00" value={bill.lateFee || ''} onChange={(e) => onBillChange(bill.id, 'lateFee', parseFloat(e.target.value) || 0)} className="pl-7 h-9 rounded-lg border-2 font-black text-xs bg-white" />
                </div>
              </div>
              <div className="space-y-1.5 text-left">
                <Label className="text-[8px] font-black uppercase text-muted-foreground ml-1">Late After (Days)</Label>
                <div className="relative">
                  <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 opacity-40" />
                  <Input type="number" placeholder="0" value={bill.lateByDay || ''} onChange={(e) => onBillChange(bill.id, 'lateByDay', parseInt(e.target.value) || 0)} className="h-9 rounded-lg border-2 font-black text-xs bg-white text-center" />
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="text-destructive font-black uppercase text-[8px] sm:text-[9px] tracking-widest w-full hover:bg-destructive/5 mt-2" onClick={() => onDelete(bill.id)}>
              <Trash2 className="w-3 h-3 mr-2" /> Remove Line Item
            </Button>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    )}
  </div>
);

const BillEditor = ({ categories, isEditing, onBillChange, onAddBillItem, onDeleteBillItem }: {
  categories: { name: string; bills: any[] }[];
  isEditing: boolean;
  onBillChange: (cat: string, billId: string, field: string, value: any) => void;
  onAddBillItem: (cat: string) => void;
  onDeleteBillItem: (cat: string, billId: string) => void;
}) => {
  const total = useMemo(() => categories.reduce((a, c) => a + (c.bills || []).reduce((b, bill) => b + (bill.amount || 0), 0), 0), [categories]);
  return (
    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
      <CardHeader className="bg-muted/5 border-b p-5 sm:p-8 text-left">
        <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2"><ListChecks className="w-4 h-4 text-primary" /> Manifest Entry</CardTitle>
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Enter your monthly recurring amounts in each category.</CardDescription>
      </CardHeader>
      <CardContent className="p-3 sm:p-8">
        <Accordion type="multiple" defaultValue={categories.map((_, i) => `category-${i}`)} className="w-full space-y-3 sm:space-y-4">
          {categories.map((category, index) => (
            <AccordionItem key={`${category.name}-${index}`} value={`category-${index}`} className="border-2 rounded-2xl overflow-hidden bg-white">
              <AccordionTrigger className="p-3 sm:p-4 bg-muted/30 hover:no-underline font-black uppercase text-[9px] sm:text-[10px] tracking-widest text-slate-900 group">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white rounded-xl shadow-inner border border-border/50 group-data-[state=open]:bg-primary group-data-[state=open]:text-white transition-all duration-300">{getCategoryIcon(category.name)}</div>
                  <div className="flex items-center gap-3">
                    <span className="truncate max-w-[140px] sm:max-w-none">{category.name}</span>
                    {(category.bills || []).some(b => b.amount > 0) && (
                      <span className="font-mono text-[9px] font-black text-primary/60">${(category.bills || []).reduce((a, b) => a + (b.amount || 0), 0).toFixed(0)}/mo</span>
                    )}
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="p-3 sm:p-4 space-y-2.5">
                {(category.bills || []).map((bill, bi) => (
                  <BillItemRow key={bill.id || `${index}-${bi}`} bill={bill} isEditing={isEditing} onBillChange={(id, field, val) => onBillChange(category.name, id, field, val)} onDelete={(id) => onDeleteBillItem(category.name, id)} />
                ))}
                {isEditing && (
                  <Button variant="outline" size="sm" className="w-full h-10 rounded-xl border-dashed border-2 font-black uppercase text-[8px] sm:text-[9px] tracking-widest bg-muted/5 hover:bg-muted/10 mt-1" onClick={() => onAddBillItem(category.name)}>
                    <PlusCircle className="mr-2 h-3.5 w-3.5 opacity-40" /> Add Custom Line Item
                  </Button>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
      <CardFooter className="bg-primary/5 p-5 sm:p-8 border-t-2 border-primary/10 flex justify-between items-center">
        <div className="text-left">
          <p className="text-[9px] sm:text-[10px] font-black uppercase text-primary tracking-widest opacity-60">Monthly Total</p>
          <p className="text-2xl font-black font-mono tracking-tighter text-primary">${total.toFixed(2)}</p>
        </div>
        <div className="text-right">
          <p className="text-[8px] sm:text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-40">Annual Run-Rate</p>
          <p className="text-lg sm:text-xl font-black font-mono tracking-tighter text-slate-900">${(total * 12).toFixed(0)}</p>
        </div>
      </CardFooter>
    </Card>
  );
};

const FinancialProfileManager = ({ activeTab, profiles, setProfiles, isEditing, renamingProfileId, setRenamingProfileId, onDeleteProfile, onResetToDefaults }: any) => {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const profileKey = `${activeTab}Profiles`;
  const currentProfiles = profiles[profileKey] || [];
  const [tempName, setTempName] = useState('');

  const handleAddProfile = () => {
    const name = `New ${activeTab === 'lifestyle' ? 'Lifestyle' : 'Business'} Scenario`;
    const categories = activeTab === 'lifestyle' ? stampIds(LIFESTYLE_TEMPLATE) : stampIds(BUSINESS_TEMPLATE);
    setProfiles((prev: any) => ({ ...prev, [profileKey]: [...prev[profileKey], { id: nanoid(), name, isActive: false, categories }] }));
  };

  const handleSetActive = async (id: string) => {
    if (isEditing || !firestore || !tenantId) return;
    const batch = writeBatch(firestore);
    currentProfiles.forEach((p: any) => { batch.update(doc(firestore, `tenants/${tenantId}/${profileKey}/${p.id}`), { isActive: p.id === id }); });
    await batch.commit();
  };

  return (
    <Card className="border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
      <CardHeader className="bg-muted/5 border-b p-5 sm:p-6 text-left">
        <CardTitle className="text-xs sm:text-sm font-black uppercase tracking-widest flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-primary" />{activeTab === 'lifestyle' ? 'Lifestyle' : 'Business'} Portfolios
        </CardTitle>
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Switch between financial scenarios.</CardDescription>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 space-y-2">
        {currentProfiles.map((profile: any) => (
          <div key={profile.id} className={cn('relative group transition-all rounded-2xl border-2 p-2.5 sm:p-3 flex items-center justify-between', profile.isActive ? 'border-primary bg-primary/5 shadow-sm' : 'border-transparent bg-background hover:bg-muted/30')}>
            {renamingProfileId === profile.id ? (
              <div className="flex-1 flex items-center gap-2">
                <Input value={tempName} autoFocus onChange={(e) => setTempName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setProfiles((prev: any) => ({ ...prev, [profileKey]: prev[profileKey].map((p: any) => p.id === profile.id ? { ...p, name: tempName } : p) })); setRenamingProfileId(null); } }} className="h-9 rounded-xl border-2 font-bold uppercase text-[10px] sm:text-xs" />
                <Button size="icon" className="h-9 w-9 rounded-xl shadow-lg shrink-0" onClick={() => { setProfiles((prev: any) => ({ ...prev, [profileKey]: prev[profileKey].map((p: any) => p.id === profile.id ? { ...p, name: tempName } : p) })); setRenamingProfileId(null); }}><Check className="h-4 w-4" /></Button>
              </div>
            ) : (
              <button className="flex-1 text-left min-w-0" onClick={() => handleSetActive(profile.id)} disabled={isEditing}>
                <p className={cn('font-black uppercase tracking-tight text-[10px] sm:text-[11px] truncate', profile.isActive ? 'text-primary' : 'text-slate-900')}>{profile.name}</p>
                {profile.isActive && <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Active</p>}
              </button>
            )}
            {!isEditing && renamingProfileId !== profile.id && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl shrink-0"><MoreHorizontal className="h-4 w-4 opacity-40" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                  <DropdownMenuItem onClick={() => { setRenamingProfileId(profile.id); setTempName(profile.name); }} className="font-bold text-[10px] uppercase tracking-widest">Rename</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDeleteProfile(profile.id)} className="text-destructive font-bold text-[10px] uppercase tracking-widest">Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </CardContent>
      <CardFooter className="p-3 sm:p-4 pt-0 flex flex-col gap-2">
        {isEditing && (
          <Button variant="outline" className="w-full h-10 sm:h-11 rounded-xl border-2 border-dashed font-black uppercase text-[9px] sm:text-[10px] tracking-widest bg-muted/5" onClick={handleAddProfile}>
            <PlusCircle className="mr-2 h-4 w-4 text-primary opacity-40" /> New Scenario
          </Button>
        )}
        <Button variant="ghost" size="sm" className="w-full h-9 rounded-xl font-black uppercase text-[8px] tracking-widest text-muted-foreground hover:text-destructive hover:bg-destructive/5" onClick={() => onResetToDefaults(activeTab)}>
          <RotateCcw className="w-3 h-3 mr-2" /> Reset to Defaults
        </Button>
      </CardFooter>
    </Card>
  );
};

const TmhrBreakdownCard = ({ lifestyleTotal, businessTotal, totalHours, firestore, selectedTenant, taxBurden, setTaxBurden, isEditing }: any) => {
  const { toast } = useToast();
  const tmhr = totalHours > 0 ? (lifestyleTotal + businessTotal) / totalHours : 0;

  return (
    <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
      <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
        <Sparkles className="w-32 h-32 text-primary" />
      </div>
      <CardHeader className="p-5 sm:p-8 pb-4 text-left">
        <CardTitle className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2"><Target className="w-3 h-3" /> Alpha Metric</CardTitle>
        <CardDescription className="text-[10px] sm:text-xs font-bold uppercase tracking-tight opacity-60 text-left">Strategic Studio Foundation</CardDescription>
      </CardHeader>
      <CardContent className="p-5 sm:p-8 pt-0 space-y-6 sm:space-y-8 text-left">
        <div className="text-center space-y-2">
          <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-primary/60">Minimum Yield / Hour</p>
          <p className="text-4xl sm:text-7xl font-black text-primary tracking-tighter font-mono leading-none">${tmhr.toFixed(2)}</p>
          {totalHours === 0 && <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">Set a schedule profile to calculate</p>}
        </div>
        <div className="p-5 rounded-[1.5rem] border-2 border-primary/10 bg-white/50 space-y-4 shadow-inner">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-[10px] font-black uppercase tracking-widest text-primary leading-none">Labor Tax Burden</Label>
              <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">FICA, SUI, Benefits</p>
            </div>
            <div className="relative w-20">
              <Input type="number" value={taxBurden || ''} onChange={(e) => setTaxBurden(parseFloat(e.target.value) || 0)} disabled={!isEditing} className="h-10 pr-6 rounded-xl border-2 font-black text-xs text-right bg-white shadow-sm" />
              <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground opacity-40" />
            </div>
          </div>
        </div>
        <div className="space-y-3 pt-4 border-t-2 border-dashed border-primary/10">
          <div className="flex justify-between text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
            <span>Personal Draw / Hr</span>
            <span className="font-mono text-slate-900">${(totalHours > 0 ? lifestyleTotal / totalHours : 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
            <span>OpEx Load / Hr</span>
            <span className="font-mono text-slate-900">${(totalHours > 0 ? businessTotal / totalHours : 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-primary">
            <span>Billable Hours / Mo</span>
            <span className="font-mono text-[10px] sm:text-xs">{totalHours.toFixed(1)}h</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-5 sm:p-8 pt-0">
        <Button
          className="w-full h-12 sm:h-14 rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-tight shadow-xl shadow-primary/20 active:scale-95"
          onClick={async () => {
            if (!selectedTenant || !firestore) return;
            try {
              await updateDocumentNonBlocking(
                doc(firestore, 'tenants', selectedTenant.id),
                { tmhr, employerTaxBurdenPct: taxBurden },
              );
              toast({ title: 'Studio standard updated', description: `TMHR set to $${tmhr.toFixed(2)}/hr` });
            } catch {
              toast({ variant: 'destructive', title: 'Failed to save — please try again' });
            }
          }}
        >
          Set Studio Standard
        </Button>
      </CardFooter>
    </Card>
  );
};

export default function FinancialFoundationPage() {
  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState('lifestyle');
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
  const [taxBurden, setTaxBurden] = useState(10);
  const { toast } = useToast();

  const lifestyleQ = useMemoFirebase(() => (tenantId ? collection(firestore, `tenants/${tenantId}/lifestyleProfiles`) : null), [firestore, tenantId]);
  const businessQ  = useMemoFirebase(() => (tenantId ? collection(firestore, `tenants/${tenantId}/businessProfiles`)  : null), [firestore, tenantId]);
  const scheduleQ  = useMemoFirebase(() => (tenantId ? query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where('isActive', '==', true)) : null), [firestore, tenantId]);

  const { data: lifestyleData, isLoading: lLoading } = useCollection(lifestyleQ);
  const { data: businessData,  isLoading: bLoading  } = useCollection(businessQ);
  const { data: scheduleData                         } = useCollection(scheduleQ);

  const [profiles, setProfiles] = useState<any>(() => ({
    lifestyleProfiles: [makeDefaultLifestyle()],
    businessProfiles:  [makeDefaultBusiness()],
    scheduleProfiles:  [],
  }));

  useEffect(() => { if (selectedTenant) setTaxBurden(selectedTenant.employerTaxBurdenPct || 10); }, [selectedTenant]);

  useEffect(() => {
    if (lLoading || bLoading) return;
    const firestoreLifestyle = ensureBillIds(lifestyleData || []);
    const firestoreBusiness  = ensureBillIds(businessData  || []);
    setProfiles((prev: any) => ({
      ...prev,
      lifestyleProfiles: hasValidData(firestoreLifestyle) ? firestoreLifestyle : prev.lifestyleProfiles,
      businessProfiles:  hasValidData(firestoreBusiness)  ? firestoreBusiness  : prev.businessProfiles,
      scheduleProfiles:  scheduleData || [],
    }));
  }, [lifestyleData, businessData, scheduleData, lLoading, bLoading]);

  const activeLifestyle = useMemo(() => profiles.lifestyleProfiles.find((p: any) => p.isActive), [profiles.lifestyleProfiles]);
  const activeBusiness  = useMemo(() => profiles.businessProfiles.find((p: any) => p.isActive),  [profiles.businessProfiles]);
  const activeSchedule  = useMemo(() => profiles.scheduleProfiles.find((p: any) => p.isActive),  [profiles.scheduleProfiles]);

  const handleBillChange = useCallback((type: 'lifestyle' | 'business', cat: string, billId: string, field: string, val: any) => {
    const key = `${type}Profiles`;
    setProfiles((prev: any) => ({ ...prev, [key]: prev[key].map((p: any) => p.isActive ? { ...p, categories: p.categories.map((c: any) => c.name === cat ? { ...c, bills: c.bills.map((b: any) => b.id === billId ? { ...b, [field]: val } : b) } : c) } : p) }));
  }, []);

  const handleAddBillItem = useCallback((type: 'lifestyle' | 'business', cat: string) => {
    const key = `${type}Profiles`;
    setProfiles((prev: any) => ({ ...prev, [key]: prev[key].map((p: any) => p.isActive ? { ...p, categories: p.categories.map((c: any) => c.name === cat ? { ...c, bills: [...(c.bills || []), { id: nanoid(), title: 'NEW ITEM', amount: 0, isCustom: true, dueDay: 1 }] } : c) } : p) }));
  }, []);

  const handleDeleteBillItem = useCallback((type: 'lifestyle' | 'business', cat: string, billId: string) => {
    const key = `${type}Profiles`;
    setProfiles((prev: any) => ({ ...prev, [key]: prev[key].map((p: any) => p.isActive ? { ...p, categories: p.categories.map((c: any) => c.name === cat ? { ...c, bills: c.bills.filter((b: any) => b.id !== billId) } : c) } : p) }));
  }, []);

  const handleResetToDefaults = useCallback((tab: string) => {
    if (!window.confirm(`Reset ${tab} profile to defaults? Your current amounts will be cleared.`)) return;
    const key = `${tab}Profiles`;
    const fresh = tab === 'lifestyle' ? makeDefaultLifestyle() : makeDefaultBusiness();
    setProfiles((prev: any) => ({ ...prev, [key]: [fresh] }));
    toast({ title: `${tab === 'lifestyle' ? 'Lifestyle' : 'Business'} profile reset to defaults` });
  }, [toast]);

  const totalBillableHours = useMemo(() => {
    if (!activeSchedule) return 0;
    const toMin = (t: string) => {
      if (!t) return 0;
      const [time, p] = t.split(' ');
      let [h, m] = time.split(':').map(Number);
      if (p === 'PM' && h < 12) h += 12;
      if (p === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };
    const weekMin     = (Object.values(activeSchedule.week || {}) as any[]).reduce((a, d) => d.enabled ? a + toMin(d.end) - toMin(d.start) : a, 0);
    const enabledDays = (Object.values(activeSchedule.week || {}) as any[]).filter(d => d.enabled).length;
    const daysOff     = (activeSchedule.timeOff?.vacationDays || 0) + (activeSchedule.timeOff?.holidays || 0);
    const pct         = enabledDays > 0 ? ((52 * enabledDays) - daysOff) / (52 * enabledDays) : 0;
    return ((weekMin / 60) * 52 / 12) * pct;
  }, [activeSchedule]);

  const handleSave = async () => {
    if (!firestore || !tenantId) { setIsEditing(false); return; }
    const allWrites: Promise<any>[] = [];
    ['lifestyleProfiles', 'businessProfiles'].forEach((key) => {
      (profiles[key] as any[]).forEach((p: any) => {
        allWrites.push(setDoc(doc(firestore, `tenants/${tenantId}/${key}/${p.id}`), p));
      });
    });
    allWrites.push(setDoc(doc(firestore, 'tenants', tenantId), { employerTaxBurdenPct: taxBurden }, { merge: true }));
    try {
      await Promise.all(allWrites);
      toast({ title: 'Foundation saved ✓' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Save failed — please try again' });
    }
    setIsEditing(false);
  };

  const lifestyleTotal = useMemo(() => (activeLifestyle?.categories || []).reduce((a: number, c: any) => a + (c.bills || []).reduce((b: number, bill: any) => b + (bill.amount || 0), 0), 0), [activeLifestyle]);
  const businessTotal  = useMemo(() => (activeBusiness?.categories  || []).reduce((a: number, c: any) => a + (c.bills || []).reduce((b: number, bill: any) => b + (bill.amount || 0), 0), 0), [activeBusiness]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Foundation Analysis" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-8 md:space-y-10">

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 text-left">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Yield Architecture</h1>
            <p className="text-[10px] sm:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">TMHR Calculation &amp; Core Economics</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            {isEditing ? (
              <>
                <Button variant="ghost" onClick={() => setIsEditing(false)} className="flex-1 sm:w-auto h-12 sm:h-14 font-black uppercase text-[9px] sm:text-[10px] tracking-widest text-slate-400">Cancel</Button>
                <Button onClick={handleSave} className="flex-[2] sm:w-auto h-12 sm:h-14 px-6 sm:px-8 rounded-2xl shadow-xl font-black uppercase text-[9px] sm:text-[10px] tracking-widest shadow-primary/20"><Save className="mr-2 h-4 w-4" /> Save</Button>
              </>
            ) : (
              <Button onClick={() => setIsEditing(true)} className="w-full sm:w-auto h-12 sm:h-14 px-6 sm:px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[9px] sm:text-[10px] shadow-primary/20"><Pencil className="mr-2 h-4 w-4" /> Edit Profiles</Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="lifestyle" className="w-full" onValueChange={setActiveTab}>
          <div className="flex flex-col space-y-6 sm:space-y-8">
            <div className="w-full overflow-x-auto pb-2">
              <TabsList className="inline-flex bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner gap-1.5">
                <TabsTrigger value="lifestyle" className="px-4 sm:px-8 h-10 sm:h-11 rounded-xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">1. Lifestyle Target</TabsTrigger>
                <TabsTrigger value="business"  className="px-4 sm:px-8 h-10 sm:h-11 rounded-xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">2. Studio Overhead</TabsTrigger>
              </TabsList>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-10 items-start">
              <div className="lg:col-span-1 space-y-6 sm:space-y-8">
                <FinancialProfileManager
                  activeTab={activeTab} profiles={profiles} setProfiles={setProfiles} isEditing={isEditing}
                  renamingProfileId={renamingProfileId} setRenamingProfileId={setRenamingProfileId}
                  onResetToDefaults={handleResetToDefaults}
                  onDeleteProfile={(id: string) => {
                    if (!tenantId) return;
                    deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/${activeTab}Profiles/${id}`));
                    setProfiles((prev: any) => {
                      const key = `${activeTab}Profiles`;
                      const remaining = prev[key].filter((p: any) => p.id !== id);
                      if (remaining.length === 0) return prev;
                      const hasActive = remaining.some((p: any) => p.isActive);
                      return { ...prev, [key]: hasActive ? remaining : remaining.map((p: any, i: number) => ({ ...p, isActive: i === 0 })) };
                    });
                  }}
                />
                <TmhrBreakdownCard
                  lifestyleTotal={lifestyleTotal} businessTotal={businessTotal} totalHours={totalBillableHours}
                  firestore={firestore} selectedTenant={selectedTenant}
                  taxBurden={taxBurden} setTaxBurden={setTaxBurden} isEditing={isEditing}
                />
              </div>
              <div className="lg:col-span-2 xl:col-span-3">
                <TabsContent value="lifestyle" className="m-0 animate-in fade-in duration-300">
                  <BillEditor categories={activeLifestyle?.categories || []} isEditing={isEditing} onBillChange={(cat, bid, field, val) => handleBillChange('lifestyle', cat, bid, field, val)} onAddBillItem={(cat) => handleAddBillItem('lifestyle', cat)} onDeleteBillItem={(cat, bid) => handleDeleteBillItem('lifestyle', cat, bid)} />
                </TabsContent>
                <TabsContent value="business" className="m-0 animate-in fade-in duration-300">
                  <BillEditor categories={activeBusiness?.categories || []} isEditing={isEditing} onBillChange={(cat, bid, field, val) => handleBillChange('business', cat, bid, field, val)} onAddBillItem={(cat) => handleAddBillItem('business', cat)} onDeleteBillItem={(cat, bid) => handleDeleteBillItem('business', cat, bid)} />
                </TabsContent>
              </div>
            </div>
          </div>
        </Tabs>
      </main>
    </div>
  );
}
