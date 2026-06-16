import { redirect } from 'next/navigation';

export default function StripeConnectReturnPage() {
  redirect('/profile/earnings?stripe_connect=return');
}
