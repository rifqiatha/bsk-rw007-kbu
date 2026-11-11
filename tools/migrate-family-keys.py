"""Migrasi aman No. KK sebagai identitas keluarga pada database Kifayah.

Hasil migrasi:
  households.family_card_number             : PK
  contribution_residents.family_card_number : FK -> households
  contribution_payments.family_card_number  : FK -> households
  contribution_residents.national_id_number : unique jika tidak kosong

Skrip menolak berjalan bila No. KK/NIK lama belum layak diberi constraint.
Jalankan hanya ketika server Kifayah berhenti dan setelah backup tersedia.
"""
from pathlib import Path
import sqlite3
import sys


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "kifayah.sqlite3"
VALID_KK = "length(trim(family_card_number)) = 16 AND trim(family_card_number) NOT GLOB '*[^0-9]*'"


def scalar(connection, sql):
    return connection.execute(sql).fetchone()[0]


def validate(connection):
    invalid_residents = scalar(
        connection,
        f"SELECT COUNT(*) FROM contribution_residents WHERE NOT ({VALID_KK})",
    )
    invalid_payments = scalar(
        connection,
        f"SELECT COUNT(*) FROM contribution_payments WHERE NOT ({VALID_KK})",
    )
    duplicate_nik = scalar(
        connection,
        """SELECT COUNT(*) FROM (
            SELECT national_id_number FROM contribution_residents
            WHERE trim(national_id_number) <> ''
            GROUP BY national_id_number HAVING COUNT(*) > 1
        )""",
    )
    if invalid_residents or invalid_payments or duplicate_nik:
        raise RuntimeError(
            "Migrasi dibatalkan: "
            f"{invalid_residents} warga No. KK tidak valid, "
            f"{invalid_payments} setoran No. KK tidak valid, "
            f"{duplicate_nik} NIK ganda. Perbaiki lewat Tinjauan Data terlebih dahulu."
        )


def create_replacement_tables(connection):
    connection.execute(
        """CREATE TABLE contribution_residents_family_key (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER UNIQUE,
            full_name TEXT NOT NULL,
            rt TEXT NOT NULL DEFAULT '', rw TEXT NOT NULL DEFAULT '',
            birth_date TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
            photo_file TEXT NOT NULL DEFAULT '',
            family_card_number TEXT NOT NULL,
            national_id_number TEXT NOT NULL DEFAULT '', birthplace TEXT NOT NULL DEFAULT '',
            religion TEXT NOT NULL DEFAULT '', gender TEXT NOT NULL DEFAULT '',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            payment_recipient TEXT NOT NULL DEFAULT '', relationship TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '', residence_status TEXT NOT NULL DEFAULT '',
            status_warga TEXT NOT NULL DEFAULT 'Aktif', date_of_death TEXT NOT NULL DEFAULT '',
            FOREIGN KEY(account_id) REFERENCES admin_users(id) ON DELETE SET NULL,
            FOREIGN KEY(family_card_number) REFERENCES households(family_card_number)
                ON UPDATE CASCADE ON DELETE RESTRICT
        )"""
    )
    connection.execute(
        """INSERT INTO contribution_residents_family_key
            (id, account_id, full_name, rt, rw, birth_date, address, photo_file,
             family_card_number, national_id_number, birthplace, religion, gender,
             active, created_at, updated_at, payment_recipient, relationship, phone,
             residence_status, status_warga, date_of_death)
           SELECT id, account_id, full_name, rt, rw, birth_date, address, photo_file,
             trim(family_card_number), national_id_number, birthplace, religion, gender,
             active, created_at, updated_at, payment_recipient, relationship, phone,
             residence_status, status_warga, date_of_death
           FROM contribution_residents"""
    )
    connection.execute(
        """CREATE TABLE contribution_payments_family_key (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            resident_id INTEGER NOT NULL,
            family_card_number TEXT NOT NULL,
            period TEXT NOT NULL, amount INTEGER NOT NULL, paid_at TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            method TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'admin',
            proof_file TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Terverifikasi',
            admin_note TEXT NOT NULL DEFAULT '', reviewed_at TEXT NOT NULL DEFAULT '',
            FOREIGN KEY(resident_id) REFERENCES contribution_residents(id) ON DELETE CASCADE,
            FOREIGN KEY(family_card_number) REFERENCES households(family_card_number)
                ON UPDATE CASCADE ON DELETE RESTRICT
        )"""
    )
    connection.execute(
        """INSERT INTO contribution_payments_family_key
            (id, resident_id, family_card_number, period, amount, paid_at, note, created_at,
             method, source, proof_file, status, admin_note, reviewed_at)
           SELECT id, resident_id, trim(family_card_number), period, amount, paid_at, note, created_at,
             method, source, proof_file, status, admin_note, reviewed_at
           FROM contribution_payments"""
    )


def migrate(connection):
    # Household rows must exist before the two new FK tables are populated.
    connection.execute(
        """INSERT OR IGNORE INTO households (family_card_number)
           SELECT DISTINCT trim(family_card_number) FROM contribution_residents"""
    )
    validate(connection)
    # PRAGMA foreign_keys hanya dapat diubah di luar transaksi SQLite.
    connection.commit()

    connection.execute("PRAGMA foreign_keys = OFF")
    try:
        connection.execute("BEGIN IMMEDIATE")
        create_replacement_tables(connection)
        # Trigger ini merujuk nama tabel lama. DROP dilakukan di transaksi yang
        # sama; Kifayah.py akan membuatnya kembali otomatis saat server hidup.
        for trigger in (
            "sync_record_death_to_resident_insert",
            "sync_record_death_to_resident_update",
            "sync_existing_death_to_resident_insert",
        ):
            connection.execute(f"DROP TRIGGER IF EXISTS {trigger}")
        connection.execute("DROP TABLE contribution_payments")
        connection.execute("DROP TABLE contribution_residents")
        connection.execute("ALTER TABLE contribution_residents_family_key RENAME TO contribution_residents")
        connection.execute("ALTER TABLE contribution_payments_family_key RENAME TO contribution_payments")
        connection.execute(
            "CREATE INDEX idx_contribution_residents_nik ON contribution_residents(national_id_number)"
        )
        connection.execute(
            "CREATE UNIQUE INDEX uq_contribution_residents_nik ON contribution_residents(national_id_number) "
            "WHERE TRIM(national_id_number) <> ''"
        )
        connection.execute(
            "CREATE INDEX idx_contribution_payments_family_card ON contribution_payments(family_card_number, period)"
        )
        connection.execute("COMMIT")
    except Exception:
        connection.execute("ROLLBACK")
        raise
    finally:
        connection.execute("PRAGMA foreign_keys = ON")

    violations = list(connection.execute("PRAGMA foreign_key_check"))
    if violations:
        raise RuntimeError(f"Migrasi selesai tetapi foreign_key_check gagal: {violations!r}")


def main():
    if not DATABASE.is_file():
        raise SystemExit(f"Database tidak ditemukan: {DATABASE}")
    connection = sqlite3.connect(DATABASE)
    try:
        migrate(connection)
    finally:
        connection.close()
    print("Migrasi No. KK selesai dan foreign_key_check lulus.")


if __name__ == "__main__":
    try:
        main()
    except (sqlite3.Error, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
