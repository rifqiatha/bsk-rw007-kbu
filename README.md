# Data Kifayah

Website pemantau data-data kematian di RW 007 Kelurahan Bambu Utara.

Website sederhana untuk melihat daftar warga yang telah berpulang dan mengelola entri bersama melalui satu server.

## Peta Kode

- `web/index.html`: HEADER, COVER, ARSIP, FOOTER, dan panel PENGELOLA.
- `web/styles.css`: token tema, BERANDA, formulir admin, akun, aturan responsive, dan cetak.
- `web/app.js`: TEMA, rendering beranda, navigasi peran, akun, serta event formulir.
- `Kifayah.py`: DATABASE, autentikasi, HTTP routes, perubahan data, dan penghapusan.

## Menjalankan di Windows

Pastikan Python 3.10 atau lebih baru tersedia, pasang dependensi, lalu jalankan dari folder proyek:

```powershell
python -m pip install -r requirements.txt
python .\Kifayah.py
```

Buka http://localhost:8000. Untuk warga di jaringan Wi-Fi yang sama, bagikan alamat IP komputer server dengan port `8000` (contoh: `http://192.168.1.20:8000`). Firewall Windows mungkin perlu mengizinkan koneksi masuk. Server harus tetap berjalan agar daftar dapat dibuka dan diperbarui.

### Akses melalui ZeroTier

Server mendengarkan pada semua antarmuka jaringan, jadi tidak memerlukan perubahan kode untuk ZeroTier:

1. Pasang ZeroTier One pada komputer server dan ponsel, lalu gabungkan keduanya ke network ID privat yang sama.
2. Otorisasi kedua perangkat di ZeroTier Central dan pastikan masing-masing memperoleh Managed IP.
3. Izinkan koneksi masuk TCP port `8000` pada adapter ZeroTier di Windows Firewall.
4. Dari browser ponsel, buka `http://<Managed-IP-komputer>:8000`, misalnya `http://10.147.20.5:8000`.

Jangan membuat port forwarding router atau membagikan network ID ke orang yang tidak berwenang. Batasi anggota jaringan/aturan akses ZeroTier karena admin dan data warga tersedia bagi perangkat yang dapat mencapai server.

Pada instalasi yang belum memiliki akun, login awal adalah username `admin` dan kata sandi `admin`. Kata sandi ini wajib diganti menjadi minimal 8 karakter sebelum dashboard dapat digunakan. Buka ikon perisai atau `/admin` untuk masuk. Perubahan tersimpan pada `kifayah.sqlite3` dan muncul pada pengunjung lain dalam paling lama 15 detik.

Super Admin dapat menambah pengguna lewat tombol **Tambah Pengguna**, menyimpan nama depan/belakang, kontak, foto opsional, dan memilih **Level**. Aksi **Edit** membuka form yang sama untuk memperbarui profil. Dari tabel **Akun & Jabatan**, Super Admin juga dapat mengubah level/status, mereset sandi, atau menghapus akun. Akun yang sedang digunakan tidak dapat dihapus dan Super Admin aktif terakhir tidak dapat diturunkan/nonaktifkan. Admin dan Super Admin dapat menulis, mengedit, serta menghapus berita melalui tab **Berita**; artikel manual dapat memuat foto, tampil sebagai berita unggulan dan carousel arsip yang dapat dibuka untuk membaca isi lengkap. Semua berita lama tetap dapat dijelajahi. Staff tidak memiliki akses mengelola berita. Admin dapat mengelola data warga, detail privat, keluarga, dan impor; Staff dapat melihat data dasar dan menambahkan entri, tetapi tidak dapat melihat detail privat, mengedit/menghapus, atau mempublikasikan alamat. Hanya Super Admin yang dapat mengelola pengguna, mengubah pengaturan wilayah/tampilan, dan mengunduh ekspor XLSX.

Alamat disimpan untuk pengelola dan tidak ditampilkan kepada publik kecuali opsi berbagi alamat dipilih. Tautan Google Maps dan Apple Maps hanya muncul untuk alamat yang dipublikasikan. NIK, nomor kartu keluarga, tanggal/tempat lahir, agama, dan data keluarga diisi melalui bagian detail privat admin; jangan menyalinnya ke kolom publik.

