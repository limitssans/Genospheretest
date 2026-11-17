'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { API_BASE, authHeaders, clearSession, getToken } from '@/lib/api';
import { MeProfile, logout, normalizeUser } from '@/lib/auth';

// Data Tim Penyusun
const TEAM_MEMBERS = [
  {
    id: 1,
    name: "Pramoedya Favian Alfarisy",
    nim: "G0401241022",
    role: "Project Manager",
    desc: "Memimpin perencanaan, eksekusi, dan manajemen risiko proyek GenoSphere-GWAS untuk memastikan seluruh pipeline berjalan sesuai timeline.",
    img: "/team-pramoedya.png"
  },
  {
    id: 2,
    name: "Nakhwah Zulfatul Wardah",
    nim: "G0401241026",
    role: "System Analyst",
    desc: "Menganalisis kebutuhan sistem komputasi biologi dan merancang arsitektur alur data (pipeline) agar efisien, akurat, dan terstruktur.",
    img: "/team-nakhwah.png"
  },
  {
    id: 3,
    name: "Akmal Fauzan Nurantho",
    nim: "G0401241060",
    role: "Backend Developer",
    desc: "Mengelola pemrosesan data genomik di sisi server, optimalisasi database, dan integrasi algoritma GWAS ke dalam sistem inti aplikasi.",
    img: "/team-akmal.png"
  },
  {
    id: 4,
    name: "Aulia Gianinda",
    nim: "G0401241050",
    role: "Frontend Developer",
    desc: "Merancang UI/UX yang intuitif, modern, dan interaktif. Memastikan pengalaman pengguna (peneliti) yang elegan dan sangat responsif.",
    img: "/team-aulia.png"
  },
  {
    id: 5,
    name: "Evantri Nouval Pambudi Hanif",
    nim: "G0401241041",
    role: "Quality Control",
    desc: "Menguji keandalan perangkat lunak, mendeteksi bug pada sistem, dan memvalidasi keakuratan hasil komputasi pipeline GWAS.",
    img: "/team-evantri.png"
  }
];

