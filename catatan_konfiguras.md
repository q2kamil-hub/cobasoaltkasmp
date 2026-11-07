Berikut adalah pembaruan lengkap untuk **`Catatan_Konfigurasi.md`** yang mencerminkan status akhir **Versi 1.4** dan peta jalan (roadmap) untuk versi-versi selanjutnya.

Silakan salin kode di bawah ini dan timpa isi file `Catatan_Konfigurasi.md` Anda.

```markdown
# 📘 Dokumentasi Proyek: SiapTKA — Latihan TKA

> **Status**: Versi 1.4 ✅ (Fondasi & Fitur Inti Selesai)
> **Terakhir diperbarui**: Setelah uji end-to-end Versi 1.4 sukses.
> **Tahap Selanjutnya**: Versi 1.5 (Manajemen Kelas & Guru)

---

## 1. Arsitektur & Stack

| Komponen | Teknologi |
|---|---|
| **Frontend** | HTML, CSS, Vanilla JS (hosting: GitHub Pages / Netlify) |
| **Backend** | Google Apps Script (GAS) — API JSONP |
| **Database** | Google Sheets (6 tab: Teachers, Activations, Classes, Students, Results, Packages) |
| **Penyimpanan Soal** | Google Drive (`*.xml`, dibaca `DriveApp` di `Code.gs`) |
| **Tipe Aplikasi** | PWA (standalone) dengan **Installation Gate** ketat |
| **Metode API** | JSONP (GET + callback) via lapisan `api.js` |
| **Session Guru** | `localStorage` (`siaptka_guru_session`) |
| **Session Admin** | `localStorage` (`siaptka_admin_token`) |

### Alur Peran
```
👑 Super Admin (token)  →  👩‍🏫 Guru (email+password)  →  🧑‍🎓 Murid (kode kelas + PIN)
     admin.html               guru.html                  murid.html
```

---

## 2. Daftar File Frontend (GitHub / Netlify)

| File | Fungsi | Status |
|---|---|---|
| `landing.html` | Halaman jualan publik (boleh dibuka di browser biasa) | ✅ |
| `index.html` | Gerbang peran + **PWA gate ketat** | ✅ |
| `guru.html` | Login/aktivasi guru, dashboard, buat kelas, laporan | ✅ |
| `murid.html` | Join via kode kelas + PIN, kerjakan soal, submit, pembahasan | ✅ |
| `admin.html` | Panel admin (token), kelola aktivasi & paket soal, reset aktif | ✅ |
| `api.js` | **Lapisan API terpusat** — satu-satunya file yang tahu GAS | ✅ |
| `laporan.js` | Grafik (Chart.js) + ekspor Excel/PDF untuk guru | ✅ |
| `head.js` | Injeksi terpusat favicon & meta tag (anti-duplikasi) | ✅ |
| `sw.js` | Service Worker (cache v6) | ✅ |
| `manifest.json` | Konfigurasi PWA (branding indigo/amber) | ✅ |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Ikon PWA | ✅ |
| `favicon-32.png`, `favicon-16.png` | Favicon | ✅ |

---

## 3. Daftar File Backend (Google Apps Script)

### `Code.gs` — Fitur Kunci
- **JSONP Routing**: `doGet(e)` dengan penanganan error (try-catch).
- **Database Init**: `initSheet()` (idempoten, buat 6 tab + header otomatis).
- **Guru**: Login (SHA-256 + salt), Aktivasi (kode 1 tahun), Pembuatan Kelas (validasi paket).
- **Murid**: Join (validasi PIN & kelas), Ambil Soal (acak deterministik), Submit (pencocokan & pembahasan).
- **Admin**: Generate Aktivasi, Daftar Guru, Kelola Paket (Create/Toggle/Delete), Statistik, Reset Aktif, Unduh Kode Unused.
- **Sinkronisasi Tipe Data**: Menggunakan `String(cls.tampil_pembahasan) === '1'` untuk mengatasi konversi angka/teks dari Google Sheets.

### Konfigurasi GAS
- **Deploy**: Web App → Execute as **Me**, Access **Anyone**.
- Selalu pilih **"New version"** saat mengubah `Code.gs`.
- Variabel kunci:
  ```javascript
  var SPREADSHEET_ID = '1G9qOfRcP0akLDJMPG5e-upT8uH0jcTiNRQrG8fA550I';
  var ADMIN_TOKEN    = 'TKA_Super_Rahasia_2026!';
  var GURU_MASA_AKTIF_HARI = 365;
  ```

---

## 4. Struktur Database (Google Spreadsheet)

| Tab | Kolom |
|---|---|
| `Teachers` | id, email, password_hash, salt, nama, sekolah, aktif_sampai, created_at |
| `Activations` | kode, dipakai_oleh, tanggal_pakai, status (`unused`/`used`) |
| `Classes` | id, teacher_id, nama_kelas, paket_id, kode_kelas, pin, durasi_menit, buka, tutup, acak, tampil_pembahasan, status, created_at |
| `Students` | id, class_id, nama, absen, waktu_masuk |
| `Results` | id, student_id, class_id, skor, jawaban_json, waktu_selesai, durasi_detik |
| `Packages` | id, nama_paket, file_xml, harga, aktif (`1`/`0`) |

**Catatan Penting**: Google Sheets sering mengubah input `1` menjadi angka (number) dan `0` menjadi boolean/angka. Backend selalu menggunakan `String(value)` sebelum membandingkan dengan `'1'`.

---

## 5. Format `soal.xml` (Google Drive)

Contoh: `/paket/matematika.xml` → **upload ke Google Drive** dengan nama `matematika.xml`, sharing **"Anyone with the link – Viewer"**.

```xml
<paket nama="Matematika Dasar" versi="1">
  <soal id="1" tipe="pg" skor="10">
    <pertanyaan>Hasil 12 × 15 adalah ...</pertanyaan>
    <pilihan>A. 170</pilihan>
    <pilihan>B. 180</pilihan>
    <pilihan>C. 190</pilihan>
    <pilihan>D. 200</pilihan>
    <jawaban>B</jawaban>
  </soal>
  <soal id="2" tipe="isian" skor="10">
    <pertanyaan>Hasil 7 × 8 adalah ...</pertanyaan>
    <jawaban>56</jawaban>
  </soal>
