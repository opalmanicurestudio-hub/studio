
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
import { PlusCircle } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { FieldEditor, type FormField } from './FieldEditor';
import { Switch } from '../ui/switch';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { nanoid } from 'nanoid';

type ConsentForm = {
  id: string;
  title: string;
  category: 'Intake' | 'Waiver' | 'Release' | 'General';
  clientsSigned: number;
  totalClients: number;
  isPasswordProtected: boolean;
  notifyOnEdit: boolean;
  fields?: FormField[];
};


interface AddConsentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (form: Partial<ConsentForm>) => void;
  formToEdit: ConsentForm | null;
}

export const AddConsentFormDialog: React.FC<AddConsentFormDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  formToEdit,
}) => {
  const isMobile = useIsMobile();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<'Intake' | 'Waiver' | 'Release' | 'General'>('General');
  const [fields, setFields] = useState<FormField[]>([]);
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);
  const [clientAccess, setClientAccess] = useState('view');
  const [notifyOnEdit, setNotifyOnEdit] = useState(false);

  useEffect(() => {
    if (formToEdit) {
      setTitle(formToEdit.title);
      setCategory(formToEdit.category);
      setFields(formToEdit.fields || []);
      setIsPasswordProtected(formToEdit.isPasswordProtected);
      setNotifyOnEdit(formToEdit.notifyOnEdit);
      // setClientAccess would be set here if the property existed
    } else {
      // Reset to default for new form
      setTitle('');
      setCategory('General');
      setFields([]);
      setIsPasswordProtected(false);
      setClientAccess('view');
      setNotifyOnEdit(false);
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
  }

  const handleRemoveField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
  }

  const handleMoveField = (id: string, direction: 'up' | 'down') => {
    const index = fields.findIndex(f => f.id === id);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= fields.length) return;

    const newFields = [...fields];
    const [movedField] = newFields.splice(index, 1);
    newFields.splice(newIndex, 0, movedField);
    setFields(newFields);
  }

  const handleSave = () => {
    const formData = {
        title,
        category,
        fields,
        isPasswordProtected,
        notifyOnEdit,
    }
    onSave(formData);
    onOpenChange(false);
  }

  const FormContent = (
    <ScrollArea className="h-[70vh] pr-4">
        <div className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor="form-title">Form Title</Label>
                <Input id="form-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., New Client Intake Form" />
            </div>
             <div className="space-y-2">
                <Label htmlFor="form-category">Category</Label>
                <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                    <SelectTrigger id="form-category">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="General">General</SelectItem>
                        <SelectItem value="Intake">Intake</SelectItem>
                        <SelectItem value="Waiver">Waiver</SelectItem>
                        <SelectItem value="Release">Release</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            
            <div className="space-y-4">
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
                <Button variant="outline" className="w-full border-dashed" onClick={handleAddField}>
                    <PlusCircle className="mr-2" /> Add Question
                </Button>
            </div>
            
             <div className="space-y-4 pt-6">
                <h3 className="font-semibold text-lg">Form Rules & Security</h3>
                <div className="space-y-4 rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="password-protect">Password Protect</Label>
                        <Switch id="password-protect" checked={isPasswordProtected} onCheckedChange={setIsPasswordProtected} />
                    </div>
                     <div className="space-y-2">
                        <Label>Client Access Level</Label>
                         <RadioGroup defaultValue="view" value={clientAccess} onValueChange={setClientAccess} className="grid grid-cols-2 gap-2">
                            <div>
                                <RadioGroupItem value="view" id="view" className="peer sr-only" />
                                <Label htmlFor="view" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">View Only</Label>
                            </div>
                            <div>
                                <RadioGroupItem value="edit" id="edit" className="peer sr-only" />
                                <Label htmlFor="edit" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Allowed to Edit</Label>
                            </div>
                        </RadioGroup>
                    </div>
                    <div className="flex items-center justify-between">
                        <Label htmlFor="notify-on-edit">Notify me on edit</Label>
                        <Switch id="notify-on-edit" checked={notifyOnEdit} onCheckedChange={setNotifyOnEdit} />
                    </div>
                </div>
            </div>
        </div>
    </ScrollArea>
  );

  const dialogTitle = formToEdit ? `Edit: ${formToEdit.title}` : 'Create New Consent Form';

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col">
          <SheetHeader className="text-left">
            <SheetTitle>{dialogTitle}</SheetTitle>
            <SheetDescription>Build your form by adding and configuring fields.</SheetDescription>
          </SheetHeader>
          <div className="py-4 flex-1">{FormContent}</div>
          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Form</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>Build your form by adding and configuring fields.</DialogDescription>
        </DialogHeader>
        <div className="py-4">{FormContent}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save Form</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
