'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { usePipelineStore } from '@/store/usePipelineStore';
import { useAuthProfile } from '@/lib/auth';
import { API_BASE, authHeaders, getAnalysisId, readError, normalizeVariant, unwrapRows, fmtNum, fmtP, Variant } from '@/lib/api';

const Plot = dynamic(
  async () => {
    const Plotly = await import('plotly.js-dist-min');
    // @ts-ignore
    const createPlotlyComponent = (await import('react-plotly.js/factory')).default;
    return createPlotlyComponent(Plotly);
  },
  { ssr: false }
);

export default function Step5HasilVisualisasiDanEkspor() {
  const { userProfile } = usePipelineStore();
  useAuthProfile();
  
  const [downloadCategory, setDownloadCategory] = useState('Full Association Results (.csv)');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [isLoadingSummary, setIsLoadingSummary] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Data asli dari backend
  const [summary, setSummary] = useState<any>(null);
  const [mhMeta, setMhMeta] = useState<{ total: number | null; significant: number | null }>({ total: null, significant: null });
  const [mhPoints, setMhPoints] = useState<Array<{ chr: string; pos: number; snp: string; logP: number; x: number }>>([]);
  const [qq, setQq] = useState<{ observed: number[]; expected: number[]; lambda: number | null } | null>(null);
  const [topRows, setTopRows] = useState<Variant[]>([]);
  const [selectedSnpInfo, setSelectedSnpInfo] = useState<Variant | null>(null);

  const SIG_P = 5e-8;
  const SIG_LOGP = -Math.log10(SIG_P);

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

  // Ambil semua hasil analisis asli dari backend
  useEffect(() => {
    const analysisId = getAnalysisId();
    if (!analysisId) {
      setLoadError('Belum ada hasil analisis. Jalankan pipeline dari Step 1 sampai Step 4 terlebih dahulu.');
      setIsLoadingSummary(false);
      return;
    }
    const base = `${API_BASE}/api/gwas/analyses/${analysisId}`;
    const get = async (path: string) => {
      const r = await fetch(`${base}${path}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await readError(r, `Gagal memuat ${path}`));
      return r.json();
    };

    const parseManhattan = (d: any) => {
      let rows: any[] = unwrapRows(d);
      if (rows.length === 0) {
        const cols = d?.columns ?? d;
        const chr = cols?.chr ?? cols?.chromosome;
        const pos = cols?.pos ?? cols?.position;
        if (Array.isArray(chr) && Array.isArray(pos)) {
          const lp = cols.neg_log10_p ?? cols.minus_log10_p ?? cols.logp;
          const pv = cols.pvalue ?? cols.p_value ?? cols.p;
          const sn = cols.snp ?? cols.rsid ?? cols.id;
          rows = chr.map((c: any, i: number) => ({
            chr: c, pos: pos[i], snp: sn?.[i],
            neg_log10_p: lp?.[i], pvalue: pv?.[i],
          }));
        }
      }
      return rows
        .map((r) => {
          const v = normalizeVariant(r);
          const lp = r.neg_log10_p ?? r.minus_log10_p ?? r.logp ?? (v.pvalue && v.pvalue > 0 ? -Math.log10(v.pvalue) : null);
          return { chr: v.chr, pos: v.pos, snp: v.snp, logP: typeof lp === 'number' ? lp : NaN, x: 0 };
        })
        .filter((r) => isFinite(r.logP));
    };

    (async () => {
      try {
        const [sum, mh, qqd, top, interp] = await Promise.all([
          get('/results/summary'),
          get('/results/manhattan?format=rows&max_points=20000'),
          get('/results/qq').catch(() => null),
          get('/results/top').catch(() => null),
          get('/interpretation').catch(() => null),
        ]);
        setSummary(sum);
        if (sum?.best_variant) setSelectedSnpInfo(normalizeVariant(sum.best_variant));

        // Manhattan: posisi kumulatif antar kromosom
        const pts = parseManhattan(mh);
        const order: string[] =
          Array.isArray(mh?.chromosome_order) && mh.chromosome_order.length > 0
            ? mh.chromosome_order.map(String)
            : Array.from(new Set(pts.map((p) => p.chr))).sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99));
        const maxPos: Record<string, number> = {};
        pts.forEach((p) => { maxPos[p.chr] = Math.max(maxPos[p.chr] ?? 0, p.pos); });
        const offset: Record<string, number> = {};
        let run = 0;
        order.forEach((c) => {
          offset[c] = run;
          run += mh?.chromosome_max_position?.[c] ?? maxPos[c] ?? 0;
        });
        pts.forEach((p) => { p.x = (offset[p.chr] ?? 0) + p.pos; });
        setMhPoints(pts);
        setMhMeta({
          total: mh?.total_variants ?? sum?.total_variants ?? sum?.n_variants ?? null,
          significant: mh?.significant_total ?? sum?.significant_total ?? sum?.n_significant ?? null,
        });

        if (qqd) {
          setQq({
            observed: qqd.observed_neg_log10_p ?? [],
            expected: qqd.expected_neg_log10_p ?? [],
            lambda: typeof qqd.lambda_gc === 'number' ? qqd.lambda_gc : null,
          });
        }
        if (top) setTopRows(unwrapRows(top).map(normalizeVariant));

        // Narasi ringkasan dari angka asli (atau teks dari backend jika tersedia)
        const bv = sum?.best_variant ? normalizeVariant(sum.best_variant) : null;
        // Interpretasi statistik dari backend (GET /interpretation); bila belum ada, pakai ringkasan angka asli
        const findings: any[] = Array.isArray(interp?.result?.findings) ? interp.result.findings : [];
        const interpText = findings
          .slice(0, 3)
          .map((f: any) => [f.title, f.interpretation].filter(Boolean).join(': '))
          .join('\n\n');
        const backendText = interpText || sum?.summary || sum?.ai_summary || sum?.summary_message;
        if (backendText) {
          setAiSummary(String(backendText));
        } else if (bv) {
          const lam = typeof qqd?.lambda_gc === 'number' ? ` Genomic inflation factor λ = ${qqd.lambda_gc.toFixed(3)}.` : '';
          setAiSummary(
            `Varian dengan asosiasi terkuat adalah ${bv.snp} (kromosom ${bv.chr}, posisi ${bv.pos.toLocaleString('id-ID')}) dengan p-value ${fmtP(bv.pvalue)}.` +
              (mh?.significant_total !== undefined ? ` Terdapat ${mh.significant_total} varian signifikan dari ${(mh.total_variants ?? 0).toLocaleString('id-ID')} varian yang dianalisis.` : '') +
              lam
          );
        }
      } catch (err: any) {
        console.error(err);
        setLoadError(err.message || 'Gagal memuat hasil analisis dari backend.');
      } finally {
        setIsLoadingSummary(false);
      }
    })();
  }, []);

  // Handler Unduh Laporan & Berkas (dengan notifikasi berhasil / gagal)
  const handleDownloadReport = async (overrideCategory?: string) => {
    const targetFile = overrideCategory || downloadCategory;
    setIsDownloading(true);
    setDownloadNotice(null);
    try {
      const analysisId = getAnalysisId();
      if (!analysisId) throw new Error('Belum ada analisis yang dipilih.');
      const headers = authHeaders();

      // Petakan pilihan UI -> endpoint backend (GET /export mendukung CSV, TSV, JSON, Excel)
      let url = '';
      let ext = 'csv';
      if (targetFile.includes('.png')) {
        throw new Error('Ekspor gambar belum disediakan backend.');
      } else if (targetFile.includes('Metadata')) {
        url = `${API_BASE}/api/gwas/analyses/${analysisId}/config/export`;
        ext = 'json';
      } else if (targetFile.includes('.xlsx')) {
        url = `${API_BASE}/api/gwas/analyses/${analysisId}/export?format=xlsx`;
        ext = 'xlsx';
      } else {
        const onlySig = targetFile.startsWith('Significant');
        url = `${API_BASE}/api/gwas/analyses/${analysisId}/export?format=csv${onlySig ? '&significant_only=true' : ''}`;
      }
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) throw new Error(await readError(response, 'Server menolak permintaan unduhan'));

      const blob = await response.blob();
      if (blob.size === 0) throw new Error('Berkas yang diterima kosong.');

      // Nama berkas dari header Content-Disposition bila ada
      const cd = response.headers.get('content-disposition') || '';
      const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const fileName = m
        ? decodeURIComponent(m[1])
        : `GWAS_${targetFile.replace(/\(.*\)/, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}.${ext}`;

      const objUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objUrl);

      const sizeLabel = blob.size >= 1024 * 1024 ? `${(blob.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(blob.size / 1024))} KB`;
      setDownloadNotice({ type: 'success', message: `Berkas ${fileName} (${sizeLabel}) berhasil diunduh.` });
    } catch (err: any) {
      console.error(err);
      setDownloadNotice({ type: 'error', message: `Gagal mengunduh ${targetFile}: ${err.message || 'periksa koneksi ke server backend.'}` });
    } finally {
      setIsDownloading(false);
    }
  };

  // Notifikasi unduhan hilang otomatis
  useEffect(() => {
    if (!downloadNotice) return;
    const t = setTimeout(() => setDownloadNotice(null), 7000);
    return () => clearTimeout(t);
  }, [downloadNotice]);

  // Klik titik pada Manhattan plot -> tampilkan detail varian
  const handlePointClick = (event: any) => {
    const idx = event?.points?.[0]?.pointIndex;
    const target = typeof idx === 'number' ? mhPoints[idx] : undefined;
    if (target) {
      const fromTop = topRows.find((r) => r.snp === target.snp);
      setSelectedSnpInfo(
        fromTop ?? {
          snp: target.snp, chr: target.chr, pos: target.pos, effectAllele: '-',
          beta: null, se: null, pvalue: Math.pow(10, -target.logP), adjPvalue: null,
        }
      );
    }
  };

  const isSig = (v: Variant) => v.pvalue !== null && v.pvalue < SIG_P;

  const steps = [
    { id: 1, name: 'Input & Validasi Data', href: '/pipeline/step-1', completed: true, active: false },
    { id: 2, name: 'Quality Control (QC)', href: '/pipeline/step-2', completed: true, active: false },
    { id: 3, name: 'PCA & Kovariat', href: '/pipeline/step-3', completed: true, active: false },
    { id: 4, name: 'Analisis GWAS & Post-Processing', href: '/pipeline/step-4', completed: true, active: false },
    { id: 5, name: 'Hasil, Visualisasi & Ekspor', href: '/pipeline/step-5', completed: false, active: true },
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
            <span className="text-slate-800 font-semibold">Step 5: Hasil, Visualisasi & Ekspor</span>
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

        {/* MAIN CONTAINER */}
        <main className="flex-1 p-8 overflow-y-auto max-w-5xl space-y-8 animate-fadeIn transition-all duration-500 ease-out">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-1">Hasil, Visualisasi & Ekspor Data</h1>
            <p className="text-sm text-slate-600 font-medium">Tinjau ringkasan hasil GWAS, Manhattan Plot, QQ Plot, tabel asosiasi lengkap, serta unduh laporan akhir.</p>
          </div>

          {loadError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-xs flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-2"><span>⚠️</span><span>{loadError}</span></div>
              <button onClick={() => setLoadError(null)} className="text-rose-500 font-bold hover:text-rose-800 text-sm">✕</button>
            </div>
          )}

          {downloadNotice && (
            <div
              className={`fixed bottom-6 right-6 z-50 max-w-sm flex items-start gap-3 p-4 rounded-2xl shadow-2xl border text-xs animate-fadeIn ${
                downloadNotice.type === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-rose-50 border-rose-300 text-rose-900'
              }`}
              role="status"
            >
              <span className="text-lg">{downloadNotice.type === 'success' ? '✅' : '⛔'}</span>
              <span className="flex-1 font-medium">{downloadNotice.message}</span>
              <button onClick={() => setDownloadNotice(null)} className="font-bold opacity-60 hover:opacity-100">✕</button>
            </div>
          )}

          {/* KARTU 1: RESULTS SUMMARY & RINGKASAN METRIK */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
            <div className="p-5 bg-white/70 border border-white/80 backdrop-blur-2xl rounded-2xl shadow-sm space-y-1">
              <span className="text-slate-500 font-bold block uppercase tracking-wider text-[10px]">TOTAL SNP DIANALISIS</span>
              <strong className="text-slate-900 text-lg font-extrabold">{mhMeta.total !== null ? `${mhMeta.total.toLocaleString('id-ID')} SNP` : '-'}</strong>
            </div>
            <div className="p-5 bg-white/70 border border-white/80 backdrop-blur-2xl rounded-2xl shadow-sm space-y-1">
              <span className="text-slate-500 font-bold block uppercase tracking-wider text-[10px]">SNP SIGNIFIKAN</span>
              <strong className="text-rose-600 text-lg font-extrabold">{mhMeta.significant !== null ? `${mhMeta.significant.toLocaleString('id-ID')} SNP` : '-'}</strong>
            </div>
            <div className="p-5 bg-white/70 border border-white/80 backdrop-blur-2xl rounded-2xl shadow-sm space-y-1">
              <span className="text-slate-500 font-bold block uppercase tracking-wider text-[10px]">TOP SNP (MIN P-VALUE)</span>
              <strong className="text-blue-700 text-lg font-mono font-extrabold">
                {summary?.best_variant ? (() => { const b = normalizeVariant(summary.best_variant); return `${b.snp} (${fmtP(b.pvalue)})`; })() : '-'}
              </strong>
            </div>
            <div className="p-5 bg-white/70 border border-white/80 backdrop-blur-2xl rounded-2xl shadow-sm space-y-1">
              <span className="text-slate-500 font-bold block uppercase tracking-wider text-[10px]">GENOMIC INFLATION (AGC / λ)</span>
              <strong className="text-emerald-600 text-lg font-mono font-extrabold">{qq?.lambda != null ? `λ = ${qq.lambda.toFixed(3)}` : '-'}</strong>
            </div>
          </div>

          {!isLoadingSummary && !loadError && mhMeta.significant === 0 && (
            <div className="flex items-start gap-3 p-4 bg-sky-50 border border-sky-200 rounded-2xl text-xs text-sky-900">
              <span className="text-lg">ℹ️</span>
              <div className="space-y-1">
                <strong className="block font-bold">Tidak ada SNP yang lolos ambang signifikansi</strong>
                <span className="block">
                  Tidak ada varian dengan p-value di bawah ambang yang dipakai
                  ({(() => {
                    const t = summary?.significance?.threshold_p ?? summary?.threshold_p;
                    return typeof t === 'number' ? `p ≤ ${t.toExponential(2)}` : `p ≤ ${SIG_P.toExponential(0)}`;
                  })()}). Ini bukan kesalahan: analisis berhasil dan tabel tidak gagal dimuat, hanya saja belum ada varian yang melewati batas.
                </span>
                <span className="block">
                  Tabel dan grafik di bawah tetap menampilkan varian terbaik (p-value terkecil), tetapi belum berstatus signifikan.
                  Anda dapat mencoba metode yang lebih longgar (mis. FDR atau suggestive) di Step 4.
                </span>
              </div>
            </div>
          )}

          {/* Detail Interactive Panel */}
          {selectedSnpInfo && (
            <div className="bg-blue-50/90 border border-blue-200 backdrop-blur-md rounded-2xl p-5 shadow-sm text-xs text-blue-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📍</span>
                <div>
                  <strong className="block text-sm font-bold text-blue-950">Varian SNP Terpilih: {selectedSnpInfo.snp}</strong>
                  <span className="text-slate-600">
                    Chr: <strong className="text-slate-900">{selectedSnpInfo.chr}</strong> | Pos: <strong className="text-slate-900">{selectedSnpInfo.pos.toLocaleString('id-ID')}</strong> | Effect Allele: <strong className="text-slate-900">{selectedSnpInfo.effectAllele}</strong> | Beta: <strong className="text-slate-900">{fmtNum(selectedSnpInfo.beta)}</strong> | SE: <strong className="text-slate-900">{fmtNum(selectedSnpInfo.se)}</strong> | p-value: <strong className="text-slate-900 font-mono">{fmtP(selectedSnpInfo.pvalue)}</strong>
                  </span>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full font-bold text-[11px] ${isSig(selectedSnpInfo) ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                {isSig(selectedSnpInfo) ? 'Signifikan Genomik (GWAS Threshold)' : 'Di Bawah Threshold'}
              </span>
            </div>
          )}

          {/* KARTU 2: VISUALISASI MANHATTAN PLOT & QQ PLOT */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Manhattan Plot */}
            <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-4">
              <div className="flex items-center justify-between border-b border-white/60 pb-3">
                <div>
                  <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Manhattan Plot</h2>
                  <span className="text-[10px] text-slate-500">Hubungan posisi kromosom vs signifikansi asosiasi (-log10 p-value)</span>
                </div>
              </div>
              <div className="bg-white/60 p-3 rounded-2xl border border-white">
                {mhPoints.length > 0 ? (
                  <Plot
                    data={[{
                      x: mhPoints.map((p) => p.x),
                      y: mhPoints.map((p) => p.logP),
                      text: mhPoints.map((p) => `${p.snp} (chr${p.chr}:${p.pos})`),
                      hoverinfo: 'text+y',
                      mode: 'markers',
                      type: 'scattergl',
                      marker: {
                        size: 7,
                        color: mhPoints.map((p) => (p.logP >= SIG_LOGP ? '#f43f5e' : (parseInt(p.chr) || 0) % 2 === 0 ? '#3b82f6' : '#6366f1')),
                      },
                    }]}
                    layout={{
                      autosize: true,
                      margin: { l: 35, r: 15, t: 20, b: 35 },
                      xaxis: { title: { text: 'Chromosomal Position' } },
                      yaxis: { title: { text: '-log10(p-value)' } },
                      shapes: [{
                        type: 'line', x0: 0, x1: 1, xref: 'paper',
                        y0: SIG_LOGP, y1: SIG_LOGP,
                        line: { color: '#f43f5e', width: 1.5, dash: 'dash' },
                      }],
                    }}
                    onClick={handlePointClick}
                    useResizeHandler
                    style={{ width: '100%', height: '220px' }}
                    config={{ responsive: true, displayModeBar: false }}
                  />
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-xs text-slate-500">
                    {isLoadingSummary ? 'Memuat data Manhattan...' : 'Data Manhattan belum tersedia.'}
                  </div>
                )}
              </div>
            </div>

            {/* QQ Plot */}
            <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-4">
              <div className="flex items-center justify-between border-b border-white/60 pb-3">
                <div>
                  <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">QQ Plot (Quantile-Quantile)</h2>
                  <span className="text-[10px] text-slate-500">Evaluasi inflasi statistik (Observed vs Expected -log10 p-value)</span>
                </div>
              </div>
              <div className="bg-white/60 p-3 rounded-2xl border border-white">
                {qq && qq.observed.length > 0 ? (
                  <Plot
                    data={[{
                      x: qq.expected,
                      y: qq.observed,
                      mode: 'markers',
                      type: 'scatter',
                      marker: { size: 6, color: '#10b981' },
                    }, {
                      x: [0, Math.max(...qq.expected)],
                      y: [0, Math.max(...qq.expected)],
                      mode: 'lines',
                      line: { color: '#94a3b8', dash: 'dash', width: 1.5 },
                    }]}
                    layout={{
                      autosize: true,
                      margin: { l: 35, r: 15, t: 20, b: 35 },
                      xaxis: { title: { text: 'Expected -log10(p)' } },
                      yaxis: { title: { text: 'Observed -log10(p)' } },
                      showlegend: false,
                    }}
                    useResizeHandler
                    style={{ width: '100%', height: '220px' }}
                    config={{ responsive: true, displayModeBar: false }}
                  />
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-xs text-slate-500">
                    {isLoadingSummary ? 'Memuat data QQ...' : 'Data QQ plot belum tersedia.'}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* KARTU 3: TABEL VARIAN TERBAIK */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6">
            <div className="flex items-center justify-between border-b border-white/60 pb-3">
              <div>
                <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Top Variants Table</h2>
                <span className="text-[10px] text-slate-500">Varian dengan asosiasi terkuat dari hasil analisis Anda</span>
              </div>
              <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">{topRows.length} varian</span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white bg-white/50">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="py-3 px-4 font-semibold">SNP ID</th>
                    <th className="py-3 px-4 font-semibold">Kromosom</th>
                    <th className="py-3 px-4 font-semibold">Posisi</th>
                    <th className="py-3 px-4 font-semibold">Effect Allele</th>
                    <th className="py-3 px-4 font-semibold text-right">Beta</th>
                    <th className="py-3 px-4 font-semibold text-right">Std Error (SE)</th>
                    <th className="py-3 px-4 font-semibold text-right">P-value</th>
                    <th className="py-3 px-4 font-semibold text-right">Adjusted P-value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {topRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 px-4 text-center text-slate-500">
                        {isLoadingSummary ? 'Memuat tabel hasil...' : 'Belum ada data varian.'}
                      </td>
                    </tr>
                  )}
                  {topRows.map((row, idx) => (
                    <tr
                      key={`${row.snp}-${idx}`}
                      onClick={() => setSelectedSnpInfo(row)}
                      className={`cursor-pointer transition hover:bg-blue-50/60 ${isSig(row) ? 'bg-rose-50/40 font-semibold' : ''}`}
                    >
                      <td className="py-3 px-4 font-mono text-blue-600 font-bold">{row.snp}</td>
                      <td className="py-3 px-4 font-medium">{row.chr}</td>
                      <td className="py-3 px-4 font-mono text-slate-600">{row.pos.toLocaleString('id-ID')}</td>
                      <td className="py-3 px-4 font-bold text-slate-800">{row.effectAllele}</td>
                      <td className="py-3 px-4 font-mono text-right">{row.beta !== null && row.beta > 0 ? `+${fmtNum(row.beta)}` : fmtNum(row.beta)}</td>
                      <td className="py-3 px-4 font-mono text-right text-slate-500">{fmtNum(row.se)}</td>
                      <td className="py-3 px-4 font-mono text-right text-slate-900 font-bold">{fmtP(row.pvalue)}</td>
                      <td className="py-3 px-4 font-mono text-right text-emerald-700 font-bold">{fmtP(row.adjPvalue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* KARTU 4: RINGKASAN DESKRIPSI & METADATA ANALISIS */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-4 card-glass">
            <div className="flex items-center justify-between border-b border-white/60 pb-3">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Ringkasan & Deskripsi Hasil Analisis</h2>
              <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-bold">Summary</span>
            </div>
            <div className="text-xs text-slate-700 leading-relaxed space-y-2.5">
              {isLoadingSummary ? (
                <div className="flex items-center gap-3 py-4 text-slate-500 font-medium">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <span>Memuat ringkasan hasil...</span>
                </div>
              ) : (
                <p className="whitespace-pre-line">{aiSummary || 'Ringkasan belum tersedia.'}</p>
              )}
            </div>
          </div>

          {/* KARTU 5: OPSI UNDUH BERKAS HASIL LENGKAP */}
          <div className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-[2rem] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] space-y-6">
            <div className="flex items-center justify-between border-b border-white/60 pb-3">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Opsi Unduh & Ekspor Berkas Hasil (Export Options)</h2>
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">Export Options</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div>
                <label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1.5">PILIH BERKAS LUARAN UNTUK DIUNDUH</label>
                <select 
                  value={downloadCategory} 
                  onChange={(e) => setDownloadCategory(e.target.value)} 
                  className="w-full bg-white/90 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition font-semibold"
                >
                  <option value="Full Association Results (.csv)">Full Association Results (.csv / .tsv)</option>
                  <option value="Significant Results (.csv)">Significant Results Only (.csv / .tsv)</option>
                  <option value="Complete GWAS Report (.xlsx)">Complete GWAS Report (.xlsx)</option>
                  <option value="Analysis Metadata & QC Summary (.json)">Analysis Metadata & QC Summary (.json)</option>
                </select>
              </div>

              <div className="pt-4 flex flex-col gap-2.5">
                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => handleDownloadReport()}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-95 text-white py-3 px-4 rounded-xl text-xs font-bold transition shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>📥</span>
                  <span>{isDownloading ? 'Mengunduh Berkas dari Server...' : `Unduh ${downloadCategory.split(' ')[0]} ${downloadCategory.split(' ')[1]}`}</span>
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* FOOTER NAVIGATION */}
      <footer className="relative z-10 w-full h-16 border-t border-white/60 bg-white/70 backdrop-blur-md px-6 flex items-center justify-between shadow-sm">
        <Link href="/pipeline/step-4" className="px-5 py-2.5 bg-white/85 hover:bg-white text-slate-700 text-xs font-semibold rounded-xl transition border border-white shadow-sm flex items-center gap-2">
          <span>←</span> Kembali ke Analisis GWAS & Post-Processing
        </Link>
        <Link href="/" className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-emerald-600 hover:opacity-95 text-white text-xs font-bold rounded-xl transition shadow-md shadow-blue-600/20">
          Selesai & Kembali ke Beranda →
        </Link>
      </footer>
    </div>
  );
}