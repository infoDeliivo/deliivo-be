'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Car,
  Flag,
  DollarSign,
  Settings,
  Banknote,
  BadgeDollarSign,
  Newspaper,
  Siren,
  Activity,
} from 'lucide-react'

const navItems = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Users', href: '/admin/users', icon: Users },
  { label: 'Rides', href: '/admin/rides', icon: Car },
  { label: 'SOS', href: '/admin/sos', icon: Siren },
  { label: 'Disputes', href: '/admin/reports', icon: Flag },
  { label: 'Payouts', href: '/admin/payouts', icon: Banknote },
  { label: 'Revenue', href: '/admin/revenue', icon: DollarSign },
  { label: 'Pricing', href: '/admin/pricing', icon: BadgeDollarSign },
  { label: 'Monitoring', href: '/admin/monitoring', icon: Activity },
  { label: 'Content', href: '/admin/content', icon: Newspaper },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
]

export default function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 shrink-0 flex flex-col" style={{ background: '#1A1A2E' }}>
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <span className="text-2xl font-bold text-[#F97316]">Deliivo</span>
        <span className="ml-2 text-xs text-white/40 font-medium uppercase tracking-widest">
          Admin
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 flex flex-col gap-1">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive =
            href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-[#F97316] text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-white/10">
        <p className="text-xs text-white/30">Deliivo v1.0 Â· Admin Panel</p>
      </div>
    </aside>
  )
}
