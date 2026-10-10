import csv
import io
import re
import statistics
from datetime import date, datetime, timedelta
from pathlib import Path


MAX_IMPORT_BYTES = 60 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".xlsx", ".xls", ".csv", ".docx", ".pdf", ".png", ".jpg", ".jpeg", ".webp"}
FIELD_ALIASES = {
	"full_name": {"nama", "nama lengkap", "nama warga", "name", "full name"},
	"gender": {"jenis kelamin", "kelamin", "gender", "sex"},
	"family_card_number": {"nomor kartu keluarga", "no kartu keluarga", "nomor kk", "no kk", "kk"},
	"national_id_number": {"nomor induk kependudukan", "nomor ktp", "no ktp", "nik", "no nik"},
	"rt": {"rt", "rukun tetangga"},
	"rw": {"rw", "rukun warga"},
	"birthplace": {"tempat lahir", "kota lahir"},
	"birth_date": {"tanggal lahir", "tgl lahir", "date of birth", "birth_date", "birthdate"},
	"date_of_death": {
		"tanggal wafat", "tgl wafat", "tanggal meninggal", "tgl meninggal",
		"tanggal kematian", "date of death", "death date", "date_of_death", "dateofdeath",
	},
	"address": {"alamat", "alamat lengkap", "address"},
	"religion": {"agama", "religion"},
	"payment_recipient": {"disetorkan kepada", "disetor kepada", "penerima setoran", "recipient"},
	"relationship": {"hubungan", "hubungan keluarga", "status hubungan", "relation"},
	"phone": {"no hp", "nomor hp", "no handphone", "nomor handphone", "hp", "phone", "telepon"},
	"residence_status": {"status", "status domisili", "status kependudukan", "tetap/kontrak/kos", "tetap kontrak kos"},
	"payment_period": {"bulan iuran", "periode iuran", "periode pembayaran", "payment period"},
	"paid_at": {"tanggal pembayaran", "tanggal setoran", "paid at"},
	"amount": {"nominal setoran", "nominal dibayar", "jumlah setoran", "amount"},
	"living_family_name": {"nama keluarga", "nama anggota keluarga", "nama kerabat", "nama keluarga yang hidup"},
	"living_family_relationship": {"hubungan keluarga", "hubungan kerabat", "relationship keluarga", "hubungan"},
}
NORMALIZED_ALIASES = {
	field: {re.sub(r"[^a-z0-9]", "", alias.lower()) for alias in aliases}
	for field, aliases in FIELD_ALIASES.items()
}
# Kata kunci untuk pencocokan sebagian. Dipakai kalau judul kolom tidak sama
# persis dengan salah satu alias di atas, misalnya "Nama Warga (Lengkap)".
# "nama" sengaja berada di paling akhir.
FUZZY_HEADER_KEYS = (
	("nomorkartukeluarga", "family_card_number"),
	("nomorkk", "family_card_number"),
	("nomorindukkependudukan", "national_id_number"),
	("nomorktp", "national_id_number"),
	("tanggalmeninggal", "date_of_death"),
	("tanggalkematian", "date_of_death"),
	("tanggalwafat", "date_of_death"),
	("tanggallahir", "birth_date"),
	("tempatlahir", "birthplace"),
	("alamatdomisili", "address"),
	("alamat", "address"),
	("jabatan", "relationship"),
	("hubungan", "relationship"),
	("agama", "religion"),
	("jeniskelamin", "gender"),
	("nomortelepon", "phone"),
	("nohp", "phone"),
	("nomorhp", "phone"),
	("bulaniuran", "payment_period"),
	("tanggalbayar", "paid_at"),
	("tanggalpembayaran", "paid_at"),
	("nominal", "amount"),
	("namakeluarga", "living_family_name"),
	("namaanggotakeluarga", "living_family_name"),
	("namakerabat", "living_family_name"),
	("namakepalakeluarga", "full_name"),
	("nama", "full_name"),
)


class ImportFormatError(ValueError):
	pass


def _text(value):
	if value is None:
		return ""
	if isinstance(value, bool):
		return "Ya" if value else "Tidak"
	if isinstance(value, float) and value.is_integer():
		return str(int(value))
	return str(value).strip()


def _header_key(value):
	return re.sub(r"[^a-z0-9]", "", _text(value).lower())


