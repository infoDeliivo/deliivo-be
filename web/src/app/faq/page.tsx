'use client';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { publicConfig } from '@/lib/public-config';
import { useTranslation } from '@/lib/i18n-context';

const faqs = [
  { q: 'faq.q1', a: 'faq.a1' },
  { q: 'faq.q2', a: 'faq.a2' },
  { q: 'faq.q3', a: 'faq.a3' },
  { q: 'faq.q4', a: 'faq.a4' },
  { q: 'faq.q5', a: 'faq.a5' },
  { q: 'faq.q6', a: 'faq.a6' },
];

export default function FaqPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full flex-col bg-deliivo-cream">
      <Navbar />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase text-deliivo-orange">{t('faq.kicker')}</p>
          <h1 className="mt-2 text-3xl font-bold text-deliivo-dark">{t('faq.title')}</h1>
        </div>

        <div className="space-y-4">
          {faqs.map((item) => (
            <section key={item.q} className="rounded-lg bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-deliivo-dark">{t(item.q)}</h2>
              <p className="mt-2 text-sm leading-6 text-deliivo-gray">
                {t(item.a, { email: publicConfig.supportEmail })}
              </p>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
