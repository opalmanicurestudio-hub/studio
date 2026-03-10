
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
  FileSignature,
  Activity,
  ArrowRight,
  Filter,
  Loader,
  CheckCircle2,
  Tag,
  Layers
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
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const ConsentCard = ({ form, onEdit, onPreview, onShare, onDelete }: { form: ConsentForm, onEdit: (form: ConsentForm) => void; onPreview: (form: ConsentForm) => void; onShare: (form: ConsentForm) => void; onDelete: (formId: string) => void; }) => {
  const signedCount = form.clientsSigned || 0;
  const totalCount = form.totalClients || 1;
  const progress = (signedCount / totalCount) * 100;

  return (
    <Card className="transition-all duration-300 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col border-border/50 bg-white hover:border-primary/20 shadow-sm hover:shadow-2xl hover:shadow-primary/5">
      <CardContent className="p-6 md:p-8 space-y-6 flex-1 text-left">
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 shadow-inner group-hover:bg-primary transition-all duration-500 shrink-0">
                <FileSignature className="w-6 h-6 text-primary group-hover:text-white transition-colors" />
            </div>
            <div className="min-w-0">
                <CardTitle className="text-sm md:text-base font-black uppercase tracking-tight text-slate-900 truncate mb-1">{form.title}</CardTitle>
                <p className="text-[10px] font-black text-primary/60 uppercase tracking-widest">{form.category}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/10 transition-all -mt-1 -mr-1"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                <DropdownMenuItem onClick={() => onPreview(form)} className="font-bold text-[10px] uppercase tracking-widest py-2.5"><Eye className="mr-2 h-3.5 w-3.5 opacity-40" /> Inspect</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(form)} className="font-bold text-[10px] uppercase tracking-widest py-2.5"><FilePenLine className="mr-2 h-3.5 w-3.5 opacity-40" /> Refine</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onShare(form)} className="font-bold text-[10px] uppercase tracking-widest py-2.5"><Share2 className="mr-2 h-3.5 w-3.5 opacity-40" /> Share Link</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(form.id)} className="text-destructive font-bold text-[10px] uppercase tracking-widest py-2.5"><Trash2 className="mr-2 h-3.5 w-3.5 opacity-40" /> Terminate</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-1 gap-4 mt-auto">
            <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-border/50 transition-all flex justify-between items-center">
                <div className="space-y-0.5">
                    <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60 leading-none">Execution Load</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Authenticated Signatures</p>
                </div>
                <div className="flex items-baseline gap-1">
                    <p className="text-2xl font-black font-mono tracking-tighter text-slate-900">{signedCount}</p>
                    <span className="text-[10px] font-bold text-muted-foreground">/ {totalCount}</span>
                </div>
            </div>
        </div>

        <div className="space-y-2">
            <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                <span>Capture Progress</span>
                <span>{progress.toFixed(0)}%</span>
            </div>
            <Progress value={progress} className="h-1.5 rounded-full bg-muted" />
        </div>

        <div className="flex items-center gap-3 pt-2">
            {form.isPasswordProtected && (
                <Badge variant="outline" className="h-5 px-2 rounded-full font-black text-[8px] uppercase tracking-widest border-none bg-amber-500/10 text-amber-700">
                    <Lock className="w-2.5 h-2.5 mr-1" /> SECURED
                </Badge>
            )}
            {form.notifyOnEdit && (
                <Badge variant="outline" className="h-5 px-2 rounded-full font-black text-[8px] uppercase tracking-widest border-none bg-blue-500/10 text-blue-700">
                    <Bell className="w-2.5 h-2.5 mr-1" /> MONITORING
                </Badge>
            )}
        </div>
      </CardContent>
      
      <div className="p-3 border-t bg-muted/5 mt-auto">
        <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:bg-primary/5 hover:text-primary transition-all group/btn" onClick={() => onPreview(form)}>
            Inspect Master Form <ArrowRight className="ml-2 h-3 w-3 transition-transform group-hover/btn:translate-x-1" />
        </Button>
      </div>
    </Card>
  );
};