def _field_for_header(value):
	key = _header_key(value)
	for field, aliases in NORMALIZED_ALIASES.items():
		if key in aliases:
			return field
	if "nomorkartukeluarga" in key or "nomorkk" in key:
		return "family_card_number"
	if "nomorindukkependudukan" in key or key.startswith("nik"):
		return "national_id_number"
	if "tanggalwafat" in key or "tanggalmeninggal" in key or "tanggalkematian" in key:
		return "date_of_death"
	if "tanggallahir" in key:
		return "birth_date"
	if "tempatlahir" in key:
		return "birthplace"
	# Pencocokan sebagian: judul kolom sering punya tambahan, misalnya
	# "Nama Warga (Lengkap)". Kata kuncinya tetap dikenali supaya file tidak
	# ditolak hanya karena judulnya sedikit beda. Urutan penting: kolom khusus
	# diperiksa lebih dulu, dan "nama" paling akhir supaya "Nama Keluarga"
	# tidak ikut dianggap sebagai Nama Warga.
	for needle, field in FUZZY_HEADER_KEYS:
		if needle in key:
			return field
	return None


def _parse_date(value, excel_datemode=None):
	if isinstance(value, datetime):
		return value.date().isoformat()
	if isinstance(value, date):
		return value.isoformat()
	if isinstance(value, (int, float)) and excel_datemode is not None:
		try:
			import xlrd

			return xlrd.xldate_as_datetime(value, excel_datemode).date().isoformat()
		except (ImportError, TypeError, ValueError, OverflowError):
			return ""
	text = _text(value)
	if not text:
		return ""
	# Format tak lazim (pemisah campur, tahun 2-3 digit, salah ketik OCR)
	# ditangani normalize_flexible_date; hasilnya dikembalikan apa adanya
	# bila memang tidak bisa ditebak supaya Organize bisa memperbaiki.
	return normalize_flexible_date(text)


def _parse_number(value):
	text = _text(value)
	match = re.search(r"\d+", text)
	return int(match.group()) if match else None


def _normalize_record(source, warnings):
	record = {field: "" for field in FIELD_ALIASES}
	for key, value in source.items():
		field = key if key in record else _field_for_header(key)
		if field:
			record[field] = value
	area = _text(source.get("area", ""))
	if area:
		area_match = re.search(r"RT\s*0*(\d+).*?RW\s*0*(\d+)", area, re.IGNORECASE)
		if area_match:
			record["rt"] = area_match.group(1)
			record["rw"] = area_match.group(2)
	for field in FIELD_ALIASES:
		if field in ("rt", "rw"):
			number = _parse_number(record[field])
			record[field] = number if number is not None else ""
		elif field == "gender":
			record[field] = normalize_gender_value(record[field])
		elif field in ("family_card_number", "national_id_number"):
			record[field] = clean_number_text(record[field])
		elif field in ("birth_date", "date_of_death", "paid_at"):
			record[field] = _parse_date(record[field])
		elif field == "payment_period":
			value = record[field]
			if isinstance(value, (datetime, date)):
				record[field] = value.isoformat()[:7]
			else:
				text = _text(value)
				if re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", text):
					record[field] = text
				else:
					parsed = _parse_date(value)
					record[field] = parsed[:7] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", parsed) else text
		else:
			value = record[field]
			record[field] = _text(value)
			if field in ("family_card_number", "national_id_number") and isinstance(value, (int, float)):
				warnings.add("Nomor KK/NIK yang terbaca sebagai angka Excel mungkin kehilangan digit; verifikasi setiap nomor di pratinjau.")
	if record["living_family_relationship"] and not record["living_family_name"]:
		record["living_family_relationship"] = ""
	return record


def _records_with_known_fields(matrix, fields, warnings):
	results = []
	for values in matrix:
		if not any(_text(value) for value in values):
			continue
		if "full_name" in [_field_for_header(value) for value in values]:
			continue  # baris judul kolom yang terulang
		source = {}
		for column_index, field in enumerate(fields):
			if field and column_index < len(values):
				source[field] = values[column_index]
		record = _normalize_record(source, warnings)
		if record["full_name"]:
			results.append(record)
	return results


MAX_HEADER_SCAN_ROWS = 200


def _looks_like_name(value):
	"""Tebakan nama ketika file tidak punya kolom berlabel "Nama".

	Umumnya nama orang punya huruf dan mengandung spasi. Angka boleh ikut
	(tempel seperti "BUDI 1" atau "RT 012"), asal kata utamanya berupa huruf.
	Ini hanya dipakai sebagai cadangan, bukan sebagai aturan.
	"""
	text = _text(value)
	if len(text) < 2 or len(text) > 120:
		return False
	if not re.fullmatch(r"[A-Za-z0-9 .,()'/-]+", text):
		return False
	# Butuh minimal dua huruf berurutan supaya angka dan kode tidak dianggap nama.
	if not re.search(r"[A-Za-z]{2}", text):
		return False
	# Nilai umum di kolom non-nama, misalnya judul kolom lain yang terbaca.
	if _field_for_header(text):
		return False
	# Angka, kode, atau tanggal saja bukan nama.
	if re.fullmatch(r"[\d .,/()-]+", text):
		return False
	return True


