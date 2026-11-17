'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePipelineStore } from '@/store/usePipelineStore';
import { useAuthProfile } from '@/lib/auth';
import { API_BASE, apiGet, authHeaders, getAnalysisId, getDatasetId, fetchTraitsFull, readError, CovariateCandidate } from '@/lib/api';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function Step3PCADanKovariat() {
  const { userProfile, pcaConfig, setPcaConfig, phenotypeColumns } = usePipelineStore();
  useAuthProfile();

  const [jumlahPC, setJumlahPC] = useState(
    pcaConfig?.numPCs ? `${pcaConfig.numPCs} PC` : '5 PC'
  );

  // Kandidat kovariat dari backend (GET /datasets/{id}/traits -> covariate_candidates)
  const [covariateCandidates, setCovariateCandidates] = useState<CovariateCandidate[]>(
    (phenotypeColumns || []).map((c) => ({ name: c, kind: 'numeric', levels: [] }))
  );
  const [selectedCovs, setSelectedCovs] = useState<string[]>(pcaConfig?.covariates || []);

  // Trait yang sedang dianalisis tidak boleh menjadi kovariatnya sendiri
  const [analysisTrait, setAnalysisTrait] = useState<string | null>(null);
  // Jumlah sampel setelah QC (untuk saran jumlah PC)
  const [nSamples, setNSamples] = useState<number | null>(null);

  useEffect(() => {
    const datasetId = getDatasetId();
    const analysisId = getAnalysisId();
    if (datasetId) {
      fetchTraitsFull(datasetId)
        .then(({ covariateCandidates: cc }) => setCovariateCandidates(cc))
        .catch((e: any) => console.warn('Gagal memuat kandidat kovariat:', e));
    }
    if (analysisId) {
      apiGet(`/api/gwas/analyses/${analysisId}`)
        .then((d: any) => setAnalysisTrait(d?.config?.trait_name ?? d?.trait_name ?? null))
        .catch(() => {});
      apiGet(`/api/gwas/analyses/${analysisId}/qc-summary`)
        .then((d: any) => {
          const n = d?.samples_after ?? d?.samples_before;
          if (typeof n === 'number' && n > 0) setNSamples(n);
        })
        .catch(() => {});
    }
  }, []);

  const visibleCandidates = covariateCandidates.filter((c) => c.name !== analysisTrait);
  useEffect(() => {
    // buang kovariat yang tidak valid (bukan kandidat / sama dengan trait analisis)
    setSelectedCovs((prev) => prev.filter((c) => visibleCandidates.some((x) => x.name === c)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covariateCandidates, analysisTrait]);

  // ---- Saran jumlah PC ----
  const PC_OPTIONS = [5, 10, 20];
  // (a) sebelum PCA dijalankan: berdasarkan jumlah sampel setelah QC
  const pcSuggestionBySample = (() => {
    if (nSamples === null) return null;
    const maxPc = Math.max(2, nSamples - 1);
    const ideal = nSamples < 500 ? 5 : nSamples < 5000 ? 10 : 20;
    const pick = PC_OPTIONS.filter((o) => o <= maxPc).includes(ideal)
      ? ideal
      : Math.max(...PC_OPTIONS.filter((o) => o <= maxPc), PC_OPTIONS[0]);
    const why =
      nSamples < 500
        ? 'sampel relatif sedikit, PC berlebih hanya menambah noise'
        : nSamples < 5000
        ? 'ukuran sampel sedang, struktur populasi halus masih terdeteksi'
        : 'sampel besar, struktur populasi yang lebih halus bisa ditangkap';
    return { pick, why };
  })();

  const [isLoadingPca, setIsLoadingPca] = useState(false);
  const [isPcaDone, setIsPcaDone] = useState(false);
  const [pcaError, setPcaError] = useState<string | null>(null);
  const [pcaProgress, setPcaProgress] = useState('');
  const [pcaData, setPcaData] = useState<{
    components: string[];
    eigenvalues: number[];
    points: Array<{ sample_id: string; trait: string | null; pcs: number[] }>;
    varianceExplained: number[];
    warnings: string[];
  } | null>(null);

  const toggleCov = (c: string) =>
    setSelectedCovs((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  // Jalankan PCA di backend lalu ambil koordinat asli untuk scatter plot
  const runPca = async () => {
    const num = parseInt(jumlahPC) || 5;
    const analysisId = getAnalysisId();
    setPcaError(null);
    setPcaProgress('');
    setIsPcaDone(false);
    setPcaData(null);

    if (!analysisId) {
      setPcaError('Analisis belum dibuat. Jalankan Quality Control di Step 2 terlebih dahulu.');
      return;
    }

    setIsLoadingPca(true);
    try {
      if (setPcaConfig) setPcaConfig({ numPCs: num.toString(), covariates: selectedCovs });

      const postRes = await fetch(`${API_BASE}/api/gwas/analyses/${analysisId}/pca`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ pca_components: num, use_pca: true }),
      });
      if (!postRes.ok) throw new Error(await readError(postRes, 'Gagal menjalankan PCA'));

      // 1. PCA berjalan di latar belakang. Tunggu sampai status analisis tidak lagi
      //    queued/running. Endpoint kovariat (mode staged) menjawab 409 WRONG_STAGE selama
      //    PCA masih berjalan, dan GET /pca bisa saja mengembalikan hasil dari proses lama.
      const busy = ['queued', 'running', 'pending', 'processing'];
      let finished = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        await sleep(attempt === 0 ? 800 : 1500);
        const stRes = await fetch(`${API_BASE}/api/gwas/analyses/${analysisId}/status`, {
          headers: authHeaders(),
        });
        if (!stRes.ok) throw new Error(await readError(stRes, 'Gagal mengecek status PCA'));
        const st: any = await stRes.json();
        const s = String(st.status ?? '').toLowerCase();
        if (typeof st.message === 'string') setPcaProgress(st.message);
        if (['failed', 'error'].includes(s)) {
          throw new Error(st.error_message || st.message || 'PCA gagal dijalankan di server.');
        }
        if (!busy.includes(s)) {
          finished = true;
          break;
        }
      }
      if (!finished) throw new Error('PCA belum selesai setelah 3 menit. Coba lagi beberapa saat.');

      // 2. Ambil koordinat PCA untuk scatter plot
      let d: any = null;
      let lastError = 'Backend belum mengembalikan koordinat PCA.';
      for (let attempt = 0; attempt < 5; attempt++) {
        const getRes = await fetch(`${API_BASE}/api/gwas/analyses/${analysisId}/pca`, {
          headers: authHeaders(),
        });
        if (getRes.ok) {
          const body = await getRes.json();
          if (body.status === 'unavailable') {
            throw new Error((body.warnings && body.warnings[0]) || 'PCA tidak tersedia untuk dataset ini.');
          }
          if (Array.isArray(body.points) && body.points.length > 0) {
            d = body;
            break;
          }
        } else {
          lastError = await readError(getRes, 'Gagal mengambil koordinat PCA');
          if ([400, 401, 403, 404, 422].includes(getRes.status)) throw new Error(lastError);
        }
        await sleep(1000);
      }
      if (!d) throw new Error(lastError);
      setPcaData({
        components: d.components ?? [],
        eigenvalues: d.eigenvalues ?? [],
        points: d.points,
        varianceExplained: d.variance_explained ?? [],
        warnings: d.warnings ?? [],
      });

      // 3. Kovariat dari data fenotipe ditetapkan lewat endpoint terpisah (mode staged).
      //    Coba ulang bila masih WRONG_STAGE (status belum sempat berganti).
      setPcaProgress('Menetapkan kovariat...');
      let covError: string | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const covRes = await fetch(`${API_BASE}/api/gwas/analyses/${analysisId}/covariates`, {
          method: 'PUT',
          headers: authHeaders(true),
          body: JSON.stringify({ covariates: selectedCovs }),
        });
        if (covRes.ok) {
          covError = null;
          break;
        }
        covError = await readError(covRes, 'Gagal menetapkan kovariat');
        if (covRes.status !== 409) break;
        await sleep(1500);
      }
      if (covError) setPcaError(`PCA selesai, tetapi kovariat gagal ditetapkan: ${covError}`);
      setIsPcaDone(true);
    } catch (err: any) {
      console.error(err);
      setPcaError(err.message || 'Terjadi kesalahan saat menghubungkan ke server backend.');
    } finally {
      setIsLoadingPca(false);
      setPcaProgress('');
    }
  };

  // (b) setelah PCA: titik "siku" scree plot = penurunan eigenvalue terbesar antar PC berurutan
  const pcSuggestionByElbow = (() => {
    const ev = pcaData?.eigenvalues || [];
    if (ev.length < 3) return null;
    let bestIdx = 1;
    let bestRatio = 0;
    for (let i = 1; i < ev.length - 1; i++) {
      const ratio = ev[i + 1] > 0 ? ev[i] / ev[i + 1] : Infinity;
      if (ratio > bestRatio) { bestRatio = ratio; bestIdx = i; }
    }
    const elbow = bestIdx + 1; // jumlah PC sebelum penurunan tajam
    const option = PC_OPTIONS.find((o) => o >= elbow) ?? PC_OPTIONS[PC_OPTIONS.length - 1];
    return { elbow, option, ratio: bestRatio };
  })();

  // Turunan untuk scatter plot (PC1 vs PC2).
  // Trait kategori (mis. SEX 0/1/2) -> warna per kategori. Trait kuantitatif (nilai kontinu,
  // mis. berat badan) -> gradien warna, bukan satu warna per nilai unik.
  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b'];
  const plotPoints = (pcaData?.points || []).filter((p) => p.pcs && p.pcs.length >= 2);
  const xs = plotPoints.map((p) => p.pcs[0]);
  const ys = plotPoints.map((p) => p.pcs[1]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const scale = (v: number, lo: number, hi: number) => (hi === lo ? 50 : 4 + ((v - lo) / (hi - lo)) * 92);

  const traitNum = (t: string | null): number => (t === null || t === '' ? NaN : Number(t));
  const labeled = plotPoints.filter((p) => p.trait !== null && p.trait !== '');
  const uniqueTraits = Array.from(new Set<string>(labeled.map((p) => p.trait as string)));
  const numericTrait = labeled.length > 0 && labeled.every((p) => Number.isFinite(traitNum(p.trait)));
  const isContinuous = numericTrait && uniqueTraits.length > 8;
  const numVals = labeled.map((p) => traitNum(p.trait)).filter(Number.isFinite);
  const tMin = numVals.length ? numVals.reduce((a, b) => Math.min(a, b), Infinity) : 0;
  const tMax = numVals.length ? numVals.reduce((a, b) => Math.max(a, b), -Infinity) : 1;

  const fmtTrait = (t: string | null): string => {
    if (t === null || t === '') return 'Tanpa label';
    const n = Number(t);
    if (!Number.isFinite(n)) return t;
    return Number.isInteger(n) ? String(n) : String(+n.toFixed(3));
  };

  // Kategori diurutkan (numerik bila bisa), label dirapikan ("1.0" -> "1")
  const groups: string[] = isContinuous
    ? []
    : [
        ...uniqueTraits.sort((a, b) => (numericTrait ? Number(a) - Number(b) : a.localeCompare(b))),
        ...(labeled.length < plotPoints.length ? ['__none__'] : []),
      ];
  const groupLabel = (g: string) => (g === '__none__' ? 'Tanpa label' : fmtTrait(g));

  // Gradien biru -> kuning -> merah
  const stops = [[59, 130, 246], [253, 224, 71], [239, 68, 68]];
  const gradientColor = (v: number): string => {
    const t = tMax === tMin ? 0.5 : Math.min(1, Math.max(0, (v - tMin) / (tMax - tMin)));
    const seg = t < 0.5 ? 0 : 1;
    const f = (t - seg * 0.5) / 0.5;
    const [c0, c1] = [stops[seg], stops[seg + 1]];
    return `rgb(${c0.map((c, i) => Math.round(c + (c1[i] - c) * f)).join(',')})`;
  };
  const pointColor = (t: string | null): string => {
    if (t === null || t === '') return '#94a3b8';
    if (isContinuous) return gradientColor(Number(t));
    return palette[groups.indexOf(t) % palette.length];
  };
  const totalEig = (pcaData?.eigenvalues || []).reduce((a, b) => a + b, 0);
  const varExp = (i: number) => {
    const ve = pcaData?.varianceExplained || [];
    if (ve.length > i) {
      const asFraction = Math.max(...ve) <= 1;
      return ` (${(asFraction ? ve[i] * 100 : ve[i]).toFixed(1)}%)`;
    }
    return totalEig > 0 && pcaData?.eigenvalues?.[i] !== undefined
      ? ` (${((pcaData.eigenvalues[i] / totalEig) * 100).toFixed(1)}%)`
      : '';
  };

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

  // Struktur 5 Langkah Pipeline Sesuai Dokumen
  const steps = [
    { id: 1, name: 'Input & Validasi Data', href: '/pipeline/step-1', completed: true, active: false },
    { id: 2, name: 'Quality Control (QC)', href: '/pipeline/step-2', completed: true, active: false },
    { id: 3, name: 'PCA & Kovariat', href: '/pipeline/step-3', completed: isPcaDone, active: true },
    { id: 4, name: 'Analisis GWAS & Post-Processing', href: '/pipeline/step-4', completed: false, active: false },
    { id: 5, name: 'Hasil, Visualisasi & Ekspor', href: '/pipeline/step-5', completed: false, active: false },
  ];

  return (
    <div suppressHydrationWarning className="relative min-h-screen w-full bg-slate-50 text-slate-800 flex flex-col justify-between overflow-x-hidden font-sans">
      
      {/* Background Video DNA */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-50 mix-blend-luminosity">
          <source src="/dna-bg-video.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px]"></div>
      </div>

      {/* TOP NAVBAR */}
      <header className="relative z-10 w-full h-16 border-b border-white/60 bg-white/70 backdrop-blur-md px-6 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-white/80 rounded-lg shadow-sm border border-slate-100">
              <img src="/GenoSphere Logo.png" alt="GenoSphere Logo" className="h-6 w-auto object-contain" />
            </div>
            <span className="font-bold text-base tracking-wide bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent">
              GenoSphere-GWAS
            </span>
          </div>
          <div className="text-xs text-slate-500 border-l border-slate-300 pl-6 flex items-center gap-2">
            <span>Analysis Pipeline</span>
            <span>/</span>
            <span className="text-slate-800 font-semibold">Step 3: PCA & Kovariat</span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs text-slate-600">
          <Link href="/profile" className="flex items-center gap-2.5 hover:opacity-80 transition cursor-pointer group">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-md">
              {getUserInitial()}
            </div>
            <span className="text-slate-700 group-hover:text-blue-600 transition font-semibold">
              {getUserName()}
            </span>
          </Link>
        </div>
      </header>

      {/* MAIN CONTENT WRAPPER */}
      <div className="relative z-10 flex-1 flex w-full">
        {/* SIDEBAR */}
        <aside className="w-64 border-r border-white/60 bg-white/40 backdrop-blur-md p-4 flex flex-col gap-2 shrink-0 shadow-sm">
          {steps.map((step) => (
            <Link
              key={step.id}
              href={step.href}
              className={`flex items-center gap-3.5 px-4 py-3 rounded-2xl text-xs transition-all duration-300 hover:translate-x-1 ${
                step.active 
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold shadow-lg shadow-blue-600/30' 
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 font-medium'
              }`}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                step.completed ? 'bg-emerald-500 text-white shadow-sm' : step.active ? 'bg-white text-blue-600 shadow-md' : 'bg-slate-200 text-slate-600'
              }`}>
                {step.completed ? '✓' : step.id}
              </span>
              <span className="leading-tight">{step.name}</span>
            </Link>
          ))}
        </aside>

        {/* MAIN CONTAINER DENGAN ANIMASI FADE-IN */}
        <main className="flex-1 p-8 overflow-y-auto max-w-5xl space-y-8 animate-fadeIn transition-all duration-500 ease-out">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-1">PCA dan Kovariat</h1>
            <p className="text-sm text-slate-600 font-medium">Analisis struktur populasi dari genotipe hasil QC untuk mendeteksi stratifikasi dan penentuan variabel kovariat.</p>
          </div>

          {pcaError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-xs flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-2"><span>⚠️</span><span>{pcaError}</span></div>
              <button onClick={() => setPcaError(null)} className="text-rose-500 font-bold hover:text-rose-800 text-sm">✕</button>
            </div>
          )}

          {/* Pengaturan Kovariat */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6 card-glass transition-all duration-300">
            <div className="flex items-center justify-between border-b border-white/60 pb-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">1. Pengaturan Konfigurasi PCA & Kovariat</h2>
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">Koreksi Populasi</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">JUMLAH PRINCIPAL COMPONENTS (PC)</label>
                <select value={jumlahPC} onChange={(e) => setJumlahPC(e.target.value)} className="w-full bg-white/90 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition">
                  <option value="5 PC">5 PC (Standard Population Correction){pcSuggestionBySample?.pick === 5 ? ' — disarankan' : ''}</option>
                  <option value="10 PC">10 PC (Fine Structure Correction){pcSuggestionBySample?.pick === 10 ? ' — disarankan' : ''}</option>
                  <option value="20 PC">20 PC (Deep Structure Analysis){pcSuggestionBySample?.pick === 20 ? ' — disarankan' : ''}</option>
                </select>

                {pcSuggestionBySample && (
                  <div className="mt-2 flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-900">
                    <span>💡</span>
                    <span className="flex-1">
                      <strong>Saran: {pcSuggestionBySample.pick} PC</strong> untuk {nSamples?.toLocaleString()} sampel ({pcSuggestionBySample.why}).
                      {parseInt(jumlahPC) !== pcSuggestionBySample.pick && (
                        <button type="button" onClick={() => setJumlahPC(`${pcSuggestionBySample.pick} PC`)} className="ml-2 underline font-semibold hover:text-blue-700">Gunakan</button>
                      )}
                    </span>
                  </div>
                )}
                {pcSuggestionByElbow && (
                  <div className="mt-2 flex items-start gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-900">
                    <span>📉</span>
                    <span className="flex-1">
                      Dari hasil PCA ini, eigenvalue turun tajam setelah <strong>PC{pcSuggestionByElbow.elbow}</strong>, sehingga {pcSuggestionByElbow.option} PC sudah cukup menangkap struktur populasi.
                      {parseInt(jumlahPC) !== pcSuggestionByElbow.option && (
                        <button type="button" onClick={() => setJumlahPC(`${pcSuggestionByElbow.option} PC`)} className="ml-2 underline font-semibold hover:text-emerald-700">Gunakan</button>
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">KOVARIAT TAMBAHAN (DARI KOLOM FENOTIPE)</label>
                {visibleCandidates.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {visibleCandidates.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => toggleCov(c.name)}
                        title={c.kind === 'categorical' && c.levels.length ? `Kategori: ${c.levels.join(', ')}` : c.kind}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${selectedCovs.includes(c.name) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white/90 text-slate-700 border-slate-200 hover:border-blue-400'}`}
                      >
                        {selectedCovs.includes(c.name) ? '✓ ' : ''}{c.name}
                        <span className="opacity-60 font-normal"> · {c.kind === 'categorical' ? 'kategori' : 'numerik'}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Tidak ada kolom yang cocok sebagai kovariat di berkas fenotipe Anda.</p>
                )}
                {analysisTrait && (
                  <p className="text-[10px] text-slate-400 mt-2">Kolom trait yang dianalisis ({analysisTrait}) tidak ditampilkan karena tidak boleh menjadi kovariat.</p>
                )}
                <p className="text-[10px] text-slate-500 mt-2">
                  {selectedCovs.length > 0 ? `Terpilih: ${selectedCovs.join(', ')}` : 'Tanpa kovariat tambahan'}
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={runPca}
                disabled={isLoadingPca}
                className="rounded-xl font-semibold px-6 py-3 text-xs shadow-md bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 text-white hover:opacity-95 disabled:opacity-60 transition"
              >
                {isLoadingPca ? 'Menghitung PCA...' : 'Jalankan PCA'}
              </button>
            </div>
          </div>

          {/* Grafik Scatter Plot PCA */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6 card-glass transition-all duration-300">
            <div className="flex items-center justify-between border-b border-white/60 pb-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">2. Visualisasi Grafik Scatter Plot PCA (PC1 vs PC2)</h2>
              <span className="text-xs text-slate-500 font-medium">
                {isLoadingPca ? 'Menghitung komponen PCA...' : pcaData ? `${plotPoints.length} sampel` : 'Belum dijalankan'}
              </span>
            </div>

            {pcaData && plotPoints.length > 0 ? (
              <div className="relative border border-slate-200/80 rounded-2xl p-6 bg-white/50 h-80 flex flex-col justify-between shadow-inner">
                <div className="absolute top-4 right-4 bg-white/90 border border-slate-200 rounded-xl p-3 shadow-sm text-[11px] space-y-1.5 z-10 max-h-40 overflow-y-auto">
                  {isContinuous ? (
                    <div className="w-32">
                      <div className="text-slate-700 font-semibold mb-1">Nilai trait</div>
                      <div className="h-2 rounded-full" style={{ background: 'linear-gradient(to right, rgb(59,130,246), rgb(253,224,71), rgb(239,68,68))' }} />
                      <div className="flex justify-between text-[10px] text-slate-600 mt-1 font-mono">
                        <span>{fmtTrait(String(tMin))}</span>
                        <span>{fmtTrait(String(tMax))}</span>
                      </div>
                    </div>
                  ) : (
                    groups.map((g) => (
                      <div key={g} className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: g === '__none__' ? '#94a3b8' : palette[groups.indexOf(g) % palette.length] }}></span>
                        <span className="text-slate-700 font-medium">{groupLabel(g)}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="relative w-full h-full border-l border-b border-slate-300 my-2">
                  {plotPoints.map((pt, i) => (
                    <div
                      key={`pt-${i}`}
                      title={`${pt.sample_id}${pt.trait ? ` | ${fmtTrait(pt.trait)}` : ''}`}
                      className="absolute w-2.5 h-2.5 rounded-full shadow-sm opacity-80 transition-all duration-500"
                      style={{
                        left: `${scale(pt.pcs[0], xMin, xMax)}%`,
                        top: `${100 - scale(pt.pcs[1], yMin, yMax)}%`,
                        backgroundColor: pointColor(pt.trait),
                      }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>{pcaData.components[0] ?? 'PC1'}{varExp(0)} →</span>
                  <span>↑ {pcaData.components[1] ?? 'PC2'}{varExp(1)}</span>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 rounded-2xl h-40 flex items-center justify-center text-xs text-slate-500 bg-white/40">
                {isLoadingPca ? (pcaProgress || 'Menghitung PCA di server...') : 'Klik "Jalankan PCA" untuk menampilkan scatter plot dari data Anda.'}
              </div>
            )}

            {pcaData && pcaData.warnings.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                {pcaData.warnings.map((w, i) => (<p key={i}>{w}</p>))}
              </div>
            )}

            {isPcaDone && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900">
                <strong className="block font-bold">✓ PCA selesai dihitung</strong>
                {pcaData && pcaData.eigenvalues.length > 0 && (
                  <p className="text-[11px] mt-1 font-mono">
                    Eigenvalue: {pcaData.eigenvalues.slice(0, 5).map((v) => +v.toFixed(3)).join(', ')}{pcaData.eigenvalues.length > 5 ? ', ...' : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* FOOTER NAVIGATION */}
      <footer className="relative z-10 w-full h-16 border-t border-white/60 bg-white/70 backdrop-blur-md px-6 flex items-center justify-between shadow-sm">
        <Link href="/pipeline/step-2" className="px-5 py-2.5 bg-white/85 hover:bg-white text-slate-700 text-xs font-semibold rounded-xl transition-all border border-white shadow-sm flex items-center gap-2 hover:scale-[1.01]">
          <span>←</span> Kembali ke Quality Control (QC)
        </Link>
        <Link href="/pipeline/step-4" className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-emerald-600 hover:opacity-95 text-white text-xs font-bold rounded-xl transition-all shadow-md hover:scale-[1.01] active:scale-[0.98] shadow-blue-600/20">
          Lanjut ke Step 4 (Analisis GWAS & Post-Processing) →
        </Link>
      </footer>
    </div>
  );
}