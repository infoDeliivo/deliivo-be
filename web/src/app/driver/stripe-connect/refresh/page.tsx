import { redirect } from 'next/navigation';

export default function StripeConnectRefreshPage() {
  redirect('/profile/earnings?stripe_connect=refresh');
}
