'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Car, CheckCircle, Loader2, MessageCircle, PawPrint, Star, User } from 'lucide-react';
import Navbar from '@/components/Navbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { userApi } from '@/lib/api';
import { useTranslation } from '@/lib/i18n-context';

type PublicProfile = {
  user: {
    id: string;
    name: string | null;
    nickName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
    memberSince: string;
  };
  travelPreference?: { chattiness: string | null; pets: string | null } | null;
  vehicle?: { brand: string | null; model_num: string | null; type: string | null; color: string | null; isVerified: boolean } | null;
  stats?: {
    totalRides: number;
    totalBookings: number;
    successfulPublishedRides?: number;
    successfulCompletedRides?: number;
    memberSince: string;
  };
  rating?: { average: number | null; total: number; label: string | null };
};

export default function PublicProfilePage() {
  return (
    <ProtectedRoute>
      <Navbar />
      <PublicProfileContent />
    </ProtectedRoute>
  );
}

function PublicProfileContent() {
  const params = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!params.id) return;
    setLoading(true);
    userApi.getPublicProfile(params.id)
      .then((res) => setProfile(res.data as unknown as PublicProfile))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('profile.publicProfileLoadFailed')))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-deliivo-cream"><Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" /></div>;
  }

  if (error || !profile) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/search" className="inline-flex items-center gap-1 text-sm text-deliivo-gray hover:text-deliivo-dark"><ArrowLeft className="h-4 w-4" /> {t('common.back')}</Link>
        <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-red-600">{error || t('profile.publicProfileNotFound')}</p>
        </div>
      </main>
    );
  }

  const name = profile.user.name || 'User';
  const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const memberSinceSource = profile.user.memberSince || profile.stats?.memberSince;
  const memberSince = memberSinceSource ? new Date(memberSinceSource).getFullYear() : 'recently';

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/search" className="inline-flex items-center gap-1 text-sm text-deliivo-gray hover:text-deliivo-dark"><ArrowLeft className="h-4 w-4" /> {t('common.back')}</Link>

      <section className="mt-5 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-primary-100">
            {profile.user.avatarUrl ? <img src={profile.user.avatarUrl} alt={name} className="h-full w-full object-cover" /> : <User className="h-8 w-8 text-primary-500" />}
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-deliivo-dark">{name || initials}</h1>
              {profile.user.isVerified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                  <CheckCircle className="h-3 w-3" /> {t('profile.verified')}
                </span>
              )}
            </div>
            {profile.user.nickName && <p className="mt-1 text-sm text-deliivo-gray">@{profile.user.nickName}</p>}
            <p className="mt-1 text-xs text-deliivo-gray">{t('profile.memberSince', { memberSince })}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metric label={t('profile.rating')} value={profile.rating?.average ? `${profile.rating.average.toFixed(1)} / 5` : t('profile.noRatings')} sub={t('profile.reviewsCount', { total: profile.rating?.total || 0, plural: (profile.rating?.total || 0) !== 1 ? 's' : '' })} icon="star" />
          <Metric label={t('profile.successfulDrives')} value={String(profile.stats?.successfulPublishedRides || 0)} sub={t('profile.ridesPublished', { total: profile.stats?.totalRides || 0 })} />
          <Metric label={t('profile.successfulRides')} value={String(profile.stats?.successfulCompletedRides || 0)} sub={t('profile.bookingsMade', { total: profile.stats?.totalBookings || 0 })} />
        </div>
      </section>

      <section className="mt-5 grid gap-5 sm:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-deliivo-dark"><Car className="h-4 w-4 text-deliivo-orange" /> {t('profile.vehicle')}</h2>
          {profile.vehicle ? (
            <div className="mt-3 text-sm text-deliivo-dark">
              <p className="font-medium">{[profile.vehicle.brand, profile.vehicle.model_num].filter(Boolean).join(' ') || profile.vehicle.type || 'Vehicle'}</p>
              <p className="mt-1 text-deliivo-gray">{profile.vehicle.color || t('profile.colorNotSet')}</p>
              <p className="mt-2 text-xs text-deliivo-gray">{profile.vehicle.isVerified ? t('profile.verifiedVehicle') : t('profile.vehicleNotVerifiedYet')}</p>
            </div>
          ) : <p className="mt-3 text-sm text-deliivo-gray">{t('profile.noPublicVehicle')}</p>}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-deliivo-dark">{t('profile.travelPreference')}</h2>
          <div className="mt-3 space-y-2 text-sm text-deliivo-dark">
            <p className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-deliivo-gray" /> {profile.travelPreference?.chattiness?.replace(/_/g, ' ') || t('profile.chattinessNotSet')}</p>
            <p className="flex items-center gap-2"><PawPrint className="h-4 w-4 text-deliivo-gray" /> {profile.travelPreference?.pets?.replace(/_/g, ' ') || t('profile.petsNotSet')}</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, sub, icon }: { label: string; value: string; sub: string; icon?: 'star' }) {
  return (
    <div className="rounded-xl bg-gray-50 px-4 py-3">
      <p className="text-xs font-medium text-deliivo-gray">{label}</p>
      <p className="mt-1 flex items-center gap-1 text-lg font-bold text-deliivo-dark">
        {icon === 'star' ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : null}
        {value}
      </p>
      <p className="mt-0.5 text-xs text-deliivo-gray">{sub}</p>
    </div>
  );
}