Pilihan jenis kelamin tersedia sebagai dropdown P (Perempuan) dan L (Laki-laki), dan ditampilkan pada daftar publik. Kartu statistik Laki-Laki/Perempuan dapat diklik untuk memfilter daftar. Pilihan RT dan RW tersedia sebagai dropdown dan ditampilkan dengan tiga digit, misalnya `RT 001 / RW 002`. Jumlah awalnya 1 RT dan 7 RW, mengikuti contoh data; pengelola dapat mengubah kedua jumlah tersebut dari panel admin. Data warga yang sudah tersimpan tidak dihapus saat jumlah pilihan diubah. Mode malam/terang tersimpan di browser dan konsisten di beranda serta panel admin.

Untuk mengubah record yang sudah ada, buka tab **Data Warga**, tekan **Edit** pada entri, ubah field yang diperlukan, lalu pilih **Simpan Perubahan**. Form ini juga mengubah detail identitas privat tanpa menghapus relasi keluarga yang sudah tersimpan.

Admin dapat menyimpan nomor kartu keluarga, NIK, tempat/tanggal lahir, agama, dan hubungan keluarga pada tiap entri. Informasi tersebut hanya dikirim melalui endpoint admin dan tidak disertakan di daftar publik. Foto almarhum/almarhumah bersifat privat sampai admin mencentang izin tampil publik. Ikon situs, gambar utama, foto profil, dan foto warga menerima PNG, JPEG, atau WebP hingga 5 MB. Foto berita tidak memiliki batas ukuran yang ditetapkan aplikasi dan diunggah secara streaming; ukuran praktis tetap bergantung pada kapasitas disk, hosting, dan koneksi. PNG/WebP dapat menyimpan transparansi; JPEG selalu opak, dan latar putih yang sudah menyatu di dalam gambar tidak otomatis menjadi transparan.

Admin dapat mengimpor XLSX, XLS, CSV, DOCX, PDF, PNG, JPG, atau WebP dari bagian **Impor data dari file**. Unduh template XLSX untuk format yang paling akurat. PDF dan gambar diproses OCR secara lokal; selalu periksa dan koreksi pratinjau sebelum impor, termasuk jenis kelamin P/L yang mungkin terlalu kecil terbaca OCR. Baris tanpa nama, jenis kelamin, RT/RW, atau tanggal wafat yang valid tidak dapat disimpan. Data alamat tetap privat, dan informasi KK/NIK/keluarga hanya disimpan pada detail admin. Batas impor satu file 10 MB dan 500 baris. Simpan nomor KK/NIK sebagai teks di Excel agar digitnya tidak dibulatkan Excel.

Pada tab **Data warga**, admin dapat mencetak roster dasar atau mengunduh XLSX dengan sheet Data Warga, Identitas Privat, dan Keluarga. File XLSX mencakup informasi privat; batasi akses dan simpan dengan aman.

Pilih **Logo pertama** atau **Logo kedua** pada dropdown admin, lalu unggah gambar untuk mengganti slot tersebut. Keduanya tampil berdampingan dengan pemisah `|`. Ikon transparan ditampilkan tanpa latar dan tanpa dipotong. Ukuran kedua logo dapat diatur terpisah dari 50% sampai 200%; masing-masing slider menampilkan pratinjau langsung dan punya tombol simpan sendiri.

## Sebelum dibuka ke internet

Aplikasi ini cocok sebagai prototipe di jaringan lokal. Domain dapat dipakai, tetapi domain perlu diarahkan lewat DNS (record A/AAAA) ke server publik atau reverse proxy; nama domain tidak dapat membuat komputer lokal dapat dijangkau sendiri. Siapkan hosting/VPS yang selalu aktif, HTTPS/TLS melalui reverse proxy (misalnya Caddy atau Nginx), firewall yang hanya membuka port web, proses aplikasi yang otomatis berjalan ulang, dan penyimpanan persisten untuk `kifayah.sqlite3` serta folder `uploads/`. Jangan mengekspos server HTTP ini langsung ke internet. Pastikan juga autentikasi dan perlindungan operasional sesuai serta ada dasar dan persetujuan yang layak untuk membagikan nama maupun alamat. Buat cadangan database dan upload secara berkalaa.
