'use client';

import React from 'react';

export class DebugErrorBoundary extends React.Component
  { children: React.ReactNode },
  { error: Error | null; componentStack: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[DebugErrorBoundary] error:', error.message);
    console.error('[DebugErrorBoundary] component stack:', info.componentStack);
    this.setState({ componentStack: info.componentStack || null });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, background: '#fee', border: '2px solid red', borderRadius: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11 }}>
          <p style={{ fontWeight: 900, marginBottom: 8 }}>{this.state.error.message}</p>
          <p>{this.state.componentStack}</p>
        </div>
      );
    }
    return this.props.children;
  }
}