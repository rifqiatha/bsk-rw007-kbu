"""Membangun ERD terpadu yang mengikuti skema SQLite panel admin BSK.

Diagram ini bersifat dokumentasi: tidak membuka maupun mengubah database.
Garis penuh berarti foreign key yang benar-benar ada pada skema SQLite,
sedangkan garis putus-putus adalah hubungan operasional yang dipakai aplikasi.
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
LINE = (0.25, 0.42, 0.30)
LOGICAL = (0.43, 0.47, 0.51)


def box(page, x, y, title, fields, width=220):
    """Draw an entity and return its bounding rectangle."""
    height = 31 + len(fields) * 13 + 9
    rect = pymupdf.Rect(x, y, x + width, y + height)
    page.draw_rect(rect, color=GREEN, width=0.9, fill=(1, 1, 1))
    page.draw_rect((x, y, x + width, y + 29), color=None, fill=GREEN)
    page.insert_text((x + 9, y + 19), title, fontsize=8.5, fontname="hebo", color=(1, 1, 1))
    for index, field in enumerate(fields):
        page.insert_text((x + 9, y + 43 + index * 13), field, fontsize=7.2, fontname="helv", color=INK)
    return rect


def label(page, x, y, text, size=7.2, color=INK, bold=False):
    page.insert_text((x, y), text, fontsize=size, fontname="hebo" if bold else "helv", color=color)


def relation(page, start, end, cardinality, text, logical=False, offset=(0, 0)):
    """Draw a relationship connector with its cardinality and label."""
    color = LOGICAL if logical else LINE
    dashes = "[3 2] 0" if logical else None
    page.draw_line(start, end, color=color, width=1.0, dashes=dashes)
    mid_x, mid_y = (start.x + end.x) / 2 + offset[0], (start.y + end.y) / 2 + offset[1]
    label(page, mid_x - 38, mid_y - 2, cardinality, 7, color, True)
    label(page, mid_x - 38, mid_y + 8, text, 6.4, color)


def section(page, rect, title, subtitle, fill):
    page.draw_rect(rect, color=(0.72, 0.82, 0.74), width=0.7, fill=fill)
    label(page, rect.x0 + 13, rect.y0 + 17, title, 9, INK, True)
    label(page, rect.x0 + 13, rect.y0 + 29, subtitle, 6.5, (0.28, 0.39, 0.30))


doc = pymupdf.open()
page = doc.new_page(width=PAGE_W, height=PAGE_H)
page.draw_rect((0, 0, PAGE_W, PAGE_H), color=None, fill=(0.985, 0.99, 0.986))
page.draw_rect((28, 22, PAGE_W - 28, 76), color=None, fill=INK)
label(page, 48, 49, "ERD TERPADU — PANEL ADMIN BSK", 19, (1, 1, 1), True)
label(page, 48, 65, "Sesuai skema SQLite dan alur operasional aplikasi saat ini | No. KK = identitas keluarga | PK = primary key · FK = foreign key · UQ = unique", 8.2, (0.88, 0.95, 0.89))

section(page, pymupdf.Rect(30, 99, 390, 736), "DATA MASUK & TINJAUAN", "Pendaftaran BSK, anggota formulir, tanda tangan, dan perbaikan data", (0.965, 0.945, 0.985))
section(page, pymupdf.Rect(407, 99, 1161, 736), "DATA KK, SETORAN & ARSIP", "Data warga/iuran, keuangan, serta arsip kematian", MINT)

users = box(page, 50, 122, "ADMIN_USERS", ["id (PK)", "username (UQ), display_name, role", "active, permissions, kontak"], 188)
registration = box(page, 50, 218, "BSK_REGISTRATIONS", ["id (PK)", "submitted_by (FK), reviewed_by (FK)", "resident_id (FK, nullable)", "head_name, NIK, No. KK, status", "alamat, RT/RW, submitted_at"], 248)
members = box(page, 50, 342, "BSK_REGISTRATION_MEMBERS", ["id (PK)", "registration_id (FK)", "nama, NIK, lahir, hubungan"], 220)
signatures = box(page, 50, 431, "BSK_REGISTRATION_SIGNATURES", ["id (PK)", "registration_id (FK)", "role, name, image_file, signed_at", "UQ(registration_id, role)"], 240)
issues = box(page, 50, 539, "DATA_ISSUES", ["id (PK)", "record_id (relasi logis, nullable)", "resident_id (relasi logis, nullable)", "sumber, field, nilai asli, pesan", "resolved, resolved_at, resolved_by"], 275)

residents = box(page, 430, 153, "WARGA (CONTRIBUTION_RESIDENTS)", ["id (PK)", "account_id (FK, UQ, nullable)", "NIK (UQ jika terisi)", "No. KK (FK), nama, RT/RW", "status_warga, tanggal_wafat, kontak"], 245)
payments = box(page, 430, 305, "SETORAN (CONTRIBUTION_PAYMENTS)", ["id (PK)", "resident_id (FK: pengirim/pencatat)", "No. KK (FK), periode, nominal", "tanggal, metode, bukti, status"], 245)
finance = box(page, 430, 435, "FINANCE_ENTRIES", ["id (PK)", "tanggal, judul, deskripsi", "income, expense, category", "source, source_period, RT/RW"], 245)
records = box(page, 778, 153, "RECORDS (ARSIP WAFAT)", ["id (PK)", "nama, NIK, No. KK, area", "tanggal wafat, alamat", "publikasi, berkas potret"], 245)
family = box(page, 778, 303, "FAMILY_CONNECTIONS", ["id (PK)", "record_id (FK)", "full_name, relationship"], 210)
households = box(page, 778, 403, "KARTU_KELUARGA (HOUSEHOLDS)", ["No. KK / family_card_number (PK)", "head_name, RT/RW, alamat", "members_json, created_at, updated_at"], 245)

# Foreign keys stored in SQLite: solid lines. Points deliberately use the
# nearest box edges so the combined diagram stays readable when printed.
relation(page, pymupdf.Point(144, 201), pymupdf.Point(174, 218), "1 : N", "submit/review", offset=(-35, -3))
relation(page, pymupdf.Point(174, 323), pymupdf.Point(160, 342), "1 : N", "memuat", offset=(-42, 1))
relation(page, pymupdf.Point(290, 323), pymupdf.Point(290, 431), "1 : N", "ditandatangani", offset=(14, 0))
relation(page, pymupdf.Point(298, 270), pymupdf.Point(430, 218), "0..1 : 1", "disetujui → warga", offset=(0, -15))
relation(page, pymupdf.Point(238, 161), pymupdf.Point(430, 177), "1 : 0..1", "akun warga", offset=(0, -16))
relation(page, pymupdf.Point(552, 258), pymupdf.Point(552, 305), "1 : N", "setoran", offset=(16, 0))
relation(page, pymupdf.Point(900, 245), pymupdf.Point(883, 303), "1 : N", "anggota/keluarga", offset=(19, 0))
relation(page, pymupdf.Point(675, 246), pymupdf.Point(778, 442), "N : 1", "No. KK", offset=(14, -3))
relation(page, pymupdf.Point(675, 350), pymupdf.Point(778, 470), "N : 1", "No. KK", offset=(16, 9))

# Operational links in application code: dashed lines.
relation(page, pymupdf.Point(325, 556), pymupdf.Point(778, 228), "0..N : 0..1", "tinjau arsip", logical=True, offset=(4, -12))
relation(page, pymupdf.Point(325, 626), pymupdf.Point(430, 246), "0..N : 0..1", "tinjau warga", logical=True, offset=(-4, 0))
relation(page, pymupdf.Point(552, 397), pymupdf.Point(552, 435), "N : 0..1", "rekap pemasukan", logical=True, offset=(16, 0))

page.draw_rect((30, 758, 1161, 818), color=(0.72, 0.82, 0.74), width=0.7, fill=(1, 1, 1))
page.draw_line((49, 778), (98, 778), color=LINE, width=1.2)
label(page, 105, 781, "Garis penuh: FK tersimpan dan dijaga oleh SQLite.", 7.3)
page.draw_line((346, 778), (395, 778), color=LOGICAL, width=1.2, dashes="[3 2] 0")
label(page, 402, 781, "Garis putus-putus: hubungan operasional di kode, bukan FK database.", 7.3)
label(page, 49, 804, "Cakupan: hanya entitas yang mendukung panel admin. Tabel pengaturan, kontak wilayah, jabatan, berita, dan sesi tidak ditampilkan karena tidak terlibat dalam alur dua diagram sumber.", 7.2, (0.23, 0.31, 0.24))

OUT_DIR.mkdir(exist_ok=True)
doc.set_metadata({"title": "ERD Terpadu Panel Admin BSK", "author": "Kifayah"})
doc.save(PDF_OUT)
pix = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
pix.save(PNG_OUT)
doc.close()
print(PDF_OUT)
print(PNG_OUT)
