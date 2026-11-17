'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePipelineStore } from '@/store/usePipelineStore';
import { useAuthProfile } from '@/lib/auth';
import { API_BASE, apiGet, authHeaders, getAnalysisId, getDatasetId, fetchTraits, readError, TraitInfo } from '@/lib/api';

export default function Step4AnalisisGwasDanPostProcessing() {
  const { 
    userProfile,
    selectedModel, 
    setSelectedModel, 
    pcaConfig,
    phenotypeColumns,
    executionProgress, 
    logs, 
    updateExecution 
  } = usePipelineStore();
  useAuthProfile();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Trait & model diambil dari backend berdasarkan berkas fenotipe yang diunggah
  const [traits, setTraits] = useState<TraitInfo[]>([]);
  const [traitsLoading, setTraitsLoading] = useState(true);
  const [selectedPhenotypeCol, setSelectedPhenotypeCol] = useState('');
  const [modelGwasState, setModelGwasState] = useState(selectedModel || '');
  const idCols = ['sample_id', 'id', 'fid', 'iid'];

  const currentTrait = traits.find((t) => t.name === selectedPhenotypeCol);
  const tipeTrait = currentTrait
    ? currentTrait.type === 'binary' ? 'Biner (Case / Control)' : 'Kuantitatif (Kontinu)'
    : '-';
  const modelOptions = currentTrait?.models ?? [];

  useEffect(() => {
    const datasetId = getDatasetId();
    if (!datasetId) {
      setErrorMessage('Dataset belum diunggah. Kembali ke Step 1.');
      setTraitsLoading(false);
      return;
    }
    fetchTraits(datasetId)
      .then((list) => {
        const usable = list.filter((t) => !idCols.includes(t.name.toLowerCase()));
        setTraits(usable);
        if (usable.length > 0) {
          setSelectedPhenotypeCol(usable[0].name);
          setModelGwasState(usable[0].recommendedModel);
        }
      })
      .catch((e: any) => setErrorMessage(e.message || 'Gagal memuat daftar trait dari backend.'))
      .finally(() => setTraitsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTraitChange = (name: string) => {
    setSelectedPhenotypeCol(name);
    const t = traits.find((x) => x.name === name);
    if (t) setModelGwasState(t.recommendedModel);
  };

  // Form Konfigurasi Post-Processing (Bagian 6 Dokumen)
  const [metodeKoreksi, setMetodeKoreksi] = useState('genome_wide');
  const [thresholdPValue, setThresholdPValue] = useState('5e-8');
  
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPostProcessingDone, setIsPostProcessingDone] = useState(false);
  const [significantSnpsCount, setSignificantSnpsCount] = useState<number | null>(null);

  useEffect(() => {
    if (setSelectedModel && modelGwasState) {
      setSelectedModel(modelGwasState);
    }
  }, [modelGwasState, setSelectedModel]);

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

  // Memanggil API Backend untuk mengeksekusi analisis GWAS & Post-processing
  const handleRunGwasAndPostProcessing = async () => {
    setErrorMessage(null);
    setIsPostProcessingDone(false);
    setSignificantSnpsCount(null);

    const analysisId = getAnalysisId();
    if (!analysisId) {
      setErrorMessage('Analisis belum dibuat. Jalankan Quality Control di Step 2 terlebih dahulu.');
      return;
    }
    if (!currentTrait || !modelGwasState) {
      setErrorMessage('Pilih trait dan model statistik terlebih dahulu.');
      return;
    }
    if ((pcaConfig?.covariates || []).includes(currentTrait.name)) {
      setErrorMessage(`Trait "${currentTrait.name}" juga dipilih sebagai kovariat di Step 3. Trait tidak boleh menjadi kovariatnya sendiri; ubah kovariat di Step 3 atau pilih trait lain.`);
      return;
    }

    setIsExecuting(true);
    updateExecution(10, `[LOG] Mengirim konfigurasi: trait ${currentTrait.name}, model ${modelGwasState}`);

    try {
      const nPcs = pcaConfig?.numPCs ? parseInt(pcaConfig.numPCs, 10) : 5;
      const thr = parseFloat(thresholdPValue) || 5e-8;

      // 1. Trait pada analisis ini sudah ditetapkan saat QC. Bila berbeda dengan pilihan Anda,
      //    jalankan lewat endpoint yang menerima trait baru (/api/v1/analysis/run).
      let analysisTrait: string | undefined;
      try {
        const detail: any = await apiGet(`/api/gwas/analyses/${analysisId}`);
        analysisTrait = detail?.config?.trait_name ?? detail?.trait_name;
      } catch (e) {
        console.warn('Gagal membaca konfigurasi analisis:', e);
      }

      let response: Response;
      if (analysisTrait === currentTrait.name) {
        response = await fetch(`${API_BASE}/api/gwas/analyses/${analysisId}/run`, {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ model: modelGwasState, significance_method: metodeKoreksi }),
        });
      } else {
        response = await fetch(`${API_BASE}/api/v1/analysis/run`, {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            analysis_id: Number(analysisId),
            trait_name: currentTrait.name,
            trait_type: currentTrait.type,
            model: modelGwasState,
            use_pca: true,
            pca_components: nPcs,
            covariates: pcaConfig?.covariates || [],
            significance_threshold: thr,
          }),
        });
      }
      if (!response.ok) throw new Error(await readError(response, 'Gagal mengeksekusi GWAS di server'));

      let data: any = await response.json().catch(() => ({}));
      updateExecution(30, `[LOG] ${data?.message || 'Analisis diterima server, menunggu proses selesai...'}`);

      // 2. Pantau progres sampai selesai
      const running = ['queued', 'running', 'pending', 'processing'];
      let status = String(data?.status ?? 'queued').toLowerCase();
      while (running.includes(status)) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await fetch(`${API_BASE}/api/gwas/analyses/${analysisId}/status`, { headers: authHeaders() });
        if (!st.ok) throw new Error(await readError(st, 'Gagal mengecek status analisis'));
        data = await st.json();
        status = String(data.status ?? '').toLowerCase();
        if (typeof data.percent === 'number') updateExecution(Math.min(95, Math.max(30, data.percent)));
      }
      if (['failed', 'error'].includes(status)) {
        throw new Error(data.error_message || data.message || 'Analisis GWAS gagal di server.');
      }
      if (!['done', 'completed', 'success'].includes(status)) {
        throw new Error(data.message || `Analisis belum selesai (status: ${status}).`);
      }

      // 3. Terapkan ambang signifikansi (post-processing)
      updateExecution(97, '[LOG] Menerapkan ambang signifikansi...');
      const pp = await fetch(`${API_BASE}/api/gwas/analyses/${analysisId}/postprocess`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ method: metodeKoreksi, threshold: thr }),
      });
      if (!pp.ok) throw new Error(await readError(pp, 'Gagal menerapkan ambang signifikansi'));
      const ppData = await pp.json();
      const sig = ppData?.significance;
      setSignificantSnpsCount(typeof sig?.n_significant === 'number' ? sig.n_significant : null);

      updateExecution(100, `[LOG] ${ppData?.message || 'Analisis GWAS & post-processing selesai.'}`);
      if (sig?.explanation) updateExecution(100, `[LOG] ${sig.explanation}`);
      if (sig?.ignored_threshold) updateExecution(100, '[LOG] Catatan: nilai ambang yang Anda pilih diabaikan oleh metode ini.');
      setIsPostProcessingDone(true);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Terjadi kesalahan saat menghubungkan ke server backend.');
      updateExecution(0, `[ERROR] ${err.message || 'Eksekusi gagal'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const steps = [
    { id: 1, name: 'Input & Validasi Data', href: '/pipeline/step-1', completed: true, active: false },
    { id: 2, name: 'Quality Control (QC)', href: '/pipeline/step-2', completed: true, active: false },
    { id: 3, name: 'PCA & Kovariat', href: '/pipeline/step-3', completed: true, active: false },
    { id: 4, name: 'Analisis GWAS & Post-Processing', href: '/pipeline/step-4', completed: isPostProcessingDone, active: true },
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
            <span className="text-slate-800 font-semibold">Step 4: Analisis GWAS & Post-Processing</span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs text-slate-600">
          <Link href="/profile" className="flex items-center gap-2.5 hover:opacity-80 transition cursor-pointer group">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-md">
              {getUserInitial()}
            </div>
            <span className="text-slate-700 group-hover:text-blue-600 transition font-semibold">{getUserName()}</span>
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
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-1">Analisis GWAS & Post-Processing</h1>
            <p className="text-sm text-slate-600 font-medium">Tetapkan model asosiasi fenotipe-genotipe, tentukan threshold koreksi signifikansi, dan jalankan pipeline eksekusi.</p>
          </div>

          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-xs flex items-center justify-between shadow-sm transition-all duration-300 animate-fadeIn">
              <div className="flex items-center gap-2"><span>⚠️</span><span className="font-semibold">{errorMessage}</span></div>
              <button onClick={() => setErrorMessage(null)} className="text-rose-500 font-bold hover:text-rose-800 text-sm">✕</button>
            </div>
          )}

          {/* KARTU 1: KONFIGURASI ANALISIS GWAS (BAGIAN 5 DOKUMEN) */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6 card-glass transition-all duration-300">
            <div className="flex items-center justify-between border-b border-white/60 pb-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">1. Konfigurasi Analisis GWAS</h2>
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">Model & Trait</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Kolom Fenotipe */}
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-blue-600 uppercase mb-1.5">KOLOM FENOTIPE (TRAIT ANALISIS)</label>
                <select 
                  value={selectedPhenotypeCol} 
                  onChange={(e) => handleTraitChange(e.target.value)} 
                  disabled={traitsLoading || traits.length === 0}
                  className="w-full bg-blue-50/70 border border-blue-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 font-semibold focus:outline-none focus:border-blue-500 transition disabled:opacity-60"
                >
                  {traitsLoading && <option value="">Memuat trait dari server...</option>}
                  {!traitsLoading && traits.length === 0 && <option value="">Tidak ada trait terdeteksi</option>}
                  {traits.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} ({t.type === 'binary' ? 'biner' : 'kuantitatif'})
                    </option>
                  ))}
                </select>
                {currentTrait?.summary && (
                  <p className="text-[10px] text-slate-500 mt-1.5">{currentTrait.summary}</p>
                )}
                {currentTrait && (currentTrait.nMissing ?? 0) > 0 && (
                  <div className="mt-2 flex items-start gap-2 p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-[11px] text-sky-900">
                    <span>ℹ️</span>
                    <span>
                      Pada trait <strong>{currentTrait.name}</strong>, <strong>{(currentTrait.nMissing ?? 0).toLocaleString()}</strong> dari{' '}
                      {((currentTrait.nMissing ?? 0) + (currentTrait.nValid ?? 0)).toLocaleString()} sampel bernilai kosong (NA) dan
                      otomatis dikeluarkan di tahap ini. Sampel yang dianalisis: <strong>{(currentTrait.nValid ?? 0).toLocaleString()}</strong>.
                    </span>
                  </div>
                )}
                {currentTrait && (currentTrait.nMissing ?? 0) === 0 && (
                  <p className="text-[10px] text-emerald-600 mt-1.5">Tidak ada nilai kosong (NA) pada trait ini.</p>
                )}
              </div>

              {/* Tipe Trait */}
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">TIPE TRAIT</label>
                <input
                  type="text"
                  readOnly
                  value={`${tipeTrait} (terdeteksi otomatis)`}
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-600 focus:outline-none cursor-not-allowed"
                />
              </div>

              {/* Model GWAS */}
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">MODEL STATISTIK GWAS</label>
                <select value={modelGwasState} onChange={(e) => setModelGwasState(e.target.value)} disabled={modelOptions.length === 0} className="w-full bg-white/90 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition disabled:opacity-60">
                  {modelOptions.length === 0 && <option value="">-</option>}
                  {modelOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}{m.value === currentTrait?.recommendedModel ? ' (disarankan)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Kovariat yang Digunakan */}
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">KOVARIAT TERPASANG (DARI STEP 3)</label>
                <input 
                  type="text" 
                  readOnly 
                  value={`${pcaConfig?.numPCs || 5} PC${pcaConfig?.covariates && pcaConfig.covariates.length > 0 ? ' + ' + pcaConfig.covariates.join(', ') : ''}`} 
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-600 font-mono focus:outline-none cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          {/* KARTU 2: KONFIGURASI POST-PROCESSING (BAGIAN 6 DOKUMEN) */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6 card-glass transition-all duration-300">
            <div className="flex items-center justify-between border-b border-white/60 pb-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">2. Konfigurasi Post-Processing & Threshold Signifikansi</h2>
              <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">Significance Filter</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">METODE KOREKSI SIGNIFIKANSI</label>
                <select value={metodeKoreksi} onChange={(e) => setMetodeKoreksi(e.target.value)} className="w-full bg-white/90 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition">
                  <option value="genome_wide">Genome-wide (ambang tetap 5e-8)</option>
                  <option value="bonferroni">Bonferroni Correction (Ketat & Konservatif)</option>
                  <option value="fdr">FDR / Benjamini-Hochberg (Sensitivitas Tinggi)</option>
                  <option value="suggestive">Suggestive Threshold (Eksploratif)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">NILAI THRESHOLD P-VALUE</label>
                <select value={thresholdPValue} onChange={(e) => setThresholdPValue(e.target.value)} className="w-full bg-white/90 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition">
                  <option value="5e-8">5e-8 (Genome-wide Significance Standard)</option>
                  <option value="1e-5">1e-5 (Suggestive Threshold)</option>
                  <option value="0.05">0.05 (FDR / Standard Alpha)</option>
                </select>
              </div>
            </div>
          </div>

          {/* KARTU 3: EKSEKUSI PIPELINE & LOG TERMINAL */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6 card-glass transition-all duration-300">
            <div className="flex items-center justify-between border-b border-white/60 pb-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">3. Eksekusi Model GWAS & Post-Processing</h2>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${isPostProcessingDone ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {isPostProcessingDone ? 'Selesai ✓' : 'Siap Dijalankan'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-600">Klik tombol di samping untuk mengeksekusi model asosiasi GWAS dan memicu pembuatan file hasil serta daftar varian signifikan.</p>
              <button
                type="button"
                disabled={isExecuting}
                onClick={handleRunGwasAndPostProcessing}
                className="bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 hover:opacity-90 text-white text-xs font-bold px-6 py-3 rounded-xl shadow-md transition-all duration-300 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50"
              >
                {isExecuting ? 'Mengeksekusi GWAS...' : 'Jalankan Analisis GWAS & Post-Processing'}
              </button>
            </div>

            {(isExecuting || executionProgress > 0) && (
              <div className="space-y-2 pt-2 animate-fadeIn">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Status Eksekusi Pipeline</span>
                  <span className={isPostProcessingDone ? 'text-emerald-600' : 'text-blue-600'}>{executionProgress}% {isPostProcessingDone ? 'Selesai' : 'Berjalan...'}</span>
                </div>
                <div className="w-full bg-white/80 h-3 rounded-full overflow-hidden border border-white shadow-inner">
                  <div className="bg-gradient-to-r from-blue-600 to-emerald-500 h-full transition-all duration-500 rounded-full" style={{ width: `${executionProgress}%` }}></div>
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2">
              <span className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Terminal Output (Live Execution Log Stream)</span>
              <div className="bg-slate-950 rounded-2xl p-4 font-mono text-[11px] text-slate-300 h-44 overflow-y-auto space-y-1.5 border border-slate-800 shadow-inner">
                {logs.length > 0 ? (
                  logs.map((log, idx) => (
                    <p key={idx} className="text-emerald-400/90 leading-relaxed">{log}</p>
                  ))
                ) : (
                  <p className="text-slate-500 italic">Tekan tombol di atas untuk memulai eksekusi model statistik dan melihat stream log server...</p>
                )}
              </div>
            </div>

            {isPostProcessingDone && (
              <div className="space-y-4 pt-4 border-t border-white/60 animate-fadeIn">
                <div className="p-4 bg-white/60 border border-white rounded-2xl flex items-center justify-between shadow-sm">
                  <div>
                    <span className="text-xs font-bold text-slate-500 uppercase block">Total Varian Signifikan Teridentifikasi</span>
                    <strong className="text-2xl font-extrabold text-blue-600 tracking-tight">{significantSnpsCount === null ? '-' : `${significantSnpsCount} SNP`}</strong>
                  </div>
                  <span className="text-xs text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full font-bold border border-emerald-200">Signifikan Teridentifikasi ✓</span>
                </div>

                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 space-y-2">
                  <strong className="block font-bold">✓ Berkas Luaran Hasil Asosiasi & Post-Processing Siap</strong>
                  <p className="text-[11px]">
                    Berkas yang telah dihasilkan backend: <code className="font-mono bg-white/60 px-1.5 py-0.5 rounded border border-emerald-200">.glm.logistic</code> / <code className="font-mono bg-white/60 px-1.5 py-0.5 rounded border border-emerald-200">.assoc.txt</code> (hasil asosiasi), <code className="font-mono bg-white/60 px-1.5 py-0.5 rounded border border-emerald-200">processed_association_results.csv</code> (hasil distandardisasi), <code className="font-mono bg-white/60 px-1.5 py-0.5 rounded border border-emerald-200">significant_variants.csv</code> (daftar SNP signifikan), dan <code className="font-mono bg-white/60 px-1.5 py-0.5 rounded border border-emerald-200">metadata_analisis.json</code>.
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* FOOTER NAVIGATION */}
      <footer className="relative z-10 w-full h-16 border-t border-white/60 bg-white/70 backdrop-blur-md px-6 flex items-center justify-between shadow-sm">
        <Link href="/pipeline/step-3" className="px-5 py-2.5 bg-white/85 hover:bg-white text-slate-700 text-xs font-semibold rounded-xl transition-all border border-white shadow-sm flex items-center gap-2 hover:scale-[1.01]">
          <span>←</span> Kembali ke PCA & Kovariat
        </Link>
        <Link
          href="/pipeline/step-5"
          className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md hover:scale-[1.01] active:scale-[0.98] ${
            isPostProcessingDone
              ? 'bg-gradient-to-r from-blue-600 to-emerald-600 hover:opacity-95 text-white shadow-blue-600/25'
              : 'bg-slate-200 text-slate-400 pointer-events-none cursor-not-allowed'
          }`}
        >
          Lanjut ke Step 5 (Hasil, Visualisasi & Ekspor) →
        </Link>
      </footer>
    </div>
  );
}