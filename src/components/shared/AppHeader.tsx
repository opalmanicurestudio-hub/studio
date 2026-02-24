

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
import { Bell, LifeBuoy, LogOut, Settings, User, PackageX, Calendar, Landmark, Check, X, ShieldAlert, CreditCard, ChevronsUpDown, Building, Search } from 'lucide-react';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { useState, useMemo, useEffect } from 'react';
import { Badge } from '../ui/badge';
import Link from 'next/link';
import { ClientOnly } from './ClientOnly';
import { useInventory } from '@/context/InventoryContext';
import { differenceInDays, isPast, parseISO, format } from 'date-fns';
import { useTenant } from '@/context/TenantContext'; 
import { Skeleton } from '../ui/skeleton';
import { cn } from '@/lib/utils';
import { useUser, useAuth } from '@/firebase';
import { errorEmitter } from '@/firebase/error-emitter';
import { Input } from '../ui/input';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';

type Notification = {
    id: number | string;
    type: string;
    message: string;
    link: string;
    read: boolean;
    icon: React.ReactNode;
};

export function AppHeader({ title }: { title?: string }) {
  const { staff, inventory, billInstances, billDefinitions } = useInventory();
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();
  
  const [notifications, setNotifications] = useState<Notification[]>([]);

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

  const lowStockNotifications = useMemo(() => {
    if (!inventory) return [];
    return inventory
        .filter(item => item.reorderPoint && item.totalStock <= item.reorderPoint)
        .map(item => ({
            id: `low-stock-${item.id}`,
            type: 'stock',
            message: `Low Stock Alert: '${item.name}' is at ${item.totalStock} units.`,
            link: `/inventory/${item.id}`,
            read: false,
            icon: <PackageX className="h-4 w-4 text-destructive" />
        }));
  }, [inventory]);

  const expiredStockNotifications = useMemo(() => {
    if (!inventory) return [];
    const expired: Notification[] = [];
    inventory.forEach(item => {
        (item.batches || []).forEach(batch => {
            if (batch.expirationDate && isPast(parseISO(batch.expirationDate)) && batch.stock > 0) {
                expired.push({
                    id: `expired-${item.id}-${batch.id}`,
                    type: 'stock',
                    message: `Expired Stock: ${batch.stock} units of '${item.name}' expired on ${format(parseISO(batch.expirationDate), 'MMM d')}.`,
                    link: `/inventory/${item.id}`,
                    read: false,
                    icon: <PackageX className="h-4 w-4 text-destructive" />
                });
            }
        });
    });
    return expired;
  }, [inventory]);

  const billsDueSoonNotifications = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    const today = new Date();
    return billInstances
        .filter(instance => {
            if (instance.status === 'paid') return false;
            const dueDate = parseISO(instance.dueDate);
            const daysUntilDue = differenceInDays(dueDate, today);
            return daysUntilDue >= 0 && daysUntilDue <= 7;
        })
        .map(instance => {
            const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
            const daysUntilDue = differenceInDays(parseISO(instance.dueDate), today);
            const dueText = daysUntilDue === 0 ? 'is due today' : `is due in ${daysUntilDue} days`;
            return {
                id: `bill-due-${instance.id}`,
                type: 'bill',
                message: `Bill Due: '${definition?.name || 'A bill'}' ${dueText}.`,
                link: '/bills',
                read: false,
                icon: <Landmark className="h-4 w-4 text-orange-500" />
            };
        });
  }, [billInstances, billDefinitions]);
  
  useEffect(() => {
    const handleNewIncident = ({ clientName, clientId, incidentType }: { clientName: string, clientId: string, incidentType: string }) => {
      const newNotification: Notification = {
        id: `incident-${Date.now()}`,
        type: 'incident',
        message: `New incident for ${clientName}: ${incidentType}`,
        link: `/clients/${clientId}`,
        read: false,
        icon: <ShieldAlert className="h-4 w-4 text-orange-500" />,
      };
      setNotifications(prev => [newNotification, ...prev]);
    };
    
    const handleNewEventRequest = ({ staffName, eventTitle, eventId }: { staffName: string; eventTitle: string; eventId: string }) => {
      const newNotification: Notification = {
        id: `event-request-${eventId}`,
        type: 'event-request',
        message: `${staffName} requested time off for "${eventTitle}".`,
        link: '/planner',
        read: false,
        icon: <Calendar className="h-4 w-4 text-purple-500" />,
      };
      setNotifications(prev => [newNotification, ...prev.filter(n => n.id !== newNotification.id)]);
    };
    
    errorEmitter.on('incident-reported', handleNewIncident);
    errorEmitter.on('event-request', handleNewEventRequest);
    
    return () => {
      errorEmitter.off('incident-reported', handleNewIncident);
      errorEmitter.off('event-request', handleNewEventRequest);
    }
  }, []);

  useEffect(() => {
    const backgroundNotifs = [
        ...licenseNotifications,
        ...lowStockNotifications,
        ...expiredStockNotifications,
        ...billsDueSoonNotifications,
    ];

    setNotifications(currentNotifs => {
        const realTimeNotifs = currentNotifs.filter(n => n.type === 'incident' || n.type === 'event-request');
        const notifMap = new Map<string | number, Notification>();
        
        realTimeNotifs.forEach(n => notifMap.set(n.id, n));
        
        backgroundNotifs.forEach(n => {
            if (!notifMap.has(n.id)) {
                 notifMap.set(n.id, { ...n, read: notifMap.has(n.id) ? notifMap.get(n.id)!.read : false });
            }
        });

        const backgroundIds = new Set(backgroundNotifs.map(n => n.id));
        currentNotifs.forEach(n => {
            if (n.type !== 'incident' && n.type !== 'event-request' && !backgroundIds.has(n.id)) {
                notifMap.delete(n.id);
            }
        });
            
        return Array.from(notifMap.values()).sort((a,b) => (a.read ? 1 : 0) - (b.read ? 1 : 0));
    });
    
  }, [licenseNotifications, lowStockNotifications, expiredStockNotifications, billsDueSoonNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = (id: number | string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };
  
  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({...n, read: true})));
  }

  const handleLogout = async () => {
    if (auth) {
        await signOut(auth);
        router.push('/login');
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border/20 bg-background/80 px-4 backdrop-blur-sm md:px-6 print:hidden">
      <div className="flex flex-1 items-center gap-2">
        <SidebarTrigger />
        <div className="hidden lg:flex relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
                placeholder="Search menu, orders and more" 
                className="pl-9 bg-card focus:bg-background"
            />
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
                <div className="flex items-center gap-3 cursor-pointer">
                    <Avatar className="h-9 w-9">
                        <AvatarImage src={user?.photoURL || ''} alt="User" />
                        <AvatarFallback>{user?.displayName?.charAt(0) || 'U'}</AvatarFallback>
                    </Avatar>
                    <div className="hidden sm:flex flex-col items-start">
                        <p className="text-sm font-semibold">{user?.displayName || 'Admin'}</p>
                        <p className="text-xs text-muted-foreground">Admin</p>
                    </div>
                </div>
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
              <DropdownMenuItem onClick={handleLogout}>
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
