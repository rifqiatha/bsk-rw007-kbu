"""Hapus placeholder warga yang dahulu dibuat otomatis oleh halaman daftar warga.

Versi lama endpoint daftar warga membuat satu contribution_residents kosong
untuk setiap akun dengan peran Warga. Skrip ini sengaja sangat ketat: hanya
baris aktif yang profilnya kosong total dan tidak punya data turunan yang boleh
dihapus. Secara default skrip hanya menampilkan kandidat; gunakan --apply
sesudah memeriksa hasil pratinjau.
"""
import argparse
from datetime import datetime
from pathlib import Path
import sqlite3
import sys


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / "kifayah.sqlite3"
EMPTY_PROFILE = """
    TRIM(COALESCE(r.family_card_number, '')) = ''
    AND TRIM(COALESCE(r.national_id_number, '')) = ''
    AND TRIM(COALESCE(r.rt, '')) = ''
    AND TRIM(COALESCE(r.rw, '')) = ''
    AND TRIM(COALESCE(r.birth_date, '')) = ''
    AND TRIM(COALESCE(r.address, '')) = ''
    AND TRIM(COALESCE(r.photo_file, '')) = ''
    AND TRIM(COALESCE(r.payment_recipient, '')) = ''
    AND TRIM(COALESCE(r.birthplace, '')) = ''
    AND TRIM(COALESCE(r.religion, '')) = ''
    AND TRIM(COALESCE(r.gender, '')) = ''
    AND TRIM(COALESCE(r.relationship, '')) = ''
    AND TRIM(COALESCE(r.phone, '')) = ''
    AND TRIM(COALESCE(r.residence_status, '')) = ''
"""


def candidates(connection):
    """Return only placeholders that have no valid dependent data."""
    return connection.execute(
        f"""SELECT r.id, r.full_name, r.account_id, r.created_at, u.username
            FROM contribution_residents r
            JOIN admin_users u ON u.id = r.account_id
            WHERE r.active = 1
              AND u.role = 'Warga'
              AND {EMPTY_PROFILE}
              AND NOT EXISTS (SELECT 1 FROM contribution_payments p WHERE p.resident_id = r.id)
              AND NOT EXISTS (SELECT 1 FROM bsk_registrations b WHERE b.resident_id = r.id)
              AND NOT EXISTS (SELECT 1 FROM data_issues i WHERE i.resident_id = r.id)
            ORDER BY r.id"""
    ).fetchall()


def backup(connection, database):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    directory = database.resolve().parent / "backups" / f"auto-resident-cleanup-{stamp}"
    directory.mkdir(parents=True, exist_ok=False)
    destination = sqlite3.connect(directory / "kifayah.sqlite3")
    connection.backup(destination)
    destination.close()
    return directory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE, help="lokasi kifayah.sqlite3")
    parser.add_argument("--apply", action="store_true", help="hapus kandidat setelah backup dibuat")
    args = parser.parse_args()
    database = args.database.resolve()
    if not database.is_file():
        raise RuntimeError(f"Database tidak ditemukan: {database}")

    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        rows = candidates(connection)
        print(f"Kandidat placeholder otomatis: {len(rows)}")
        for row in rows:
            print(f"- resident_id={row['id']}, account_id={row['account_id']}, username={row['username']!r}, nama={row['full_name']!r}")
        if not args.apply:
            print("Pratinjau saja: tidak ada data yang diubah. Periksa kandidat, lalu jalankan lagi dengan --apply.")
            return
        if not rows:
            print("Tidak ada kandidat; tidak ada data yang diubah.")
            return

        backup_dir = backup(connection, database)
        ids = [row["id"] for row in rows]
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.executemany("DELETE FROM contribution_residents WHERE id = ?", ((identifier,) for identifier in ids))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        violations = list(connection.execute("PRAGMA foreign_key_check"))
        if violations:
            raise RuntimeError(f"Pembersihan dibatalkan: foreign_key_check gagal: {violations!r}")
        print(f"Selesai: {len(ids)} placeholder dihapus. Backup: {backup_dir}")
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, sqlite3.Error) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
