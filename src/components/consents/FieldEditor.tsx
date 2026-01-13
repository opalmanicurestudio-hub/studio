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
import { ArrowUp, ArrowDown, Trash2, Heading1, CaseSensitive, Pilcrow, CheckSquare, ListOrdered, Image as ImageIcon, Signature, PlusCircle } from 'lucide-react';

export type FormField = {
  id: string;
  type: 'heading' | 'paragraph' | 'short-text' | 'long-text' | 'multiple-choice' | 'checkboxes' | 'image-upload' | 'signature';
  label: string;
  options?: string[];
};

interface FieldEditorProps {
  field: FormField;
  onUpdate: (id: string, updatedField: FormField) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  isFirst: boolean;
  isLast: boolean;
}

const fieldTypeIcons = {
    'heading': <Heading1 className="w-4 h-4" />,
    'paragraph': <Pilcrow className="w-4 h-4" />,
    'short-text': <CaseSensitive className="w-4 h-4" />,
    'long-text': <CaseSensitive className="w-4 h-4" />,
    'multiple-choice': <ListOrdered className="w-4 h-4" />,
    'checkboxes': <CheckSquare className="w-4 h-4" />,
    'image-upload': <ImageIcon className="w-4 h-4" />,
    'signature': <Signature className="w-4 h-4" />,
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
                return <Textarea placeholder="Enter your question or text here..." value={field.label} onChange={(e) => handleFieldChange('label', e.target.value)} rows={field.type === 'long-text' ? 4 : 1} />;
            case 'multiple-choice':
            case 'checkboxes':
                return (
                    <div className="space-y-2">
                        <Textarea placeholder="Enter your question..." value={field.label} onChange={(e) => handleFieldChange('label', e.target.value)} rows={1} />
                        <div className="space-y-2 pl-4">
                            {(field.options || []).map((option, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <Input value={option} onChange={(e) => handleOptionChange(index, e.target.value)} />
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveOption(index)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                            ))}
                        </div>
                         <div className="flex items-center gap-2 pl-4">
                            <Input placeholder="Add new option..." value={newOption} onChange={(e) => setNewOption(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddOption()} />
                            <Button variant="outline" size="sm" onClick={handleAddOption}><PlusCircle className="w-4 h-4 mr-2" />Add</Button>
                        </div>
                    </div>
                );
            case 'signature':
                return (
                     <div className="p-4 rounded-md border-2 border-dashed bg-muted/50 text-center">
                        <Signature className="mx-auto w-8 h-8 text-muted-foreground mb-2"/>
                        <p className="text-sm font-medium">Signature Box</p>
                        <p className="text-xs text-muted-foreground">Clients will sign here.</p>
                    </div>
                )
            case 'image-upload':
                return (
                    <div className="p-4 rounded-md border-2 border-dashed bg-muted/50 text-center">
                        <ImageIcon className="mx-auto w-8 h-8 text-muted-foreground mb-2"/>
                        <p className="text-sm font-medium">Image Upload</p>
                        <p className="text-xs text-muted-foreground">Clients can upload an image.</p>
                    </div>
                );
            default:
                return null;
        }
    }
  
  return (
    <Card>
      <CardContent className="p-4 flex gap-2">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onMove(field.id, 'up')} disabled={isFirst}>
            <ArrowUp className="w-4 h-4" />
          </Button>
           <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onMove(field.id, 'down')} disabled={isLast}>
            <ArrowDown className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-4">
           <div className="flex justify-between items-center">
             <Select value={field.type} onValueChange={(v: any) => handleFieldChange('type', v)}>
                <SelectTrigger className="w-[200px]">
                    <SelectValue>
                         <div className="flex items-center gap-2">
                            {fieldTypeIcons[field.type]}
                            <span>{field.type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                        </div>
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="heading"><div className="flex items-center gap-2"><Heading1/>Heading</div></SelectItem>
                    <SelectItem value="paragraph"><div className="flex items-center gap-2"><Pilcrow/>Paragraph</div></SelectItem>
                    <SelectItem value="short-text"><div className="flex items-center gap-2"><CaseSensitive/>Short Text</div></SelectItem>
                    <SelectItem value="long-text"><div className="flex items-center gap-2"><CaseSensitive/>Long Text</div></SelectItem>
                    <SelectItem value="multiple-choice"><div className="flex items-center gap-2"><ListOrdered/>Multiple Choice</div></SelectItem>
                    <SelectItem value="checkboxes"><div className="flex items-center gap-2"><CheckSquare/>Checkboxes</div></SelectItem>
                    <SelectItem value="image-upload"><div className="flex items-center gap-2"><ImageIcon/>Image Upload</div></SelectItem>
                    <SelectItem value="signature"><div className="flex items-center gap-2"><Signature/>Signature</div></SelectItem>
                </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => onDelete(field.id)}>
                <Trash2 className="w-4 h-4" />
            </Button>
           </div>
           {renderFieldContent()}
        </div>
      </CardContent>
    </Card>
  );
};
