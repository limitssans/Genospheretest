// Fungsi autentikasi & profil: login, register, lupa/reset kata sandi, /api/me
import { useEffect } from 'react';
import { usePipelineStore } from '@/store/usePipelineStore';
import { API_BASE, authHeaders, getToken, readError, redirectToLogin, clearSession } from '@/lib/api';

const json = { 'Content-Type': 'application/json' };

export interface MeProfile {
  fullName: string;
  username: string;
  email: string;
  institution: string;
  bio: string;
}

// Bentuk respons backend bisa berbeda penamaan; baca beberapa kemungkinan
export function normalizeUser(u: any): MeProfile {
  const user = u?.user ?? u ?? {};
  const email = String(user.email ?? '');
  return {
    fullName: String(user.full_name ?? user.fullName ?? user.name ?? ''),
    username: String(user.username ?? (email ? email.split('@')[0] : '')),
    email,
    institution: String(user.institution ?? user.institusi ?? ''),
    bio: String(user.bio ?? ''),
  };
}

export async function loginRequest(identifier: string, password: string): Promise<void> {
  const body = new URLSearchParams();
  body.append('username', identifier);
  body.append('password', password);
  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(await readError(res, 'Email atau kata sandi salah'));
  const data = await res.json();
  const token = data.access_token ?? data.token;
  if (!token) throw new Error('Server tidak mengembalikan token login.');
  localStorage.setItem('token', token);
}

export async function registerRequest(input: {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/register`, {
    method: 'POST',
    headers: json,
    // full_name & name dikirim keduanya agar cocok dengan skema backend mana pun (field ekstra diabaikan)
    body: JSON.stringify({
      full_name: input.fullName,
      name: input.fullName,
      email: input.email,
      password: input.password,
      confirm_password: input.confirmPassword,
    }),
  });
  if (!res.ok) throw new Error(await readError(res, 'Pendaftaran gagal'));
}

export async function fetchMe(): Promise<MeProfile> {
  const res = await fetch(`${API_BASE}/api/me`, { headers: authHeaders() });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('Sesi berakhir. Silakan masuk kembali.');
  }
  if (!res.ok) throw new Error(await readError(res, 'Gagal memuat profil'));
  return normalizeUser(await res.json());
}

export async function updateMe(patch: { fullName?: string; institution?: string; bio?: string }): Promise<MeProfile> {
  const body: Record<string, string> = {};
  if (patch.fullName !== undefined) { body.full_name = patch.fullName; body.name = patch.fullName; }
  if (patch.institution !== undefined) body.institution = patch.institution;
  if (patch.bio !== undefined) body.bio = patch.bio;
  const res = await fetch(`${API_BASE}/api/me`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('Sesi berakhir. Silakan masuk kembali.');
  }
  if (!res.ok) throw new Error(await readError(res, 'Gagal menyimpan profil'));
  return normalizeUser(await res.json());
}

// Selalu dianggap berhasil kecuali server/jaringan error (tidak membocorkan apakah email terdaftar)
export async function forgotPasswordRequest(email: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/forgot-password`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email }),
  });
  if (res.ok || res.status === 404) return;
  throw new Error(await readError(res, 'Gagal mengirim tautan pemulihan'));
}

export async function resetPasswordRequest(token: string, password: string, confirmPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/reset-password`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ token, password, new_password: password, confirm_password: confirmPassword }),
  });
  if (!res.ok) throw new Error(await readError(res, 'Tautan pemulihan tidak valid atau sudah kedaluwarsa'));
}

export function logout(): void {
  clearSession();
  window.location.href = '/login';
}

// Pasang di halaman yang butuh login: cek token, muat profil asli ke store.
export function useAuthProfile(): void {
  const updateUserProfile = usePipelineStore((s) => s.updateUserProfile);
  useEffect(() => {
    if (!getToken()) {
      redirectToLogin();
      return;
    }
    fetchMe()
      .then((p) => updateUserProfile(p))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
