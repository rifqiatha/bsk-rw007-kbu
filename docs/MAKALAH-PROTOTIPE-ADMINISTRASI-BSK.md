# Draf Makalah / Proposal Skripsi

## Perancangan Prototipe Panel Administrasi Badan Sosial Kifayah pada Kelurahan Kota Bambu Utara

**Catatan akademik:** dokumen ini adalah draf awal untuk tugas Sistem Basis Data. Nama, angka, dan transaksi di prototipe adalah data simulasi; sesuaikan metodologi, institusi, dan hasil pengujian dengan kondisi penelitian yang sebenarnya sebelum diajukan sebagai skripsi.

## Abstrak

Administrasi Badan Sosial Kifayah (BSK) memerlukan pengelolaan warga, keanggotaan, iuran, donasi, pengeluaran, pelayanan kematian, dan dokumen bukti transaksi yang konsisten. Penelitian/perancangan ini mengusulkan prototipe panel administrasi BSK untuk skala Kelurahan Kota Bambu Utara. Metode yang digunakan adalah analisis kebutuhan, pemodelan konseptual menggunakan Entity Relationship Diagram (ERD), transformasi ke Logical Record Structure (LRS), normalisasi hingga bentuk normal ketiga, serta validasi antarmuka melalui prototipe terisolasi. Rancangan memisahkan pembayaran sebagai entitas induk dengan detail iuran dan donasi, sehingga penerbitan kwitansi memiliki satu sumber transaksi yang dapat diaudit. Hak akses dirancang menggunakan role-based access control dan cakupan wilayah RW/RT. Hasil tahap ini berupa prototipe admin lokal, ERD, LRS, aturan bisnis, serta skenario uji; belum mengubah sistem produksi.

**Kata kunci:** basis data relasional, BSK, ERD, LRS, normalisasi, RBAC, kwitansi digital.

## BAB I — Pendahuluan

### 1.1 Latar belakang

Pencatatan program sosial berbasis warga mencakup data yang saling terkait: wilayah, keluarga, anggota, transaksi iuran, dana sukarela, biaya operasional, dan pelayanan saat anggota meninggal. Penyimpanan data dalam satu tabel atau dokumen terpisah berisiko menimbulkan redundansi, data ganda, dan kesulitan audit. Normalisasi relasional bertujuan mengurangi redundansi serta anomali pembaruan; penelitian terbaru juga menunjukkan bahwa redundansi pada skema kurang ternormalisasi dapat menimbulkan beban volume data, meski desain tetap perlu mempertimbangkan pola akses dan pelaporan [1].

Selain integritas data, aplikasi menangani identitas warga sehingga kebutuhan kerahasiaan, pembatasan peran, dan jejak perubahan menjadi penting. Model Role-Based Access Control (RBAC) menyediakan dasar untuk memisahkan hak berdasarkan jabatan/role, bukan pemberian izin satu per satu kepada setiap pengguna [2].

### 1.2 Rumusan masalah

1. Bagaimana merancang struktur data BSK yang menghubungkan wilayah, warga, keanggotaan, iuran, donasi, pengeluaran, dan pelayanan kematian?
2. Bagaimana membangun rancangan sampai 3NF dan menghindari sumber transaksi kwitansi yang ambigu?
3. Bagaimana memvalidasi antarmuka admin tanpa mengubah aplikasi produksi?

### 1.3 Tujuan

Menghasilkan ERD, LRS, aturan bisnis, draf kontrol akses, dan prototipe admin mandiri yang dapat dinilai sebelum implementasi pada aplikasi utama.

### 1.4 Batasan

Prototipe hanya meliputi panel admin dan memakai data contoh pada browser. Halaman publik, autentikasi produksi, migrasi database, pengiriman pesan, dan integrasi pembayaran belum diubah dalam tahap ini.

## BAB II — Tinjauan pustaka

ERD digunakan untuk mengabstraksikan entitas, atribut, dan kardinalitas sebelum skema fisik dibangun. Proses normalisasi membantu pembentukan skema yang mengurangi nilai redundan dan anomali; namun, rancangan yang baik juga memperhatikan kebutuhan query agar struktur tidak hanya benar secara teoritis tetapi dapat digunakan secara efektif [1], [3]. Penelitian mengenai kesalahan query pengguna akhir memperlihatkan bahwa tingkat normalisasi dan kompleksitas query memengaruhi kemungkinan kesalahan, sehingga aplikasi ini memisahkan skema pembaruan 3NF dari keluaran laporan yang mudah dibaca [4].

Untuk keamanan, pemisahan peran dan pembatasan akses wilayah diterapkan sebagai RBAC. Kebijakan ini harus ditegakkan pada server, sebab penyembunyian elemen antarmuka tidak sama dengan kontrol akses. Pencatatan metadata dan audit juga membantu penilaian kualitas serta ketertelusuran data [5].

## BAB III — Metode perancangan

