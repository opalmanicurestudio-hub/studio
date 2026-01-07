'use server';

/**
 * @fileOverview An end-of-day debrief AI agent for solo service professionals.
 *
 * - endOfDayDebrief - A function that generates an end-of-day debrief.
 * - EndOfDayDebriefInput - The input type for the endOfDayDebrief function.
 * - EndOfDayDebriefOutput - The return type for the endOfDayDebrief function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EndOfDayDebriefInputSchema = z.object({
  dailyRevenue: z
    .number()
    .describe('The total revenue generated for the day.'),
  dailyExpenses: z
    .number()
    .describe('The total expenses incurred for the day.'),
  inventoryLevels: z
    .record(z.string(), z.number())
    .describe(
      'A record of inventory items and their current levels. The keys are the item names, and the values are the current stock levels for each item.'
    ),
  completedAppointments: z
    .number()
    .describe('The number of appointments completed for the day.'),
});
export type EndOfDayDebriefInput = z.infer<typeof EndOfDayDebriefInputSchema>;

const EndOfDayDebriefOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      'A summary of the days profits, losses and any inventory needs.'
    ),
});
export type EndOfDayDebriefOutput = z.infer<typeof EndOfDayDebriefOutputSchema>;

export async function endOfDayDebrief(input: EndOfDayDebriefInput): Promise<EndOfDayDebriefOutput> {
  return endOfDayDebriefFlow(input);
}

const prompt = ai.definePrompt({
  name: 'endOfDayDebriefPrompt',
  input: {schema: EndOfDayDebriefInputSchema},
  output: {schema: EndOfDayDebriefOutputSchema},
  prompt: `You are an AI assistant designed to provide end-of-day debriefs for solo service professionals, helping them track their daily performance and make informed decisions.

  Today's Performance:
  - Daily Revenue: ${'{{dailyRevenue}}'}
  - Daily Expenses: ${'{{dailyExpenses}}'}
  - Completed Appointments: ${'{{completedAppointments}}'}

  Inventory Levels:
  {{#each (Object.entries inventoryLevels)}}
  - {{@key}}: {{this.[1]}}
  {{/each}}

  Please provide a concise summary of the day's profits, losses, and any inventory needs based on the provided information. Focus on actionable insights to help the professional improve their business.`,
});

const endOfDayDebriefFlow = ai.defineFlow(
  {
    name: 'endOfDayDebriefFlow',
    inputSchema: EndOfDayDebriefInputSchema,
    outputSchema: EndOfDayDebriefOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