</paket>
```
**Aturan**: Pilihan wajib diawali huruf + titik (`"A. ..."`), jawaban PG = huruf, isian = teks, simpan UTF-8 tanpa BOM.

---

## 6. Keamanan yang Sudah Diterapkan

| Lapisan | Implementasi |
|---|---|
| **PWA Gate** | Form login/aktivasi hanya muncul jika `isStandalone === true` atau `pwa_installed === 'true'`. |
| **Password Hashing** | SHA-256 + salt unik per guru. |
| **Anti Brute-force** | `Utilities.sleep(800)` di `handleTeacherLogin`. |
| **Kunci Jawaban** | Tidak dikirim ke `murid.html`; pencocokan di server. |
| **Anti Submit Ganda** | Dicek di server berdasarkan `student_id` + `class_id`. |
| **Admin Token** | Semua endpoint admin divalidasi dengan token rahasia. |
| **Escape HTML** | `esc()` di semua output dinamis (anti-XSS). |
| **SW Cache** | Request ke GAS & CDN tidak di-cache. |

---

## 7. Roadmap Pengembangan (Versi Selanjutnya)

Karena Fondasi (Versi 1.4) sudah selesai, fokus beralih ke standar aplikasi SaaS (Software as a Service).

### 🚀 Prioritas 1: Manajemen Kelas & Guru (Rencana Versi 1.5)
- [ ] **Edit Kelas**: Guru dapat mengubah nama kelas, durasi, acak, dan tampil pembahasan selama belum ada murid yang submit.
- [ ] **Hapus Kelas (Soft Delete)**: Mengubah status kelas menjadi `deleted` agar hilang dari dashboard, tapi data nilai tetap aman di database.
- [ ] **Buka/Tutup Kelas Cepat**: Tombol di dashboard guru tanpa masuk ke detail.
- [ ] **Edit Profil Guru**: Form untuk mengganti Nama, Sekolah, dan Password.

### 🛡️ Prioritas 2: Validasi & Normalisasi Input (Rencana Versi 1.6)
- [ ] **Normalisasi Form**: `.trim()` dan standarisasi huruf (kapital nama, lowercase email) di semua input frontend & backend.
- [ ] **Validasi PIN/Kode Kelas**: Pastikan input murid hanya huruf/angka, tanpa spasi.
- [ ] **Validasi Form Kelas**: Durasi min 1 menit, max 180 menit.

### 👑 Prioritas 3: Penyempurnaan Admin (Rencana Versi 1.7)
- [ ] **Blokir/Nonaktifkan Guru**: Admin bisa menonaktifkan akun guru yang menyalahgunakan.
- [ ] **Grafik Pendapatan**: Statistik tren aktivasi kode per bulan.
- [ ] **Force Logout**: Mencabut sesi login guru dari jarak jauh.

### 🎨 Prioritas 4: UX & Fitur Murid (Rencana Versi 1.8)
- [ ] **Auto-save Jawaban**: Simpan jawaban di `localStorage` agar tidak hilang saat refresh.
- [ ] **Review Jawaban**: Tampilkan opsi jawaban murid yang salah (bukan hanya kunci).
- [ ] **Mode Gelap**: Toggle di topbar guru/murid.

### 🐛 Prioritas 5: Bug Fix & Utilitas
- [ ] **Backup Spreadsheet Otomatis**: Script GAS untuk backup mingguan.
- [ ] **Halaman 404 Custom**: Tampilan error yang ramah pengguna.

---

## 8. File yang Perlu Dilampirkan Saat Pindah ke Chat Baru

Untuk melanjutkan ke Versi 1.5, lampirkan file berikut ke chat baru:
1. **`Code.gs`** (Backend lengkap versi 1.4).
2. **`api.js`** (Lapisan API lengkap versi 1.4).
3. **`guru.html`** (Frontend guru yang akan diedit untuk fitur Manajemen Kelas).
4. **File ini (`Catatan_Konfigurasi.md`)**.

*(File lain tidak perlu dilampirkan kecuali ada error spesifik di file tersebut).*
```
