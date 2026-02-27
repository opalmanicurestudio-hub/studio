
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
import { Bell, LifeBuoy, LogOut, Settings, User, CreditCard, Check, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { ClientOnly } from './ClientOnly';
import { useUser, useAuth } from '@/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useNotifications, type Notification } from '@/context/NotificationContext';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useMemo } from 'react';

export function AppHeader({ title }: { title?: string }) {
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const { role } = useTenant();
  const { staff } = useInventory();
  
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearReadNotifications } = useNotifications();
  const hasReadNotifications = notifications.some(n => n.read);
  const hasUnread = unreadCount > 0;

  const handleLogout = async () => {
    if (auth) {
        await signOut(auth);
        router.push('/login');
    }
  };

  const staffMember = useMemo(() => {
    if (role !== 'staff' || !user || !staff) return null;
    return staff.find(s => s.id === user.uid);
  }, [user, staff, role]);

  const displayName = role === 'staff' ? staffMember?.name : user?.displayName;
  const avatarUrl = role === 'staff' ? staffMember?.avatarUrl : user?.photoURL;

  const getInitials = (name?: string | null): string => {
    if (!name) return 'U';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length > 1) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };
  const initials = getInitials(displayName);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border/20 bg-background/80 px-4 backdrop-blur-sm md:px-6 print:hidden">
      <div className="flex flex-1 items-center gap-2">
        <SidebarTrigger />
        <h1 className="text-xl font-semibold md:text-2xl">{title}</h1>
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
                      {hasUnread && (
                        <Button variant="link" size="xs" className="p-0 h-auto" onClick={markAllAsRead}>Mark all as read</Button>
                      )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {notifications.length > 0 ? (
                    <>
                        {notifications.map(notification => (
                            <DropdownMenuItem key={notification.id} className={`flex items-start gap-3 p-2 ${notification.read ? 'opacity-70' : 'bg-primary/5'}`}>
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
                        ))}
                        {hasReadNotifications && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="p-1">
                                    <Button variant="secondary" size="sm" className="w-full" onClick={clearReadNotifications}>
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Clear Read Notifications
                                    </Button>
                                </DropdownMenuItem>
                            </>
                        )}
                    </>
                  ) : (
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
                        <AvatarImage src={avatarUrl || undefined} alt="User" />
                        <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="hidden sm:flex flex-col items-start">
                        <p className="text-sm font-semibold">{displayName || 'Admin'}</p>
                        <p className="text-xs text-muted-foreground capitalize">{role}</p>
                    </div>
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {role === 'owner' && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/staff" className="flex items-center w-full">
                      <Users className="w-4 h-4 mr-2" />
                      <span>Staff</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/settings" className="flex items-center w-full">
                      <Settings className="w-4 h-4 mr-2" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/subscriptions" className="flex items-center w-full">
                      <CreditCard className="w-4 h-4 mr-2" />
                      <span>Billing</span>
                    </Link>
                  </DropdownMenuItem>
                   <DropdownMenuItem>
                    <LifeBuoy className="w-4 h-4 mr-2" />
                    <span>Support</span>
                  </DropdownMenuItem>
                </>
              )}
              {role === 'staff' && (
                 <DropdownMenuItem asChild>
                    <Link href={`/staff/${user?.uid}`} className="flex items-center w-full">
                      <User className="w-4 h-4 mr-2" />
                      <span>Public Profile</span>
                    </Link>
                  </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    </header>
  );
}
