'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePipelineStore } from '@/store/usePipelineStore';
import { logout, useAuthProfile } from '@/lib/auth';
import { API_BASE, apiGet, authHeaders, readError, redirectToLogin } from '@/lib/api';
import { fmtBytes } from '@/lib/fileChecks';

// ---------- util ----------
interface AnalysisRow {
  id: number;
  status: string;
  datasetId: number | null;
  datasetName: string;
  trait: string;
  model: string;
  createdAt: string;
  percent: number | null;
  stage: string;
  message: string;
}

const unwrapList = (d: any): any[] => {
  if (Array.isArray(d)) return d;
  for (const k of ['items', 'analyses', 'results', 'data']) if (Array.isArray(d?.[k])) return d[k];
  return [];
};

const normalizeRow = (a: any): AnalysisRow => ({
  id: Number(a.analysis_id ?? a.id),
  status: String(a.status ?? '').toLowerCase(),
  datasetId: a.dataset_id ?? a.config?.dataset_id ?? null,
  datasetName: String(a.dataset_name ?? a.name ?? ''),
  trait: String(a.trait_name ?? a.config?.trait_name ?? ''),
  model: String(a.model ?? a.config?.model ?? ''),
  createdAt: String(a.created_at ?? a.queued_at ?? a.started_at ?? a.updated_at ?? ''),
  percent: typeof a.percent === 'number' ? a.percent : null,
  stage: String(a.stage ?? ''),
  message: String(a.message ?? ''),
});

