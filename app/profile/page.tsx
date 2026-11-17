'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePipelineStore } from '@/store/usePipelineStore';
import { logout, updateMe, useAuthProfile } from '@/lib/auth';

const inputCls =
  'w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition';

export default function ProfilePage() {
  // Cek login + muat profil asli dari /api/me ke store
  useAuthProfile();
  const { userProfile, updateUserProfile } = usePipelineStore();

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [form, setForm] = useState({ fullName: '', institution: '', bio: '' });

  // Sinkronkan form dengan data terbaru dari server
  useEffect(() => {
    if (!isEditing) {
      setForm({
        fullName: userProfile?.fullName || '',
        institution: userProfile?.institution || '',
        bio: userProfile?.bio || '',
      });
    }
  }, [userProfile, isEditing]);

  const getUserName = () => {
    if (userProfile?.fullName) return userProfile.fullName;
    if (userProfile?.email) {
      const namePart = userProfile.email.split('@')[0];
      return namePart
        .split(/[._-]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
    }
    return 'Pengguna';
  };

  const getUserInitial = () => getUserName().charAt(0).toUpperCase();
  const username = userProfile?.username || (userProfile?.email ? userProfile.email.split('@')[0] : '');

  const handleSave = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    if (!form.fullName.trim()) {
      setErrorMessage('Nama lengkap tidak boleh kosong.');
      return;
    }
    setIsSaving(true);
    try {
      const updated = await updateMe({
        fullName: form.fullName.trim(),
        institution: form.institution.trim(),
        bio: form.bio.trim(),
      });
      updateUserProfile(updated);
      setIsEditing(false);
      setSuccessMessage('Profil berhasil diperbarui.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menyimpan profil.');
    } finally {
      setIsSaving(false);
    }
  };

  const cardCls = 'bg-white/80 border border-white rounded-xl p-4 shadow-sm space-y-1.5 transition hover:shadow-md';
  const labelCls = 'text-[10px] font-bold text-slate-500 uppercase tracking-wider block';

  return (
    <div
      suppressHydrationWarning
      className="relative min-h-screen w-full bg-slate-50 flex flex-col justify-between overflow-x-hidden font-sans p-6 md:p-10"
    >
      {/* 1. Background Video DNA */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-50 mix-blend-luminosity">
          <source src="/dna-bg-video.mp4" type="video/mp4" />
          Browser Anda tidak mendukung tag video.
        </video>
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px]"></div>
      </div>

      <div className="relative z-10 max-w-3xl mx-auto w-full space-y-6 my-auto">
        {/* HEADER NAVIGATION BACK */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Profil Pengguna</h1>
            <p className="text-sm text-slate-600 mt-1">Informasi akun peneliti yang terhubung ke pipeline GenoSphere-GWAS.</p>
          </div>
          <Link
            href="/pipeline/step-1"
            className="px-4 py-2.5 bg-white/70 hover:bg-white text-slate-700 text-xs font-semibold rounded-xl transition-all duration-300 border border-white shadow-sm hover:shadow-md flex items-center gap-2 backdrop-blur-md"
          >
            ← Kembali ke Pipeline
          </Link>
        </div>

        {successMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl font-medium">{successMessage}</div>
        )}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">{errorMessage}</div>
        )}

        {/* KARTU PROFIL (GLASSMORPHISM) */}
        <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)] space-y-6">
          {/* HEADER AVATAR & NAMA */}
          <div className="flex items-center justify-between gap-4 pb-6 border-b border-white/50">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-emerald-600 text-white flex items-center justify-center font-bold text-3xl shadow-lg shadow-blue-600/30 shrink-0">
                {getUserInitial()}
              </div>
              <div>
                <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">{getUserName()}</h2>
                <p className="text-sm font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent mt-0.5">
                  @{username || '-'}
                </p>
              </div>
            </div>
            {!isEditing && (
              <button
                onClick={() => { setIsEditing(true); setSuccessMessage(''); setErrorMessage(''); }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition shadow-sm"
              >
                Ubah Profil
              </button>
            )}
          </div>

          {/* DETAIL INFORMASI AKUN */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
            <div className={cardCls}>
              <span className={labelCls}>Nama Lengkap</span>
              {isEditing ? (
                <input className={inputCls} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              ) : (
                <p className="text-sm font-semibold text-slate-800">{userProfile?.fullName || '-'}</p>
              )}
            </div>

            <div className={cardCls}>
              <span className={labelCls}>Username</span>
              <p className="text-sm font-semibold text-slate-800">@{username || '-'}</p>
            </div>

            <div className={`${cardCls} md:col-span-2`}>
              <span className={labelCls}>Alamat Email</span>
              <p className="text-sm font-semibold text-slate-800 font-mono">{userProfile?.email || '-'}</p>
              {isEditing && <p className="text-[10px] text-slate-500">Email tidak dapat diubah.</p>}
            </div>

            <div className={`${cardCls} md:col-span-2`}>
              <span className={labelCls}>Institusi & Program Studi</span>
              {isEditing ? (
                <input
                  className={inputCls}
                  placeholder="mis. Program Studi Bioinformatika, FMIPA, IPB University"
                  value={form.institution}
                  onChange={(e) => setForm({ ...form, institution: e.target.value })}
                />
              ) : (
                <p className="text-sm font-semibold text-slate-800">{userProfile?.institution || '-'}</p>
              )}
            </div>

            <div className={`${cardCls} md:col-span-2`}>
              <span className={labelCls}>Bio / Bidang Penelitian</span>
              {isEditing ? (
                <textarea
                  rows={3}
                  className={inputCls}
                  placeholder="Ceritakan bidang penelitian Anda"
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                />
              ) : (
                <p className="text-sm text-slate-700 leading-relaxed font-medium">{userProfile?.bio || '-'}</p>
              )}
            </div>
          </div>

          {isEditing && (
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setIsEditing(false); setErrorMessage(''); }}
                disabled={isSaving}
                className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2 bg-gradient-to-r from-blue-600 to-emerald-500 text-white text-xs font-semibold rounded-xl shadow-sm hover:opacity-95 disabled:opacity-60 transition"
              >
                {isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          )}

          {/* STATUS INTEGRASI + KELUAR */}
          <div className="flex items-center justify-between gap-4 p-4 bg-blue-50/80 border border-blue-100/50 backdrop-blur-md rounded-xl text-xs text-blue-900 font-medium">
            <div className="flex items-center gap-3">
              <span className="text-blue-600 text-lg">ℹ️</span>
              <span>Data profil dimuat langsung dari akun sesi aktif Anda di server.</span>
            </div>
            <button
              onClick={logout}
              className="shrink-0 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-semibold transition"
            >
              Keluar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
