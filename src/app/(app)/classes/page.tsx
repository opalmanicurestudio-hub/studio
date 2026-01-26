
'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, BookText } from 'lucide-react';

export default function ClassesPage() {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Classes & Workshops" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Class Management</h1>
            <p className="text-muted-foreground mt-1">
              Create, schedule, and manage your group classes and workshops.
            </p>
          </div>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Class
          </Button>
        </div>
        <Card>
          <CardContent className="py-20 flex flex-col items-center justify-center text-center text-muted-foreground">
              <BookText className="w-16 h-16 mb-4"/>
            <h3 className="text-xl font-semibold mb-2 text-foreground">No Classes Created Yet</h3>
            <p className="mb-4">Click the button to schedule your first group class or workshop.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
