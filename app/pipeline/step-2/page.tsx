'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePipelineStore } from '@/store/usePipelineStore';
import { useAuthProfile } from '@/lib/auth';
import { API_BASE, authHeaders, fetchTraits, readError } from '@/lib/api';

// Batas minimum data yang tersisa agar PCA & GWAS masih bermakna.
// Di bawah batas ini proses diblokir (error merah).
const MIN_SAMPLES_AFTER_QC = 30;
const MIN_VARIANTS_AFTER_QC = 100;
// Penyusutan lebih dari separuh data memunculkan peringatan kuning.
const EXTREME_SHRINK_RATIO = 0.5;

export default function Step2KonfigurasiKonfirmasiQC() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { 
    userProfile, 
    qualityControl, 
    setQualityControl, 
    selectedModel, 
    setSelectedModel,
    genotypeFile,
    phenotypeFile,
    phenotypeColumns
  } = usePipelineStore();
  useAuthProfile();

  // State Parameter QC sesuai Dokumen Spasi (Bagian 3)
  const [minorAllele, setMinorAllele] = useState<string>(
    qualityControl?.mafThreshold ? `MAF >= ${qualityControl.mafThreshold}` : 'MAF >= 0.05'
  );
  const [missingnessRate, setMissingnessRate] = useState<string>('Call Rate >= 95% (0.05)');
  const [hweThreshold, setHweThreshold] = useState<string>('p-value >= 1e-6');
  const [relatednessFilter, setRelatednessFilter] = useState<string>('KING Cutoff 0.0884 (2nd Degree)');

  // Fallback untuk Backend Compatibility (tidak ditayangkan di UI)
  const defaultPhenoCol = phenotypeColumns && phenotypeColumns.length > 0 
    ? phenotypeColumns.find(col => !['sample_id', 'id', 'fid', 'iid'].includes(col.toLowerCase())) || phenotypeColumns[0]
    : '';

  const [isExecutingQc, setIsExecutingQc] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [isQcDone, setIsQcDone] = useState<boolean>(false);
  const [qcResults, setQcResults] = useState<{
    skipped: boolean;
    variantsBefore: number;
    variantsAfter: number;
    variantsRemoved: number;
    samplesBefore: number;
    samplesAfter: number;
    removedByFilter: Record<string, number>;
  } | null>(null);

  // Evaluasi penyusutan data setelah QC
  const qcShrink = (() => {
    if (!qcResults || qcResults.skipped) return null;
    const vShrink = qcResults.variantsBefore > 0 ? qcResults.variantsRemoved / qcResults.variantsBefore : 0;
    const sShrink =
      qcResults.samplesBefore > 0 ? (qcResults.samplesBefore - qcResults.samplesAfter) / qcResults.samplesBefore : 0;
    const topFilters = Object.entries(qcResults.removedByFilter)
      .filter(([, n]) => Number(n) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 3)
      .map(([f, n]) => `${f} (${Number(n).toLocaleString()} SNP)`);
    const tooFewSamples = qcResults.samplesAfter < MIN_SAMPLES_AFTER_QC;
    const tooFewVariants = qcResults.variantsAfter < MIN_VARIANTS_AFTER_QC;
    return {
      vShrink,
      sShrink,
      topFilters,
      extremeVariants: vShrink > EXTREME_SHRINK_RATIO,
      extremeSamples: sShrink > EXTREME_SHRINK_RATIO,
      blocked: tooFewSamples || tooFewVariants,
      tooFewSamples,
      tooFewVariants,
    };
  })();

  // Ambil ringkasan QC asli dari backend
  const loadQcSummary = async (analysisId: string | number) => {
    const r = await fetch(`${API_BASE}/api/gwas/analyses/${analysisId}/qc-summary`, { headers: authHeaders() });
    if (!r.ok) throw new Error(await readError(r, 'Gagal memuat ringkasan QC'));
    const d = await r.json();
    setQcResults({
      skipped: !!d.skipped,
      variantsBefore: d.variants_before ?? 0,
      variantsAfter: d.variants_after ?? 0,
      variantsRemoved: d.variants_removed ?? 0,
      samplesBefore: d.samples_before ?? 0,
      samplesAfter: d.samples_after ?? 0,
      removedByFilter: d.removed_by_filter ?? {},
    });
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

  const handleRunQcWithProgress = async () => {
    const mafVal = parseFloat(minorAllele.replace(/[^0-9.]/g, '')) || 0.05;
    const callRateVal = (parseFloat(missingnessRate.match(/(\d+(?:\.\d+)?)\s*%/)?.[1] ?? '') / 100) || 0.95;
    const hweVal = parseFloat(hweThreshold.split('>= ')[1]) || 0.000001;

    if (setQualityControl) {
      setQualityControl({ mafThreshold: mafVal });
    }

    setErrorMessage(null);
    setIsExecutingQc(true);
    setProgress(15);
    setIsQcDone(false);

    try {
      const token = 
        localStorage.getItem('token') || 
        localStorage.getItem('access_token') || 
        localStorage.getItem('access-token') || '';

      const rawDatasetId = localStorage.getItem('dataset_id');
      if (!rawDatasetId || rawDatasetId === 'undefined' || rawDatasetId === 'null') {
        throw new Error('Dataset belum diunggah. Kembali ke Step 1 dan unggah serta validasi berkas terlebih dahulu.');
      }
      const datasetId = parseInt(rawDatasetId, 10);

      // Payload QC dikirim ke backend (nilai trait dikirim default di background agar backend tidak 422)
      const payloadData = {
        dataset_id: datasetId,
        trait_name: defaultPhenoCol as string,
        trait_type: 'binary' as string,
        tujuan_analisis: 'Analisis Asosiasi Genomik',
        model_gwas: 'Logistic Regression' as string,
        maf_threshold: mafVal,
        struktur_populasi: 'Sertakan Hasil PCA (5 PC)',
        execution_mode: "staged",
        qc: {
          skip_qc: false,
          maf: mafVal,
          call_rate: callRateVal,
          hwe_p: hweVal,
          check_relatedness: !relatednessFilter.includes('Nonaktif')
        }
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const postAnalysis = (body: typeof payloadData) =>
        fetch(`${API_BASE}/api/gwas/analyses`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
        });

      // Jalur utama: POST /api/v1/qc (hanya butuh dataset_id, skip_qc, maf, call_rate, hwe_p; tanpa trait)
      let response: Response | null = null;
      try {
        const qcRes = await fetch(`${API_BASE}/api/v1/qc`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            dataset_id: datasetId,
            skip_qc: false,
            maf: mafVal,
            call_rate: callRateVal,
            hwe_p: hweVal,
          }),
        });
        if (qcRes.ok) {
          const raw = await qcRes.text();
          let parsed: any = raw;
          try { parsed = JSON.parse(raw); } catch {}
          const id =
            parsed && typeof parsed === 'object'
              ? parsed.analysis_id ?? parsed.id
              : /^\d+$/.test(String(parsed).trim()) ? String(parsed).trim() : null;
          console.log('[QC] respons /api/v1/qc:', parsed);
          if (id !== null && id !== undefined) {
            response = new Response(
              JSON.stringify({ analysis_id: id, status: (parsed && parsed.status) || 'queued' }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
      } catch (e) {
        console.warn('[QC] /api/v1/qc gagal, pakai jalur /api/gwas/analyses', e);
      }

      // Cadangan: jalur lama (analisis lengkap). Tipe trait & model diambil dari backend, bukan ditebak.
      if (!response) {
        const traits = await fetchTraits(datasetId);
        const t = traits.find((x) => x.name === defaultPhenoCol) || traits[0];
        if (!t) throw new Error('Backend tidak mengembalikan trait dari berkas fenotipe.');
        payloadData.trait_name = t.name;
        payloadData.trait_type = t.type;
        payloadData.model_gwas = t.recommendedModel;
        response = await postAnalysis(payloadData);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        let errorMsg = `Gagal memulai eksekusi QC. Status: ${response.status}`;
        
        if (errorData.errors && Array.isArray(errorData.errors)) {
          errorMsg = errorData.errors.map((e: any) => `${e.field}: ${e.message}`).join(' | ');
        } else if (errorData.detail) {
          errorMsg = typeof errorData.detail === 'object' ? JSON.stringify(errorData.detail) : errorData.detail;
        } else if (errorData.message) {
          errorMsg = errorData.message;
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();

      if (data.analysis_id) {
        localStorage.setItem('analysis_id', data.analysis_id.toString());
      }

      if ((data.status === "queued" || data.status === "running" || data.status === "pending" || data.status === "awaiting") && data.analysis_id) {
        let isCompleted = false;
        
        while (!isCompleted) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const statusRes = await fetch(`${API_BASE}/api/gwas/analyses/${data.analysis_id}/status`, {
            method: 'GET',
            headers: headers,
          });

          if (!statusRes.ok) {
             throw new Error(`Gagal mengecek status QC. Status: ${statusRes.status}`);
          }

          const statusData = await statusRes.json();
          
          if (statusData.progress !== undefined) {
             setProgress(statusData.progress);
          } else {
             setProgress((prev) => (prev < 90 ? prev + 5 : prev));
          }
          
          if (
            statusData.status === "completed" || 
            statusData.status === "success" || 
            statusData.status === "done" || 
            statusData.status === "awaiting"
          ) {
            isCompleted = true;
            setProgress(100);
            setIsQcDone(true);
            
            await loadQcSummary(data.analysis_id);
            setIsExecutingQc(false);
          } else if (statusData.status === "failed" || statusData.status === "error") {
            isCompleted = true;
            throw new Error(statusData.error_message || "Proses QC gagal di server.");
          }
        }
      } else {
        setProgress(100);
        setIsQcDone(true);
        await loadQcSummary(data.analysis_id ?? localStorage.getItem('analysis_id') ?? '');
        setIsExecutingQc(false);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Terjadi kesalahan saat menghubungkan ke server backend.');
      setIsExecutingQc(false);
      setProgress(0);
    }
  };

  const steps = [
    { id: 1, name: 'Input & Validasi Data', href: '/pipeline/step-1', completed: true, active: false },
    { id: 2, name: 'Quality Control (QC)', href: '/pipeline/step-2', completed: isQcDone, active: true },
    { id: 3, name: 'PCA & Kovariat', href: '/pipeline/step-3', completed: false, active: false },
    { id: 4, name: 'Analisis GWAS & Post-Processing', href: '/pipeline/step-4', completed: false, active: false },
    { id: 5, name: 'Hasil, Visualisasi & Ekspor', href: '/pipeline/step-5', completed: false, active: false },
  ];

  return (
    <div suppressHydrationWarning className="relative min-h-screen w-full bg-slate-50 text-slate-800 flex flex-col justify-between overflow-x-hidden font-sans">
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-50 mix-blend-luminosity">
          <source src="/dna-bg-video.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px]"></div>
      </div>

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
            <span className="text-slate-800 font-semibold">Step 2: Quality Control (QC)</span>
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
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${step.completed ? 'bg-emerald-500 text-white shadow-sm' : step.active ? 'bg-white text-blue-600 shadow-md' : 'bg-slate-200 text-slate-600'}`}>
                {step.completed ? '✓' : step.id}
              </span>
              <span className="leading-tight">{step.name}</span>
            </Link>
          ))}
        </aside>

        {/* MAIN CONTENT */}
        <main className="flex-1 p-8 overflow-y-auto max-w-5xl space-y-8 transition-all duration-500 ease-out animate-fadeIn">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-1">Quality Control (QC) & Filter Genetik</h1>
            <p className="text-sm text-slate-600 font-medium">Atur parameter filter genetik (Missingness, HWE, MAF, Relatedness) untuk membuang SNP dan sampel berkualitas rendah.</p>
          </div>

          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-xs flex items-center justify-between shadow-sm transition-all duration-300 animate-fadeIn">
              <div className="flex items-center gap-2"><span>⚠️</span><span className="font-semibold">{errorMessage}</span></div>
              <button onClick={() => setErrorMessage(null)} className="text-rose-500 font-bold hover:text-rose-800 text-sm">✕</button>
            </div>
          )}

          {/* KARTU 1: PARAMETER METODE QC */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6 card-glass transition-all duration-300">
            <div className="flex items-center justify-between border-b border-white/60 pb-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">1. Parameter Metode Quality Control (PLINK)</h2>
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">PLINK Filter Options</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* MAF Filter */}
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">MINOR ALLELE FREQUENCY (MAF)</label>
                <select value={minorAllele} onChange={(e) => setMinorAllele(e.target.value)} className="w-full bg-white/90 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition">
                  <option value="MAF >= 0.05">MAF &gt;= 0.05 (Standard Common Variants)</option>
                  <option value="MAF >= 0.01">MAF &gt;= 0.01 (Rare Variants Included)</option>
                  <option value="MAF >= 0.10">MAF &gt;= 0.10 (High Frequency Only)</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">Output: File statistik frekuensi alel (.afreq)</span>
              </div>

              {/* Missingness Filter */}
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">MISSINGNESS RATE (CALL RATE)</label>
                <select value={missingnessRate} onChange={(e) => setMissingnessRate(e.target.value)} className="w-full bg-white/90 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition">
                  <option value="Call Rate >= 95% (0.05)">Call Rate &gt;= 95% (Maks 5% Missing)</option>
                  <option value="Call Rate >= 98% (0.02)">Call Rate &gt;= 98% (Maks 2% Missing)</option>
                  <option value="Call Rate >= 90% (0.10)">Call Rate &gt;= 90% (Maks 10% Missing)</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">Output: Statistik missingness (.imiss, .lmiss)</span>
              </div>

              {/* HWE Filter */}
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">HARDY-WEINBERG EQUILIBRIUM (HWE)</label>
                <select value={hweThreshold} onChange={(e) => setHweThreshold(e.target.value)} className="w-full bg-white/90 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition">
                  <option value="p-value >= 1e-6">p-value &gt;= 1e-6 (Standard Filter)</option>
                  <option value="p-value >= 1e-5">p-value &gt;= 1e-5 (Ketik)</option>
                  <option value="p-value >= 1e-4">p-value &gt;= 1e-4 (Longgar)</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">Output: Statistik p-value HWE (.hwe)</span>
              </div>

              {/* Relatedness Filter */}
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">RELATEDNESS (HUBUNGAN KEKEWABATAN)</label>
                <select value={relatednessFilter} onChange={(e) => setRelatednessFilter(e.target.value)} className="w-full bg-white/90 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition">
                  <option value="KING Cutoff 0.0884 (2nd Degree)">KING Cutoff 0.0884 (Filter Kerabat Derajat 2)</option>
                  <option value="KING Cutoff 0.177 (1st Degree)">KING Cutoff 0.177 (Filter Kerabat Derajat 1)</option>
                  <option value="Nonaktifkan Filter Relatedness">Nonaktifkan Filter Relatedness</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">Output: Estimasi kekerabatan (.king)</span>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Ringkasan Berkas Terunggah</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-3.5 bg-white/50 rounded-xl border border-white flex justify-between items-center">
                  <span className="text-slate-600">Genotipe Input:</span>
                  <strong className="text-slate-900 font-mono">{genotypeFile ? genotypeFile.name : 'berkas_genotipe.bed'}</strong>
                </div>
                <div className="p-3.5 bg-white/50 rounded-xl border border-white flex justify-between items-center">
                  <span className="text-slate-600">Fenotipe Input:</span>
                  <strong className="text-slate-900 font-mono">{phenotypeFile ? phenotypeFile.name : 'berkas_fenotipe.csv'}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* KARTU 2: EKSEKUSI QC & LAPORAN HASIL */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6 card-glass transition-all duration-300">
            <div className="flex items-center justify-between border-b border-white/60 pb-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">2. Eksekusi Filtering Quality Control</h2>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${isQcDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                {isQcDone ? 'QC Selesai ✓' : 'Siap Dijalankan'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-600">Klik tombol di samping untuk menjalankan penyaringan kualitas berdasarkan kriteria di atas.</p>
              <button
                type="button"
                disabled={isExecutingQc}
                onClick={handleRunQcWithProgress}
                className="bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 hover:opacity-90 text-white text-xs font-bold px-6 py-3 rounded-xl shadow-md transition-all duration-300 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50"
              >
                {isExecutingQc ? 'Memproses Filter QC...' : 'Jalankan Quality Control'}
              </button>
            </div>

            {(isExecutingQc || isQcDone) && (
              <div className="space-y-3 pt-2 animate-fadeIn">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Status Progress QC</span>
                  <span className={isQcDone ? 'text-emerald-600' : 'text-blue-600'}>{progress}% {isQcDone ? 'Selesai (Awaiting Step 3)' : 'Berjalan...'}</span>
                </div>
                <div className="w-full bg-white/80 h-3 rounded-full overflow-hidden border border-white shadow-inner">
                  <div className="bg-gradient-to-r from-blue-600 to-emerald-500 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                </div>
              </div>
            )}

            {qcResults && isQcDone && (
              <div className="space-y-4 pt-4 border-t border-white/60 animate-fadeIn">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Ringkasan Laporan Hasil QC</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-4 bg-white/60 rounded-xl border border-white shadow-sm space-y-1">
                    <span className="text-slate-500 font-medium block">SNP Lolos Filter QC</span>
                    <strong className="text-emerald-700 text-base font-bold">{qcResults.variantsAfter.toLocaleString()} SNP</strong>
                    <span className="text-[10px] text-slate-500 block">dari {qcResults.variantsBefore.toLocaleString()} SNP awal</span>
                  </div>
                  <div className="p-4 bg-white/60 rounded-xl border border-white shadow-sm space-y-1">
                    <span className="text-slate-500 font-medium block">SNP Terfilter (Dibuang)</span>
                    <strong className="text-rose-600 text-base font-bold">{qcResults.variantsRemoved.toLocaleString()} SNP</strong>
                  </div>
                  <div className="p-4 bg-white/60 rounded-xl border border-white shadow-sm space-y-1">
                    <span className="text-slate-500 font-medium block">Sampel Valid Terjaga</span>
                    <strong className="text-blue-700 text-base font-bold">{qcResults.samplesAfter.toLocaleString()} Sampel</strong>
                    <span className="text-[10px] text-slate-500 block">dari {qcResults.samplesBefore.toLocaleString()} sampel awal</span>
                  </div>
                </div>

                {qcShrink?.blocked && (
                  <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl text-xs text-rose-900 space-y-1">
                    <strong className="block font-bold">⛔ Data tersisa terlalu sedikit untuk dianalisis</strong>
                    <span className="block">
                      Setelah QC tersisa {qcResults.samplesAfter.toLocaleString()} sampel dan {qcResults.variantsAfter.toLocaleString()} SNP
                      (minimum {MIN_SAMPLES_AFTER_QC} sampel dan {MIN_VARIANTS_AFTER_QC} SNP untuk PCA & GWAS).
                      {qcShrink.tooFewSamples ? ' Jumlah sampel kurang.' : ''}{qcShrink.tooFewVariants ? ' Jumlah SNP kurang.' : ''}
                    </span>
                    <span className="block">Longgarkan ambang MAF, missing rate, HWE, atau KING cutoff lalu jalankan QC ulang. Langkah berikutnya dinonaktifkan.</span>
                  </div>
                )}

                {qcShrink && !qcShrink.blocked && (qcShrink.extremeVariants || qcShrink.extremeSamples) && (
                  <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl text-xs text-amber-900 space-y-1">
                    <strong className="block font-bold">⚠️ Penyusutan data ekstrem</strong>
                    <span className="block">
                      {qcShrink.extremeVariants ? `${(qcShrink.vShrink * 100).toFixed(1)}% SNP terbuang. ` : ''}
                      {qcShrink.extremeSamples ? `${(qcShrink.sShrink * 100).toFixed(1)}% sampel terbuang. ` : ''}
                      Kombinasi filter MAF, missing rate, HWE, atau KING cutoff memotong lebih dari separuh data.
                    </span>
                    {qcShrink.topFilters.length > 0 && (
                      <span className="block">Penyumbang terbesar: {qcShrink.topFilters.join(', ')}.</span>
                    )}
                    <span className="block">Pertimbangkan melonggarkan ambang agar hasil analisis tetap representatif.</span>
                  </div>
                )}

                {qcResults.skipped ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900">
                    <strong className="block font-bold">QC dilewati oleh backend</strong>
                    <span>Tidak ada filter yang diterapkan pada dataset ini.</span>
                  </div>
                ) : (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 space-y-2">
                    <strong className="block font-bold">{qcShrink?.blocked ? '⛔ Dataset hasil QC belum dapat dipakai' : '✓ Dataset Genotipe Hasil QC Siap'}</strong>
                    {Object.keys(qcResults.removedByFilter).length > 0 && (
                      <ul className="text-[11px] space-y-0.5">
                        {Object.entries(qcResults.removedByFilter).map(([filter, count]) => (
                          <li key={filter}>
                            <span className="font-mono">{filter}</span>: {Number(count).toLocaleString()} SNP dibuang
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="relative z-10 w-full h-16 border-t border-white/60 bg-white/70 backdrop-blur-md px-6 flex items-center justify-between shadow-sm">
        <Link href="/pipeline/step-1" className="px-5 py-2.5 bg-white/85 hover:bg-white text-slate-700 text-xs font-semibold rounded-xl transition-all border border-white shadow-sm flex items-center gap-2 hover:scale-[1.01]">
          <span>←</span> Kembali ke Step 1
        </Link>
        <Link
          href="/pipeline/step-3"
          className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md hover:scale-[1.01] active:scale-[0.98] ${isQcDone && !qcShrink?.blocked ? 'bg-gradient-to-r from-blue-600 to-emerald-600 hover:opacity-95 text-white shadow-blue-600/25' : 'bg-slate-200 text-slate-400 pointer-events-none cursor-not-allowed'}`}
        >
          Lanjut ke Step 3 (PCA & Kovariat) →
        </Link>
      </footer>
    </div>
  );
}