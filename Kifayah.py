import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import threading
import time
from datetime import date, datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from importers import ImportFormatError, parse_import_file, template_xlsx


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
DATABASE = BASE_DIR / "kifayah.sqlite3"
UPLOAD_DIR = BASE_DIR / "uploads"
MAX_BODY = 16 * 1024 * 1024
IMAGE_TYPES = {
	"image/png": (".png", b"\x89PNG\r\n\x1a\n"),
	"image/jpeg": (".jpg", b"\xff\xd8\xff"),
	"image/webp": (".webp", b"RIFF"),
}
ROLE_LEVELS = {"Staff": 1, "Admin": 2, "Super Admin": 3}
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
		(("rt_count", 1), ("rw_count", 7), ("icon_zoom", 100), ("site_icon", "ff61a380fc24c3c08ac1b27bbe595a63.webp"), ("site_icon_2", "logo-transparent-86ccf3f779fb.png"), ("hero_image", "1f5a6f509232401123da18defe05c8e7.png")),
	)
	legacy_zoom = connection.execute("SELECT value FROM app_settings WHERE key = 'icon_zoom'").fetchone()[0]
	connection.executemany(
		"INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
		(("icon_zoom_1", legacy_zoom), ("icon_zoom_2", legacy_zoom)),
	)
	connection.commit()


