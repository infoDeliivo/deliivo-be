'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Globe2, Languages, Loader2, PencilLine, Plus, Save, Trash2 } from 'lucide-react';
import { contentApi, ContentAuditLog, ContentPost, getApiErrorMessage } from '@/lib/api';
import { showError, showSuccess } from '@/lib/app-feedback';

const emptyDraft = {
  title: '',
  slug: '',
  excerpt: '',
  body: '',
  category: 'Rider guide' as ContentPost['category'],
  status: 'DRAFT' as ContentPost['status'],
  readTime: '4 min read',
  locale: 'en',
};

export default function AdminContentPage() {
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<typeof emptyDraft>(emptyDraft);
  const [audit, setAudit] = useState<ContentAuditLog[]>([]);

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedId) || null,
    [posts, selectedId],
  );

  async function loadPosts() {
    setLoading(true);
    try {
      const res = await contentApi.listAdminPosts();
      setPosts(res.data || []);
      if (!selectedId && res.data?.[0]) {
        selectPost(res.data[0]);
      } else if (selectedId) {
        loadAudit(selectedId);
      }
    } catch (err: unknown) {
      showError('Could not load content', getApiErrorMessage(err, 'Failed to load content posts'));
    } finally {
      setLoading(false);
    }
  }

  async function loadAudit(postId?: string | null) {
    try {
      const res = await contentApi.listAdminAudit(postId || undefined, 12);
      setAudit(res.data || []);
    } catch {
      setAudit([]);
    }
  }

  useEffect(() => {
    loadPosts();
  }, []);

  function selectPost(post: ContentPost) {
    setSelectedId(post.id);
    setDraft({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      body: post.body,
      category: post.category,
      status: post.status,
      readTime: post.readTime,
      locale: post.locale,
    });
    loadAudit(post.id);
  }

  function createNew() {
    setSelectedId(null);
    setDraft(emptyDraft);
  }

  async function savePost() {
    setSaving(true);
    try {
      const res = await contentApi.saveAdminPost({
        id: selectedId || undefined,
        ...draft,
      });
      showSuccess('Content saved', res.data.status === 'PUBLISHED' ? 'Post is published on the public blog.' : 'Draft saved.');
      await loadPosts();
      selectPost(res.data);
    } catch (err: unknown) {
      showError('Could not save content', getApiErrorMessage(err, 'Failed to save content post'));
    } finally {
      setSaving(false);
    }
  }

  async function deletePost(id: string) {
    if (!window.confirm('Delete this content post?')) return;
    try {
      await contentApi.deleteAdminPost(id);
      showSuccess('Content deleted', 'The post was removed from the content store.');
      await loadPosts();
      createNew();
      loadAudit();
    } catch (err: unknown) {
      showError('Could not delete content', getApiErrorMessage(err, 'Failed to delete content post'));
    }
  }

  const publishedCount = posts.filter((post) => post.status === 'PUBLISHED').length;
  const locales = Array.from(new Set(posts.map((post) => post.locale))).sort();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Content operations</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">Guides, pages, and translations</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">
            Manage public guide posts with draft and published states. This is the current content foundation for the public blog.
          </p>
        </div>
        <button type="button" onClick={createNew} className="inline-flex items-center gap-2 rounded-xl bg-[#F97316] px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600">
          <Plus className="h-4 w-4" />
          New post
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-orange-600" />
            <h2 className="font-semibold text-gray-900">Published guides</h2>
          </div>
          <p className="mt-3 text-3xl font-bold text-gray-900">{publishedCount}</p>
          <p className="mt-1 text-sm text-gray-500">Public blog posts currently visible on `/blog`.</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <Languages className="h-5 w-5 text-orange-600" />
            <h2 className="font-semibold text-gray-900">Locales in content</h2>
          </div>
          <p className="mt-3 text-3xl font-bold text-gray-900">{locales.length}</p>
          <p className="mt-1 text-sm text-gray-500">{locales.join(', ') || 'No locales yet'}.</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <Globe2 className="h-5 w-5 text-orange-600" />
            <h2 className="font-semibold text-gray-900">Total content entries</h2>
          </div>
          <p className="mt-3 text-3xl font-bold text-gray-900">{posts.length}</p>
          <p className="mt-1 text-sm text-gray-500">Draft and published guide records.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="font-semibold text-gray-900">Guide catalogue</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {posts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => selectPost(post)}
                  className={`grid w-full gap-2 px-5 py-4 text-left hover:bg-orange-50 ${selectedId === post.id ? 'bg-orange-50/70' : 'bg-white'}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${post.status === 'PUBLISHED' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {post.status}
                    </span>
                    <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700">
                      {post.category}
                    </span>
                    <span className="text-[11px] text-gray-500">{post.locale}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{post.title}</h3>
                    <p className="mt-1 text-sm text-gray-600">{post.excerpt}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-gray-900">{selectedId ? 'Edit content post' : 'Create content post'}</h2>
              <p className="mt-1 text-sm text-gray-500">Maintain blog guides without leaving the admin portal.</p>
            </div>
            {selectedPost && (
              <button type="button" onClick={() => deletePost(selectedPost.id)} className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              <input value={draft.title} onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))} className="input-field" />
            </Field>
            <Field label="Slug">
              <input value={draft.slug} onChange={(e) => setDraft((prev) => ({ ...prev, slug: e.target.value }))} className="input-field" />
            </Field>
            <Field label="Category">
              <select value={draft.category} onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value as ContentPost['category'] }))} className="input-field">
                {['Rider guide', 'Driver guide', 'Safety', 'Product update'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={draft.status} onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value as ContentPost['status'] }))} className="input-field">
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
              </select>
            </Field>
            <Field label="Read time">
              <input value={draft.readTime} onChange={(e) => setDraft((prev) => ({ ...prev, readTime: e.target.value }))} className="input-field" />
            </Field>
            <Field label="Locale">
              <input value={draft.locale} onChange={(e) => setDraft((prev) => ({ ...prev, locale: e.target.value }))} className="input-field" />
            </Field>
          </div>

          <Field label="Excerpt" className="mt-4">
            <textarea value={draft.excerpt} onChange={(e) => setDraft((prev) => ({ ...prev, excerpt: e.target.value }))} rows={3} className="input-field" />
          </Field>

          <Field label="Body" className="mt-4">
            <textarea value={draft.body} onChange={(e) => setDraft((prev) => ({ ...prev, body: e.target.value }))} rows={10} className="input-field" />
          </Field>

          <div className="mt-6 flex justify-end">
            <button type="button" onClick={savePost} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#F97316] px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save post
            </button>
          </div>

          <div className="mt-8 border-t border-gray-100 pt-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">Recent audit trail</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {selectedId ? 'History for the selected post.' : 'Recent global content actions.'}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {audit.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
                  No audit entries available.
                </div>
              ) : audit.map((item) => (
                <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{item.action}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {item.createdAt} by {item.actorId}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600">{item.postId}</span>
                  </div>
                  {item.snapshot && (
                    <p className="mt-2 text-sm text-gray-700">{item.snapshot.title} · {item.snapshot.status}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  );
}