def _guess_name_column(matrix, data_start):
	"""Pilih kolom yang paling mungkin berisi nama warga."""
	best_column = None
	best_score = 0
	column_count = max((len(row) for row in matrix[data_start:]), default=0)
	sample = matrix[data_start:data_start + 60]
	# Minimal beberapa baris harus terbaca sebagai nama. Ambang ikut menyesuaikan
	# jumlah baris supaya file kecil tidak ikut ditolak.
	minimum = 3 if len(sample) >= 3 else 2
	for column_index in range(column_count):
		score = 0
		seen = set()
		for values in sample:
			if column_index >= len(values):
				continue
			if _looks_like_name(values[column_index]):
				text = _text(values[column_index]).upper()
				if text not in seen:
					seen.add(text)
					score += 1
				if " " in text:
					score += 1
		if score > best_score:
			best_score = score
			best_column = column_index
	return best_column if best_score >= minimum else None


def _is_repeated_header_row(values, reference=None):
	"""Baris yang isinya judul kolom, bukan data warga.

	`reference` adalah baris judul yang pertama kali ditemukan. Baris berikutnya
	yang isinya sama dengan baris itu (judul kop yang terulang atau baris judul
	yang di-copy) ikut dilewati.
	"""
	filled = [_text(value) for value in values if _text(value)]
	if len(filled) < 2:
		return False
	if reference:
		reference_texts = {_text(value).lower() for value in reference if _text(value)}
		if reference_texts:
			matches = sum(1 for text in filled if text.lower() in reference_texts)
			if matches * 2 >= len(filled):
				return True
	recognized = sum(1 for text in filled if _field_for_header(text))
	return recognized * 2 >= len(filled)


def _records_without_header(matrix, warnings):
	"""Impor file yang judul kolomnya tidak bisa dibaca.

	Baris kop (judul lembaga, baris kosong di awal) dilewati, lalu kolom
	yang paling mungkin berisi nama dijadikan Nama Warga. Semua kolom lain
	dibiarkan kosong, jadi data yang ada tetap tersalin.
	"""
	data_start = 0
	for row_index, row in enumerate(matrix[:MAX_HEADER_SCAN_ROWS]):
		filled = sum(1 for value in row if _text(value))
		if filled >= 2:
			data_start = row_index
			break
	else:
		return []
	name_column = _guess_name_column(matrix, data_start)
	if name_column is None:
		return []
	# Baris tepat sebelum tebakan kolom nama dianggap baris judul. Isinya
	# dipakai untuk mengenali baris judul yang sama di bagian bawah file.
	reference = next(
		(row for row in reversed(matrix[:data_start + 1]) if sum(1 for value in row if _text(value)) >= 2),
		None,
	)
	results = []
	for values in matrix[data_start:]:
		if name_column >= len(values) or not _looks_like_name(values[name_column]):
			continue
		# Baris judul kolom tidak ikut diimpor sebagai data warga.
		if _is_repeated_header_row(values, reference):
			continue
		source = {"full_name": values[name_column]}
		record = _normalize_record(source, warnings)
		if record["full_name"]:
			results.append(record)
	if not results:
		return []
	warnings.add(
		"Tidak ditemukan kolom berlabel 'Nama'. Kolom yang paling mungkin berisi nama "
		"dipakai sebagai Nama Warga; periksa pratinjau dan perbaiki bila perlu."
	)
	return results


def _header_row_to_records(matrix, warnings, datemode=None):
	for row_index, row in enumerate(matrix[:MAX_HEADER_SCAN_ROWS]):
		if sum(1 for value in row if _text(value)) < 2:
			continue  # lewati baris kosong atau baris judul kop
		fields = [_field_for_header(value) for value in row]
		next_row = matrix[row_index + 1] if row_index + 1 < len(matrix) else None
		if next_row is not None:
			for column_index, field in enumerate(fields):
				if field is None and column_index < len(next_row):
					combined = f"{_text(row[column_index])} {_text(next_row[column_index])}".strip()
					merged = _field_for_header(combined)
					if merged:
						fields[column_index] = merged
		# Satu kolom yang dikenali (Nama) sudah cukup. Dulu minimal dua kolom
		# harus cocok, sehingga file yang hanya memuat Nama dan satu kolom
		# lain ikut ditolak.
		if "full_name" not in fields:
			continue
		data_start = row_index + 1
		if next_row is not None and any(_field_for_header(value) for value in next_row):
			data_start = row_index + 2
		results = []
		for values in matrix[data_start:]:
			if not any(_text(value) for value in values):
				continue
			source = {}
			for column_index, field in enumerate(fields):
				if field and column_index < len(values):
					source[field] = values[column_index]
			record = _normalize_record(source, warnings)
			if record["full_name"]:
				results.append(record)
		if results:
			return results
	return _records_without_header(matrix, warnings)



