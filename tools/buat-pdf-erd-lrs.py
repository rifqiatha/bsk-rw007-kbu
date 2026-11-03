"""Membuat lampiran PDF ERD dan LRS prototipe BSK (bukan bagian UI aplikasi)."""
from pathlib import Path
import fitz

OUT = Path(__file__).resolve().parents[1] / "docs" / "ERD-LRS-PROTOTIPE-BSK.pdf"
doc = fitz.open()


def page(title, subtitle=""):
    p = doc.new_page(width=595, height=842)
    p.draw_rect((0, 0, 595, 842), color=None, fill=(0.97, 0.98, 0.97))
    p.draw_rect((36, 35, 559, 82), color=None, fill=(0.07, 0.31, 0.19))
    p.insert_text((52, 60), title, fontsize=17, fontname="hebo", color=(1, 1, 1))
    if subtitle:
        p.insert_text((52, 74), subtitle, fontsize=8.5, color=(0.85, 0.94, 0.87))
    return p


def text(p, rect, value, size=9, bold=False, color=(0.10, 0.13, 0.11)):
    return p.insert_textbox(fitz.Rect(rect), value, fontsize=size, fontname="hebo" if bold else "helv", color=color, lineheight=1.25)


def entity(p, x, y, name, attrs):
    w, h = 155, 26 + 12 * len(attrs)
    p.draw_rect((x, y, x + w, y + h), color=(0.10, 0.38, 0.24), width=0.8, fill=(1, 1, 1))
    p.draw_rect((x, y, x + w, y + 22), color=None, fill=(0.10, 0.38, 0.24))
    text(p, (x + 7, y + 6, x + w - 7, y + 22), name, 8.5, True, (1, 1, 1))
    text(p, (x + 7, y + 28, x + w - 7, y + h - 3), "\n".join(attrs), 7.4)
    return (x, y, x + w, y + h)


def line(p, a, b, label):
    p.draw_line((a[0], a[1]), (b[0], b[1]), color=(0.29, 0.40, 0.32), width=0.75)
    if label:
        text(p, ((a[0] + b[0]) / 2 - 38, (a[1] + b[1]) / 2 - 9, (a[0] + b[0]) / 2 + 38, (a[1] + b[1]) / 2 + 7), label, 6.5, True, (0.08, 0.31, 0.19))


p = page("ERD & LRS - PROTOTIPE BSK", "Lampiran rancangan basis data | Kelurahan Kota Bambu Utara | November 2026")
text(p, (46, 112, 548, 250), "Dokumen ini adalah lampiran desain untuk prototipe panel admin. Ia tidak merupakan bagian dari halaman aplikasi dan tidak mengubah database produksi. Rancangan membedakan wilayah, warga/KK, keanggotaan, iuran, penerimaan, pengeluaran, pelayanan kematian, serta otorisasi pengguna.", 12)
text(p, (46, 282, 548, 335), "Tujuan rancangan", 15, True, (0.08, 0.31, 0.19))
text(p, (46, 340, 548, 500), "1. Menjaga konsistensi data warga dan transaksi.\n2. Mencegah iuran ganda per anggota dan periode.\n3. Menjamin setiap kwitansi memiliki satu sumber pembayaran yang jelas.\n4. Membatasi akses menurut peran dan cakupan RW/RT.\n5. Menyediakan dasar untuk laporan kas yang dapat diaudit.", 11)
text(p, (46, 700, 548, 770), "Notasi: PK = Primary Key; FK = Foreign Key; UQ = nilai unik. Kardinalitas diterangkan pada label relasi. Detail atribut lengkap tersedia pada bagian LRS.", 8.5, False, (0.32, 0.39, 0.34))

