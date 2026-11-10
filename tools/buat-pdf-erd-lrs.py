"""Membuat ERD dan LRS sederhana yang sesuai alur operasional panel BSK."""
from pathlib import Path
import pymupdf

OUT = Path(__file__).resolve().parents[1] / "docs" / "ERD-LRS-BSK-RINGKAS.pdf"
doc = pymupdf.open()

def page(title, subtitle):
    sheet = doc.new_page(width=842, height=595)
    sheet.draw_rect((0, 0, 842, 595), color=None, fill=(.975, .985, .975))
    sheet.draw_rect((28, 24, 814, 74), color=None, fill=(.06, .28, .16))
    sheet.insert_text((48, 53), title, fontsize=18, fontname="hebo", color=(1, 1, 1))
    sheet.insert_text((48, 67), subtitle, fontsize=8.5, color=(.86, .94, .87))
    return sheet

def write(sheet, rect, value, size=9, bold=False, color=(.08, .12, .09)):
    sheet.insert_textbox(pymupdf.Rect(rect), value, fontsize=size, fontname="hebo" if bold else "helv", color=color, lineheight=1.2)

def entity(sheet, x, y, title, fields):
    width, height = 220, 33 + len(fields) * 14
    sheet.draw_rect((x, y, x + width, y + height), color=(.08, .34, .19), width=.8, fill=(1, 1, 1))
    sheet.draw_rect((x, y, x + width, y + 27), color=None, fill=(.08, .34, .19))
    write(sheet, (x + 8, y + 7, x + width - 8, y + 25), title, 9, True, (1, 1, 1))
    write(sheet, (x + 8, y + 34, x + width - 8, y + height - 4), "\n".join(fields), 7.7)
    return pymupdf.Rect(x, y, x + width, y + height)

def relation(sheet, start, end, label):
    sheet.draw_line(start, end, color=(.25, .39, .28), width=.8)
    mid = ((start.x + end.x) / 2, (start.y + end.y) / 2)
    write(sheet, (mid[0] - 35, mid[1] - 15, mid[0] + 35, mid[1] - 2), label, 7, True, (.06, .28, .16))

sheet = page("ERD BSK — RINGKAS DAN OPERASIONAL", "Acuan panel admin | PK = Primary Key · FK = Foreign Key · KK menjadi identitas utama keluarga")
write(sheet, (44, 94, 798, 132), "Alur tunggal: Data Masuk/Data Issue → Family Connection (KK) → Records (anggota & status) → Setoran. Pendaftaran dan tanda tangan hanya menjadi lampiran intake, bukan tahapan wajib terpisah.", 11)
registration = entity(sheet, 50, 174, "DATA_ISSUE / REGISTRASI_BSK", ["id_issue (PK)", "nomor_kk (FK → FAMILY_CONNECTION.nomor_kk)", "jenis_issue, status, sumber, catatan", "id_record (FK → RECORDS.id_record, nullable)"])
family = entity(sheet, 311, 153, "FAMILY_CONNECTION", ["nomor_kk (PK)", "nama_kepala_keluarga, alamat, rt, rw", "status_domisili, telepon, dibuat_pada", "Satu baris = satu keluarga/KK"])
records = entity(sheet, 572, 153, "RECORDS", ["id_record (PK)", "nomor_kk (FK → FAMILY_CONNECTION.nomor_kk)", "nik (UQ), nama, hubungan_keluarga", "status_warga, tanggal_wafat, data_pribadi"])
payment = entity(sheet, 311, 392, "PEMBAYARAN / SETORAN", ["id_pembayaran (PK)", "nomor_kk (FK → FAMILY_CONNECTION.nomor_kk)", "periode, nominal, tanggal_bayar, status", "UQ(nomor_kk, periode) — satu KK satu iuran/periode"])
relation(sheet, registration.br, family.tl, "M : 1")
relation(sheet, family.tr, records.tl, "1 : M")
relation(sheet, family.bl, payment.tl, "1 : M")
write(sheet, (50, 510, 792, 570), "Penempatan kunci: nomor_kk adalah PK hanya pada FAMILY_CONNECTION, lalu menjadi FK pada RECORDS, DATA_ISSUE/REGISTRASI_BSK, dan PEMBAYARAN. Setiap anggota memiliki id_record, tetapi hubungan dan pembayaran selalu kembali ke satu KK.", 8.5)

sheet = page("LRS — LOGICAL RECORD STRUCTURE", "Struktur yang dibaca langsung dari alur panel admin; kolom teknis lama dapat dimigrasikan bertahap tanpa menghapus riwayat")
lrs = [
"FAMILY_CONNECTION(nomor_kk PK, nama_kepala_keluarga, alamat, rt, rw, status_domisili, telepon, dibuat_pada)",
"RECORDS(id_record PK, nomor_kk FK → FAMILY_CONNECTION.nomor_kk, nik UQ, nama, hubungan_keluarga, jenis_kelamin, tanggal_lahir, status_warga, tanggal_wafat)",
"PEMBAYARAN(id_pembayaran PK, nomor_kk FK → FAMILY_CONNECTION.nomor_kk, periode, nominal, tanggal_bayar, metode, bukti, status, catatan; UQ(nomor_kk, periode))",
"DATA_ISSUE(id_issue PK, nomor_kk FK → FAMILY_CONNECTION.nomor_kk nullable, id_record FK → RECORDS.id_record nullable, sumber, baris_sumber, field, nilai_asli, pesan, status)",
"REGISTRASI_BSK(id_registrasi PK, nomor_kk FK → FAMILY_CONNECTION.nomor_kk nullable, status, diajukan_pada, ditinjau_pada, catatan)",
"REGISTRASI_MEMBER(id_registrasi_member PK, id_registrasi FK → REGISTRASI_BSK.id_registrasi, id_record FK → RECORDS.id_record nullable, nama, nik, hubungan_keluarga)",
"REGISTRASI_SIGNATURE(id_signature PK, id_registrasi FK → REGISTRASI_BSK.id_registrasi, peran, nama, berkas_tanda_tangan, ditandatangani_pada; UQ(id_registrasi, peran))",
]
write(sheet, (48, 100, 794, 385), "\n\n".join(lrs), 9)
write(sheet, (48, 422, 794, 470), "Aturan integritas: (1) nomor_kk harus 16 digit sebelum keluarga aktif; (2) RECORDS tidak boleh tanpa nomor_kk; (3) pembayaran disimpan per-KK dan periode; (4) pendaftaran/members/signatures adalah dokumen intake di Data Masuk & Tinjauan, bukan panel warga.", 9.5, True, (.06, .28, .16))
write(sheet, (48, 514, 794, 560), "Catatan migrasi: aplikasi mempertahankan ID internal lama demi keamanan riwayat. Pada database target, FOREIGN KEY dinyalakan dan data lama diperiksa dahulu agar tidak ada KK kosong atau pembayaran ganda sebelum constraint UQ(nomor_kk, periode) diterapkan.", 8.4)

OUT.parent.mkdir(exist_ok=True)
doc.set_metadata({"title": "ERD dan LRS BSK Ringkas", "author": "Kifayah"})
doc.save(OUT)
print(OUT)
