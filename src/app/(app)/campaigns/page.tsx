
'use client';

import React from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Megaphone } from 'lucide-react';

export default function CampaignsPage() {
  // Placeholder data
  const campaigns: any[] = [];

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Campaigns" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Marketing Campaigns</h1>
            <p className="text-muted-foreground mt-1">
              Engage your clients with targeted email and SMS campaigns.
            </p>
          </div>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" /> New Campaign
          </Button>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Your Campaigns</CardTitle>
            <CardDescription>A list of all your marketing campaigns, past and present.</CardDescription>
          </CardHeader>
          <CardContent>
            {campaigns.length > 0 ? (
              <div>
                {/* List of campaigns would go here */}
              </div>
            ) : (
              <div className="text-center py-20 px-6 border-2 border-dashed rounded-lg">
                <Megaphone className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Campaigns Created Yet</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Click the button to create your first email or SMS campaign.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
