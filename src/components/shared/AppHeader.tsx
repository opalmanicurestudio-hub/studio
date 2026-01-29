
'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Bell, LifeBuoy, LogOut, Settings, User, PackageX, Calendar, Landmark, Check, X, ShieldAlert, CreditCard, ChevronsUpDown, Building } from 'lucide-react';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { useState, useMemo, useEffect } from 'react';
import { Badge } from '../ui/badge';
import Link from 'next/link';
import { ClientOnly } from './ClientOnly';
import { useInventory } from '@/context/InventoryContext';
import { differenceInDays, isPast, parseISO } from 'date-fns';
import { useTenant } from '@/context/TenantContext'; 
import { Skeleton } from '../ui/skeleton';
import { cn } from '@/lib/utils';
import { useUser } from '@/firebase';

// Mock data for notifications
const baseNotifications = [
    { id: 1, type: 'stock', message: "Low Stock Alert: 'Red Nail Polish' is at 2 units.", link: '/inventory', read: false, icon: <PackageX className="h-4 w-4 text-destructive" /> },
    { id: 2, type: 'appointment', message: "New Appointment: Eleanor Vance booked 'Classic Manicure'.", link: '/planner', read: false, icon: <Calendar className="h-4 w-4 text-primary" /> },
    { id: 3, type: 'bill', message: "Bill Due Soon: 'Studio Rent' is due in 3 days.", link: '/bills', read: true, icon: <Landmark className="h-4 w-4 text-orange-500" /> },
    { id: 4, type: 'stock', message: "Expired Stock: 'Pro Color Tube 5N' has expired.", link: '/inventory', read: true, icon: <PackageX className="h-4 w-4 text-destructive" /> },
];

const TenantSwitcher = () => {
    const { tenants, selectedTenant, setSelectedTenant, isLoading } = useTenant();

    if (isLoading) {
        return <Skeleton className="h-10 w-48" />;
    }

    if (!selectedTenant || !tenants || tenants.length <= 1) {
        return (
            <div className="flex items-center gap-2">
                <Building className="h-5 w-5 text-muted-foreground" />
                <span className="font-semibold text-lg truncate max-w-[150px] md:max-w-none">{selectedTenant?.name || 'My Business'}</span>
            </div>
        );
    }
    
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Building className="h-5 w-5 text-muted-foreground" />
                    <span className="font-semibold truncate max-w-[150px] md:max-w-none">{selectedTenant.name}</span>
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                <DropdownMenuLabel>Switch Location</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {tenants.map(tenant => (
                    <DropdownMenuItem key={tenant.id} onClick={() => setSelectedTenant(tenant)} disabled={selectedTenant.id === tenant.id}>
                       <div className="flex items-center justify-between w-full">
                         <span className={cn("mr-2", selectedTenant.id === tenant.id ? "font-bold" : "font-normal")}>
                            {tenant.name}
                        </span>
                         {selectedTenant.id === tenant.id && <Check className="h-4 w-4" />}
                       </div>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export function AppHeader({ title }: { title?: string }) {
  const { staff } = useInventory();
  const { user } = useUser();
  
  const licenseNotifications = useMemo(() => {
    if (!staff) return [];
    return staff.map(member => {
      if (!member.compliance?.licenseExpiry) return null;

      const licenseExpiry = parseISO(member.compliance.licenseExpiry);
      const daysUntil = differenceInDays(licenseExpiry, new Date());
      const expired = isPast(licenseExpiry);

      if (expired) {
        return {
          id: `license-${member.id}-expired`,
          type: 'license',
          message: `${member.name}'s license has expired.`,
          link: '/staff',
          read: false,
          icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
        };
      }
      
      if (daysUntil <= 30) {
        return {
          id: `license-${member.id}-expiring`,
          type: 'license',
          message: `${member.name}'s license is expiring in ${daysUntil} days.`,
          link: '/staff',
          read: false,
          icon: <ShieldAlert className="h-4 w-4 text-orange-500" />,
        };
      }
      
      return null;
    }).filter((n): n is NonNullable<typeof n> => n !== null);
  }, [staff]);

  const [notifications, setNotifications] = useState<(typeof baseNotifications[0] | typeof licenseNotifications[0])[]>(baseNotifications);
  
  useEffect(() => {
    const allNotifs = [...licenseNotifications, ...baseNotifications];
    const uniqueNotifs = Array.from(new Map(allNotifs.map(n => [n.id, n])).values());
    setNotifications(uniqueNotifs);
  }, [licenseNotifications]);


  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = (id: number | string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };
  
  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({...n, read: true})));
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b bg-background/80 px-4 backdrop-blur-sm md:px-6 print:hidden">
      <div className="flex flex-1 items-center gap-2">
        <SidebarTrigger className="md:hidden" />
        
        {/* On mobile, show title; on desktop, show switcher */}
        {title && <h1 className="text-xl font-semibold truncate md:hidden">{title}</h1>}
        
        {/* On desktop, show switcher. Also show on mobile if no title exists (dashboard). */}
        <div className={cn(title ? 'hidden md:block' : 'block')}>
            <ClientOnly>
            <TenantSwitcher />
            </ClientOnly>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <ClientOnly>
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full relative">
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                          <span className="absolute top-0 right-0 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                          </span>
                      )}
                      <span className="sr-only">Toggle notifications</span>
                  </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel className="flex justify-between items-center">
                      Notifications
                      <Button variant="link" size="xs" className="p-0 h-auto" onClick={markAllAsRead}>Mark all as read</Button>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {notifications.length > 0 ? notifications.map(notification => (
                      <DropdownMenuItem key={notification.id} className={`flex items-start gap-3 p-2 ${notification.read ? '' : 'bg-primary/5'}`}>
                          <div className="mt-1">{notification.icon}</div>
                          <Link href={notification.link || '#'} className="flex-1 space-y-1">
                            <p className="text-xs font-medium leading-none">{notification.message}</p>
                          </Link>
                          {!notification.read && (
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); markAsRead(notification.id); }}>
                                  <Check className="h-4 w-4 text-primary" />
                              </Button>
                          )}
                      </DropdownMenuItem>
                  )) : (
                      <p className="p-4 text-center text-sm text-muted-foreground">No new notifications.</p>
                  )}
              </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
        <ClientOnly>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={user?.photoURL || ''} alt="User" />
                  <AvatarFallback>{user?.displayName?.charAt(0) || 'U'}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings />
                  <span>Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/subscriptions">
                  <CreditCard />
                  <span>Billing</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <LifeBuoy />
                <span>Support</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <LogOut />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    </header>
  );
}
