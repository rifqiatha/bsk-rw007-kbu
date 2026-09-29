import csv
import io
import re
import statistics
from datetime import date, datetime, timedelta
from pathlib import Path


MAX_IMPORT_BYTES = 10 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".xlsx", ".xls", ".csv", ".docx", ".pdf", ".png", ".jpg", ".jpeg", ".webp"}
FIELD_ALIASES = {
	"full_name": {"nama", "nama lengkap", "nama warga", "name", "full name"},
	"gender": {"jenis kelamin", "kelamin", "gender", "sex"},
	"family_card_number": {"nomor kartu keluarga", "no kartu keluarga", "nomor kk", "no kk", "kk"},
	"national_id_number": {"nomor induk kependudukan", "nomor ktp", "no ktp", "nik", "no nik"},
	"rt": {"rt", "rukun tetangga"},
	"rw": {"rw", "rukun warga"},
	"birthplace": {"tempat lahir", "kota lahir"},
	"birth_date": {"tanggal lahir", "tgl lahir", "date of birth"},
	"date_of_death": {
		"tanggal wafat", "tgl wafat", "tanggal meninggal", "tgl meninggal",
		"tanggal kematian", "date of death", "death date",
	},
	"address": {"alamat", "alamat lengkap", "address"},
	"religion": {"agama", "religion"},
	"living_family_name": {"nama keluarga", "nama anggota keluarga", "nama kerabat", "nama keluarga yang hidup"},
	"living_family_relationship": {"hubungan keluarga", "hubungan kerabat", "relationship keluarga", "hubungan"},
}
NORMALIZED_ALIASES = {
	field: {re.sub(r"[^a-z0-9]", "", alias.lower()) for alias in aliases}
	for field, aliases in FIELD_ALIASES.items()
}


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
	for format_string in (
		"%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d",
		"%d/%m/%y", "%d-%m-%y", "%d %B %Y", "%d %b %Y",
	):
		try:
			return datetime.strptime(text, format_string).date().isoformat()
		except ValueError:
			continue
	return text


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
			gender = _text(record[field]).upper().replace("-", " ")
			normalized_gender = re.sub(r"\s+", " ", gender).strip()
			record[field] = {
				"P": "P", "PEREMPUAN": "P", "WANITA": "P",
				"L": "L", "LAKI LAKI": "L", "PRIA": "L",
			}.get(normalized_gender, normalized_gender)
		elif field in ("birth_date", "date_of_death"):
			record[field] = _parse_date(record[field])
		else:
			value = record[field]
			record[field] = _text(value)
			if field in ("family_card_number", "national_id_number") and isinstance(value, (int, float)):
				warnings.add("Nomor KK/NIK yang terbaca sebagai angka Excel mungkin kehilangan digit; verifikasi setiap nomor di pratinjau.")
	if record["living_family_relationship"] and not record["living_family_name"]:
		record["living_family_relationship"] = ""
	return record


def _header_row_to_records(matrix, warnings, datemode=None):
	for row_index, row in enumerate(matrix[:50]):
		fields = [_field_for_header(value) for value in row]
		if "full_name" not in fields or sum(field is not None for field in fields) < 2:
			continue
		results = []
		for values in matrix[row_index + 1:]:
			if not any(_text(value) for value in values):
				continue
			source = {}
			for column_index, field in enumerate(fields):
				if field and column_index < len(values):
					source[field] = values[column_index]
			record = _normalize_record(source, warnings)
			if record["full_name"]:
				results.append(record)
		return results
	return []


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
	for page in document:
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
		raise ImportFormatError("Ukuran file maksimal 10 MB.")
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
		raise ImportFormatError("Tidak menemukan tabel dengan kolom Nama. Gunakan baris judul kolom seperti Nama, RT, RW, dan Tanggal Wafat.")
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