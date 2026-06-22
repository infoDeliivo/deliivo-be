'use client'

import { Bell, LogOut } from 'lucide-react'

export default function AdminTopBar() {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
      <div>
        <p className="text-sm text-gray-400">Welcome back,</p>
        <p className="text-sm font-semibold text-gray-900">Admin User</p>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="relative p-2 text-gray-500 hover:text-[#F97316] transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#F97316] rounded-full" />
        </button>

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#F97316] flex items-center justify-center text-white text-sm font-bold">
            A
          </div>
        </div>

        <button
          type="button"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-500 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  )
}