def _parse_csv(content, warnings):
	try:
		text = content.decode("utf-8-sig")
	except UnicodeDecodeError:
		text = content.decode("cp1252", errors="replace")
	try:
		dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
	except csv.Error:
		dialect = csv.excel
	return _header_row_to_records(list(csv.reader(io.StringIO(text), dialect)), warnings)


def _parse_xlsx(content, warnings):
	from openpyxl import load_workbook

	workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
	results = []
	for worksheet in workbook.worksheets:
		matrix = [list(row) for row in worksheet.iter_rows(values_only=True)]
		results.extend(_header_row_to_records(matrix, warnings))
	return results


def _parse_xls(content, warnings):
	import xlrd

	workbook = xlrd.open_workbook(file_contents=content)
	results = []
	for worksheet in workbook.sheets():
		matrix = []
		for row_index in range(worksheet.nrows):
			row = []
			for column_index in range(worksheet.ncols):
				cell = worksheet.cell(row_index, column_index)
				if cell.ctype == xlrd.XL_CELL_DATE:
					try:
						row.append(xlrd.xldate_as_datetime(cell.value, workbook.datemode))
					except (ValueError, OverflowError):
						row.append(cell.value)
				else:
					row.append(cell.value)
			matrix.append(row)
		results.extend(_header_row_to_records(matrix, warnings, workbook.datemode))
	return results


def _group_tokens_by_x(tokens, tolerance=24):
	groups = []
	for token in sorted(tokens, key=lambda item: item["x"]):
		if not groups or token["x"] - statistics.mean(item["x"] for item in groups[-1]) > tolerance:
			groups.append([token])
		else:
			groups[-1].append(token)
	return groups


def _tokens_to_rows(tokens, image_height, warnings):
	if not tokens:
		return []
	name_tokens = [token for token in tokens if _field_for_header(token["text"]) == "full_name"]
	if not name_tokens:
		return _parse_labeled_text("\n".join(token["text"] for token in sorted(tokens, key=lambda item: (item["y"], item["x"]))), warnings)
	header_y = min(token["y"] for token in name_tokens)
	header_tokens = [token for token in tokens if header_y - 12 <= token["y"] <= header_y + 15 and token["y"] <= image_height * 0.4]
	anchors = {}
	for group in _group_tokens_by_x(header_tokens):
		label = " ".join(token["text"] for token in group)
		field = _field_for_header(label)
		if field:
			anchors[field] = statistics.mean(token["x"] for token in group)
	if "full_name" not in anchors or len(anchors) < 2:
		return _parse_labeled_text("\n".join(token["text"] for token in sorted(tokens, key=lambda item: (item["y"], item["x"]))), warnings)
	header_bottom = max(token["y"] for token in header_tokens)
	heights = [token["height"] for token in tokens if token["height"] > 0]
	row_tolerance = max(4, statistics.median(heights) * 0.75) if heights else 6
	body_tokens = [token for token in tokens if token["y"] > header_bottom + row_tolerance * 0.5]
	row_groups = []
	for token in sorted(body_tokens, key=lambda item: item["y"]):
		if not row_groups or token["y"] - statistics.mean(item["y"] for item in row_groups[-1]) > row_tolerance:
			row_groups.append([token])
		else:
			row_groups[-1].append(token)
	ordered_anchors = sorted(anchors.items(), key=lambda item: item[1])
	results = []
	for row in row_groups:
		cells = {field: [] for field in anchors}
		for token in sorted(row, key=lambda item: item["x"]):
			field, anchor_x = min(ordered_anchors, key=lambda item: abs(item[1] - token["x"]))
			position = ordered_anchors.index((field, anchor_x))
			neighbor_gaps = []
			if position:
				neighbor_gaps.append(anchor_x - ordered_anchors[position - 1][1])
			if position + 1 < len(ordered_anchors):
				neighbor_gaps.append(ordered_anchors[position + 1][1] - anchor_x)
			limit = min(85, min(neighbor_gaps) * 0.55) if neighbor_gaps else 45
			if abs(anchor_x - token["x"]) <= max(14, limit):
				cells[field].append(token["text"])
		source = {field: " ".join(values) for field, values in cells.items() if values}
		if source.get("full_name"):
			record = _normalize_record(source, warnings)
			record["ocr_confidence"] = round(min(token["confidence"] for token in row), 2)
			results.append(record)
	return results


