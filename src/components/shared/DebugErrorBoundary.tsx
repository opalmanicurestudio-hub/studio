'use client';

import React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null; componentStack: string | null };

export class DebugErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppointmentDetailsSheet crash]', error.message);
    console.error('[component stack]', info.componentStack);
    this.setState({ componentStack: info.componentStack || null });
  }

  render() {
    if (this.state.error) {
      const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=1');

      if (isDebug) {
        return (
          <div style={{ padding: 20, background: '#fee', border: '2px solid red', borderRadius: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11, margin: 16 }}>
            <p style={{ fontWeight: 900, marginBottom: 8 }}>{this.state.error.message}</p>
            <p>{this.state.componentStack}</p>
          </div>
        );
      }

      return (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
          Couldn't load this appointment. Please try again.
        </div>
      );
    }
    return this.props.children;
  }
}
