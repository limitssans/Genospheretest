// Pemeriksaan berkas di sisi browser SEBELUM diunggah: ukuran maksimum & format header.
// Batas mengikuti resource_limits dari backend (per_file_limit_bytes = 2 GiB;
// total per dataset = 6 GiB).

export const MAX_FILE_BYTES = 2 * 1024 ** 3;
export const MAX_DATASET_BYTES = 6 * 1024 ** 3;

export const fmtBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

export interface FileCheck {
  errors: string[]; // merah: harus diperbaiki, memblokir proses
  warnings: string[]; // kuning: boleh lanjut, tetapi sebaiknya dicek
}

const empty = (): FileCheck => ({ errors: [], warnings: [] });

// Pesan error bila satu berkas melebihi batas
export function sizeError(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `"${file.name}" berukuran ${fmtBytes(file.size)}, melebihi batas maksimum ${fmtBytes(MAX_FILE_BYTES)} per berkas.`;
  }
  return null;
}

export function totalSizeError(files: File[]): string | null {
  const total = files.reduce((a, f) => a + f.size, 0);
  if (total > MAX_DATASET_BYTES) {
    return `Total ukuran berkas ${fmtBytes(total)} melebihi batas ${fmtBytes(MAX_DATASET_BYTES)} per dataset.`;
  }
  return null;
}

const readText = async (file: File, bytes: number): Promise<{ text: string; truncated: boolean }> => {
  const slice = file.slice(0, bytes);
  let text = await slice.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // buang BOM
  return { text, truncated: file.size > bytes };
};

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');

// ---------------- Fenotipe (.csv .tsv .txt .pheno) ----------------
export async function checkPhenotypeFile(file: File): Promise<FileCheck> {
  const res = empty();
  try {
    const { text, truncated } = await readText(file, 256 * 1024);
    let lines = text.split(/\r?\n/);
    if (truncated) lines = lines.slice(0, -1); // baris terakhir mungkin terpotong
    lines = lines.filter((l) => l.trim() !== '');

    if (lines.length === 0) {
      res.errors.push('Berkas fenotipe kosong.');
      return res;
    }

    const header = lines[0];
    const count = (ch: string) => header.split(ch).length - 1;
    const candidates: Array<[string, number]> = [['\t', count('\t')], [',', count(',')], [';', count(';')]];
    candidates.sort((a, b) => b[1] - a[1]);
    let splitter: string | RegExp;
    if (candidates[0][1] > 0) splitter = candidates[0][0];
    else if (/\s/.test(header.trim())) splitter = /\s+/;
    else splitter = '\t';

    const cols = header.split(splitter).map(unquote);

    if (cols.length < 2) {
      res.errors.push(
        'Header hanya terdiri dari 1 kolom. Pisahkan kolom dengan tab atau koma, dan sertakan minimal kolom ID sampel dan satu kolom trait.'
      );
      return res;
    }

    const emptyAt = cols.findIndex((c) => c === '');
    if (emptyAt !== -1) res.errors.push(`Header memiliki nama kolom kosong (kolom ke-${emptyAt + 1}).`);

    const seen = new Set<string>();
    const dups = new Set<string>();
    cols.forEach((c) => {
      const k = c.toLowerCase();
      if (c && seen.has(k)) dups.add(c);
      seen.add(k);
    });
    if (dups.size) res.errors.push(`Nama kolom ganda di header: ${Array.from(dups).join(', ')}.`);

    const numericCols = cols.filter((c) => c !== '' && Number.isFinite(Number(c))).length;
    if (numericCols >= Math.ceil(cols.length / 2)) {
      res.errors.push(
        'Baris pertama tampak seperti data (berisi angka), bukan header. Tambahkan baris header berisi nama kolom (mis. sample_id, Trait_1, ...).'
      );
    }

    // Jumlah kolom tiap baris data harus sama dengan header
    for (let i = 1; i < Math.min(lines.length, 300); i++) {
      const n = lines[i].split(splitter).length;
      if (n !== cols.length) {
        res.errors.push(`Baris ke-${i + 1} memiliki ${n} kolom, sedangkan header memiliki ${cols.length} kolom.`);
        break;
      }
    }

    if (lines.length < 2 && !truncated) res.errors.push('Berkas hanya berisi header, tidak ada baris data sampel.');

    if (!/^(sample[_ .-]?id|iid|fid|id|sample|samples|ind|individual|taxa|accession)$/i.test(cols[0])) {
      res.warnings.push(
        `Kolom pertama bernama "${cols[0]}". Pastikan kolom ini berisi ID sampel yang sama dengan berkas genotipe (mis. sample_id atau IID).`
      );
    }
    const spaced = cols.filter((c) => /\s/.test(c));
    if (spaced.length) {
      res.warnings.push(`Nama kolom mengandung spasi: ${spaced.join(', ')}. Disarankan memakai underscore (_).`);
    }
  } catch {
    res.warnings.push('Header berkas tidak dapat dibaca di browser; pemeriksaan format dilakukan oleh server.');
  }
  return res;
}