export default function LandingPage() {
  const [selectedMember, setSelectedMember] = useState<typeof TEAM_MEMBERS[0] | null>(null);
  
  // State untuk memantau visibilitas scroll bagian GWAS & Tim
  const [gwasVisible, setGwasVisible] = useState(false);
  const [teamVisible, setTeamVisible] = useState(false);

  // Status login: beranda tetap tampil (tidak langsung masuk pipeline), tetapi menunya menyesuaikan
  const [loggedIn, setLoggedIn] = useState(false);
  const [me, setMe] = useState<MeProfile | null>(null);
  const [recent, setRecent] = useState<Array<{ id: number; status: string; trait: string; model: string; createdAt: string }>>([]);

  useEffect(() => {
    if (!getToken()) return;
    setLoggedIn(true);
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/me`, { headers: authHeaders() });
        if (r.status === 401) {
          clearSession(); // token kedaluwarsa: tampilkan beranda sebagai tamu
          setLoggedIn(false);
          return;
        }
        if (r.ok) setMe(normalizeUser(await r.json()));
        const a = await fetch(`${API_BASE}/api/gwas/analyses`, { headers: authHeaders() });
        if (a.ok) {
          const d = await a.json();
          const list: any[] = Array.isArray(d) ? d : d.items ?? d.analyses ?? d.results ?? [];
          setRecent(
            list
              .map((x) => ({
                id: Number(x.analysis_id ?? x.id),
                status: String(x.status ?? '').toLowerCase(),
                trait: String(x.trait_name ?? x.config?.trait_name ?? ''),
                model: String(x.model ?? x.config?.model ?? ''),
                createdAt: String(x.created_at ?? x.queued_at ?? x.started_at ?? ''),
              }))
              .filter((x) => Number.isFinite(x.id))
              .sort((x, y) => y.id - x.id)
              .slice(0, 3)
          );
        }
      } catch {
        /* beranda tetap dapat dipakai tanpa data akun */
      }
    })();
  }, []);

  const displayName = me?.fullName || me?.email?.split('@')[0] || 'Peneliti';
  const statusLabel = (st: string) =>
    ['done', 'completed', 'success'].includes(st) ? 'Selesai'
    : ['failed', 'error'].includes(st) ? 'Gagal'
    : st === 'awaiting' ? 'Menunggu langkah berikutnya'
    : st ? 'Berjalan' : '-';

  const gwasRef = useRef<HTMLDivElement>(null);
  const teamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observerOptions = { threshold: 0.15 };

    const gwasObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setGwasVisible(true);
        }
      });
    }, observerOptions);

    const teamObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setTeamVisible(true);
        }
      });
    }, observerOptions);

    if (gwasRef.current) gwasObserver.observe(gwasRef.current);
    if (teamRef.current) teamObserver.observe(teamRef.current);

    return () => {
      if (gwasRef.current) gwasObserver.unobserve(gwasRef.current);
      if (teamRef.current) teamObserver.unobserve(teamRef.current);
    };
  }, []);

  return (
    <div className="relative w-full min-h-screen bg-[#0B2545] text-slate-100 font-sans selection:bg-teal-500 selection:text-white overflow-x-hidden scroll-smooth">
      
      {/* ================= NAVBAR UTAMA (DENGAN SMOOTH SCROLL LINK) ================= */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-[#0B2545]/90 backdrop-blur-md border-b border-white/10 px-6 lg:px-16 py-4 flex items-center justify-between transition-all duration-300">
        <Link href="/" className="flex items-center gap-3 group">
          <img src="/GenoSphere Logo.png" alt="GenoSphere Logo" className="h-8 w-auto object-contain transition-transform duration-300 group-hover:scale-105" />
          <span className="font-bold text-lg tracking-wider text-white group-hover:text-teal-400 transition-colors">
            GenoSphere<span className="text-teal-400">-GWAS</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-xs font-semibold uppercase tracking-widest text-slate-300">
          <a href="#overview" className="hover:text-teal-400 transition-colors">Overview</a>
          <a href="#gwas" className="hover:text-teal-400 transition-colors">Tentang GWAS</a>
          <a href="#team" className="hover:text-teal-400 transition-colors">Tim Penyusun</a>
          {loggedIn && (
            <Link href="/history" className="text-teal-300 hover:text-teal-200 transition-colors">Riwayat Analisis</Link>
          )}
        </nav>

        {loggedIn ? (
          <div className="flex items-center gap-3">
            <Link href="/profile" className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-400 to-indigo-500 text-slate-950 flex items-center justify-center font-bold text-xs">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:block text-xs font-semibold text-slate-200 max-w-[140px] truncate">{displayName}</span>
            </Link>
            <button onClick={logout} className="text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white transition-colors px-2 py-2">
              Keluar
            </button>
            <Link
              href="/pipeline/step-1"
              className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs uppercase tracking-wider px-5 py-2.5 rounded-lg transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)] hover:scale-105 active:scale-95"
            >
              Analisis Baru
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white transition-colors px-3 py-2"
            >
              Masuk
            </Link>
            <Link
              href="/login"
              className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs uppercase tracking-wider px-5 py-2.5 rounded-lg transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)] hover:scale-105 active:scale-95"
            >
              Mulai Analisis
            </Link>
          </div>
        )}
      </header>

      {/* ================= SECTION 1: HERO OVERVIEW ================= */}
      <section id="overview" className="relative z-10 min-h-screen flex items-center justify-center px-6 lg:px-16 pt-24 pb-16 overflow-hidden">
        
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover opacity-40 mix-blend-luminosity scale-105 transition-transform duration-1000"
          >
            <source src="/dna-bg-video.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-[#0B2545]/85 backdrop-blur-[1px]"></div>
        </div>

        <div className="relative z-10 max-w-7xl w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          <div className="lg:col-span-7 relative">
            <div className="relative w-full aspect-[16/10] rounded-[2rem] overflow-hidden border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.5)] bg-slate-900 group">
              <img 
                src="/dna-bg.jpeg" 
                alt="Genomic Analysis" 
                className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B2545]/90 via-transparent to-transparent"></div>
              
              <div className="absolute bottom-6 left-6 right-6 p-6 bg-slate-950/70 backdrop-blur-md border border-white/10 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-teal-400 font-bold mb-1">Platform Status</p>
                  <p className="text-sm font-semibold text-white">Pipeline Komputasi GWAS Aktif & Terintegrasi</p>
                </div>
                <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping"></div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6 animate-fadeIn">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/30 text-teal-300 text-xs font-semibold tracking-wider uppercase transition-transform hover:scale-105">
              <span>🧬 Advanced Bioinformatics</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
              MAPPING THE <br />
              <span className="bg-gradient-to-r from-teal-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
                GENOME FUTURE
              </span>
            </h1>

            <p className="text-slate-300 text-sm sm:text-base leading-relaxed font-medium">
              Platform analisis genomik berbasis web untuk memfasilitasi riset asosiasi seluruh genom secara presisi, cepat, dan terstruktur bagi para peneliti modern.
            </p>

            {loggedIn && (
              <p className="text-sm text-teal-300 font-semibold">Selamat datang kembali, {displayName} 👋</p>
            )}

            <div className="pt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <Link 
                href={loggedIn ? '/pipeline/step-1' : '/login'} 
                className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm tracking-wide px-8 py-4 rounded-xl text-center transition-all shadow-[0_10px_25px_rgba(20,184,166,0.3)] hover:scale-[1.02] active:scale-[0.98]"
              >
                {loggedIn ? 'Mulai Analisis Baru →' : 'Mulai Analisis Sekarang →'}
              </Link>
              {loggedIn ? (
                <Link 
                  href="/history" 
                  className="bg-white/5 hover:bg-white/10 border border-white/15 text-white font-semibold text-sm tracking-wide px-6 py-4 rounded-xl text-center transition-all hover:bg-white/15"
                >
                  Riwayat Analisis
                </Link>
              ) : (
                <a 
                  href="#gwas" 
                  className="bg-white/5 hover:bg-white/10 border border-white/15 text-white font-semibold text-sm tracking-wide px-6 py-4 rounded-xl text-center transition-all hover:bg-white/15"
                >
                  Pelajari GWAS
                </a>
              )}
            </div>
          </div>

        </div>
      </section>

      {/* ================= ANALISIS TERBARU (hanya saat login) ================= */}
      {loggedIn && (
        <section id="riwayat" className="relative z-10 py-16 px-6 lg:px-16 border-t border-white/10 bg-[#0a2140]">
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-extrabold text-white tracking-tight">Analisis Terbaru Anda</h2>
                <p className="text-slate-400 text-sm">Lanjutkan pekerjaan sebelumnya atau unduh berkas hasilnya.</p>
              </div>
              <Link href="/history" className="text-xs font-bold uppercase tracking-wider text-teal-400 hover:text-teal-300 transition-colors">
                Lihat semua riwayat →
              </Link>
            </div>

            {recent.length === 0 ? (
              <div className="p-8 text-center bg-white/[0.03] border border-white/10 rounded-2xl text-sm text-slate-400">
                Belum ada analisis. <Link href="/pipeline/step-1" className="text-teal-400 hover:underline font-semibold">Mulai analisis pertama Anda</Link>.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {recent.map((r) => (
                  <Link
                    key={r.id}
                    href="/history"
                    className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-teal-500/40 rounded-2xl p-5 space-y-2 transition-all hover:-translate-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-slate-400">#{r.id}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/10 text-teal-300">{statusLabel(r.status)}</span>
                    </div>
                    <p className="text-sm font-bold text-white">{r.trait || 'Analisis GWAS'}</p>
                    <p className="text-[11px] text-slate-400">
                      {r.model ? `${r.model} · ` : ''}
                      {r.createdAt && !isNaN(new Date(r.createdAt).getTime()) ? new Date(r.createdAt).toLocaleDateString('id-ID', { dateStyle: 'medium' }) : ''}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================= SECTION 2: TENTANG GWAS (MUNCUL HALUS SAAT DI-SCROLL) ================= */}
      <section 
        id="gwas" 
        ref={gwasRef} 
        className="relative z-10 py-24 px-6 lg:px-16 border-t border-white/10 bg-[#081b33]"
      >
        <div 
          className={`max-w-5xl mx-auto transition-all duration-1000 ease-out transform ${
            gwasVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
        >
          <div className="text-center max-w-2xl mx-auto mb-16 space-y-3">
            <h2 className="text-3xl font-extrabold text-white tracking-tight">Tentang GWAS</h2>
            <p className="text-slate-400 text-sm">Metodologi mutakhir dalam menghubungkan variasi genetik dengan karakteristik fenotipik.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white/[0.03] border border-white/10 backdrop-blur-md p-8 rounded-2xl space-y-3 transition-all duration-500 hover:-translate-y-2 hover:bg-white/[0.06] hover:border-teal-500/30">
              <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold text-lg mb-4">01</div>
              <h3 className="text-lg font-bold text-white">Analisis SNP Komprehensif</h3>
              <p className="text-xs text-slate-400 leading-relaxed">Mendeteksi polimorfisme nukleotida tunggal di seluruh sekuens genomik dengan akurasi tinggi.</p>
            </div>

            <div className="bg-white/[0.03] border border-white/10 backdrop-blur-md p-8 rounded-2xl space-y-3 transition-all duration-500 hover:-translate-y-2 hover:bg-white/[0.06] hover:border-blue-500/30">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-lg mb-4">02</div>
              <h3 className="text-lg font-bold text-white">Pipeline Terstruktur</h3>
              <p className="text-xs text-slate-400 leading-relaxed">Alur kerja sistematis mulai dari kontrol kualitas data hingga visualisasi plot statistik akhir.</p>
            </div>

            <div className="bg-white/[0.03] border border-white/10 backdrop-blur-md p-8 rounded-2xl space-y-3 transition-all duration-500 hover:-translate-y-2 hover:bg-white/[0.06] hover:border-indigo-500/30">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-lg mb-4">03</div>
              <h3 className="text-lg font-bold text-white">Visualisasi Interaktif</h3>
              <p className="text-xs text-slate-400 leading-relaxed">Menyediakan grafik Manhattan dan QQ-plot yang dinamis untuk interpretasi data yang mendalam.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= SECTION 3: TIM PENYUSUN (MUNCUL HALUS SAAT DI-SCROLL) ================= */}
      <section 
        id="team" 
        ref={teamRef} 
        className="relative z-10 py-24 px-6 lg:px-16 bg-[#0B2545]"
      >
        <div 
          className={`max-w-6xl mx-auto transition-all duration-1000 ease-out transform ${
            teamVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
        >
          <div className="text-center mb-16 space-y-3">
            <span className="text-teal-400 text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 inline-block">
              Program Studi Bioinformatika • IPB University
            </span>
            <h2 className="text-3xl font-extrabold text-white tracking-tight pt-2">Tim Penyusun</h2>
            <p className="text-slate-400 text-sm max-w-xl mx-auto">
              Dikembangkan oleh mahasiswa Program Studi Bioinformatika, Fakultas Matematika dan Ilmu Pengetahuan Alam, IPB University.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-8">
            {TEAM_MEMBERS.map((member, index) => (
              <div 
                key={member.id} 
                onClick={() => setSelectedMember(member)}
                className="group cursor-pointer w-48 bg-white/[0.02] hover:bg-white/[0.06] border border-white/10 backdrop-blur-md rounded-3xl p-5 transition-all duration-500 hover:-translate-y-3 hover:shadow-2xl hover:border-teal-500/40 flex flex-col items-center text-center shadow-lg"
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                <div className="w-32 h-32 rounded-full overflow-hidden mb-4 border-2 border-teal-500/40 group-hover:border-teal-400 shadow-md bg-slate-800">
                  <img 
                    src={member.img} 
                    alt={member.name} 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?background=1e293b&color=94a3b8&name=' + member.name.replace(' ', '+') }}
                  />
                </div>
                <h3 className="font-bold text-white text-sm mb-1 group-hover:text-teal-400 transition-colors leading-snug">
                  {member.name}
                </h3>
                <p className="text-[11px] font-semibold text-teal-400 mb-1">
                  {member.role}
                </p>
                <p className="text-[10px] text-slate-400 font-mono">
                  {member.nim}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="relative z-10 py-10 px-6 border-t border-white/10 text-center text-xs text-slate-500 bg-slate-950/60">
        <p>© 2026 GenoSphere-GWAS Platform • Program Studi Bioinformatika IPB University</p>
      </footer>

      {/* ================= MODAL DETAIL TIM ================= */}
      {selectedMember && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-md transition-all duration-300 animate-fadeIn"
          onClick={() => setSelectedMember(null)}
        >
          <div 
            className="bg-slate-900 border border-white/15 backdrop-blur-2xl rounded-3xl p-8 max-w-sm w-full shadow-2xl relative transform transition-all duration-300 scale-100"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setSelectedMember(null)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 text-slate-300 rounded-full transition"
            >
              ✕
            </button>

            <div className="flex flex-col items-center text-center mt-2">
              <div className="w-28 h-28 rounded-full overflow-hidden mb-4 border-2 border-teal-400 shadow-lg bg-slate-800">
                <img 
                  src={selectedMember.img} 
                  alt={selectedMember.name} 
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?background=1e293b&color=94a3b8&name=' + selectedMember.name.replace(' ', '+') }}
                />
              </div>
              <h3 className="text-xl font-bold text-white mb-1 leading-tight">{selectedMember.name}</h3>
              <p className="text-xs font-semibold text-teal-400 mb-1">
                {selectedMember.role}
              </p>
              <p className="text-[11px] text-slate-400 font-mono mb-4 bg-white/5 px-3 py-1 rounded-full border border-white/10">
                NIM: {selectedMember.nim} • Bioinformatika IPB
              </p>
              <p className="text-xs text-slate-300 leading-relaxed font-medium bg-white/5 p-4 rounded-2xl border border-white/10">
                {selectedMember.desc}
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}