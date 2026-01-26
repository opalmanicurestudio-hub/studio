
'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Hammer } from 'lucide-react';

export default function ResourcesPage() {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Resource Management" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Resource Management</h1>
            <p className="text-muted-foreground mt-1">
              Manage bookable assets like treatment rooms or specialized equipment.
            </p>
          </div>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Resource
          </Button>
        </div>
        <Card>
          <CardContent className="py-20 flex flex-col items-center justify-center text-center text-muted-foreground">
              <Hammer className="w-16 h-16 mb-4"/>
            <h3 className="text-xl font-semibold mb-2 text-foreground">No Resources Created Yet</h3>
            <p className="mb-4">Add your first resource, like a 'Treatment Room' or 'Lash Bed', to manage its availability.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