def _ocr_image(image_bytes, warnings):
	import numpy as np
	from PIL import Image
	from rapidocr_onnxruntime import RapidOCR

	try:
		with Image.open(io.BytesIO(image_bytes)) as image:
			image = image.convert("RGB")
			image_height = image.height
			result, _ = RapidOCR()(np.asarray(image))
	except Exception as error:
		raise ImportFormatError(f"Gambar tidak dapat dibaca OCR: {error}") from error
	if not result:
		return []
	tokens = []
	for box, text, confidence in result:
		x_values = [point[0] for point in box]
		y_values = [point[1] for point in box]
		tokens.append({
			"x": statistics.mean(x_values),
			"y": statistics.mean(y_values),
			"height": max(y_values) - min(y_values),
			"text": text,
			"confidence": float(confidence),
		})
	rows = _tokens_to_rows(tokens, image_height, warnings)
	if any(row.get("ocr_confidence", 1) < 0.7 for row in rows):
		warnings.add("Sebagian teks OCR memiliki keyakinan rendah; periksa nama dan nomor identitas sebelum impor.")
	return rows


def _parse_docx(content, warnings):
	from docx import Document

	document = Document(io.BytesIO(content))
	results = []
	for table in document.tables:
		matrix = [[cell.text.strip() for cell in row.cells] for row in table.rows]
		results.extend(_header_row_to_records(matrix, warnings))
	if results:
		return results
	text = "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip())
	return _parse_labeled_text(text, warnings)


def _parse_labeled_text(text, warnings):
	values = {}
	for line in text.splitlines():
		match = re.match(r"\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$", line)
		if not match:
			continue
		field = _field_for_header(match.group(1))
		if field and match.group(2):
			values[field] = match.group(2)
	if values.get("full_name"):
		return [_normalize_record(values, warnings)]
	return []


def _parse_pdf(content, warnings):
	import pymupdf

	results = []
	try:
		document = pymupdf.open(stream=content, filetype="pdf")
	except Exception as error:
		raise ImportFormatError(f"PDF tidak dapat dibuka: {error}") from error
	last_header_fields = None
	for page in document:
		page_results = []
		try:
			for table in page.find_tables().tables:
				matrix = table.extract()
				found = _header_row_to_records(matrix, warnings)
				if found:
					page_header = [_field_for_header(v) for v in matrix[0]] if matrix else []
					if "full_name" in page_header:
						last_header_fields = page_header
					page_results.extend(found)
				elif last_header_fields:
					page_results.extend(_records_with_known_fields(matrix, last_header_fields, warnings))
		except Exception:
			page_results = []
		if page_results:
			results.extend(page_results)
			continue
		words = page.get_text("words")
		if words:
			tokens = [
				{"x": (word[0] + word[2]) / 2, "y": (word[1] + word[3]) / 2,
				 "height": word[3] - word[1], "text": word[4], "confidence": 1.0}
				for word in words
			]
			page_rows = _tokens_to_rows(tokens, page.rect.height, warnings)
			if not page_rows:
				page_rows = _parse_labeled_text(page.get_text("text"), warnings)
			results.extend(page_rows)
		else:
			pixmap = page.get_pixmap(dpi=180, alpha=False)
			results.extend(_ocr_image(pixmap.tobytes("png"), warnings))
	document.close()
	return results


def parse_import_file(filename, content):
	if len(content) > MAX_IMPORT_BYTES:
		raise ImportFormatError("Ukuran file maksimal 60 MB.")
	extension = Path(filename).suffix.lower()
	if extension not in SUPPORTED_EXTENSIONS:
		raise ImportFormatError("Format yang didukung: XLSX, XLS, CSV, DOCX, PDF, PNG, JPG, dan WebP.")
	warnings = set()
	try:
		if extension == ".xlsx":
			rows = _parse_xlsx(content, warnings)
		elif extension == ".xls":
			rows = _parse_xls(content, warnings)
		elif extension == ".csv":
			rows = _parse_csv(content, warnings)
		elif extension == ".docx":
			rows = _parse_docx(content, warnings)
		elif extension == ".pdf":
			rows = _parse_pdf(content, warnings)
		else:
			rows = _ocr_image(content, warnings)
	except ImportFormatError:
		raise
	except Exception as error:
		raise ImportFormatError("File rusak atau isinya tidak sesuai dengan ekstensi file.") from error
	if not rows:
		raise ImportFormatError(
			"Isi file tidak bisa dibaca sebagai tabel warga. Pastikan file bukan kosong dan "
			"memuat kolom nama. Bila judul kolomnya berbeda, ganti judulnya menjadi 'Nama'."
		)
	if any(not row.get("date_of_death") for row in rows):
		warnings.add("Tanggal wafat belum terbaca pada sebagian baris. Baris tetap dapat diimpor dan dilengkapi kemudian.")
	return {"rows": rows, "warnings": sorted(warnings), "filename": Path(filename).name}


