'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loginRequest } from '@/lib/auth';
import { getToken } from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  // Pesan dari halaman lain (?registered=1, ?reset=1, ?expired=1) + lewati login jika sudah punya sesi
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('registered')) setInfoMessage('Pendaftaran berhasil. Silakan masuk dengan akun Anda.');
    else if (q.get('reset')) setInfoMessage('Kata sandi berhasil diubah. Silakan masuk dengan kata sandi baru.');
    else if (q.get('expired')) setErrorMessage('Sesi Anda berakhir. Silakan masuk kembali.');
    else if (getToken()) window.location.href = '/';
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage('');
    setInfoMessage('');

    try {
      await loginRequest(email.trim(), password);
      window.location.href = '/';
    } catch (error: any) {
      console.error('Login error:', error);
      setErrorMessage(error.message || 'Gagal terhubung ke server backend.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div suppressHydrationWarning className="relative min-h-screen w-full bg-slate-50 flex items-center justify-center font-sans p-4 overflow-hidden">
      {/* 1. Background Video DNA */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-50 mix-blend-luminosity">
          <source src="/dna-bg-video.mp4" type="video/mp4" />
          Browser Anda tidak mendukung tag video.
        </video>
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px]"></div>
      </div>

      {/* 2. Card UI Glassmorphism */}
      <div suppressHydrationWarning className="relative z-10 w-full max-w-sm bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)] space-y-6">
        {/* LOGO & TITLE */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="p-2 bg-white/80 rounded-xl backdrop-blur-md border border-slate-100 shadow-sm">
              <img src="/GenoSphere Logo.png" alt="GenoSphere Logo" className="h-8 w-auto object-contain" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent pb-1">
            GenoSphere-GWAS
          </h1>
          <p className="text-xs text-slate-500 font-medium">Platform Analisis Bioinformatika Lanjut</p>
        </div>

        {infoMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl text-center font-medium">
            {infoMessage}
          </div>
        )}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl text-center font-medium animate-fadeIn">
            {errorMessage}
          </div>
        )}

        {/* FORM LOGIN */}
        <form onSubmit={handleLogin} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label className="block text-sm text-slate-700 font-semibold ml-1">Email / Username</label>
            <input
              type="text"
              required
              autoComplete="username"
              placeholder="Masukkan email atau username..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/90 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-300 shadow-sm text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm text-slate-700 font-semibold ml-1">Kata Sandi</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/90 border border-slate-200 rounded-xl pl-4 pr-16 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-300 shadow-sm text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-500 hover:text-blue-600"
              >
                {showPassword ? 'Sembunyi' : 'Lihat'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full relative group overflow-hidden rounded-xl font-semibold py-3 transition-all duration-300 transform hover:-translate-y-0.5 shadow-[0_8px_20px_rgba(37,99,235,0.2)] hover:shadow-[0_10px_25px_rgba(16,185,129,0.25)] mt-6 disabled:opacity-50 cursor-pointer"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500 opacity-90 group-hover:opacity-100 transition-opacity duration-300"></div>
            <span className="relative text-white text-sm tracking-wide">{isLoading ? 'Memvalidasi...' : 'Masuk'}</span>
          </button>
        </form>

        {/* FOOTER LINK */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-6 mt-6 border-t border-slate-200">
          <Link href="/forgot-password" className="hover:text-blue-600 hover:underline transition font-medium">
            Lupa Kata Sandi?
          </Link>
          <span className="text-slate-300">•</span>
          <Link href="/register" className="hover:text-blue-600 hover:underline transition font-medium">
            Daftar Akun Baru
          </Link>
        </div>
      </div>
    </div>
  );
}
