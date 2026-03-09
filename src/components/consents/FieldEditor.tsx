'use client';

import React, { useState } from 'react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowUp, ArrowDown, Trash2, Heading1, CaseSensitive, Pilcrow, CheckSquare, ListOrdered, Image as ImageIcon, Signature, PlusCircle, Layout } from 'lucide-react';
import { FormField } from '@/lib/data';
import { cn } from '@/lib/utils';

interface FieldEditorProps {
  field: FormField;
  onUpdate: (id: string, updatedField: FormField) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  isFirst: boolean;
  isLast: boolean;
}

const fieldTypeIcons: Record<string, any> = {
    'heading': Heading1,
    'paragraph': Pilcrow,
    'short-text': CaseSensitive,
    'long-text': CaseSensitive,
    'multiple-choice': ListOrdered,
    'checkboxes': CheckSquare,
    'image-upload': ImageIcon,
    'signature': Signature,
};

export const FieldEditor: React.FC<FieldEditorProps> = ({ field, onUpdate, onDelete, onMove, isFirst, isLast }) => {
    const [newOption, setNewOption] = useState('');

    const handleFieldChange = (key: keyof FormField, value: any) => {
        onUpdate(field.id, { ...field, [key]: value });
    }

    const handleOptionChange = (index: number, value: string) => {
        const newOptions = [...(field.options || [])];
        newOptions[index] = value;
        handleFieldChange('options', newOptions);
    }
    
    const handleAddOption = () => {
        if(newOption.trim()){
            const newOptions = [...(field.options || []), newOption.trim()];
            handleFieldChange('options', newOptions);
            setNewOption('');
        }
    }
    
    const handleRemoveOption = (index: number) => {
        const newOptions = (field.options || []).filter((_, i) => i !== index);
        handleFieldChange('options', newOptions);
    }

    const renderFieldContent = () => {
        switch (field.type) {
            case 'short-text':
            case 'long-text':
            case 'paragraph':
            case 'heading':
                return <Textarea placeholder="ENTER PROTOCOL LABEL OR QUERY..." value={field.label} onChange={(e) => handleFieldChange('label', e.target.value)} rows={field.type === 'long-text' ? 4 : 1} className="rounded-xl border-2 bg-white shadow-inner font-bold uppercase text-[10px] tracking-tight" />;
            case 'multiple-choice':
            case 'checkboxes':
                return (
                    <div className="space-y-4">
                        <Textarea placeholder="ENTER LOGIC QUERY..." value={field.label} onChange={(e) => handleFieldChange('label', e.target.value)} rows={1} className="rounded-xl border-2 bg-white shadow-inner font-bold uppercase text-[10px] tracking-tight" />
                        <div className="space-y-2 pl-4 border-l-2 border-dashed border-border/50">
                            {(field.options || []).map((option, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <Input value={option} onChange={(e) => handleOptionChange(index, e.target.value)} className="h-9 rounded-lg border-2 font-bold uppercase text-[10px] bg-white" />
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => handleRemoveOption(index)}><Trash2 className="w-3.5 h-3.5" /></Button>
                                </div>
                            ))}
                            <div className="flex items-center gap-2 pt-1">
                                <Input placeholder="NEW OPTION..." value={newOption} onChange={(e) => setNewOption(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddOption()} className="h-9 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest bg-muted/10" />
                                <Button variant="outline" size="sm" onClick={handleAddOption} className="h-9 px-3 rounded-lg font-black uppercase text-[9px] tracking-widest border-2 shrink-0">Add</Button>
                            </div>
                        </div>
                    </div>
                );
            case 'signature':
                return (
                     <div className="p-8 rounded-2xl border-4 border-dashed bg-muted/20 text-center space-y-2">
                        <Signature className="mx-auto w-10 h-10 text-muted-foreground opacity-30"/>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Verified Identity Signature Module</p>
                    </div>
                )
            case 'image-upload':
                return (
                    <div className="p-8 rounded-2xl border-4 border-dashed bg-muted/20 text-center space-y-2">
                        <ImageIcon className="mx-auto w-10 h-10 text-muted-foreground opacity-30"/>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Visual Asset Upload Module</p>
                    </div>
                );
            default:
                return null;
        }
    }
  
  return (
    <Card className="border-2 rounded-[2rem] shadow-sm overflow-hidden bg-muted/5 transition-all hover:bg-muted/10">
      <CardContent className="p-5 flex gap-4">
        <div className="flex flex-col gap-1.5 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-primary/10 text-primary" onClick={() => onMove(field.id, 'up')} disabled={isFirst}>
            <ArrowUp className="w-4 h-4" />
          </Button>
           <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-primary/10 text-primary" onClick={() => onMove(field.id, 'down')} disabled={isLast}>
            <ArrowDown className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-6 min-w-0">
           <div className="flex justify-between items-center">
             <Select value={field.type} onValueChange={(v: any) => handleFieldChange('type', v)}>
                <SelectTrigger className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest w-48 bg-white shadow-sm">
                    <SelectValue>
                         <div className="flex items-center gap-2">
                            {React.createElement(fieldTypeIcons[field.type] || CaseSensitive, { className: "w-3 h-3 text-primary" })}
                            <span>{field.type.replace('-', ' ')}</span>
                        </div>
                    </SelectValue>
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                    {Object.entries(fieldTypeIcons).map(([type, Icon]) => (
                        <SelectItem key={type} value={type} className="font-bold uppercase text-[9px] tracking-widest">
                            <div className="flex items-center gap-2"><Icon className="w-3 h-3"/> {type.replace('-', ' ')}</div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive rounded-lg hover:bg-destructive/10" onClick={() => onDelete(field.id)}>
                <Trash2 className="w-4 h-4" />
            </Button>
           </div>
           <div className="text-left">
                {renderFieldContent()}
           </div>
        </div>
      </CardContent>
    </Card>
  );
};
