'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarCheck, Car, CreditCard, MapPin, Route, Search, ShieldCheck, Star, Users, Wallet } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SearchForm from '@/components/SearchForm';
import { useTranslation } from '@/lib/i18n-context';

const popularRoutes = [
  { id: 'r1', from: 'Tallinn', to: 'Tartu', price: 12, duration: '2h 20m', driverCount: 18 },
  { id: 'r2', from: 'Riga', to: 'Vilnius', price: 16, duration: '4h 10m', driverCount: 14 },
  { id: 'r3', from: 'Vilnius', to: 'Kaunas', price: 7, duration: '1h 20m', driverCount: 21 },
  { id: 'r4', from: 'Tallinn', to: 'Riga', price: 24, duration: '4h 30m', driverCount: 9 },
  { id: 'r5', from: 'Riga', to: 'Liepaja', price: 11, duration: '3h 00m', driverCount: 12 },
  { id: 'r6', from: 'Vilnius', to: 'Klaipeda', price: 15, duration: '3h 15m', driverCount: 10 },
];

const riderSteps = [
  {
    step: '01',
    icon: <Search className="h-5 w-5" />,
    titleKey: 'home.riderStep1Title',
    descriptionKey: 'home.riderStep1Copy',
  },
  {
    step: '02',
    icon: <CreditCard className="h-5 w-5" />,
    titleKey: 'home.riderStep2Title',
    descriptionKey: 'home.riderStep2Copy',
  },
  {
    step: '03',
    icon: <CalendarCheck className="h-5 w-5" />,
    titleKey: 'home.riderStep3Title',
    descriptionKey: 'home.riderStep3Copy',
  },
];

const driverSteps = [
  {
    step: '01',
    icon: <Route className="h-5 w-5" />,
    titleKey: 'home.driverStep1Title',
    descriptionKey: 'home.driverStep1Copy',
  },
  {
    step: '02',
    icon: <Users className="h-5 w-5" />,
    titleKey: 'home.driverStep2Title',
    descriptionKey: 'home.driverStep2Copy',
  },
  {
    step: '03',
    icon: <Wallet className="h-5 w-5" />,
    titleKey: 'home.driverStep3Title',
    descriptionKey: 'home.driverStep3Copy',
  },
];

const whyDeliivo = [
  {
    icon: <ShieldCheck className="h-7 w-7 text-primary-500" />,
    titleKey: 'home.verifiedDrivers',
    descriptionKey: 'home.verifiedDriversCopy',
  },
  {
    icon: <Star className="h-7 w-7 text-primary-500" />,
    titleKey: 'home.trustedCommunity',
    descriptionKey: 'home.trustedCommunityCopy',
  },
  {
    icon: <Users className="h-7 w-7 text-primary-500" />,
    titleKey: 'home.womenOnlyOption',
    descriptionKey: 'home.womenOnlyOptionCopy',
  },
  {
    icon: (
      <span className="flex h-7 w-7 items-center justify-center text-xs font-bold leading-none">
        EUR
      </span>
    ),
    titleKey: 'home.regionalFares',
    descriptionKey: 'home.regionalFaresCopy',
  },
];

