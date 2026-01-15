
'use client';

import React, { useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const MembershipsPage = () => {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Memberships & Packages" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Memberships & Packages</h1>
            <p className="text-muted-foreground mt-1">
              Create and manage your recurring memberships and prepaid packages.
            </p>
          </div>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New
          </Button>
        </div>

        <Tabs defaultValue="memberships">
          <TabsList>
            <TabsTrigger value="memberships">Memberships</TabsTrigger>
            <TabsTrigger value="packages">Packages</TabsTrigger>
          </TabsList>
          <TabsContent value="memberships" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Active Memberships</CardTitle>
                <CardDescription>Your current subscription offerings.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-center text-muted-foreground py-10">No memberships created yet.</p>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="packages" className="mt-6">
             <Card>
              <CardHeader>
                <CardTitle>Active Packages</CardTitle>
                <CardDescription>Your current prepaid package offerings.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-center text-muted-foreground py-10">No packages created yet.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default MembershipsPage;
