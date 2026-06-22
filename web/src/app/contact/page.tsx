'use client';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { publicConfig } from '@/lib/public-config';
import { useTranslation } from '@/lib/i18n-context';

const contacts = [
  {
    label: 'contact.general',
    email: publicConfig.contactEmail,
    body: 'contact.generalBody',
  },
  {
    label: 'contact.support',
    email: publicConfig.supportEmail,
    body: 'contact.supportBody',
  },
  {
    label: 'contact.privacy',
    email: publicConfig.privacyEmail,
    body: 'contact.privacyBody',
  },
];

export default function ContactPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full flex-col bg-deliivo-cream">
      <Navbar />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase text-deliivo-orange">{t('contact.kicker')}</p>
          <h1 className="mt-2 text-3xl font-bold text-deliivo-dark">{t('contact.title')}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-deliivo-gray">
            {t('contact.copy')}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {contacts.map((item) => (
            <section key={item.label} className="rounded-lg bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-deliivo-dark">{t(item.label)}</h2>
              <p className="mt-2 min-h-16 text-sm leading-6 text-deliivo-gray">{t(item.body)}</p>
              <a className="mt-4 inline-flex text-sm font-semibold text-deliivo-orange hover:underline" href={`mailto:${item.email}`}>
                {item.email}
              </a>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
