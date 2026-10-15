'use client';
// Pages shown inside a hub (e.g. Team) skip their own header — the hub draws one.
import * as React from 'react';
export const InHub = React.createContext(false);
