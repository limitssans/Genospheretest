// Alamat backend FastAPI (laptop teman). Ubah di sini saja jika IP berganti,
// atau set NEXT_PUBLIC_API_URL di .env.local (tanpa /api di belakang).
export const API_BASE: string = (
  process.env.NEXT_PUBLIC_API_URL || 'http://10.161.68.97:8000'
).replace(/\/+$/, '');
