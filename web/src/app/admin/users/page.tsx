'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, ChevronDown, ChevronLeft, ChevronRight, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react'
import { adminApi, AdminUser, Pagination } from '@/lib/api'

const PAGE_SIZE = 20

const statusStyle = {
  active: 'bg-green-50 text-green-700',
  banned: 'bg-red-50 text-red-500',
}

const roleStyle: Record<string, string> = {
  USER: 'bg-gray-100 text-gray-600',
  DRIVER: 'bg-blue-50 text-blue-600',
  ADMIN: 'bg-purple-50 text-purple-600',
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Banned'>('All')
  const [page, setPage] = useState(1)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    loadUsers()
  }, [page, statusFilter])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(1)
      loadUsers()
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  async function loadUsers() {
    setLoading(true)
    setError('')
    try {
      const params: { page: number; limit: number; search?: string; isBanned?: string } = { page, limit: PAGE_SIZE }
      if (search.trim()) params.search = search.trim()
      if (statusFilter === 'Banned') params.isBanned = 'true'
      else if (statusFilter === 'Active') params.isBanned = 'false'
      const res = await adminApi.getUsers(params)
      setUsers(res.data.users)
      setPagination(res.data.pagination)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  async function handleBan(userId: string) {
    setActionLoading(userId)
    try {
      await adminApi.banUser(userId)
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isBanned: true } : u))
    } catch { /* ignore */ }
    finally { setActionLoading(null); setOpenMenu(null) }
  }

  async function handleUnban(userId: string) {
    setActionLoading(userId)
    try {
      await adminApi.unbanUser(userId)
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isBanned: false } : u))
    } catch { /* ignore */ }
    finally { setActionLoading(null); setOpenMenu(null) }
  }

  const totalPages = pagination?.totalPages || 1

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Users Management</h1>
        <p className="text-sm text-gray-500 mt-0.5">{pagination?.total || 0} total users</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F97316]/30 focus:border-[#F97316]"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['All', 'Active', 'Banned'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setStatusFilter(s); setPage(1) }}
              className={`px-3 py-2 text-xs font-medium rounded-xl border transition-colors ${
                statusFilter === s
                  ? 'bg-[#F97316] text-white border-[#F97316]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#F97316] hover:text-[#F97316]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[#F97316]" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-6 py-3 font-medium">User</th>
                    <th className="text-left px-4 py-3 font-medium">Phone</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Verified</th>
                    <th className="text-left px-4 py-3 font-medium">Role</th>
                    <th className="text-left px-4 py-3 font-medium">Joined</th>
                    <th className="text-right px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const initials = (u.name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                    return (
                      <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#F97316] flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {initials}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{u.name || 'Unnamed'}</p>
                              <p className="text-xs text-gray-400">{u.email || '-'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.phone || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${u.isBanned ? statusStyle.banned : statusStyle.active}`}>
                            {u.isBanned ? 'Banned' : 'Active'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {u.isVerified ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : (
                            <XCircle className="w-4 h-4 text-gray-300" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${roleStyle[u.role] || roleStyle.USER}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <div className="relative inline-block">
                            <button
                              type="button"
                              onClick={() => setOpenMenu(openMenu === u.id ? null : u.id)}
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg hover:border-gray-300 transition-colors"
                            >
                              Actions <ChevronDown className="w-3 h-3" />
                            </button>
                            {openMenu === u.id && (
                              <div className="absolute right-0 mt-1 w-36 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
                                <button
                                  type="button"
                                  className="w-full text-left px-4 py-2.5 text-xs text-yellow-600 hover:bg-yellow-50 disabled:opacity-50"
                                  disabled={actionLoading === u.id}
                                  onClick={() => u.isBanned ? handleUnban(u.id) : handleBan(u.id)}
                                >
                                  {actionLoading === u.id ? 'Processing...' : u.isBanned ? 'Unban user' : 'Ban user'}
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {users.length === 0 && (
              <div className="py-12 text-center text-gray-400 text-sm">No users found.</div>
            )}

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="px-6 py-3 border-t border-gray-50 flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  Page {page} of {totalPages} ({pagination.total} total)
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