def template_xlsx():
	from openpyxl import Workbook
	from openpyxl.styles import Font, PatternFill

	workbook = Workbook()
	worksheet = workbook.active
	worksheet.title = "Data Warga"
	headers = [
		"Nama Lengkap", "Jenis Kelamin", "RT", "RW", "Tanggal Wafat", "Alamat",
		"Nomor Kartu Keluarga", "NIK", "Tempat Lahir", "Tanggal Lahir", "Agama",
		"Nama Anggota Keluarga", "Hubungan Keluarga",
	]
	worksheet.append(headers)
	for cell in worksheet[1]:
		cell.font = Font(bold=True, color="FFFFFF")
		cell.fill = PatternFill("solid", fgColor="174D3C")
	worksheet.freeze_panes = "A2"
	worksheet.auto_filter.ref = f"A1:M1"
	for column, width in enumerate((24, 15, 8, 8, 16, 34, 24, 24, 18, 16, 14, 26, 22), start=1):
		worksheet.column_dimensions[chr(64 + column)].width = width
	for row in worksheet.iter_rows(min_row=2, max_row=1001, min_col=7, max_col=8):
		for cell in row:
			cell.number_format = "@"
	stream = io.BytesIO()
	workbook.save(stream)
	return stream.getvalue()


def contribution_template_xlsx():
	from openpyxl import Workbook
	from openpyxl.styles import Font, PatternFill

	workbook = Workbook()
	worksheet = workbook.active
	worksheet.title = "Daftar Warga Iuran"
	headers = [
		"Nama", "Nomor Kartu Keluarga", "NIK", "RT", "RW", "Jenis Kelamin",
		"Tempat Lahir", "Tanggal Lahir", "Agama", "Hubungan", "No HP",
		"Status", "Alamat Lengkap", "Disetorkan Kepada", "Bulan Iuran",
		"Tanggal Pembayaran", "Nominal Setoran",
	]
	worksheet.append(headers)
	for cell in worksheet[1]:
		cell.font = Font(bold=True, color="FFFFFF")
		cell.fill = PatternFill("solid", fgColor="174D3C")
	worksheet.freeze_panes = "A2"
	worksheet.auto_filter.ref = f"A1:Q1"
	for column, width in enumerate((28, 28, 28, 8, 8, 16, 20, 16, 14, 18, 18, 12, 34, 28, 20, 22, 22), start=1):
		worksheet.column_dimensions[chr(64 + column)].width = width
	for row in worksheet.iter_rows(min_row=2, max_row=1001, min_col=2, max_col=3):
		for cell in row:
			cell.number_format = "@"
	instructions = workbook.create_sheet("Petunjuk")
	instructions.append(["Petunjuk Template Daftar Warga BSK"])
	instructions.append(["Isi satu baris untuk setiap warga sesuai kolom Data BSK. Hubungan, No HP, Alamat, Disetorkan Kepada, Status, dan kolom iuran dapat diisi sesuai kebutuhan."])
	instructions.append(["Tanggal lahir dapat memakai format YYYY-MM-DD atau DD/MM/YYYY."])
	instructions.append(["Kolom Bulan Iuran, Tanggal Pembayaran, dan Nominal Setoran opsional; isi ketiganya bersama-sama untuk mencatat setoran."])
	instructions.append(["Bulan Iuran gunakan format YYYY-MM, tanggal gunakan YYYY-MM-DD atau DD/MM/YYYY, nominal isi angka tanpa pemisah ribuan atau simbol mata uang."])
	instructions.append(["RT dan RW harus berada dalam jumlah wilayah yang diatur di panel admin."])
	instructions.append(["NIK dan Nomor Kartu Keluarga sebaiknya disimpan sebagai teks di Excel."])
	instructions.append(["Foto warga tidak diimpor dari file ini; unggah foto melalui Edit Data Warga."])
	instructions.column_dimensions["A"].width = 110
	instructions["A1"].font = Font(bold=True, color="174D3C")
	stream = io.BytesIO()
	workbook.save(stream)
	return stream.getvalue()