export default function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full flex-col">
      <Navbar />

      <main className="flex-1">
        <section className="relative overflow-hidden bg-deliivo-cream px-4 py-12 sm:px-6 sm:py-20">
          <div className="relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="text-center lg:text-left">
              <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary-100 px-4 py-1.5 text-sm font-medium text-primary-600">
                <MapPin size={14} />
                {t('home.region')}
              </span>

              <h1 className="text-4xl font-extrabold tracking-tight text-deliivo-dark sm:text-5xl lg:text-6xl">
                {t('home.heroTitle')}
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-deliivo-gray sm:text-xl lg:mx-0">
                {t('home.heroCopy')}
              </p>

              <div className="mt-10">
                <Suspense fallback={<div className="h-40 rounded-2xl bg-white animate-pulse" />}>
                  <SearchForm />
                </Suspense>
              </div>

              <p className="mt-6 text-sm text-deliivo-gray">
                {t('home.heroNote')}
              </p>
            </div>

            <div className="rounded-2xl border border-primary-100 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                    {t('home.corridor')}
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-deliivo-dark">
                    {t('home.popularRegionalRoutes')}
                  </h2>
                </div>
                <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-600">
                  EUR
                </span>
              </div>
              <div className="space-y-3">
                {popularRoutes.slice(0, 4).map((route) => (
                  <div
                    key={route.id}
                    className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-full border-2 border-primary-500 bg-white" />
                        <span className="h-5 w-0.5 bg-primary-200" />
                        <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-deliivo-dark">{route.from}</p>
                        <p className="text-sm text-deliivo-gray">{route.to}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary-500">EUR {route.price}</p>
                      <p className="text-xs text-deliivo-gray">{route.duration}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-10 flex items-end justify-between">
              <div>
                <h2 className="text-2xl font-bold text-deliivo-dark sm:text-3xl">
                  {t('home.popularRoutes')}
                </h2>
                <p className="mt-1 text-deliivo-gray">
                  {t('home.popularRoutesCopy')}
                </p>
              </div>
              <Link
                href="/search"
                className="hidden items-center gap-1 text-sm font-medium text-primary-500 hover:text-primary-600 sm:flex"
              >
                {t('home.seeAll')} <ArrowRight size={14} />
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {popularRoutes.map((route) => (
                <Link
                  key={route.id}
                  href={`/search?from=${encodeURIComponent(route.from)}&to=${encodeURIComponent(route.to)}`}
                  className="group flex items-center justify-between rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:border-primary-200 hover:shadow-md"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center gap-1">
                      <span className="h-2 w-2 rounded-full border-2 border-primary-500 bg-white" />
                      <span className="h-6 w-0.5 bg-primary-200" />
                      <span className="h-2 w-2 rounded-full bg-primary-500" />
                    </div>
                    <div>
                      <p className="font-semibold text-deliivo-dark">{route.from}</p>
                      <p className="mt-1 text-sm text-deliivo-gray">{route.to}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary-500">{t('home.fromPrice', { price: route.price })}</p>
                    <p className="text-xs text-deliivo-gray">
                      {t('home.routeMeta', { drivers: route.driverCount, duration: route.duration })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-deliivo-cream px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="text-2xl font-bold text-deliivo-dark sm:text-3xl">
                {t('home.howTitle')}
              </h2>
              <p className="mt-2 text-deliivo-gray">
                {t('home.howCopy')}
              </p>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <div className="mb-5 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-primary-500 shadow-sm">
                    <Users className="h-5 w-5" />
                  </span>
                  <h3 className="text-lg font-bold text-deliivo-dark">{t('home.forRiders')}</h3>
                </div>
                <div className="grid gap-4">
                  {riderSteps.map((item) => (
                    <div key={item.step} className="flex gap-4 rounded-2xl bg-white p-5 shadow-sm">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                        {item.icon}
                      </div>
                      <div>
                        <span className="text-xs font-bold uppercase text-primary-400">{t('home.step', { step: item.step })}</span>
                        <h4 className="mt-0.5 font-bold text-deliivo-dark">{t(item.titleKey)}</h4>
                        <p className="mt-1 text-sm leading-relaxed text-deliivo-gray">{t(item.descriptionKey)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-5 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-primary-500 shadow-sm">
                    <Car className="h-5 w-5" />
                  </span>
                  <h3 className="text-lg font-bold text-deliivo-dark">{t('home.forDrivers')}</h3>
                </div>
                <div className="grid gap-4">
                  {driverSteps.map((item) => (
                    <div key={item.step} className="flex gap-4 rounded-2xl bg-white p-5 shadow-sm">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                        {item.icon}
                      </div>
                      <div>
                        <span className="text-xs font-bold uppercase text-primary-400">{t('home.step', { step: item.step })}</span>
                        <h4 className="mt-0.5 font-bold text-deliivo-dark">{t(item.titleKey)}</h4>
                        <p className="mt-1 text-sm leading-relaxed text-deliivo-gray">{t(item.descriptionKey)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="text-2xl font-bold text-deliivo-dark sm:text-3xl">
                {t('home.whyTitle')}
              </h2>
              <p className="mt-2 text-deliivo-gray">
                {t('home.whyCopy')}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {whyDeliivo.map((item) => (
                <div key={item.titleKey} className="flex flex-col gap-3 rounded-2xl bg-primary-50 p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm">
                    {item.icon}
                  </div>
                  <h3 className="font-bold text-deliivo-dark">{t(item.titleKey)}</h3>
                  <p className="text-sm leading-relaxed text-deliivo-gray">{t(item.descriptionKey)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-primary-500 px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
              {t('home.ctaTitle')}
            </h2>
            <p className="mt-3 text-orange-100">
              {t('home.ctaCopy')}
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/auth/signup"
                className="inline-flex items-center justify-center rounded-full bg-white px-8 py-3 text-sm font-semibold text-primary-500 shadow-sm transition-colors hover:bg-orange-50"
              >
                {t('home.getStarted')}
              </Link>
              <Link
                href="/search"
                className="inline-flex items-center justify-center rounded-full border border-white/50 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                {t('home.findRide')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
