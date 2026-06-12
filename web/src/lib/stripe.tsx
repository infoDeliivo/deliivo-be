'use client';

import { ReactNode } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, Stripe } from '@stripe/stripe-js';

const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe() {
  if (!stripePromise && STRIPE_PK) {
    stripePromise = loadStripe(STRIPE_PK);
  }
  return stripePromise;
}

export function StripeProvider({ children }: { children: ReactNode }) {
  const stripe = getStripe();
  if (!stripe) {
    return <>{children}</>;
  }
  return (
    <Elements stripe={stripe} options={{ appearance: { theme: 'stripe' } }}>
      {children}
    </Elements>
  );
}
