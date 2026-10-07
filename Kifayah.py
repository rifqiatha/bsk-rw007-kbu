import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import unicodedata
from datetime import date, datetime, timezone
from html import escape
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs
from importers import (
	MAX_IMPORT_BYTES, ImportFormatError, contribution_template_xlsx, parse_import_file, template_xlsx,
)


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
DATABASE = BASE_DIR / "kifayah.sqlite3"
UPLOAD_DIR = BASE_DIR / "uploads"
MAX_BODY = 16 * 1024 * 1024
MAX_PAYMENT_PROOF_SIZE = 5 * 1024 * 1024
MAX_HERO_VIDEO_SIZE = 50 * 1024 * 1024
IMAGE_TYPES = {
	"image/png": (".png", b"\x89PNG\r\n\x1a\n"),
	"image/jpeg": (".jpg", b"\xff\xd8\xff"),
	"image/webp": (".webp", b"RIFF"),
}
VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm"}
FONT_PRESETS = {"kifayah", "modern", "classic", "arial", "times", "georgia", "verdana", "tahoma", "trebuchet", "segoe"}
TEXT_ALIGNMENTS = {"left", "center", "justify"}
ROLE_LEVELS = {"Warga": 0, "Staff": 1, "Admin": 2, "Super Admin": 3}
PERMISSION_LABELS = {
	"records": "Data Warga",
	"import": "Impor Data",
	"news": "Berita",
	"area": "RT / RW",
	"family": "Keluarga",
	"media": "Tampilan Situs",
	"maintenance": "Maintenance",
	"typography": "Font & Tipografi",
	"users": "Akun & Jabatan",
	"export": "Ekspor XLSX",
	"payments": "Iuran Warga",
	"program": "Informasi Program",
	"finance": "Data Keuangan",
}
ROLE_PERMISSIONS = {
    "Warga": set(),
	"Staff": {"records"},
	"Admin": {"records", "import", "news", "family", "maintenance", "typography", "payments", "program", "finance"},
	"Super Admin": set(PERMISSION_LABELS),
}
PASSWORD_ITERATIONS = 310_000


def hash_password(password, salt=None):
	salt = salt or secrets.token_bytes(16)
	digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
	return salt.hex(), digest.hex()


def verify_password(password, salt_hex, digest_hex):
	try:
		salt = bytes.fromhex(salt_hex)
	except ValueError:
		return False
	actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS).hex()
	return hmac.compare_digest(actual, digest_hex)
SCHEMA_LOCK = threading.Lock()
SCHEMA_DATABASE = None


def connect_database():
	connection = sqlite3.connect(DATABASE, timeout=30)
	connection.row_factory = sqlite3.Row
	connection.execute("PRAGMA foreign_keys = ON")
	database_path = str(Path(DATABASE).resolve())
	global SCHEMA_DATABASE
	if SCHEMA_DATABASE != database_path:
		with SCHEMA_LOCK:
			if SCHEMA_DATABASE != database_path:
				_initialize_database(connection)
				SCHEMA_DATABASE = database_path
	return connection


# DATABASE: schema creation and safe migrations.
def _initialize_database(connection):
	connection.execute(
		"""CREATE TABLE IF NOT EXISTS records (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			full_name TEXT NOT NULL,
			address TEXT NOT NULL,
			area TEXT NOT NULL,
			date_of_death TEXT NOT NULL,
			publish_address INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)"""
	)
	connection.execute(
		"""CREATE TABLE IF NOT EXISTS app_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)"""
	)
	connection.execute(
		"""CREATE TABLE IF NOT EXISTS admin_users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE COLLATE NOCASE,
			display_name TEXT NOT NULL,
			first_name TEXT NOT NULL DEFAULT '',
			last_name TEXT NOT NULL DEFAULT '',
			phone TEXT NOT NULL DEFAULT '',
			email TEXT NOT NULL DEFAULT '',
			photo_file TEXT NOT NULL DEFAULT '',
			role TEXT NOT NULL,
			password_salt TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			force_password_change INTEGER NOT NULL DEFAULT 1,
			active INTEGER NOT NULL DEFAULT 1,
			permissions TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)"""
	)
	user_columns = {row["name"] for row in connection.execute("PRAGMA table_info(admin_users)")}
	new_user_columns = {
		"first_name": "TEXT NOT NULL DEFAULT ''",
		"last_name": "TEXT NOT NULL DEFAULT ''",
		"phone": "TEXT NOT NULL DEFAULT ''",
		"email": "TEXT NOT NULL DEFAULT ''",
		"photo_file": "TEXT NOT NULL DEFAULT ''",
		"permissions": "TEXT NOT NULL DEFAULT ''",
	}
	for name, definition in new_user_columns.items():
		if name not in user_columns:
			connection.execute(f"ALTER TABLE admin_users ADD COLUMN {name} {definition}")
	if connection.execute("SELECT COUNT(*) FROM admin_users").fetchone()[0] == 0:
		salt, password_hash_value = hash_password("admin")
		connection.execute(
			"INSERT INTO admin_users (username, display_name, role, password_salt, password_hash, force_password_change) "
			"VALUES (?, ?, ?, ?, ?, 1)",
			("admin", "Super Admin", "Super Admin", salt, password_hash_value),
		)
	columns = {row["name"] for row in connection.execute("PRAGMA table_info(records)")}
	new_columns = {
		"gender": "TEXT NOT NULL DEFAULT ''",
		"family_card_number": "TEXT NOT NULL DEFAULT ''",
		"national_id_number": "TEXT NOT NULL DEFAULT ''",
		"birthplace": "TEXT NOT NULL DEFAULT ''",
		"birth_date": "TEXT NOT NULL DEFAULT ''",
		"religion": "TEXT NOT NULL DEFAULT ''",
		"portrait_file": "TEXT NOT NULL DEFAULT ''",
		"publish_portrait": "INTEGER NOT NULL DEFAULT 0",
	}
	for name, definition in new_columns.items():
		if name not in columns:
			connection.execute(f"ALTER TABLE records ADD COLUMN {name} {definition}")
	connection.execute(
		"""CREATE TABLE IF NOT EXISTS family_connections (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			record_id INTEGER NOT NULL,
			full_name TEXT NOT NULL,
			relationship TEXT NOT NULL,
			FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
		)"""
	)
	connection.execute(
		"""CREATE TABLE IF NOT EXISTS resident_payments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			period TEXT NOT NULL,
			amount INTEGER NOT NULL,
			paid_at TEXT NOT NULL,
			method TEXT NOT NULL,
			proof_file TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'Menunggu Verifikasi',
			admin_note TEXT NOT NULL DEFAULT '',
			submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			reviewed_at TEXT NOT NULL DEFAULT '',
			FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
		)"""
	)
	connection.execute(
		"""CREATE TABLE IF NOT EXISTS contribution_residents (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			account_id INTEGER UNIQUE,
			full_name TEXT NOT NULL,
			rt TEXT NOT NULL DEFAULT '',
			rw TEXT NOT NULL DEFAULT '',
			birth_date TEXT NOT NULL DEFAULT '',
			address TEXT NOT NULL DEFAULT '',
			photo_file TEXT NOT NULL DEFAULT '',
			family_card_number TEXT NOT NULL DEFAULT '',
			national_id_number TEXT NOT NULL DEFAULT '',
			birthplace TEXT NOT NULL DEFAULT '',
			religion TEXT NOT NULL DEFAULT '',
			gender TEXT NOT NULL DEFAULT '',
			active INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(account_id) REFERENCES admin_users(id) ON DELETE SET NULL
		)"""
	)
	contribution_columns = {row["name"] for row in connection.execute("PRAGMA table_info(contribution_residents)")}
	if "payment_recipient" not in contribution_columns:
		connection.execute("ALTER TABLE contribution_residents ADD COLUMN payment_recipient TEXT NOT NULL DEFAULT ''")
	for name, definition in {
		"relationship": "TEXT NOT NULL DEFAULT ''",
		"phone": "TEXT NOT NULL DEFAULT ''",
		"residence_status": "TEXT NOT NULL DEFAULT ''",
	}.items():
		if name not in contribution_columns:
			connection.execute(f"ALTER TABLE contribution_residents ADD COLUMN {name} {definition}")
	connection.execute(
		"""CREATE TABLE IF NOT EXISTS contribution_payments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			resident_id INTEGER NOT NULL,
			period TEXT NOT NULL,
			amount INTEGER NOT NULL,
			paid_at TEXT NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(resident_id) REFERENCES contribution_residents(id) ON DELETE CASCADE
		)"""
	)
	connection.execute(
		"INSERT OR IGNORE INTO contribution_residents (account_id, full_name) "
		"SELECT id, display_name FROM admin_users WHERE role = 'Warga'"
	)
	connection.execute(
		"""CREATE TABLE IF NOT EXISTS finance_entries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			entry_date TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			income INTEGER NOT NULL DEFAULT 0,
			expense INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)"""
	)
	connection.execute(
		"""CREATE TABLE IF NOT EXISTS news_articles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			headline TEXT NOT NULL,
			body TEXT NOT NULL,
			author TEXT NOT NULL,
			uploaded_at TEXT NOT NULL,
			image_file TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)"""
	)
	news_columns = {row["name"] for row in connection.execute("PRAGMA table_info(news_articles)")}
	if "image_file" not in news_columns:
		connection.execute("ALTER TABLE news_articles ADD COLUMN image_file TEXT NOT NULL DEFAULT ''")
	connection.executemany(
		"INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
		(
			("rt_count", 1), ("rw_count", 7), ("icon_zoom", 100),
			("site_icon", "ff61a380fc24c3c08ac1b27bbe595a63.webp"),
			("site_icon_2", "logo-transparent-86ccf3f779fb.png"),
			("theme_logo_light", ""), ("theme_logo_dark", ""),
			("hero_image", "1f5a6f509232401123da18defe05c8e7.png"),
			("hero_playlist", "[]"),
			("hero_background_scale", 100),
			("hero_image_position", "right"),
			("site_font_preset", "kifayah"), ("site_font_scale", 100), ("site_text_alignment", "left"),
			("intro_text_alignment", "left"), ("news_text_alignment", "left"), ("directory_text_alignment", "left"),
			("maintenance_enabled", "0"), ("maintenance_starts_at", ""), ("maintenance_ends_at", ""),
			("maintenance_message", "Kami sedang melakukan perbaikan agar layanan lebih baik."),
			("export_logo_1", ""), ("export_logo_2", ""),
			("export_header_title", "DATA BADAN SOSIAL KEMATIAN (BSK)"),
			("export_header_line_2", "RT. 001 RW 007 KELURAHAN KOTA BAMBU UTARA"),
			("export_header_line_3", "KECAMATAN PALMERAH KOTA ADMINISTRASI JAKARTA BARAT"),
			("signature_date", ""), ("signature_maker_name", ""), ("signature_rt_name", ""),
			("signature_lmk_name", ""), ("signature_rw_name", ""), ("signature_bsk_name", ""),
			("signature_maker", ""), ("signature_rt", ""), ("signature_lmk", ""),
			("signature_rw", ""), ("signature_bsk", ""),
			("footer_brand", "Data Kifayah"),
			("footer_area", "Kota Bambu Utara"),
			("footer_location", "RT. 001 RW 007 Kelurahan Kota Bambu Utara"),
			("footer_map_query", "RT. 001 RW 007 Kelurahan Kota Bambu Utara"),
			("donation_title", "Dana Apresiasi"),
			("program_info_title", "Program Badan Sosial Kifayah RW 07"),
			("program_info_content", "Program BSK membantu warga dalam urusan kematian, iuran, santunan, dan pengurusan jenazah. Untuk bantuan, warga dapat menghubungi pengurus RT atau admin BSK."),
			("donation_description", "Dukungan sukarela warga untuk membantu pengelolaan website Data Kifayah."),
			("donation_recipient", ""), ("donation_dana", ""), ("donation_ovo", ""),
			("donation_bank_name", ""), ("donation_bank_account", ""), ("donation_bank_holder", ""),
			("donation_dana_link", ""), ("donation_ovo_link", ""), ("donation_bank_link", ""),
		),
	)
	theme_logo_targets = ("logo1", "logo2", "hero", "slideshow")
	connection.executemany(
		"INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
		[(f"theme_logo_{target}_{mode}", "") for target in theme_logo_targets for mode in ("light", "dark")],
	)
	for mode in ("light", "dark"):
		connection.execute(
			"UPDATE app_settings SET value = (SELECT value FROM app_settings WHERE key = ?) "
			"WHERE key = ? AND value = ''",
			(f"theme_logo_{mode}", f"theme_logo_logo2_{mode}"),
		)
		connection.execute("UPDATE app_settings SET value = '' WHERE key = ?", (f"theme_logo_{mode}",))
	legacy_zoom = connection.execute("SELECT value FROM app_settings WHERE key = 'icon_zoom'").fetchone()[0]
	connection.executemany(
		"INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
		(("icon_zoom_1", legacy_zoom), ("icon_zoom_2", legacy_zoom)),
	)
	connection.execute(
		"UPDATE app_settings SET value = ? WHERE key = 'footer_location' AND value = ?",
		("RT. 001 RW 007 Kelurahan Kota Bambu Utara", "RT. 001 RW 007 KELURAHAN KOTA BAMBU UTARA"),
	)
	connection.commit()


def get_settings(connection):
	settings = {row["key"]: row["value"] for row in connection.execute("SELECT key, value FROM app_settings")}
	settings.setdefault("footer_brand", "Data Kifayah")
	settings.setdefault("footer_area", "Kota Bambu Utara")
	settings.setdefault("footer_location", "RT. 001 RW 007 KELURAHAN KOTA BAMBU UTARA")
	settings.setdefault("footer_map_query", "RT. 001 RW 007 Kelurahan Kota Bambu Utara")
	settings.setdefault("donation_title", "Dana Apresiasi")
	settings.setdefault("donation_description", "Dukungan sukarela warga untuk membantu pengelolaan website Data Kifayah.")
	settings.setdefault("hero_playlist", "[]")
	settings.setdefault("hero_background_scale", 100)
	settings.setdefault("hero_image_position", "right")
	settings.setdefault("site_font_preset", "kifayah")
	settings.setdefault("site_font_scale", 100)
	settings.setdefault("site_text_alignment", "left")
	settings.setdefault("intro_text_alignment", "left")
	settings.setdefault("news_text_alignment", "left")
	settings.setdefault("directory_text_alignment", "left")
	settings.setdefault("maintenance_enabled", "0")
	settings.setdefault("maintenance_starts_at", "")
	settings.setdefault("maintenance_ends_at", "")
	settings.setdefault("maintenance_message", "Kami sedang melakukan perbaikan agar layanan lebih baik.")
	for key in ("donation_recipient", "donation_dana", "donation_ovo", "donation_bank_name", "donation_bank_account", "donation_bank_holder"):
		settings.setdefault(key, "")
	for key in ("donation_dana_link", "donation_ovo_link", "donation_bank_link"):
		settings.setdefault(key, "")
	for key in ("signature_date", "signature_maker_name", "signature_rt_name", "signature_lmk_name", "signature_rw_name", "signature_bsk_name", "signature_maker", "signature_rt", "signature_lmk", "signature_rw", "signature_bsk"):
		settings.setdefault(key, "")
	for key in ("rt_count", "rw_count", "icon_zoom", "icon_zoom_1", "icon_zoom_2", "hero_background_scale", "site_font_scale"):
		settings[key] = int(settings[key])
	return settings


def parse_utc_datetime(value):
	if not isinstance(value, str) or not value.strip():
		return None
	try:
		parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
	except ValueError as error:
		raise ValueError("Tanggal dan jam maintenance tidak valid.") from error
	if parsed.tzinfo is None:
		raise ValueError("Waktu maintenance harus menyertakan zona waktu.")
	return parsed.astimezone(timezone.utc)


def maintenance_is_active(settings, now=None):
	if settings.get("maintenance_enabled") not in (1, "1", True):
		return False
	try:
		starts_at = parse_utc_datetime(settings.get("maintenance_starts_at", ""))
		ends_at = parse_utc_datetime(settings.get("maintenance_ends_at", ""))
	except ValueError:
		return False
	if not starts_at or not ends_at:
		return False
	current_time = now or datetime.now(timezone.utc)
	if current_time.tzinfo is None:
		current_time = current_time.replace(tzinfo=timezone.utc)
	current_time = current_time.astimezone(timezone.utc)
	return starts_at <= current_time < ends_at


def hero_playlist_items(settings):
	try:
		items = json.loads(settings.get("hero_playlist", "[]"))
	except (TypeError, ValueError, json.JSONDecodeError):
		return []
	if not isinstance(items, list):
		return []
	valid_items = []
	for item in items:
		if not isinstance(item, dict):
			continue
		media_id = item.get("id", "")
		filename = item.get("file", "")
		media_type = item.get("type", "")
		if (
			isinstance(media_id, str) and len(media_id) == 32 and all(char in "0123456789abcdef" for char in media_id)
			and isinstance(filename, str) and Path(filename).name == filename
			and media_type in ("image", "video")
		):
			valid_items.append(item)
	return valid_items


def public_hero_playlist(settings):
	return [
		{"id": item["id"], "name": item.get("name", ""), "type": item["type"], "url": f"/media/hero-playlist/{item['id']}"}
		for item in hero_playlist_items(settings)
	]


def delete_upload_if_unreferenced(connection, filename):
	if not filename or Path(filename).name != filename:
		return
	reference = connection.execute(
		"SELECT 1 FROM app_settings WHERE key IN ('site_icon', 'site_icon_2', 'theme_logo_logo1_light', 'theme_logo_logo1_dark', 'theme_logo_logo2_light', 'theme_logo_logo2_dark', 'theme_logo_hero_light', 'theme_logo_hero_dark', 'theme_logo_slideshow_light', 'theme_logo_slideshow_dark', 'hero_image', 'export_logo_1', 'export_logo_2') AND value = ? "
		"UNION ALL SELECT 1 FROM records WHERE portrait_file = ? "
		"UNION ALL SELECT 1 FROM news_articles WHERE image_file = ? "
		"UNION ALL SELECT 1 FROM admin_users WHERE photo_file = ? LIMIT 1",
		(filename, filename, filename, filename),
	).fetchone()
	if reference or any(item["file"] == filename for item in hero_playlist_items(get_settings(connection))):
		return
	try:
		(UPLOAD_DIR / filename).unlink(missing_ok=True)
	except OSError:
		pass


def image_extension(content):
	for content_type, (extension, signature) in IMAGE_TYPES.items():
		if content.startswith(signature):
			if content_type != "image/webp" or content[8:12] == b"WEBP":
				return extension
	return None


