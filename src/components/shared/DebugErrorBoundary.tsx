'use client';
import React from 'react';

export class DebugErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppointmentDetailsSheet crash]', error.message);
    console.error('[component stack]', info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
          Couldn't load this appointment. Please try again.
        </div>
      );
    }
    return this.props.children;
  }
}
