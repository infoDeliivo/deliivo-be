'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  User,
  CheckCircle,
  FileText,
  Car,
  Star,
  Bell,
  CreditCard,
  HelpCircle,
  Shield,
  ScrollText,
  LogOut,
  ChevronRight,
  PawPrint,
  MessageCircle,
  Camera,
  Loader2,
  Pencil,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { userApi, travelPreferencesApi, TravelPreference } from '@/lib/api';
import ProtectedRoute from '@/components/ProtectedRoute';
import Navbar from '@/components/Navbar';

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <Navbar />
      <ProfileContent />
    </ProtectedRoute>
  );
}

function ProfileContent() {
  const { user, logout, refreshUser } = useAuth();
  const [travelPref, setTravelPref] = useState<TravelPreference | null>(null);
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [chattiness, setChattiness] = useState<string>('');
  const [pets, setPets] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Profile edit
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileNickName, setProfileNickName] = useState('');
  const [profileDob, setProfileDob] = useState('');
  const [profileSalutation, setProfileSalutation] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Avatar upload
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    travelPreferencesApi.get()
      .then((res) => setTravelPref(res.data))
      .catch(() => {});
  }, []);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      await userApi.uploadAvatar(file);
      await refreshUser();
    } catch { /* ignore */ }
    finally { setAvatarUploading(false); }
  }

  function startEditProfile() {
    setEditingProfile(true);
    setProfileName(user?.name || '');
    setProfileNickName(user?.nickName || '');
    setProfileDob('');
    setProfileSalutation('');
  }

  async function handleSaveProfile() {
    setProfileSaving(true);
    try {
      const data: Record<string, string> = {};
      if (profileName.trim()) data.name = profileName.trim();
      if (profileNickName.trim()) data.nickName = profileNickName.trim();
      if (profileDob) data.dob = profileDob;
      if (profileSalutation) data.salutation = profileSalutation;
      await userApi.updateProfile(data);
      await refreshUser();
      setEditingProfile(false);
    } catch { /* ignore */ }
    finally { setProfileSaving(false); }
  }

  const handleSavePrefs = async () => {
    setSaving(true);
    try {
      const data: Record<string, string> = {};
      if (chattiness) data.chattiness = chattiness;
      if (pets) data.pets = pets;
      const res = await travelPreferencesApi.save(data as { chattiness?: 'quiet' | 'chatty_when_comfortable' | 'chatterbox'; pets?: 'love_pets' | 'no_pets' | 'depends_on_animal' });
      setTravelPref(res.data);
      setEditingPrefs(false);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const activityLinks = [
    { label: 'Documents', href: '/profile/documents', icon: FileText },
    { label: 'Vehicle', href: '/profile/vehicle', icon: Car },
    { label: 'Ratings', href: '/profile/ratings', icon: Star },
    { label: 'Notifications', href: '/profile/notifications', icon: Bell },
    { label: 'Payment Methods', href: '/profile/payment-methods', icon: CreditCard },
    { label: 'Earnings & Payouts', href: '/profile/earnings', icon: CreditCard },
    { label: 'Disputes', href: '/profile/disputes', icon: Shield },
  ];

  const helpLinks = [
    { label: 'FAQ', href: '/faq', icon: HelpCircle },
    { label: 'Privacy Policy', href: '/privacy', icon: Shield },
    { label: 'Terms & Conditions', href: '/terms', icon: ScrollText },
  ];

  const chattinessLabels: Record<string, string> = {
    quiet: "I'm quiet and prefer silence",
    chatty_when_comfortable: "I'm chatting when comfortable",
    chatterbox: "I love chatting!",
  };

  const petsLabels: Record<string, string> = {
    love_pets: "I love pets",
    no_pets: "No pets please",
    depends_on_animal: "Depends on the animal",
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Profile</h1>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        {/* Left: Profile card */}
        <div className="card flex flex-col items-center text-center">
          <div className="relative mb-3">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-100 overflow-hidden">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
              ) : (
                <User size={32} className="text-primary-500" />
              )}
            </div>
            <label className="absolute -bottom-1 -right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-deliivo-orange text-white shadow-sm hover:bg-orange-600 transition-colors">
              {avatarUploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
              <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={avatarUploading} />
            </label>
          </div>
          <h2 className="text-lg font-bold">{user?.name || 'User'}</h2>
          {user?.nickName && <p className="text-xs text-deliivo-gray">@{user.nickName}</p>}
          {user?.isVerified && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
              <CheckCircle size={12} />
              Verified
            </span>
          )}
          <p className="mt-2 text-sm text-deliivo-gray">{user?.email || user?.phone}</p>
          <button onClick={startEditProfile} className="mt-3 flex items-center gap-1 text-xs font-semibold text-deliivo-orange hover:underline">
            <Pencil size={12} /> Edit profile
          </button>
        </div>

        {/* Right: Settings */}
        <div className="space-y-6">
          {/* Profile Edit Form */}
          {editingProfile && (
            <section className="card">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-deliivo-gray">Edit Profile</h3>
                <button onClick={() => setEditingProfile(false)} className="text-xs font-semibold text-deliivo-orange">Cancel</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">Name</label>
                  <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)} className="input-field" placeholder="Your name" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">Nickname</label>
                  <input type="text" value={profileNickName} onChange={e => setProfileNickName(e.target.value)} className="input-field" placeholder="Username (alphanumeric)" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">Salutation</label>
                  <select value={profileSalutation} onChange={e => setProfileSalutation(e.target.value)} className="input-field">
                    <option value="">Select...</option>
                    <option value="MR">Mr</option>
                    <option value="MS">Ms</option>
                    <option value="MRS">Mrs</option>
                    <option value="MX">Mx</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">Date of Birth</label>
                  <input type="date" value={profileDob} onChange={e => setProfileDob(e.target.value)} className="input-field" />
                </div>
                <button onClick={handleSaveProfile} disabled={profileSaving} className="btn-primary py-2 px-4 text-sm disabled:opacity-50">
                  {profileSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </section>
          )}

          {/* Travel Preferences */}
          <section className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-deliivo-gray">Travel Preference</h3>
              <button
                onClick={() => {
                  setEditingPrefs(!editingPrefs);
                  setChattiness(travelPref?.chattiness || '');
                  setPets(travelPref?.pets || '');
                }}
                className="text-xs font-semibold text-deliivo-orange"
              >
                {editingPrefs ? 'Cancel' : 'Edit'}
              </button>
            </div>

            {editingPrefs ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">Chattiness</label>
                  <select value={chattiness} onChange={(e) => setChattiness(e.target.value)} className="input-field">
                    <option value="">Select...</option>
                    <option value="quiet">Quiet</option>
                    <option value="chatty_when_comfortable">Chatting when comfortable</option>
                    <option value="chatterbox">Love chatting</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">Pets</label>
                  <select value={pets} onChange={(e) => setPets(e.target.value)} className="input-field">
                    <option value="">Select...</option>
                    <option value="love_pets">Love pets</option>
                    <option value="no_pets">No pets</option>
                    <option value="depends_on_animal">Depends on animal</option>
                  </select>
                </div>
                <button onClick={handleSavePrefs} disabled={saving} className="btn-primary py-2 px-4 text-sm disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {travelPref?.chattiness && (
                  <div className="flex items-center gap-2 text-sm">
                    <MessageCircle size={16} className="text-deliivo-gray" />
                    {chattinessLabels[travelPref.chattiness] || travelPref.chattiness}
                  </div>
                )}
                {travelPref?.pets && (
                  <div className="flex items-center gap-2 text-sm">
                    <PawPrint size={16} className="text-deliivo-gray" />
                    {petsLabels[travelPref.pets] || travelPref.pets}
                  </div>
                )}
                {!travelPref?.chattiness && !travelPref?.pets && (
                  <p className="text-sm text-deliivo-gray italic">No preferences set yet</p>
                )}
              </div>
            )}
          </section>

          {/* Activity Links */}
          <section className="card">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-deliivo-gray">Activity</h3>
            <div className="divide-y divide-gray-100">
              {activityLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between py-3 text-sm font-medium text-deliivo-dark hover:text-deliivo-orange transition-colors"
                >
                  <span className="flex items-center gap-3">
                    <link.icon size={18} className="text-deliivo-gray" />
                    {link.label}
                  </span>
                  <ChevronRight size={16} className="text-deliivo-gray" />
                </Link>
              ))}
            </div>
          </section>

          {/* Help */}
          <section className="card">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-deliivo-gray">Help Center</h3>
            <div className="divide-y divide-gray-100">
              {helpLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between py-3 text-sm font-medium text-deliivo-dark hover:text-deliivo-orange transition-colors"
                >
                  <span className="flex items-center gap-3">
                    <link.icon size={18} className="text-deliivo-gray" />
                    {link.label}
                  </span>
                  <ChevronRight size={16} className="text-deliivo-gray" />
                </Link>
              ))}
            </div>
          </section>

          {/* Logout */}
          <button
            onClick={logout}
            className="btn-outline w-full gap-2 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </div>
    </main>
  );
}