# --- Jenis kelamin ----------------------------------------------------------
GENDER_MAP = {
    "P": "P", "PRIA": "L", "LAKI": "L", "LAKI LAKI": "L", "LAKI-LAKI": "L",
    "LAKI2": "L", "Pria": "L", "WANITA": "P", "PEREMPUAN": "P", "PEREMPUAAN": "P",
    "PERPPUAN": "P", "PR": "L", "J": "L", "JOWO": "L", "JE": "L", "JENIS KELAMIN LAKI": "L",
}
GENDER_BY_KEYWORD = (
    ("LAKI", "L"), ("PRIA", "L"), ("PANTUN", "L"), ("JOWO", "L"), ("PANTUNKER", "L"),
    ("PR", "L"), ("PEREMPUA", "P"), ("WANI", "P"), ("PRIP", "P"), ("PUTRI", "P"),
)


def normalize_gender_value(value):
	"""Petakan berbagai ejaan jenis kelamin ke P atau L."""
	text = str(value or "").strip().upper()
	if not text:
		return ""
	cleaned = re.sub(r"[^A-Z]", "", text)
	if cleaned in ("P", "L"):
		return cleaned
	spaced = re.sub(r"\s+", " ", text.replace("-", " ").replace("_", " ")).strip()
	if spaced in GENDER_MAP:
		return GENDER_MAP[spaced]
	if cleaned in GENDER_MAP:
		return GENDER_MAP[cleaned]
	for keyword, gender in GENDER_BY_KEYWORD:
		if keyword in spaced:
			return gender
	# Kata "J" lazim dipakai untuk.jackson pada kolom ini; perlakukan sebagai L.
	if cleaned.startswith("J"):
		return "L"
	return text


# --- Nomor identitas --------------------------------------------------------
def clean_number_text(value, limit=32):
	"""Buang separator dari nomor KK/NIK dan batasi panjangnya."""
	text = str(value or "")
	digits = re.sub(r"\D", "", text)
	if len(digits) > limit:
		# Nomor hasil OCR bisa menempel dengan digit lain; potong dari depan
		# hanya bila sisa panjangnya tepat sesuai nomor identitas Indonesia.
		if len(digits) == 16:
			digits = digits[-16:]
		else:
			digits = digits[:limit]
	return digits


# --- Tanggal ----------------------------------------------------------------
DATE_TEXT_FORMATS = (
	"%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d",
	"%d/%m/%y", "%d-%m-%y", "%d %B %Y", "%d %b %Y", "%Y%m%d",
)


def _year_from_digits(digits, today=None):
	"""Lengkapi tahun yang hilang digitnya, mis. 79 -> 1979, 969 -> 1969."""
	today = today or date.today()
	current_century = today.year // 100 * 100
	if len(digits) == 4:
		return int(digits)
	if len(digits) == 3:
		# "969" -> 1969, "982" -> 1982
		candidate = 1000 + int(digits)
		if 1900 <= candidate <= today.year + 5:
			return candidate
		candidate = int("1" + digits)
		return candidate if 1900 <= candidate <= today.year + 5 else None
	if len(digits) == 2:
		value = int(digits)
		for century in (current_century, current_century - 100):
			candidate = century + value
			if 1900 <= candidate <= today.year + 5:
				return candidate
		return None
	return None


def _try_build(year, month, day):
	if not year or not month or not day:
		return None
	try:
		return date(year, month, day).isoformat()
	except ValueError:
		return None


def _candidate_splits(numbers):
	"""Kombinasikan potongan angka menjadi (tahun, bulan, hari)."""
	if len(numbers) == 3:
		first, second, third = numbers
		if len(first) == 4:
			return [(first, second, third)]
		return [(third, second, first)]
	if len(numbers) == 2:
		first, second = numbers
		if len(first) == 4:
			return [(first, second, "")]
		return [(second, first, "")]
	return []


def _is_real_date(year, month, day):
	try:
		date(year, month, day)
	except (ValueError, TypeError):
		return False
	return True


def _from_concatenated(digits):
	"""Coba baca gabungan angka sebagai DDMMYYYY, YYYYMMDD, atau YYYYMMDDYY."""
	total = len(digits)
	if not digits.isdigit() or total not in (6, 7, 8):
		return None
	layouts = {
		8: [("%Y%m%d", "dmy"), ("%Y%m%d", "ymd"), ("%d%m%Y", "dmy")],
		7: [("%Y%m%d", "ymd"), ("%d%m%Y", "dmy")],
		6: [("%y%m%d", "dmy"), ("%Y%m%d", "ymd")],
	}
	for format_string, order in layouts[total]:
		try:
			parsed = datetime.strptime(digits, format_string)
		except ValueError:
			continue
		candidate = parsed.date().isoformat()
		if _plausible_age(candidate):
			return candidate
		# some layouts only differ by month/day swap
		if order == "dmy":
			swapped = _swap_month_day(parsed)
			if swapped and _plausible_age(swapped):
				return swapped
	return None


