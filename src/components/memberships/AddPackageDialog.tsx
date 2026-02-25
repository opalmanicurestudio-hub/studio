
'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useIsMobile } from '@/hooks/use-mobile';
import { type Package, type Service } from '@/lib/data';
import { Repeat } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';

interface AddPackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (pack: Package) => void;
  packageToEdit: Package | null;
}

const ProfitabilityAnalysis = ({ service, sessions, price }: { service: Service | undefined, sessions: number, price: number }) => {
    const totalCostOfPerks = useMemo(() => {
        if (!service) return 0;
        return service.cost * sessions;
    }, [service, sessions]);

    const netProfit = price - totalCostOfPerks;
    const profitMargin = price > 0 ? (netProfit / price) * 100 : 0;
    
    return (
        <Card>
            <CardHeader>
                <CardTitle>Profitability Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Package Price</span>
                    <span>${price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Cost of Services</span>
                    <span className="text-destructive">-${totalCostOfPerks.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold border-t pt-2 mt-2">
                    <span>Net Profit</span>
                    <span className={netProfit >= 0 ? 'text-primary' : 'text-destructive'}>${netProfit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Profit Margin</span>
                    <span>{profitMargin.toFixed(1)}%</span>
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
  const [expiresIn, setExpiresIn] = useState<number>(6); // Default 6 months
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
      // Reset form for new package
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
      id: packageToEdit?.id || `pkg-${Date.now()}`,
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
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Core Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="pkg-name">Package Name</Label>
                <Input id="pkg-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Package of 5 Blowouts" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-service">Primary Service</Label>
              <Select value={primaryServiceId} onValueChange={setPrimaryServiceId}>
                <SelectTrigger id="pkg-service"><SelectValue placeholder="Select a service" /></SelectTrigger>
                <SelectContent>
                    {services.filter(s => s.type === 'service').map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="pkg-sessions">Number of Sessions</Label>
                    <Input id="pkg-sessions" type="number" value={sessions} onChange={e => setSessions(Number(e.target.value))} placeholder="e.g., 6" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="pkg-price">Total Package Price</Label>
                    <Input id="pkg-price" type="number" value={price} onChange={e => setPrice(Number(e.target.value))} placeholder="e.g., 300.00" />
                </div>
            </div>
             <div className="space-y-2">
                <Label htmlFor="pkg-expires">Expires In (Months)</Label>
                <Input id="pkg-expires" type="number" value={expiresIn} onChange={e => setExpiresIn(Number(e.target.value))} placeholder="e.g., 12" />
            </div>
             <div className="flex items-center justify-between pt-2">
                <Label htmlFor="pkg-private">Private Package</Label>
                <Switch id="pkg-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
            </div>
        </CardContent>
      </Card>
      
      <ProfitabilityAnalysis service={primaryService} sessions={sessions} price={price} />
    </div>
  );

  const dialogTitle = packageToEdit ? `Edit: ${packageToEdit.name}` : 'Create New Package';

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col">
          <SheetHeader className="text-left">
            <SheetTitle>{dialogTitle}</SheetTitle>
            <SheetDescription>Define the details for this prepaid service package.</SheetDescription>
          </SheetHeader>
          <div className="py-4 flex-1 overflow-y-auto">{FormContent}</div>
          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} className="w-full">Save Package</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>Define the details for this prepaid service package.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] -mr-6 pr-6">
            <div className="py-4 pl-6">
                {FormContent}
            </div>
        </ScrollArea>
        <DialogFooter className="pt-4 border-t pr-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save Package</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
