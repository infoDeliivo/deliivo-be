import type { Metadata } from 'next'
import AdminSidebar from './_components/AdminSidebar'
import AdminTopBar from './_components/AdminTopBar'

export const metadata: Metadata = {
  title: 'Admin — Deliivo',
  description: 'Deliivo admin panel',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AdminTopBar />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
