
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
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';

type ConsentForm = {
  id: string;
  title: string;
  category: 'Intake' | 'Waiver' | 'Release';
  clientsSigned: number;
  totalClients: number;
  isPasswordProtected: boolean;
  notifyOnEdit: boolean;
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

const ConsentCard = ({ form }: { form: ConsentForm }) => {
  const signedPercentage = form.totalClients > 0 ? (form.clientsSigned / form.totalClients) * 100 : 0;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="truncate">{form.title}</CardTitle>
        <CardDescription>{form.category}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div>
          <div className="flex justify-between text-sm text-muted-foreground mb-1">
            <span>Signed</span>
            <span>
              {form.clientsSigned} / {form.totalClients}
            </span>
          </div>
          <Progress value={signedPercentage} />
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          {form.isPasswordProtected && <Lock className="w-4 h-4" title="Password Protected" />}
          {form.notifyOnEdit && <Bell className="w-4 h-4" title="Notified on Edits" />}
        </div>
      </CardContent>
      <CardFooter className="p-2 border-t bg-muted/50">
        <div className="w-full grid grid-cols-4 gap-1">
          <Button variant="ghost" size="sm" className="flex-1"><Eye className="w-4 h-4 mr-2"/>Preview</Button>
          <Button variant="ghost" size="sm" className="flex-1"><Share2 className="w-4 h-4 mr-2"/>Share</Button>
          <Button variant="ghost" size="sm" className="flex-1"><FilePenLine className="w-4 h-4 mr-2"/>Edit</Button>
          <Button variant="ghost" size="sm" className="flex-1 text-destructive hover:text-destructive"><Trash2 className="w-4 h-4 mr-2"/>Delete</Button>
        </div>
      </CardFooter>
    </Card>
  );
};

const AddConsentCard = () => (
    <Card className="border-2 border-dashed h-full flex items-center justify-center hover:border-primary transition-colors">
        <CardContent className="p-6 text-center">
            <button className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary">
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
          <Button>
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
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredForms.map(form => (
                        <ConsentCard key={form.id} form={form} />
                    ))}
                     <AddConsentCard />
                </div>
            </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
