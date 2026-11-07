'use client';
// src/app/(app)/settings/forms/form/page.tsx — ONE FORM, IN THE FORM BUILDER (Settings › Forms and documents, board
// FormsBuilder). ?id=<form> opens that form; ?new=1 starts a new one. The screen is components/consents/FormBuilder.
import { FormBuilderPage } from '@/components/consents/FormBuilder';

export default function FormSettingsPage() {
  return <FormBuilderPage />;
}