p = page("ENTITY RELATIONSHIP DIAGRAM", "Model konseptual - bagian wilayah, warga, dan keanggotaan")
a = entity(p, 45, 110, "KELURAHAN", ["id_kelurahan (PK)", "nama (UQ)", "kecamatan, kota"])
b = entity(p, 220, 110, "WILAYAH_RW", ["id_rw (PK)", "id_kelurahan (FK)", "no_rw (UQ per kelurahan)"])
c = entity(p, 395, 110, "WILAYAH_RT", ["id_rt (PK)", "id_rw (FK)", "no_rt (UQ per RW)"])
d = entity(p, 45, 285, "KARTU_KELUARGA", ["id_kk (PK)", "nomor_kk (UQ)", "id_rt (FK), alamat"])
e = entity(p, 220, 285, "WARGA", ["id_warga (PK)", "id_kk (FK), nik (UQ)", "nama, status_warga"])
f = entity(p, 395, 285, "KEANGGOTAAN_BSK", ["id_anggota (PK)", "id_warga (FK), id_tarif (FK)", "tgl_daftar, status"])
g = entity(p, 220, 490, "TARIF_IURAN", ["id_tarif (PK)", "kategori_domisili, satuan", "nominal, periode berlaku"])
h = entity(p, 395, 490, "IURAN", ["id_iuran (PK)", "id_anggota (FK)", "periode, nominal, status"])
line(p, (a[2], (a[1]+a[3])/2), (b[0], (b[1]+b[3])/2), "1 : M")
line(p, (b[2], (b[1]+b[3])/2), (c[0], (c[1]+c[3])/2), "1 : M")
line(p, ((c[0]+c[2])/2, c[3]), ((d[0]+d[2])/2, d[1]), "1 : M")
line(p, (d[2], (d[1]+d[3])/2), (e[0], (e[1]+e[3])/2), "1 : M")
line(p, (e[2], (e[1]+e[3])/2), (f[0], (f[1]+f[3])/2), "1 : M riwayat")
line(p, ((g[0]+g[2])/2, g[1]), ((f[0]+f[2])/2, f[3]), "1 : M")
line(p, ((f[0]+f[2])/2, f[3]), ((h[0]+h[2])/2, h[1]), "1 : M")
text(p, (45, 705, 550, 770), "Aturan: satu anggota hanya boleh memiliki satu tagihan untuk satu periode [UQ(id_anggota, periode)]. Status warga meninggal disimpan sebagai status/riwayat, bukan dipindahkan ke tabel warga baru.", 8.5, False, (0.26, 0.35, 0.29))

p = page("ENTITY RELATIONSHIP DIAGRAM", "Model konseptual - penerimaan, layanan, pengeluaran, dan otorisasi")
a = entity(p, 45, 108, "PAYMENT", ["id_payment (PK)", "jenis, tgl_bayar, nominal", "id_penerima (FK USER)"])
b = entity(p, 220, 108, "PEMBAYARAN_IURAN", ["id_payment (PK/FK)", "id_iuran (FK, UQ)"])
c = entity(p, 395, 108, "DONASI", ["id_payment (PK/FK)", "id_donatur (FK)", "tujuan_donasi"])
d = entity(p, 45, 285, "KWITANSI", ["id_kwitansi (PK)", "no_kwitansi (UQ)", "id_payment (FK, UQ)"])
e = entity(p, 220, 285, "PELAYANAN_KEMATIAN", ["id_pelayanan (PK)", "id_anggota (FK)", "id_petugas (FK USER), status"])
f = entity(p, 395, 285, "PENGELUARAN", ["id_pengeluaran (PK)", "id_pelayanan (FK, nullable)", "id_pencatat (FK USER), nominal"])
g = entity(p, 45, 500, "USER / ROLE", ["USER: id_user (PK), username", "ROLE: id_role (PK), nama", "USER_ROLE: id_user + id_role"])
h = entity(p, 220, 500, "USER_SCOPE", ["id_scope (PK), id_user (FK)", "id_rw (FK, nullable)", "id_rt (FK, nullable)"])
i = entity(p, 395, 500, "DONATUR", ["id_donatur (PK)", "nama, telepon, alamat", "tipe_donatur"])
line(p, (a[2], (a[1]+a[3])/2), (b[0], (b[1]+b[3])/2), "1 : 0..1")
line(p, (b[2], (b[1]+b[3])/2), (c[0], (c[1]+c[3])/2), "subtype")
line(p, ((a[0]+a[2])/2, a[3]), ((d[0]+d[2])/2, d[1]), "1 : 0..1")
line(p, (e[2], (e[1]+e[3])/2), (f[0], (f[1]+f[3])/2), "1 : M")
line(p, ((g[0]+g[2])/2, g[1]), ((d[0]+d[2])/2, d[3]), "menerbitkan")
line(p, (g[2], (g[1]+g[3])/2), (h[0], (h[1]+h[3])/2), "1 : M")
line(p, ((i[0]+i[2])/2, i[1]), ((c[0]+c[2])/2, c[3]), "1 : M")
text(p, (45, 705, 550, 775), "Keputusan desain: KWITANSI merujuk ke PAYMENT, bukan menyimpan id_iuran dan id_donasi nullable dalam satu baris. Dengan demikian setiap kwitansi memiliki tepat satu sumber pembayaran dan integritas referensial lebih mudah diuji.", 8.5, False, (0.26, 0.35, 0.29))

