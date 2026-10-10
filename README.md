# Data Kifayah

Website pemantau data-data kematian di RW 007 Kelurahan Bambu Utara.

Website sederhana untuk melihat daftar warga yang telah berpulang dan mengelola entri bersama melalui satu server.

## Arah perancangan UCD

Rancangan mengikuti User-Centered Design berdasarkan wawancara warga RT 005 dan RT 011, Admin/Ketua Program BSK, serta Ketua RW 007. Temuan yang menjadi acuan meliputi sulitnya memeriksa status iuran, risiko kartu fisik hilang, informasi WA yang tertumpuk, pencatatan Excel, validasi melalui RT/admin, kebutuhan monitoring peserta/keuangan/kematian, serta perlindungan NIK dan NKK. Antarmuka ditujukan untuk ponsel Android dengan teks dan tombol yang jelas, serta dukungan pengurus/keluarga bagi warga yang memerlukannya.

Pain point utama: status pembayaran sulit diperiksa mandiri; bukti masih bergantung pada kartu; informasi program mudah terlewat; validasi dan pembaruan data dilakukan manual; data peserta, keuangan, dan kematian belum terpusat; kemampuan digital warga beragam.

Website menyediakan arsip data kematian serta dashboard Warga dan Pengelola yang terpisah. Warga membuka **Masuk** di kanan atas, lalu memilih daftar akun; username dibuat dari nama (nama yang sama mendapat akhiran angka) dan warga memilih password sendiri. Dashboard warga memuat **Pembayaran Iuran** (periode, nominal, metode/tanggal, dan bukti JPG/PNG/WebP/PDF maksimal 5 MB), **Informasi Program**, **Data Kematian**, dan **Data Keuangan**. Admin dapat memverifikasi pembayaran, memperbarui informasi program, dan mencatat pemasukan/pengeluaran yang dibagikan kepada warga. Catatan keuangan bersifat ringkasan publik bagi akun warga; jangan masukkan data pribadi atau nomor rekening. Besaran iuran mengikuti ketentuan BSK dan diisi warga; aplikasi tidak menentukan nominal.

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

Pada instalasi yang belum memiliki akun, login awal adalah username `admin` dan kata sandi `admin`. Akun pengguna baru dibuat dengan kata sandi awal `user` dan wajib menggantinya saat login pertama. Kata sandi baru tidak memiliki batas minimum karakter, tetapi tidak boleh kosong. Buka ikon perisai atau `/admin` untuk masuk. Perubahan tersimpan pada `kifayah.sqlite3` dan muncul pada pengunjung lain dalam paling lama 15 detik.

Super Admin dapat menambah pengguna lewat tombol **Tambah Pengguna**, menyimpan nama depan/belakang, kontak, foto opsional, dan memilih **Level**. Aksi **Edit** membuka form yang sama untuk memperbarui profil. Dari tabel **Akun & Jabatan**, Super Admin juga dapat mengubah level/status, mereset sandi, atau menghapus akun. Akun yang sedang digunakan tidak dapat dihapus dan Super Admin aktif terakhir tidak dapat diturunkan/nonaktifkan. Admin dan Super Admin dapat menulis, mengedit, serta menghapus berita melalui tab **Berita**; artikel manual dapat memuat foto, tampil sebagai berita unggulan dan carousel arsip yang dapat dibuka untuk membaca isi lengkap. Semua berita lama tetap dapat dijelajahi. Staff tidak memiliki akses mengelola berita. Admin dapat mengelola data warga, detail privat, keluarga, dan impor; Staff dapat melihat data dasar dan menambahkan entri, tetapi tidak dapat melihat detail privat, mengedit/menghapus, atau mempublikasikan alamat. Hanya Super Admin yang dapat mengelola pengguna, mengubah pengaturan wilayah/tampilan, dan mengunduh ekspor XLSX.

Alamat disimpan untuk pengelola dan tidak ditampilkan kepada publik kecuali opsi berbagi alamat dipilih. Tautan Google Maps dan Apple Maps hanya muncul untuk alamat yang dipublikasikan. NIK, nomor kartu keluarga, tanggal/tempat lahir, agama, dan data keluarga diisi melalui bagian detail privat admin; jangan menyalinnya ke kolom publik.

Pilihan jenis kelamin tersedia sebagai dropdown P (Perempuan) dan L (Laki-laki), dan ditampilkan pada daftar publik. Kartu statistik Laki-Laki/Perempuan dapat diklik untuk memfilter daftar. Pilihan RT dan RW tersedia sebagai dropdown dan ditampilkan dengan tiga digit, misalnya `RT 001 / RW 002`. Jumlah awalnya 1 RT dan 7 RW, mengikuti contoh data; pengelola dapat mengubah kedua jumlah tersebut dari panel admin. Data warga yang sudah tersimpan tidak dihapus saat jumlah pilihan diubah. Mode malam/terang tersimpan di browser dan konsisten di beranda serta panel admin.

Untuk mengubah record yang sudah ada, buka tab **Data Warga**, tekan **Edit** pada entri, ubah field yang diperlukan, lalu pilih **Simpan Perubahan**. Form ini juga mengubah detail identitas privat tanpa menghapus relasi keluarga yang sudah tersimpan.

