'use client';

import Link from "next/link";
import { useState } from "react";
import { Menu, X, ChevronDown, User, LogOut, Car, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const navLinks = [
    { label: "Search a ride", href: "/search" },
    { label: "Offer a ride", href: "/publish" },
    { label: "Your rides", href: "/rides" },
    { label: "Messages", href: "/chat" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full bg-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-deliivo-orange text-white font-bold text-sm">
            D
          </span>
          <span className="text-lg font-bold text-deliivo-dark tracking-tight">
            Deliivo
          </span>
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-deliivo-gray transition-colors hover:text-deliivo-orange"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop right side */}
        <div className="hidden md:flex items-center gap-3">
          {loading ? (
            <div className="h-8 w-24 animate-pulse rounded-full bg-gray-100" />
          ) : user ? (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen((prev) => !prev)}
                className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-deliivo-dark hover:bg-gray-50 transition-colors"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-600">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <User size={14} />
                  )}
                </span>
                <span className="max-w-[120px] truncate">{user.name || user.email || 'User'}</span>
                <ChevronDown size={14} className={`transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-white py-1 shadow-lg ring-1 ring-black/5">
                  <Link
                    href="/profile"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-deliivo-dark hover:bg-primary-50"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <User size={14} />
                    My profile
                  </Link>
                  <Link
                    href="/rides"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-deliivo-dark hover:bg-primary-50"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <Car size={14} />
                    My rides
                  </Link>
                  <Link
                    href="/profile/earnings"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-deliivo-dark hover:bg-primary-50"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <Wallet size={14} />
                    Earnings
                  </Link>
                  {user.role === 'ADMIN' && (
                    <Link
                      href="/admin"
                      className="flex items-center gap-2 px-4 py-2 text-sm text-deliivo-dark hover:bg-primary-50"
                      onClick={() => setDropdownOpen(false)}
                    >
                      <span className="text-xs">Admin</span>
                    </Link>
                  )}
                  <hr className="my-1 border-gray-100" />
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50"
                    onClick={() => { setDropdownOpen(false); logout(); }}
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href="/auth/signin" className="btn-outline py-2 px-5 text-sm">
                Sign in
              </Link>
              <Link href="/auth/signup" className="btn-primary py-2 px-5 text-sm">
                Sign up
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden rounded-lg p-2 text-deliivo-gray hover:bg-gray-100 transition-colors"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-4 pt-2">
          <nav className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-deliivo-gray hover:bg-primary-50 hover:text-deliivo-orange transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-2">
            {user ? (
              <>
                <Link
                  href="/profile"
                  className="btn-outline w-full text-center"
                  onClick={() => setMobileOpen(false)}
                >
                  My profile
                </Link>
                <button
                  className="btn-outline w-full text-center text-red-500 border-red-200"
                  onClick={() => { setMobileOpen(false); logout(); }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/signin"
                  className="btn-outline w-full text-center"
                  onClick={() => setMobileOpen(false)}
                >
                  Sign in
                </Link>
                <Link
                  href="/auth/signup"
                  className="btn-primary w-full text-center"
                  onClick={() => setMobileOpen(false)}
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
