'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { usePipelineStore } from '@/store/usePipelineStore';
import { useAuthProfile } from '@/lib/auth';
import { API_BASE, authHeaders, fetchTraitsFull, readError, redirectToLogin } from '@/lib/api';
import { MAX_DATASET_BYTES, MAX_FILE_BYTES, FileCheck, checkGenotypeFile, checkPhenotypeFile, fmtBytes, sizeError, totalSizeError } from '@/lib/fileChecks';

export default function Step1UnggahDanValidasiData() {
  // Tambahkan setPhenotypeFile dan setPhenotypeColumns dari usePipelineStore
  const { userProfile, setGenotypeFile, setPhenotypeFile, setPhenotypeColumns, genotypeFile, phenotypeFile } = usePipelineStore();
  useAuthProfile();

  // Genotipe: PLINK = 3 berkas (.bed + .bim + .fam), VCF = 1 berkas (.vcf / .vcf.gz)
  const [genotypeFilesLocal, setGenotypeFilesLocal] = useState<File[]>(genotypeFile ? [genotypeFile] : []);
  const [phenotypeFileLocal, setPhenotypeFileLocal] = useState<File | null>(phenotypeFile);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const uploadCache = useRef<{ sig: string; datasetId: number } | null>(null);
  // Hasil pemeriksaan format/header per berkas (kunci: "geno:<nama>" atau "pheno")
  const [fileIssues, setFileIssues] = useState<Record<string, FileCheck>>({});
  const setIssue = (key: string, v: FileCheck | null) =>
    setFileIssues((prev) => {
      const next = { ...prev };
      if (v) next[key] = v; else delete next[key];
      return next;
    });
  const hasBlockingIssues = Object.values(fileIssues).some((i) => i.errors.length > 0);

  // Menampilkan notifikasi merah (error) dan kuning (peringatan) untuk satu berkas
  const renderIssues = (key: string) => {
    const it = fileIssues[key];
    if (!it || (it.errors.length === 0 && it.warnings.length === 0)) return null;
    return (
      <div className="mt-1.5 space-y-1 text-left">
        {it.errors.map((m, i) => (
          <div key={`e${i}`} className="flex gap-1.5 p-2 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700 font-medium">
            <span>⛔</span><span>{m}</span>
          </div>
        ))}
        {it.warnings.map((m, i) => (
          <div key={`w${i}`} className="flex gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 font-medium">
            <span>⚠️</span><span>{m}</span>
          </div>
        ))}
      </div>
    );
  };

  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [validationData, setValidationData] = useState<{
    genotypeInfo: { name: string; size: string; samplesCount: number; snpCount: number; format: string };
    phenotypeInfo: { name: string; size: string; traitsCount: number };
    matchedSamples: number;
    missingRate: string;
    warnings: Array<{ code?: string; message: string; hint?: string }>;
    errors: Array<{ code?: string; message: string; hint?: string }>;
    isValid: boolean;
    message: string;
  } | null>(null);

  const allowedPhenotypeExts = ['.csv', '.tsv', '.txt', '.pheno'];

  // ---- Aturan berkas genotipe ----
  const genoExt = (name: string): string | null => {
    const n = name.toLowerCase();
    if (n.endsWith('.vcf.gz')) return '.vcf.gz';
    for (const e of ['.vcf', '.bed', '.bim', '.fam']) if (n.endsWith(e)) return e;
    return null;
  };
  const isVcfName = (name: string) => ['.vcf', '.vcf.gz'].includes(genoExt(name) || '');

  const genoState = (() => {
    const exts = genotypeFilesLocal.map((f) => genoExt(f.name));
    const hasVcf = genotypeFilesLocal.some((f) => isVcfName(f.name));
    const kind: 'empty' | 'vcf' | 'plink' = genotypeFilesLocal.length === 0 ? 'empty' : hasVcf ? 'vcf' : 'plink';
    const missing = kind === 'plink' ? ['.bed', '.bim', '.fam'].filter((e) => !exts.includes(e)) : [];
    const complete = kind === 'vcf' || (kind === 'plink' && missing.length === 0);
    const stems = Array.from(new Set(genotypeFilesLocal.map((f) => f.name.replace(/\.(vcf\.gz|vcf|bed|bim|fam)$/i, ''))));
    const stemMismatch = kind === 'plink' && stems.length > 1;
    return { kind, missing, complete, stemMismatch };
  })();

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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const isValidExtension = (fileName: string, allowedExts: string[]) => {
    const lowerName = fileName.toLowerCase();
    return allowedExts.some((ext) => lowerName.endsWith(ext));
  };

  const handleGenotypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    setValidationData(null);
    const picked = Array.from(e.target.files || []);
    e.target.value = ''; // izinkan memilih berkas yang sama lagi
    if (picked.length === 0) return;

    let next = [...genotypeFilesLocal];
    const accepted: File[] = [];
    const errs: string[] = [];
    for (const f of picked) {
      const ext = genoExt(f.name);
      const tooBig = sizeError(f);
      if (tooBig) {
        errs.push(tooBig);
        continue;
      }
      if (!ext) {
        errs.push(`"${f.name}" bukan berkas genotipe (.bed/.bim/.fam atau .vcf/.vcf.gz).`);
        continue;
      }
      const vcf = isVcfName(f.name);
      const haveVcf = next.some((x) => isVcfName(x.name));
      const havePlink = next.some((x) => !isVcfName(x.name));
      if ((vcf && havePlink) || (!vcf && haveVcf)) {
        errs.push('Jangan mencampurkan VCF dan PLINK. Hapus berkas yang lama dulu.');
        continue;
      }
      if (vcf) next.forEach((x) => setIssue(`geno:${x.name}`, null));
      else next.filter((x) => genoExt(x.name) === ext).forEach((x) => setIssue(`geno:${x.name}`, null));
      next = vcf ? [f] : [...next.filter((x) => genoExt(x.name) !== ext), f];
      accepted.push(f);
    }
    const totalErr = totalSizeError([...next, ...(phenotypeFileLocal ? [phenotypeFileLocal] : [])]);
    if (totalErr) {
      setErrorMessage(totalErr);
      return;
    }
    accepted.forEach((f) => {
      checkGenotypeFile(f).then((r) => setIssue(`geno:${f.name}`, r));
    });
    setGenotypeFilesLocal(next);
    setGenotypeFile((next[0] ?? null) as any);
    if (errs.length) setErrorMessage(Array.from(new Set(errs)).join(' '));
  };

  const handlePhenotypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    setValidationData(null);
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const tooBig = sizeError(file);
      if (tooBig) {
        setErrorMessage(tooBig);
        e.target.value = '';
        return;
      }
      const totalErr = totalSizeError([...genotypeFilesLocal, file]);
      if (totalErr) {
        setErrorMessage(totalErr);
        e.target.value = '';
        return;
      }
      if (!isValidExtension(file.name, allowedPhenotypeExts)) {
        setErrorMessage(`Format file fenotipe "${file.name}" tidak sesuai! Gunakan .csv, .tsv, .txt, atau .pheno`);
        e.target.value = '';
        return;
      }
      setPhenotypeFileLocal(file);
      setPhenotypeFile(file);
      setIssue('pheno', null);
      checkPhenotypeFile(file).then((r) => setIssue('pheno', r));
    }
  };

  const handleRemoveGenotypeFile = (name: string) => {
    const next = genotypeFilesLocal.filter((f) => f.name !== name);
    setIssue(`geno:${name}`, null);
    setGenotypeFilesLocal(next);
    setGenotypeFile((next[0] ?? null) as any);
    setValidationData(null);
  };

  const handleRemovePhenotype = () => {
    setPhenotypeFileLocal(null);
    setIssue('pheno', null);
    setValidationData(null);
  };

  const canValidate = genoState.complete && !!phenotypeFileLocal && !hasBlockingIssues;

  // Unggah genotipe (3 berkas PLINK / 1 VCF) + fenotipe, validasi, lalu baca trait asli dari backend
  const handleRunValidation = async () => {
    if (!genoState.complete) {
      setErrorMessage(
        genoState.kind === 'empty'
          ? 'Pilih berkas genotipe: .bed + .bim + .fam (PLINK) atau satu berkas .vcf / .vcf.gz.'
          : `Berkas PLINK belum lengkap. Masih kurang: ${genoState.missing.join(', ')}.`
      );
      return;
    }
    if (!phenotypeFileLocal) {
      setErrorMessage('Berkas fenotipe belum dipilih.');
      return;
    }

    setIsValidating(true);
    setErrorMessage(null);

    try {
      const sig = [...genotypeFilesLocal, phenotypeFileLocal]
        .map((f) => `${f.name}:${f.size}:${f.lastModified}`)
        .join('|');
      let datasetId: number;

      if (uploadCache.current && uploadCache.current.sig === sig) {
        datasetId = uploadCache.current.datasetId; // berkas sama: tidak perlu unggah ulang
      } else {
        // 1. Genotipe: semua berkas dikirim sebagai field "file" berulang
        const genoForm = new FormData();
        genotypeFilesLocal.forEach((f) => genoForm.append('file', f));
        const genoRes = await fetch(`${API_BASE}/api/gwas/upload-genotype`, {
          method: 'POST',
          headers: authHeaders(),
          body: genoForm,
        });
        if (genoRes.status === 401) { redirectToLogin(); return; }
        if (genoRes.status === 413) throw new Error(`Ukuran berkas melebihi batas server (maks. ${fmtBytes(MAX_FILE_BYTES)} per berkas, ${fmtBytes(MAX_DATASET_BYTES)} per dataset).`);
        if (!genoRes.ok) throw new Error(await readError(genoRes, 'Gagal mengunggah berkas genotipe'));
        const genoResult = await genoRes.json();
        if (!genoResult.dataset_id) throw new Error('Server tidak mengembalikan dataset_id setelah upload genotipe.');
        datasetId = genoResult.dataset_id;
        const genoMissing = (genoResult.missing || []).filter((m: string) => /genotip/i.test(m));
        if (genoMissing.length) throw new Error(genoMissing.join('; '));

        // 2. Fenotipe masuk ke dataset yang sama (hanya satu berkas)
        const phenoForm = new FormData();
        phenoForm.append('file', phenotypeFileLocal);
        phenoForm.append('dataset_id', String(datasetId));
        const phenoRes = await fetch(`${API_BASE}/api/gwas/upload-phenotype`, {
          method: 'POST',
          headers: authHeaders(),
          body: phenoForm,
        });
        if (phenoRes.status === 413) throw new Error(`Ukuran berkas fenotipe melebihi batas server (maks. ${fmtBytes(MAX_FILE_BYTES)} per berkas).`);
        if (!phenoRes.ok) throw new Error(await readError(phenoRes, 'Gagal mengunggah berkas fenotipe'));
        const phenoResult = await phenoRes.json();
        if (phenoResult.ready_for_validation === false && (phenoResult.missing || []).length) {
          throw new Error((phenoResult.missing as string[]).join('; '));
        }
        uploadCache.current = { sig, datasetId };
      }

      // Dataset baru -> analisis lama tidak berlaku lagi
      localStorage.setItem('dataset_id', String(datasetId));
      localStorage.removeItem('analysis_id');

      // 3. Validasi dataset
      const validateRes = await fetch(`${API_BASE}/api/gwas/datasets/${datasetId}/validate`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!validateRes.ok) throw new Error(await readError(validateRes, 'Gagal melakukan validasi berkas'));
      const validResult = await validateRes.json();
      const canProceed: boolean = validResult.can_proceed ?? validResult.status === 'valid';

      // 4. Trait asli dari fenotipe (hanya tersedia bila validasi lolos)
      let traitsCount = 0;
      let missingRate = '-';
      if (canProceed) {
        try {
          const { traits, covariateCandidates } = await fetchTraitsFull(datasetId);
          traitsCount = traits.length;
          setPhenotypeColumns(Array.from(new Set([...traits.map((t) => t.name), ...covariateCandidates.map((c) => c.name)])));
          const miss = traits.reduce((a, t) => a + (t.nMissing ?? 0), 0);
          const valid = traits.reduce((a, t) => a + (t.nValid ?? 0), 0);
          if (miss + valid > 0) missingRate = `${((miss / (miss + valid)) * 100).toFixed(1)}%`;
        } catch (e) {
          console.warn('Gagal memuat trait:', e);
        }
      }
      setPhenotypeFile(phenotypeFileLocal);

      const nSamples = validResult.genotype?.n_samples ?? 0;
      setValidationData({
        genotypeInfo: {
          name: genotypeFilesLocal.map((f) => f.name).join(', '),
          size: formatFileSize(genotypeFilesLocal.reduce((a, f) => a + f.size, 0)),
          samplesCount: nSamples,
          snpCount: validResult.genotype?.n_variants ?? 0,
          format: String(validResult.genotype?.format ?? ''),
        },
        phenotypeInfo: {
          name: phenotypeFileLocal.name,
          size: formatFileSize(phenotypeFileLocal.size),
          traitsCount,
        },
        matchedSamples: validResult.matching?.matched ?? validResult.matching?.n_matched ?? nSamples,
        missingRate,
        warnings: validResult.warnings ?? [],
        errors: validResult.errors ?? [],
        isValid: canProceed,
        message: validResult.summary_message || (canProceed ? 'Dataset siap dikonfigurasi.' : 'Dataset belum dapat dilanjutkan.'),
      });
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Terjadi kesalahan saat menghubungkan ke server backend.');
    } finally {
      setIsValidating(false);
    }
  };

  // Navigasi Taskbar disesuaikan persis dengan struktur 7 bagian pada dokumen:
  const steps = [
    { id: 1, name: 'Input & Validasi Data', href: '/pipeline/step-1', completed: !!validationData?.isValid, active: true },
    { id: 2, name: 'Quality Control (QC)', href: '/pipeline/step-2', completed: false, active: false },
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
            <span className="text-slate-800 font-semibold">Step 1: Input & Validasi Data</span>
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
                  ? 'bg-blue-600 text-white font-bold shadow-lg shadow-blue-600/30'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 font-medium'
              }`}
            >
              {step.completed ? (
                <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-sm">
                  ✓
                </span>
              ) : step.active ? (
                <span className="w-6 h-6 rounded-full bg-white text-blue-600 flex items-center justify-center text-xs font-bold shrink-0 shadow-md">
                  {step.id}
                </span>
              ) : (
                <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-semibold shrink-0">
                  {step.id}
                </span>
              )}
              <span className="leading-tight">{step.name}</span>
            </Link>
          ))}
        </aside>

        {/* MAIN CONTAINER DENGAN ANIMASI FADE-IN */}
        <main className="flex-1 p-8 overflow-y-auto max-w-5xl space-y-8 transition-all duration-500 ease-out animate-fadeIn">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-1">Unggah & Validasi Data Input</h1>
            <p className="text-sm text-slate-600 font-medium">Unggah genotipe (3 berkas PLINK: .bed + .bim + .fam, atau 1 berkas VCF) dan 1 berkas fenotipe, lalu jalankan validasi.</p>
          </div>

          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-xs flex items-center justify-between shadow-sm transition-all duration-300 animate-fadeIn">
              <div className="flex items-center gap-2"><span>⚠️</span><span>{errorMessage}</span></div>
              <button onClick={() => setErrorMessage(null)} className="text-rose-500 font-bold hover:text-rose-800 text-sm">✕</button>
            </div>
          )}

          {/* Card Upload */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6 transition-all duration-300 hover:shadow-[0_15px_50px_rgba(0,0,0,0.08)] card-glass">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider ml-1">Unggah Berkas Wajib</h2>
            
            <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-6 text-center transition-all duration-300 bg-white/50 hover:bg-white/90">
              <input type="file" multiple accept=".bed,.bim,.fam,.vcf,.gz" onChange={handleGenotypeChange} className="hidden" id="genotype-input" />
              <label htmlFor="genotype-input" className="cursor-pointer block space-y-2">
                <span className="text-sm font-bold text-slate-700 block">Berkas Genotipe: PLINK (.bed + .bim + .fam) atau VCF (.vcf / .vcf.gz)</span>
                <span className="text-xs text-slate-500 block font-medium">
                  {genotypeFilesLocal.length === 0
                    ? 'Klik untuk memilih. Untuk PLINK, pilih ketiga berkas sekaligus (atau satu per satu).'
                    : 'Klik untuk menambah atau mengganti berkas'}
                </span>
                <span className="text-[11px] text-slate-400 block">Ukuran maksimum {fmtBytes(MAX_FILE_BYTES)} per berkas · total {fmtBytes(MAX_DATASET_BYTES)} per dataset</span>
              </label>

              {genoState.kind === 'plink' && (
                <div className="mt-3 flex items-center justify-center gap-2 text-[11px] font-semibold">
                  {['.bed', '.bim', '.fam'].map((e) => (
                    <span key={e} className={`px-2.5 py-1 rounded-full border ${genoState.missing.includes(e) ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                      {genoState.missing.includes(e) ? '✗' : '✓'} {e}
                    </span>
                  ))}
                </div>
              )}

              {genotypeFilesLocal.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {genotypeFilesLocal.map((f) => (
                    <div key={f.name}>
                    <div className="flex items-center justify-between bg-white/70 border border-white rounded-lg px-3 py-1.5 text-xs">
                      <span className="font-mono text-slate-700 truncate">{f.name} <span className="text-slate-400">({formatFileSize(f.size)})</span></span>
                      <button type="button" onClick={() => handleRemoveGenotypeFile(f.name)} className="ml-3 px-2 py-0.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded text-xs font-semibold transition-all">Hapus</button>
                    </div>
                    {renderIssues(`geno:${f.name}`)}
                    </div>
                  ))}
                  {genoState.kind === 'plink' && genoState.missing.length > 0 && (
                    <p className="text-[11px] text-amber-700 font-medium">PLINK belum lengkap, masih kurang: {genoState.missing.join(', ')}</p>
                  )}
                  {genoState.stemMismatch && (
                    <p className="text-[11px] text-amber-700 font-medium">Nama dasar ketiga berkas berbeda. Pastikan ketiganya satu set PLINK yang sama.</p>
                  )}
                  {genoState.complete && (
                    <span className="inline-block text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                      ✓ {genoState.kind === 'vcf' ? 'Berkas VCF siap' : 'Set PLINK lengkap'}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-6 text-center transition-all duration-300 bg-white/50 hover:bg-white/90">
              <input type="file" accept=".csv,.tsv,.txt,.pheno" onChange={handlePhenotypeChange} className="hidden" id="phenotype-input" />
              <label htmlFor="phenotype-input" className="cursor-pointer block space-y-2">
                <span className="text-sm font-bold text-slate-700 block">Berkas Fenotipe (.csv, .tsv, .txt, .pheno), satu berkas</span>
                <span className="text-xs text-slate-500 block font-medium">{phenotypeFileLocal ? `${phenotypeFileLocal.name} (${fmtBytes(phenotypeFileLocal.size)})` : 'Klik untuk memilih berkas fenotipe'}</span>
                <span className="text-[11px] text-slate-400 block">Ukuran maksimum {fmtBytes(MAX_FILE_BYTES)}. Baris pertama harus header (ID sampel di kolom pertama, lalu nama trait).</span>
              </label>
              {phenotypeFileLocal && (
                <div className="mt-3 flex items-center justify-center gap-3">
                  {fileIssues['pheno']?.errors.length ? (
                    <span className="text-xs font-semibold text-rose-600 bg-rose-50 px-3 py-1 rounded-full border border-rose-200">✗ Format perlu diperbaiki</span>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">✓ Fenotipe dipilih</span>
                  )}
                  <button type="button" onClick={handleRemovePhenotype} className="px-2 py-0.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded text-xs font-semibold transition-all">Hapus</button>
                </div>
              )}
              {renderIssues('pheno')}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                disabled={!canValidate || isValidating}
                onClick={handleRunValidation}
                className={`rounded-xl font-semibold px-6 py-3 transition-all duration-300 text-xs shadow-md hover:scale-[1.01] active:scale-[0.98] ${!canValidate ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 text-white hover:opacity-95'}`}
              >
                {isValidating ? 'Mengunggah & memvalidasi...' : (hasBlockingIssues ? 'Perbaiki Format Berkas Dahulu' : !canValidate ? 'Lengkapi Berkas Dahulu' : 'Unggah & Validasi Berkas')}
              </button>
            </div>
          </div>

          {/* CARD HASIL VALIDASI */}
          {validationData && (
            <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6 transition-all duration-500 animate-fadeIn card-glass">
              <div className="flex items-center justify-between border-b border-white/60 pb-4">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">2. Laporan Detil Hasil Validasi Data</h2>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${validationData.isValid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{validationData.isValid ? 'Kompatibel ✓' : 'Perlu Perbaikan'}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                <div className="p-4 bg-white/60 rounded-xl border border-white shadow-sm space-y-1">
                  <span className="text-slate-500 font-medium block">Total Sampel</span>
                  <strong className="text-blue-700 text-base font-bold">{validationData.matchedSamples} Sampel</strong>
                </div>
                <div className="p-4 bg-white/60 rounded-xl border border-white shadow-sm space-y-1">
                  <span className="text-slate-500 font-medium block">Total Marker (SNP)</span>
                  <strong className="text-emerald-700 text-base font-bold">{validationData.genotypeInfo.snpCount.toLocaleString()} SNP</strong>
                </div>
                <div className="p-4 bg-white/60 rounded-xl border border-white shadow-sm space-y-1">
                  <span className="text-slate-500 font-medium block">Nilai Fenotipe Kosong</span>
                  <strong className="text-slate-800 text-base font-bold">{validationData.missingRate}</strong>
                </div>
                <div className="p-4 bg-white/60 rounded-xl border border-white shadow-sm space-y-1">
                  <span className="text-slate-500 font-medium block">Peringatan / Error</span>
                  <strong className={`text-base font-bold ${validationData.errors.length > 0 ? 'text-rose-600' : validationData.warnings.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{validationData.warnings.length} peringatan, {validationData.errors.length} error</strong>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-700 pt-2">
                <div className="flex items-center justify-between bg-white/50 p-3.5 rounded-xl border border-white">
                  <span className="text-slate-600">Berkas Genotipe{validationData.genotypeInfo.format ? ` (${validationData.genotypeInfo.format})` : ''}: <strong className="text-slate-900 font-mono break-all">{validationData.genotypeInfo.name}</strong></span>
                  <span className="text-slate-500 font-medium">{validationData.genotypeInfo.size}</span>
                </div>
                <div className="flex items-center justify-between bg-white/50 p-3.5 rounded-xl border border-white">
                  <span className="text-slate-600">Berkas Fenotipe ({validationData.phenotypeInfo.traitsCount} trait): <strong className="text-slate-900 font-mono">{validationData.phenotypeInfo.name}</strong></span>
                  <span className="text-slate-500 font-medium">{validationData.phenotypeInfo.size}</span>
                </div>
              </div>

              <div className={`p-4 border rounded-2xl text-xs flex items-start gap-3 ${validationData.isValid ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                <span className="text-lg">{validationData.isValid ? '🎉' : '⚠️'}</span>
                <div>
                  <strong className="block font-bold">{validationData.isValid ? 'Validasi Berhasil Dijalankan' : 'Validasi Menemukan Masalah'}</strong>
                  <span>{validationData.message}</span>
                </div>
              </div>

              {validationData.errors.length > 0 && (
                <div className="space-y-2">
                  {validationData.errors.map((it, i) => (
                    <div key={`e${i}`} className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                      <strong className="block">{it.message}</strong>
                      {it.hint && <span className="text-rose-700">{it.hint}</span>}
                    </div>
                  ))}
                </div>
              )}

              {validationData.warnings.length > 0 && (
                <div className="space-y-2">
                  {validationData.warnings.map((it, i) => (
                    <div key={`w${i}`} className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                      <strong className="block">{it.message}</strong>
                      {it.hint && <span className="text-amber-800">{it.hint}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <footer className="relative z-10 w-full h-16 border-t border-white/60 bg-white/70 backdrop-blur-md px-6 flex items-center justify-between shadow-sm">
        <Link href="/" className="px-5 py-2.5 bg-white/85 hover:bg-white text-slate-700 text-xs font-semibold rounded-xl transition-all border border-white shadow-sm flex items-center gap-2 hover:scale-[1.01]">
          <span>←</span> Kembali ke Beranda
        </Link>
        <Link
          href="/pipeline/step-2"
          className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md hover:scale-[1.01] active:scale-[0.98] ${validationData?.isValid ? 'bg-gradient-to-r from-blue-600 to-emerald-600 hover:opacity-95 text-white shadow-blue-600/25' : 'bg-slate-200 text-slate-400 pointer-events-none cursor-not-allowed'}`}
        >
          Lanjut ke Step 2 (Quality Control) →
        </Link>
      </footer>
    </div>
  );
}