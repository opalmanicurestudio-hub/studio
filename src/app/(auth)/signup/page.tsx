'use client';

import { useState } from 'react';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Loader, Sparkles, Building, User, ArrowRight, ArrowLeft, Users, Phone } from 'lucide-react';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { getAuth, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import Link from 'next/link';
import { getFirestore, doc, collection, writeBatch } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { PhoneInput } from '@/components/ui/phone-input';

const signupSchema = z.object({
  // Step 1: Identity
  name: z.string().min(2, 'Name must be at least 2 characters.'),
  email: z.string().email('Invalid email address.'),
  phone: z.string().min(5, 'Phone number is required for verification.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  confirmPassword: z.string(),
  // Step 2: Business
  businessName: z.string().min(2, 'Business name is required.'),
  category: z.enum(['hair', 'skin', 'nails', 'fitness', 'tattoo', 'other']),
  teamSize: z.enum(['solo', 'team']),
}).superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
        ctx.addIssue({
            code: "custom",
            message: "The passwords do not match",
            path: ['confirmPassword'],
        });
    }
});

type SignupFormData = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1);

  const methods = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
        category: 'hair',
        teamSize: 'solo',
    }
  });

  const {
    register,
    handleSubmit,
    control,
    trigger,
    formState: { errors },
    watch
  } = methods;

  const handleNext = async () => {
    let fieldsToValidate: (keyof SignupFormData)[] = [];
    if (step === 1) fieldsToValidate = ['name', 'email', 'phone', 'password', 'confirmPassword'];
    
    const isValid = await trigger(fieldsToValidate);
    if (isValid) setStep(step + 1);
  };

  const handleBack = () => setStep(step - 1);

  const onSubmit = async (data: SignupFormData) => {
    setIsLoading(true);
    const auth = getAuth();
    const db = getFirestore();
    const batch = writeBatch(db);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, data.email, data.password);
      
      await updateProfile(userCredential.user, {
        displayName: data.name
      });
      
      const userId = userCredential.user.uid;
      const tenantId = nanoid();
      
      // Initialize User Document
      const userDocRef = doc(db, "users", userId);
      batch.set(userDocRef, {
          id: userId,
          email: data.email,
          phone: data.phone,
          firstName: data.name.split(' ')[0],
          lastName: data.name.split(' ').slice(1).join(' '),
          createdAt: new Date().toISOString()
      });

      const tenantDocRef = doc(db, "tenants", tenantId);
      
      // Initialize Tenant
      batch.set(tenantDocRef, {
        id: tenantId,
        name: data.businessName,
        userId: userId,
        category: data.category,
        subscriptionStatus: "inactive",
        subscriptionTier: "none",
        tmhr: 50, 
        createdAt: new Date().toISOString(),
        onboardingComplete: false,
        bookingPageSettings: {
            heroTitle: `Welcome to ${data.businessName}`,
            primaryColor: '#7955c4',
            showTeam: data.teamSize === 'team',
            servicesSectionTitle: 'The Menu'
        }
      });

      // Initialize default Lifestyle Profile for TMHR
      const lifestyleRef = doc(db, `tenants/${tenantId}/lifestyleProfiles`, nanoid());
      batch.set(lifestyleRef, {
          id: lifestyleRef.id,
          name: 'Primary Lifestyle',
          isActive: true,
          categories: []
      });

      // Initialize default Business Profile for TMHR
      const businessProfRef = doc(db, `tenants/${tenantId}/businessProfiles`, nanoid());
      batch.set(businessProfRef, {
          id: businessProfRef.id,
          name: 'Core Studio Costs',
          isActive: true,
          categories: []
      });

      // Initialize default Schedule
      const scheduleRef = doc(db, `tenants/${tenantId}/scheduleProfiles`, nanoid());
      batch.set(scheduleRef, {
          id: scheduleRef.id,
          name: 'Standard Studio Hours',
          isActive: true,
          isPublic: true,
          week: {
              monday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
              tuesday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
              wednesday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
              thursday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
              friday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
              saturday: { enabled: false, start: '09:00 AM', end: '05:00 PM' },
              sunday: { enabled: false, start: '09:00 AM', end: '05:00 PM' },
          },
          timeOff: { vacationDays: 14, holidays: 10 }
      });

      await batch.commit();

      toast({
        title: 'Account Initialized',
        description: 'Welcome to ClarityFlow. Let\'s get started.',
      });

      router.push('/dashboard');
    } catch (error: any) {
      console.error(error);
      let description = 'An unexpected error occurred. Please try again.';
      if (error.code === 'auth/email-already-in-use') {
        description = 'This email is already in use. Please log in instead.';
      }
      toast({
        variant: 'destructive',
        title: 'Initialization Failed',
        description: description,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg">
        <div className="flex justify-center mb-8">
            <div className="p-4 bg-white rounded-[1.5rem] shadow-xl border-2 border-primary/10">
                <ClarityFlowLogo className="w-12 h-12" />
            </div>
        </div>
        
        <Card className="border-4 rounded-[3rem] shadow-3xl overflow-hidden bg-white/80 backdrop-blur-xl">
            <CardHeader className="p-8 pb-4 text-center border-b bg-muted/5">
                <div className="flex items-center justify-center gap-3 mb-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Strategic Onboarding</span>
                </div>
                <CardTitle className="text-3xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                    {step === 1 ? 'Creator Identity' : 'Studio Matrix'}
                </CardTitle>
                <div className="mt-6 flex justify-center gap-2">
                    {[1, 2].map((i) => (
                        <div key={i} className={cn("h-1.5 rounded-full transition-all duration-500", i === step ? "w-8 bg-primary" : "w-4 bg-muted")} />
                    ))}
                </div>
            </CardHeader>

            <CardContent className="p-8 md:p-10">
                <FormProvider {...methods}>
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
                        <AnimatePresence mode="wait">
                            {step === 1 && (
                                <motion.div 
                                    initial={{ opacity: 0, x: 20 }} 
                                    animate={{ opacity: 1, x: 0 }} 
                                    exit={{ opacity: 0, x: -20 }}
                                    key="step1"
                                    className="space-y-6"
                                >
                                    <div className="space-y-2 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Legal Name</Label>
                                        <div className="relative">
                                            <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                            <Input placeholder="ALEXANDER SMITH" {...register('name')} className="h-14 pl-12 rounded-2xl border-2 font-black uppercase text-lg shadow-inner focus-visible:ring-primary/20" />
                                        </div>
                                        {errors.name && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
                                    </div>
                                    <div className="space-y-2 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Mobile Contact</Label>
                                        <div className="relative">
                                            <PhoneInput name="phone" label="" className="h-14 kiosk-phone-input" />
                                        </div>
                                        {errors.phone && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.phone.message}</p>}
                                    </div>
                                    <div className="space-y-2 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Secure Email</Label>
                                        <Input type="email" placeholder="ALEX@EXAMPLE.COM" {...register('email')} className="h-14 rounded-2xl border-2 font-bold shadow-inner focus-visible:ring-primary/20" />
                                        {errors.email && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.email.message}</p>}
                                    </div>
                                    <div className="space-y-2 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Master Password</Label>
                                        <Input type="password" {...register('password')} className="h-14 rounded-2xl border-2 font-bold shadow-inner focus-visible:ring-primary/20" />
                                        {errors.password && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.password.message}</p>}
                                    </div>
                                    <div className="space-y-2 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Confirm Identity</Label>
                                        <Input type="password" {...register('confirmPassword')} className="h-14 rounded-2xl border-2 font-bold shadow-inner focus-visible:ring-primary/20" />
                                        {errors.confirmPassword && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.confirmPassword.message}</p>}
                                    </div>
                                </motion.div>
                            )}

                            {step === 2 && (
                                <motion.div 
                                    initial={{ opacity: 0, x: 20 }} 
                                    animate={{ opacity: 1, x: 0 }} 
                                    exit={{ opacity: 0, x: -20 }}
                                    key="step2"
                                    className="space-y-8"
                                >
                                    <div className="space-y-2 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Business Label</Label>
                                        <div className="relative">
                                            <Building className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                            <Input placeholder="e.g., STUDIO NOIR" {...register('businessName')} className="h-14 pl-12 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner focus-visible:ring-primary/20" />
                                        </div>
                                        {errors.businessName && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.businessName.message}</p>}
                                    </div>

                                    <div className="space-y-3 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Specialty Vertical</Label>
                                        <Controller
                                            name="category"
                                            control={control}
                                            render={({ field }) => (
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                        <SelectItem value="hair" className="font-bold uppercase text-[10px] tracking-widest">HAIRSTYLING & COLOR</SelectItem>
                                                        <SelectItem value="skin" className="font-bold uppercase text-[10px] tracking-widest">SKINCARE & ESTHETICS</SelectItem>
                                                        <SelectItem value="nails" className="font-bold uppercase text-[10px] tracking-widest">NAIL ARTISTRY</SelectItem>
                                                        <SelectItem value="fitness" className="font-bold uppercase text-[10px] tracking-widest">FITNESS & WELLNESS</SelectItem>
                                                        <SelectItem value="tattoo" className="font-bold uppercase text-[10px] tracking-widest">TATTOO & BODY ART</SelectItem>
                                                        <SelectItem value="other" className="font-bold uppercase text-[10px] tracking-widest">OTHER MASTER CRAFT</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                    </div>

                                    <div className="space-y-3 text-left">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Operational Model</Label>
                                        <Controller
                                            name="teamSize"
                                            control={control}
                                            render={({ field }) => (
                                                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-4">
                                                    <label htmlFor="solo-mode" className="cursor-pointer">
                                                        <div className={cn(
                                                            "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all",
                                                            field.value === 'solo' ? "border-primary bg-primary/5 shadow-lg" : "border-border/50 bg-white hover:border-primary/20"
                                                        )}>
                                                            <User className={cn("mb-2 h-8 w-8", field.value === 'solo' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                            <span className="text-[10px] font-black uppercase tracking-widest">Solo Master</span>
                                                            <RadioGroupItem value="solo" id="solo-mode" className="sr-only" />
                                                        </div>
                                                    </label>
                                                    <label htmlFor="team-mode" className="cursor-pointer">
                                                        <div className={cn(
                                                            "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all",
                                                            field.value === 'team' ? "border-primary bg-primary/5 shadow-lg" : "border-border/50 bg-white hover:border-primary/20"
                                                        )}>
                                                            <Users className={cn("mb-2 h-8 w-8", field.value === 'team' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                            <span className="text-[10px] font-black uppercase tracking-widest">Studio Team</span>
                                                            <RadioGroupItem value="team" id="team-mode" className="sr-only" />
                                                        </div>
                                                    </label>
                                                </RadioGroup>
                                            )}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </form>
                </FormProvider>
            </CardContent>

            <CardFooter className="p-8 pt-0 flex flex-col gap-4">
                <div className="flex w-full gap-3">
                    {step > 1 && (
                        <Button variant="ghost" onClick={handleBack} type="button" className="flex-1 h-14 font-black uppercase tracking-widest text-[10px] text-slate-400">
                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                        </Button>
                    )}
                    {step < 2 ? (
                        <Button onClick={handleNext} className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 group transition-all">
                            Continue <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </Button>
                    ) : (
                        <Button 
                            onClick={handleSubmit(onSubmit)} 
                            disabled={isLoading} 
                            className="flex-[2] h-16 rounded-[2rem] text-xl font-black uppercase tracking-tight shadow-3xl shadow-primary/30 active:scale-95 transition-all"
                        >
                            {isLoading ? <Loader className="animate-spin h-6 w-6" /> : 'Initialize Studio'}
                        </Button>
                    )}
                </div>
                <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">
                    Already registered? <Link href="/login" className="text-primary underline decoration-2 underline-offset-4">Access Portal</Link>
                </p>
            </CardFooter>
        </Card>
    </div>
  );
}