p = page("LRS - LOGICAL RECORD STRUCTURE", "Skema relasi inti hingga bentuk normal ketiga (3NF)")
lrs = [
    "KELURAHAN(id_kelurahan PK, nama UQ, kecamatan, kota_administrasi)",
    "WILAYAH_RW(id_rw PK, id_kelurahan FK, no_rw, nama_ketua, no_hp; UQ(id_kelurahan,no_rw))",
    "WILAYAH_RT(id_rt PK, id_rw FK, no_rt, nama_ketua, no_hp; UQ(id_rw,no_rt))",
    "KARTU_KELUARGA(id_kk PK, nomor_kk UQ, id_rt FK, alamat, status_domisili)",
    "WARGA(id_warga PK, id_kk FK, nik UQ, nama, jenis_kelamin, tgl_lahir, status_warga)",
    "TARIF_IURAN(id_tarif PK, kategori_domisili, satuan, nominal, berlaku_mulai, berlaku_sampai)",
    "KEANGGOTAAN_BSK(id_anggota PK, id_warga FK, id_tarif FK, tgl_daftar, status, aktif_sampai)",
    "IURAN(id_iuran PK, id_anggota FK, periode, nominal_tagihan, status; UQ(id_anggota,periode))",
    "PAYMENT(id_payment PK, jenis, tgl_bayar, nominal, id_penerima FK, catatan)",
    "PEMBAYARAN_IURAN(id_payment PK/FK, id_iuran FK UQ)",
    "DONATUR(id_donatur PK, nama, telepon, alamat, tipe)",
    "DONASI(id_payment PK/FK, id_donatur FK, tujuan_donasi)",
    "KWITANSI(id_kwitansi PK, no_kwitansi UQ, id_payment FK UQ, id_penerbit FK, tgl_terbit, checksum_pdf)",
]
text(p, (44, 105, 552, 670), "\n\n".join(lrs), 8.1)
text(p, (44, 705, 552, 775), "Lanjutan relasi: PELAYANAN_KEMATIAN, JENIS_LAYANAN, PELAYANAN_DETAIL, PENGELUARAN, USER, ROLE, USER_ROLE, USER_SCOPE. Rincian lengkap tersedia pada halaman berikut.", 9, False, (0.26, 0.35, 0.29))

p = page("LRS - LAYANAN, KEAMANAN, DAN NORMALISASI", "Atribut lanjutan dan ringkasan aturan integritas")
tail = [
    "PELAYANAN_KEMATIAN(id_pelayanan PK, id_anggota FK, tgl_lapor, tgl_meninggal, status, id_petugas FK)",
    "JENIS_LAYANAN(id_jenis_layanan PK, nama UQ)",
    "PELAYANAN_DETAIL(id_pelayanan PK/FK, id_jenis_layanan PK/FK, status, catatan)",
    "PENGELUARAN(id_pengeluaran PK, id_pelayanan FK nullable, id_pencatat FK, tgl_pengeluaran, kategori, nominal, catatan)",
    "USER(id_user PK, username UQ, password_hash, nama, aktif)",
    "ROLE(id_role PK, nama UQ)",
    "USER_ROLE(id_user PK/FK, id_role PK/FK)",
    "USER_SCOPE(id_scope PK, id_user FK, id_rw FK nullable, id_rt FK nullable)",
]
text(p, (44, 108, 552, 405), "\n\n".join(tail), 8.3)
text(p, (44, 448, 552, 475), "Normalisasi", 14, True, (0.08, 0.31, 0.19))
text(p, (44, 482, 552, 660), "1NF: layanan berulang tidak disimpan dalam satu kolom; gunakan PELAYANAN_DETAIL.\n\n2NF: atribut detail layanan bergantung pada pasangan id_pelayanan dan id_jenis_layanan.\n\n3NF: data wilayah, tarif, donor, penerima, dan penerbit dipisah dari transaksi agar atribut non-kunci tidak saling menentukan.\n\nIntegritas: gunakan CHECK nominal > 0, UNIQUE pada tagihan per periode, foreign key aktif, dan transaksi atomik ketika menyimpan PAYMENT serta KWITANSI.", 9.4)
text(p, (44, 712, 552, 780), "Keamanan minimum: password_hash Argon2id/bcrypt, RBAC dan scope wilayah di sisi server, audit siapa-kapan-apa, serta NIK/nomor KK tidak ditampilkan pada daftar publik atau ekspor umum.", 8.6, False, (0.26, 0.35, 0.29))

OUT.parent.mkdir(exist_ok=True)
doc.set_metadata({"title": "ERD dan LRS Prototipe BSK", "author": "Kifayah - rancangan akademik"})
doc.save(OUT)
print(OUT)
