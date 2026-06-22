'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  User,
  CheckCircle,
  Car,
  Bell,
  CreditCard,
  Wallet,
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
  Route,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getApiErrorMessage, userApi, travelPreferencesApi, TravelPreference, UserFullProfile } from '@/lib/api';
import ProtectedRoute from '@/components/ProtectedRoute';
import Navbar from '@/components/Navbar';
import { showError, showSuccess } from '@/lib/app-feedback';
import { useTranslation } from '@/lib/i18n-context';

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
  const { t } = useTranslation();
  const [travelPref, setTravelPref] = useState<TravelPreference | null>(null);
  const [fullProfile, setFullProfile] = useState<UserFullProfile | null>(null);
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
  const [profileGender, setProfileGender] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Avatar upload
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    travelPreferencesApi.get()
      .then((res) => setTravelPref(res.data))
      .catch(() => {});
    userApi.getMyProfile()
      .then((res) => setFullProfile(res.data))
      .catch(() => {});
  }, []);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      await userApi.uploadAvatar(file);
      await refreshUser();
      showSuccess(t('profile.photoUpdated'));
    } catch (err: unknown) {
      showError(t('profile.photoUploadFailed'), getApiErrorMessage(err, t('profile.photoUploadFailed')));
    }
    finally { setAvatarUploading(false); }
  }

  function startEditProfile() {
    setEditingProfile(true);
    setProfileName(user?.name || '');
    setProfileNickName(user?.nickName || '');
    setProfileDob('');
    setProfileSalutation(user?.salutation || '');
    setProfileGender(user?.gender || '');
  }

  async function handleSaveProfile() {
    setProfileSaving(true);
    try {
      const data: Record<string, string> = {};
      if (profileName.trim()) data.name = profileName.trim();
      if (profileNickName.trim()) data.nickName = profileNickName.trim();
      if (profileDob) data.dob = profileDob;
      if (profileSalutation) data.salutation = profileSalutation;
      if (profileGender) data.gender = profileGender;
      await userApi.updateProfile(data);
      await refreshUser();
      setEditingProfile(false);
      showSuccess(t('profile.updated'), t('profile.updatedCopy'));
    } catch (err: unknown) {
      showError(t('profile.saveFailed'), getApiErrorMessage(err, t('profile.saveFailed')));
    }
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
      showSuccess(t('profile.preferencesSaved'), t('profile.preferencesSavedCopy'));
    } catch (err: unknown) {
      showError(t('profile.preferencesSaveFailed'), getApiErrorMessage(err, t('profile.preferencesSaveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const activityLinks = [
    { label: t('rides.myRides'), href: '/rides', icon: Route },
    { label: t('profile.vehicle'), href: '/profile/vehicle', icon: Car },
    { label: t('nav.notifications'), href: '/profile/notifications', icon: Bell },
    { label: t('profile.paymentsHistory'), href: '/profile/payment-methods', icon: CreditCard },
    { label: t('profile.earningsPayouts'), href: '/profile/earnings', icon: Wallet },
    { label: t('profile.disputes'), href: '/profile/disputes', icon: Shield },
  ];

  const helpLinks = [
    { label: 'FAQ', href: '/faq', icon: HelpCircle },
    { label: t('privacy.title'), href: '/privacy', icon: Shield },
    { label: t('legal.termsTitle'), href: '/terms', icon: ScrollText },
  ];

  const chattinessLabels: Record<string, string> = {
    quiet: t('profile.quiet'),
    chatty_when_comfortable: t('profile.chattyComfortable'),
    chatterbox: t('profile.chatterbox'),
  };

  const petsLabels: Record<string, string> = {
    love_pets: t('profile.lovePets'),
    no_pets: t('profile.noPets'),
    depends_on_animal: t('profile.dependsOnAnimal'),
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-deliivo-dark">{t('profile.title')}</h1>
          <p className="text-sm text-deliivo-gray">{t('profile.subtitle')}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Left: Profile card */}
        <aside className="card flex flex-col items-center text-center lg:sticky lg:top-24 lg:self-start">
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
          <h2 className="text-lg font-bold">{user?.name || t('profile.user')}</h2>
          {user?.nickName && <p className="text-xs text-deliivo-gray">@{user.nickName}</p>}
          {user?.isVerified && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
              <CheckCircle size={12} />
              {t('profile.verified')}
            </span>
          )}
          <p className="mt-2 text-sm text-deliivo-gray">{user?.email || user?.phone}</p>
          <div className="mt-4 grid w-full grid-cols-1 gap-2 text-center sm:grid-cols-3">
            <div className="rounded-xl bg-gray-50 px-2 py-2">
              <p className="text-xs font-semibold text-deliivo-dark">
                {fullProfile?.rating?.average ? fullProfile.rating.average.toFixed(1) : '--'}
              </p>
              <p className="text-[11px] text-deliivo-gray">{t('profile.rating')}</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-2 py-2">
              <p className="text-xs font-semibold text-deliivo-dark">
                {fullProfile?.stats?.successfulPublishedRides ?? 0}
              </p>
              <p className="text-[11px] text-deliivo-gray">{t('profile.driven')}</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-2 py-2">
              <p className="text-xs font-semibold text-deliivo-dark">
                {fullProfile?.stats?.successfulCompletedRides ?? 0}
              </p>
              <p className="text-[11px] text-deliivo-gray">{t('profile.ridden')}</p>
            </div>
          </div>
          <button onClick={startEditProfile} className="mt-3 flex items-center gap-1 text-xs font-semibold text-deliivo-orange hover:underline">
            <Pencil size={12} /> {t('profile.editProfile')}
          </button>
        </aside>

        {/* Right: Settings */}
        <div className="space-y-6">
          {/* Profile Edit Form */}
          {editingProfile && (
            <section className="card">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.editProfile')}</h3>
                <button onClick={() => setEditingProfile(false)} className="text-xs font-semibold text-deliivo-orange">{t('common.cancel')}</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">{t('profile.name')}</label>
                  <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)} className="input-field" placeholder={t('profile.namePlaceholder')} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">{t('profile.nickname')}</label>
                  <input type="text" value={profileNickName} onChange={e => setProfileNickName(e.target.value)} className="input-field" placeholder={t('profile.nicknamePlaceholder')} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">{t('profile.salutation')}</label>
                  <select value={profileSalutation} onChange={e => setProfileSalutation(e.target.value)} className="input-field">
                    <option value="">{t('profile.select')}</option>
                    <option value="MR">{t('profile.mr')}</option>
                    <option value="MS">{t('profile.ms')}</option>
                    <option value="MRS">{t('profile.mrs')}</option>
                    <option value="MX">{t('profile.mx')}</option>
                    <option value="OTHER">{t('profile.other')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">{t('profile.gender')}</label>
                  <select value={profileGender} onChange={e => setProfileGender(e.target.value)} className="input-field">
                    <option value="">{t('profile.select')}</option>
                    <option value="FEMALE">{t('profile.female')}</option>
                    <option value="MALE">{t('profile.male')}</option>
                    <option value="NON_BINARY">{t('profile.nonBinary')}</option>
                    <option value="OTHER">{t('profile.other')}</option>
                    <option value="PREFER_NOT_TO_SAY">{t('profile.preferNotSay')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">{t('profile.dob')}</label>
                  <input type="date" value={profileDob} onChange={e => setProfileDob(e.target.value)} className="input-field" />
                </div>
                <button onClick={handleSaveProfile} disabled={profileSaving} className="btn-primary py-2 px-4 text-sm disabled:opacity-50">
                  {profileSaving ? t('profile.saving') : t('profile.saveProfile')}
                </button>
              </div>
            </section>
          )}

          {/* Travel Preferences */}
          <section className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.travelPreference')}</h3>
              <button
                onClick={() => {
                  setEditingPrefs(!editingPrefs);
                  setChattiness(travelPref?.chattiness || '');
                  setPets(travelPref?.pets || '');
                }}
                className="text-xs font-semibold text-deliivo-orange"
              >
                {editingPrefs ? t('common.cancel') : t('profile.edit')}
              </button>
            </div>

            {editingPrefs ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">{t('profile.chattiness')}</label>
                  <select value={chattiness} onChange={(e) => setChattiness(e.target.value)} className="input-field">
                    <option value="">{t('profile.select')}</option>
                    <option value="quiet">{t('profile.quietShort')}</option>
                    <option value="chatty_when_comfortable">{t('profile.chattyComfortableShort')}</option>
                    <option value="chatterbox">{t('profile.chatterboxShort')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-deliivo-gray">{t('profile.pets')}</label>
                  <select value={pets} onChange={(e) => setPets(e.target.value)} className="input-field">
                    <option value="">{t('profile.select')}</option>
                    <option value="love_pets">{t('profile.lovePetsShort')}</option>
                    <option value="no_pets">{t('profile.noPetsShort')}</option>
                    <option value="depends_on_animal">{t('profile.dependsOnAnimalShort')}</option>
                  </select>
                </div>
                <button onClick={handleSavePrefs} disabled={saving} className="btn-primary py-2 px-4 text-sm disabled:opacity-50">
                  {saving ? t('profile.saving') : t('profile.savePreferences')}
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
                  <p className="text-sm text-deliivo-gray italic">{t('profile.noPreferences')}</p>
                )}
              </div>
            )}
          </section>

          {/* Activity Links */}
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="card">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.activity')}</h3>
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
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.helpCenter')}</h3>
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
          </div>

          {/* Logout */}
          <button
            onClick={logout}
            className="btn-outline w-full gap-2 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={16} />
            {t('profile.logOut')}
          </button>
        </div>
      </div>
    </main>
  );
}
