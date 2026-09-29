# bsk-rw007-kbu
Website pemantau data-data kematian di RW007 Kelurahan Bambu Utara

## Deskripsi

**Data Kifayah** adalah aplikasi website untuk mencatat dan mengenang warga yang telah berpulang di lingkungan Kota Bambu Utara. Pengunjung dapat melihat daftar warga dan berita lingkungan, mencari berdasarkan nama atau wilayah, mengurutkan daftar, serta memfilter data berdasarkan jenis kelamin.

Informasi sensitif—seperti alamat lengkap, identitas kependudukan, dan hubungan keluarga—dikelola melalui panel admin dan tidak ditampilkan ke publik secara otomatis. Alamat dan foto warga hanya dapat dilihat publik jika pengelola mengaktifkan izin tampil. Berita lingkungan dapat ditulis manual melalui panel admin, termasuk judul, headline, isi, penulis, waktu unggah, dan foto.

Data tersimpan di SQLite, sedangkan foto disimpan di folder upload. Aplikasi mendukung akses melalui jaringan lokal dan ZeroTier. Untuk akses publik dengan domain, aplikasi perlu ditempatkan di hosting/server yang mendukung aplikasi Python dan dikonfigurasi dengan DNS serta HTTPS.

## Alur Pengunjung

1. Pengunjung membuka halaman utama tanpa perlu login.
2. Pengunjung melihat berita terbaru dan daftar warga.
3. Pengunjung mencari atau mengurutkan daftar, atau memilih kartu **Laki-Laki**/**Perempuan** untuk memfilter data.
4. Pengunjung dapat membuka detail warga. Foto dan alamat hanya terlihat jika pengelola mengizinkan publikasinya.
5. Tautan peta tersedia hanya untuk alamat yang dipublikasikan.

## Alur Pengelola

1. Pengelola masuk melalui `/admin` menggunakan akun masing-masing.
2. Pada login pertama atau setelah sandi direset, pengelola diminta mengganti sandi.
3. Pengelola membuka tab sesuai hak aksesnya untuk mengelola data warga, berita, atau pengaturan.
4. Perubahan disimpan ke database dan ditampilkan sesuai aturan privasi.

## Level Akses

| Level | Akses |
|---|---|
| **Super Admin** | Mengelola semua fitur, akun dan jabatan, pengaturan wilayah dan tampilan, serta ekspor data. |
| **Admin** | Mengelola data warga, informasi privat dan keluarga, impor, serta berita. Tidak mengelola akun atau pengaturan global. |
| **Staff** | Melihat data dasar dan menambahkan entri. Tidak dapat mengakses detail privat, mengubah atau menghapus entri, maupun memublikasikan alamat. |