const AddConsentCard = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} className="w-full h-full text-left transition-all duration-500 group">
        <Card className="border-4 border-dashed rounded-[2rem] h-full flex items-center justify-center bg-white/50 backdrop-blur-sm opacity-40 hover:opacity-100 hover:border-primary hover:bg-primary/[0.02] transition-all">
            <CardContent className="p-6 sm:p-10 flex flex-col items-center gap-4">
                <div className="p-6 bg-muted rounded-full group-hover:bg-primary group-hover:text-white transition-all duration-500 shadow-inner">
                    <PlusCircle className="w-10 h-10 sm:w-12 sm:h-12" />
                </div>
                <div className="space-y-1 text-center">
                    <p className="text-xs sm:text-sm font-black uppercase tracking-widest text-slate-900">Establish Protocol</p>
                    <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-tight text-muted-foreground">Register New Agreement</p>
                </div>
            </CardContent>
        </Card>
    </button>
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
  const [editingForm, setEditingStaff] = useState<ConsentForm | null>(null);
  const [previewingForm, setPreviewingForm] = useState<ConsentForm | null>(null);
  const { toast } = useToast();

  const handleEditForm = (form: ConsentForm) => {
    setEditingStaff(form);
    setIsFormBuilderOpen(true);
  };
  
  const handleAddNewForm = () => {
    setEditingStaff(null);
    setIsFormBuilderOpen(true);
  }

  const handlePreviewForm = (form: ConsentForm) => {
    setPreviewingForm(form);
  };

  const handleShareForm = (form: ConsentForm) => {
    if (!tenantId) return;
    const bookingLink = `${window.location.origin}/book/${tenantId}/consent/${form.id}`;
    navigator.clipboard.writeText(bookingLink);
    toast({
        title: "Protocol Link Copied",
        description: `Direct URL for "${form.title}" is ready for distribution.`,
    });
  }

  const handleSaveForm = (savedForm: Partial<ConsentForm>) => {
    if (!firestore || !tenantId) return;
    
    if (editingForm) {
      const formRef = doc(firestore, `tenants/${tenantId}/consentForms`, editingForm.id);
      updateDocumentNonBlocking(formRef, savedForm);
      toast({
        title: 'Protocol Updated',
        description: `"${savedForm.title}" refinements committed to matrix.`,
      });
    } else {
      const newFormId = nanoid();
      const newForm = {
        ...savedForm,
        id: newFormId,
        clientsSigned: 0,
        totalClients: 0,
      } as ConsentForm;
      const formRef = doc(firestore, `tenants/${tenantId}/consentForms`, newFormId);
      setDocumentNonBlocking(formRef, newForm, {});
      toast({
        title: 'Protocol Established',
        description: `"${savedForm.title}" registered in studio manifest.`,
      });
    }
  };

  const handleDeleteForm = (formId: string) => {
    if (!firestore || !tenantId) return;
    const formRef = doc(firestore, `tenants/${tenantId}/consentForms`, formId);
    deleteDocumentNonBlocking(formRef);
    toast({
      variant: 'destructive',
      title: 'Protocol Terminated',
      description: 'Record purged from studio manifest.',
    });
  };

  const categories = useMemo(() => {
    const base = ['Intake', 'Waiver', 'Release', 'General'];
    const current = forms?.map(f => f.category) || [];
    return Array.from(new Set([...base, ...current])).sort();
  }, [forms]);

  const filteredForms = useMemo(() => {
    if (!forms) return [];
    return forms
      .filter(form => activeTab === 'all' || form.category.toLowerCase() === activeTab.toLowerCase())
      .filter(form => form.title.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [forms, searchTerm, activeTab]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50 overflow-x-hidden">
      <AppHeader title="Agreement Library" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-6 md:space-y-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-left">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Form Library</h1>
            <p className="text-[10px] sm:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
              Create, manage, and track all your client-facing forms.
            </p>
          </div>
          <Button onClick={handleAddNewForm} className="h-12 md:h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full md:w-auto">
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Form
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex flex-col space-y-6 md:space-y-8">
                <div className="w-full overflow-x-auto pb-2 scrollbar-hide">
                    <TabsList className="inline-flex bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner gap-1.5 mb-2">
                        <TabsTrigger value="all" className="px-4 sm:px-8 h-10 sm:h-11 rounded-xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">All Protocols</TabsTrigger>
                        {categories.map(cat => (
                            <TabsTrigger key={cat} value={cat.toLowerCase()} className="px-4 sm:px-8 h-10 sm:h-11 rounded-xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-md">{cat}</TabsTrigger>
                        ))}
                    </TabsList>
                </div>

                <div className="relative w-full max-w-lg">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                    <Input 
                        placeholder="SEARCH PROTOCOLS & SCRIPTS..." 
                        className="pl-12 h-12 sm:h-14 rounded-2xl border-2 font-black uppercase text-[10px] sm:text-xs tracking-widest focus-visible:ring-primary/20 bg-white shadow-inner"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>
            
            <div className="mt-8 md:mt-10">
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                    {isLoading ? (
                        Array.from({length: 3}).map((_, i) => <div key={i} className="h-64 rounded-[2rem] bg-muted/20 animate-pulse" />)
                    ) : (
                      filteredForms.map(form => (
                          <ConsentCard key={form.id} form={form} onEdit={handleEditForm} onPreview={handlePreviewForm} onShare={handleShareForm} onDelete={handleDeleteForm}/>
                      ))
                    )}
                    <AddConsentCard onClick={handleAddNewForm}/>
                </div>
                {!isLoading && filteredForms.length === 0 && searchTerm && (
                    <div className="text-center py-20 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
                        <Filter className="w-16 h-16" />
                        <p className="font-black uppercase tracking-widest text-sm">No Matches in Library</p>
                    </div>
                )}
            </div>
        </Tabs>
      </main>

       <AddConsentFormDialog 
        open={isFormBuilderOpen}
        onOpenChange={setIsFormBuilderOpen}
        onSave={handleSaveForm}
        formToEdit={editingForm}
        existingCategories={categories}
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