def optional_import_area_number(value, label, maximum):
	if value is None or (isinstance(value, str) and not value.strip()):
		return None
	try:
		number = int(value)
	except (ValueError, TypeError):
		raise ValueError(f"{label} harus berupa angka.")
	if isinstance(value, float) and value != number:
		raise ValueError(f"{label} harus berupa angka bulat.")
	if not 1 <= number <= maximum:
		raise ValueError(f"{label} harus 1-{maximum}.")
	return number


def validate_import_row(payload, settings):
	if not isinstance(payload, dict):
		raise ValueError("Baris impor tidak valid.")
	text_fields = {}
	for field in ("full_name", "gender", "date_of_death", "address"):
		value = payload.get(field, "")
		if value is None:
			value = ""
		if not isinstance(value, str):
			raise ValueError("Nama, tanggal wafat, dan alamat harus berupa teks.")
		text_fields[field] = value.strip()
	full_name = text_fields["full_name"].upper()
	gender = text_fields["gender"].upper()
	date_of_death = text_fields["date_of_death"]
	address = text_fields["address"]
	if len(full_name) > 120:
		raise ValueError("Nama maksimal 120 karakter.")
	if gender and gender not in ("P", "L"):
		raise ValueError("Jenis kelamin harus P atau L.")
	if date_of_death and date.fromisoformat(date_of_death).isoformat() != date_of_death:
		raise ValueError("Tanggal wafat harus berformat YYYY-MM-DD.")
	if len(address) > 300:
		raise ValueError("Alamat maksimal 300 karakter.")
	rt = optional_import_area_number(payload.get("rt"), "RT", settings["rt_count"])
	rw = optional_import_area_number(payload.get("rw"), "RW", settings["rw_count"])
	area_parts = []
	if rt is not None:
		area_parts.append(f"RT {rt:03d}")
	if rw is not None:
		area_parts.append(f"RW {rw:03d}")
	private_fields = {
		"family_card_number": (32, "Nomor kartu keluarga"),
		"national_id_number": (32, "NIK"),
		"birthplace": (100, "Tempat lahir"),
		"religion": (50, "Agama"),
		"living_family_name": (120, "Nama anggota keluarga"),
		"living_family_relationship": (60, "Hubungan keluarga"),
	}
	values = {field: payload.get(field, "") for field in private_fields}
	values = {field: "" if value is None else value for field, value in values.items()}
	if not all(isinstance(value, str) for value in values.values()):
		raise ValueError("Detail privat harus berupa teks.")
	for field, (limit, label) in private_fields.items():
		values[field] = values[field].strip()
		if len(values[field]) > limit:
			raise ValueError(f"{label} maksimal {limit} karakter.")
	values["living_family_name"] = values["living_family_name"].upper()
	birth_date = payload.get("birth_date", "")
	if not isinstance(birth_date, str):
		raise ValueError("Tanggal lahir tidak valid.")
	birth_date = birth_date.strip()
	if birth_date and date.fromisoformat(birth_date).isoformat() != birth_date:
		raise ValueError("Tanggal lahir harus berformat YYYY-MM-DD.")
	return {
		"full_name": full_name,
		"gender": gender,
		"date_of_death": date_of_death,
		"address": address,
		"rt": rt,
		"rw": rw,
		"area": " / ".join(area_parts),
		"birth_date": birth_date,
		**values,
	}


def import_duplicate_key(row):
	if not row["full_name"] or not row["date_of_death"]:
		return None
	return (row["full_name"].casefold(), row["area"], row["date_of_death"])


def validate_contribution_import_row(payload, settings):
	if not isinstance(payload, dict):
		raise ValueError("Baris impor warga iuran tidak valid.")
	name = payload.get("full_name", "")
	gender = payload.get("gender", "")
	if not isinstance(name, str) or not isinstance(gender, str):
		raise ValueError("Nama dan jenis kelamin harus berupa teks.")
	name = name.strip().upper()
	gender = gender.strip().upper()
	if not name or len(name) > 120:
		raise ValueError("Nama warga wajib diisi dan maksimal 120 karakter.")
	if gender and gender not in ("L", "P"):
		raise ValueError("Jenis kelamin harus L atau P.")
	rt = optional_import_area_number(payload.get("rt"), "RT", settings["rt_count"])
	rw = optional_import_area_number(payload.get("rw"), "RW", settings["rw_count"])
	fields = {}
	limits = {
		"birth_date": 10, "address": 300, "family_card_number": 32,
		"national_id_number": 32, "birthplace": 100, "religion": 50, "payment_recipient": 120,
		"relationship": 80, "phone": 32, "residence_status": 20,
	}
	for field, limit in limits.items():
		value = payload.get(field, "")
		if value is None:
			value = ""
		if not isinstance(value, str):
			raise ValueError("Kolom profil warga harus berupa teks.")
		value = value.strip()
		if len(value) > limit:
			raise ValueError(f"{field.replace('_', ' ').capitalize()} maksimal {limit} karakter.")
		fields[field] = value
	if fields["residence_status"]:
		status_value = re.sub(r"[^A-Z]", "", fields["residence_status"].upper())
		if status_value in ("KOS", "KOST"):
			fields["residence_status"] = "KOS"
		elif status_value in ("TETAP", "KONTRAK"):
			fields["residence_status"] = status_value
		else:
			raise ValueError("Status harus TETAP, KONTRAK, atau KOS.")
	if fields["birth_date"] and date.fromisoformat(fields["birth_date"]).isoformat() != fields["birth_date"]:
		raise ValueError("Tanggal lahir harus berformat YYYY-MM-DD.")
	period = payload.get("payment_period", "")
	paid_at = payload.get("paid_at", "")
	amount = payload.get("amount", "")
	if period is None:
		period = ""
	if paid_at is None:
		paid_at = ""
	if amount is None:
		amount = ""
	if not isinstance(period, str) or not isinstance(paid_at, str):
		raise ValueError("Bulan atau tanggal setoran tidak valid.")
	period = period.strip()
	paid_at = paid_at.strip()
	if isinstance(amount, str):
		amount = amount.strip()
	has_payment_data = bool(period or paid_at or amount != "")
	if has_payment_data:
		if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
			raise ValueError("Bulan iuran harus berformat YYYY-MM.")
		if not paid_at:
			raise ValueError("Tanggal pembayaran wajib diisi jika setoran dicatat.")
		if date.fromisoformat(paid_at).isoformat() != paid_at:
			raise ValueError("Tanggal pembayaran tidak valid.")
		if isinstance(amount, bool) or not str(amount).isdigit():
			raise ValueError("Nominal setoran harus berupa angka bulat tanpa pemisah.")
		amount = int(amount)
		if not 1 <= amount <= 1_000_000_000_000:
			raise ValueError("Nominal setoran harus lebih besar dari nol dan maksimal Rp1 triliun.")
	else:
		period = ""
		paid_at = ""
		amount = None
	return {
		"full_name": name, "gender": gender,
		"rt": f"{rt:03d}" if rt is not None else "",
		"rw": f"{rw:03d}" if rw is not None else "",
		"payment_period": period, "paid_at": paid_at, "amount": amount,
		**fields,
	}


def contribution_import_keys(row):
	name = " ".join(row["full_name"].casefold().split())
	rt = str(row.get("rt", "")).strip().lstrip("0") or "0"
	rw = str(row.get("rw", "")).strip().lstrip("0") or "0"
	keys = {("resident", name, rt, rw)}
	national_id = re.sub(r"\D", "", str(row.get("national_id_number", "")))
	if national_id:
		keys.add(("nik", national_id))
	return keys


def load_import_existing_keys(connection, destination):
	"""Kumpulan kunci warga yang sudah tersimpan, dipakai untuk menandai duplikat."""
	if destination == "records":
		return {
			(row["full_name"].casefold(), row["area"], row["date_of_death"])
			for row in connection.execute("SELECT full_name, area, date_of_death FROM records")
		}
	existing = set()
	existing_rows = connection.execute(
		"SELECT COALESCE(NULLIF(r.full_name, ''), u.display_name) AS full_name, r.rt, r.rw, r.national_id_number "
		"FROM contribution_residents r LEFT JOIN admin_users u ON u.id = r.account_id WHERE r.active = 1"
	).fetchall()
	for existing_row in existing_rows:
		existing.update(contribution_import_keys(dict(existing_row)))
	return existing


def mark_import_duplicates(destination, rows, settings, existing):
	"""Tandai baris duplikat dan kembalikan daftar peringatan singkat."""
	warnings = []
	for row in rows:
		try:
			validated = validate_import_row(row, settings) if destination == "records" else validate_contribution_import_row(row, settings)
		except (ValueError, TypeError):
			continue
		if destination == "records":
			key = import_duplicate_key(validated)
			row["duplicate"] = key is not None and key in existing
			if row["duplicate"]:
				warnings.append(f"{row['full_name']} sudah ada dengan RT/RW dan tanggal wafat yang sama.")
			elif key is not None:
				existing.add(key)
		else:
			keys = contribution_import_keys(validated)
			has_payment_data = any(row.get(field) not in (None, "") for field in ("payment_period", "paid_at", "amount"))
			row["duplicate"] = not has_payment_data and not existing.isdisjoint(keys)
			if row["duplicate"]:
				warnings.append(f"{row['full_name']} sudah ada di Daftar Warga - Iuran atau tercantum lebih dari sekali.")
			elif not existing.isdisjoint(keys):
				# Warga lama tetap boleh menerima setoran baru yang belum tercatat.
				pass
			else:
				existing.update(keys)
	return warnings


def parse_import_files(files):
	"""Terjemahkan daftar file menjadi satu hasil pratinjau gabungan.
	files: [{"filename": str, "content": bytes}]
	"""
	combined_rows = []
	warnings = set()
	files_summary = []
	total_bytes = 0
	for item in files:
		filename = item["filename"]
		content = item.get("content")
		if not content:
			error = item.get("error") or "File kosong atau tidak dapat dibaca."
			files_summary.append({"filename": filename, "rows": 0, "status": f"gagal: {error}"})
			warnings.add(f"{filename}: {error}")
			continue
		total_bytes += len(content)
		if len(files_summary) >= 500:
			files_summary.append({"filename": "...", "rows": 0, "status": "dilewati"})
			continue
		try:
			parsed = parse_import_file(filename, content)
		except ImportFormatError as error:
			files_summary.append({"filename": filename, "rows": 0, "status": f"gagal: {error}"})
			warnings.add(f"{filename}: {error}")
			continue
		for warning in parsed["warnings"]:
			if "Tanggal wafat belum terbaca" in warning:
				continue
			warnings.add(warning)
		for row in parsed["rows"]:
			row["source_file"] = filename
		combined_rows.extend(parsed["rows"])
		files_summary.append({"filename": filename, "rows": len(parsed["rows"]), "status": "ok"})
	if not combined_rows:
		raise ValueError("Tidak ditemukan tabel dengan kolom Nama pada file yang dipilih.")
	return {
		"rows": combined_rows,
		"warnings": sorted(warnings),
		"filename": f"{len(files)} file",
		"files": files_summary,
		"total_bytes": total_bytes,
	}


class KifayahServer(ThreadingHTTPServer):
	daemon_threads = True

	def __init__(self, server_address, handler_class, admin_password=None):
		super().__init__(server_address, handler_class)
		self.sessions = {}
		self.session_lock = threading.Lock()


