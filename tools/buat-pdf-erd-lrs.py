"""Membangun ERD dan LRS ringkas untuk panel admin BSK.

Dokumen ini mengikuti skema SQLite aktif. No. KK adalah identitas utama
keluarga; kolom ID lain tetap ditampilkan hanya bila merupakan identitas teknis
baris atau diperlukan untuk riwayat/audit.
"""
from pathlib import Path

import pymupdf


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs"
PDF_OUT = OUT_DIR / "ERD-PANEL-ADMIN-BSK.pdf"
PNG_OUT = OUT_DIR / "ERD-PANEL-ADMIN-BSK.png"

PAGE_W, PAGE_H = 1191, 842  # A3 landscape
INK = (0.07, 0.21, 0.14)
GREEN = (0.08, 0.38, 0.23)
MINT = (0.94, 0.98, 0.95)
PALE = (0.975, 0.986, 0.977)
LINE = (0.25, 0.42, 0.30)
GRAY = (0.35, 0.40, 0.43)


def text(page, x, y, value, size=8, color=INK, bold=False):
    page.insert_text((x, y), value, fontsize=size, fontname="hebo" if bold else "helv", color=color)


def frame(page, title, subtitle):
    page.draw_rect((0, 0, PAGE_W, PAGE_H), color=None, fill=PALE)
    page.draw_rect((28, 22, PAGE_W - 28, 79), color=None, fill=INK)
    text(page, 48, 51, title, 19, (1, 1, 1), True)
    text(page, 48, 68, subtitle, 8.2, (0.88, 0.95, 0.89))


def box(page, x, y, title, fields, width=260, accent=GREEN):
    height = 34 + len(fields) * 16 + 10
    rect = pymupdf.Rect(x, y, x + width, y + height)
    page.draw_rect(rect, color=accent, width=0.9, fill=(1, 1, 1))
    page.draw_rect((x, y, x + width, y + 31), color=None, fill=accent)
    text(page, x + 10, y + 21, title, 9, (1, 1, 1), True)
    for number, field in enumerate(fields):
        text(page, x + 10, y + 47 + number * 16, field, 7.5)
    return rect


def group(page, rect, title, subtitle):
    page.draw_rect(rect, color=(0.70, 0.82, 0.73), width=0.8, fill=MINT)
    text(page, rect.x0 + 14, rect.y0 + 19, title, 10, INK, True)
    text(page, rect.x0 + 14, rect.y0 + 32, subtitle, 7, (0.26, 0.37, 0.28))


def connector(page, start, end, label_value, relation_value, dashed=False, label_offset=(0, 0)):
    color = GRAY if dashed else LINE
    page.draw_line(start, end, color=color, width=1.1, dashes="[3 2] 0" if dashed else None)
    x = (start.x + end.x) / 2 + label_offset[0]
    y = (start.y + end.y) / 2 + label_offset[1]
    text(page, x - 28, y - 3, relation_value, 7, color, True)
    text(page, x - 28, y + 8, label_value, 6.5, color)


def note(page, rect, title, lines):
    page.draw_rect(rect, color=(0.73, 0.80, 0.74), width=0.8, fill=(1, 1, 1))
    text(page, rect.x0 + 12, rect.y0 + 18, title, 8, INK, True)
    for index, line in enumerate(lines):
        text(page, rect.x0 + 12, rect.y0 + 34 + index * 13, line, 7.1, (0.19, 0.29, 0.21))


doc = pymupdf.open()

# Halaman 1: hanya relasi inti yang perlu dibaca pengguna/dosen.
page = doc.new_page(width=PAGE_W, height=PAGE_H)
frame(page, "ERD RINGKAS — PANEL ADMIN BSK", "No. KK adalah identitas utama keluarga | PK = kunci utama | FK = kunci tamu | UQ = unik")
group(page, pymupdf.Rect(42, 106, 1149, 610), "INTI DATA KELUARGA", "Hubungan yang menentukan kepemilikan keluarga dan setoran")

