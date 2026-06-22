export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  category: 'Rider guide' | 'Driver guide' | 'Safety' | 'Product update';
  publishedAt: string;
  readTime: string;
};

export const blogPosts: BlogPost[] = [
  {
    slug: 'how-baltic-carpooling-works',
    title: 'How Baltic city-to-city carpooling works',
    excerpt:
      'A practical guide to searching, booking, meeting at pickup points, and sharing verified intercity rides across Estonia, Latvia, and Lithuania.',
    category: 'Rider guide',
    publishedAt: '2026-06-19',
    readTime: '4 min read',
  },
  {
    slug: 'driver-ride-day-checklist',
    title: 'Driver ride-day checklist',
    excerpt:
      'What drivers should check before departure: confirmed passengers, pickup order, payout readiness, live tracking links, and cancellation fallbacks.',
    category: 'Driver guide',
    publishedAt: '2026-06-19',
    readTime: '5 min read',
  },
  {
    slug: 'women-only-rides-and-trust',
    title: 'Women-only rides and trust controls',
    excerpt:
      'How Deliivo handles women-only visibility, gender-based booking enforcement, verified profiles, and support evidence for safer shared travel.',
    category: 'Safety',
    publishedAt: '2026-06-19',
    readTime: '3 min read',
  },
];