Admin dapat menyimpan nomor kartu keluarga, NIK, tempat/tanggal lahir, agama, dan hubungan keluarga pada tiap entri. Informasi tersebut hanya dikirim melalui endpoint admin dan tidak disertakan di daftar publik. Foto almarhum/almarhumah bersifat privat sampai admin mencentang izin tampil publik. Ikon situs, gambar utama, foto profil, dan foto warga menerima PNG, JPEG, atau WebP hingga 5 MB. Foto berita tidak memiliki batas ukuran yang ditetapkan aplikasi dan diunggah secara streaming; ukuran praktis tetap bergantung pada kapasitas disk, hosting, dan koneksi. PNG/WebP dapat menyimpan transparansi; JPEG selalu opak, dan latar putih yang sudah menyatu di dalam gambar tidak otomatis menjadi transparan.

Admin dapat memilih tujuan impor **Daftar Warga - Wafat** atau **Daftar Warga - Iuran** pada menu **Impor Data**. Masing-masing tujuan memiliki template XLSX sendiri; template iuran memuat data profil warga, **Disetorkan Kepada**, dan kolom setoran opsional. Untuk mengimpor setoran, isi **Bulan Iuran**, **Tanggal Pembayaran**, dan **Nominal Setoran** bersama-sama. XLSX, XLS, CSV, DOCX, PDF, PNG, JPG, dan WebP didukung; PDF dan gambar diproses OCR secara lokal. Periksa pratinjau bila perlu, lalu tekan **Salin Semua Langsung** untuk menyalin seluruh isi file tanpa centang manual. Impor tidak membatasi jumlah file, jumlah baris, atau panjang isi kolom: teks yang melebihi batas kolom dipotong, dan RT/RW di luar rentang pengaturan tetap disimpan serta dicatat di **Tinjauan Data**. Hanya baris tanpa nama yang tidak dapat disimpan. Judul kolom dibaca sebagian, jadi varias seperti "Nama Warga (Lengkap)" tetap dikenali; bila file sama sekali tidak punya kolom nama, sistem menebak kolom yang paling mungkin berisi nama dan memberi catatan di pratinjau. Foto warga tidak diimpor dari template iuran dan dapat diunggah lewat **Edit Data Warga**. Data alamat tetap privat; informasi KK/NIK/keluarga hanya disimpan untuk pengelola. Batas impor satu file 60 MB. Simpan nomor KK/NIK sebagai teks di Excel agar digitnya tidak dibulatkan Excel.

Berkas dikirim ke server **satu per satu**, bukan sekaligus, lalu digabung di peramban. Ini mencegah permintaan besar yang mudah ditolak reverse proxy, sekaligus memastikan satu berkas bermasalah tidak membatalkan berkas lain. Kegagalan tiap berkas dicatat sebagai entri di panel **Rincian file dan catatan**, lengkap dengan nama errornya; nama error asli (misalnya `BadZipFile`) ikut ditampilkan agar penyebabnya jelas. Pratinjau tidak pernah gagal total: bila tidak ada baris yang bisa disalin, panel rincian terbuka otomatis dan menjelaskan alasannya.

Impor berulang tidak menggandakan data. Kunci kecocokan memakai NIK lebih dulu, lalu nama + tanggal wafat + wilayah, dan nama + wilayah hanya dipakai bila tidak ada keduanya. Pada mode **Lewati duplikat**, mengimpor file yang sama dua kali tidak menambah entri baru; mode **Replace / perbarui** memperbarui data lama tanpa menambah baris.

Nomor versi backend tampil pada bagian atas menu **Impor Data** (`Versi server: ...`). Nilai ini dikirim dari server lewat `/api/session` sehingga bisa dipastikan apakah server sudah menjalankan kode terbaru. Bila angkanya berbeda, jalankan `sh deploy/auto-update.sh` di server.

## Masuk

Semua akun masuk dari satu halaman, yaitu `/masuk`, yang bisa dibuka dari tombol **Masuk** di beranda. Akun **warga**, **staff**, **admin**, dan **super admin** dapat masuk dari sana; setelah berhasil, pengguna diarahkan otomatis ke halaman yang sesuai: warga ke dashboard warga, pengelola ke panel `/admin`. Tidak perlu lagi mengetik URL `/admin` secara manual. Akun warga yang kebetulan membuka `/admin` akan diarahkan balik ke dashboard-nya. Penegakan hak akses tetap dilakukan di server, bukan di peramban, sehingga pergantian halaman tidaknahmen loosened hak akses.

