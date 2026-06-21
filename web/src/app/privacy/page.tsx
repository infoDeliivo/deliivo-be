'use client';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { publicConfig } from '@/lib/public-config';
import { useTranslation } from '@/lib/i18n-context';

const sections = [
  { title: 'privacy.dataTitle', body: 'privacy.dataBody' },
  { title: 'privacy.useTitle', body: 'privacy.useBody' },
  { title: 'privacy.locationTitle', body: 'privacy.locationBody' },
  { title: 'privacy.paymentsTitle', body: 'privacy.paymentsBody' },
  { title: 'privacy.rightsTitle', body: 'privacy.rightsBody' },
];

export default function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full flex-col bg-deliivo-cream">
      <Navbar />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase text-deliivo-orange">{t('privacy.kicker')}</p>
          <h1 className="mt-2 text-3xl font-bold text-deliivo-dark">{t('privacy.title')}</h1>
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
          <h2 className="text-lg font-semibold text-deliivo-dark">{t('privacy.contactTitle')}</h2>
          <p className="mt-2 text-sm leading-6 text-deliivo-gray">
            <a className="font-semibold text-deliivo-orange hover:underline" href={`mailto:${publicConfig.privacyEmail}`}>
              {t('privacy.contactBody', { email: publicConfig.privacyEmail })}
            </a>
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
