// Helper bersama untuk memanggil backend GenoSphere-GWAS.
import { API_BASE } from '@/lib/config';

export { API_BASE };

export const getToken = (): string =>
  (typeof window === 'undefined'
    ? ''
    : localStorage.getItem('token') ||
      localStorage.getItem('access_token') ||
      localStorage.getItem('access-token') ||
      '') as string;

export const clearSession = (): void => {
  if (typeof window === 'undefined') return;
  ['token', 'access_token', 'access-token', 'dataset_id', 'analysis_id'].forEach((k) => localStorage.removeItem(k));
};

// Token kedaluwarsa / tidak valid -> bersihkan sesi lalu arahkan ke halaman login
export const redirectToLogin = (): void => {
  if (typeof window === 'undefined') return;
  clearSession();
  if (!window.location.pathname.startsWith('/login')) window.location.href = '/login?expired=1';
};

export const authHeaders = (json = false): Record<string, string> => {
  const h: Record<string, string> = {};
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

const cleanId = (v: string | null): string | null =>
  v && v !== 'undefined' && v !== 'null' ? v : null;

export const getDatasetId = (): string | null =>
  typeof window === 'undefined' ? null : cleanId(localStorage.getItem('dataset_id'));

export const getAnalysisId = (): string | null =>
  typeof window === 'undefined' ? null : cleanId(localStorage.getItem('analysis_id'));

// Ambil pesan error yang enak dibaca dari respons backend (format FastAPI / custom)
export async function readError(res: Response, fallback: string): Promise<string> {
  const body: any = await res.clone().json().catch(() => null);
  if (!body) return `${fallback} (status ${res.status})`;
  const d = body.detail ?? body;
  const errs = d?.errors ?? body.errors;
  if (Array.isArray(errs) && errs.length) {
    return errs
      .map((e: any) => [e.field, e.message].filter(Boolean).join(': ') + (e.hint ? ` (${e.hint})` : ''))
      .join(' | ');
  }
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x: any) => x?.msg || JSON.stringify(x)).join(' | ');
  if (d?.message) return d.message;
  if (body.message) return body.message;
  return `${fallback} (status ${res.status})`;
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (res.status === 401) redirectToLogin();
  if (!res.ok) throw new Error(await readError(res, `Gagal memuat ${path}`));
  return res.json();
}

// ---------- Trait & model (GET /api/gwas/datasets/{id}/traits) ----------
export interface TraitModel { value: string; label: string }
export interface TraitInfo {
  name: string;
  type: 'binary' | 'quantitative';
  nValid?: number;
  nMissing?: number;
  nCases?: number;
  nControls?: number;
  summary?: string;
  recommendedModel: string;
  models: TraitModel[];
}

export const normalizeTraitType = (t: any): 'binary' | 'quantitative' => {
  const s = String(t ?? '').toLowerCase();
  return s.includes('bin') || s.includes('case') ? 'binary' : 'quantitative';
};

export interface CovariateCandidate { name: string; kind: string; levels: string[] }

export async function fetchTraitsFull(
  datasetId: string | number
): Promise<{ traits: TraitInfo[]; covariateCandidates: CovariateCandidate[] }> {
  const d: any = await apiGet(`/api/gwas/datasets/${datasetId}/traits`);
  const list: any[] = Array.isArray(d) ? d : d?.traits ?? [];
  const traits = list.map((t) => {
    const type = normalizeTraitType(t.type ?? t.trait_type);
    const models: TraitModel[] = (t.models ?? []).map((m: any) =>
      typeof m === 'string' ? { value: m, label: m } : { value: m.value ?? m.name, label: m.label ?? m.value ?? m.name }
    );
    return {
      name: t.name,
      type,
      nValid: t.n_valid,
      nMissing: t.n_missing,
      nCases: t.n_cases,
      nControls: t.n_controls,
      summary: t.summary,
      recommendedModel:
        t.recommended_model ?? models.find((m: any) => m.recommended)?.value ?? models[0]?.value ?? (type === 'binary' ? 'logistic' : 'linear'),
      models,
    } as TraitInfo;
  });
  const covariateCandidates: CovariateCandidate[] = (d?.covariate_candidates ?? []).map((c: any) => ({
    name: c.name,
    kind: c.kind ?? 'numeric',
    levels: c.levels ?? [],
  }));
  return { traits, covariateCandidates };
}

export async function fetchTraits(datasetId: string | number): Promise<TraitInfo[]> {
  return (await fetchTraitsFull(datasetId)).traits;
}

// ---------- Varian hasil GWAS ----------
export interface Variant {
  snp: string;
  chr: string;
  pos: number;
  effectAllele: string;
  beta: number | null;
  se: number | null;
  pvalue: number | null;
  adjPvalue: number | null;
}

const num = (v: any): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
};

export function normalizeVariant(v: any): Variant {
  const chr = String(v.chr ?? v.chromosome ?? v.CHR ?? '');
  const pos = num(v.pos ?? v.position ?? v.bp ?? v.BP) ?? 0;
  return {
    snp: String(v.snp ?? v.rsid ?? v.variant_id ?? v.id ?? v.SNP ?? `${chr}:${pos}`),
    chr,
    pos,
    effectAllele: String(v.effect_allele ?? v.alt_allele ?? v.alt ?? v.a1 ?? v.A1 ?? '-'),
    beta: num(v.beta ?? v.effect_size ?? v.effect ?? v.BETA),
    se: num(v.se ?? v.std_error ?? v.standard_error ?? v.SE),
    pvalue: num(v.pvalue ?? v.p_value ?? v.p ?? v.P),
    adjPvalue: num(v.p_bonferroni ?? v.adj_pvalue ?? v.p_adj ?? v.p_fdr ?? v.fdr ?? v.adjusted_p),
  };
}

export function unwrapRows(d: any): any[] {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object') return [];
  for (const k of ['variants', 'rows', 'items', 'results', 'data', 'top', 'significant', 'points']) {
    if (Array.isArray(d[k])) return d[k];
  }
  return [];
}

export const fmtNum = (v: number | null | undefined, digits = 3): string =>
  v === null || v === undefined ? '-' : Math.abs(v) < 0.001 && v !== 0 ? v.toExponential(2) : String(+v.toFixed(digits));
export const fmtP = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : v.toExponential(2);