const STATUS_META: Record<string, { label: string; cls: string }> = {
  done: { label: 'Selesai', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  completed: { label: 'Selesai', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  success: { label: 'Selesai', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  running: { label: 'Berjalan', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  queued: { label: 'Antre', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  pending: { label: 'Antre', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  processing: { label: 'Berjalan', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  awaiting: { label: 'Menunggu langkah berikutnya', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  failed: { label: 'Gagal', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  error: { label: 'Gagal', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
};
const statusMeta = (s: string) => STATUS_META[s] ?? { label: s || '-', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
const isDone = (s: string) => ['done', 'completed', 'success'].includes(s);
const isBusy = (s: string) => ['running', 'queued', 'pending', 'processing'].includes(s);

const fmtDate = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};

// Berkas keluaran yang dapat diunduh
const OUTPUTS: Array<{ key: string; label: string; desc: string; path: string; ext: string; needsDone: boolean }> = [
  { key: 'assoc-csv', label: 'Hasil asosiasi (.csv)', desc: 'Seluruh varian beserta p-value', path: '/export?format=csv', ext: 'csv', needsDone: true },
  { key: 'assoc-xlsx', label: 'Hasil asosiasi (.xlsx)', desc: 'Format Excel', path: '/export?format=xlsx', ext: 'xlsx', needsDone: true },
  { key: 'assoc-json', label: 'Hasil asosiasi (.json)', desc: 'Format JSON', path: '/export?format=json', ext: 'json', needsDone: true },
  { key: 'sig-csv', label: 'Varian signifikan (.csv)', desc: 'Hanya varian yang lolos ambang', path: '/export?format=csv&significant_only=true', ext: 'csv', needsDone: true },
  { key: 'manhattan', label: 'Data Manhattan plot (.csv)', desc: 'Sumber grafik Manhattan', path: '/results/manhattan/export?format=csv', ext: 'csv', needsDone: true },
  { key: 'qq', label: 'Data QQ plot (.csv)', desc: 'Sumber grafik QQ + lambda GC', path: '/results/qq/export?format=csv', ext: 'csv', needsDone: true },
  { key: 'qc', label: 'Laporan QC (.csv)', desc: 'Ringkasan filter kontrol kualitas', path: '/qc-summary/export?format=csv', ext: 'csv', needsDone: false },
  { key: 'pca', label: 'Koordinat PCA (.csv)', desc: 'PC per sampel + metadata', path: '/pca/export?format=csv', ext: 'csv', needsDone: false },
  { key: 'usage', label: 'Ringkasan penggunaan data (.csv)', desc: 'Dari unggah hingga hasil GWAS', path: '/data-usage/export?format=csv', ext: 'csv', needsDone: true },
  { key: 'ai', label: 'Interpretasi statistik AI (.json)', desc: 'Narasi hasil dari AI', path: '/interpretation/export', ext: 'json', needsDone: true },
  { key: 'config', label: 'Konfigurasi & versi perangkat lunak (.json)', desc: 'Untuk reproduksibilitas', path: '/config/export', ext: 'json', needsDone: false },
];

export default function HistoryPage() {
  useAuthProfile();
  const { userProfile } = usePipelineStore();

  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'done' | 'busy' | 'failed'>('all');
  const [openId, setOpenId] = useState<number | null>(null);

  // detail per analisis (dimuat saat dibuka)
  const [details, setDetails] = useState<Record<number, { config: any; files: any[]; loading: boolean; error?: string }>>({});
  const [dlState, setDlState] = useState<Record<string, 'loading' | 'ok' | 'error'>>({});
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    apiGet('/api/gwas/analyses')
      .then((d) => {
        const list = unwrapList(d).map(normalizeRow).filter((r) => Number.isFinite(r.id));
        list.sort((a, b) => b.id - a.id);
        setRows(list);
      })
      .catch((e: any) => setError(e.message || 'Gagal memuat riwayat analisis.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        filter === 'all' ? true : filter === 'done' ? isDone(r.status) : filter === 'busy' ? isBusy(r.status) || r.status === 'awaiting' : ['failed', 'error'].includes(r.status)
      ),
    [rows, filter]
  );

  const toggle = async (row: AnalysisRow) => {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id);
    if (details[row.id] && !details[row.id].error) return;

    setDetails((p) => ({ ...p, [row.id]: { config: null, files: [], loading: true } }));
    try {
      const d: any = await apiGet(`/api/gwas/analyses/${row.id}`);
      const config = d?.config ?? d?.configuration ?? d;
      const datasetId = config?.dataset_id ?? row.datasetId;
      let files: any[] = [];
      if (datasetId) {
        try {
          const ds: any = await apiGet(`/api/gwas/datasets/${datasetId}`);
          files = ds?.files ?? [];
        } catch {
          /* daftar berkas masukan opsional */
        }
      }
      setDetails((p) => ({ ...p, [row.id]: { config, files, loading: false } }));
    } catch (e: any) {
      setDetails((p) => ({ ...p, [row.id]: { config: null, files: [], loading: false, error: e.message || 'Gagal memuat detail.' } }));
    }
  };

  const download = async (row: AnalysisRow, out: (typeof OUTPUTS)[number]) => {
    const key = `${row.id}:${out.key}`;
    setDlState((p) => ({ ...p, [key]: 'loading' }));
    try {
      const res = await fetch(`${API_BASE}/api/gwas/analyses/${row.id}${out.path}`, { headers: authHeaders() });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (!res.ok) throw new Error(await readError(res, 'Server menolak permintaan unduhan'));
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('Berkas yang diterima kosong.');
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const fileName = m ? decodeURIComponent(m[1]) : `analisis-${row.id}_${out.key}.${out.ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDlState((p) => ({ ...p, [key]: 'ok' }));
      setToast({ type: 'success', message: `Berkas ${fileName} (${fmtBytes(blob.size)}) berhasil diunduh.` });
    } catch (e: any) {
      setDlState((p) => ({ ...p, [key]: 'error' }));
      setToast({ type: 'error', message: `Gagal mengunduh ${out.label}: ${e.message || 'periksa koneksi ke server.'}` });
    }
  };

  // Buka hasil / lanjutkan analisis di pipeline
  const openInPipeline = (row: AnalysisRow, config: any) => {
    const datasetId = config?.dataset_id ?? row.datasetId;
    if (datasetId) localStorage.setItem('dataset_id', String(datasetId));
    localStorage.setItem('analysis_id', String(row.id));
    let target = '/pipeline/step-5';
    if (row.status === 'awaiting') target = row.stage === 'pca' ? '/pipeline/step-4' : '/pipeline/step-3';
    window.location.href = target;
  };

  const getUserName = () => userProfile?.fullName || userProfile?.email?.split('@')[0] || 'Pengguna';

  const Setting = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="bg-white/80 border border-white rounded-xl p-3 space-y-0.5">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">{label}</span>
      <span className="text-xs font-semibold text-slate-800 break-words">{value || '-'}</span>
    </div>
  );

  return (
    <div className="relative min-h-screen w-full bg-slate-50 font-sans p-6 md:p-10 overflow-x-hidden">
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-50 mix-blend-luminosity">
          <source src="/dna-bg-video.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px]"></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Riwayat Analisis</h1>
            <p className="text-sm text-slate-600 mt-1">
              Analisis milik akun <strong>{getUserName()}</strong>
              {userProfile?.email ? ` (${userProfile.email})` : ''}: pengaturan yang dipakai dan berkas hasilnya.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="px-4 py-2.5 bg-white/80 hover:bg-white text-slate-700 text-xs font-semibold rounded-xl border border-white shadow-sm transition">
              ← Beranda
            </Link>
            <Link href="/pipeline/step-1" className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-emerald-500 text-white text-xs font-bold rounded-xl shadow-md hover:opacity-95 transition">
              + Analisis Baru
            </Link>
            <button onClick={logout} className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold rounded-xl transition">
              Keluar
            </button>
          </div>
        </div>

        {/* Filter */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {([
            ['all', 'Semua'],
            ['done', 'Selesai'],
            ['busy', 'Berjalan / Menunggu'],
            ['failed', 'Gagal'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-full font-semibold border transition ${filter === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white/80 text-slate-600 border-slate-200 hover:border-blue-400'}`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-slate-500">{filtered.length} analisis</span>
        </div>

        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">{error}</div>}

        {loading && <div className="p-10 text-center text-sm text-slate-500 bg-white/70 rounded-3xl border border-white">Memuat riwayat analisis...</div>}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-10 text-center bg-white/70 backdrop-blur-xl rounded-3xl border border-white space-y-3">
            <p className="text-sm text-slate-600">{rows.length === 0 ? 'Belum ada analisis di akun ini.' : 'Tidak ada analisis dengan status tersebut.'}</p>
            {rows.length === 0 && (
              <Link href="/pipeline/step-1" className="inline-block px-5 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition">
                Mulai analisis pertama
              </Link>
            )}
          </div>
        )}

        {/* Daftar analisis */}
        <div className="space-y-4">
          {filtered.map((row) => {
            const meta = statusMeta(row.status);
            const open = openId === row.id;
            const det = details[row.id];
            const cfg = det?.config;
            return (
              <div key={row.id} className="bg-white/70 border border-white/80 backdrop-blur-2xl rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.06)] overflow-hidden">
                <button onClick={() => toggle(row)} className="w-full text-left p-5 flex flex-wrap items-center gap-4 hover:bg-white/50 transition">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow">
                    #{row.id}
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-bold text-slate-800">
                      {row.trait || 'Analisis GWAS'}
                      {row.model && <span className="ml-2 text-xs font-semibold text-slate-500">· {row.model}</span>}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {row.datasetName ? `${row.datasetName} · ` : row.datasetId ? `Dataset #${row.datasetId} · ` : ''}
                      {fmtDate(row.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {isBusy(row.status) && row.percent !== null && <span className="text-[11px] font-mono text-blue-600">{row.percent}%</span>}
                    <span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${meta.cls}`}>{meta.label}</span>
                    <span className="text-slate-400 text-sm">{open ? '▲' : '▼'}</span>
                  </div>
                </button>

                {open && (
                  <div className="px-5 pb-6 pt-2 space-y-6 border-t border-white/60 animate-fadeIn">
                    {det?.loading && <p className="text-xs text-slate-500">Memuat pengaturan dan berkas...</p>}
                    {det?.error && <p className="text-xs text-rose-600">{det.error}</p>}

                    {cfg && (
                      <>
                        {/* Pengaturan */}
                        <div className="space-y-2">
                          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Pengaturan analisis</h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Setting label="Trait" value={cfg.trait_name ? `${cfg.trait_name}${cfg.trait_type ? ` (${cfg.trait_type === 'binary' ? 'biner' : 'kuantitatif'})` : ''}` : ''} />
                            <Setting label="Model" value={cfg.model} />
                            <Setting label="MAF" value={cfg.qc?.maf !== undefined ? `≥ ${cfg.qc.maf}` : ''} />
                            <Setting label="Call rate" value={cfg.qc?.call_rate !== undefined ? `≥ ${cfg.qc.call_rate}` : ''} />
                            <Setting label="HWE p-value" value={cfg.qc?.hwe_p !== undefined ? `≥ ${cfg.qc.hwe_p}` : ''} />
                            <Setting label="QC" value={cfg.qc ? (cfg.qc.skip_qc ? 'Dilewati' : 'Dijalankan') : ''} />
                            <Setting label="PCA" value={cfg.use_pca === undefined ? '' : cfg.use_pca ? `${cfg.pca_components ?? '-'} komponen` : 'Tidak dipakai'} />
                            <Setting label="Kovariat" value={Array.isArray(cfg.covariates) && cfg.covariates.length ? cfg.covariates.join(', ') : 'Tanpa kovariat tambahan'} />
                            <Setting label="Metode signifikansi" value={cfg.significance_method} />
                            <Setting label="Ambang p-value" value={cfg.significance_threshold != null ? String(cfg.significance_threshold) : 'Default metode'} />
                            <Setting label="Mode" value={cfg.execution_mode || cfg.analysis_mode} />
                            <Setting label="Tujuan" value={cfg.analysis_goal} />
                          </div>
                        </div>

                        {/* Berkas masukan */}
                        {det.files.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Berkas masukan</h3>
                            <div className="flex flex-wrap gap-2">
                              {det.files.map((f: any, i: number) => (
                                <span key={i} className="px-3 py-1.5 bg-white/80 border border-white rounded-lg text-[11px] text-slate-700 font-mono">
                                  {f.filename ?? f.slot} <span className="text-slate-400">· {f.kind === 'phenotype' ? 'fenotipe' : 'genotipe'}{typeof f.size_bytes === 'number' ? ` · ${fmtBytes(f.size_bytes)}` : ''}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Berkas keluaran */}
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Berkas keluaran</h3>
                      {!isDone(row.status) && (
                        <p className="text-[11px] text-amber-700">Sebagian berkas baru tersedia setelah analisis selesai.</p>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {OUTPUTS.map((o) => {
                          const k = `${row.id}:${o.key}`;
                          const st = dlState[k];
                          const disabled = (o.needsDone && !isDone(row.status)) || st === 'loading';
                          return (
                            <button
                              key={o.key}
                              disabled={disabled}
                              onClick={() => download(row, o)}
                              className="flex items-center justify-between gap-3 text-left p-3 bg-white/80 hover:bg-white border border-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <span>
                                <span className="block text-xs font-semibold text-slate-800">{o.label}</span>
                                <span className="block text-[10px] text-slate-500">{o.desc}</span>
                              </span>
                              <span className="text-xs font-bold">
                                {st === 'loading' ? '⏳' : st === 'ok' ? <span className="text-emerald-600">✓</span> : st === 'error' ? <span className="text-rose-600">✗</span> : <span className="text-blue-600">⬇</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Aksi */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {isDone(row.status) && (
                        <button onClick={() => openInPipeline(row, cfg)} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition">
                          Buka hasil & visualisasi
                        </button>
                      )}
                      {row.status === 'awaiting' && (
                        <button onClick={() => openInPipeline(row, cfg)} className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition">
                          Lanjutkan analisis
                        </button>
                      )}
                      {['failed', 'error'].includes(row.status) && row.message && (
                        <span className="text-xs text-rose-600 self-center">{row.message}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm flex items-start gap-3 p-4 rounded-2xl shadow-2xl border text-xs animate-fadeIn ${
            toast.type === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-rose-50 border-rose-300 text-rose-900'
          }`}
          role="status"
        >
          <span className="text-lg">{toast.type === 'success' ? '✅' : '⛔'}</span>
          <span className="flex-1 font-medium">{toast.message}</span>
          <button onClick={() => setToast(null)} className="font-bold opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  );
}
