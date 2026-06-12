import { Settings, Bell, Shield, CreditCard, Globe } from 'lucide-react'

const sections = [
  {
    icon: Globe,
    title: 'General',
    description: 'App name, timezone, and region settings.',
    fields: [
      { label: 'App Name', value: 'Deliivo', type: 'text' },
      { label: 'Support Email', value: 'support@deliivo.com', type: 'email' },
      { label: 'Default Currency', value: 'USD', type: 'text' },
    ],
  },
  {
    icon: CreditCard,
    title: 'Payments',
    description: 'Platform fee and Stripe configuration.',
    fields: [
      { label: 'Platform Fee (%)', value: '10', type: 'number' },
      { label: 'Stripe Public Key', value: 'pk_live_****', type: 'text' },
    ],
  },
  {
    icon: Bell,
    title: 'Notifications',
    description: 'Configure email and push notification settings.',
    fields: [
      { label: 'Admin Alert Email', value: 'admin@deliivo.com', type: 'email' },
    ],
  },
  {
    icon: Shield,
    title: 'Security',
    description: 'Session and rate-limit settings.',
    fields: [
      { label: 'Session Timeout (min)', value: '60', type: 'number' },
      { label: 'Max Login Attempts', value: '5', type: 'number' },
    ],
  },
]

export default function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Platform configuration</p>
      </div>

      <div className="flex flex-col gap-5">
        {sections.map(({ icon: Icon, title, description, fields }) => (
          <div key={title} className="bg-white rounded-2xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center">
                <Icon className="w-4 h-4 text-[#F97316]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
                <p className="text-xs text-gray-400">{description}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fields.map(({ label, value, type }) => (
                <div key={label}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input
                    type={type}
                    defaultValue={value}
                    className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F97316]/30 focus:border-[#F97316] text-gray-900"
                  />
                </div>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="px-5 py-2.5 bg-[#F97316] text-white text-sm font-semibold rounded-xl hover:bg-orange-600 transition-colors"
              >
                Save {title}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
