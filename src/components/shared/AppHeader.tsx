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
import { Bell, LifeBuoy, LogOut, Settings, User, CreditCard, Check } from 'lucide-react';
import Link from 'next/link';
import { ClientOnly } from './ClientOnly';
import { useUser, useAuth } from '@/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useNotifications, type Notification } from '@/context/NotificationContext';
import { useTenant } from '@/context/TenantContext';

export function AppHeader({ title }: { title?: string }) {
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const { role } = useTenant();
  
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();

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
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut />
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    </header>
  );
}