households = box(page, 112, 211, "KARTU_KELUARGA", [
    "No. KK (PK)  ← identitas utama satu keluarga",
    "nama_kepala, RT/RW, alamat",
    "members_json, created_at, updated_at",
], 292)
residents = box(page, 477, 161, "WARGA", [
    "id_warga (PK teknis; bukan identitas keluarga)",
    "NIK (UQ jika terisi)",
    "No. KK (FK → KARTU_KELUARGA)",
    "nama, RT/RW, status_warga, tanggal_wafat",
], 305)
payments = box(page, 850, 247, "SETORAN", [
    "id_setoran (PK teknis untuk bukti/riwayat)",
    "No. KK (FK → KARTU_KELUARGA)",
    "periode, nominal, tanggal, metode, bukti, status",
    "resident_id (FK audit: pengirim/pencatat)",
], 250)
connector(page, pymupdf.Point(404, 267), pymupdf.Point(477, 240), "memiliki warga", "1 : N", label_offset=(0, -13))
connector(page, pymupdf.Point(404, 294), pymupdf.Point(850, 321), "memiliki setoran", "1 : N", label_offset=(0, 12))
connector(page, pymupdf.Point(782, 258), pymupdf.Point(850, 359), "jejak pengirim/pencatat", "0..1 : N", dashed=True, label_offset=(17, 2))

note(page, pymupdf.Rect(112, 442, 742, 548), "ATURAN YANG MENJAGA DATA TIDAK GANDA", [
    "• Satu No. KK hanya mewakili satu KARTU_KELUARGA; semua warga dan setoran keluarga merujuk kepadanya.",
    "• NIK warga dibuat unik bila telah diisi. ID warga/setoran hanya nomor teknis untuk memperbarui satu baris dan menyimpan riwayat.",
    "• resident_id pada SETORAN tidak menggantikan No. KK: kolom itu hanya menunjukkan warga/pencatat yang terkait dengan transaksi.",
    "• No. KK wajib valid 16 digit sebelum migrasi data lama dijalankan.",
])

group(page, pymupdf.Rect(42, 638, 1149, 758), "ALUR MASUK ADMIN (RINGKAS)", "Entitas berikut mendukung proses, tetapi bukan identitas utama keluarga")
registration = box(page, 82, 671, "PENDAFTARAN_BSK", ["id_pendaftaran (PK teknis), No. KK calon, NIK, members_json, status"], 310, accent=(0.19, 0.34, 0.49))
admins = box(page, 454, 671, "ADMIN_USERS", ["id_admin (PK teknis), username (UQ), role, permissions"], 280, accent=(0.19, 0.34, 0.49))
settings = box(page, 795, 671, "APP_SETTINGS", ["key (PK), value — termasuk tanda tangan global"], 295, accent=(0.19, 0.34, 0.49))
connector(page, pymupdf.Point(392, 710), pymupdf.Point(454, 710), "disetujui menjadi warga", "0..1 : 1", dashed=True, label_offset=(0, -9))
connector(page, pymupdf.Point(734, 710), pymupdf.Point(795, 710), "membaca tanda tangan global", "N : 1", dashed=True, label_offset=(0, -9))
text(page, 48, 794, "Tidak ada entitas aktif BSK_REGISTRATION_MEMBERS atau BSK_REGISTRATION_SIGNATURES: anggota tersimpan di members_json, tanda tangan memakai APP_SETTINGS global.", 7.2, INK, True)
text(page, 48, 814, "Relasi garis penuh = FK SQLite. Garis putus-putus = alur/audit aplikasi yang tetap diperlukan, namun bukan identitas keluarga.", 7.2, GRAY)

# Halaman 2: LRS adalah daftar relasi, bukan seluruh detail implementasi UI.
page = doc.new_page(width=PAGE_W, height=PAGE_H)
frame(page, "LRS RINGKAS — PANEL ADMIN BSK", "Ringkasan tabel aktif; nama tampilan disederhanakan, nama fisik ditulis dalam tanda kurung")