// ---------------- Genotipe (.bed .bim .fam .vcf .vcf.gz) ----------------
export async function checkGenotypeFile(file: File): Promise<FileCheck> {
  const res = empty();
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.bed')) {
      const b = new Uint8Array(await file.slice(0, 3).arrayBuffer());
      if (b.length < 3) {
        res.errors.push('Berkas .bed terlalu kecil / rusak.');
      } else if (b[0] !== 0x6c || b[1] !== 0x1b) {
        res.errors.push('Header berkas .bed tidak valid (bukan format biner PLINK). Pastikan berkas dibuat oleh PLINK.');
      } else if (b[2] !== 0x01) {
        res.errors.push('Berkas .bed berformat individual-major, belum didukung. Ekspor ulang dengan PLINK (SNP-major).');
      }
    } else if (name.endsWith('.bim') || name.endsWith('.fam')) {
      const { text, truncated } = await readText(file, 16 * 1024);
      let lines = text.split(/\r?\n/);
      if (truncated) lines = lines.slice(0, -1);
      lines = lines.filter((l) => l.trim() !== '').slice(0, 10);
      if (lines.length === 0) res.errors.push(`Berkas ${name.slice(-4)} kosong.`);
      for (let i = 0; i < lines.length; i++) {
        const n = lines[i].trim().split(/\s+/).length;
        if (n !== 6) {
          res.errors.push(
            `Baris ke-${i + 1} memiliki ${n} kolom. Format ${name.slice(-4)} standar PLINK memiliki 6 kolom dipisah spasi/tab.`
          );
          break;
        }
      }
    } else if (name.endsWith('.vcf.gz')) {
      const b = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      if (b.length < 2 || b[0] !== 0x1f || b[1] !== 0x8b) {
        res.errors.push('Berkas .vcf.gz bukan arsip gzip yang valid. Kompres ulang dengan bgzip/gzip.');
      }
    } else if (name.endsWith('.vcf')) {
      const { text } = await readText(file, 1024 * 1024);
      const lines = text.split(/\r?\n/);
      if (!lines[0] || !lines[0].startsWith('##fileformat=VCF')) {
        res.errors.push('Header VCF tidak ditemukan. Baris pertama harus berupa ##fileformat=VCFv4.x.');
      } else {
        const chromLine = lines.find((l) => l.startsWith('#CHROM'));
        if (chromLine) {
          const f = chromLine.split('\t');
          const must = ['#CHROM', 'POS', 'ID', 'REF', 'ALT'];
          if (!must.every((m, i) => f[i] === m)) {
            res.errors.push('Baris header #CHROM tidak sesuai standar VCF (kolom wajib: #CHROM POS ID REF ALT QUAL FILTER INFO, dipisah tab).');
          } else if (f.length < 10) {
            res.warnings.push('VCF tidak memiliki kolom sampel (genotipe) setelah kolom FORMAT.');
          }
        }
      }
    }
  } catch {
    res.warnings.push('Header berkas tidak dapat dibaca di browser; pemeriksaan format dilakukan oleh server.');
  }
  return res;
}
