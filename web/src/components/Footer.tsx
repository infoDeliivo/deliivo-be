'use client';

import Link from "next/link";
import { useTranslation } from "@/lib/i18n-context";

const socialLinks = [
  { label: "Twitter / X", href: "https://twitter.com", icon: "X" },
  { label: "Instagram", href: "https://instagram.com", icon: "IG" },
  { label: "LinkedIn", href: "https://linkedin.com", icon: "IN" },
  { label: "Facebook", href: "https://facebook.com", icon: "FB" },
];

export default function Footer() {
  const { t } = useTranslation();
  const footerColumns = [
    {
      heading: t('footer.about'),
      links: [
        { label: t('footer.aboutDeliivo'), href: "/" },
        { label: t('nav.guides'), href: "/blog" },
        { label: t('nav.searchRide'), href: "/search" },
        { label: t('nav.offerRide'), href: "/publish" },
      ],
    },
    {
      heading: t('footer.drivers'),
      links: [
        { label: t('footer.publishRide'), href: "/publish" },
        { label: t('nav.yourRides'), href: "/rides" },
        { label: t('footer.vehicle'), href: "/profile/vehicle" },
      ],
    },
    {
      heading: t('footer.passengers'),
      links: [
        { label: t('nav.searchRide'), href: "/search" },
        { label: t('nav.yourRides'), href: "/rides" },
        { label: t('footer.profile'), href: "/profile" },
      ],
    },
    {
      heading: t('footer.support'),
      links: [
        { label: t('footer.faq'), href: "/faq" },
        { label: t('nav.guides'), href: "/blog" },
        { label: t('footer.contact'), href: "/contact" },
        { label: t('footer.privacy'), href: "/privacy" },
        { label: t('footer.terms'), href: "/terms" },
      ],
    },
  ];

  return (
    <footer style={{ backgroundColor: "#1a1a2e" }} className="text-gray-400">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Top section: logo + columns */}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-deliivo-orange text-white font-bold text-sm">
                D
              </span>
              <span className="text-lg font-bold text-white tracking-tight">
                Deliivo
              </span>
            </Link>
            <p className="text-sm leading-relaxed text-gray-500">
              {t('footer.description')}
            </p>
          </div>

          {/* Link columns */}
          {footerColumns.map((col) => (
            <div key={col.heading}>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white">
                {col.heading}
              </h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-500 transition-colors hover:text-deliivo-orange"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 border-t border-white/10 pt-8 flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-gray-600">
            &copy; {new Date().getFullYear()} Deliivo. {t('footer.rights')}
          </p>

          {/* Social links */}
          <div className="flex items-center gap-4">
            {socialLinks.map((social) => (
              <a
                key={social.href}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-xs font-bold text-gray-500 transition-colors hover:border-deliivo-orange hover:text-deliivo-orange"
              >
                {social.icon}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
