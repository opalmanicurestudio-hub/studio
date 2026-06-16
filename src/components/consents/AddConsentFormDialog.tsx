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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle, FileSignature, Sparkles, ShieldCheck, ArrowRight, Activity, Tag, ListChecks, Check } from 'lucide-react';
import { FieldEditor } from './FieldEditor';
import { Switch } from '../ui/switch';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { nanoid } from 'nanoid';
import { ConsentForm, FormField } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';

interface AddConsentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (form: Partial<ConsentForm>) => void;
  formToEdit: ConsentForm | null;
  existingCategories: string[];
}

const SectionHeader = ({ icon: Icon, title }: { icon: any, title: string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module Entry</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

export const AddConsentFormDialog: React.FC<AddConsentFormDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  formToEdit,
  existingCategories
}) => {
  const isMobile = useIsMobile();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('General');
  const [fields, setFields] = useState<FormField[]>([]);
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);
  const [clientAccess, setClientAccess] = useState('view');
  const [notifyOnEdit, setNotifyOnEdit] = useState(false);
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  useEffect(() => {
    if (formToEdit) {
      setTitle(formToEdit.title);
      setCategory(formToEdit.category);
      setFields(formToEdit.fields || []);
      setIsPasswordProtected(formToEdit.isPasswordProtected);
      setNotifyOnEdit(formToEdit.notifyOnEdit);
      setRequiresSignature(formToEdit.requiresSignature || false);
    } else {
      setTitle('');
      setCategory('General');
      setFields([]);
      setIsPasswordProtected(false);
      setClientAccess('view');
      setNotifyOnEdit(false);
      setRequiresSignature(false);
    }
  }, [formToEdit, open]);

  const handleAddField = () => {
    const newField: FormField = {
      id: nanoid(),
      type: 'short-text',
      label: '',
    };
    setFields([...fields, newField]);
  };

  const handleUpdateField = (id: string, updatedField: FormField) => {
    setFields(fields.map(f => f.id === id ? updatedField : f));
  };

  const handleRemoveField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
  };

  const handleMoveField = (id: string, direction: 'up' | 'down') => {
    const index = fields.findIndex(f => f.id === id);
    if (index === -1) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= fields.length) return;
    const newFields = [...fields];
    const [movedField] = newFields.splice(index, 1);
    newFields.splice(newIndex, 0, movedField);
    setFields(newFields);
  };

  const handleAddNewCategory = () => {
    if (newCategoryName.trim()) {
      setCategory(newCategoryName.trim());
      setNewCategoryName('');
      setIsAddingCategory(false);
    }
  };

  const handleSave = () => {
    if (!title.trim()) return;
    const formData: Partial<ConsentForm> = {
      title,
      category: category as any,
      fields,
      isPasswordProtected,
      notifyOnEdit,
      requiresSignature,
    };
    onSave(formData);
    onOpenChange(false);
  };

  const FormContent = (
    <div className="space-y-12 py-4">
        <div className="space-y-8">
            <SectionHeader icon={Tag} title="Protocol Identity" />
            <div className="space-y-6 text-left">
                <div className="space-y-2">
                    <Label htmlFor="form-title" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Document Label</Label>
                    <Input id="form-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., NEW CLIENT INTAKE" className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="form-category" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Classification</Label>
                    {isAddingCategory ? (
                        <div className="flex gap-2 animate-in slide-in-from-top-2">
                            <Input placeholder="NEW CLASSIFICATION..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddNewCategory()} className="h-12 rounded-xl border-2 font-black uppercase text-xs" />
                            <Button onClick={handleAddNewCategory} type="button" className="h-12 w-12 rounded-xl shadow-lg"><Check className="h-5 w-5" /></Button>
                            <Button variant="ghost" onClick={() => setIsAddingCategory(false)} type="button" className="h-12 rounded-xl text-slate-400 font-bold uppercase text-[10px]">Cancel</Button>
                        </div>
                    ) : (
                        <div className="flex gap-3">
                            <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                                <SelectTrigger id="form-category" className="h-14 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest shadow-inner bg-muted/5 flex-1">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {existingCategories.map(cat => (
                                        <SelectItem key={cat} value={cat} className="font-bold uppercase text-[10px] tracking-widest">{cat.toUpperCase()}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button variant="outline" size="icon" onClick={() => setIsAddingCategory(true)} type="button" className="h-14 w-14 rounded-2xl border-2 shrink-0 bg-white/50 shadow-sm">
                                <PlusCircle className="h-6 w-6 opacity-40" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>

        <Separator className="border-dashed" />

        <div className="space-y-8">
            <SectionHeader icon={ListChecks} title="Input Architecture" />
            <div className="space-y-4">
                {fields.length > 0 ? (
                    <div className="grid gap-4">
                        {fields.map((field, index) => (
                            <FieldEditor
                                key={field.id}
                                field={field}
                                onUpdate={handleUpdateField}
                                onDelete={handleRemoveField}
                                onMove={handleMoveField}
                                isFirst={index === 0}
                                isLast={index === fields.length - 1}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="p-16 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                        <Activity className="w-12 h-12" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Awaiting Question Sequence</p>
                    </div>
                )}
                <Button variant="outline" className="w-full h-14 rounded-2xl border-2 border-dashed font-black uppercase text-[10px] tracking-[0.2em] shadow-inner bg-muted/5 mt-4" onClick={handleAddField}>
                    <PlusCircle className="mr-2 h-4 w-4 text-primary opacity-40" /> Add Protocol Question
                </Button>
            </div>
        </div>

        <Separator className="border-dashed" />

        <div className="space-y-8">
            <SectionHeader icon={ShieldCheck} title="Governance & Security" />
            <div className="space-y-4 text-left">

                {/* ── Require signature at POS checkout ── */}
                <div className={cn(
                  "flex items-center justify-between p-6 rounded-[2rem] border-2 transition-all",
                  requiresSignature ? "border-primary/30 bg-primary/5" : "bg-muted/5 border-border"
                )}>
                    <div className="space-y-1">
                        <Label htmlFor="requires-signature" className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                            <FileSignature className="w-4 h-4 text-primary" />
                            Require at Checkout
                        </Label>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                            Client must sign this form before every checkout
                        </p>
                        {requiresSignature && (
                            <p className="text-[10px] font-black text-primary uppercase tracking-widest mt-1">
                                Active — will interrupt POS after payment
                            </p>
                        )}
                    </div>
                    <Switch
                        id="requires-signature"
                        checked={requiresSignature}
                        onCheckedChange={setRequiresSignature}
                        className="scale-125"
                    />
                </div>

                <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 bg-muted/5 shadow-inner">
                    <div className="space-y-1">
                        <Label htmlFor="password-protect" className="text-base font-black uppercase tracking-tight">Access Control</Label>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Require verification before viewing</p>
                    </div>
                    <Switch id="password-protect" checked={isPasswordProtected} onCheckedChange={setIsPasswordProtected} className="scale-125" />
                </div>

                <div className="flex items-center justify-between p-6 rounded-[2rem] border-2 bg-muted/5 shadow-inner">
                    <div className="space-y-1">
                        <Label htmlFor="notify-on-edit" className="text-base font-black uppercase tracking-tight">Audit Notifications</Label>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Alert me upon guest modification</p>
                    </div>
                    <Switch id="notify-on-edit" checked={notifyOnEdit} onCheckedChange={setNotifyOnEdit} className="scale-125" />
                </div>

                <div className="space-y-3 p-6 rounded-[2rem] border-2 bg-muted/5 shadow-inner">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Client Authority</Label>
                    <RadioGroup value={clientAccess} onValueChange={setClientAccess} className="grid grid-cols-2 gap-3 mt-2">
                        <label htmlFor="view-acc" className="cursor-pointer">
                            <div className={cn(
                                "flex items-center justify-center p-4 rounded-xl border-2 transition-all",
                                clientAccess === 'view' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-white"
                            )}>
                                <span className="text-[10px] font-black uppercase tracking-widest">View Only</span>
                                <RadioGroupItem value="view" id="view-acc" className="sr-only" />
                            </div>
                        </label>
                        <label htmlFor="edit-acc" className="cursor-pointer">
                            <div className={cn(
                                "flex items-center justify-center p-4 rounded-xl border-2 transition-all",
                                clientAccess === 'edit' ? "border-primary bg-primary/5 shadow-md" : "border-border bg-white"
                            )}>
                                <span className="text-[10px] font-black uppercase tracking-widest">Edit Permitted</span>
                                <RadioGroupItem value="edit" id="edit-acc" className="sr-only" />
                            </div>
                        </label>
                    </RadioGroup>
                </div>
            </div>
        </div>
    </div>
  );

  const dialogTitle = formToEdit ? 'Refine Protocol' : 'Initialize Agreement';
  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <ContentComponent
        side={isMobile ? "bottom" : undefined}
        className={cn(
          "p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden",
          isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-2xl max-h-[90dvh]"
        )}
      >
        <DialogHeader className="flex-shrink-0 text-left border-b bg-muted/5 p-8 pb-6">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Strategic Intake</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{dialogTitle}</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Build and configure your digital signature protocol.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-8 pb-32">
            {FormContent}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 border-t bg-background shadow-2xl p-6 sm:p-8">
          <div className="flex w-full gap-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="flex-1 h-12 md:h-14 font-black uppercase tracking-widest text-[11px] text-slate-500">Cancel</Button>
            <Button onClick={handleSave} className="flex-[2] h-12 md:h-14 rounded-[2rem] font-black uppercase tracking-widest text-[11px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">
              Establish Protocol <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        </DialogFooter>
      </ContentComponent>
    </DialogContainer>
  );
};