def get_settings(connection):
	settings = {row["key"]: row["value"] for row in connection.execute("SELECT key, value FROM app_settings")}
	for key in ("rt_count", "rw_count", "icon_zoom", "icon_zoom_1", "icon_zoom_2"):
		settings[key] = int(settings[key])
	return settings


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
	full_name = text_fields["full_name"]
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

	def send_stored_image(self, filename):
		if not filename or Path(filename).name != filename:
			self.send_error(404)
			return
		image_path = UPLOAD_DIR / filename
		if not image_path.is_file():
			self.send_error(404)
			return
		content_type = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}.get(image_path.suffix)
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

	def handle_media_upload(self):
		try:
			payload = self.read_json()
			kind = payload.get("kind")
			content_type = payload.get("content_type")
			encoded = payload.get("content_base64")
			if kind not in ("site_icon", "site_logos", "hero_image", "portrait", "user_avatar"):
				raise ValueError("Jenis gambar tidak dikenal.")
			if kind in ("site_icon", "site_logos", "hero_image") and self.current_admin["role"] != "Super Admin":
				self.send_json(403, {"error": "Hanya Super Admin yang dapat mengubah tampilan situs."})
				return
			if kind == "user_avatar" and self.current_admin["role"] != "Super Admin":
				self.send_json(403, {"error": "Hanya Super Admin yang dapat mengelola akun user."})
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
			if kind == "portrait" and (type(record_id) is not int or not isinstance(publish_portrait, bool)):
				raise ValueError("Pilih entri dan izin foto dengan benar.")
			user_id = payload.get("user_id")
			if kind == "user_avatar" and type(user_id) is not int:
				raise ValueError("Pilih akun dengan benar.")
			if kind == "site_icon" and (type(site_icon_slot) is not int or site_icon_slot not in (1, 2)):
				raise ValueError("Pilih posisi logo pertama atau kedua.")
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
			else:
				if kind == "site_icon":
					setting_key = "site_icon" if site_icon_slot == 1 else "site_icon_2"
					url = "/media/site-icon" if site_icon_slot == 1 else "/media/site-icon/2"
				else:
					setting_key = kind
					url = "/media/hero"
				connection.execute("UPDATE app_settings SET value = ? WHERE key = ?", (filename, setting_key))
		self.send_json(201, {"url": url})

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
				"SELECT id, username, display_name, role, force_password_change, active "
				"FROM admin_users WHERE id = ?",
				(session["user_id"],),
			).fetchone()
		if not row or not row["active"] or row["role"] not in ROLE_LEVELS:
			with self.server.session_lock:
				self.server.sessions.pop(token, None)
			return None
		return dict(row)

	def is_admin(self):
		return self.current_user() is not None

	def require_admin(self, minimum_role="Staff", allow_password_change=False):
		user = self.current_user()
		if not user:
			self.send_json(401, {"error": "Silakan masuk sebagai pengelola."})
			return False
		if user["force_password_change"] and not allow_password_change:
			self.send_json(403, {"error": "Ganti kata sandi sementara sebelum melanjutkan.", "force_password_change": True})
			return False
		if ROLE_LEVELS[user["role"]] < ROLE_LEVELS[minimum_role]:
			self.send_json(403, {"error": "Jabatan Anda tidak memiliki akses ke bagian ini."})
			return False
		self.current_admin = user
		return True

	def require_super_admin(self):
		return self.require_admin("Super Admin")
	# HTTP ROUTES: public reads and authenticated administration.
	def do_GET(self):
		path = urlparse(self.path).path
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
					"SELECT id, username, display_name, first_name, last_name, phone, email, photo_file, role, active, force_password_change, created_at "
					"FROM admin_users ORDER BY display_name COLLATE NOCASE"
				).fetchall()
			result = []
			for row in users:
				user = dict(row)
				user["avatar_url"] = f"/media/admin-user/{user['id']}" if user.pop("photo_file") else ""
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
				"user": {"id": user["id"], "username": user["username"], "display_name": user["display_name"], "role": user["role"]} if user else None,
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
		if path == "/api/admin/export/excel":
			if not self.require_super_admin():
				return
			from openpyxl import Workbook
			from openpyxl.styles import Font, PatternFill
			import io
			workbook = Workbook()
			residents = workbook.active
			residents.title = "Data Warga"
			residents.append(["ID", "Nama", "Jenis Kelamin", "RT/RW", "Tanggal Wafat", "Alamat", "Alamat Dipublikasikan"])
			identity = workbook.create_sheet("Identitas Privat")
			identity.append(["ID", "Nama", "Nomor Kartu Keluarga", "NIK", "Tempat Lahir", "Tanggal Lahir", "Agama"])
			family = workbook.create_sheet("Keluarga")
			family.append(["ID Warga", "Nama Warga", "Nama Anggota Keluarga", "Hubungan"])
			with connect_database() as connection:
				rows = connection.execute(
					"SELECT * FROM records ORDER BY date_of_death DESC, full_name COLLATE NOCASE"
				).fetchall()
				family_rows = connection.execute(
					"SELECT family_connections.record_id, records.full_name AS record_name, "
					"family_connections.full_name, family_connections.relationship "
					"FROM family_connections JOIN records ON records.id = family_connections.record_id "
					"ORDER BY records.full_name COLLATE NOCASE, family_connections.full_name COLLATE NOCASE"
				).fetchall()
			for row in rows:
				residents.append([
					row["id"], row["full_name"], row["gender"], row["area"], row["date_of_death"],
					row["address"], "Ya" if row["publish_address"] else "Tidak",
				])
				identity.append([
					row["id"], row["full_name"], row["family_card_number"], row["national_id_number"],
					row["birthplace"], row["birth_date"], row["religion"],
				])
			for row in family_rows:
				family.append([row["record_id"], row["record_name"], row["full_name"], row["relationship"]])
			for worksheet in workbook.worksheets:
				worksheet.freeze_panes = "A2"
				worksheet.auto_filter.ref = worksheet.dimensions
				for cell in worksheet[1]:
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
				"site_icon_ready": bool(settings.get("site_icon")),
				"site_icon_2_ready": bool(settings.get("site_icon_2")),
				"hero_image_ready": bool(settings.get("hero_image")),
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
		if path in ("/media/site-icon", "/media/site-icon/2", "/media/hero"):
			key = {"/media/site-icon": "site_icon", "/media/site-icon/2": "site_icon_2", "/media/hero": "hero_image"}[path]
			with connect_database() as connection:
				filename = get_settings(connection).get(key, "")
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
				and (not viewer or ROLE_LEVELS[viewer["role"]] < ROLE_LEVELS["Admin"])
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
		if path in ("/", "/admin"):
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
		}.get(target.suffix, "application/octet-stream")
		body = target.read_bytes()
		self.send_response(200)
		self.send_header("Content-Type", content_type)
		self.send_header("Content-Length", str(len(body)))
		self.send_header("X-Content-Type-Options", "nosniff")
		self.end_headers()
		self.wfile.write(body)

	# MUTATIONS: login, account management, residents, and settings.
	def do_POST(self):
		path = urlparse(self.path).path
		if path.startswith("/api/admin/news/") and path.endswith("/image"):
			try:
				article_id = int(path.split("/")[-2])
			except ValueError:
				self.send_json(400, {"error": "ID berita tidak valid."})
				return
			return self.handle_news_image_upload(article_id)
		if path == "/api/login":
			try:
				payload = self.read_json()
				username = payload.get("username", "")
				password = payload.get("password", "")
				if not isinstance(username, str) or not isinstance(password, str):
					raise ValueError("Nama akun dan kata sandi harus berupa teks.")
				with connect_database() as connection:
					user = connection.execute(
						"SELECT id, username, display_name, role, password_salt, password_hash, "
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
					"user": {"id": user["id"], "username": user["username"], "display_name": user["display_name"], "role": user["role"]},
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
				if len(new_password) < 8:
					raise ValueError("Kata sandi baru minimal 8 karakter.")
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
				if not all(isinstance(value, str) for value in (username, first_name, last_name, phone, email, display_name, role, password)):
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
				if role not in ROLE_LEVELS:
					raise ValueError("Pilih jabatan yang tersedia.")
				if len(password) < 8:
					raise ValueError("Kata sandi awal minimal 8 karakter.")
				salt, password_hash = hash_password(password)
				with connect_database() as connection:
					cursor = connection.execute(
						"INSERT INTO admin_users (username, display_name, first_name, last_name, phone, email, role, password_salt, password_hash, force_password_change) "
						"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
						(username, display_name, first_name, last_name, phone, email, role, salt, password_hash),
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
				if type(user_id) is not int or not isinstance(display_name, str) or role not in ROLE_LEVELS or not isinstance(active, bool):
					raise ValueError("Data akun tidak valid.")
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
						"UPDATE admin_users SET display_name = ?, first_name = ?, last_name = ?, phone = ?, email = ?, role = ?, active = ? WHERE id = ?",
						(display_name, first_name, last_name, phone, email, role, int(active), user_id),
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
				if len(new_password) < 8:
					raise ValueError("Kata sandi baru minimal 8 karakter.")
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
		if path == "/api/settings":
			if not self.require_super_admin():
				return
			try:
				payload = self.read_json()
				rt_count = payload.get("rt_count")
				rw_count = payload.get("rw_count")
				icon_zoom = payload.get("icon_zoom")
				icon_zoom_1 = payload.get("icon_zoom_1")
				icon_zoom_2 = payload.get("icon_zoom_2")
				if type(rt_count) is not int or type(rw_count) is not int:
					raise ValueError("Jumlah RT dan RW harus berupa angka bulat.")
				if not 1 <= rt_count <= 999 or not 1 <= rw_count <= 999:
					raise ValueError("Jumlah RT dan RW harus antara 1 dan 999.")
				for zoom in (icon_zoom, icon_zoom_1, icon_zoom_2):
					if zoom is not None and (type(zoom) is not int or not 50 <= zoom <= 200):
						raise ValueError("Zoom tiap logo harus antara 50% dan 200%.")
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
				for key, value in (("icon_zoom_1", icon_zoom_1), ("icon_zoom_2", icon_zoom_2)):
					if value is not None:
						connection.execute("UPDATE app_settings SET value = ? WHERE key = ?", (value, key))
				settings = get_settings(connection)
			self.send_json(200, {
				"rt_count": rt_count,
				"rw_count": rw_count,
				"icon_zoom": settings["icon_zoom"],
				"icon_zoom_1": settings["icon_zoom_1"],
				"icon_zoom_2": settings["icon_zoom_2"],
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
				full_name = full_name.strip()
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
				full_name = full_name.strip()
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
				filename = payload.get("filename", "")
				encoded = payload.get("content_base64", "")
				if not isinstance(filename, str) or not isinstance(encoded, str):
					raise ValueError("Pilih file yang akan diperiksa.")
				try:
					content = base64.b64decode(encoded, validate=True)
				except (binascii.Error, ValueError):
					raise ValueError("Isi file tidak valid.")
				parsed = parse_import_file(filename, content)
				if len(parsed["rows"]) > 500:
					raise ValueError("Maksimal 500 baris per impor. Pisahkan file menjadi beberapa bagian.")
				with connect_database() as connection:
					settings = get_settings(connection)
					existing = {
						(row["full_name"].casefold(), row["area"], row["date_of_death"])
						for row in connection.execute("SELECT full_name, area, date_of_death FROM records")
					}
				for row in parsed["rows"]:
					try:
						validated = validate_import_row(row, settings)
					except (ValueError, TypeError):
						continue
					key = import_duplicate_key(validated)
					row["duplicate"] = key is not None and key in existing
					if row["duplicate"]:
						parsed["warnings"].append(f"{row['full_name']} sudah ada dengan RT/RW dan tanggal wafat yang sama.")
				parsed["warnings"] = sorted(set(parsed["warnings"]))
			except (ImportFormatError, ValueError, TypeError) as error:
				self.send_json(400, {"error": str(error) or "File tidak dapat diproses."})
				return
			self.send_json(200, parsed)
			return
		if path == "/api/admin/import/commit":
			if not self.require_admin("Admin"):
				return
			try:
				payload = self.read_json()
				rows = payload.get("rows")
				if not isinstance(rows, list) or not rows or len(rows) > 500:
					raise ValueError("Pilih 1 sampai 500 baris untuk diimpor.")
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
						(item["full_name"].casefold(), item["area"], item["date_of_death"])
						for item in connection.execute("SELECT full_name, area, date_of_death FROM records")
					}
					created = 0
					skipped = 0
					for row in validated_rows:
						duplicate_key = import_duplicate_key(row)
						if duplicate_key is not None and duplicate_key in existing:
							skipped += 1
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
							existing.add(duplicate_key)
						created += 1
			except (ValueError, TypeError, sqlite3.Error) as error:
				self.send_json(400, {"error": str(error) or "Data impor tidak valid."})
				return
			self.send_json(201, {"created": created, "skipped_duplicates": skipped})
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
				name = name.strip()
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
				connection.execute("DELETE FROM admin_users WHERE id = ?", (user_id,))
				if target["photo_file"]:
					(UPLOAD_DIR / target["photo_file"]).unlink(missing_ok=True)
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


def main():
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
