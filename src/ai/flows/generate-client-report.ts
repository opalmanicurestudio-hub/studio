'use server';
/**
 * @fileOverview Generates a client report using AI.
 *
 * - generateClientReport - A function that generates a client report.
 * - GenerateClientReportInput - The input type for the generateClientReport function.
 * - GenerateClientReportOutput - The return type for the generateClientReport function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

export const GenerateClientReportInputSchema = z.object({
  clientName: z.string().describe('The name of the client.'),
  totalAppointments: z.number().describe('Total number of completed appointments.'),
  lifetimeValue: z.number().describe('Total money spent by the client.'),
  lastSeen: z.string().describe('Date of the last appointment.'),
  memberSince: z.string().describe('Date of the first appointment.'),
  hasIncidents: z.boolean().describe('Whether the client has any recorded incidents.'),
  hasAllergies: z.boolean().describe('Whether the client has any recorded allergies.'),
  hasMedicalNotes: z.boolean().describe('Whether the client has any recorded medical notes.'),
  clientNotes: z.string().optional().describe('General notes about the client.'),
});
export type GenerateClientReportInput = z.infer<typeof GenerateClientReportInputSchema>;

export const GenerateClientReportOutputSchema = z.object({
  summary: z.string().describe('A concise, professional summary of the client. Highlight key information like their value, loyalty, and any important alerts.'),
  talkingPoints: z.array(z.string()).describe('Three conversational talking points or questions to engage the client during their next visit, based on their history and notes.'),
});
export type GenerateClientReportOutput = z.infer<typeof GenerateClientReportOutputSchema>;

export async function generateClientReport(input: GenerateClientReportInput): Promise<GenerateClientReportOutput> {
  return clientReportFlow(input);
}

const prompt = ai.definePrompt({
  name: 'clientReportPrompt',
  input: {schema: GenerateClientReportInputSchema},
  output: {schema: GenerateClientReportOutputSchema},
  prompt: `You are an expert assistant for a solo service professional. Generate a client report for {{clientName}}.

Client Data:
- Total Completed Appointments: {{totalAppointments}}
- Lifetime Value: \${{lifetimeValue}}
- Last Seen: {{lastSeen}}
- Member Since: {{memberSince}}
- Key Information:
  - Has Incidents: {{#if hasIncidents}}Yes{{else}}No{{/if}}
  - Has Allergies: {{#if hasAllergies}}Yes{{else}}No{{/if}}
  - Has Medical Notes: {{#if hasMedicalNotes}}Yes{{else}}No{{/if}}
- Notes: {{clientNotes}}

Based on this data, provide a concise professional summary and three conversational talking points for their next appointment.
The summary should be a brief paragraph.
The talking points should be open-ended questions to encourage conversation.
`,
});

const clientReportFlow = ai.defineFlow(
  {
    name: 'clientReportFlow',
    inputSchema: GenerateClientReportInputSchema,
    outputSchema: GenerateClientReportOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