class KifayahHandler(BaseHTTPRequestHandler):
	server_version = "Kifayah/1.0"

	def log_message(self, format_string, *args):
		sys.stderr.write("%s - %s\n" % (self.address_string(), format_string % args))

	def send_json(self, status, payload, headers=None):
		body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
		self.send_response(status)
		self.send_header("Content-Type", "application/json; charset=utf-8")
		self.send_header("Content-Length", str(len(body)))
		self.send_header("Cache-Control", "no-store")
		for name, value in (headers or {}).items():
			self.send_header(name, value)
		self.end_headers()
		self.wfile.write(body)

	def maintenance_exempt(self, path):
		if path in ("/admin", "/masuk", "/dashboard-warga", "/api/login", "/api/register", "/api/logout", "/app.js", "/auth.js", "/styles.css", "/auth.css", "/favicon.ico"):
			return True
		if path.startswith(("/admin/", "/api/admin/")):
			return True
		return path.startswith(("/api/", "/media/")) and self.current_user() is not None

	def send_maintenance_page(self, settings):
		ends_at = parse_utc_datetime(settings.get("maintenance_ends_at", ""))
		ends_timestamp = int(ends_at.timestamp() * 1000) if ends_at else 0
		message = escape(settings.get("maintenance_message", "").strip()) or "Kami sedang melakukan perbaikan agar layanan lebih baik."
		font_presets = {
			"kifayah": ('"Hanken Grotesk", system-ui, sans-serif', '"Hanken Grotesk", system-ui, sans-serif'),
			"modern": ('"Hanken Grotesk", system-ui, sans-serif', '"Hanken Grotesk", system-ui, sans-serif'),
			"classic": ('"Segoe UI", Arial, sans-serif', 'Georgia, "Times New Roman", serif'),
			"arial": ("Arial, Helvetica, sans-serif", "Arial, Helvetica, sans-serif"),
			"times": ('"Times New Roman", Times, serif', '"Times New Roman", Times, serif'),
			"georgia": ('Georgia, "Times New Roman", serif', 'Georgia, "Times New Roman", serif'),
			"verdana": ("Verdana, Geneva, sans-serif", "Verdana, Geneva, sans-serif"),
			"tahoma": ("Tahoma, Geneva, sans-serif", "Tahoma, Geneva, sans-serif"),
			"trebuchet": ('"Trebuchet MS", Arial, sans-serif', '"Trebuchet MS", Arial, sans-serif'),
			"segoe": ('"Segoe UI", Arial, sans-serif', '"Segoe UI", Arial, sans-serif'),
		}
		font_body, font_display = font_presets.get(settings.get("site_font_preset"), font_presets["kifayah"])
		font_scale = max(0, min(300, settings.get("site_font_scale", 100))) / 100
		text_alignment = settings.get("site_text_alignment", "left")
		if text_alignment not in TEXT_ALIGNMENTS:
			text_alignment = "left"
		body = (WEB_DIR / "maintenance.html").read_text(encoding="utf-8")
		for placeholder, value in {
			"{{MESSAGE}}": message,
			"{{END_TIMESTAMP}}": str(ends_timestamp),
			"{{FONT_BODY}}": font_body,
			"{{FONT_DISPLAY}}": font_display,
			"{{FONT_SCALE}}": str(font_scale),
			"{{TEXT_ALIGNMENT}}": text_alignment,
		}.items():
			body = body.replace(placeholder, value)
		encoded = body.encode("utf-8")
		self.send_response(503)
		self.send_header("Content-Type", "text/html; charset=utf-8")
		self.send_header("Content-Length", str(len(encoded)))
		self.send_header("Cache-Control", "no-store")
		self.send_header("Retry-After", "60")
		self.end_headers()
		self.wfile.write(encoded)

	def send_stored_media(self, filename):
		if not filename or Path(filename).name != filename:
			self.send_error(404)
			return
		image_path = UPLOAD_DIR / filename
		if not image_path.is_file():
			self.send_error(404)
			return
		content_type = {
			".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
			".mp4": "video/mp4", ".webm": "video/webm", ".pdf": "application/pdf",
		}.get(image_path.suffix)
		if not content_type:
			self.send_error(404)
			return
		content_length = image_path.stat().st_size
		self.send_response(200)
		self.send_header("Content-Type", content_type)
		self.send_header("Content-Length", str(content_length))
		self.send_header("Cache-Control", "no-store")
		self.send_header("X-Content-Type-Options", "nosniff")
		self.end_headers()
		with image_path.open("rb") as image_file:
			while chunk := image_file.read(1024 * 1024):
				self.wfile.write(chunk)

	def send_stored_image(self, filename):
		return self.send_stored_media(filename)

	def handle_media_upload(self):
		try:
			payload = self.read_json()
			kind = payload.get("kind")
			content_type = payload.get("content_type")
			encoded = payload.get("content_base64")
			if kind not in ("site_icon", "site_logos", "theme_logo", "export_logo", "hero_image", "portrait", "user_avatar", "contribution_resident", "signature"):
				raise ValueError("Jenis gambar tidak dikenal.")
			if kind in ("site_icon", "site_logos", "theme_logo", "export_logo", "hero_image") and "media" not in self.current_admin["permissions"]:
				self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengubah tampilan situs."})
				return
			if kind == "portrait" and not ({"family", "media"} & set(self.current_admin["permissions"])):
				self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengelola foto warga."})
				return
			if kind == "user_avatar" and "users" not in self.current_admin["permissions"]:
				self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengelola akun user."})
				return
			if kind == "contribution_resident" and "payments" not in self.current_admin["permissions"]:
				self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengelola data iuran warga."})
				return
			if kind == "signature" and "media" not in self.current_admin["permissions"]:
				self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengubah tanda tangan."})
				return
			if kind == "site_logos":
				logos = payload.get("logos")
				if not isinstance(logos, list) or len(logos) != 2:
					raise ValueError("Pilih tepat dua file logo.")
				validated_logos = []
				for logo in logos:
					if not isinstance(logo, dict) or not isinstance(logo.get("content_type"), str) or not isinstance(logo.get("content_base64"), str):
						raise ValueError("Kedua file logo harus berupa PNG, JPEG, atau WebP.")
					try:
						logo_content = base64.b64decode(logo["content_base64"], validate=True)
					except (binascii.Error, ValueError):
						raise ValueError("Isi salah satu file logo tidak valid.")
					logo_extension = image_extension(logo_content)
					if len(logo_content) > 5 * 1024 * 1024 or not logo_extension:
						raise ValueError("Setiap logo harus berupa PNG, JPEG, atau WebP maksimal 5 MB.")
					validated_logos.append((f"{secrets.token_hex(16)}{logo_extension}", logo_content))
				UPLOAD_DIR.mkdir(exist_ok=True)
				for filename, logo_content in validated_logos:
					(UPLOAD_DIR / filename).write_bytes(logo_content)
				with connect_database() as connection:
					connection.executemany(
						"UPDATE app_settings SET value = ? WHERE key = ?",
						((validated_logos[0][0], "site_icon"), (validated_logos[1][0], "site_icon_2")),
					)
				self.send_json(201, {"urls": ["/media/site-icon", "/media/site-icon/2"]})
				return
			if not isinstance(content_type, str) or not isinstance(encoded, str):
				raise ValueError("Berkas gambar tidak valid.")
			try:
				content = base64.b64decode(encoded, validate=True)
			except (binascii.Error, ValueError):
				raise ValueError("Isi gambar tidak valid.")
			extension = image_extension(content)
			if len(content) > 5 * 1024 * 1024 or not extension:
				raise ValueError("Gunakan gambar PNG, JPEG, atau WebP berukuran maksimal 5 MB.")
			record_id = payload.get("record_id")
			publish_portrait = payload.get("publish_portrait", False)
			site_icon_slot = payload.get("slot", 1)
			theme_logo_target = payload.get("target")
			if kind == "portrait" and (type(record_id) is not int or not isinstance(publish_portrait, bool)):
				raise ValueError("Pilih entri dan izin foto dengan benar.")
			user_id = payload.get("user_id")
			if kind == "user_avatar" and type(user_id) is not int:
				raise ValueError("Pilih akun dengan benar.")
			contribution_resident_id = payload.get("resident_id")
			if kind == "contribution_resident" and type(contribution_resident_id) is not int:
				raise ValueError("Pilih data warga dengan benar.")
			signature_role = payload.get("role")
			if kind == "signature" and signature_role not in ("maker", "rt", "lmk", "rw", "bsk"):
				raise ValueError("Pilih penandatangan yang benar.")
			if kind in ("site_icon", "theme_logo", "export_logo") and (type(site_icon_slot) is not int or site_icon_slot not in (1, 2)):
				raise ValueError("Pilih posisi logo pertama atau kedua.")
			if kind == "theme_logo" and theme_logo_target not in ("logo1", "logo2", "hero", "slideshow"):
				raise ValueError("Pilih bagian logo yang akan menggunakan gambar ini.")
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
			return
		filename = f"{secrets.token_hex(16)}{extension}"
		UPLOAD_DIR.mkdir(exist_ok=True)
		(UPLOAD_DIR / filename).write_bytes(content)
		with connect_database() as connection:
			if kind == "user_avatar":
				user = connection.execute("SELECT photo_file FROM admin_users WHERE id = ?", (user_id,)).fetchone()
				if not user:
					(UPLOAD_DIR / filename).unlink(missing_ok=True)
					self.send_json(404, {"error": "Akun tidak ditemukan."})
					return
				previous_photo = user["photo_file"]
				connection.execute("UPDATE admin_users SET photo_file = ? WHERE id = ?", (filename, user_id))
				if previous_photo:
					(UPLOAD_DIR / previous_photo).unlink(missing_ok=True)
				url = f"/media/admin-user/{user_id}"
			elif kind == "portrait":
				cursor = connection.execute(
					"UPDATE records SET portrait_file = ?, publish_portrait = ? WHERE id = ?",
					(filename, int(publish_portrait), record_id),
				)
				if cursor.rowcount == 0:
					(UPLOAD_DIR / filename).unlink(missing_ok=True)
					self.send_json(404, {"error": "Entri tidak ditemukan."})
					return
				url = f"/media/portrait/{record_id}"
			elif kind == "contribution_resident":
				resident = connection.execute(
					"SELECT photo_file FROM contribution_residents WHERE id = ? AND active = 1",
					(contribution_resident_id,),
				).fetchone()
				if not resident:
					(UPLOAD_DIR / filename).unlink(missing_ok=True)
					self.send_json(404, {"error": "Data warga tidak ditemukan."})
					return
				previous_photo = resident["photo_file"]
				connection.execute("UPDATE contribution_residents SET photo_file = ? WHERE id = ?", (filename, contribution_resident_id))
				if previous_photo:
					delete_upload_if_unreferenced(connection, previous_photo)
				url = f"/media/contribution-resident/{contribution_resident_id}"
			elif kind == "signature":
				setting_key = f"signature_{signature_role}"
				row = connection.execute("SELECT value FROM app_settings WHERE key = ?", (setting_key,)).fetchone()
				previous_signature = row["value"] if row and row["value"] else ""
				connection.execute("UPDATE app_settings SET value = ? WHERE key = ?", (filename, setting_key))
				if previous_signature:
					delete_upload_if_unreferenced(connection, previous_signature)
				url = ""
			else:
				if kind == "site_icon":
					setting_key = "site_icon" if site_icon_slot == 1 else "site_icon_2"
					url = "/media/site-icon" if site_icon_slot == 1 else "/media/site-icon/2"
				elif kind == "theme_logo":
					mode = "light" if site_icon_slot == 1 else "dark"
					setting_key = f"theme_logo_{theme_logo_target}_{mode}"
					url = f"/media/theme-logo/{theme_logo_target}/{mode}"
				elif kind == "export_logo":
					setting_key = f"export_logo_{site_icon_slot}"
					url = ""
				else:
					setting_key = kind
					url = "/media/hero"
				connection.execute("UPDATE app_settings SET value = ? WHERE key = ?", (filename, setting_key))
		self.send_json(201, {"url": url})
	def handle_media_delete(self):
		try:
			payload = self.read_json()
			kind = payload.get("kind")
			if kind not in ("site_icon", "theme_logo", "export_logo", "hero_image", "portrait", "news_image", "user_avatar", "contribution_resident", "signature"):
				raise ValueError("Jenis media tidak dikenal.")
			slot = payload.get("slot", 1)
			if kind in ("site_icon", "theme_logo", "export_logo") and (type(slot) is not int or slot not in (1, 2)):
				raise ValueError("Pilih posisi media yang benar.")
			theme_logo_target = payload.get("target")
			if kind == "theme_logo" and theme_logo_target not in ("logo1", "logo2", "hero", "slideshow"):
				raise ValueError("Pilih bagian logo yang akan dihapus.")
			identifier_key = {"portrait": "record_id", "news_image": "article_id", "user_avatar": "user_id", "contribution_resident": "resident_id"}.get(kind)
			identifier = payload.get(identifier_key) if identifier_key else None
			if identifier_key and type(identifier) is not int:
				raise ValueError("ID data tidak valid.")
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
			return
		permissions = set(self.current_admin["permissions"])
		if kind in ("site_icon", "theme_logo", "export_logo", "hero_image", "signature") and "media" not in permissions:
			self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengubah tampilan situs."})
			return
		if kind == "portrait" and not ({"family", "media"} & permissions):
			self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengelola foto warga."})
			return
		if kind == "news_image" and "news" not in permissions:
			self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengelola foto berita."})
			return
		if kind == "user_avatar" and "users" not in permissions:
			self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengelola foto akun."})
			return
		if kind == "contribution_resident" and "payments" not in permissions:
			self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengelola foto warga iuran."})
			return
		with connect_database() as connection:
			if kind in ("site_icon", "theme_logo", "export_logo", "hero_image"):
				setting_key = (
					("site_icon" if slot == 1 else "site_icon_2") if kind == "site_icon"
					else (f"theme_logo_{theme_logo_target}_{'light' if slot == 1 else 'dark'}") if kind == "theme_logo"
					else (f"export_logo_{slot}" if kind == "export_logo" else "hero_image")
				)
				row = connection.execute("SELECT value FROM app_settings WHERE key = ?", (setting_key,)).fetchone()
				filename = row["value"] if row else ""
				connection.execute("UPDATE app_settings SET value = '' WHERE key = ?", (setting_key,))
			elif kind == "signature":
				sig_role = payload.get("role")
				if sig_role not in ("maker", "rt", "lmk", "rw", "bsk"):
					raise ValueError("Pilih penandatangan yang benar.")
				row = connection.execute("SELECT value FROM app_settings WHERE key = ?", (f"signature_{sig_role}",)).fetchone()
				filename = row["value"] if row else ""
				connection.execute("UPDATE app_settings SET value = '' WHERE key = ?", (f"signature_{sig_role}",))
			elif kind == "portrait":
				row = connection.execute("SELECT portrait_file FROM records WHERE id = ?", (identifier,)).fetchone()
				if not row:
					self.send_json(404, {"error": "Entri warga tidak ditemukan."})
					return
				filename = row["portrait_file"]
				connection.execute("UPDATE records SET portrait_file = '', publish_portrait = 0 WHERE id = ?", (identifier,))
			elif kind == "news_image":
				row = connection.execute("SELECT image_file FROM news_articles WHERE id = ?", (identifier,)).fetchone()
				if not row:
					self.send_json(404, {"error": "Berita tidak ditemukan."})
					return
				filename = row["image_file"]
				connection.execute("UPDATE news_articles SET image_file = '' WHERE id = ?", (identifier,))
			elif kind == "contribution_resident":
				row = connection.execute("SELECT photo_file FROM contribution_residents WHERE id = ?", (identifier,)).fetchone()
				if not row:
					self.send_json(404, {"error": "Data warga tidak ditemukan."})
					return
				filename = row["photo_file"]
				connection.execute("UPDATE contribution_residents SET photo_file = '' WHERE id = ?", (identifier,))
			else:
				row = connection.execute("SELECT photo_file FROM admin_users WHERE id = ?", (identifier,)).fetchone()
				if not row:
					self.send_json(404, {"error": "Akun tidak ditemukan."})
					return
				filename = row["photo_file"]
				connection.execute("UPDATE admin_users SET photo_file = '' WHERE id = ?", (identifier,))
			delete_upload_if_unreferenced(connection, filename)
		self.send_json(200, {"deleted": bool(filename), "kind": kind})

	def handle_hero_playlist_upload(self):
		try:
			content_length = int(self.headers.get("Content-Length", "0"))
			content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
			if content_length < 1 or content_length > MAX_HERO_VIDEO_SIZE:
				raise ValueError("Ukuran media slideshow maksimal 50 MB per file.")
			content = self.rfile.read(content_length)
			if len(content) != content_length:
				raise ValueError("Unggahan media terputus sebelum selesai.")
			if content_type in IMAGE_TYPES:
				extension = image_extension(content)
				if extension != IMAGE_TYPES[content_type][0]:
					raise ValueError("Isi foto tidak sesuai dengan format file.")
				if content_length > 5 * 1024 * 1024:
					raise ValueError("Ukuran foto slideshow maksimal 5 MB.")
				media_type = "image"
			elif content_type in VIDEO_TYPES:
				extension = VIDEO_TYPES[content_type]
				valid_signature = content[4:8] == b"ftyp" if content_type == "video/mp4" else content.startswith(b"\x1a\x45\xdf\xa3")
				if not valid_signature:
					raise ValueError("Isi video tidak sesuai dengan format MP4/WebM.")
				media_type = "video"
			else:
				raise ValueError("Gunakan foto PNG/JPEG/WebP atau video MP4/WebM.")
			raw_name = unquote(self.headers.get("X-Media-Name", "")).replace("\\", "/")
			media_name = "".join(char for char in Path(raw_name).name if char.isprintable())[:120]
		except (ValueError, TypeError) as error:
			self.send_json(400, {"error": str(error) or "Media slideshow tidak valid."})
			return
		media_id = secrets.token_hex(16)
		filename = f"{media_id}{extension}"
		UPLOAD_DIR.mkdir(exist_ok=True)
		media_path = UPLOAD_DIR / filename
		media_path.write_bytes(content)
		try:
			with connect_database() as connection:
				items = hero_playlist_items(get_settings(connection))
				items.append({
					"id": media_id,
					"file": filename,
					"name": media_name or ("Foto" if media_type == "image" else "Video"),
					"type": media_type,
				})
				connection.execute("UPDATE app_settings SET value = ? WHERE key = 'hero_playlist'", (json.dumps(items, ensure_ascii=False),))
		except (OSError, sqlite3.Error):
			media_path.unlink(missing_ok=True)
			self.send_json(500, {"error": "Media slideshow tidak dapat disimpan."})
			return
		self.send_json(201, {"items": public_hero_playlist(get_settings(connection))})

	def handle_news_image_upload(self, article_id):
		if not self.require_admin("Admin"):
			return
		try:
			content_length = int(self.headers.get("Content-Length", "0"))
			content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
			expected_image = IMAGE_TYPES.get(content_type)
			if content_length < 1 or not expected_image:
				raise ValueError("Pilih foto PNG, JPEG, atau WebP yang valid.")
		except ValueError as error:
			self.send_json(400, {"error": str(error) or "Ukuran foto tidak valid."})
			return
		UPLOAD_DIR.mkdir(exist_ok=True)
		temporary_path = UPLOAD_DIR / f".news-{secrets.token_hex(16)}.upload"
		filename = f"{secrets.token_hex(16)}{expected_image[0]}"
		image_path = UPLOAD_DIR / filename
		remaining = content_length
		signature = b""
		try:
			with temporary_path.open("wb") as image_file:
				while remaining:
					chunk = self.rfile.read(min(1024 * 1024, remaining))
					if not chunk:
						raise ValueError("Unggahan foto terputus sebelum selesai.")
					if len(signature) < 12:
						signature += chunk[:12 - len(signature)]
					image_file.write(chunk)
					remaining -= len(chunk)
			if image_extension(signature) != expected_image[0]:
				raise ValueError("Format isi foto tidak sesuai dengan jenis berkasnya.")
			with connect_database() as connection:
				article = connection.execute("SELECT image_file FROM news_articles WHERE id = ?", (article_id,)).fetchone()
				if not article:
					self.send_json(404, {"error": "Berita tidak ditemukan."})
					return
				os.replace(temporary_path, image_path)
				connection.execute("UPDATE news_articles SET image_file = ? WHERE id = ?", (filename, article_id))
			if article["image_file"]:
				(UPLOAD_DIR / article["image_file"]).unlink(missing_ok=True)
			self.send_json(201, {"image_url": f"/media/news/{article_id}"})
		except ValueError as error:
			image_path.unlink(missing_ok=True)
			self.send_json(400, {"error": str(error) or "Foto tidak valid."})
		except (OSError, sqlite3.Error):
			image_path.unlink(missing_ok=True)
			self.send_json(500, {"error": "Foto tidak dapat disimpan di server."})
		finally:
			temporary_path.unlink(missing_ok=True)

	def read_json(self):
		try:
			length = int(self.headers.get("Content-Length", "0"))
		except ValueError:
			raise ValueError("Ukuran data tidak valid.")
		if length < 1 or length > MAX_BODY:
			raise ValueError("Ukuran data tidak valid.")
		try:
			payload = json.loads(self.rfile.read(length))
		except (json.JSONDecodeError, UnicodeDecodeError):
			raise ValueError("Format data tidak valid.")
		if not isinstance(payload, dict):
			raise ValueError("Format data tidak valid.")
		return payload

	def session_token(self):
		cookie = SimpleCookie()
		try:
			cookie.load(self.headers.get("Cookie", ""))
			return cookie.get("kifayah_session").value if cookie.get("kifayah_session") else ""
		except (KeyError, AttributeError):
			return ""

	# AUTHENTICATION: resolve session identity and enforce role thresholds.
	def current_user(self):
		token = self.session_token()
		with self.server.session_lock:
			session = self.server.sessions.get(token)
			if not session:
				return None
			expires_at = session["expires_at"]
			if expires_at <= time.time():
				self.server.sessions.pop(token, None)
				return None
		with connect_database() as connection:
			row = connection.execute(
				"SELECT id, username, display_name, role, force_password_change, active, permissions "
				"FROM admin_users WHERE id = ?",
				(session["user_id"],),
			).fetchone()
		if not row or not row["active"] or not isinstance(row["role"], str) or not row["role"].strip():
			with self.server.session_lock:
				self.server.sessions.pop(token, None)
			return None
		user = dict(row)
		try:
			configured = set(json.loads(user.pop("permissions") or "[]"))
		except (TypeError, ValueError, json.JSONDecodeError):
			configured = set()
		user["permissions"] = configured or set(ROLE_PERMISSIONS.get(user["role"], set()))
		user["role_level"] = ROLE_LEVELS.get(user["role"], ROLE_LEVELS["Admin"])
		return user

	def is_admin(self):
		return self.current_user() is not None

	def permission_for_path(self):
		path = urlparse(self.path).path
		if path.startswith("/api/admin/users") or path.startswith("/api/admin/media") and "user" in path:
			return "users"
		if path == "/api/admin/export/excel":
			return "export"
		if path == "/api/settings" and self.command == "POST":
			return "area"
		if path == "/api/admin/typography":
			return "typography"
		if path == "/api/admin/maintenance":
			return "maintenance"
		if path.startswith("/api/admin/import"):
			return "import"
		if path.startswith("/api/admin/news"):
			return "news"
		if path.startswith("/api/admin/payments"):
			return "payments"
		if path.startswith("/api/admin/contribution-residents") or path.startswith("/api/admin/contribution-payments"):
			return "payments"
		if path.startswith("/api/admin/program-info"):
			return "program"
		if path.startswith("/api/admin/finance"):
			return "finance"
		if path.startswith("/api/admin/family") or path == "/api/admin/record-details":
			return "family"
		if path.startswith("/api/admin/hero-playlist"):
			return "media"
		if path.startswith("/api/admin/media"):
			if path == "/api/admin/media" and self.command in ("POST", "DELETE"):
				return None
			return "media"
		if path.startswith("/api/admin/records") or path in ("/api/admin/record-update", "/api/records"):
			return "records"
		return None

	def require_admin(self, minimum_role="Staff", allow_password_change=False):
		user = self.current_user()
		if not user:
			self.send_json(401, {"error": "Silakan masuk sebagai pengelola."})
			return False
		if user["force_password_change"] and not allow_password_change:
			self.send_json(403, {"error": "Ganti kata sandi sementara sebelum melanjutkan.", "force_password_change": True})
			return False
		if user.get("role_level", ROLE_LEVELS.get(user["role"], ROLE_LEVELS["Admin"])) < ROLE_LEVELS[minimum_role]:
			self.send_json(403, {"error": "Jabatan Anda tidak memiliki akses ke bagian ini."})
			return False
		permission = self.permission_for_path()
		if permission and permission not in user["permissions"]:
			self.send_json(403, {"error": "Akun Anda tidak memiliki izin untuk bagian ini."})
			return False
		self.current_admin = user
		return True

	def require_super_admin(self):
		return self.require_admin("Super Admin")

	def require_resident(self):
		user = self.current_user()
		if not user:
			self.send_json(401, {"error": "Silakan masuk sebagai warga."})
			return False
		if user["role"] != "Warga":
			self.send_json(403, {"error": "Menu ini hanya tersedia untuk akun warga."})
			return False
		if user["force_password_change"]:
			self.send_json(403, {"error": "Ganti password sementara sebelum melanjutkan.", "force_password_change": True})
			return False
		self.current_resident = user
		return True
	# HTTP ROUTES: public reads and authenticated administration.
	def do_GET(self):
		path = urlparse(self.path).path
		if not self.maintenance_exempt(path):
			with connect_database() as connection:
				maintenance_settings = get_settings(connection)
			if maintenance_is_active(maintenance_settings):
				if path.startswith(("/api/", "/media/")):
					self.send_json(503, {"error": "Situs sedang maintenance.", "maintenance": True})
				else:
					self.send_maintenance_page(maintenance_settings)
				return
		if path == "/api/records":
			with connect_database() as connection:
				rows = connection.execute(
					"SELECT id, full_name, gender, area, date_of_death, address, publish_address, portrait_file, publish_portrait "
					"FROM records ORDER BY date_of_death DESC, full_name COLLATE NOCASE"
				).fetchall()
			records = []
			for row in rows:
				record = dict(row)
				if record.pop("publish_portrait") and record["portrait_file"]:
					record["portrait_url"] = f"/media/portrait/{record['id']}"
				record.pop("portrait_file", None)
				if not record.pop("publish_address"):
					record.pop("address")
				else:
					record.pop("publish_address", None)
				records.append(record)
			self.send_json(200, {"records": records, "admin": False})
			return
		if path == "/api/news":
			with connect_database() as connection:
				articles = connection.execute(
					"SELECT id, title, headline, body, author, uploaded_at, image_file FROM news_articles "
					"ORDER BY uploaded_at DESC, id DESC"
				).fetchall()
			result = []
			for row in articles:
				article = dict(row)
				article["image_url"] = f"/media/news/{article['id']}" if article.pop("image_file") else ""
				result.append(article)
			self.send_json(200, {"articles": result})
			return
		if path == "/api/resident/program-info":
			if not self.require_resident():
				return
			with connect_database() as connection:
				settings = get_settings(connection)
			self.send_json(200, {"title": settings.get("program_info_title", "Informasi Program BSK"), "content": settings.get("program_info_content", "")})
			return
		if path == "/api/program-info":
			with connect_database() as connection:
				settings = get_settings(connection)
			self.send_json(200, {"title": settings.get("program_info_title", "Informasi Program BSK"), "content": settings.get("program_info_content", "")})
			return
		if path == "/api/resident/finance":
			if not self.require_resident():
				return
			with connect_database() as connection:
				rows = connection.execute("SELECT id, entry_date, title, description, income, expense FROM finance_entries ORDER BY entry_date DESC, id DESC").fetchall()
			self.send_json(200, {"entries": [dict(row) for row in rows]})
			return
		if path == "/api/admin/finance":
			if not self.require_admin("Admin"):
				return
			with connect_database() as connection:
				rows = connection.execute("SELECT id, entry_date, title, description, income, expense FROM finance_entries ORDER BY entry_date DESC, id DESC").fetchall()
			self.send_json(200, {"entries": [dict(row) for row in rows]})
			return
		if path == "/api/resident/payments":
			if not self.require_resident():
				return
			with connect_database() as connection:
				rows = connection.execute(
					"SELECT id, period, amount, paid_at, method, status, admin_note, submitted_at, reviewed_at "
					"FROM resident_payments WHERE user_id = ? ORDER BY period DESC, id DESC",
					(self.current_resident["id"],),
				).fetchall()
			payments = [dict(row) | {"proof_url": f"/media/payment-proof/{row['id']}"} for row in rows]
			self.send_json(200, {"payments": payments})
			return
		if path == "/api/admin/payments":
			if not self.require_admin("Admin"):
				return
			with connect_database() as connection:
				rows = connection.execute(
					"SELECT p.id, p.period, p.amount, p.paid_at, p.method, p.status, p.admin_note, p.submitted_at, "
					"u.display_name, u.username FROM resident_payments p JOIN admin_users u ON u.id = p.user_id "
					"ORDER BY CASE p.status WHEN 'Menunggu Verifikasi' THEN 0 ELSE 1 END, p.submitted_at DESC"
				).fetchall()
			payments = [dict(row) | {"proof_url": f"/media/payment-proof/{row['id']}"} for row in rows]
			self.send_json(200, {"payments": payments})
			return
		if path == "/api/admin/contribution-residents":
			if not self.require_admin("Admin"):
				return
			with connect_database() as connection:
				connection.execute(
					"INSERT OR IGNORE INTO contribution_residents (account_id, full_name) "
					"SELECT id, display_name FROM admin_users WHERE role = 'Warga'"
				)
				residents = connection.execute(
					"SELECT r.*, COALESCE(NULLIF(r.full_name, ''), u.display_name) AS display_name "
					"FROM contribution_residents r LEFT JOIN admin_users u ON u.id = r.account_id "
					"WHERE r.active = 1 ORDER BY display_name COLLATE NOCASE"
				).fetchall()
				manual_payments = connection.execute(
					"SELECT p.id, p.resident_id, p.period, p.amount, p.paid_at, p.note "
					"FROM contribution_payments p ORDER BY p.paid_at DESC, p.id DESC"
				).fetchall()
				account_payments = connection.execute(
					"SELECT r.id AS resident_id, p.id, p.period, p.amount, p.paid_at, p.status, "
					"p.admin_note AS note FROM contribution_residents r "
					"JOIN resident_payments p ON p.user_id = r.account_id "
					"WHERE r.active = 1 ORDER BY p.paid_at DESC, p.id DESC"
				).fetchall()
			by_resident = {row["id"]: [] for row in residents}
			for payment in manual_payments:
				by_resident[payment["resident_id"]].append({
					"id": payment["id"], "period": payment["period"], "amount": payment["amount"],
					"paid_at": payment["paid_at"], "note": payment["note"], "status": "Terverifikasi",
					"source": "admin", "editable": True, "deletable": True,
				})
			for payment in account_payments:
				by_resident[payment["resident_id"]].append({
					"id": payment["id"], "period": payment["period"], "amount": payment["amount"],
					"paid_at": payment["paid_at"], "note": payment["note"], "status": payment["status"],
					"source": "account", "editable": True, "deletable": False,
					"proof_url": f"/media/payment-proof/{payment['id']}",
				})
			result = []
			current_period = date.today().strftime("%Y-%m")
			for row in residents:
				payments = sorted(by_resident[row["id"]], key=lambda item: (item["paid_at"], item["id"]), reverse=True)
				verified = [item for item in payments if item["status"] == "Terverifikasi"]
				result.append({
					"id": row["id"], "account_id": row["account_id"], "full_name": row["display_name"],
					"rt": str(int(row["rt"])) if row["rt"].isdigit() else "",
					"rw": str(int(row["rw"])) if row["rw"].isdigit() else "", "birth_date": row["birth_date"],
					"payment_recipient": row["payment_recipient"],
					"address": row["address"], "family_card_number": row["family_card_number"],
					"national_id_number": row["national_id_number"], "birthplace": row["birthplace"],
					"religion": row["religion"], "gender": row["gender"],
					"relationship": row["relationship"] if "relationship" in row.keys() else "", "phone": row["phone"] if "phone" in row.keys() else "", "residence_status": row["residence_status"] if "residence_status" in row.keys() else "",
					"photo_url": f"/media/contribution-resident/{row['id']}" if row["photo_file"] else "",
					"payment_count": len(verified), "paid_months": len({item["period"] for item in verified}),
					"total_paid": sum(item["amount"] for item in verified),
					"last_paid_at": verified[0]["paid_at"] if verified else "",
					"paid_this_month": any(item["period"] == current_period for item in verified),
					"payments": payments,
				})
			self.send_json(200, {"residents": result})
			return
		if path == "/api/admin/news":
			if not self.require_admin("Admin"):
				return
			with connect_database() as connection:
				articles = connection.execute(
					"SELECT id, title, headline, body, author, uploaded_at, image_file FROM news_articles "
					"ORDER BY uploaded_at DESC, id DESC"
				).fetchall()
			result = []
			for row in articles:
				article = dict(row)
				article["image_url"] = f"/media/news/{article['id']}" if article.pop("image_file") else ""
				result.append(article)
			self.send_json(200, {"articles": result})
			return
		if path == "/api/admin/users":
			if not self.require_super_admin():
				return
			with connect_database() as connection:
				users = connection.execute(
					"SELECT id, username, display_name, first_name, last_name, phone, email, photo_file, role, active, force_password_change, permissions, created_at "
					"FROM admin_users ORDER BY display_name COLLATE NOCASE"
				).fetchall()
			result = []
			for row in users:
				user = dict(row)
				user["avatar_url"] = f"/media/admin-user/{user['id']}" if user.pop("photo_file") else ""
				try:
					configured = set(json.loads(user.pop("permissions") or "[]"))
				except (TypeError, ValueError, json.JSONDecodeError):
					configured = set()
				user["permissions"] = sorted(configured or ROLE_PERMISSIONS[user["role"]])
				result.append(user)
			self.send_json(200, {"users": result})
			return
		if path == "/api/admin/records":
			if not self.require_admin("Staff"):
				return
			with connect_database() as connection:
				if self.current_admin["role"] == "Staff":
					rows = connection.execute(
						"SELECT id, full_name, gender, area, date_of_death, publish_address, portrait_file, publish_portrait "
						"FROM records ORDER BY date_of_death DESC, full_name COLLATE NOCASE"
					).fetchall()
					records = []
					for row in rows:
						record = dict(row)
						if record["publish_portrait"] and record["portrait_file"]:
							record["portrait_url"] = f"/media/portrait/{record['id']}"
						record.pop("portrait_file", None)
						record.pop("publish_portrait", None)
						record.pop("publish_address", None)
						records.append(record)
					self.send_json(200, {"records": records, "role": self.current_admin["role"]})
					return
				rows = connection.execute(
					"SELECT * FROM records ORDER BY date_of_death DESC, full_name COLLATE NOCASE"
				).fetchall()
				family_rows = connection.execute(
					"SELECT id, record_id, full_name, relationship FROM family_connections ORDER BY full_name COLLATE NOCASE"
				).fetchall()
			records = [dict(row) for row in rows]
			family_by_record = {}
			for family_row in family_rows:
				family = dict(family_row)
				record_id = family.pop("record_id")
				family_by_record.setdefault(record_id, []).append(family)
			for record in records:
				record["portrait_url"] = f"/media/portrait/{record['id']}" if record["portrait_file"] else ""
				record["family"] = family_by_record.get(record["id"], [])
			self.send_json(200, {"records": records, "role": self.current_admin["role"]})
			return
		if path == "/api/session":
			user = self.current_user()
			self.send_json(200, {
				"admin": bool(user),
					"user": {"id": user["id"], "username": user["username"], "display_name": user["display_name"], "role": user["role"], "permissions": sorted(user["permissions"])} if user else None,
				"force_password_change": bool(user and user["force_password_change"]),
			})
			return
		if path == "/api/admin/import/template.xlsx":
			if not self.require_admin("Admin"):
				return
			body = template_xlsx()
			self.send_response(200)
			self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
			self.send_header("Content-Disposition", 'attachment; filename="template-data-kifayah.xlsx"')
			self.send_header("Content-Length", str(len(body)))
			self.send_header("Cache-Control", "no-store")
			self.end_headers()
			self.wfile.write(body)
			return
		if path == "/api/admin/import/template-contributions.xlsx":
			if not self.require_admin("Admin"):
				return
			if "payments" not in self.current_admin["permissions"]:
				self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengimpor daftar warga iuran."})
				return
			body = contribution_template_xlsx()
			self.send_response(200)
			self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
			self.send_header("Content-Disposition", 'attachment; filename="template-daftar-warga-iuran.xlsx"')
			self.send_header("Content-Length", str(len(body)))
			self.send_header("Cache-Control", "no-store")
			self.end_headers()
			self.wfile.write(body)
			return
		if path == "/api/admin/export/excel":
			if not self.require_admin("Admin"):
				return
			parsed = urlparse(self.path)
			query = parse_qs(parsed.query)
			export_type = query.get("type", ["contributions"])[0]
			if export_type == "records":
				from openpyxl import Workbook
				from openpyxl.styles import Font, PatternFill
				workbook = Workbook()
				sheet = workbook.active
				sheet.title = "Data Warga Wafat"
				sheet.append(["NO", "Nama", "Alamat", "Area", "Tanggal Wafat"])
				with connect_database() as connection:
					rows = connection.execute("SELECT full_name, address, area, date_of_death FROM records ORDER BY created_at DESC").fetchall()
				for idx, row in enumerate(rows, start=1):
					sheet.append([idx, row["full_name"], row["address"], row["area"], row["date_of_death"]])
				for cell in sheet[1]:
					cell.font = Font(bold=True, color="FFFFFF")
					cell.fill = PatternFill("solid", fgColor="174D3C")
				stream = io.BytesIO()
				workbook.save(stream)
				body = stream.getvalue()
				self.send_response(200)
				self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
				self.send_header("Content-Disposition", 'attachment; filename="data-wafat.xlsx"')
				self.send_header("Content-Length", str(len(body)))
				self.send_header("Cache-Control", "no-store")
				self.end_headers()
				self.wfile.write(body)
				return
			from openpyxl import Workbook
			from openpyxl.drawing.image import Image as SpreadsheetImage
			from openpyxl.styles import Alignment, Font, PatternFill
			from PIL import Image as PILImage
			import io
			workbook = Workbook()
			residents = workbook.active
			residents.title = "Data BSK"
			identity = workbook.create_sheet("Identitas BSK")
			identity.append(["ID", "Nama", "Nomor Kartu Keluarga", "NIK", "Hubungan", "No HP", "Status", "Alamat", "Disetorkan Kepada"])
			family = workbook.create_sheet("Keluarga")
			family.append(["ID Warga", "Nama Warga", "Nama Anggota Keluarga", "Hubungan"])
			with connect_database() as connection:
				rows = connection.execute(
					"SELECT * FROM contribution_residents WHERE active = 1 ORDER BY rt, rw, full_name COLLATE NOCASE"
				).fetchall()
				family_rows = connection.execute(
					"SELECT family_connections.record_id, records.full_name AS record_name, "
					"family_connections.full_name, family_connections.relationship "
					"FROM family_connections JOIN records ON records.id = family_connections.record_id "
					"ORDER BY records.full_name COLLATE NOCASE, family_connections.full_name COLLATE NOCASE"
				).fetchall()
				export_settings = get_settings(connection)
			for row_index, setting_key in enumerate(
				("export_header_title", "export_header_line_2", "export_header_line_3"), start=1
			):
				residents.merge_cells(start_row=row_index, start_column=2, end_row=row_index, end_column=13)
				cell = residents.cell(row=row_index, column=2, value=export_settings.get(setting_key, ""))
				cell.font = Font(bold=True, size=12 if row_index == 1 else 10)
				cell.alignment = Alignment(horizontal="center", vertical="center")
			residents.row_dimensions[1].height = 25
			residents.row_dimensions[2].height = 21
			residents.row_dimensions[3].height = 21
			residents.row_dimensions[4].height = 9
			for column, width in {
				"A": 6, "B": 28, "C": 28, "D": 32, "E": 7, "F": 7, "G": 14, "H": 18, "I": 16, "J": 14, "K": 20, "L": 18, "M": 12,
			}.items():
				residents.column_dimensions[column].width = width
			logo_buffers = []
			for setting_key, anchor in (("export_logo_1", "A1"), ("export_logo_2", "M1")):
				filename = export_settings.get(setting_key, "")
				if not filename or Path(filename).name != filename:
					continue
				logo_path = UPLOAD_DIR / filename
				if not logo_path.is_file():
					continue
				try:
					with PILImage.open(logo_path) as source_image:
						target_height = 64
						scale = target_height / source_image.height
						if source_image.width * scale > 120:
							scale = 120 / source_image.width
						target_size = (round(source_image.width * scale), round(source_image.height * scale))
						logo_image = source_image.convert("RGBA").resize(target_size, PILImage.Resampling.LANCZOS)
					logo_buffer = io.BytesIO()
					logo_image.save(logo_buffer, format="PNG")
					logo_buffer.seek(0)
					residents.add_image(SpreadsheetImage(logo_buffer), anchor)
					logo_buffers.append(logo_buffer)
				except (OSError, ValueError):
					continue
			for column, value in enumerate(
				["NO", "NAMA", "NOMOR KARTU KELUARGA", "NOMOR INDUK KEPENDUDUKAN", "RT", "RW", "JENIS KELAMIN", "TEMPAT LAHIR", "TANGGAL LAHIR", "AGAMA", "HUBUNGAN", "NO HP", "STATUS"],
				start=1,
			):
				residents.cell(row=5, column=column, value=value)
			for index, row in enumerate(rows, start=1):
				birth_date = row["birth_date"]
				if birth_date:
					try:
						birth_date = datetime.strptime(birth_date, "%Y-%m-%d").strftime("%d/%m/%Y")
					except ValueError:
						pass
				residents.append([
					index, row["full_name"], row["family_card_number"], row["national_id_number"],
					row["rt"], row["rw"], row["gender"], row["birthplace"], birth_date,
					row["religion"], row["relationship"] if "relationship" in row.keys() else "", row["phone"] if "phone" in row.keys() else "", row["residence_status"] if "residence_status" in row.keys() else "",
				])
				identity.append([
					row["id"], row["full_name"], row["family_card_number"], row["national_id_number"],
					row["relationship"] if "relationship" in row.keys() else "", row["phone"] if "phone" in row.keys() else "", row["residence_status"] if "residence_status" in row.keys() else "",
					row["address"], row["payment_recipient"] if "payment_recipient" in row.keys() else "",
				])
			for row in family_rows:
				family.append([row["record_id"], row["record_name"], row["full_name"], row["relationship"]])
			anchor_cols = [2, 5, 8, 11, 13]
			sig_row = residents.max_row + 3
			if export_settings.get("signature_date"):
				residents.cell(row=sig_row, column=2, value=export_settings["signature_date"]).font = Font(bold=True, size=11)
			signature_roles = [
				("maker", "YANG MEMBUAT", "signature_maker_name", "signature_maker"),
				("rt", "KETUA RT", "signature_rt_name", "signature_rt"),
				("lmk", "LMK RW.07 KBU", "signature_lmk_name", "signature_lmk"),
				("rw", "KETUA RW.07 KBU", "signature_rw_name", "signature_rw"),
				("bsk", "KETUA BSK RW.07 KBU", "signature_bsk_name", "signature_bsk"),
			]
			for idx, (role, label, name_key, file_key) in enumerate(signature_roles):
				column = anchor_cols[idx]
				residents.cell(row=sig_row + 1, column=column, value=label).font = Font(bold=True, size=9)
				residents.cell(row=sig_row + 5, column=column, value=f"({export_settings.get(name_key, '')})" if export_settings.get(name_key) else "(_______________)").font = Font(size=10)
				signature_file = export_settings.get(file_key, "")
				if signature_file and Path(signature_file).name == signature_file:
					sig_path = UPLOAD_DIR / signature_file
					if sig_path.is_file():
						try:
							with PILImage.open(sig_path) as source_image:
								target_height = 52
								scale = target_height / source_image.height
								if source_image.width * scale > 110:
									scale = 110 / source_image.width
								target_size = (round(source_image.width * scale), round(source_image.height * scale))
								target = source_image.convert("RGBA").resize(target_size, PILImage.Resampling.LANCZOS)
							buf = io.BytesIO()
							target.save(buf, format="PNG")
							buf.seek(0)
							residents.add_image(SpreadsheetImage(buf), f"{chr(64 + column)}{sig_row + 2}")
						except (OSError, ValueError):
							pass
			residents.row_dimensions[sig_row + 2].height = 60
			for worksheet in workbook.worksheets:
				header_row = 5 if worksheet is residents else 1
				worksheet.freeze_panes = f"A{header_row + 1}"
				worksheet.auto_filter.ref = (
					f"A5:M{max(5, worksheet.max_row)}" if worksheet is residents else worksheet.dimensions
				)
				for cell in worksheet[header_row]:
					cell.font = Font(bold=True, color="FFFFFF")
					cell.fill = PatternFill("solid", fgColor="174D3C")
			stream = io.BytesIO()
			workbook.save(stream)
			body = stream.getvalue()
			self.send_response(200)
			self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
			self.send_header("Content-Disposition", 'attachment; filename="data-kifayah.xlsx"')
			self.send_header("Content-Length", str(len(body)))
			self.send_header("Cache-Control", "no-store")
			self.end_headers()
			self.wfile.write(body)
			return
		if path == "/api/settings":
			with connect_database() as connection:
				settings = get_settings(connection)
			self.send_json(200, {
				"rt_count": settings["rt_count"],
				"rw_count": settings["rw_count"],
				"icon_zoom": settings["icon_zoom"],
				"icon_zoom_1": settings["icon_zoom_1"],
				"icon_zoom_2": settings["icon_zoom_2"],
				"hero_background_scale": settings["hero_background_scale"],
				"hero_image_position": settings["hero_image_position"],
				"site_icon_ready": bool(settings.get("site_icon")),
				"site_icon_2_ready": bool(settings.get("site_icon_2")),
				"theme_logo_ready": {
					target: {mode: bool(settings.get(f"theme_logo_{target}_{mode}")) for mode in ("light", "dark")}
					for target in ("logo1", "logo2", "hero", "slideshow")
				},
				"hero_image_ready": bool(settings.get("hero_image")),
				"hero_playlist": public_hero_playlist(settings),
				"maintenance_enabled": settings.get("maintenance_enabled") == "1",
				"maintenance_starts_at": settings.get("maintenance_starts_at", ""),
				"maintenance_ends_at": settings.get("maintenance_ends_at", ""),
				"maintenance_message": settings.get("maintenance_message", ""),
				"site_font_preset": settings.get("site_font_preset", "kifayah"),
				"site_font_scale": settings["site_font_scale"],
				"site_text_alignment": settings.get("site_text_alignment", "left"),
				"intro_text_alignment": settings.get("intro_text_alignment", "left"),
				"news_text_alignment": settings.get("news_text_alignment", "left"),
				"directory_text_alignment": settings.get("directory_text_alignment", "left"),
				"export_logo_1_ready": bool(settings.get("export_logo_1")),
				"export_logo_2_ready": bool(settings.get("export_logo_2")),
				"export_header_title": settings.get("export_header_title", ""),
				"export_header_line_2": settings.get("export_header_line_2", ""),
				"export_header_line_3": settings.get("export_header_line_3", ""),
			"signature_date": settings.get("signature_date", ""),
			"signature_maker_name": settings.get("signature_maker_name", ""),
			"signature_rt_name": settings.get("signature_rt_name", ""),
			"signature_lmk_name": settings.get("signature_lmk_name", ""),
			"signature_rw_name": settings.get("signature_rw_name", ""),
			"signature_bsk_name": settings.get("signature_bsk_name", ""),
			"signature_maker_ready": bool(settings.get("signature_maker")),
			"signature_rt_ready": bool(settings.get("signature_rt")),
			"signature_lmk_ready": bool(settings.get("signature_lmk")),
			"signature_rw_ready": bool(settings.get("signature_rw")),
			"signature_bsk_ready": bool(settings.get("signature_bsk")),
				"footer_brand": settings.get("footer_brand", ""),
				"footer_area": settings.get("footer_area", ""),
				"footer_location": settings.get("footer_location", ""),
				"footer_map_query": settings.get("footer_map_query", ""),
				"donation_title": settings.get("donation_title", ""),
				"donation_description": settings.get("donation_description", ""),
				"donation_recipient": settings.get("donation_recipient", ""),
				"donation_dana": settings.get("donation_dana", ""),
				"donation_ovo": settings.get("donation_ovo", ""),
				"donation_bank_name": settings.get("donation_bank_name", ""),
				"donation_bank_account": settings.get("donation_bank_account", ""),
				"donation_bank_holder": settings.get("donation_bank_holder", ""),
				"donation_dana_link": settings.get("donation_dana_link", ""),
				"donation_ovo_link": settings.get("donation_ovo_link", ""),
				"donation_bank_link": settings.get("donation_bank_link", ""),
			})
			return
		if path == "/favicon.ico":
			with connect_database() as connection:
				filename = get_settings(connection).get("site_icon", "")
			if filename:
				return self.send_stored_image(filename)
			self.send_response(204)
			self.end_headers()
			return
		if path.startswith("/media/hero-playlist/"):
			media_id = path.rsplit("/", 1)[1]
			with connect_database() as connection:
				item = next((item for item in hero_playlist_items(get_settings(connection)) if item["id"] == media_id), None)
			if not item:
				self.send_error(404)
				return
			return self.send_stored_media(item["file"])
		if path.startswith("/media/theme-logo/"):
			parts = path.strip("/").split("/")
			if len(parts) != 4 or parts[1] != "theme-logo" or parts[2] not in ("logo1", "logo2", "hero", "slideshow") or parts[3] not in ("light", "dark"):
				self.send_error(404)
				return
			key = f"theme_logo_{parts[2]}_{parts[3]}"
			with connect_database() as connection:
				filename = get_settings(connection).get(key, "")
				return self.send_stored_media(filename)
		if path in ("/media/site-icon", "/media/site-icon/2", "/media/hero"):
			key = {"/media/site-icon": "site_icon", "/media/site-icon/2": "site_icon_2", "/media/hero": "hero_image"}[path]
			with connect_database() as connection:
				filename = get_settings(connection).get(key, "")
				return self.send_stored_media(filename)
		if path.startswith("/media/signature/"):
			role = path.rsplit("/", 1)[1]
			if role not in ("maker", "rt", "lmk", "rw", "bsk"):
				self.send_error(404)
				return
			if not self.require_admin("Admin"):
				return
			with connect_database() as connection:
				filename = get_settings(connection).get(f"signature_{role}", "")
			return self.send_stored_image(filename)
		if path.startswith("/media/portrait/"):
			try:
				record_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_error(404)
				return
			with connect_database() as connection:
				record = connection.execute(
					"SELECT portrait_file, publish_portrait FROM records WHERE id = ?", (record_id,)
				).fetchone()
			viewer = self.current_user()
			if not record or (
				not record["publish_portrait"]
				and (not viewer or viewer.get("role_level", ROLE_LEVELS["Admin"]) < ROLE_LEVELS["Admin"])
			):
				self.send_error(404)
				return
			return self.send_stored_image(record["portrait_file"])
		if path.startswith("/media/admin-user/"):
			if not self.require_super_admin():
				return
			try:
				user_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_error(404)
				return
			with connect_database() as connection:
				user = connection.execute("SELECT photo_file FROM admin_users WHERE id = ?", (user_id,)).fetchone()
			if not user or not user["photo_file"]:
				self.send_error(404)
				return
			return self.send_stored_image(user["photo_file"])
		if path.startswith("/media/contribution-resident/"):
			if not self.require_admin("Admin"):
				return
			if "payments" not in self.current_admin["permissions"]:
				self.send_json(403, {"error": "Akun Anda tidak memiliki izin melihat foto warga iuran."})
				return
			try:
				resident_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_error(404)
				return
			with connect_database() as connection:
				resident = connection.execute(
					"SELECT photo_file FROM contribution_residents WHERE id = ? AND active = 1", (resident_id,)
				).fetchone()
			if not resident or not resident["photo_file"]:
				self.send_error(404)
				return
			return self.send_stored_image(resident["photo_file"])
		if path.startswith("/media/news/"):
			try:
				article_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_error(404)
				return
			with connect_database() as connection:
				article = connection.execute("SELECT image_file FROM news_articles WHERE id = ?", (article_id,)).fetchone()
			if not article or not article["image_file"]:
				self.send_error(404)
				return
			return self.send_stored_image(article["image_file"])
		if path.startswith("/media/payment-proof/"):
			try:
				payment_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_error(404)
				return
			viewer = self.current_user()
			if not viewer:
				self.send_json(401, {"error": "Silakan masuk untuk melihat bukti pembayaran."})
				return
			with connect_database() as connection:
				payment = connection.execute(
					"SELECT user_id, proof_file FROM resident_payments WHERE id = ?", (payment_id,)
				).fetchone()
			if not payment or (viewer["role"] == "Warga" and payment["user_id"] != viewer["id"]):
				self.send_error(404)
				return
			if viewer["role"] != "Warga" and "payments" not in viewer["permissions"]:
				self.send_json(403, {"error": "Anda tidak memiliki izin melihat bukti pembayaran."})
				return
			return self.send_stored_media(payment["proof_file"])
		if path.startswith("/media/export_logo/"):
			try:
				slot = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_error(404)
				return
			if slot not in (1, 2):
				self.send_error(404)
				return
			key = f"export_logo_{slot}"
			with connect_database() as connection:
				filename = get_settings(connection).get(key, "")
			return self.send_stored_media(filename)
		if path == "/maintenance.html":
			self.send_error(404)
			return
		if path in ("/masuk", "/dashboard-warga"):
			path = "/login.html"
		if path in ("/", "/admin", "/home", "/berita", "/daftar-warga") or re.fullmatch(r"/berita/[^/]+/?", path):
			path = "/index.html"
		relative = unquote(path).lstrip("/")
		target = (WEB_DIR / relative).resolve()
		if WEB_DIR.resolve() not in target.parents or not target.is_file():
			self.send_error(404)
			return
		content_type = {
			".html": "text/html; charset=utf-8",
			".css": "text/css; charset=utf-8",
			".js": "text/javascript; charset=utf-8",
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".webp": "image/webp",
		}.get(target.suffix, "application/octet-stream")
		body = target.read_bytes()
		self.send_response(200)
		self.send_header("Content-Type", content_type)
		self.send_header("Content-Length", str(len(body)))
		self.send_header("X-Content-Type-Options", "nosniff")
		# Perubahan tampilan harus langsung terlihat tanpa perlu hard refresh.
		self.send_header("Cache-Control", "no-store, must-revalidate")
		self.end_headers()
		self.wfile.write(body)

	# MUTATIONS: login, account management, residents, and settings.
	def do_POST(self):
		path = urlparse(self.path).path
		if path == "/api/admin/contribution-residents":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				resident_id = payload.get("resident_id")
				payment_source = payload.get("payment_source", "admin")
				full_name = payload.get("full_name", "")
				if type(resident_id) is not int and resident_id is not None:
					raise ValueError("Data warga tidak valid.")
				if not isinstance(full_name, str) or not 2 <= len(full_name.strip()) <= 120:
					raise ValueError("Nama warga wajib diisi dan maksimal 120 karakter.")
				area_values = {}
				for key in ("rt", "rw"):
					value = payload.get(key, "")
					if type(value) is int:
						value = str(value)
					if not isinstance(value, str) or (value.strip() and not value.strip().isdigit()):
						raise ValueError("RT dan RW harus berupa angka.")
					area_values[key] = f"{int(value):03d}" if value.strip() and 1 <= int(value) <= 999 else ""
					if value.strip() and not area_values[key]:
						raise ValueError("RT dan RW harus bernilai antara 1-999.")
				fields = {key: payload.get(key, "") for key in (
					"birth_date", "payment_recipient", "address", "family_card_number", "national_id_number",
					"birthplace", "religion", "gender", "relationship", "phone", "residence_status",
				)}
				if not all(isinstance(value, str) for value in fields.values()):
					raise ValueError("Lengkapi data warga dengan format yang benar.")
				fields = {key: value.strip() for key, value in fields.items()}
				if fields["residence_status"]:
					status_value = re.sub(r"[^A-Z]", "", fields["residence_status"].upper())
					fields["residence_status"] = "KOS" if status_value in ("KOS", "KOST") else status_value
					if fields["residence_status"] not in ("TETAP", "KONTRAK", "KOS"):
						raise ValueError("Status harus TETAP, KONTRAK, atau KOS.")
				if fields["birth_date"]:
					if date.fromisoformat(fields["birth_date"]).isoformat() != fields["birth_date"]:
						raise ValueError("Tanggal lahir tidak valid.")
				if len(fields["address"]) > 300 or len(fields["family_card_number"]) > 32 or len(fields["national_id_number"]) > 32:
					raise ValueError("Alamat atau nomor identitas melebihi batas karakter.")
				if len(fields["payment_recipient"]) > 120:
					raise ValueError("Nama penerima setoran maksimal 120 karakter.")
				if len(fields["birthplace"]) > 100 or len(fields["religion"]) > 50 or fields["gender"] not in ("", "P", "L"):
					raise ValueError("Tempat lahir, agama, atau jenis kelamin tidak valid.")
				if len(fields["relationship"]) > 80 or len(fields["phone"]) > 32 or len(fields["residence_status"]) > 20:
					raise ValueError("Hubungan, nomor HP, atau status melebihi batas karakter.")
				with connect_database() as connection:
					values = (
						full_name.strip(), area_values["rt"], area_values["rw"], fields["birth_date"],
						fields["payment_recipient"], fields["address"], fields["family_card_number"], fields["national_id_number"],
						fields["birthplace"], fields["religion"], fields["gender"], fields["relationship"], fields["phone"], fields["residence_status"],
					)
					if resident_id:
						cursor = connection.execute(
							"UPDATE contribution_residents SET full_name = ?, rt = ?, rw = ?, birth_date = ?, payment_recipient = ?, address = ?, "
							"family_card_number = ?, national_id_number = ?, birthplace = ?, religion = ?, gender = ?, relationship = ?, phone = ?, residence_status = ?, "
							"updated_at = CURRENT_TIMESTAMP WHERE id = ? AND active = 1",
							(*values, resident_id),
						)
						if cursor.rowcount == 0:
							self.send_json(404, {"error": "Data warga tidak ditemukan."})
							return
						result_id = resident_id
						status = 200
					else:
						cursor = connection.execute(
							"INSERT INTO contribution_residents (full_name, rt, rw, birth_date, payment_recipient, address, family_card_number, "
							"national_id_number, birthplace, religion, gender, relationship, phone, residence_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", values,
						)
						result_id = cursor.lastrowid
						status = 201
			except (ValueError, TypeError, sqlite3.Error) as error:
				self.send_json(400, {"error": str(error) or "Data warga tidak dapat disimpan."})
				return
			self.send_json(status, {"id": result_id, "saved": True})
			return
		if path == "/api/admin/contribution-payments":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				payment_source = payload.get("payment_source", "admin")
				payment_id = payload.get("payment_id")
				resident_id = payload.get("resident_id")
				paid_at = payload.get("paid_at", "")
				period = payload.get("period", "")
				amount = payload.get("amount")
				note = payload.get("note", "")
				if type(payment_id) is not int and payment_id is not None or type(resident_id) is not int:
					raise ValueError("Pilih data warga yang valid.")
				if payment_source not in ("admin", "account"):
					raise ValueError("Sumber transaksi tidak valid.")
				if not isinstance(paid_at, str) or not isinstance(period, str):
					raise ValueError("Tanggal atau periode pembayaran tidak valid.")
				date.fromisoformat(paid_at)
				if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
					raise ValueError("Pilih bulan iuran yang valid.")
				date.fromisoformat(f"{period}-01")
				if type(amount) is not int or not 1 <= amount <= 1_000_000_000_000:
					raise ValueError("Nominal iuran harus lebih besar dari nol.")
				if not isinstance(note, str) or len(note) > 500:
					raise ValueError("Catatan iuran maksimal 500 karakter.")
				with connect_database() as connection:
					resident = connection.execute(
						"SELECT account_id FROM contribution_residents WHERE id = ? AND active = 1", (resident_id,)
					).fetchone()
					if not resident:
						raise ValueError("Data warga tidak ditemukan.")
					if payment_source == "account":
						if not payment_id or not resident["account_id"]:
							raise ValueError("Transaksi akun warga tidak dapat diedit.")
						cursor = connection.execute(
							"UPDATE resident_payments SET period = ?, amount = ?, paid_at = ? WHERE id = ? AND user_id = ?",
							(period, amount, paid_at, payment_id, resident["account_id"]),
						)
						if cursor.rowcount == 0:
							self.send_json(404, {"error": "Transaksi akun warga tidak ditemukan."})
							return
						result_id = payment_id
						status = 200
					elif payment_id:
						cursor = connection.execute(
							"UPDATE contribution_payments SET resident_id = ?, period = ?, amount = ?, paid_at = ?, note = ? "
							"WHERE id = ?",
							(resident_id, period, amount, paid_at, note.strip(), payment_id),
						)
						if cursor.rowcount == 0:
							self.send_json(404, {"error": "Transaksi iuran tidak ditemukan atau tidak dapat diedit."})
							return
						result_id = payment_id
						status = 200
					else:
						cursor = connection.execute(
							"INSERT INTO contribution_payments (resident_id, period, amount, paid_at, note) VALUES (?, ?, ?, ?, ?)",
							(resident_id, period, amount, paid_at, note.strip()),
						)
						result_id = cursor.lastrowid
						status = 201
			except (ValueError, TypeError, sqlite3.Error) as error:
				self.send_json(400, {"error": str(error) or "Transaksi iuran tidak dapat disimpan."})
				return
			self.send_json(status, {"id": result_id, "saved": True})
			return
		if path == "/api/admin/program-info":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				title = payload.get("title", "")
				content = payload.get("content", "")
				if not isinstance(title, str) or not isinstance(content, str) or not 2 <= len(title.strip()) <= 120 or not 1 <= len(content.strip()) <= 12000:
					raise ValueError("Judul dan informasi program wajib diisi; konten maksimal 12.000 karakter.")
				with connect_database() as connection:
					connection.executemany(
						"INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
						(("program_info_title", title.strip()), ("program_info_content", content.strip())),
					)
			except (ValueError, TypeError, sqlite3.Error) as error:
				self.send_json(400, {"error": str(error) or "Informasi program tidak dapat disimpan."})
				return
			self.send_json(200, {"saved": True})
			return
		if path == "/api/admin/finance":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				entry_date = payload.get("entry_date", "")
				title = payload.get("title", "")
				description = payload.get("description", "")
				entry_type = payload.get("entry_type", "")
				amount = payload.get("amount")
				if not isinstance(entry_date, str):
					raise ValueError("Tanggal transaksi tidak valid.")
				date.fromisoformat(entry_date)
				if not isinstance(title, str) or not 2 <= len(title.strip()) <= 120:
					raise ValueError("Nama transaksi harus terdiri dari 2-120 karakter.")
				if not isinstance(description, str) or len(description) > 1000:
					raise ValueError("Catatan transaksi maksimal 1.000 karakter.")
				if entry_type not in ("income", "expense") or type(amount) is not int or not 1 <= amount <= 1_000_000_000_000:
					raise ValueError("Jenis dan nominal transaksi tidak valid.")
				income, expense = (amount, 0) if entry_type == "income" else (0, amount)
				with connect_database() as connection:
					cursor = connection.execute(
						"INSERT INTO finance_entries (entry_date, title, description, income, expense) VALUES (?, ?, ?, ?, ?)",
						(entry_date, title.strip(), description.strip(), income, expense),
					)
			except (ValueError, TypeError, sqlite3.Error) as error:
				self.send_json(400, {"error": str(error) or "Transaksi tidak dapat disimpan."})
				return
			self.send_json(201, {"id": cursor.lastrowid})
			return
		if path.startswith("/api/admin/news/") and path.endswith("/image"):
			try:
				article_id = int(path.split("/")[-2])
			except ValueError:
				self.send_json(400, {"error": "ID berita tidak valid."})
				return
			return self.handle_news_image_upload(article_id)
		if path == "/api/admin/hero-playlist":
			if not self.require_admin("Admin"):
				return
			return self.handle_hero_playlist_upload()
		if path == "/api/resident/payments":
			if not self.require_resident():
				return
			proof_path = None
			try:
				payload = self.read_json()
				period = payload.get("period", "")
				amount = payload.get("amount")
				paid_at = payload.get("paid_at", "")
				method = payload.get("method", "")
				content_type = payload.get("content_type", "")
				encoded = payload.get("content_base64", "")
				if not isinstance(period, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
					raise ValueError("Pilih periode iuran yang valid.")
				if type(amount) is not int or not 1 <= amount <= 100_000_000:
					raise ValueError("Nominal pembayaran tidak valid.")
				if not isinstance(paid_at, str):
					raise ValueError("Tanggal pembayaran tidak valid.")
				date.fromisoformat(paid_at)
				if method not in ("Transfer Bank", "E-Wallet", "Tunai"):
					raise ValueError("Pilih metode pembayaran yang tersedia.")
				proof_types = {
					"image/png": (".png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
					"image/jpeg": (".jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
					"image/webp": (".webp", lambda data: data.startswith(b"RIFF") and data[8:12] == b"WEBP"),
					"application/pdf": (".pdf", lambda data: data.startswith(b"%PDF-")),
				}
				if content_type not in proof_types or not isinstance(encoded, str) or len(encoded) > 7_000_000:
					raise ValueError("Unggah bukti JPG, PNG, WebP, atau PDF hingga 5 MB.")
				try:
					proof = base64.b64decode(encoded, validate=True)
				except (ValueError, binascii.Error):
					raise ValueError("File bukti pembayaran tidak valid.")
				extension, check_signature = proof_types[content_type]
				if not proof or len(proof) > MAX_PAYMENT_PROOF_SIZE or not check_signature(proof):
					raise ValueError("File bukti pembayaran tidak valid atau melebihi 5 MB.")
				filename = f"payment-{self.current_resident['id']}-{secrets.token_hex(16)}{extension}"
				UPLOAD_DIR.mkdir(exist_ok=True)
				proof_path = UPLOAD_DIR / filename
				proof_path.write_bytes(proof)
				with connect_database() as connection:
					cursor = connection.execute(
						"INSERT INTO resident_payments (user_id, period, amount, paid_at, method, proof_file) VALUES (?, ?, ?, ?, ?, ?)",
						(self.current_resident["id"], period, amount, paid_at, method, filename),
					)
				payment_id = cursor.lastrowid
			except (ValueError, TypeError, OSError, sqlite3.Error) as error:
				if proof_path:
					proof_path.unlink(missing_ok=True)
				self.send_json(400 if isinstance(error, (ValueError, TypeError)) else 500, {"error": str(error) or "Pembayaran tidak dapat disimpan."})
				return
			self.send_json(201, {"id": payment_id, "status": "Menunggu Verifikasi"})
			return
		if path == "/api/admin/payments/review":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				payment_id = payload.get("payment_id")
				decision = payload.get("decision")
				note = payload.get("note", "")
				if type(payment_id) is not int or decision not in ("Terverifikasi", "Ditolak") or not isinstance(note, str) or len(note) > 500:
					raise ValueError("Keputusan verifikasi tidak valid.")
				if decision == "Ditolak" and not note.strip():
					raise ValueError("Isi catatan alasan jika pembayaran ditolak.")
				with connect_database() as connection:
					cursor = connection.execute(
						"UPDATE resident_payments SET status = ?, admin_note = ?, reviewed_at = ? WHERE id = ? AND status = 'Menunggu Verifikasi'",
						(decision, note.strip(), datetime.now(timezone.utc).isoformat(timespec="seconds"), payment_id),
					)
				if cursor.rowcount != 1:
					self.send_json(404, {"error": "Pembayaran tidak ditemukan atau sudah diperiksa."})
					return
			except (ValueError, TypeError, sqlite3.Error) as error:
				self.send_json(400, {"error": str(error) or "Verifikasi tidak dapat disimpan."})
				return
			self.send_json(200, {"saved": True})
			return
		if path == "/api/register":
			try:
				payload = self.read_json()
				full_name = payload.get("full_name", "")
				password = payload.get("password", "")
				if not isinstance(full_name, str) or not isinstance(password, str):
					raise ValueError("Nama dan password harus berupa teks.")
				full_name = " ".join(full_name.split())
				if not 2 <= len(full_name) <= 100:
					raise ValueError("Nama lengkap harus terdiri dari 2-100 karakter.")
				if not 8 <= len(password) <= 256:
					raise ValueError("Password harus terdiri dari 8-256 karakter.")
				slug = unicodedata.normalize("NFKD", full_name).encode("ascii", "ignore").decode("ascii").lower()
				base_username = re.sub(r"[^a-z0-9]+", ".", slug).strip(".")[:32] or "warga"
				with connect_database() as connection:
					username = base_username
					suffix = 2
					while connection.execute("SELECT 1 FROM admin_users WHERE username = ?", (username,)).fetchone():
						username = f"{base_username[:35-len(str(suffix))]}.{suffix}"
						suffix += 1
					salt, password_hash_value = hash_password(password)
					cursor = connection.execute(
						"INSERT INTO admin_users (username, display_name, first_name, role, password_salt, password_hash, force_password_change, permissions) "
						"VALUES (?, ?, ?, 'Warga', ?, ?, 0, '[]')",
						(username, full_name, full_name.split()[0], salt, password_hash_value),
					)
					user_id = cursor.lastrowid
				token = secrets.token_urlsafe(32)
				with self.server.session_lock:
					self.server.sessions[token] = {"user_id": user_id, "expires_at": time.time() + 12 * 60 * 60}
				self.send_json(201, {
					"admin": True,
					"user": {"id": user_id, "username": username, "display_name": full_name, "role": "Warga", "permissions": []},
					"force_password_change": False,
				}, {"Set-Cookie": f"kifayah_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200"})
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error)})
			return
		if path == "/api/login":
			try:
				payload = self.read_json()
				username = payload.get("username", "")
				password = payload.get("password", "")
				if not isinstance(username, str) or not isinstance(password, str):
					raise ValueError("Nama akun dan kata sandi harus berupa teks.")
				with connect_database() as connection:
					user = connection.execute(
						"SELECT id, username, display_name, role, password_salt, password_hash, permissions, "
						"force_password_change FROM admin_users WHERE username = ? AND active = 1",
						(username.strip(),),
					).fetchone()
			except ValueError as error:
				self.send_json(400, {"error": str(error)})
				return
			if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
				self.send_json(401, {"error": "Nama akun atau kata sandi tidak sesuai."})
				return
			token = secrets.token_urlsafe(32)
			with self.server.session_lock:
				self.server.sessions[token] = {"user_id": user["id"], "expires_at": time.time() + 12 * 60 * 60}
			self.send_json(
				200,
				{
					"admin": True,
				"user": {"id": user["id"], "username": user["username"], "display_name": user["display_name"], "role": user["role"], "permissions": sorted(set(json.loads(user["permissions"] or "[]")) or ROLE_PERMISSIONS.get(user["role"], set()))},
					"force_password_change": bool(user["force_password_change"]),
				},
				{"Set-Cookie": f"kifayah_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200"},
			)
			return
		if path == "/api/admin/change-password":
			user = self.current_user()
			if not user:
				self.send_json(401, {"error": "Silakan masuk terlebih dahulu."})
				return
			try:
				payload = self.read_json()
				current_password = payload.get("current_password", "")
				new_password = payload.get("new_password", "")
				if not isinstance(current_password, str) or not isinstance(new_password, str):
					raise ValueError("Kata sandi tidak valid.")
				if not new_password:
					raise ValueError("Kata sandi baru wajib diisi.")
				with connect_database() as connection:
					stored = connection.execute(
						"SELECT password_salt, password_hash FROM admin_users WHERE id = ? AND active = 1",
						(user["id"],),
					).fetchone()
					if not stored or not verify_password(current_password, stored["password_salt"], stored["password_hash"]):
						raise ValueError("Kata sandi saat ini tidak sesuai.")
					salt, password_hash = hash_password(new_password)
					connection.execute(
						"UPDATE admin_users SET password_salt = ?, password_hash = ?, force_password_change = 0 WHERE id = ?",
						(salt, password_hash, user["id"]),
					)
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error)})
				return
			self.send_json(200, {"saved": True})
			return
		if path == "/api/logout":
			token = self.session_token()
			with self.server.session_lock:
				self.server.sessions.pop(token, None)
			self.send_json(
				200,
				{"admin": False},
				{"Set-Cookie": "kifayah_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"},
			)
			return
		if path == "/api/admin/users":
			if not self.require_super_admin():
				return
			try:
				payload = self.read_json()
				username = payload.get("username", "")
				first_name = payload.get("first_name", "")
				last_name = payload.get("last_name", "")
				phone = payload.get("phone", "")
				email = payload.get("email", "")
				display_name = payload.get("display_name", "")
				role = payload.get("role", "")
				password = payload.get("password", "")
				permissions = payload.get("permissions", sorted(ROLE_PERMISSIONS.get(role, set())))
				if not all(isinstance(value, str) for value in (username, first_name, last_name, phone, email, display_name, role, password)) or not isinstance(permissions, list):
					raise ValueError("Periksa kembali data akun.")
				username = username.strip()
				first_name = first_name.strip()
				last_name = last_name.strip()
				phone = phone.strip()
				email = email.strip()
				if not display_name.strip():
					display_name = f"{first_name} {last_name}".strip()
				else:
					display_name = display_name.strip()
				display_name = display_name.strip()
				if not 3 <= len(username) <= 40 or not all(char.isalnum() or char in "._-" for char in username):
					raise ValueError("Username 3-40 karakter; gunakan huruf, angka, titik, garis bawah, atau tanda hubung.")
				if not display_name or len(display_name) > 100:
					raise ValueError("Nama tampilan wajib diisi dan maksimal 100 karakter.")
				if len(first_name) > 60 or len(last_name) > 60 or len(phone) > 32 or len(email) > 254:
					raise ValueError("Panjang data nama atau kontak melebihi batas.")
				if not isinstance(role, str) or not 2 <= len(role.strip()) <= 60:
					raise ValueError("Level atau nama divisi harus 2-60 karakter.")
				role = role.strip()
				permissions = sorted({item for item in permissions if item in PERMISSION_LABELS})
				password = "user"
				salt, password_hash = hash_password(password)
				with connect_database() as connection:
					cursor = connection.execute(
						"INSERT INTO admin_users (username, display_name, first_name, last_name, phone, email, role, password_salt, password_hash, force_password_change, permissions) "
						"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
						(username, display_name, first_name, last_name, phone, email, role, salt, password_hash, json.dumps(permissions)),
					)
			except sqlite3.IntegrityError:
				self.send_json(409, {"error": "Username tersebut sudah digunakan."})
				return
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error)})
				return
			self.send_json(201, {"id": cursor.lastrowid})
			return
		if path == "/api/admin/users/update":
			if not self.require_super_admin():
				return
			try:
				payload = self.read_json()
				user_id = payload.get("user_id")
				display_name = payload.get("display_name", "")
				first_name = payload.get("first_name")
				last_name = payload.get("last_name")
				phone = payload.get("phone")
				email = payload.get("email")
				role = payload.get("role", "")
				active = payload.get("active")
				permissions = payload.get("permissions")
				new_password = payload.get("password", "")
				if type(user_id) is not int or not isinstance(display_name, str) or not isinstance(role, str) or not 2 <= len(role.strip()) <= 60 or not isinstance(active, bool) or not isinstance(permissions, list):
					raise ValueError("Data akun tidak valid.")
				if not isinstance(new_password, str) or len(new_password) > 256:
					raise ValueError("Kata sandi baru tidak valid.")
				new_password = new_password.strip()
				role = role.strip()
				permissions = sorted({item for item in permissions if item in PERMISSION_LABELS})
				if user_id == self.current_admin["id"] and "users" not in permissions:
					raise ValueError("Akun yang sedang digunakan harus tetap memiliki akses Akun & Jabatan.")
				profile_values = (first_name, last_name, phone, email)
				if any(value is not None and not isinstance(value, str) for value in profile_values):
					raise ValueError("Data profil user tidak valid.")
				with connect_database() as connection:
					target = connection.execute(
						"SELECT role, active, first_name, last_name, phone, email FROM admin_users WHERE id = ?",
						(user_id,),
					).fetchone()
					if not target:
						self.send_json(404, {"error": "Akun tidak ditemukan."})
						return
					first_name = first_name.strip() if first_name is not None else target["first_name"]
					last_name = last_name.strip() if last_name is not None else target["last_name"]
					phone = phone.strip() if phone is not None else target["phone"]
					email = email.strip() if email is not None else target["email"]
					if first_name is not None or last_name is not None:
						display_name = f"{first_name} {last_name}".strip()
					else:
						display_name = display_name.strip()
					if not display_name or len(display_name) > 100:
						raise ValueError("Nama tampilan wajib diisi dan maksimal 100 karakter.")
					if len(first_name) > 60 or len(last_name) > 60 or len(phone) > 32 or len(email) > 254:
						raise ValueError("Panjang data nama atau kontak melebihi batas.")
					if ("first_name" in payload or "last_name" in payload) and (not first_name or not last_name):
						raise ValueError("Nama depan dan nama belakang wajib diisi.")
					if target["role"] == "Super Admin" and (role != "Super Admin" or not active):
						remaining = connection.execute(
							"SELECT COUNT(*) FROM admin_users WHERE role = 'Super Admin' AND active = 1"
						).fetchone()[0]
						if remaining <= 1:
							raise ValueError("Tidak dapat menonaktifkan atau menurunkan Super Admin terakhir.")
					connection.execute(
						"UPDATE admin_users SET display_name = ?, first_name = ?, last_name = ?, phone = ?, email = ?, role = ?, active = ?, permissions = ? WHERE id = ?",
						(display_name, first_name, last_name, phone, email, role, int(active), json.dumps(permissions), user_id),
					)
					if new_password:
						salt, password_hash = hash_password(new_password)
						connection.execute(
							"UPDATE admin_users SET password_salt = ?, password_hash = ?, force_password_change = 0 WHERE id = ?",
							(salt, password_hash, user_id),
						)
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error)})
				return
			self.send_json(200, {"saved": True})
			return
		if path == "/api/admin/users/reset-password":
			if not self.require_super_admin():
				return
			try:
				payload = self.read_json()
				user_id = payload.get("user_id")
				new_password = payload.get("new_password", "")
				if type(user_id) is not int or not isinstance(new_password, str):
					raise ValueError("Akun atau kata sandi baru tidak valid.")
				if user_id == self.current_admin["id"]:
					raise ValueError("Gunakan Ganti Kata Sandi untuk mengubah sandi akun sendiri.")
				if not new_password:
					raise ValueError("Kata sandi baru wajib diisi.")
				salt, password_hash = hash_password(new_password)
				with connect_database() as connection:
					cursor = connection.execute(
						"UPDATE admin_users SET password_salt = ?, password_hash = ?, force_password_change = 1 WHERE id = ?",
						(salt, password_hash, user_id),
					)
				if cursor.rowcount == 0:
					self.send_json(404, {"error": "Akun tidak ditemukan."})
					return
				with self.server.session_lock:
					for token, session in list(self.server.sessions.items()):
						if session["user_id"] == user_id:
							self.server.sessions.pop(token, None)
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error)})
				return
			self.send_json(200, {"saved": True})
			return
		if path in ("/api/admin/news", "/api/admin/news/update"):
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				title = payload.get("title", "")
				headline = payload.get("headline", "")
				body = payload.get("body", "")
				author = payload.get("author", "")
				uploaded_at = payload.get("uploaded_at", "")
				if not all(isinstance(value, str) for value in (title, headline, body, author, uploaded_at)):
					raise ValueError("Periksa kembali data berita.")
				title, headline, body, author = (value.strip() for value in (title, headline, body, author))
				if not title or len(title) > 160:
					raise ValueError("Judul berita wajib diisi, maksimal 160 karakter.")
				if not headline or len(headline) > 240:
					raise ValueError("Headline berita wajib diisi, maksimal 240 karakter.")
				if not body or len(body) > 30000:
					raise ValueError("Isi berita wajib diisi, maksimal 30.000 karakter.")
				if not author or len(author) > 100:
					raise ValueError("Nama penulis wajib diisi, maksimal 100 karakter.")
				if not isinstance(uploaded_at, str) or not uploaded_at:
					raise ValueError("Tanggal dan jam unggah berita wajib diisi.")
				uploaded_at = datetime.fromisoformat(uploaded_at).replace(second=0, microsecond=0).isoformat(timespec="minutes")
				with connect_database() as connection:
					if path.endswith("/update"):
						article_id = payload.get("article_id")
						if type(article_id) is not int:
							raise ValueError("ID berita tidak valid.")
						cursor = connection.execute(
							"UPDATE news_articles SET title = ?, headline = ?, body = ?, author = ?, uploaded_at = ? WHERE id = ?",
							(title, headline, body, author, uploaded_at, article_id),
						)
						if cursor.rowcount == 0:
							self.send_json(404, {"error": "Berita tidak ditemukan."})
							return
						self.send_json(200, {"saved": True})
					else:
						cursor = connection.execute(
							"INSERT INTO news_articles (title, headline, body, author, uploaded_at) VALUES (?, ?, ?, ?, ?)",
							(title, headline, body, author, uploaded_at),
						)
						self.send_json(201, {"id": cursor.lastrowid})
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error) or "Format tanggal dan jam berita tidak valid."})
			return
		if path == "/api/admin/typography":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				font_preset = payload.get("font_preset")
				font_scale = payload.get("font_scale")
				intro_alignment = payload.get("intro_text_alignment", payload.get("text_alignment", "left"))
				news_alignment = payload.get("news_text_alignment", payload.get("text_alignment", "left"))
				directory_alignment = payload.get("directory_text_alignment", payload.get("text_alignment", "left"))
				if not isinstance(font_preset, str) or font_preset not in FONT_PRESETS:
					raise ValueError("Pilih preset font yang tersedia.")
				if type(font_scale) is not int or not 0 <= font_scale <= 300:
					raise ValueError("Skala font harus antara 0% dan 300%.")
				alignments = (intro_alignment, news_alignment, directory_alignment)
				if not all(isinstance(value, str) and value in TEXT_ALIGNMENTS for value in alignments):
					raise ValueError("Pilih perataan teks yang tersedia.")
			except ValueError as error:
				self.send_json(400, {"error": str(error)})
				return
			with connect_database() as connection:
				connection.executemany(
					"UPDATE app_settings SET value = ? WHERE key = ?",
					((font_preset, "site_font_preset"), (font_scale, "site_font_scale"),
					 (intro_alignment, "intro_text_alignment"), (news_alignment, "news_text_alignment"),
					 (directory_alignment, "directory_text_alignment"), (intro_alignment, "site_text_alignment")),
				)
			self.send_json(200, {
				"saved": True, "font_preset": font_preset, "font_scale": font_scale,
				"intro_text_alignment": intro_alignment, "news_text_alignment": news_alignment,
				"directory_text_alignment": directory_alignment,
			})
			return
		if path == "/api/admin/maintenance":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				enabled = payload.get("enabled")
				start_value = payload.get("starts_at", "")
				end_value = payload.get("ends_at", "")
				message = payload.get("message", "")
				if type(enabled) is not bool or not isinstance(start_value, str) or not isinstance(end_value, str):
					raise ValueError("Periksa kembali jadwal maintenance.")
				if not isinstance(message, str) or len(message.strip()) > 240:
					raise ValueError("Catatan maintenance maksimal 240 karakter.")
				starts_at = parse_utc_datetime(start_value)
				ends_at = parse_utc_datetime(end_value)
				if enabled and (not starts_at or not ends_at):
					raise ValueError("Waktu mulai dan selesai wajib diisi saat jadwal diaktifkan.")
				if bool(start_value.strip()) != bool(end_value.strip()):
					raise ValueError("Isi waktu mulai dan selesai secara berpasangan.")
				if starts_at and ends_at and ends_at <= starts_at:
					raise ValueError("Waktu selesai harus setelah waktu mulai.")
			except ValueError as error:
				self.send_json(400, {"error": str(error)})
				return
			stored_start = starts_at.isoformat(timespec="seconds").replace("+00:00", "Z") if starts_at else ""
			stored_end = ends_at.isoformat(timespec="seconds").replace("+00:00", "Z") if ends_at else ""
			with connect_database() as connection:
				connection.executemany(
					"UPDATE app_settings SET value = ? WHERE key = ?",
					(("1" if enabled else "0", "maintenance_enabled"),
					 (stored_start, "maintenance_starts_at"),
					 (stored_end, "maintenance_ends_at"),
					 (message.strip(), "maintenance_message")),
				)
			self.send_json(200, {"saved": True, "enabled": enabled, "starts_at": stored_start, "ends_at": stored_end, "message": message.strip()})
			return
		if path == "/api/settings":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				rt_count = payload.get("rt_count")
				rw_count = payload.get("rw_count")
				icon_zoom = payload.get("icon_zoom")
				icon_zoom_1 = payload.get("icon_zoom_1")
				icon_zoom_2 = payload.get("icon_zoom_2")
				hero_background_scale = payload.get("hero_background_scale")
				hero_image_position = payload.get("hero_image_position")
				export_header_values = {}
				for key in ("export_header_title", "export_header_line_2", "export_header_line_3"):
					value = payload.get(key)
					if value is not None:
						if not isinstance(value, str) or len(value) > 160:
							raise ValueError("Teks kop ekspor maksimal 160 karakter per baris.")
						export_header_values[key] = value.strip()
				signature_values = {}
				for key in ("signature_date", "signature_maker_name", "signature_rt_name", "signature_lmk_name", "signature_rw_name", "signature_bsk_name"):
					value = payload.get(key)
					if value is not None:
						if not isinstance(value, str) or len(value) > 120:
							raise ValueError("Teks tanda tangan maksimal 120 karakter per baris.")
						signature_values[key] = value.strip()
				footer_values = {}
				for key in ("footer_brand", "footer_area", "footer_location", "footer_map_query"):
					value = payload.get(key)
					if value is not None:
						if not isinstance(value, str) or len(value) > 180:
							raise ValueError("Teks footer maksimal 180 karakter per bagian.")
						footer_values[key] = value.strip()
				donation_values = {}
				for key in ("donation_title", "donation_description", "donation_recipient", "donation_dana", "donation_ovo", "donation_bank_name", "donation_bank_account", "donation_bank_holder", "donation_dana_link", "donation_ovo_link", "donation_bank_link"):
					value = payload.get(key)
					if value is not None:
						if not isinstance(value, str) or len(value) > 500:
							raise ValueError("Informasi Dana Apresiasi terlalu panjang atau tidak valid.")
						donation_values[key] = value.strip()
				if type(rt_count) is not int or type(rw_count) is not int:
					raise ValueError("Jumlah RT dan RW harus berupa angka bulat.")
				if not 1 <= rt_count <= 999 or not 1 <= rw_count <= 999:
					raise ValueError("Jumlah RT dan RW harus antara 1 dan 999.")
				for zoom in (icon_zoom, icon_zoom_1, icon_zoom_2):
					if zoom is not None and (type(zoom) is not int or not 0 <= zoom <= 300):
						raise ValueError("Skala logo situs harus antara 0% dan 300%.")
				if hero_background_scale is not None and (type(hero_background_scale) is not int or not 0 <= hero_background_scale <= 300):
					raise ValueError("Skala logo Intro harus antara 0% dan 300%.")
				if hero_image_position is not None and hero_image_position not in ("left", "center", "right"):
					raise ValueError("Posisi logo Intro harus kiri, tengah, atau kanan.")
			except ValueError as error:
				self.send_json(400, {"error": str(error)})
				return
			with connect_database() as connection:
				connection.executemany(
					"UPDATE app_settings SET value = ? WHERE key = ?",
					((rt_count, "rt_count"), (rw_count, "rw_count")),
				)
				if icon_zoom is not None:
					icon_zoom_1 = icon_zoom_1 if icon_zoom_1 is not None else icon_zoom
					icon_zoom_2 = icon_zoom_2 if icon_zoom_2 is not None else icon_zoom
					connection.execute("UPDATE app_settings SET value = ? WHERE key = 'icon_zoom'", (icon_zoom,))
				for key, value in (("icon_zoom_1", icon_zoom_1), ("icon_zoom_2", icon_zoom_2), ("hero_background_scale", hero_background_scale)):
					if value is not None:
						connection.execute("UPDATE app_settings SET value = ? WHERE key = ?", (value, key))
				if hero_image_position is not None:
					connection.execute("UPDATE app_settings SET value = ? WHERE key = 'hero_image_position'", (hero_image_position,))
				for key, value in export_header_values.items():
					connection.execute("UPDATE app_settings SET value = ? WHERE key = ?", (value, key))
				for key, value in signature_values.items():
					connection.execute("UPDATE app_settings SET value = ? WHERE key = ?", (value, key))
				for key, value in footer_values.items():
					connection.execute("UPDATE app_settings SET value = ? WHERE key = ?", (value, key))
				for key, value in donation_values.items():
					connection.execute("UPDATE app_settings SET value = ? WHERE key = ?", (value, key))
				settings = get_settings(connection)
			self.send_json(200, {
				"rt_count": rt_count,
				"rw_count": rw_count,
				"icon_zoom": settings["icon_zoom"],
				"icon_zoom_1": settings["icon_zoom_1"],
				"icon_zoom_2": settings["icon_zoom_2"],
				"hero_background_scale": settings["hero_background_scale"],
				"hero_image_position": settings["hero_image_position"],
			})
			return
		if path == "/api/admin/record-details":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				record_id = payload.get("record_id")
				address = payload.get("address")
				publish_address = payload.get("publish_address")
				fields = {
					"gender": payload.get("gender", ""),
					"family_card_number": payload.get("family_card_number", ""),
					"national_id_number": payload.get("national_id_number", ""),
					"birthplace": payload.get("birthplace", ""),
					"birth_date": payload.get("birth_date", ""),
					"religion": payload.get("religion", ""),
				}
				if (
					type(record_id) is not int
					or (address is not None and not isinstance(address, str))
					or (publish_address is not None and not isinstance(publish_address, bool))
					or not all(isinstance(value, str) for value in fields.values())
				):
					raise ValueError("Periksa kembali data identitas.")
				if address is not None and (not address.strip() or len(address) > 300):
					raise ValueError("Alamat wajib diisi dan maksimal 300 karakter.")
				if fields["gender"] not in ("P", "L"):
					raise ValueError("Pilih jenis kelamin P atau L.")
				if len(fields["family_card_number"]) > 32 or len(fields["national_id_number"]) > 32:
					raise ValueError("Nomor identitas terlalu panjang.")
				if len(fields["birthplace"]) > 100 or len(fields["religion"]) > 50:
					raise ValueError("Tempat lahir atau agama terlalu panjang.")
				if fields["birth_date"] and date.fromisoformat(fields["birth_date"]).isoformat() != fields["birth_date"]:
					raise ValueError("Tanggal lahir tidak valid.")
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error) or "Periksa kembali data identitas."})
				return
			with connect_database() as connection:
				cursor = connection.execute(
					"UPDATE records SET gender = ?, address = COALESCE(?, address), "
					"publish_address = COALESCE(?, publish_address), family_card_number = ?, "
					"national_id_number = ?, birthplace = ?, birth_date = ?, religion = ? WHERE id = ?",
					(
						fields["gender"], address,
						int(publish_address) if publish_address is not None else None,
						fields["family_card_number"], fields["national_id_number"], fields["birthplace"],
						fields["birth_date"], fields["religion"], record_id,
					),
				)
			if cursor.rowcount == 0:
				self.send_json(404, {"error": "Entri tidak ditemukan."})
				return
			self.send_json(200, {"saved": True})
			return
		if path == "/api/admin/record-update":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				record_id = payload.get("record_id")
				publish_address = payload.get("publish_address", False)
				if type(record_id) is not int or not isinstance(publish_address, bool):
					raise ValueError("Data entri atau pilihan privasi tidak valid.")
				with connect_database() as connection:
					settings = get_settings(connection)
					row = validate_import_row(payload, settings)
					cursor = connection.execute(
						"UPDATE records SET full_name = ?, gender = ?, address = ?, area = ?, date_of_death = ?, "
						"publish_address = ?, family_card_number = ?, national_id_number = ?, birthplace = ?, "
						"birth_date = ?, religion = ? WHERE id = ?",
						(
							row["full_name"], row["gender"], row["address"], row["area"], row["date_of_death"],
							int(publish_address), row["family_card_number"], row["national_id_number"],
							row["birthplace"], row["birth_date"], row["religion"], record_id,
						),
					)
			except (ValueError, TypeError, sqlite3.Error) as error:
				self.send_json(400, {"error": str(error) or "Data entri tidak valid."})
				return
			if cursor.rowcount == 0:
				self.send_json(404, {"error": "Entri tidak ditemukan."})
				return
			self.send_json(200, {"saved": True})
			return
		if path == "/api/admin/family/update":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				family_id = payload.get("family_id")
				full_name = payload.get("full_name", "")
				relationship = payload.get("relationship", "")
				if type(family_id) is not int or not isinstance(full_name, str) or not isinstance(relationship, str):
					raise ValueError("Data hubungan keluarga tidak valid.")
				full_name = full_name.strip().upper()
				relationship = relationship.strip()
				if (not full_name and not relationship) or len(full_name) > 120 or len(relationship) > 60:
					raise ValueError("Isi nama atau hubungan keluarga; masing-masing memiliki batas karakter.")
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error) or "Data keluarga tidak valid."})
				return
			with connect_database() as connection:
				cursor = connection.execute(
					"UPDATE family_connections SET full_name = ?, relationship = ? WHERE id = ?",
					(full_name, relationship, family_id),
				)
			if cursor.rowcount == 0:
				self.send_json(404, {"error": "Relasi keluarga tidak ditemukan."})
				return
			self.send_json(200, {"saved": True})
			return
		if path.startswith("/api/admin/records/") and path.endswith("/family"):
			if not self.require_admin("Admin"):
				return
			try:
				record_id = int(path.split("/")[4])
				payload = self.read_json()
				full_name = payload.get("full_name", "")
				relationship = payload.get("relationship", "")
				if not isinstance(full_name, str) or not isinstance(relationship, str):
					raise ValueError("Nama dan hubungan keluarga wajib diisi.")
				full_name = full_name.strip().upper()
				relationship = relationship.strip()
				if (not full_name and not relationship) or len(full_name) > 120 or len(relationship) > 60:
					raise ValueError("Isi nama atau hubungan keluarga.")
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error) or "Data keluarga tidak valid."})
				return
			with connect_database() as connection:
				if not connection.execute("SELECT 1 FROM records WHERE id = ?", (record_id,)).fetchone():
					self.send_json(404, {"error": "Entri tidak ditemukan."})
					return
				cursor = connection.execute(
					"INSERT INTO family_connections (record_id, full_name, relationship) VALUES (?, ?, ?)",
					(record_id, full_name, relationship),
				)
			self.send_json(201, {"id": cursor.lastrowid})
			return
		if path == "/api/admin/import/preview":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				destination = payload.get("destination", "records")
				if destination not in ("records", "contributions"):
					raise ValueError("Pilih tujuan impor yang valid.")
				if destination == "contributions" and "payments" not in self.current_admin["permissions"]:
					self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengimpor daftar warga iuran."})
					return
				files = []
				encoded_files = payload.get("files")
				if isinstance(encoded_files, list) and encoded_files:
					# Mode banyak file: [{filename, content_base64}, ...]
					if len(encoded_files) > 500:
						raise ValueError("Maksimal 500 file sekaligus per impor.")
					for item in encoded_files:
						if not isinstance(item, dict):
							continue
						filename = item.get("filename", "")
						encoded = item.get("content_base64", "")
						if not isinstance(filename, str) or not isinstance(encoded, str) or not filename:
							continue
						try:
							content = base64.b64decode(encoded, validate=True)
						except (binascii.Error, ValueError):
							files.append({"filename": filename, "content": b"", "invalid": True})
							continue
						if len(content) > MAX_IMPORT_BYTES:
							files.append({"filename": filename, "content": b"", "too_large": True})
							continue
						files.append({"filename": filename, "content": content})
				else:
					# Mode satu file (tetap didukung)
					filename = payload.get("filename", "")
					encoded = payload.get("content_base64", "")
					if not isinstance(filename, str) or not isinstance(encoded, str):
						raise ValueError("Pilih file yang akan diperiksa.")
					try:
						content = base64.b64decode(encoded, validate=True)
					except (binascii.Error, ValueError):
						raise ValueError("Isi file tidak valid.")
					files = [{"filename": filename, "content": content}]
				if not files:
					raise ValueError("Pilih minimal satu file yang akan diperiksa.")
				clean_files = []
				for item in files:
					if item.get("invalid"):
						clean_files.append({"filename": item["filename"], "content": None, "error": "Isi file tidak valid."})
					elif item.get("too_large"):
						clean_files.append({"filename": item["filename"], "content": None, "error": "Ukuran file maksimal 10 MB."})
					else:
						clean_files.append({"filename": item["filename"], "content": item["content"], "error": None})
				parsed = parse_import_files(clean_files)
				with connect_database() as connection:
					settings = get_settings(connection)
					existing = load_import_existing_keys(connection, destination)
				parsed["warnings"] = sorted(set(parsed["warnings"] + mark_import_duplicates(destination, parsed["rows"], settings, existing)))
			except (ImportFormatError, ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error) or "File tidak dapat diproses."})
				return
			self.send_json(200, parsed)
			return
		if path == "/api/sync/sheets":
			if self.command != "POST":
				self.send_json(405, {"error": "Metode tidak diizinkan."})
				return
			try:
				token = ""
				auth_header = self.headers.get("Authorization", "") or ""
				if auth_header.startswith("Bearer "):
					token = auth_header[len("Bearer "):].strip()
				expected = os.environ.get("SHEETS_SYNC_TOKEN", "")
				if not expected or not secrets.compare_digest(token, expected):
					self.send_json(403, {"error": "Token sinkronisasi tidak valid."})
					return
				payload = self.read_json()
				rows = payload.get("rows")
				if not isinstance(rows, list) or not rows or len(rows) > 2000:
					raise ValueError("Pilih 1 sampai 2000 baris untuk disinkronkan.")
				with connect_database() as connection:
					settings = get_settings(connection)
				validated_rows = []
				for index, row in enumerate(rows, start=1):
					try:
						validated_rows.append(validate_contribution_import_row(row, settings))
					except (ValueError, TypeError) as error:
						raise ValueError(f"Baris {index}: {error}") from error
				with connect_database() as connection:
					resident_ids = {}
					existing_rows = connection.execute(
						"SELECT r.id, COALESCE(NULLIF(r.full_name, ''), u.display_name) AS full_name, r.rt, r.rw, r.national_id_number "
						"FROM contribution_residents r LEFT JOIN admin_users u ON u.id = r.account_id WHERE r.active = 1"
					).fetchall()
					for existing_row in existing_rows:
						for key in contribution_import_keys(dict(existing_row)):
							resident_ids[key] = existing_row["id"]
					payment_keys = {
						(row["resident_id"], row["period"])
						for row in connection.execute("SELECT resident_id, period FROM contribution_payments")
					}
					payment_keys.update(
						(row["resident_id"], row["period"])
						for row in connection.execute(
							"SELECT r.id AS resident_id, p.period FROM contribution_residents r "
							"JOIN resident_payments p ON p.user_id = r.account_id WHERE r.active = 1"
						)
					)
					created = 0
					payments_created = 0
					skipped = 0
					for row in validated_rows:
						keys = contribution_import_keys(row)
						national_id_key = next((key for key in keys if key[0] == "nik"), None)
						resident_key = next((key for key in keys if key[0] == "resident"), None)
						resident_id = resident_ids.get(national_id_key) if national_id_key else None
						if resident_id is None:
							resident_id = resident_ids.get(resident_key) if resident_key else None
						resident_exists = resident_id is not None
						if resident_id is None:
							cursor = connection.execute(
								"INSERT INTO contribution_residents (full_name, rt, rw, birth_date, address, family_card_number, "
								"national_id_number, birthplace, religion, gender, payment_recipient, relationship, phone, residence_status) "
								"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
								(
									row["full_name"], row["rt"], row["rw"], row["birth_date"], row["address"],
									row["family_card_number"], row["national_id_number"], row["birthplace"],
									row["religion"], row["gender"], row["payment_recipient"], row["relationship"] if "relationship" in row else "", row["phone"] if "phone" in row else "", row["residence_status"] if "residence_status" in row else "",
								),
							)
							resident_id = cursor.lastrowid
							created += 1
							for key in keys:
								resident_ids[key] = resident_id
						if row["amount"] is None:
							if resident_exists:
								skipped += 1
							continue
						payment_key = (resident_id, row["payment_period"])
						if payment_key in payment_keys:
							skipped += 1
							continue
						connection.execute(
							"INSERT INTO contribution_payments (resident_id, period, amount, paid_at) VALUES (?, ?, ?, ?)",
							(resident_id, row["payment_period"], row["amount"], row["paid_at"]),
						)
						payment_keys.add(payment_key)
						payments_created += 1
				self.send_json(201, {"created": created, "payments_created": payments_created, "skipped_duplicates": skipped})
				return
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error) or "Sinkronisasi gagal."})
				return
		if path == "/api/admin/import/commit":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				destination = payload.get("destination", "records")
				if destination not in ("records", "contributions"):
					raise ValueError("Pilih tujuan impor yang valid.")
				if destination == "contributions" and "payments" not in self.current_admin["permissions"]:
					self.send_json(403, {"error": "Akun Anda tidak memiliki izin mengimpor daftar warga iuran."})
					return
				rows = payload.get("rows")
				if not isinstance(rows, list) or not rows:
					raise ValueError("Pilih minimal satu baris untuk diimpor.")
				duplicate_action = payload.get("duplicate_action", "skip")
				if duplicate_action not in ("skip", "replace"):
					raise ValueError("Pilihan data duplikat tidak valid.")
				replace_duplicates = duplicate_action == "replace"
				if destination == "contributions":
					with connect_database() as connection:
						settings = get_settings(connection)
					validated_rows = []
					for index, row in enumerate(rows, start=1):
						try:
							validated_rows.append(validate_contribution_import_row(row, settings))
						except (ValueError, TypeError) as error:
							raise ValueError(f"Baris {index}: {error}") from error
					with connect_database() as connection:
						resident_ids = {}
						existing_rows = connection.execute(
							"SELECT r.id, COALESCE(NULLIF(r.full_name, ''), u.display_name) AS full_name, r.rt, r.rw, r.national_id_number "
							"FROM contribution_residents r LEFT JOIN admin_users u ON u.id = r.account_id WHERE r.active = 1"
						).fetchall()
						for existing_row in existing_rows:
							for key in contribution_import_keys(dict(existing_row)):
								resident_ids[key] = existing_row["id"]
						payment_keys = {
							(row["resident_id"], row["period"])
							for row in connection.execute("SELECT resident_id, period FROM contribution_payments")
						}
						payment_keys.update(
							(row["resident_id"], row["period"])
							for row in connection.execute(
								"SELECT r.id AS resident_id, p.period FROM contribution_residents r "
								"JOIN resident_payments p ON p.user_id = r.account_id WHERE r.active = 1"
							)
						)
						created = 0
						updated = 0
						payments_created = 0
						payments_updated = 0
						skipped = 0
						for row in validated_rows:
							keys = contribution_import_keys(row)
							national_id_key = next((key for key in keys if key[0] == "nik"), None)
							resident_key = next(key for key in keys if key[0] == "resident")
							resident_id = resident_ids.get(national_id_key) if national_id_key else None
							if resident_id is None:
								resident_id = resident_ids.get(resident_key)
							resident_exists = resident_id is not None
							if resident_exists and replace_duplicates:
								connection.execute(
									"UPDATE contribution_residents SET "
									"rt = COALESCE(NULLIF(?, ''), rt), "
									"rw = COALESCE(NULLIF(?, ''), rw), "
									"birth_date = COALESCE(NULLIF(?, ''), birth_date), "
									"address = COALESCE(NULLIF(?, ''), address), "
									"family_card_number = COALESCE(NULLIF(?, ''), family_card_number), "
									"national_id_number = COALESCE(NULLIF(?, ''), national_id_number), "
									"birthplace = COALESCE(NULLIF(?, ''), birthplace), "
									"religion = COALESCE(NULLIF(?, ''), religion), "
									"gender = COALESCE(NULLIF(?, ''), gender), "
									"payment_recipient = COALESCE(NULLIF(?, ''), payment_recipient), "
									"relationship = COALESCE(NULLIF(?, ''), relationship), "
									"phone = COALESCE(NULLIF(?, ''), phone), "
									"residence_status = COALESCE(NULLIF(?, ''), residence_status) "
									"WHERE id = ?",
									(
										row["rt"], row["rw"], row["birth_date"], row["address"],
										row["family_card_number"], row["national_id_number"], row["birthplace"],
										row["religion"], row["gender"], row["payment_recipient"],
										row["relationship"] if "relationship" in row else "",
										row["phone"] if "phone" in row else "",
										row["residence_status"] if "residence_status" in row else "",
										resident_id,
									),
								)
								updated += 1
							if resident_id is None:
								cursor = connection.execute(
									"INSERT INTO contribution_residents (full_name, rt, rw, birth_date, address, family_card_number, "
									"national_id_number, birthplace, religion, gender, payment_recipient, relationship, phone, residence_status) "
									"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
									(
										row["full_name"], row["rt"], row["rw"], row["birth_date"], row["address"],
										row["family_card_number"], row["national_id_number"], row["birthplace"],
										row["religion"], row["gender"], row["payment_recipient"], row["relationship"] if "relationship" in row else "", row["phone"] if "phone" in row else "", row["residence_status"] if "residence_status" in row else "",
									),
								)
								resident_id = cursor.lastrowid
								created += 1
								for key in keys:
									resident_ids[key] = resident_id
							if row["amount"] is None:
								if resident_exists and not replace_duplicates:
									skipped += 1
								continue
							payment_key = (resident_id, row["payment_period"])
							if payment_key in payment_keys:
								if not replace_duplicates:
									skipped += 1
									continue
								connection.execute(
									"UPDATE contribution_payments SET amount = ?, paid_at = ? "
									"WHERE resident_id = ? AND period = ?",
									(row["amount"], row["paid_at"], resident_id, row["payment_period"]),
								)
								payments_updated += 1
								continue
							connection.execute(
								"INSERT INTO contribution_payments (resident_id, period, amount, paid_at) VALUES (?, ?, ?, ?)",
								(resident_id, row["payment_period"], row["amount"], row["paid_at"]),
							)
							payment_keys.add(payment_key)
							payments_created += 1
					self.send_json(201, {
						"created": created, "updated": updated,
						"payments_created": payments_created, "payments_updated": payments_updated,
						"skipped_duplicates": skipped,
					})
					return
				with connect_database() as connection:
					settings = get_settings(connection)
				validated_rows = []
				for index, row in enumerate(rows, start=1):
					try:
						validated_rows.append(validate_import_row(row, settings))
					except (ValueError, TypeError) as error:
						raise ValueError(f"Baris {index}: {error}") from error
				with connect_database() as connection:
					existing = {
						(item["full_name"].casefold(), item["area"], item["date_of_death"]): item["id"]
						for item in connection.execute("SELECT id, full_name, area, date_of_death FROM records")
					}
					created = 0
					updated = 0
					skipped = 0
					for row in validated_rows:
						duplicate_key = import_duplicate_key(row)
						existing_id = existing.get(duplicate_key) if duplicate_key is not None else None
						if existing_id is not None:
							if not replace_duplicates:
								skipped += 1
								continue
							connection.execute(
								"UPDATE records SET gender = ?, address = ?, "
								"family_card_number = ?, national_id_number = ?, birthplace = ?, "
								"birth_date = ?, religion = ? WHERE id = ?",
								(
									row["gender"], row["address"], row["family_card_number"],
									row["national_id_number"], row["birthplace"], row["birth_date"],
									row["religion"], existing_id,
								),
							)
							connection.execute(
								"DELETE FROM family_connections WHERE record_id = ?", (existing_id,)
							)
							if row["living_family_name"] or row["living_family_relationship"]:
								connection.execute(
									"INSERT INTO family_connections (record_id, full_name, relationship) VALUES (?, ?, ?)",
									(existing_id, row["living_family_name"], row["living_family_relationship"]),
								)
							updated += 1
							continue
						cursor = connection.execute(
							"INSERT INTO records (full_name, gender, address, area, date_of_death, publish_address, "
							"family_card_number, national_id_number, birthplace, birth_date, religion) "
							"VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
							(
								row["full_name"], row["gender"], row["address"], row["area"], row["date_of_death"],
								row["family_card_number"], row["national_id_number"], row["birthplace"],
								row["birth_date"], row["religion"],
							),
						)
						record_id = cursor.lastrowid
						if row["living_family_name"] or row["living_family_relationship"]:
							connection.execute(
								"INSERT INTO family_connections (record_id, full_name, relationship) VALUES (?, ?, ?)",
								(record_id, row["living_family_name"], row["living_family_relationship"]),
							)
						if duplicate_key is not None:
							existing[duplicate_key] = record_id
						created += 1
			except (ValueError, TypeError, sqlite3.Error) as error:
				self.send_json(400, {"error": str(error) or "Data impor tidak valid."})
				return
			self.send_json(201, {"created": created, "updated": updated, "skipped_duplicates": skipped})
			return
		if path == "/api/admin/media":
			if not self.require_admin("Admin"):
				return
			return self.handle_media_upload()
		if path == "/api/records":
			if not self.require_admin():
				return
			try:
				payload = self.read_json()
				name = payload.get("full_name", "")
				gender = payload.get("gender", "")
				address = payload.get("address", "")
				rt = payload.get("rt")
				rw = payload.get("rw")
				date_of_death = payload.get("date_of_death", "")
				publish_address = payload.get("publish_address", False)
				if not all(isinstance(item, str) for item in (name, gender, address, date_of_death)):
					raise ValueError("Periksa kembali data yang diisi.")
				gender = gender.strip().upper()
				if gender not in ("P", "L"):
					raise ValueError("Pilih jenis kelamin P atau L.")
				if type(rt) is not int or type(rw) is not int:
					raise ValueError("Pilih RT dan RW dari daftar.")
				if not isinstance(publish_address, bool):
					raise ValueError("Pilihan privasi alamat tidak valid.")
				if self.current_admin["role"] == "Staff" and publish_address:
					raise ValueError("Staff tidak dapat mempublikasikan alamat warga.")
				name = name.strip().upper()
				address = address.strip()
				if not name or not address or len(name) > 120 or len(address) > 300:
					raise ValueError("Nama dan alamat wajib diisi sesuai batas yang tersedia.")
				if date.fromisoformat(date_of_death).isoformat() != date_of_death:
					raise ValueError("Tanggal tidak valid.")
				with connect_database() as connection:
					settings = get_settings(connection)
					if not 1 <= rt <= settings["rt_count"] or not 1 <= rw <= settings["rw_count"]:
						raise ValueError("Pilihan RT atau RW sudah tidak tersedia. Muat ulang formulir.")
					area = f"RT {rt:03d} / RW {rw:03d}"
					cursor = connection.execute(
						"INSERT INTO records (full_name, gender, address, area, date_of_death, publish_address) "
						"VALUES (?, ?, ?, ?, ?, ?)",
						(name, gender, address, area, date_of_death, int(publish_address)),
					)
			except (ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error) or "Periksa kembali tanggal."})
				return
			self.send_json(201, {"id": cursor.lastrowid})
			return
		self.send_json(404, {"error": "Rute tidak ditemukan."})

	# DELETE ROUTES: account removal is separate from resident/family deletion.
	def do_DELETE(self):
		path = urlparse(self.path).path
		if path.startswith("/api/admin/contribution-payments/"):
			if not self.require_admin("Admin"):
				return
			try:
				payment_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_json(400, {"error": "ID transaksi tidak valid."})
				return
			with connect_database() as connection:
				cursor = connection.execute("DELETE FROM contribution_payments WHERE id = ?", (payment_id,))
			if cursor.rowcount == 0:
				self.send_json(404, {"error": "Transaksi iuran tidak ditemukan."})
				return
			self.send_json(200, {"deleted": True})
			return
		if path.startswith("/api/admin/contribution-residents"):
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				resident_id = payload.get("resident_id")
			except Exception:
				self.send_json(400, {"error": "Data tidak valid."})
				return
			with connect_database() as connection:
				cursor = connection.execute("DELETE FROM contribution_residents WHERE id = ?", (resident_id,))
			if cursor.rowcount == 0:
				self.send_json(404, {"error": "Data warga tidak ditemukan."})
				return
			self.send_json(200, {"deleted": True})
			return
		if path.startswith("/api/admin/finance/"):
			if not self.require_admin("Admin"):
				return
			try:
				entry_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_json(400, {"error": "ID transaksi tidak valid."})
				return
			with connect_database() as connection:
				cursor = connection.execute("DELETE FROM finance_entries WHERE id = ?", (entry_id,))
			if cursor.rowcount == 0:
				self.send_json(404, {"error": "Catatan keuangan tidak ditemukan."})
				return
			self.send_json(200, {"deleted": True})
			return
		if path == "/api/admin/media":
			if not self.require_admin("Admin"):
				return
			return self.handle_media_delete()
		if path.startswith("/api/admin/hero-playlist/"):
			if not self.require_admin("Admin"):
				return
			media_id = path.rsplit("/", 1)[1]
			with connect_database() as connection:
				items = hero_playlist_items(get_settings(connection))
				item = next((item for item in items if item["id"] == media_id), None)
				if not item:
					self.send_json(404, {"error": "Media slideshow tidak ditemukan."})
					return
				remaining = [entry for entry in items if entry["id"] != media_id]
				connection.execute("UPDATE app_settings SET value = ? WHERE key = 'hero_playlist'", (json.dumps(remaining, ensure_ascii=False),))
			(UPLOAD_DIR / item["file"]).unlink(missing_ok=True)
			self.send_json(200, {"items": public_hero_playlist(get_settings(connection))})
			return
		if path.startswith("/api/admin/news/"):
			if not self.require_admin("Admin"):
				return
			try:
				article_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_json(400, {"error": "ID berita tidak valid."})
				return
			with connect_database() as connection:
				article = connection.execute("SELECT image_file FROM news_articles WHERE id = ?", (article_id,)).fetchone()
				if not article:
					self.send_json(404, {"error": "Berita tidak ditemukan."})
					return
				cursor = connection.execute("DELETE FROM news_articles WHERE id = ?", (article_id,))
			if article["image_file"]:
				(UPLOAD_DIR / article["image_file"]).unlink(missing_ok=True)
			if cursor.rowcount == 0:
				self.send_json(404, {"error": "Berita tidak ditemukan."})
				return
			self.send_json(200, {"deleted": True})
			return
		if path.startswith("/api/admin/users/"):
			if not self.require_super_admin():
				return
			try:
				user_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_json(400, {"error": "ID akun tidak valid."})
				return
			if user_id == self.current_admin["id"]:
				self.send_json(400, {"error": "Akun yang sedang digunakan tidak dapat dihapus."})
				return
			with connect_database() as connection:
				target = connection.execute("SELECT role, active, photo_file FROM admin_users WHERE id = ?", (user_id,)).fetchone()
				if not target:
					self.send_json(404, {"error": "Akun tidak ditemukan."})
					return
				if target["role"] == "Super Admin" and target["active"]:
					remaining = connection.execute(
						"SELECT COUNT(*) FROM admin_users WHERE role = 'Super Admin' AND active = 1"
					).fetchone()[0]
					if remaining <= 1:
						self.send_json(400, {"error": "Tidak dapat menghapus Super Admin aktif terakhir."})
						return
				proof_files = [row["proof_file"] for row in connection.execute("SELECT proof_file FROM resident_payments WHERE user_id = ?", (user_id,))]
				connection.execute("DELETE FROM admin_users WHERE id = ?", (user_id,))
				if target["photo_file"]:
					(UPLOAD_DIR / target["photo_file"]).unlink(missing_ok=True)
				for filename in proof_files:
					(UPLOAD_DIR / filename).unlink(missing_ok=True)
			with self.server.session_lock:
				for token, session in list(self.server.sessions.items()):
					if session["user_id"] == user_id:
						self.server.sessions.pop(token, None)
			self.send_json(200, {"deleted": True})
			return
		if not path.startswith("/api/admin/family/") and not path.startswith("/api/records/"):
			self.send_json(404, {"error": "Rute tidak ditemukan."})
			return
		if not self.require_admin("Admin"):
			return
		if path.startswith("/api/admin/family/"):
			try:
				family_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.send_json(400, {"error": "ID tidak valid."})
				return
			with connect_database() as connection:
				cursor = connection.execute("DELETE FROM family_connections WHERE id = ?", (family_id,))
			if cursor.rowcount == 0:
				self.send_json(404, {"error": "Relasi keluarga tidak ditemukan."})
				return
			self.send_json(200, {"deleted": True})
			return
		try:
			record_id = int(path.rsplit("/", 1)[1])
		except ValueError:
			self.send_json(400, {"error": "ID tidak valid."})
			return
		with connect_database() as connection:
			cursor = connection.execute("DELETE FROM records WHERE id = ?", (record_id,))
		if cursor.rowcount == 0:
			self.send_json(404, {"error": "Entri tidak ditemukan."})
			return
		self.send_json(200, {"deleted": True})


