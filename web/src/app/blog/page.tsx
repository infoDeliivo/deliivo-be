'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Loader2, ShieldCheck, Users } from 'lucide-react';
import { contentApi, ContentPost } from '@/lib/api';
import { useTranslation } from '@/lib/i18n-context';

const categoryIcon = {
  'Rider guide': Users,
  'Driver guide': BookOpen,
  Safety: ShieldCheck,
  'Product update': BookOpen,
};

export default function BlogPage() {
  const { t, locale } = useTranslation();
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    contentApi.listPublished(locale).then((res) => {
      setPosts(res.data || []);
    }).catch(() => {
      setPosts([]);
    }).finally(() => setLoading(false));
  }, [locale]);

  return (
    <main className="min-h-screen bg-gray-50">
      <section className="bg-white border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-deliivo-orange">
            {t('blog.kicker')}
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-deliivo-dark">
            {t('blog.title')}
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-deliivo-gray">
            {t('blog.copy')}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-deliivo-orange" />
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-deliivo-gray shadow-sm">
            No published guides yet.
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-3">
            {posts.map((post) => {
              const Icon = categoryIcon[post.category];
              return (
                <article key={post.id} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-medium text-deliivo-gray">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-deliivo-orange">
                      <Icon size={16} />
                    </span>
                    {post.category}
                  </div>
                  <h2 className="mt-5 text-xl font-semibold text-deliivo-dark">{post.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-deliivo-gray">{post.excerpt}</p>
                  <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-sm text-deliivo-gray">
                    {post.body}
                  </div>
                  <div className="mt-5 flex items-center justify-between text-xs text-gray-500">
                    <span>{new Date(post.publishedAt || post.updatedAt).toLocaleDateString()}</span>
                    <span>{post.readTime}</span>
                  </div>
                  <Link
                    href="/contact"
                    className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-deliivo-orange hover:text-orange-700"
                  >
                    {t('blog.askSupport')}
                    <ArrowRight size={15} />
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