def _swap_month_day(parsed):
	try:
		return date(parsed.year, parsed.day, parsed.month).isoformat()
	except ValueError:
		return None


def _plausible_age(iso_text):
	"""Terima tanggal lahir antara 1900 dan tahun ini."""
	parsed = date.fromisoformat(iso_text)
	age = date.today().year - parsed.year
	return 0 <= age <= 125


def normalize_flexible_date(value, today=None):
	"""Ubah berbagai ejaan tanggal menjadi YYYY-MM-DD.

	Menangani pemisah campuran (/ - . ' spasi), tahun 2-3 digit, dan salah
	ketik akibat OCR seperti "16/101/982" atau "18/081977". Nilai yang tidak
	mungkin ditebak dikembalikan apa adanya supaya Organize bisa reviewing.
	"""
	if isinstance(value, datetime):
		return value.date().isoformat()
	if isinstance(value, date):
		return value.isoformat()
	text = str(value or "").strip()
	if not text:
		return ""
	if not re.search(r"\d", text):
		return ""
	if re.fullmatch(r"0{4}-0{2}-0{2}", text):
		return ""

	for format_string in DATE_TEXT_FORMATS:
		try:
			parsed = datetime.strptime(text, format_string).date().isoformat()
		except ValueError:
			continue
		if _plausible_age(parsed):
			return parsed
		return parsed

	groups = [group for group in re.split(r"[^0-9]+", text) if group]
	if not groups:
		return ""
	numbers = []
	for group in groups:
		if len(group) > 4:
			numbers.append(group[:4])
			numbers.extend(group[4:])
		else:
			numbers.append(group)

	# 1. Susun dari kelompok yang jumlah digitnya wajar.
	if len(numbers) == 3:
		first, second, third = numbers
		if len(first) == 4:
			orders = [(first, second, third)]
		elif len(third) == 4:
			orders = [(third, second, first)]
		elif len(second) == 4:
			orders = [(second, first, third)]
		else:
			orders = [(third, second, first)]
		for year_text, month_text, day_text in orders:
			for year in _year_candidates(year_text, today):
				month = int(month_text) if month_text.isdigit() else 0
				day = int(day_text) if day_text.isdigit() else 0
				if _is_real_date(year, month, day):
					return date(year, month, day).isoformat()
				if _is_real_date(year, day, month):
					return date(year, day, month).isoformat()
		# 2. Kelompok dua atau tiga digit, mis. "123/10/1979" -> 1/23 atau 12/3.
		if len(first) == 3 and first.isdigit():
			for month, day in ((int(first[:1]), int(first[1:])), (int(first[:2]), int(first[2:]))):
				year = _year_from_digits(third, today)
				if year and _is_real_date(year, month, day):
					return date(year, month, day).isoformat()
	if len(numbers) == 2:
		first, second = numbers
		if len(first) == 4 and second.isdigit():
			for month, day in ((int(second[:1]), int(second[1:])), (int(second[:2]), int(second[2:]))):
				if _is_real_date(int(first), month, day):
					return date(int(first), month, day).isoformat()
			return ""
		if len(second) == 4 and first.isdigit():
			for month, day in ((int(first[:1]), int(first[1:])), (int(first[:2]), int(first[2:]))):
				if _is_real_date(int(second), month, day):
					return date(int(second), month, day).isoformat()

	# 3. Semua angka digabung, mis. "16/101/982" -> 16/10/1982.
	joined = "".join(numbers)
	if len(joined) != len(text.replace(" ", "")):
		pass
	candidate = _from_concatenated(joined)
	if candidate:
		return candidate
	# Strip pemisah lalu ulangi.
	return _from_concatenated(re.sub(r"\D", "", text)) or text


def _year_candidates(digits, today=None):
	"""Semua tahun yang masuk akal dari 1-4 digit, terurut."""
	today = today or date.today()
	current_century = today.year // 100 * 100
	if not digits or not digits.isdigit():
		return []
	found = []
	if len(digits) == 4:
		found.append(int(digits))
	elif len(digits) == 3:
		found.extend([int("1" + digits), int(digits) + 1000 * (int(digits[0]) // 10 + 1)])
		found.append(current_century + int(digits))
	elif len(digits) == 2:
		found.extend([current_century + int(digits), current_century - 100 + int(digits)])
	else:
		found.append(int(digits))
	limit = today.year + 5
	return [year for year in dict.fromkeys(found) if 1900 <= year <= limit]
