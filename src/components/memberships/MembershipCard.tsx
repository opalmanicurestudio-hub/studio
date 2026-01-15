'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Award, MoreHorizontal, Users, BarChart, Trash2, Edit } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { type Membership } from '@/lib/data';

interface MembershipCardProps {
  membership: Membership;
  onEdit: (membership: Membership) => void;
  onViewUsers: (membership: Membership) => void;
}

export const MembershipCard: React.FC<MembershipCardProps> = ({ membership, onEdit, onViewUsers }) => {
  const activeMembers = 12; // Mock data
  const mrr = activeMembers * membership.price;

  return (
    <Card className="border-indigo-500/20 hover:shadow-indigo-500/10 flex flex-col">
      <CardHeader>
        <div className="flex justify-between items-start">
            <div className='flex items-center gap-3'>
                <div className="p-3 bg-indigo-500/10 rounded-lg">
                    <Award className="w-6 h-6 text-indigo-500" />
                </div>
                 <div>
                    <CardTitle>{membership.name}</CardTitle>
                    <CardDescription>${membership.price}/{membership.interval}</CardDescription>
                </div>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => onEdit(membership)}><Edit className="mr-2 h-4 w-4"/>Edit</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-4 w-4"/>Delete</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="flex-1 grid grid-cols-2 gap-4">
        <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Users className="w-4 h-4" /> Active Members</div>
            <div className="text-2xl font-bold">{activeMembers}</div>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><BarChart className="w-4 h-4" /> Est. MRR</div>
            <div className="text-2xl font-bold">${mrr.toFixed(2)}</div>
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" onClick={() => onViewUsers(membership)}>View Active Members</Button>
      </CardFooter>
    </Card>
  );
};