def ensure_port_free(port):
	"""Pastikan port belum dipakai proses lain.

	Windows mengizinkan dua proses bind ke port yang sama, sehingga
	permintaan bisa dilayani versi kode lama dan membuat sesi login tidak
	konsisten. Deteksi di sini agar hanya satu server yang berjalan.
	"""
	probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
	try:
		if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
			probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
		probe.bind(("0.0.0.0", port))
	except OSError:
		raise SystemExit(
			"Port %s sedang dipakai proses lain. Hentikan server yang sudah berjalan "
			"(atau ganti PORT) lalu jalankan ulang." % port
		)
	finally:
		probe.close()


def main():
	ensure_port_free(int(os.environ.get("PORT", "8000")))
	connect_database().close()
	with connect_database() as connection:
		initial_admin = connection.execute(
			"SELECT username FROM admin_users WHERE role = 'Super Admin' AND force_password_change = 1 ORDER BY id LIMIT 1"
		).fetchone()
	if initial_admin and initial_admin["username"] == "admin":
		print("Login awal Super Admin: username admin, kata sandi admin. Ganti kata sandi saat login pertama.")
	server = KifayahServer(("0.0.0.0", int(os.environ.get("PORT", "8000"))), KifayahHandler)
	print("Situs Kifayah aktif di http://localhost:%s" % server.server_port)
	print("Warga dalam jaringan yang sama dapat membuka alamat IP komputer ini pada port %s." % server.server_port)
	print("Untuk ZeroTier, buka Managed IP komputer ini pada port %s dari perangkat di network yang sama." % server.server_port)
	try:
		server.serve_forever()
	except KeyboardInterrupt:
		print("\nServer dihentikan.")
	finally:
		server.server_close()


if __name__ == "__main__":
	main()
