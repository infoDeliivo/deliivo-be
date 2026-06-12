import { Suspense } from 'react';
import Link from 'next/link';
import { MapPin, ShieldCheck, Star, Users, ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SearchForm from '@/components/SearchForm';

const popularRoutes = [
  {
    id: 'r1',
    from: 'Toronto',
    to: 'Ottawa',
    price: 35,
    duration: '4h 30m',
    driverCount: 12,
  },
  {
    id: 'r2',
    from: 'Montreal',
    to: 'Quebec City',
    price: 22,
    duration: '2h 40m',
    driverCount: 8,
  },
  {
    id: 'r3',
    from: 'Vancouver',
    to: 'Whistler',
    price: 18,
    duration: '1h 50m',
    driverCount: 15,
  },
  {
    id: 'r4',
    from: 'Calgary',
    to: 'Edmonton',
    price: 28,
    duration: '3h 00m',
    driverCount: 9,
  },
  {
    id: 'r5',
    from: 'Toronto',
    to: 'Hamilton',
    price: 14,
    duration: '1h 10m',
    driverCount: 20,
  },
  {
    id: 'r6',
    from: 'Ottawa',
    to: 'Kingston',
    price: 20,
    duration: '2h 00m',
    driverCount: 7,
  },
];

const howItWorks = [
  {
    step: '01',
    icon: '🔍',
    title: 'Search',
    description:
      'Enter your pickup and destination city, choose a date, and find available rides near you.',
  },
  {
    step: '02',
    icon: '✅',
    title: 'Book',
    description:
      'Pick a driver you trust. View ratings, reviews, and vehicle details before you confirm.',
  },
  {
    step: '03',
    icon: '🚗',
    title: 'Travel',
    description:
      'Meet your driver, confirm your pickup OTP, and enjoy an affordable, comfortable journey.',
  },
];

const whyDeliivo = [
  {
    icon: <ShieldCheck className="h-7 w-7 text-primary-500" />,
    title: 'Verified Drivers',
    description:
      'Every driver goes through identity verification and licence checks before they can list a ride.',
  },
  {
    icon: <Star className="h-7 w-7 text-primary-500" />,
    title: 'Trusted Community',
    description:
      'Ratings and reviews after every trip build a community you can actually rely on.',
  },
  {
    icon: <Users className="h-7 w-7 text-primary-500" />,
    title: 'Female Only Option',
    description:
      'Riders can filter for female drivers only, giving everyone the comfort to travel safely.',
  },
  {
    icon: (
      <span className="flex h-7 w-7 items-center justify-center text-2xl leading-none">
        💰
      </span>
    ),
    title: 'Affordable Fares',
    description:
      'Split fuel costs with fellow travellers. Prices are set by drivers and shown upfront — no surprises.',
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-full">
      <Navbar />

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="relative overflow-hidden bg-deliivo-cream px-4 pt-16 pb-24 sm:px-6 sm:pt-24 sm:pb-32">
          {/* Decorative blobs */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-primary-100 opacity-60 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-orange-100 opacity-40 blur-2xl"
          />

          <div className="relative mx-auto max-w-4xl text-center">
            {/* Tagline badge */}
            <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary-100 px-4 py-1.5 text-sm font-medium text-primary-600">
              <MapPin size={14} />
              Carpooling made simple
            </span>

            <h1 className="text-4xl font-extrabold tracking-tight text-deliivo-dark sm:text-5xl lg:text-6xl">
              Carpool Together,{' '}
              <span className="text-primary-500">Go Further</span>
            </h1>
            <p className="mt-5 mx-auto max-w-2xl text-lg text-deliivo-gray sm:text-xl">
              Share your ride or find a match. Travel with trusted people on the
              same route — affordable, safe, and easy.
            </p>

            {/* Search form — client island */}
            <div className="mt-10">
              <Suspense
                fallback={
                  <div className="h-40 rounded-2xl bg-white animate-pulse" />
                }
              >
                <SearchForm />
              </Suspense>
            </div>

            {/* Social proof */}
            <p className="mt-6 text-sm text-deliivo-gray">
              Join{' '}
              <span className="font-semibold text-deliivo-dark">50,000+</span>{' '}
              travellers already saving on every trip
            </p>
          </div>
        </section>

        {/* ── Popular routes ── */}
        <section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-10 flex items-end justify-between">
              <div>
                <h2 className="text-2xl font-bold text-deliivo-dark sm:text-3xl">
                  Popular routes
                </h2>
                <p className="mt-1 text-deliivo-gray">
                  Frequently travelled city pairs
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
                      <p className="font-semibold text-deliivo-dark">
                        {route.from}
                      </p>
                      <p className="mt-1 text-sm text-deliivo-gray">
                        {route.to}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary-500">
                      From ${route.price}
                    </p>
                    <p className="text-xs text-deliivo-gray">
                      {route.driverCount} drivers &middot; {route.duration}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="bg-deliivo-cream px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="text-2xl font-bold text-deliivo-dark sm:text-3xl">
                How Deliivo works
              </h2>
              <p className="mt-2 text-deliivo-gray">
                Three simple steps to your next trip
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
              {howItWorks.map((item) => (
                <div
                  key={item.step}
                  className="flex flex-col items-center text-center"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm text-3xl">
                    {item.icon}
                  </div>
                  <span className="mt-4 text-xs font-bold tracking-widest text-primary-400 uppercase">
                    Step {item.step}
                  </span>
                  <h3 className="mt-1 text-lg font-bold text-deliivo-dark">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm text-deliivo-gray leading-relaxed">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Why Deliivo ── */}
        <section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="text-2xl font-bold text-deliivo-dark sm:text-3xl">
                Why choose Deliivo?
              </h2>
              <p className="mt-2 text-deliivo-gray">
                Safety, trust, and savings — all in one place
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {whyDeliivo.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl bg-primary-50 p-6 flex flex-col gap-3"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm">
                    {item.icon}
                  </div>
                  <h3 className="font-bold text-deliivo-dark">{item.title}</h3>
                  <p className="text-sm text-deliivo-gray leading-relaxed">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA Banner ── */}
        <section className="bg-primary-500 px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
              Ready to share the road?
            </h2>
            <p className="mt-3 text-orange-100">
              List your first ride for free — or find a seat on a trip happening
              tomorrow.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/auth/signup"
                className="inline-flex items-center justify-center rounded-full bg-white px-8 py-3 text-sm font-semibold text-primary-500 shadow-sm hover:bg-orange-50 transition-colors"
              >
                Get started free
              </Link>
              <Link
                href="/search"
                className="inline-flex items-center justify-center rounded-full border border-white/50 px-8 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
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
