'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { resetPasswordRequest } from '@/lib/auth';

const inputCls =
  'w-full bg-white/90 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-300 shadow-sm text-sm';

function ResetPasswordForm() {
  // Tautan dari email: https://<frontend>/reset-password?token=XXXX
  const token = useSearchParams().get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (password.length < 8) {
      setErrorMessage('Kata sandi minimal 8 karakter.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setIsLoading(true);
    try {
      await resetPasswordRequest(token, password, confirmPassword);
      setDone(true);
      setTimeout(() => (window.location.href = '/login?reset=1'), 1800);
    } catch (err: any) {
      console.error('Reset password error:', err);
      setErrorMessage(err.message || 'Gagal terhubung ke server backend.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative z-10 w-full max-w-md bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)] space-y-6">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="p-2 bg-white/80 rounded-xl backdrop-blur-md border border-slate-100 shadow-sm">
            <img src="/GenoSphere Logo.png" alt="GenoSphere Logo" className="h-8 w-auto object-contain" />
          </div>
          <span className="font-bold text-2xl tracking-wide bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent">
            GenoSphere
          </span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Atur Kata Sandi Baru</h1>
        <p className="text-sm text-slate-500">Buat kata sandi baru untuk akun Anda.</p>
      </div>

      {!token ? (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-2xl text-center space-y-2">
          <p>Tautan pemulihan tidak valid atau tidak lengkap.</p>
          <Link href="/forgot-password" className="font-semibold underline">Minta tautan baru</Link>
        </div>
      ) : done ? (
        <div className="p-5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-2xl text-center">
          Kata sandi berhasil diubah. Mengalihkan ke halaman masuk...
        </div>
      ) : (
        <>
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl text-center font-medium space-y-1">
              <p>{errorMessage}</p>
              <Link href="/forgot-password" className="underline font-semibold">Minta tautan baru</Link>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm text-slate-700 font-semibold ml-1">Kata Sandi Baru</label>
              <input
                type="password"
                required
                autoComplete="new-password"
                placeholder="Minimal 8 karakter"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm text-slate-700 font-semibold ml-1">Konfirmasi Kata Sandi Baru</label>
              <input
                type="password"
                required
                autoComplete="new-password"
                placeholder="Ulangi kata sandi baru"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full relative group overflow-hidden rounded-xl font-semibold py-3 transition-all duration-300 transform hover:-translate-y-0.5 shadow-[0_8px_20px_rgba(37,99,235,0.2)] hover:shadow-[0_10px_25px_rgba(16,185,129,0.25)] mt-2 disabled:opacity-50"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500 opacity-90 group-hover:opacity-100 transition-opacity duration-300"></div>
              <span className="relative text-white text-sm tracking-wide">{isLoading ? 'Menyimpan...' : 'Simpan Kata Sandi Baru'}</span>
            </button>
          </form>
        </>
      )}

      <div className="text-center pt-6 mt-6 border-t border-slate-200">
        <Link href="/login" className="text-sm text-slate-500 hover:text-blue-600 font-medium inline-flex items-center gap-2 transition-colors group">
          <span className="group-hover:-translate-x-1 transition-transform duration-300">←</span>
          Kembali ke Halaman Masuk
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="relative min-h-screen w-full bg-slate-50 flex items-center justify-center font-sans p-4 overflow-hidden">
      <div className="absolute inset-0 z-0 overflow-hidden">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-50 mix-blend-luminosity">
          <source src="/dna-bg-video.mp4" type="video/mp4" />
          Browser Anda tidak mendukung tag video.
        </video>
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px]"></div>
      </div>
      <Suspense fallback={<div className="relative z-10 text-sm text-slate-500">Memuat...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
