
'use client';

import React from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Printer, Download } from 'lucide-react';
import Link from 'next/link';

const CustomizationSidebar = () => {
  return (
    <Card className="lg:sticky top-24">
      <CardHeader>
        <CardTitle>Customize Labels</CardTitle>
        <CardDescription>Select products and label content.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
            <Label>Products</Label>
            <div className="h-48 border rounded-md p-2 text-center text-sm text-muted-foreground">
                Product selection list will go here.
            </div>
        </div>
        <div className="space-y-4">
            <Label>Label Content</Label>
            <div className="space-y-2">
                <div className="flex items-center space-x-2">
                    <Checkbox id="show-product-name" defaultChecked />
                    <Label htmlFor="show-product-name">Show Product Name</Label>
                </div>
                 <div className="flex items-center space-x-2">
                    <Checkbox id="show-price" />
                    <Label htmlFor="show-price">Show Price</Label>
                </div>
                 <div className="flex items-center space-x-2">
                    <Checkbox id="show-qr-code" defaultChecked />
                    <Label htmlFor="show-qr-code">Show QR Code</Label>
                </div>
                 <div className="flex items-center space-x-2">
                    <Checkbox id="show-expiration" />
                    <Label htmlFor="show-expiration">Show Expiration Date</Label>
                </div>
            </div>
        </div>
      </CardContent>
    </Card>
  )
}

const PrintPreview = () => {
    return (
        <Tabs defaultValue="sheet">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="sheet">Sheet Print</TabsTrigger>
                <TabsTrigger value="single">Single Label</TabsTrigger>
            </TabsList>
            <TabsContent value="sheet" className="mt-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Sheet Preview</CardTitle>
                        <CardDescription>Real-time preview of a full label sheet.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[600px] bg-muted/50 rounded-md flex items-center justify-center">
                        <p className="text-muted-foreground">Sheet preview will be here.</p>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="single" className="mt-4">
                 <Card>
                    <CardHeader>
                        <CardTitle>Single Label Preview</CardTitle>
                        <CardDescription>Preview for thermal printers.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[400px] bg-muted/50 rounded-md flex items-center justify-center">
                        <p className="text-muted-foreground">Single label preview will be here.</p>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    )
}

export default function LabelPage() {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Print Labels" />
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
              <div className='flex items-center gap-4'>
                <Button variant="outline" asChild>
                    <Link href="/inventory">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Inventory
                    </Link>
                </Button>
                <h1 className="text-3xl font-bold">Print Labels</h1>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline"><Download className="mr-2 h-4 w-4" /> Download</Button>
                <Button><Printer className="mr-2 h-4 w-4" /> Print</Button>
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-8 items-start">
                <div className="lg:col-span-1">
                    <CustomizationSidebar />
                </div>
                <div className="lg:col-span-2">
                    <PrintPreview />
                </div>
            </div>
        </div>
      </main>
    </div>
  );
}
