import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, MapPin, ShieldCheck, Star, Users } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SearchForm from '@/components/SearchForm';

const popularRoutes = [
  { id: 'r1', from: 'Tallinn', to: 'Tartu', price: 12, duration: '2h 20m', driverCount: 18 },
  { id: 'r2', from: 'Riga', to: 'Vilnius', price: 16, duration: '4h 10m', driverCount: 14 },
  { id: 'r3', from: 'Vilnius', to: 'Kaunas', price: 7, duration: '1h 20m', driverCount: 21 },
  { id: 'r4', from: 'Tallinn', to: 'Riga', price: 24, duration: '4h 30m', driverCount: 9 },
  { id: 'r5', from: 'Riga', to: 'Liepaja', price: 11, duration: '3h 00m', driverCount: 12 },
  { id: 'r6', from: 'Vilnius', to: 'Klaipeda', price: 15, duration: '3h 15m', driverCount: 10 },
];

const howItWorks = [
  {
    step: '01',
    icon: 'EE',
    title: 'Search the Baltics',
    description:
      'Choose a route across Estonia, Latvia, or Lithuania and see available seats for your travel date.',
  },
  {
    step: '02',
    icon: 'LV',
    title: 'Book clearly',
    description:
      'Pick a verified driver, check ratings and vehicle details, then request your seat with upfront EUR pricing.',
  },
  {
    step: '03',
    icon: 'LT',
    title: 'Travel together',
    description:
      'Meet at the agreed pickup point, confirm your OTP, and travel affordably between Baltic cities.',
  },
];

const whyDeliivo = [
  {
    icon: <ShieldCheck className="h-7 w-7 text-primary-500" />,
    title: 'Verified Drivers',
    description:
      'Drivers complete identity and licence checks before offering seats on Baltic routes.',
  },
  {
    icon: <Star className="h-7 w-7 text-primary-500" />,
    title: 'Trusted Community',
    description:
      'Ratings and reviews after every trip build a community you can actually rely on.',
  },
  {
    icon: <Users className="h-7 w-7 text-primary-500" />,
    title: 'Women Only Option',
    description:
      'Passengers can choose women-only rides where available for more comfortable travel.',
  },
  {
    icon: (
      <span className="flex h-7 w-7 items-center justify-center text-xs font-bold leading-none">
        EUR
      </span>
    ),
    title: 'Regional Fares',
    description:
      'Split fuel costs in euros with upfront fares for city-to-city and cross-border trips.',
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-full flex-col">
      <Navbar />

      <main className="flex-1">
        <section className="relative overflow-hidden bg-deliivo-cream px-4 py-12 sm:px-6 sm:py-20">
          <div className="relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="text-center lg:text-left">
              <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary-100 px-4 py-1.5 text-sm font-medium text-primary-600">
                <MapPin size={14} />
                Estonia, Latvia, Lithuania
              </span>

              <h1 className="text-4xl font-extrabold tracking-tight text-deliivo-dark sm:text-5xl lg:text-6xl">
                Ride between Baltic cities with trusted locals
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-deliivo-gray sm:text-xl lg:mx-0">
                Find seats or offer rides across Tallinn, Riga, Vilnius, Tartu,
                Kaunas, Liepaja, and more. Built for regional travel in euros,
                with verified drivers and clear pickup points.
              </p>

              <div className="mt-10">
                <Suspense fallback={<div className="h-40 rounded-2xl bg-white animate-pulse" />}>
                  <SearchForm />
                </Suspense>
              </div>

              <p className="mt-6 text-sm text-deliivo-gray">
                Practical city-to-city carpooling for Estonia, Latvia, and Lithuania.
              </p>
            </div>

            <div className="rounded-2xl border border-primary-100 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                    Baltic corridor
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-deliivo-dark">
                    Popular regional routes
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
                  Popular Baltic routes
                </h2>
                <p className="mt-1 text-deliivo-gray">
                  Frequently travelled city pairs across the region
                </p>
              </div>
              <Link
                href="/search"
                className="hidden items-center gap-1 text-sm font-medium text-primary-500 hover:text-primary-600 sm:flex"
              >
                See all <ArrowRight size={14} />
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
                    <p className="text-lg font-bold text-primary-500">From EUR {route.price}</p>
                    <p className="text-xs text-deliivo-gray">
                      {route.driverCount} drivers &middot; {route.duration}
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
                How Deliivo works
              </h2>
              <p className="mt-2 text-deliivo-gray">
                Three simple steps to your next Baltic trip
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
              {howItWorks.map((item) => (
                <div key={item.step} className="flex flex-col items-center text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-xl font-bold text-primary-500 shadow-sm">
                    {item.icon}
                  </div>
                  <span className="mt-4 text-xs font-bold uppercase tracking-widest text-primary-400">
                    Step {item.step}
                  </span>
                  <h3 className="mt-1 text-lg font-bold text-deliivo-dark">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-deliivo-gray">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="text-2xl font-bold text-deliivo-dark sm:text-3xl">
                Why choose Deliivo?
              </h2>
              <p className="mt-2 text-deliivo-gray">
                Safety, trust, and clear EUR pricing for Baltic travel
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {whyDeliivo.map((item) => (
                <div key={item.title} className="flex flex-col gap-3 rounded-2xl bg-primary-50 p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm">
                    {item.icon}
                  </div>
                  <h3 className="font-bold text-deliivo-dark">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-deliivo-gray">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-primary-500 px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
              Ready to share a Baltic route?
            </h2>
            <p className="mt-3 text-orange-100">
              List your first Baltic route for free, or find a seat on a trip
              happening tomorrow.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/auth/signup"
                className="inline-flex items-center justify-center rounded-full bg-white px-8 py-3 text-sm font-semibold text-primary-500 shadow-sm transition-colors hover:bg-orange-50"
              >
                Get started free
              </Link>
              <Link
                href="/search"
                className="inline-flex items-center justify-center rounded-full border border-white/50 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Find a ride
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
