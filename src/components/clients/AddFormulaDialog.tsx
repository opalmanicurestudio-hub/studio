'use client';

import React, { useState, useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, FlaskConical, Sparkles, Tag, ArrowRight, Activity, Landmark, PackageOpen, MessageSquare, Edit } from 'lucide-react';
import { type CustomFormula, type InventoryItem } from '@/lib/data';
import { useInventory } from '@/context/InventoryContext';
import { BrowseProductsDialog } from '../services/BrowseProductsDialog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '../ui/card';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';

type EditableFormulaItem = {
    id: string; // productId
    name: string;
    quantity: number;
    unit: string;
    costPerUnit: number;
    note?: string;
};

interface AddFormulaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (formula: CustomFormula) => void;
  clientName: string;
  formulaToEdit?: CustomFormula | null;
}

const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Technical Module</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

export const AddFormulaDialog: React.FC<AddFormulaDialogProps> = ({ open, onOpenChange, onSave, clientName, formulaToEdit }) => {
  const isMobile = useIsMobile();
  const { inventory } = useInventory();
  const { toast } = useToast();

  const [formulaName, setFormulaName] = useState('');
  const [items, setItems] = useState<EditableFormulaItem[]>([]);
  const [notes, setNotes] = useState('');
  const [isProductBrowserOpen, setIsProductBrowserOpen] = useState(false);

  useEffect(() => {
    if (open) {
      if (formulaToEdit) {
        setFormulaName(formulaToEdit.name);
        setItems(formulaToEdit.items || []);
        setNotes(formulaToEdit.notes || '');
      } else {
        setFormulaName('');
        setItems([]);
        setNotes('');
      }
    }
  }, [open, formulaToEdit]);

  const handleAddProducts = (products: InventoryItem[]) => {
    const newItems: EditableFormulaItem[] = products.map(p => {
        let unit = p.costingMethod === 'size' ? (p.unit || 'ml') : (p.useUnit || 'uses');
        
        let cpu = p.costPerUnit || 0;
        if (p.costingMethod === 'size' && p.size) cpu = (p.costPerUnit || 0) / p.size;
        else if (p.costingMethod === 'uses' && p.estimatedUses) cpu = (p.costPerUnit || 0) / p.estimatedUses;

        return {
            id: p.id,
            name: p.name,
            quantity: 1,
            unit: unit,
            costPerUnit: cpu,
            note: ''
        }
    });
    
    setItems(prev => {
        const existingIds = new Set(prev.map(item => item.id));
        const filteredNewItems = newItems.filter(newItem => !existingIds.has(newItem.id));
        return [...prev, ...filteredNewItems];
    });

    setIsProductBrowserOpen(false);
  };

  const handleItemChange = (productId: string, field: keyof EditableFormulaItem, value: any) => {
    setItems(prev =>
      prev.map(item =>
        item.id === productId ? { ...item, [field]: value } : item
      )
    );
  };
  
  const handleRemoveItem = (productId: string) => {
    setItems(prev => prev.filter(item => item.id !== productId));
  };
  
  const handleSaveClick = () => {
    if (!formulaName.trim()) {
      toast({ variant: 'destructive', title: 'Identity Required', description: 'Please provide a name for this formula protocol.' });
      return;
    }
    if (items.length === 0) {
      toast({ variant: 'destructive', title: 'Manifest Empty', description: 'Please append at least one professional asset.' });
      return;
    }

    const newFormula: CustomFormula = {
      id: formulaToEdit?.id || `man-f-${Date.now()}`,
      name: formulaName.toUpperCase(),
      date: formulaToEdit?.date || new Date().toISOString(),
      items: items,
      notes: notes
    };
    onSave(newFormula);
  };

  const title = formulaToEdit ? "Refine Protocol" : "Establish Formula";
  const description = formulaToEdit ? `Modifying technical recipe for ${clientName}.` : `Registering a new technical recipe for ${clientName}.`;

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-2xl max-h-[90dvh]")}>
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-8 pb-6" : "p-10 pb-6")}>
            <div className="flex items-center gap-3 mb-2 text-left">
                {formulaToEdit ? <Edit className="w-5 h-5 text-primary" /> : <Sparkles className="w-5 h-5 text-primary" />}
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Intake</span>
            </div>
            <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none text-left">{title}</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1 text-left">{description}</DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1">
            <div className={cn("p-8 space-y-12", isMobile && "p-6")}>
                <div className="space-y-8">
                    <SectionHeader icon={Tag} title="Protocol Identity" />
                    <div className="space-y-3 text-left">
                        <Label htmlFor="formula-name-manual" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 text-left">Formula Label</Label>
                        <Input
                            id="formula-name-manual"
                            placeholder="e.g., WINTER GLOSS PRO"
                            value={formulaName}
                            onChange={e => setFormulaName(e.target.value)}
                            className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner"
                        />
                    </div>
                </div>

                <Separator className="border-dashed" />

                <div className="space-y-8">
                    <div className="flex items-center justify-between px-1 text-left">
                        <SectionHeader icon={FlaskConical} title="Composition Matrix" />
                        <Button variant="ghost" size="sm" onClick={() => setIsProductBrowserOpen(true)} type="button" className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                            <PlusCircle className="w-3 h-3 mr-1.5" /> Append Inventory
                        </Button>
                    </div>
                    
                    <div className="space-y-3">
                        {items.length > 0 ? (
                            <div className="grid gap-4">
                                {items.map(item => (
                                    <div key={item.id} className="p-5 rounded-2xl border-2 bg-white shadow-sm space-y-4 transition-all hover:border-primary/20 group">
                                        <div className="flex items-center justify-between gap-4">
                                            <span className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate flex-1 text-left">{item.name}</span>
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-2">
                                                    <Label className="text-[8px] font-black uppercase text-muted-foreground opacity-40">Load</Label>
                                                    <Input 
                                                        type="number" 
                                                        value={item.quantity} 
                                                        onChange={(e) => handleItemChange(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                                                        className="w-16 h-9 rounded-lg border-2 text-center font-black font-mono text-xs" 
                                                        step="0.1" 
                                                    />
                                                    <span className="text-[9px] font-black uppercase text-muted-foreground w-8 opacity-60 text-left truncate">{item.unit}</span>
                                                </div>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveItem(item.id)}><Trash2 className="w-4 h-4" /></Button>
                                            </div>
                                        </div>
                                        <div className="relative">
                                            <MessageSquare className="absolute left-3 top-3 w-3 h-3 text-primary opacity-20" />
                                            <Input 
                                                placeholder="SPECIFIC ITEM NOTE (E.G. ROOTS ONLY)" 
                                                value={item.note || ''} 
                                                onChange={e => handleItemChange(item.id, 'note', e.target.value)}
                                                className="h-9 pl-8 rounded-lg border-2 bg-muted/5 font-bold uppercase text-[9px] tracking-tight focus-visible:ring-primary/20"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-16 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                                <Activity className="w-12 h-12" />
                                <p className="text-[10px] font-black uppercase tracking-widest">Awaiting Recipe Components</p>
                            </div>
                        )}
                    </div>
                </div>

                <Separator className="border-dashed" />

                <div className="space-y-8">
                    <SectionHeader icon={Landmark} title="Procedural Context" />
                    <div className="space-y-3 text-left">
                        <Label htmlFor="formula-notes-manual" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 text-left">Technical Notes (General)</Label>
                        <Textarea 
                            id="formula-notes-manual" 
                            placeholder="Overall application instructions or mixing details..." 
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            className="rounded-[2rem] border-2 bg-muted/5 min-h-[120px] focus-visible:ring-primary/20 font-medium p-6"
                        />
                    </div>
                </div>
            </div>
        </ScrollArea>

        <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl p-6 sm:p-10 pt-4")}>
            <div className="grid grid-cols-2 gap-3 w-full">
                <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="h-14 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                <Button onClick={handleSaveClick} className="h-14 rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-2xl shadow-primary/30 active:scale-95 transition-all group">
                    {formulaToEdit ? 'Save Protocol' : 'Archive Formula'} <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/>
                </Button>
            </div>
        </DialogFooter>

        <BrowseProductsDialog
            open={isProductBrowserOpen}
            onOpenChange={setIsProductBrowserOpen}
            onSelect={handleAddProducts}
            allProducts={inventory.filter(p => p.type === 'professional')}
            initialSelected={[]}
        />
      </ContentComponent>
    </DialogContainer>
  );
};
