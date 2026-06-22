'use client';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { publicConfig } from '@/lib/public-config';
import { useTranslation } from '@/lib/i18n-context';

const sections = [
  { title: 'legal.marketplaceRoleTitle', body: 'legal.marketplaceRoleBody' },
  { title: 'legal.accountsTitle', body: 'legal.accountsBody' },
  { title: 'legal.bookingTitle', body: 'legal.bookingBody' },
  { title: 'legal.paymentsTitle', body: 'legal.paymentsBody' },
  { title: 'legal.safetyTitle', body: 'legal.safetyBody' },
];

export default function TermsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full flex-col bg-deliivo-cream">
      <Navbar />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase text-deliivo-orange">{t('legal.kicker')}</p>
          <h1 className="mt-2 text-3xl font-bold text-deliivo-dark">{t('legal.termsTitle')}</h1>
          <p className="mt-3 text-sm text-deliivo-gray">{t('legal.lastUpdated')}</p>
        </div>

        <div className="space-y-4">
          {sections.map((section) => (
            <section key={section.title} className="rounded-lg bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-deliivo-dark">{t(section.title)}</h2>
              <p className="mt-2 text-sm leading-6 text-deliivo-gray">{t(section.body)}</p>
            </section>
          ))}
        </div>

        <section className="mt-6 rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-deliivo-dark">{t('legal.contactTitle')}</h2>
          <p className="mt-2 text-sm leading-6 text-deliivo-gray">
            <a className="font-semibold text-deliivo-orange hover:underline" href={`mailto:${publicConfig.legalEmail}`}>
              {t('legal.contactBody', { email: publicConfig.legalEmail })}
            </a>
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
