
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Star, MessageSquare, Users } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { doc } from 'firebase/firestore';
import { type Review } from '@/lib/data';
import { formatDistanceToNow, parseISO } from 'date-fns';

const ReviewCard = ({ review, onTogglePublic }: { review: Review, onTogglePublic: (id: string, isPublic: boolean) => void }) => {
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-4">
          <Avatar>
            <AvatarImage src={review.clientAvatarUrl} alt={review.clientName} />
            <AvatarFallback>{review.clientName?.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex justify-between items-center">
              <p className="font-semibold">{review.clientName}</p>
              <div className="flex items-center gap-1 text-amber-500">
                <span className="font-bold">{review.rating.toFixed(1)}</span>
                <Star className="w-4 h-4 fill-current" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Reviewed {review.serviceName} &middot; {formatDistanceToNow(parseISO(review.createdAt), { addSuffix: true })}
            </p>
          </div>
        </div>
        <blockquote className="pl-4 border-l-2 text-sm italic text-muted-foreground">
          "{review.text}"
        </blockquote>
        <div className="flex items-center justify-end space-x-2 pt-4 border-t">
          <Label htmlFor={`public-switch-${review.id}`} className="text-sm font-medium">
            Show Publicly
          </Label>
          <Switch
            id={`public-switch-${review.id}`}
            checked={review.isPublic}
            onCheckedChange={(checked) => onTogglePublic(review.id, checked)}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default function ReviewsPage() {
  const { reviews, isLoading } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();

  const handleTogglePublic = (reviewId: string, isPublic: boolean) => {
    if (!firestore || !selectedTenant) return;
    const reviewRef = doc(firestore, `tenants/${selectedTenant.id}/reviews`, reviewId);
    updateDocumentNonBlocking(reviewRef, { isPublic });
  };

  const { avgRating, publicReviews, totalReviews } = useMemo(() => {
    if (!reviews || reviews.length === 0) {
      return { avgRating: 0, publicReviews: 0, totalReviews: 0 };
    }
    const total = reviews.reduce((acc, r) => acc + r.rating, 0);
    return {
      avgRating: total / reviews.length,
      publicReviews: reviews.filter(r => r.isPublic).length,
      totalReviews: reviews.length,
    };
  }, [reviews]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Reviews" />
      <main className="flex-1 p-4 md:p-8 space-y-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Review Management</h1>
            <p className="text-muted-foreground mt-1">
              Manage client feedback and control what appears on your public booking page.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Average Rating</CardTitle>
              <Star className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgRating.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">Across {totalReviews} total reviews</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Reviews</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalReviews}</div>
              <p className="text-xs text-muted-foreground">All-time feedback received</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Public Reviews</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{publicReviews}</div>
              <p className="text-xs text-muted-foreground">Visible on your booking page</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <p>Loading reviews...</p>
          ) : reviews && reviews.length > 0 ? (
            reviews.map(review => (
              <ReviewCard key={review.id} review={review} onTogglePublic={handleTogglePublic} />
            ))
          ) : (
            <div className="col-span-full text-center py-20 px-6 border-2 border-dashed rounded-lg">
                <h3 className="text-2xl font-semibold">No Reviews Yet</h3>
                <p className="text-muted-foreground max-w-sm mx-auto mt-2">
                    When clients leave feedback, it will appear here for you to manage.
                </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
