'use client';

import Link from 'next/link';
import { useState } from 'react';
import { registerRequest } from '@/lib/auth';

const inputCls =
  'w-full bg-white/90 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-300 shadow-sm text-sm';

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (formData.password.length < 8) {
      setErrorMessage('Kata sandi minimal 8 karakter.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setErrorMessage('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setIsLoading(true);
    try {
      await registerRequest({
        fullName: formData.fullName.trim(),
        email: formData.email.trim(),
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      });
      window.location.href = '/login?registered=1';
    } catch (err: any) {
      console.error('Register error:', err);
      setErrorMessage(err.message || 'Gagal terhubung ke server backend.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full bg-slate-50 flex items-center justify-center font-sans p-4 overflow-hidden">
      {/* 1. Background Video DNA */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-50 mix-blend-luminosity">
          <source src="/dna-bg-video.mp4" type="video/mp4" />
          Browser Anda tidak mendukung tag video.
        </video>
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px]"></div>
      </div>

      {/* 2. Card UI Glassmorphism */}
      <div className="relative z-10 w-full max-w-md bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)] space-y-6">
        {/* Header Section */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="p-2 bg-white/80 rounded-xl backdrop-blur-md border border-slate-100 shadow-sm">
              <img src="/GenoSphere Logo.png" alt="GenoSphere Logo" className="h-8 w-auto object-contain" />
            </div>
            <span className="font-bold text-2xl tracking-wide bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent pb-1">
              GenoSphere
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Buat Akun Baru</h1>
          <p className="text-sm text-slate-500">Daftar untuk mulai menganalisis data genomik Anda</p>
        </div>

        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl text-center font-medium">
            {errorMessage}
          </div>
        )}

        {/* Form Section */}
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label className="block text-sm text-slate-700 font-semibold ml-1">Nama Lengkap</label>
            <input
              type="text"
              required
              autoComplete="name"
              placeholder="Dr. John Doe"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className={inputCls}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm text-slate-700 font-semibold ml-1">Alamat Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="peneliti@institusi.ac.id"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm text-slate-700 font-semibold ml-1">Kata Sandi</label>
              <input
                type="password"
                required
                autoComplete="new-password"
                placeholder="Min. 8 karakter"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm text-slate-700 font-semibold ml-1">Konfirmasi</label>
              <input
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full relative group overflow-hidden rounded-xl font-semibold py-3 transition-all duration-300 transform hover:-translate-y-0.5 shadow-[0_8px_20px_rgba(37,99,235,0.2)] hover:shadow-[0_10px_25px_rgba(16,185,129,0.25)] mt-6 disabled:opacity-50"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500 opacity-90 group-hover:opacity-100 transition-opacity duration-300"></div>
            <span className="relative text-white text-sm tracking-wide">{isLoading ? 'Mendaftarkan...' : 'Daftar Sekarang'}</span>
          </button>
        </form>

        <div className="text-center text-sm text-slate-500 pt-6 mt-6 border-t border-slate-200">
          Sudah punya akun?{' '}
          <Link href="/login" className="text-blue-600 hover:text-blue-700 hover:underline font-semibold transition-colors">
            Masuk di sini
          </Link>
        </div>
      </div>
    </div>
  );
}
