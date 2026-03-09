'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { type Package, type Service } from '@/lib/data';
import { Repeat, Sparkles, DollarSign, Clock, ListChecks, Target, Info, ArrowRight, Activity, ShieldCheck, Check } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { nanoid } from 'nanoid';

interface AddPackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (pack: Package) => void;
  packageToEdit: Package | null;
}

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const ProfitabilityAnalysis = ({ service, sessions, price }: { service: Service | undefined, sessions: number, price: number }) => {
    const totalCostOfPerks = useMemo(() => {
        if (!service) return 0;
        return (service.cost || 0) * sessions;
    }, [service, sessions]);

    const netProfit = price - totalCostOfPerks;
    const profitMargin = price > 0 ? (netProfit / price) * 100 : 0;
    
    return (
        <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden">
            <CardHeader className="p-8 pb-4">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                    <Target className="w-3 h-3" />
                    Yield Engine
                </CardTitle>
            </CardHeader>
            <CardContent className="p-8 pt-0 space-y-6">
                <div className="p-6 rounded-[2rem] bg-white border-2 border-primary/10 shadow-inner space-y-4">
                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                        <span>Package Revenue</span>
                        <span className="font-mono text-slate-900">${price.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-destructive opacity-60">
                        <span>Est. Service Liability</span>
                        <span className="font-mono text-destructive">-${totalCostOfPerks.toFixed(2)}</span>
                    </div>
                    <Separator className="border-dashed" />
                    <div className="flex justify-between items-baseline pt-2">
                        <div className="flex flex-col text-left">
                            <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Net Project Yield</span>
                            <span className={cn("text-3xl font-black tracking-tighter font-mono leading-none", netProfit >= 0 ? "text-primary" : "text-destructive")}>
                                ${netProfit.toFixed(2)}
                            </span>
                        </div>
                        <Badge className={cn("text-white border-none font-black text-xs font-mono", netProfit >= 0 ? "bg-primary" : "bg-destructive")}>
                            {profitMargin.toFixed(1)}%
                        </Badge>
                    </div>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed bg-muted/10">
                    <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-40" />
                    <p className="text-[9px] font-bold uppercase text-muted-foreground leading-relaxed tracking-tight text-left">
                        Analysis based on {sessions}x individual session costs recorded in your library.
                    </p>
                </div>
            </CardContent>
        </Card>
    )
};

export const AddPackageDialog: React.FC<AddPackageDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  packageToEdit,
}) => {
  const isMobile = useIsMobile();
  const { services } = useInventory();
  
  const [name, setName] = useState('');
  const [primaryServiceId, setPrimaryServiceId] = useState<string>('');
  const [sessions, setSessions] = useState<number>(5);
  const [price, setPrice] = useState<number>(0);
  const [expiresIn, setExpiresIn] = useState<number>(6);
  const [isPrivate, setIsPrivate] = useState(false);
  
  const primaryService = useMemo(() => services.find(s => s.id === primaryServiceId), [primaryServiceId, services]);

  useEffect(() => {
    if (packageToEdit) {
      setName(packageToEdit.name);
      setPrimaryServiceId(packageToEdit.serviceId);
      setSessions(packageToEdit.sessions);
      setPrice(packageToEdit.price);
      setExpiresIn(packageToEdit.expiresInMonths);
      setIsPrivate(packageToEdit.isPrivate);
    } else {
      setName('');
      setPrimaryServiceId('');
      setSessions(5);
      setPrice(0);
      setExpiresIn(6);
      setIsPrivate(false);
    }
  }, [packageToEdit, open]);

  const handleSave = () => {
    const packageData: Package = {
      id: packageToEdit?.id || `pkg-${nanoid()}`,
      name,
      serviceId: primaryServiceId,
      sessions,
      price,
      expiresInMonths: expiresIn,
      isPrivate,
    };
    onSave(packageData);
    onOpenChange(false);
  };
  
  const FormContent = (
    <div className="space-y-12">
      <div className="space-y-10">
        <SectionHeader icon={Repeat} title="Bundle Identity" step={1} />
        <div className="space-y-6 text-left">
            <div className="space-y-2">
                <Label htmlFor="pkg-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Package Label</Label>
                <Input id="pkg-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., SIGNATURE BLOWOUT 5-PACK" className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-service" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Target Treatment</Label>
              <Select value={primaryServiceId} onValueChange={setPrimaryServiceId}>
                <SelectTrigger id="pkg-service" className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5">
                    <SelectValue placeholder="SELECT FROM MENU..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                    {services.filter(s => s.type === 'service').map(s => (
                        <SelectItem key={s.id} value={s.id} className="font-bold uppercase text-[10px] tracking-widest">{s.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="pkg-sessions" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Session Count</Label>
                    <div className="relative">
                        <Activity className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                        <Input id="pkg-sessions" type="number" value={sessions || ''} onChange={e => setSessions(Number(e.target.value))} placeholder="0" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono shadow-inner bg-muted/5 text-center" />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="pkg-price" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Total Bundle Value</Label>
                    <div className="relative">
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                        <Input id="pkg-price" type="number" value={price || ''} onChange={e => setPrice(Number(e.target.value))} placeholder="0.00" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono shadow-inner bg-muted/5 text-primary" />
                    </div>
                </div>
            </div>
             <div className="space-y-2">
                <Label htmlFor="pkg-expires" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Retention Window (Months)</Label>
                <div className="relative">
                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                    <Input id="pkg-expires" type="number" value={expiresIn || ''} onChange={e => setExpiresIn(Number(e.target.value))} placeholder="6" className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono shadow-inner bg-muted/5" />
                </div>
            </div>
             <div className="flex items-center justify-between p-6 border-2 border-dashed rounded-[2rem] bg-muted/5 mt-4 shadow-inner">
                <div className="space-y-1">
                    <Label htmlFor="pkg-private" className="text-lg font-black uppercase tracking-tight">Private Bundle</Label>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Hide from the public booking directory</p>
                </div>
                <Switch id="pkg-private" checked={isPrivate} onCheckedChange={setIsPrivate} className="scale-125" />
            </div>
        </div>
      </div>
      
      <ProfitabilityAnalysis service={primaryService} sessions={sessions} price={price} />
    </div>
  );

  const dialogTitle = packageToEdit ? 'Refine Protocol' : 'Register New Bundle';
  const dialogDescription = packageToEdit ? `Refining ID: ${packageToEdit.id.slice(-6).toUpperCase()}` : 'Define the details for this prepaid service package.';

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-4xl max-h-[90dvh]")}>
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
            <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Intake</span>
            </div>
            <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{dialogTitle}</DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{dialogDescription}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                {FormContent}
            </div>
        </ScrollArea>
        <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-8 pt-4")}>
            <div className="grid grid-cols-2 gap-3 w-full">
                <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                <Button onClick={handleSave} className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Establish Bundle <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
            </div>
        </DialogFooter>
      </ContentComponent>
    </DialogContainer>
  );
};
