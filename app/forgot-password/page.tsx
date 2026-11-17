'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { forgotPasswordRequest } from '@/lib/auth';

const COOLDOWN_SECONDS = 60;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // Hitung mundur sebelum boleh kirim ulang
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      await forgotPasswordRequest(email.trim());
      setIsSubmitted(true);
      setCooldown(COOLDOWN_SECONDS);
    } catch (err: any) {
      console.error('Forgot password error:', err);
      setErrorMessage(err.message || 'Gagal terhubung ke server backend.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send();
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
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-2 bg-white/80 rounded-xl backdrop-blur-md border border-slate-100 shadow-sm">
              <img src="/GenoSphere Logo.png" alt="GenoSphere Logo" className="h-8 w-auto object-contain" />
            </div>
            <span className="font-bold text-2xl tracking-wide bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent">
              GenoSphere
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Lupa Kata Sandi?</h1>
          <p className="text-sm text-slate-500">
            {isSubmitted
              ? 'Permintaan pemulihan diterima.'
              : 'Masukkan email terdaftar Anda untuk pemulihan.'}
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl text-center font-medium">
            {errorMessage}
          </div>
        )}

        {/* Form Section */}
        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="space-y-5 mt-4">
            <div className="space-y-1.5">
              <label className="block text-sm text-slate-700 font-semibold ml-1">Alamat Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="peneliti@institusi.ac.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/90 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-300 shadow-sm"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full relative group overflow-hidden rounded-xl font-semibold py-3 transition-all duration-300 transform hover:-translate-y-0.5 shadow-[0_8px_20px_rgba(37,99,235,0.2)] hover:shadow-[0_10px_25px_rgba(16,185,129,0.25)] disabled:opacity-50"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500 opacity-90 group-hover:opacity-100 transition-opacity duration-300"></div>
              <span className="relative text-white text-sm tracking-wide">
                {isLoading ? 'Mengirim...' : 'Kirim Tautan Pemulihan'}
              </span>
            </button>
          </form>
        ) : (
          <div className="space-y-3 mt-4">
            <div className="relative overflow-hidden bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center shadow-sm">
              <p className="text-sm text-emerald-800 leading-relaxed">
                Jika <span className="font-bold text-emerald-950">{email}</span> terdaftar, tautan untuk mengatur
                kata sandi baru telah dikirim. Periksa kotak masuk dan folder spam. Tautan berlaku terbatas waktu.
              </p>
            </div>
            <button
              type="button"
              onClick={send}
              disabled={cooldown > 0 || isLoading}
              className="w-full text-xs font-semibold text-slate-600 hover:text-blue-600 disabled:text-slate-400 disabled:cursor-not-allowed transition"
            >
              {cooldown > 0 ? `Kirim ulang dalam ${cooldown} detik` : 'Belum menerima email? Kirim ulang'}
            </button>
          </div>
        )}

        <div className="text-center pt-6 mt-6 border-t border-slate-200">
          <Link href="/login" className="text-sm text-slate-500 hover:text-blue-600 font-medium inline-flex items-center gap-2 transition-colors group">
            <span className="group-hover:-translate-x-1 transition-transform duration-300">←</span>
            Kembali ke Halaman Masuk
          </Link>
        </div>
      </div>
    </div>
  );
}
