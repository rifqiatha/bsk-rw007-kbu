"""Pindahkan anggota legacy ke JSON lalu hapus tabel legacy pendaftaran.

Skrip ini hanya boleh dijalankan ketika server berhenti. Sebelum perubahan,
SQLite dan berkas tanda tangan lama dicadangkan ke folder backups di samping
database. Berkas tanda tangan tidak dihapus dari unggahan; cadangan membuat
pemulihan tetap mungkin bila diperlukan.
"""
from datetime import datetime
import json
from pathlib import Path
import shutil
import sqlite3
import sys


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "kifayah.sqlite3"
UPLOADS = ROOT / "uploads"
FIELDS = ("full_name", "national_id_number", "birthplace", "birth_date", "gender", "relationship", "remark")


def legacy_members(connection, registration_id):
    return [
        {field: str(row[field] or "") for field in FIELDS}
        for row in connection.execute(
            "SELECT full_name, national_id_number, birthplace, birth_date, gender, relationship, remark "
            "FROM bsk_registration_members WHERE registration_id = ? ORDER BY id",
            (registration_id,),
        )
    ]


def json_members(raw):
    try:
        value = json.loads(raw or "[]")
    except (TypeError, json.JSONDecodeError) as error:
        raise RuntimeError("members_json rusak dan tidak dapat dimigrasikan.") from error
    if not isinstance(value, list) or any(not isinstance(member, dict) for member in value):
        raise RuntimeError("members_json tidak berbentuk daftar anggota.")
    return [{field: str(member.get(field, "") or "") for field in FIELDS} for member in value]


def backup(connection, image_files):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    directory = DATABASE.resolve().parent / "backups" / f"registration-legacy-{stamp}"
    directory.mkdir(parents=True, exist_ok=False)
    destination = sqlite3.connect(directory / "kifayah.sqlite3")
    connection.backup(destination)
    destination.close()
    for filename in image_files:
        source = UPLOADS / filename
        if source.is_file():
            shutil.copy2(source, directory / filename)
    return directory


def migrate(connection):
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    legacy = {"bsk_registration_members", "bsk_registration_signatures"}
    if not legacy & tables:
        print("Tabel legacy pendaftaran sudah tidak ada; tidak ada perubahan.")
        return
    if legacy - tables:
        raise RuntimeError("Skema legacy tidak lengkap; pemulihan manual diperlukan sebelum migrasi.")

    registrations = connection.execute("SELECT id, members_json FROM bsk_registrations ORDER BY id").fetchall()
    orphan_members = connection.execute(
        "SELECT COUNT(*) FROM bsk_registration_members m LEFT JOIN bsk_registrations r ON r.id = m.registration_id WHERE r.id IS NULL"
    ).fetchone()[0]
    orphan_signatures = connection.execute(
        "SELECT COUNT(*) FROM bsk_registration_signatures s LEFT JOIN bsk_registrations r ON r.id = s.registration_id WHERE r.id IS NULL"
    ).fetchone()[0]
    if orphan_members or orphan_signatures:
        raise RuntimeError(f"Ada data legacy tanpa pendaftaran: anggota={orphan_members}, tanda_tangan={orphan_signatures}.")

    updates = []
    for registration in registrations:
        old = legacy_members(connection, registration["id"])
        current = json_members(registration["members_json"])
        if old and current and old != current:
            raise RuntimeError(f"Anggota legacy dan members_json berbeda pada pendaftaran ID {registration['id']}.")
        if old and not current:
            updates.append((json.dumps(old, ensure_ascii=False), registration["id"]))

    image_files = [
        row[0] for row in connection.execute(
            "SELECT image_file FROM bsk_registration_signatures WHERE image_file <> ''"
        )
    ]
    backup_dir = backup(connection, image_files)

    connection.execute("BEGIN IMMEDIATE")
    try:
        if updates:
            connection.executemany(
                "UPDATE bsk_registrations SET members_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                updates,
            )
        connection.execute("DROP TABLE bsk_registration_members")
        connection.execute("DROP TABLE bsk_registration_signatures")
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    violations = list(connection.execute("PRAGMA foreign_key_check"))
    if violations:
        raise RuntimeError(f"foreign_key_check gagal: {violations!r}")
    print(f"Migrasi selesai. Backup SQLite dan {len(image_files)} berkas tanda tangan: {backup_dir}")


def main():
    if not DATABASE.is_file():
        raise RuntimeError(f"Database tidak ditemukan: {DATABASE}")
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        migrate(connection)
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, sqlite3.Error) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
