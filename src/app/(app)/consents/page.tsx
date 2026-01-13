
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PlusCircle,
  Search,
  Eye,
  FilePenLine,
  Trash2,
  Share2,
  Lock,
  Bell,
  MoreHorizontal,
  Users,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { AddConsentFormDialog } from '@/components/consents/AddConsentFormDialog';
import { FormField } from '@/components/consents/FieldEditor';
import { PreviewConsentFormDialog } from '@/components/consents/PreviewConsentFormDialog';
import { useToast } from '@/hooks/use-toast';

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

const mockForms: ConsentForm[] = [
  {
    id: 'form-1',
    title: 'New Client Intake Form',
    category: 'Intake',
    clientsSigned: 18,
    totalClients: 25,
    isPasswordProtected: false,
    notifyOnEdit: true,
    fields: [
        { id: 'f1', type: 'short-text', label: 'Full Name' },
        { id: 'f2', type: 'short-text', label: 'Email Address' },
        { id: 'f3', type: 'paragraph', label: 'Please list any known allergies or medical conditions.' },
        { id: 'f4', type: 'long-text', label: '' },
        { id: 'f5', type: 'signature', label: 'Client Signature' },
    ]
  },
  {
    id: 'form-2',
    title: 'Chemical Service Waiver',
    category: 'Waiver',
    clientsSigned: 12,
    totalClients: 15,
    isPasswordProtected: true,
    notifyOnEdit: true,
  },
  {
    id: 'form-3',
    title: 'Photo & Video Release',
    category: 'Release',
    clientsSigned: 22,
    totalClients: 25,
    isPasswordProtected: false,
    notifyOnEdit: false,
  },
  {
    id: 'form-4',
    title: 'General Liability Waiver',
    category: 'Waiver',
    clientsSigned: 25,
    totalClients: 25,
    isPasswordProtected: false,
    notifyOnEdit: false,
  },
];

const ConsentCard = ({ form, onEdit, onPreview, onShare }: { form: ConsentForm, onEdit: (form: ConsentForm) => void; onPreview: (form: ConsentForm) => void; onShare: (form: ConsentForm) => void; }) => {

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="truncate">{form.title}</CardTitle>
        <CardDescription>{form.category}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            <span>{form.clientsSigned} signed</span>
        </div>
        <Progress value={(form.clientsSigned / form.totalClients) * 100} className="h-2" />
        <div className="flex items-center gap-4 text-muted-foreground">
          {form.isPasswordProtected && <Lock className="w-4 h-4" title="Password Protected" />}
          {form.notifyOnEdit && <Bell className="w-4 h-4" title="Notified on Edits" />}
        </div>
      </CardContent>
      <CardFooter className="p-2 border-t bg-muted/50 flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => onPreview(form)}><Eye className="w-4 h-4 mr-2"/>Preview</Button>
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => onShare(form)}><Share2 className="w-4 h-4 mr-2"/>Share</Button>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="w-4 h-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(form)}><FilePenLine className="w-4 h-4 mr-2"/>Edit</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive"><Trash2 className="w-4 h-4 mr-2"/>Delete</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
};

const AddConsentCard = ({ onClick }: { onClick: () => void }) => (
    <Card className="border-2 border-dashed h-full flex items-center justify-center hover:border-primary transition-colors">
        <CardContent className="p-6 text-center">
            <button onClick={onClick} className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary">
                <PlusCircle className="w-10 h-10" />
                <span className="font-medium">Add New Form</span>
            </button>
        </CardContent>
    </Card>
)

export default function ConsentsPage() {
  const [forms, setForms] = useState<ConsentForm[]>(mockForms);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [isFormBuilderOpen, setIsFormBuilderOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<ConsentForm | null>(null);
  const [previewingForm, setPreviewingForm] = useState<ConsentForm | null>(null);
  const { toast } = useToast();

  const handleEditForm = (form: ConsentForm) => {
    setEditingForm(form);
    setIsFormBuilderOpen(true);
  };
  
  const handleAddNewForm = () => {
    setEditingForm(null);
    setIsFormBuilderOpen(true);
  }

  const handlePreviewForm = (form: ConsentForm) => {
    setPreviewingForm(form);
  };

  const handleShareForm = (form: ConsentForm) => {
    // In a real app, you'd have a base URL from your environment variables
    const bookingLink = `https://clarityflow.app/book/consent/${form.id}`;
    navigator.clipboard.writeText(bookingLink);
    toast({
        title: "Link Copied!",
        description: `A shareable link for "${form.title}" has been copied to your clipboard.`,
    });
  }

  const handleSaveForm = (savedForm: any) => {
    // This is where you would save to Firestore.
    // For now, we'll just update the mock data.
    console.log('Saving form:', savedForm);
    if (editingForm) {
      setForms(prev => prev.map(f => f.id === editingForm.id ? { ...f, ...savedForm, clientsSigned: f.clientsSigned, totalClients: f.totalClients } : f));
    } else {
      const newForm: ConsentForm = {
        ...savedForm,
        id: `form-${Date.now()}`,
        clientsSigned: 0,
        totalClients: 25, // Mock total
      };
      setForms(prev => [...prev, newForm]);
    }
  };


  const filteredForms = useMemo(() => {
    return forms
      .filter(form => activeTab === 'all' || form.category.toLowerCase() === activeTab)
      .filter(form => form.title.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [forms, searchTerm, activeTab]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Consents & Agreements" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Form Library</h1>
            <p className="text-muted-foreground mt-1">
              Create, manage, and track all your client-facing forms.
            </p>
          </div>
          <Button onClick={handleAddNewForm}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Form
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
                <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="intake">Intake</TabsTrigger>
                    <TabsTrigger value="waiver">Waivers</TabsTrigger>
                    <TabsTrigger value="release">Releases</TabsTrigger>
                </TabsList>
                <div className="relative w-full md:max-w-xs ml-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                        placeholder="Search forms..." 
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>
            
            <TabsContent value={activeTab.toLowerCase()}>
                 <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredForms.map(form => (
                        <ConsentCard key={form.id} form={form} onEdit={handleEditForm} onPreview={handlePreviewForm} onShare={handleShareForm} />
                    ))}
                     <AddConsentCard onClick={handleAddNewForm}/>
                </div>
            </TabsContent>
        </Tabs>
      </main>

       <AddConsentFormDialog 
        open={isFormBuilderOpen}
        onOpenChange={setIsFormBuilderOpen}
        onSave={handleSaveForm}
        formToEdit={editingForm}
       />

       {previewingForm && (
            <PreviewConsentFormDialog
                open={!!previewingForm}
                onOpenChange={() => setPreviewingForm(null)}
                form={previewingForm}
            />
       )}
    </div>
  );
}
