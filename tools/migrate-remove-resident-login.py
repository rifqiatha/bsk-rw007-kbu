"""Hapus login warga dan tabel pembayaran warga legacy dengan aman.

Skrip tidak pernah menghapus data WARGA, KARTU_KELUARGA, atau SETORAN.
Ia berhenti bila resident_payments masih berisi data, agar riwayat tidak hilang.
"""
from datetime import datetime
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "kifayah.sqlite3"


def backup(connection):
    directory = DATABASE.resolve().parent / "backups" / f"remove-resident-login-{datetime.now():%Y%m%d-%H%M%S}"
    directory.mkdir(parents=True, exist_ok=False)
    target = sqlite3.connect(directory / "kifayah.sqlite3")
    connection.backup(target)
    target.close()
    return directory


def main():
    if not DATABASE.is_file():
        raise RuntimeError(f"Database tidak ditemukan: {DATABASE}")
    con = sqlite3.connect(DATABASE)
    try:
        tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        legacy_rows = con.execute("SELECT COUNT(*) FROM resident_payments").fetchone()[0] if "resident_payments" in tables else 0
        if legacy_rows:
            raise RuntimeError(f"Migrasi dibatalkan: resident_payments masih berisi {legacy_rows} data. Migrasikan/arsipkan dahulu.")
        resident_accounts = con.execute("SELECT COUNT(*) FROM admin_users WHERE role = 'Warga'").fetchone()[0]
        resident_columns = {row[1] for row in con.execute("PRAGMA table_info(contribution_residents)")}
        has_account_link = "account_id" in resident_columns
        linked = con.execute("SELECT COUNT(*) FROM contribution_residents WHERE account_id IS NOT NULL").fetchone()[0] if has_account_link else 0
        print(f"Akun warga legacy yang akan dihapus: {resident_accounts}")
        print(f"Tautan akun ke warga yang dilepas: {linked}")
        backup_dir = backup(con)
        con.execute("BEGIN IMMEDIATE")
        try:
            if has_account_link:
                con.execute("UPDATE contribution_residents SET account_id = NULL WHERE account_id IS NOT NULL")
            con.execute("DELETE FROM admin_users WHERE role = 'Warga'")
            if "resident_payments" in tables:
                con.execute("DROP TABLE resident_payments")
            con.commit()
        except Exception:
            con.rollback()
            raise
        violations = list(con.execute("PRAGMA foreign_key_check"))
        if violations:
            raise RuntimeError(f"foreign_key_check gagal: {violations!r}")
        print(f"Selesai. Backup: {backup_dir}")
    finally:
        con.close()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, sqlite3.Error) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
