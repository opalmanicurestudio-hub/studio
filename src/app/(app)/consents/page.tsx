

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
import { PreviewConsentFormDialog } from '@/components/consents/PreviewConsentFormDialog';
import { useToast } from '@/hooks/use-toast';
import { type ConsentForm } from '@/lib/data';
import { useFirebase, useCollection, useMemoFirebase, setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { useTenant } from '@/context/TenantContext';

const ConsentCard = ({ form, onEdit, onPreview, onShare, onDelete }: { form: ConsentForm, onEdit: (form: ConsentForm) => void; onPreview: (form: ConsentForm) => void; onShare: (form: ConsentForm) => void; onDelete: (formId: string) => void; }) => {

  return (
    <Card className="flex flex-col transition-all duration-200 hover:shadow-lg hover:-translate-y-1">
      <CardHeader>
        <CardTitle className="truncate">{form.title}</CardTitle>
        <CardDescription>{form.category}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            <span>{form.clientsSigned || 0} signed</span>
        </div>
        <Progress value={((form.clientsSigned || 0) / (form.totalClients || 1)) * 100} className="h-2" />
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
                <DropdownMenuItem className="text-destructive" onClick={() => onDelete(form.id)}><Trash2 className="w-4 h-4 mr-2"/>Delete</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
};

const AddConsentCard = ({ onClick }: { onClick: () => void }) => (
    <Card className="border-2 border-dashed h-full flex items-center justify-center hover:border-primary transition-all duration-200 hover:shadow-lg hover:-translate-y-1">
        <CardContent className="p-6 text-center">
            <button onClick={onClick} className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary">
                <PlusCircle className="w-10 h-10" />
                <span className="font-medium">Add New Form</span>
            </button>
        </CardContent>
    </Card>
)

export default function ConsentsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const consentFormsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/consentForms`)
  }, [firestore, tenantId]);
  const { data: forms, isLoading } = useCollection<ConsentForm>(consentFormsQuery);

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
    if (!tenantId) return;
    // In a real app, you'd have a base URL from your environment variables
    const bookingLink = `https://clarityflow.app/book/${tenantId}/consent/${form.id}`;
    navigator.clipboard.writeText(bookingLink);
    toast({
        title: "Link Copied!",
        description: `A shareable link for "${form.title}" has been copied to your clipboard.`,
    });
  }

  const handleSaveForm = (savedForm: Partial<ConsentForm>) => {
    if (!firestore || !tenantId) return;
    
    if (editingForm) {
      const formRef = doc(firestore, `tenants/${tenantId}/consentForms`, editingForm.id);
      updateDocumentNonBlocking(formRef, savedForm);
      toast({
        title: 'Form Updated',
        description: `"${savedForm.title}" has been updated.`,
      });
    } else {
      const newFormId = nanoid();
      const newForm: Omit<ConsentForm, 'clientsSigned' | 'totalClients'> & { id: string } = {
        ...savedForm,
        id: newFormId,
      } as Omit<ConsentForm, 'clientsSigned' | 'totalClients'> & { id: string };
      const formRef = doc(firestore, `tenants/${tenantId}/consentForms`, newFormId);
      setDocumentNonBlocking(formRef, newForm, {});
      toast({
        title: 'Form Created',
        description: `"${savedForm.title}" has been added to your library.`,
      });
    }
  };

  const handleDeleteForm = (formId: string) => {
    if (!firestore || !tenantId) return;
    const formRef = doc(firestore, `tenants/${tenantId}/consentForms`, formId);
    deleteDocumentNonBlocking(formRef);
    toast({
      variant: 'destructive',
      title: 'Form Deleted',
      description: 'The consent form has been removed.',
    });
  };

  const filteredForms = useMemo(() => {
    if (!forms) return [];
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
                    {isLoading ? (
                      Array.from({length: 3}).map((_, i) => <Card key={i} className="h-64 animate-pulse"></Card>)
                    ) : (
                      filteredForms.length > 0 ? filteredForms.map(form => (
                          <ConsentCard key={form.id} form={form} onEdit={handleEditForm} onPreview={handlePreviewForm} onShare={handleShareForm} onDelete={handleDeleteForm}/>
                      )) : null
                    )}
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
