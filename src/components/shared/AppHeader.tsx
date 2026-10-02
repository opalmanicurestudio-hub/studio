'use client';

import { AppSearch } from '@/components/shared/AppSearch';
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
import { Bell, LifeBuoy, LogOut, Settings, User, CreditCard, Check, Trash2, Users, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ClientOnly } from './ClientOnly';
import { useUser, useAuth } from '@/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@/context/NotificationContext';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

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
    <header className="sticky top-3 z-30 mx-3 mt-3 flex h-14 items-center justify-between gap-3 rounded-[22px] bg-white/95 px-3 shadow-[0_1px_2px_rgba(28,25,23,.05),0_10px_32px_rgba(28,25,23,.07)] backdrop-blur-xl md:h-[60px] md:px-4 print:hidden dark:bg-[#211d1a]/95">
      <div className="flex min-w-0 items-center gap-2 md:w-[220px]">
        <SidebarTrigger className="hover:bg-primary/10 transition-colors" />
        {title && (
          <h1 className="truncate text-[17px] font-semibold tracking-tight md:text-[19px]">
            {title}
          </h1>
        )}
      </div>
      <div className="hidden flex-1 justify-center md:flex"><AppSearch /></div>
      
      <div className="flex items-center gap-2 md:gap-6">
        <ClientOnly>
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full relative hover:bg-primary/5 transition-all h-10 w-10">
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                          <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary border-2 border-background"></span>
                          </span>
                      )}
                      <span className="sr-only">Toggle notifications</span>
                  </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 md:w-96 rounded-2xl shadow-lg border border-[#e7e2dc] p-0 overflow-hidden bg-[#faf8f5] dark:border-[#342e29] dark:bg-[#171412]">
                  <DropdownMenuLabel className="flex justify-between items-center px-5 py-4 border-b border-[#e7e2dc] dark:border-[#342e29]">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <span className="text-[15px] font-semibold">Notifications</span>
                      </div>
                      {hasUnread && (
                        <Button 
                          variant="ghost" 
                          size="xs" 
                          className="h-8 px-3 text-[13px] text-primary rounded-full hover:bg-primary/5" 
                          onClick={markAllAsRead}
                        >
                          Clear Alerts
                        </Button>
                      )}
                  </DropdownMenuLabel>
                  <div className="max-h-[450px] overflow-y-auto">
                    {notifications.length > 0 ? (
                        <div className="divide-y-2 divide-dashed divide-border/50">
                            {notifications.map(notification => (
                                <DropdownMenuItem 
                                  key={notification.id} 
                                  className={cn(
                                    "flex items-start gap-4 p-5 transition-all focus:bg-primary/[0.03] cursor-pointer", 
                                    notification.read ? 'opacity-40 grayscale-[0.5]' : 'bg-primary/[0.01]'
                                  )}
                                >
                                    <div className="mt-1 p-2 bg-background rounded-xl border shadow-inner shrink-0">{notification.icon}</div>
                                    <Link href={notification.link || '#'} className="flex-1 space-y-1 min-w-0">
                                        <p className="text-[14px] leading-snug line-clamp-2">{notification.message}</p>
                                        <p className="text-[12px] text-muted-foreground">Tap to open</p>
                                    </Link>
                                    {!notification.read && (
                                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full hover:bg-primary/10 hover:text-primary" onClick={(e) => { e.stopPropagation(); markAsRead(notification.id); }}>
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    )}
                                </DropdownMenuItem>
                            ))}
                        </div>
                    ) : (
                        <div className="p-16 text-center space-y-4">
                            <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mx-auto shadow-inner">
                                <Sparkles className="w-8 h-8 text-primary/20" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-[15px] font-medium">You’re all caught up</p>
                                <p className="text-[13.5px] text-muted-foreground">Nothing needs you right now.</p>
                            </div>
                        </div>
                    )}
                  </div>
                  {hasReadNotifications && (
                    <div className="p-4 bg-muted/5 border-t">
                        <Button variant="outline" size="sm" className="w-full h-10 rounded-full text-[13px] border" onClick={clearReadNotifications}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Purge History
                        </Button>
                    </div>
                  )}
              </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
        
        <ClientOnly>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <div className="flex items-center gap-3 cursor-pointer group transition-all">
                    <div className="hidden sm:flex flex-col items-end">
                        <p className="text-[14px] font-medium leading-none">{displayName || 'Admin'}</p>
                        <p className="mt-1 text-[12px] capitalize leading-none text-muted-foreground">{role}</p>
                    </div>
                    <Avatar className="h-9 w-9 rounded-full">
                        <AvatarImage src={avatarUrl || undefined} alt="User" className="object-cover" />
                        <AvatarFallback className="text-[12px] font-semibold bg-primary/10 text-primary">{initials}</AvatarFallback>
                    </Avatar>
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-2xl shadow-lg border border-[#e7e2dc] p-1.5 overflow-hidden bg-[#faf8f5] dark:border-[#342e29] dark:bg-[#171412]">
              <DropdownMenuLabel className="px-3 py-2 text-[12px] font-normal text-muted-foreground">Signed in as {displayName || 'Admin'}</DropdownMenuLabel>
              {role === 'owner' && (
                <div className="space-y-1">
                  <DropdownMenuItem asChild className="rounded-xl h-10 focus:bg-primary/5 focus:text-primary cursor-pointer">
                    <Link href="/staff" className="flex items-center w-full text-[14px]">
                      <Users className="w-4 h-4 mr-3 text-primary opacity-40" />
                      <span>Your team</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="rounded-xl h-10 focus:bg-primary/5 focus:text-primary cursor-pointer">
                    <Link href="/settings" className="flex items-center w-full text-[14px]">
                      <Settings className="w-4 h-4 mr-3 text-primary opacity-40" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="rounded-xl h-10 focus:bg-primary/5 focus:text-primary cursor-pointer">
                    <Link href="/subscriptions" className="flex items-center w-full text-[14px]">
                      <CreditCard className="w-4 h-4 mr-3 text-primary opacity-40" />
                      <span>Plan & billing</span>
                    </Link>
                  </DropdownMenuItem>
                </div>
              )}
              <DropdownMenuSeparator className="mx-1 my-2" />
              <DropdownMenuItem 
                onClick={handleLogout} 
                className="rounded-xl h-10 text-[14px] text-destructive focus:bg-destructive/5 focus:text-destructive cursor-pointer"
              >
                <LogOut className="w-4 h-4 mr-3" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    </header>
  );
}
