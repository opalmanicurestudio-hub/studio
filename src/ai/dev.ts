
'use server';
import { config } from 'dotenv';
config();

import '@/ai/flows/end-of-day-debrief.ts';
import '@/ai/flows/generate-client-report.ts';