Menu **Kontak RT / RW** di panel pengelola menyimpan nomor kontak pengurus RT dan RW yang dapat diubah kapan saja. Setiap kontak memuat jenis wilayah (RT/RW), nomor wilayah, nama pengurus, jabatan, dan nomor telepon. Kontak berstatus aktif tampil pada section **Kontak** di halaman utama, yaitu menu navigasi ketiga setelah Beranda dan Berita, dengan tautan WhatsApp per wilayah. Section dan tautan navigasinya disembunyikan otomatis bila belum ada kontak aktif. Ekspor PDF dan XLSX diurutkan berdasarkan wilayah, RT terkecil lebih dulu lalu RW, baru nama. Baris tanpa RT/RW tetap ditampilkan dan ditempatkan paling akhir. Saat dicetak, tabel dikelompokkan per wilayah pada semua jenis ekspor: setiap RT/RW dimulai pada halaman baru dengan penomoran yang kembali dari 1, dan sisa ruang halaman sebelumnya tidak dipakai wilayah lain. Kop BSK beserta nomor halaman tercetak di setiap halaman. Jabatan yang tidak diperlukan bisa disembunyikan lewat kotak centang **Jabatan Yang Dicetak**; kolomnya hilang dari PDF beserta label dan nama. Blok tanda tangan dicetak di akhir tiap wilayah, jadi setiap RT punya bloknya sendiri, mengikuti urutan BSK, Ketua RW, LMK, Ketua RT, dan YANG MEMBUAT. Tanda tangan Ketua RT bisa disimpan per wilayah lewat dropdown **Simpan Tanda Tangan Ketua RT Untuk**. Pilihan *Semua RT* memakai satu nama dan satu gambar untuk seluruh wilayah, sedangkan memilih RT tertentu menyimpan tanda tangan khusus wilayah itu saja. Urutan pembacaan nama: nama khusus RT, lalu data Kontak RT / RW, lalu nama umum sebagai cadangan. Placeholder `{unit}` pada label Ketua RT diganti nomor wilayah, mis. `KETUA RT {unit}` menjadi `KETUA RT 002`. Tempat, tanggal, label jabatan, dan nama penandatangan diatur dari panel admin pada menu **Kop Ekspor**, jadi mudah diubah bila ada pergantian. Blok ini muncul hanya bila minimal satu nama penandatangan diisi.  Kontak pengurus juga bisa dicari lewat kolom pencarian, dicetak lewat tombol **Pratinjau Cetak**, diunduh sebagai PDF, dan diekspor ke XLSX; ketiganya mengikuti filter pencarian yang sedang dipakai. Bagian **Struktur Jabatan** pada menu yang sama mengatur urutan jabatan, dari peringkat tertinggi ke terendah; urutan itu menentukan urutan tampil kontak dalam satu wilayah. Jabatan di luar daftar bisa dipilih melalui opsi **Jabatan Lainnya**, lalu nama jabatan ditulis pada kolom yang muncul di bawahnya. Hak akses **Kontak RT / RW** dapat diberikan kepada Admin atau Super Admin melalui tabel **Akun & Jabatan**.

Pada tab **Data warga**, admin dapat Mencetak roster dasar atau mengunduh XLSX dengan sheet Data Warga, Identitas Privat, dan Keluarga. File XLSX mencakup informasi privat; batasi akses dan simpan dengan aman.

Pilih **Logo pertama** atau **Logo kedua** pada dropdown admin, lalu unggah gambar untuk mengganti slot tersebut. Keduanya tampil berdampingan dengan pemisah `|`. Ikon transparan ditampilkan tanpa latar dan tanpa dipotong. Ukuran kedua logo dapat diatur terpisah dari 50% sampai 200%; masing-masing slider menampilkan pratinjau langsung dan punya tombol simpan sendiri.

Media slideshow (PNG, JPEG, WebP, MP4, WebM) tidak memiliki batas ukuran yang ditetapkan aplikasi dan diunggah secara streaming ke disk; ukuran praktis tetap bergantung pada kapasitas disk, hosting, dan koneksi. Validasi format isi berkas tetap dijalankan dari tanda tangan berkas, bukan dari nama ekstensi.

Di bagian **Logo Situs**, admin dapat memilih lokasi **Logo Pertama**, **Logo Kedua**, **Gambar Utama**, atau **Slideshow Foto dan Video**, lalu mengatur gambar untuk tema terang dan gelap pada lokasi tersebut. Unggah varian teks hitam untuk tema terang dan teks putih untuk tema gelap. Kontrol yang dipilih dibuka dalam popup pada tampilan mobile. Jika unggahan tema dihapus, situs memakai gambar standar untuk lokasi itu.

## Sebelum dibuka ke internet

Aplikasi ini cocok sebagai prototipe di jaringan lokal. Domain dapat dipakai, tetapi domain perlu diarahkan lewat DNS (record A/AAAA) ke server publik atau reverse proxy; nama domain tidak dapat membuat komputer lokal dapat dijangkau sendiri. Siapkan hosting/VPS yang selalu aktif, HTTPS/TLS melalui reverse proxy (misalnya Caddy atau Nginx), firewall yang hanya membuka port web, proses aplikasi yang otomatis berjalan ulang, dan penyimpanan persisten untuk `kifayah.sqlite3` serta folder `uploads/`. Jangan mengekspos server HTTP ini langsung ke internet. Pastikan juga autentikasi dan perlindungan operasional sesuai serta ada dasar dan persetujuan yang layak untuk membagikan nama maupun alamat. Buat cadangan database dan upload secara berkalaa.
