"""Hapus kolom legacy contribution_residents.account_id secara aman.

Jalankan hanya sesudah migrasi No. KK berhasil. Skrip menolak database yang
masih memiliki No. KK kosong/tidak valid, membuat backup SQLite, lalu membangun
ulang tabel warga tanpa relasi akun/login warga.
"""
from datetime import datetime
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "kifayah.sqlite3"
VALID_KK = "length(trim(family_card_number)) = 16 AND trim(family_card_number) NOT GLOB '*[^0-9]*'"


def main():
    if not DATABASE.is_file():
        raise RuntimeError(f"Database tidak ditemukan: {DATABASE}")
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    try:
        columns = {row[1] for row in con.execute("PRAGMA table_info(contribution_residents)")}
        if "account_id" not in columns:
            print("Kolom account_id sudah tidak ada; tidak ada perubahan.")
            return
        invalid = con.execute(f"SELECT COUNT(*) FROM contribution_residents WHERE NOT ({VALID_KK})").fetchone()[0]
        if invalid:
            raise RuntimeError(f"Migrasi dibatalkan: {invalid} warga No. KK belum valid. Selesaikan migrate-family-keys dahulu.")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = DATABASE.resolve().parent / "backups" / f"drop-resident-account-link-{stamp}"
        backup.mkdir(parents=True, exist_ok=False)
        target = sqlite3.connect(backup / "kifayah.sqlite3")
        con.backup(target)
        target.close()
        con.commit()
        con.execute("PRAGMA foreign_keys = OFF")
        con.execute("BEGIN IMMEDIATE")
        try:
            for trigger in ("sync_record_death_to_resident_insert", "sync_record_death_to_resident_update", "sync_existing_death_to_resident_insert"):
                con.execute(f"DROP TRIGGER IF EXISTS {trigger}")
            con.execute("""CREATE TABLE contribution_residents_no_account (
                id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL,
                rt TEXT NOT NULL DEFAULT '', rw TEXT NOT NULL DEFAULT '', birth_date TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '', photo_file TEXT NOT NULL DEFAULT '', family_card_number TEXT NOT NULL,
                national_id_number TEXT NOT NULL DEFAULT '', birthplace TEXT NOT NULL DEFAULT '', religion TEXT NOT NULL DEFAULT '',
                gender TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                payment_recipient TEXT NOT NULL DEFAULT '', relationship TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
                residence_status TEXT NOT NULL DEFAULT '', status_warga TEXT NOT NULL DEFAULT 'Aktif', date_of_death TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(family_card_number) REFERENCES households(family_card_number) ON UPDATE CASCADE ON DELETE RESTRICT
            )""")
            con.execute("""INSERT INTO contribution_residents_no_account
                (id, full_name, rt, rw, birth_date, address, photo_file, family_card_number, national_id_number,
                 birthplace, religion, gender, active, created_at, updated_at, payment_recipient, relationship,
                 phone, residence_status, status_warga, date_of_death)
                SELECT id, full_name, rt, rw, birth_date, address, photo_file, family_card_number, national_id_number,
                 birthplace, religion, gender, active, created_at, updated_at, payment_recipient, relationship,
                 phone, residence_status, status_warga, date_of_death FROM contribution_residents""")
            con.execute("DROP TABLE contribution_residents")
            con.execute("ALTER TABLE contribution_residents_no_account RENAME TO contribution_residents")
            con.execute("CREATE INDEX idx_contribution_residents_nik ON contribution_residents(national_id_number)")
            con.execute("CREATE UNIQUE INDEX uq_contribution_residents_nik ON contribution_residents(national_id_number) WHERE TRIM(national_id_number) <> ''")
            con.commit()
        except Exception:
            con.rollback()
            raise
        con.execute("PRAGMA foreign_keys = ON")
        violations = list(con.execute("PRAGMA foreign_key_check"))
        if violations:
            raise RuntimeError(f"foreign_key_check gagal: {violations!r}")
        print(f"Selesai. account_id dihapus permanen. Backup: {backup}")
    finally:
        con.close()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, sqlite3.Error) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