1. **Observasi dan elisitasi aturan bisnis:** mengidentifikasi alur warga/KK, iuran, setoran RT, verifikasi bendahara, donasi, pengeluaran, dan layanan kematian.
2. **Pemodelan konseptual:** mendefinisikan entitas, atribut, kandidat key, serta kardinalitas pada ERD.
3. **Perancangan logis:** mentransformasikan ERD ke LRS dan menetapkan PK, FK, uniqueness, serta nullable field.
4. **Normalisasi:** menguji 1NF, 2NF, dan 3NF; data layanan yang berulang dipisah sebagai detail, sedangkan pembayaran dipecah menjadi supertype dan subtype.
5. **Pembuatan prototipe:** membangun UI admin dalam proses lokal terpisah (`localhost:8010`) dengan data in-memory.
6. **Pengujian skenario:** menguji alur tambah anggota, catat iuran, donasi, pengeluaran, layanan kematian, pratinjau kwitansi, dan pembatasan tombol berdasarkan peran simulasi.

## BAB IV — Hasil rancangan

### 4.1 Arsitektur prototipe

Prototipe berada di folder `prototype-admin/` dan dijalankan oleh `prototype-admin-server.py`. Server mengikat `127.0.0.1:8010`, sehingga tidak berbagi port, API, sesi, atau basis data dengan aplikasi utama yang berjalan pada port 8000. Data berada dalam JavaScript dan direset ketika halaman disegarkan.

### 4.2 Rancangan data

ERD dan LRS lengkap tersedia pada [ERD-LRS-PROTOTIPE-BSK.md](ERD-LRS-PROTOTIPE-BSK.md). Perbaikan utama terhadap rancangan awal adalah penggunaan `PAYMENT` sebagai induk bagi `PEMBAYARAN_IURAN` dan `DONASI`. `KWITANSI` hanya merujuk ke `PAYMENT`, sehingga tidak ada kondisi satu baris kwitansi menunjuk dua transaksi berbeda.

### 4.3 Antarmuka prototipe

Panel terdiri dari Ringkasan, Anggota BSK, Iuran & Setoran, Donasi, Pengeluaran, Layanan Kematian, Laporan & Kwitansi, serta Model Data. Setiap modul dapat menampilkan formulir contoh. Aksi kwitansi membuka pratinjau sebelum memanggil dialog cetak browser/PDF.

### 4.4 Rencana pengujian penerimaan

| ID | Skenario | Hasil yang diharapkan |
|---|---|---|
| UAT-01 | Tambah anggota contoh | Baris anggota baru muncul dengan status `Pending` |
| UAT-02 | Catat iuran | Transaksi tampil dengan status `Diverifikasi RT` |
| UAT-03 | Buka pratinjau kwitansi | Nomor, pihak pembayar, tanggal, dan nominal konsisten |
| UAT-04 | Ganti peran menjadi LMK | Tombol tambah disembunyikan; data tetap dapat dibaca |
| UAT-05 | Tutup dialog dengan Esc/X/Batal | Dialog tertutup tanpa mengubah data contoh |

## BAB V — Kesimpulan dan saran

Rancangan menghasilkan batas data yang lebih jelas antara kependudukan, partisipasi BSK, penerimaan, pengeluaran, layanan, dan dokumen bukti. Model `PAYMENT`–subtype–`KWITANSI` meningkatkan ketertelusuran transaksi. Tahap berikutnya, setelah prototipe disetujui, adalah membuat migrasi skema, endpoint yang berizin, uji integritas, pengujian beban, dan audit keamanan sebelum diintegrasikan ke port utama.

## Daftar pustaka

[1] Fotache, M., Cluci, M.-I., Taipalus, T., & Talaba, G. (2026). *The effects of database normalization on decision support system performance*. Information Systems, 136, 102636. https://doi.org/10.1016/j.is.2025.102636

[2] Sandhu, R. S., Coyne, E. J., Feinstein, H. L., & Youman, C. E. (1996). *Role-based access control models*. IEEE Computer, 29(2), 38–47. https://doi.org/10.1109/2.485845

[3] Link, S., & others. (2018). *SQL schema design: foundations, normal forms, and normalization*. Information Systems, 76, 88–113. https://doi.org/10.1016/j.is.2018.04.001

[4] Borthick, A. F., Bowen, P. L., Liew, S. T., & Rohde, F. H. (2001). *The effects of normalization on end-user query errors: An experimental evaluation*. International Journal of Accounting Information Systems, 2(4), 195–221. https://doi.org/10.1016/S1467-0895(01)00023-9

[5] Azeroual, O., Saake, G., & Schallehn, E. (2018). *Analyzing data quality issues in research information systems via data profiling*. International Journal of Information Management, 41, 50–56. https://doi.org/10.1016/j.ijinfomgt.2018.02.007

Referensi [1]–[5] adalah jurnal/publikasi internasional yang relevan sebagai landasan desain; sitasi perlu disesuaikan dengan gaya kampus (misalnya APA 7th) pada naskah akhir.
