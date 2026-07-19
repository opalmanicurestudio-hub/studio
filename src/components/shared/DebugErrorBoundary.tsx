'use client';

// src/components/shared/DebugErrorBoundary.tsx
//
// Catches render crashes in its children and shows WHAT broke instead of
// the blank "Application error" page — the component name and message are
// right there to copy. Add this file ONLY if your build says
// "Module not found: Can't resolve '@/components/shared/DebugErrorBoundary'".

import React from 'react';

type State = { error: Error | null };

export class DebugErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[DebugErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-4 p-4 rounded-xl border-2 border-red-200 bg-red-50 text-left">
          <p className="text-sm font-semibold text-red-700">Something crashed here</p>
          <p className="text-xs text-red-600 mt-1 font-mono break-all">{String(this.state.error?.message || this.state.error)}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 h-9 px-4 rounded-lg bg-red-600 text-white text-xs font-semibold"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default DebugErrorBoundary;