headers = [(51, "RELASI / TABEL"), (312, "KUNCI DAN ATRIBUT UTAMA"), (825, "FUNGSI")]
page.draw_rect((42, 106, 1149, 137), color=None, fill=GREEN)
for x, value in headers:
    text(page, x, 126, value, 8, (1, 1, 1), True)

rows = [
    ("KARTU_KELUARGA\n(households)", "No. KK PK; nama_kepala; RT/RW; alamat; members_json", "Satu baris = satu keluarga.\nAcuan utama WARGA dan SETORAN."),
    ("WARGA\n(contribution_residents)", "id PK teknis; NIK UQ; No. KK FK → KARTU_KELUARGA; account_id FK", "Anggota keluarga. ID teknis\ntidak menjadi identitas keluarga."),
    ("SETORAN\n(contribution_payments)", "id PK teknis; No. KK FK → KARTU_KELUARGA; resident_id FK → WARGA", "Transaksi per keluarga. resident_id\nhanya jejak pengirim/pencatat."),
    ("PENDAFTARAN_BSK\n(bsk_registrations)", "id PK; No. KK calon; NIK; members_json; status; submitted_by/reviewed_by FK", "Data masuk sebelum disetujui\nmenjadi WARGA/keluarga."),
    ("ADMIN_USERS", "id PK; username UQ; role; permissions; active", "Akun petugas panel admin."),
    ("APP_SETTINGS", "key PK; value", "Konfigurasi global, termasuk\ntanda tangan dokumen."),
    ("ARSIP_WAFAT (records)\n+ KELUARGA_ARSIP\n(family_connections)", "records.id PK; family_connections.id PK; record_id FK → records", "Arsip riwayat wafat dan\nhubungan keluarganya."),
    ("DATA_ISSUES\ndan FINANCE_ENTRIES", "id PK masing-masing; relasi peninjauan/rekap bersifat operasional", "Pendukung validasi data dan\ncatatan keuangan admin."),
]
row_y = 137
for number, (name, keys, function) in enumerate(rows):
    height = 67 if number in (0, 1, 2, 3, 6) else 54
    fill = (1, 1, 1) if number % 2 == 0 else (0.956, 0.978, 0.96)
    page.draw_rect((42, row_y, 1149, row_y + height), color=(0.75, 0.84, 0.77), width=0.55, fill=fill)
    page.draw_line((300, row_y), (300, row_y + height), color=(0.75, 0.84, 0.77), width=0.55)
    page.draw_line((814, row_y), (814, row_y + height), color=(0.75, 0.84, 0.77), width=0.55)
    for index, value in enumerate(name.split("\n")):
        text(page, 51, row_y + 21 + index * 12, value, 7.5, INK, index == 0)
    for index, value in enumerate(keys.split("\n")):
        text(page, 312, row_y + 21 + index * 12, value, 7.2)
    for index, value in enumerate(function.split("\n")):
        text(page, 825, row_y + 21 + index * 12, value, 7.2)
    row_y += height

note(page, pymupdf.Rect(42, 692, 1149, 787), "CATATAN IMPLEMENTASI", [
    "• PK teknis tetap dipakai agar unggah bukti, edit satu data, tombol aksi, dan riwayat audit dapat bekerja aman. PK keluarga tetap No. KK.",
    "• Tabel lama bsk_registration_members dan bsk_registration_signatures sudah dihapus dari alur/skema aktif; tidak dicantumkan sebagai entitas aktif.",
    "• Sebelum CasaOS memakai relasi No. KK, perbaiki data No. KK yang tidak valid dahulu lalu jalankan migrasi family keys; jangan dipaksa/dihapus langsung.",
])
text(page, 48, 812, "Legenda: PK = primary key; FK = foreign key; UQ = unique. Dokumen dibuat dari skema panel admin aktif.", 7.2, GRAY)

OUT_DIR.mkdir(exist_ok=True)
doc.set_metadata({"title": "ERD dan LRS Ringkas Panel Admin BSK", "author": "Kifayah"})
doc.save(PDF_OUT)
pix = doc[0].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
pix.save(PNG_OUT)
doc.close()
print(PDF_OUT)
print(PNG_OUT)
