/* PENDAFTARAN BSK: formulir warga, antrean admin, dan tanda tangan satu sesi.
 *
 * Modul ini sengaja dipisah dari app.js agar alur pendaftaran dapat dibaca
 * sebagai satu kesatuan: satu baris tabel = satu keluarga utuh, dengan
 * anggota dan tanda tangan menempel pada baris yang sama.
 */
(function () {
  "use strict";

  const SIGNATURE_ROLES = [
    { role: "maker", label: "Yang Mengisi Data", globalKey: "signature_maker" },
    { role: "rt", label: "Ketua RT", globalKey: "signature_rt" },
    { role: "lmk", label: "LMK RW", globalKey: "signature_lmk" },
    { role: "rw", label: "Ketua RW", globalKey: "signature_rw" },
    { role: "bsk", label: "Ketua BSK", globalKey: "signature_bsk" },
  ];
  const MAX_MEMBERS = 20;
  const STATUS_LABELS = {
    "Menunggu Verifikasi": "Menunggu Verifikasi",
    Disetujui: "Disetujui",
    Ditolak: "Ditolak",
  };

  const byId = (id) => document.getElementById(id);
  const registrationSettings = () => (typeof settings === "undefined" ? {} : settings);

  /* ---------------------------------------------------------------
   * Baris anggota keluarga
   * Satu baris = satu kartu anggota. Baris kosong diabaikan saat kirim
   * supaya pengguna tidak perlu menghapus baris yang tidak terpakai.
   * ------------------------------------------------------------- */
  function memberRow() {
    const row = document.createElement("div");
    row.className = "registration-member-row";
    row.innerHTML = `
      <label class="registration-member-name">Nama<input data-field="full_name" maxlength="120" autocomplete="off" placeholder="Nama anggota"></label>
      <label>NIK<input data-field="national_id_number" maxlength="16" inputmode="numeric" autocomplete="off" placeholder="16 digit"></label>
      <label class="registration-member-kk">Nomor Kartu Keluarga<input data-field="family_card_number" readonly tabindex="-1" aria-label="Nomor kartu keluarga anggota"></label>
      <label>Tempat Lahir<input data-field="birthplace" maxlength="100" autocomplete="off"></label>
      <label>Tanggal Lahir<input data-field="birth_date" type="date"></label>
      <label>L/P<select data-field="gender"><option value="">-</option><option value="L">L</option><option value="P">P</option></select></label>
      <label>Hubungan<input data-field="relationship" maxlength="80" placeholder="Contoh: Anak"></label>
      <label>Keterangan<input data-field="remark" maxlength="120"></label>
      <button class="text-button registration-member-remove" type="button">Hapus</button>`;
    row.querySelector(".registration-member-remove").addEventListener("click", () => {
      const container = row.closest(".registration-member-rows");
      row.remove();
      renumberMemberRows(container);
      syncMemberFamilyCards();
    });
    return row;
  }

  /* ---------------------------------------------------------------
   * Nomor kartu keluarga anggota
   *
   * Semua anggota satu keluarga memakai satu nomor KK yang sama dengan
   * kepala keluarga, jadi kolomnya diisi otomatis dan tidak bisa diubah
   * sendiri. Ini mencegah anggota masuk dengan KK yang berbeda.
   * ------------------------------------------------------------- */
  function headFamilyCardNumber(form) {
    const value = (form?.elements?.family_card_number?.value || "").trim();
    return value;
  }

  function syncMemberFamilyCards(scope) {
    // Formulir dicari dari wadah baris anggota itu sendiri, bukan dari
    // argumen. Sebelumnya fungsi ini berhenti diam-diam kalau dipanggil
    // tanpa scope, sehingga baris anggota yang baru ditambahkan tetap
    // kosong padahal kolomnya sudah tersedia.
    const containers = (scope ? [byId(scope.containerId)] : [
      byId("resident-member-rows"),
      byId("registration-create-member-rows"),
      byId("registration-edit-member-rows"),
    ]).filter(Boolean);

    for (const container of containers) {
      const form = scope?.form || container.closest("form");
      if (!form) continue;
      const kk = headFamilyCardNumber(form);
      container.querySelectorAll("[data-field='family_card_number']").forEach((input) => {
        input.value = kk;
      });
      const note = container.closest("fieldset")?.querySelector("[data-kk-note]");
      if (note) {
        note.textContent = kk
          ? `Semua anggota memakai Nomor Kartu Keluarga ${kk}, sama dengan kepala keluarga.`
          : "Isi Nomor Kartu Keluarga pada data kepala keluarga; nomor itu otomatis dipakai semua anggota.";
      }
    }
  }

  function fillMemberRow(row, member) {
    if (!member) return;
    row.querySelectorAll("[data-field]").forEach((input) => {
      if (input.readOnly) return;
      input.value = member[input.dataset.field] ?? "";
    });
  }

  /* ---------------------------------------------------------------
   * NIK anggota keluarga
   *
   * NIK kepala keluarga dan NIK anggota tidak boleh sama, karena satu NIK
   * hanya boleh mewakili satu orang. Baris kosong tetap diabaikan.
   * ------------------------------------------------------------- */
  function validateMemberIdentities(form, members) {
    const seen = new Map();
    const headNik = (form.elements.national_id_number?.value || "").trim();
    if (headNik) seen.set(headNik, "kepala keluarga");
    for (const member of members) {
      const nik = member.national_id_number;
      if (!nik) continue;
      if (!/^\d{16}$/.test(nik)) {
        return `NIK anggota keluarga harus 16 digit angka. Periksa baris "${member.full_name}".`;
      }
      if (seen.has(nik)) {
        return `NIK ${nik} dipakai dua kali di formulir ini (${seen.get(nik)} dan ${member.full_name}).`;
      }
      seen.set(nik, member.full_name);
    }
    return "";
  }

  function labelMemberRow(row, index) {
    const label = row.querySelector(".registration-member-name");
    if (!label) return;
    label.firstChild.textContent = `Anggota ${index + 1} `;
  }

  function renumberMemberRows(container) {
    const containers = container
      ? [container]
      : [byId("resident-member-rows"), byId("registration-create-member-rows")];
    for (const item of containers) {
      item?.querySelectorAll(".registration-member-row").forEach(labelMemberRow);
    }
  }

  function collectMembers(container) {
    const rows = [...container.querySelectorAll(".registration-member-row")];
    const members = [];
    for (const row of rows) {
      const member = {};
      row.querySelectorAll("[data-field]").forEach((input) => {
        member[input.dataset.field] = input.value.trim();
      });
      if (member.full_name) members.push(member);
    }
    return members;
  }

  function resetMemberRows(container, addButton, emptyLabel) {
    container.replaceChildren();
    const blank = memberRow();
    container.append(blank);
    if (addButton) {
      addButton.disabled = false;
      addButton.onclick = () => {
        if (container.querySelectorAll(".registration-member-row").length >= MAX_MEMBERS) return;
        // Baris baru harus langsung mendapat Nomor Kartu Keluarga yang
        // sama dengan kepala keluarga, tanpa perlu menunggu pengguna
        // menyentuh kolom KK lagi.
        const row = memberRow();
        container.append(row);
        renumberMemberRows(container);
        syncMemberFamilyCards();
        row.querySelector("input:not([readonly])")?.focus();
      };
    }
  }

  /* ---------------------------------------------------------------
   * Sisi warga
   * ------------------------------------------------------------- */
  const residentForm = byId("resident-registration-form");

  /* Isi ulang pilihan RT dan RW dari pengaturan terbaru.
     Jangan memakai penjaga "sudah diisi" seperti sebelumnya: dropdown bisa
     terisi lebih dulu dengan nilai bawaan sebelum /api/settings selesai, lalu
     terkunci selamanya sehingga hanya muncul RT 001 padahal di pengaturan
     ada 15 RT. Pilihan yang sedang aktif dipertahankan. */
  function fillAreaOptions(select, prefix, count) {
    if (!select) return;
    const chosen = select.value;
    select.replaceChildren(new Option(`Pilih ${prefix}`, ""));
    for (let value = 1; value <= count; value += 1) {
      select.append(new Option(`${prefix} ${String(value).padStart(3, "0")}`, String(value)));
    }
    select.value = [...select.options].some((option) => option.value === chosen) ? chosen : "";
  }

  function fillRegistrationAreaSelects() {
    fillAreaOptions(byId("resident-registration-rt"), "RT", registrationSettings().rt_count || 1);
    fillAreaOptions(byId("resident-registration-rw"), "RW", registrationSettings().rw_count || 1);
  }

  function renderResidentRegistrations(payload) {
    const list = byId("resident-registration-status");
    if (!list) return;
    list.replaceChildren();
    const registrations = payload.registrations || [];
    const notes = byId("resident-agreement-notes");
    if (notes) {
      notes.replaceChildren();
      (payload.agreement_notes || []).forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        notes.append(item);
      });
    }
    if (!registrations.length) {
      const empty = document.createElement("p");
      empty.className = "form-hint";
      empty.textContent = "Belum ada pendaftaran yang dikirim.";
      list.append(empty);
      return;
    }
    for (const item of registrations) {
      const card = document.createElement("article");
      card.className = "registration-status-card";
      const heading = document.createElement("div");
      heading.className = "registration-status-heading";
      const name = document.createElement("strong");
      name.textContent = item.head_name;
      const badge = document.createElement("span");
      badge.className = `registration-badge is-${item.status === "Disetujui" ? "ok" : item.status === "Ditolak" ? "bad" : "wait"}`;
      badge.textContent = STATUS_LABELS[item.status] || item.status;
      heading.append(name, badge);
      const detail = document.createElement("p");
      const parts = [
        `Anggota keluarga: ${item.members.length}`,
        `Tanda tangan: ${item.signed_count}/${item.required_signature_count}`,
        `RT ${item.rt || "-"} / RW ${item.rw || "-"}`,
      ];
      detail.textContent = parts.join(" · ");
      card.append(heading, detail);
      if (item.status === "Menunggu Verifikasi") {
        const waiting = document.createElement("p");
        waiting.className = "form-hint";
        waiting.textContent = "Menunggu tanda tangan Ketua RT, LMK, Ketua RW, dan Ketua BSK.";
        waiting.textContent = "Menungguaparkan ditandatangani oleh Ketua RT, LMK, Ketua RW, dan Ketua BSK.";
        card.append(waiting);
      }
      if (item.status === "Ditolak" && item.review_note) {
        const note = document.createElement("p");
        note.className = "registration-review-note";
        note.textContent = `Catatan pengurus: ${item.review_note}`;
        card.append(note);
      }
      if (item.status === "Disetujui") {
        const done = document.createElement("p");
        done.className = "form-hint";
        done.textContent = "Data Anda sudah masuk ke daftar warga BSK.";
        card.append(done);
      }
      list.append(card);
    }
  }

  async function loadResidentRegistrations() {
    if (!residentForm) return;
    try {
      renderResidentRegistrations(await request("/api/resident/registrations"));
    } catch (error) {
      const target = byId("resident-registration-error");
      if (target) target.textContent = error.message;
    }
  }

  function populateResidentForm(registration) {
    const form = residentForm;
    if (!form) return;
    const set = (name, value) => {
      if (form.elements[name]) form.elements[name].value = value ?? "";
    };
    if (!registration) {
      form.reset();
      fillRegistrationAreaSelects();
      resetMemberRows(byId("resident-member-rows"), byId("resident-member-add"), "Anggota");
      syncMemberFamilyCards({ form, containerId: "resident-member-rows" });
      return;
    }
    set("head_name", registration.head_name);
    set("gender", registration.gender);
    set("family_card_number", registration.family_card_number);
    set("national_id_number", registration.national_id_number);
    set("birthplace", registration.birthplace);
    set("birth_date", registration.birth_date);
    set("religion", registration.religion);
    set("residence_status", registration.residence_status);
    set("address", registration.address);
    set("job", registration.job);
    set("phone", registration.phone);
    fillRegistrationAreaSelects();
    const rtValue = String(Number(registration.rt) || 0);
    const rwValue = String(Number(registration.rw) || 0);
    if (form.elements.rt) form.elements.rt.value = rtValue;
    if (form.elements.rw) form.elements.rw.value = rwValue;
    const container = byId("resident-member-rows");
    resetMemberRows(container, byId("resident-member-add"), "Anggota");
    (registration.members || []).forEach((member, index) => {
      let row = container.children[index];
      if (!row) {
        row = memberRow();
        container.append(row);
      }
      fillMemberRow(row, member);
    });
    renumberMemberRows();
    syncMemberFamilyCards({ form, containerId: "resident-member-rows" });
  }

  function editableRegistration(registrations) {
    // Formulir yang ditolak boleh diperbaiki dan dikirim ulang. Formulir
    // yang sudah disetujui tidak diedit dari sini supaya data warga tidak
    // bercabang dengan data yang sudah disahkan pengurus.
    const rejected = (registrations || []).find((item) => item.status === "Ditolak");
    return rejected || null;
  }

  residentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorElement = byId("resident-registration-error");
    const result = byId("resident-registration-result");
    errorElement.textContent = "";
    if (result) {
      result.hidden = true;
      result.textContent = "";
    }
    const payload = Object.fromEntries(new FormData(residentForm));
    payload.members = collectMembers(byId("resident-member-rows"));
    const identityError = validateMemberIdentities(residentForm, payload.members);
    if (identityError) {
      errorElement.textContent = identityError;
      return null;
    }
    try {
      const saved = await request("/api/resident/registrations", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      populateResidentForm(null);
      byId("resident-registration-form-wrap")?.removeAttribute("open");
      await loadResidentRegistrations();
      if (result) {
        result.hidden = false;
        result.textContent = "Pendaftaran berhasil dikirim dan menunggu penandatanganan pengurus.";
      }
      return saved;
    } catch (error) {
      errorElement.textContent = error.message;
      return null;
    }
  });

  byId("resident-member-add")?.addEventListener("click", () => {});
  byId("resident-registration-toggle")?.addEventListener("click", async () => {
    fillRegistrationAreaSelects();
    try {
      const payload = await request("/api/resident/registrations");
      const editable = editableRegistration(payload.registrations);
      if (editable) populateResidentForm(editable);
      else if (!residentForm.dataset.touched) populateResidentForm(null);
    } catch (error) {
      /* Dashboard tetap tampil walau gagal memuat formulir lama. */
    }
  });

  /* ---------------------------------------------------------------
   * Sisi admin: antrean formulir
   * ------------------------------------------------------------- */
  const registrationDialog = byId("registration-dialog");
  let activeRegistration = null;

  function updateRegistrationBadge(pendingTotal) {
    const badge = byId("registration-tab-badge");
    if (!badge) return;
    badge.textContent = String(pendingTotal);
    badge.hidden = !pendingTotal;
    // Pendaftaran berada di menu Impor Data, jadi judul tooltip tab itu
    // disusun bersama lencana tinjauan data oleh app.js.
    window.setImportBadgeCount?.("registrations", pendingTotal);
  }

  function formatRegistrationTimestamp(value) {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  /* Ikon garis untuk tombol tanda tangan.

     Tombol lama hanya menampilkan teks panjang ("Simpan Nama",
     "Tanda Tangan Langsung") dalam sel sempit, sehingga ketiganya membungkus
     menjadi baris penuh dan terlihat berantakan. Ikon pendek membiarkan
     tombol tetap ringkas tanpa memotong label. */
  const SIGNATURE_ICONS = {
    pen: "M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z M13.5 6.5l4 4",
    trash: "M4 7h16 M9 7V5h6v2 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
    check: "M5 13l4 4L19 7",
  };

  function appendSignatureIcon(button, name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of [SIGNATURE_ICONS[name]]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    button.prepend(svg);
  }

  function signatureAvailability() {
    // Nama jabatan diambil dari menu Kontak RT / RW bila tersedia, supaya
    // petugas tidak perlu mengetik ulang nama yang sudah tercatat.
    const rtUnit = activeRegistration?.rt ? String(Number(activeRegistration.rt)) : "";
    const contacts = Array.isArray(window.kifayahAreaContacts) ? window.kifayahAreaContacts : [];
    const findName = (unitType, unitNumber, titles) => {
      const contact = contacts.find(
        (item) =>
          item.unit_type === unitType &&
          String(item.unit_number) === String(unitNumber) &&
          titles.some((title) => String(item.position_name || "").toLowerCase().includes(title)),
      );
      return contact?.contact_name || "";
    };
    return {
      rt: findName("RT", rtUnit, ["ketua rt"]),
      lmk: findName("RW", activeRegistration?.rw, ["lmk"]),
      rw: findName("RW", activeRegistration?.rw, ["ketua rw"]),
      bsk: "",
    };
  }

  function renderSignatureGrid(registration) {
    const grid = byId("registration-signature-grid");
    if (!grid) return;
    grid.replaceChildren();
    const suggested = signatureAvailability();
    /* Tanda tangan TIDAK dikunci setelah formulir disetujui.

       Koreksi data warga memang dialihkan ke menu Data Warga (lihat
       openRegistrationEditor), karena data sudah disalin ke tabel warga.
       Berbeda dengan nama dan gambar penandatangan: keduanya hanya dipakai
       untuk blok tanda tangan pada formulir yang dicetak, belum masuk ke
       mana-mana, jadi tetap boleh diperbaiki di sini.

       Server memang mengizinkan penyimpanan dan penghapusan tanpa memeriksa
       status, dan persetujuan yang sudah diberikan tidak ikut batal, jadi
       membuka kunci ini tidak menimbulkan data yang berbeda antara formulir
       dan daftar warga. */
    for (const meta of SIGNATURE_ROLES) {
      const signature =
        (registration.signatures || []).find((item) => item.role === meta.role) || {};
      const cell = document.createElement("article");
      cell.className = "registration-signature-cell";
      cell.dataset.role = meta.role;
      const heading = document.createElement("strong");
      heading.textContent = meta.label;
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 120;
      name.value = signature.name || suggested[meta.role] || "";
      name.placeholder = `Nama ${meta.label}`;
      name.setAttribute("aria-label", `Nama ${meta.label}`);
      const preview = document.createElement("div");
      preview.className = "registration-signature-preview";
      if (signature.has_image) {
        const image = document.createElement("img");
        image.src = `${signature.image_url}?v=${encodeURIComponent(signature.signed_at || "1")}`;
        image.alt = `Tanda tangan ${meta.label}`;
        preview.append(image);
      } else {
        const empty = document.createElement("span");
        empty.textContent = "Belum ada tanda tangan";
        preview.append(empty);
      }
      const actions = document.createElement("div");
      actions.className = "registration-signature-actions";
      const saveName = document.createElement("button");
      saveName.type = "button";
      saveName.className = "action-button signature-action";
      appendSignatureIcon(saveName, "check");
      saveName.append(document.createTextNode("Simpan Nama"));
      saveName.title = "Simpan nama penandatangan tanpa menggambar ulang.";
      saveName.addEventListener("click", async () => {
        const typed = name.value.trim();
        const errorElement = byId("registration-signature-error");
        if (typed.length < 2) {
          errorElement.textContent = `Isi nama ${meta.label} minimal 2 karakter.`;
          name.focus();
          name.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
        errorElement.textContent = "";
        try {
          const result = await request("/api/admin/registration-signature", {
            method: "POST",
            body: JSON.stringify({
              registration_id: registration.id,
              role: meta.role,
              name: typed,
              name_only: true,
            }),
          });
          applyRegistration(result.registration);
        } catch (error) {
          errorElement.textContent = error.message;
        }
      });
      const draw = document.createElement("button");
      draw.type = "button";
      draw.className = "signature-draw";
      appendSignatureIcon(draw, "pen");
      draw.append(document.createTextNode("Tanda Tangan Langsung"));
      draw.title = "Gambar tanda tangan baru. Nama di atas ikut tersimpan.";
      draw.addEventListener("click", () => {
        // Nama wajib diisi sebelum menggambar. Tanpa pemeriksaan di sini,
        // pengguna menggambar dulu lalu baru mendapat penolakan dari
        // server tanpa tahu apa yang kurang.
        const typed = name.value.trim();
        if (!typed) {
          const errorElement = byId("registration-signature-error");
          errorElement.textContent =
            `Isi nama ${meta.label} terlebih dahulu, baru gambar tanda tangannya.`;
          name.focus();
          name.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
        const errorElement = byId("registration-signature-error");
        errorElement.textContent = "";
        window.openRegistrationSignaturePad(meta.role, typed);
      });
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "signature-clear";
      appendSignatureIcon(clear, "trash");
      clear.append(document.createTextNode("Hapus"));
      clear.hidden = !signature.has_image;
      clear.addEventListener("click", async () => {
        if (!window.confirm(`Hapus gambar tanda tangan ${meta.label}? Nama penandatangan tetap tersimpan.`)) return;
        const errorElement = byId("registration-signature-error");
        errorElement.textContent = "";
        try {
          const result = await request("/api/admin/registration-signature", {
            method: "POST",
            body: JSON.stringify({ registration_id: registration.id, role: meta.role, clear: true }),
          });
          applyRegistration(result.registration);
        } catch (error) {
          errorElement.textContent = error.message;
        }
      });
      /* Aksi utama (gambar tanda tangan) mengisi baris penuh, sedangkan "Simpan
         Nama" dan "Hapus" Masuk satu baris pendukung. Sebelumnya ketiganya
         ditumpuk menjadi baris penuh karena labelnya panjang dan selnya sempit,
         sehingga terlihat berantakan. */
      const secondary = document.createElement("div");
      secondary.className = "registration-signature-secondary";
      secondary.append(saveName, clear);
      actions.append(draw, secondary);
      cell.append(heading, name, preview, actions);
      grid.append(cell);
    }
  }

  function renderRegistrationDetail(registration) {
    activeRegistration = registration;
    const body = byId("registration-dialog-body");
    if (!body) return;
    body.replaceChildren();

    const badge = document.createElement("span");
    badge.className = `registration-badge is-${registration.status === "Disetujui" ? "ok" : registration.status === "Ditolak" ? "bad" : "wait"}`;
    badge.textContent = STATUS_LABELS[registration.status] || registration.status;

    const summary = document.createElement("dl");
    summary.className = "registration-summary";
    const rows = [
      // Nama kepala ditampilkan di sini juga, bukan hanya di judul dialog.
      // Setelah dikoreksi lewat tombol Edit Data, nama baru harus langsung
      // terlihat tanpa harus menutup dialog dulu.
      ["Nama Kepala Keluarga", registration.head_name || "-"],
      ["Nomor Kartu Keluarga", registration.family_card_number || "-"],
      ["NIK Kepala Keluarga", registration.national_id_number || "-"],
      ["Tempat, Tanggal Lahir", `${registration.birthplace || "-"}, ${registration.birth_date || "-"}`],
      ["Agama", registration.religion || "-"],
      ["Jenis Kelamin", registration.gender || "-"],
      ["Status", registration.residence_status || "-"],
      ["RT / RW", `${registration.rt || "-"} / ${registration.rw || "-"}`],
      ["Alamat", registration.address || "-"],
      ["Pekerjaan", registration.job || "-"],
      ["No. HP", registration.phone || "-"],
      ["Dikirim", formatRegistrationTimestamp(registration.submitted_at)],
    ];
    for (const [label, value] of rows) {
      const term = document.createElement("dt");
      term.textContent = label;
      const definition = document.createElement("dd");
      definition.textContent = value;
      summary.append(term, definition);
    }
    body.append(badge, summary);

    const memberHeading = document.createElement("h3");
    memberHeading.textContent = `Anggota Keluarga (${(registration.members || []).length})`;
    body.append(memberHeading);

    const table = document.createElement("table");
    table.className = "family-table registration-member-table";
    table.innerHTML = `<thead><tr><th>NO</th><th>NAMA</th><th>NIK</th><th>TEMPAT LAHIR</th><th>TANGGAL LAHIR</th><th>L/P</th><th>HUBUNGAN</th><th>KET</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    (registration.members || []).forEach((member, index) => {
      const tr = document.createElement("tr");
      [
        index + 1,
        member.full_name,
        member.national_id_number,
        member.birthplace,
        member.birth_date,
        member.gender,
        member.relationship,
        member.remark,
      ].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value === "" ? "-" : String(value);
        tr.append(cell);
      });
      tbody.append(tr);
    });
    if (!(registration.members || []).length) {
      const tr = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.textContent = "Belum ada anggota keluarga yang dicatat.";
      tr.append(cell);
      tbody.append(tr);
    }
    table.append(tbody);
    const scroll = document.createElement("div");
    scroll.className = "registration-table-scroll";
    scroll.append(table);
    body.append(scroll);

    const agreement = document.createElement("div");
    agreement.className = "registration-agreement-box";
    agreement.textContent = registration.agreement_note || "";
    body.append(agreement);

    if (registration.status === "Ditolak" && registration.review_note) {
      const note = document.createElement("p");
      note.className = "registration-review-note";
      note.textContent = `Catatan penolakan: ${registration.review_note}`;
      body.append(note);
    }

    renderSignatureGrid(registration);

    const approveButton = byId("registration-approve");
    const rejectButton = byId("registration-reject");
    const noteInput = byId("registration-review-note");
    if (approveButton) {
      approveButton.disabled = registration.status === "Disetujui";
      approveButton.textContent =
        registration.status === "Disetujui" ? "Sudah Disetujui" : "Setujui dan Masukkan ke Data Warga →";
    }
    if (rejectButton) rejectButton.disabled = registration.status === "Disetujui";
    if (noteInput) noteInput.disabled = registration.status === "Disetujui";
  }

  function applyRegistration(registration) {
    if (!registration) return;
    renderRegistrationDetail(registration);
    loadRegistrations();
  }

  // Dipanggil app.js setelah panel tanda tangan menutup, supaya grid tanda
  // tangan langsung menampilkan gambar yang baru dibuat.
  window.onRegistrationSignatureSaved = applyRegistration;

  /* ---------------------------------------------------------------
   * Koreksi data formulir
   *
   * Formulir yang belum disetujui masih bebas diperbaiki karena
   * datanya belum masuk ke daftar warga. Setelah disetujui, koreksi
   * dilakukan dari menu Data Warga supaya kedua daftar tetap sama.
   * ------------------------------------------------------------- */
  const editForm = byId("registration-edit-form");
  const editFields = byId("registration-edit-fields");
  const editMemberRows = byId("registration-edit-member-rows");
  const editToggle = byId("registration-edit-toggle");

  // Susun kolom kepala keluarga. Field disusun ulang di sini supaya label
  // dan nama kolomnya tidak tercecer di HTML dan mudah ikut saat berubah.
  function buildEditFields(registration) {
    const groups = [
      [
        ["Nama Kepala Keluarga", "head_name", registration.head_name || "", { required: true, maxlength: 120 }],
        ["Jenis Kelamin", "gender", registration.gender || "", { choices: [["L", "L"], ["P", "P"]] }],
      ],
      [
        ["Nomor Kartu Keluarga", "family_card_number", registration.family_card_number || "", { maxlength: 32 }],
        ["Nomor Induk Kependudukan", "national_id_number", registration.national_id_number || "", { maxlength: 32 }],
      ],
      [
        ["Tempat Lahir", "birthplace", registration.birthplace || "", { maxlength: 100 }],
        ["Tanggal Lahir", "birth_date", registration.birth_date || "", { type: "date" }],
      ],
      [
        ["Agama", "religion", registration.religion || "", { maxlength: 50 }],
        [
          "Status",
          "residence_status",
          registration.residence_status || "",
          { choices: [["TETAP", "Tetap"], ["KONTRAK", "Kontrak"], ["KOS", "Kos"]] },
        ],
      ],
      [["RT", "rt", registration.rt || "", { choices: [], area: "RT" }], ["RW", "rw", registration.rw || "", { choices: [], area: "RW" }]],
      [["Alamat Lengkap", "address", registration.address || "", { textarea: true, maxlength: 300 }]],
      [
        ["Pekerjaan", "job", registration.job || "", { maxlength: 120 }],
        ["Nomor HP", "phone", registration.phone || "", { maxlength: 32 }],
      ],
    ];
    editFields.replaceChildren();
    for (const group of groups) {
      const row = document.createElement("div");
      row.className = group.length > 1 ? "field-row" : "registration-edit-single";
      for (const [label, name, value, options] of group) {
        const fieldLabel = document.createElement("label");
        fieldLabel.textContent = label;
        let input;
        if (options.area) {
          input = document.createElement("select");
          const blank = document.createElement("option");
          blank.value = "";
          blank.textContent = `Pilih ${options.area}`;
          input.append(blank);
          const settings = registrationSettings();
          const total = options.area === "RT" ? settings.rt_count || 1 : settings.rw_count || 1;
          for (let index = 1; index <= total; index += 1) {
            const option = document.createElement("option");
            option.value = String(index).padStart(3, "0");
            option.textContent = option.value;
            input.append(option);
          }
          input.name = name;
          // Nilai tersimpan bisa "7" sementara opsinya "007".
          input.value = value ? String(value).padStart(3, "0") : "";
        } else if (options.choices) {
          input = document.createElement("select");
          const blank = document.createElement("option");
          blank.value = "";
          blank.textContent = "Pilih";
          input.append(blank);
          for (const [choiceValue, choiceLabel] of options.choices) {
            const option = document.createElement("option");
            option.value = choiceValue;
            option.textContent = choiceLabel;
            input.append(option);
          }
          input.name = name;
          input.value = value;
        } else if (options.textarea) {
          input = document.createElement("textarea");
          input.name = name;
          input.rows = 2;
          input.maxLength = options.maxlength || 300;
          input.value = value;
        } else {
          input = document.createElement("input");
          input.name = name;
          input.type = options.type || "text";
          if (options.maxlength) input.maxLength = options.maxlength;
          if (options.required) input.required = true;
          input.value = value;
        }
        fieldLabel.append(input);
        row.append(fieldLabel);
      }
      editFields.append(row);
    }
  }

  function openRegistrationEditor() {
    if (!activeRegistration || !editForm) return;
    const approved = activeRegistration.status === "Disetujui";
    // Tombol dimatikan, bukan disembunyikan, supaya alasannya tetap terlihat.
    if (editToggle) {
      editToggle.disabled = approved;
      editToggle.textContent = approved ? "Sudah Disetujui" : "Edit Data";
      editToggle.title = approved
        ? "Data sudah masuk ke daftar warga. Koreksi dari menu Data warga."
        : "Koreksi data formulir ini";
    }
    if (approved) return;
    buildEditFields(activeRegistration);
    const members = activeRegistration.members || [];
    resetMemberRows(editMemberRows, byId("registration-edit-member-add"), "Anggota");
    const rows = [...editMemberRows.querySelectorAll(".registration-member-row")];
    rows.slice(1).forEach((row) => row.remove());
    if (members.length) {
      fillMemberRow(rows[0], members[0]);
      members.slice(1).forEach((member) => {
        const row = memberRow();
        fillMemberRow(row, member);
        editMemberRows.append(row);
      });
    }
    renumberMemberRows(editMemberRows);
    syncMemberFamilyCards();
    byId("registration-edit-error").textContent = "";
    editForm.hidden = false;
    editForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeRegistrationEditor() {
    if (!editForm) return;
    editForm.hidden = true;
    editForm.reset();
    editMemberRows?.replaceChildren();
    editFields?.replaceChildren();
  }

  editToggle?.addEventListener("click", () => {
    if (editForm.hidden) openRegistrationEditor();
    else closeRegistrationEditor();
  });

  byId("registration-edit-cancel")?.addEventListener("click", closeRegistrationEditor);

  editForm?.addEventListener("input", () => syncMemberFamilyCards());

  editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeRegistration) return;
    const errorElement = byId("registration-edit-error");
    errorElement.textContent = "";
    const members = collectMembers(editMemberRows);
    const identityError = validateMemberIdentities(editForm, members);
    if (identityError) {
      errorElement.textContent = identityError;
      return;
    }
    const payload = { registration_id: activeRegistration.id, members };
    for (const [key, value] of new FormData(editForm).entries()) {
      if (key === "members") continue;
      payload[key] = typeof value === "string" ? value.trim() : value;
    }
    const submitButton = editForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    try {
      const result = await request("/api/admin/registrations/update", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      closeRegistrationEditor();
      applyRegistration(result.registration);
    } catch (error) {
      errorElement.textContent = error.message;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  // Tutup editor setiap kali dialog dibuka supaya tidak ada sisa isian
  // formulir sebelumnya yang tertinggal di layar.
  registrationDialog?.addEventListener("close", closeRegistrationEditor);

  async function openRegistration(registrationId) {
    const errorElement = byId("registration-review-error");
    if (errorElement) errorElement.textContent = "";
    try {
      const payload = await request(`/api/admin/registrations/${registrationId}`);
      // Kalau server tidak mengirim detail, tampilkan pesan yang jelas. Tanpa
      // pemeriksaan ini tombol "Tinjau dan Tandatangan" terlihat tidak berfungsi
      // karena kesalahannya tercecer di tempat yang tidak terlihat.
      if (!payload || !payload.registration) {
        throw new Error("Detail formulir tidak diterima dari server. Muat ulang halaman lalu coba lagi.");
      }
      renderRegistrationDetail(payload.registration);
      fillPrintSettingsInputs();
      registrationDialog?.showModal();
    } catch (error) {
      const listStatus = byId("registration-list-status");
      if (listStatus) {
        listStatus.textContent = error.message;
        listStatus.classList.add("is-error");
      }
      window.alert(error.message);
    }
  }

  function renderRegistrationList(payload) {
    const list = byId("registration-list");
    const status = byId("registration-list-status");
    if (!list) return;
    list.replaceChildren();
    updateRegistrationBadge(payload.pending_total || 0);
    if (status) {
      status.textContent = `${(payload.registrations || []).length} formulir ditampilkan dari ${payload.total || 0} total.`;
    }
    const registrations = payload.registrations || [];
    if (!registrations.length) {
      const empty = document.createElement("p");
      empty.className = "form-hint";
      empty.textContent = "Belum ada formulir pendaftaran untuk filter ini.";
      list.append(empty);
      return;
    }
    const search = (byId("registration-search")?.value || "").trim().toLowerCase();
    for (const item of registrations) {
      const haystack = `${item.head_name} ${item.family_card_number}`.toLowerCase();
      if (search && !haystack.includes(search)) continue;
      const card = document.createElement("article");
      card.className = "admin-payment-card registration-card";
      const heading = document.createElement("div");
      heading.className = "admin-payment-card-heading";
      const title = document.createElement("strong");
      title.textContent = item.head_name;
      const badge = document.createElement("span");
      badge.className = `registration-badge is-${item.status === "Disetujui" ? "ok" : item.status === "Ditolak" ? "bad" : "wait"}`;
      badge.textContent = STATUS_LABELS[item.status] || item.status;
      heading.append(title, badge);
      const detail = document.createElement("p");
      detail.textContent = [
        `KK ${item.family_card_number || "-"}`,
        `RT ${item.rt || "-"} / RW ${item.rw || "-"}`,
        `${item.member_count} anggota`,
        `tanda tangan ${item.signed_count}/5`,
        item.submitter_name ? `pengisi ${item.submitter_name}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const actions = document.createElement("div");
      actions.className = "registration-card-actions";
      const review = document.createElement("button");
      review.type = "button";
      review.className = "action-button";
      review.textContent = "Tinjau dan Tandatangan";
      review.addEventListener("click", () => openRegistration(item.id));
      actions.append(review);
      if (item.status !== "Disetujui") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-button";
        remove.textContent = "Hapus";
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Hapus formulir pendaftaran atas nama ${item.head_name}?`)) return;
          const errorElement = byId("registration-list-error");
          errorElement.textContent = "";
          try {
            await request(`/api/admin/registrations/${item.id}`, { method: "DELETE" });
            await loadRegistrations();
          } catch (error) {
            errorElement.textContent = error.message;
          }
        });
        actions.append(remove);
      }
      card.append(heading, detail, actions);
      list.append(card);
    }
  }

  async function loadRegistrations() {
    const list = byId("registration-list");
    if (!list) return;
    const errorElement = byId("registration-list-error");
    if (errorElement) errorElement.textContent = "";
    const parameters = new URLSearchParams({ status: byId("registration-status-filter")?.value || "all" });
    try {
      renderRegistrationList(await request(`/api/admin/registrations?${parameters}`));
    } catch (error) {
      if (errorElement) errorElement.textContent = error.message;
    }
  }

  /* ---------------------------------------------------------------
   * Tanda tangan
   * ------------------------------------------------------------- */
  window.openRegistrationSignaturePad = function (role, suggestedName) {
    const pad = byId("signature-pad-canvas");
    const padDialog = byId("signature-pad-dialog");
    if (!pad || !padDialog) return;
    pad.dataset.registrationRole = role;
    pad.dataset.registrationName = suggestedName || "";
    pad.dataset.registrationId = String(activeRegistration?.id || "");
    const roleSelect = byId("signature-pad-role-select");
    if (roleSelect) {
      roleSelect.value = role;
      roleSelect.disabled = true;
      roleSelect.closest("label").style.display = "none";
    }
    const roleNote = byId("signature-pad-role");
    if (roleNote) {
      const label = SIGNATURE_ROLES.find((item) => item.role === role)?.label || role;
      roleNote.textContent = `Menggambar tanda tangan untuk: ${label} (formulir pendaftaran)`;
    }
    const clear = window.clearSignaturePad;
    // Pesan galat dari percobaan sebelumnya dibersihkan agar tidak
    // tertinggal saat membuka pad untuk jabatan lain.
    window.signaturePadError?.("");
    if (typeof clear === "function") clear();
    else {
      const ctx = pad.getContext("2d");
      ctx.clearRect(0, 0, pad.width, pad.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pad.width, pad.height);
    }
    padDialog.showModal();
  };

  /* ---------------------------------------------------------------
   * Cetak formulir dari dalam dialog
   *
   * Sheet cetak disusun di elemen terpisah (#registration-print-sheet)
   * yang disembunyikan di layar. Saat printing, elemen itu yang
   * ditampilkan supaya pengguna tidak perlu pindah halaman dan tidak
   * ikut tercetak tombol, input, atau panel admin lain.
   *
   * Tata letaknya mengikuti formulir kertas BSK: kop surat, daftar data
   * kepala keluarga bertanda titik dua, tabel anggota keluarga, daftar
   * kesediaan, lalu blok penandatangan. Semua kelas cetak memakai
   * awalan registration-print-, jadi cetakan daftar warga, kontak, dan
   * iuran tidak ikut berubah.
   * ------------------------------------------------------------- */
  const RESIDENCE_STATUS_OPTIONS = ["Tetap", "Kontrak", "Kos"];
  /* Kunci localStorage untuk ukuran huruf tanggal pada baris
   * "JAKARTA, ...". Dipakai hanya di peramban pengguna ini. */
  const REGISTRATION_DATE_SIZE_KEY = "kifayah.registration.dateFontSize";
  const DEFAULT_DATE_FONT_SIZE = 9;
  /* Jumlah baris minimal di tabel anggota. Sisanya dibiarkan kosong agar
   * warga bisa menambah anggota dengan tangan di kertas. */
  const BLANK_MEMBER_ROWS = 8;

  function printText(value, fallback = "-") {
    const text = value === null || value === undefined ? "" : String(value).trim();
    return text || fallback;
  }

  /* Kotak STATUS dicetak sebagai daftar centang supaya formulir di
   * kertas masih bisa diisi tangan, sama seperti formulir aslinya. */
  function buildStatusChoices(current) {
    const wrapper = document.createElement("span");
    wrapper.className = "registration-print-choices";
    const normalized = String(current || "").trim().toLowerCase();
    for (const option of RESIDENCE_STATUS_OPTIONS) {
      const item = document.createElement("span");
      item.className = "registration-print-choice";
      item.textContent = `${normalized === option.toLowerCase() ? "☒" : "☐"} ${option.toUpperCase()}`;
      wrapper.append(item);
    }
    return wrapper;
  }

  /* Satu baris "LABEL : nilai". Nilai boleh berupa teks atau elemen,
   * dipakai untuk STATUS dan ALAMAT RUMAH yang butuh baris tambahan. */
  function buildFieldRow(label, value) {
    const row = document.createElement("tr");
    const term = document.createElement("th");
    term.scope = "row";
    term.textContent = label;
    const colon = document.createElement("td");
    colon.className = "registration-print-colon";
    colon.textContent = ":";
    const definition = document.createElement("td");
    if (value instanceof Node) {
      definition.append(value);
    } else {
      definition.textContent = printText(value);
    }
    row.append(term, colon, definition);
    return row;
  }

  function buildRegistrationPrintSheet(registration) {
    const sheet = byId("registration-print-sheet");
    if (!sheet) return;
    sheet.replaceChildren();
    const site = registrationSettings();
    /* Ukuran font kop disimpan sebagai piksel (layar) lalu dipakai di
     * CSS layar sebagai px dan di CSS cetak sebagai poin (1 px = 0,75
     * pt), jadi terlihat proporsional baik di pratinjau maupun hasil
     * cetak. */
    sheet.style.setProperty("--export-title-size", String(Math.min(60, Math.max(8, Number(site.export_header_title_size) || 21))));
    sheet.style.setProperty("--export-line-size", String(Math.min(60, Math.max(8, Number(site.export_header_line_size) || 13))));
    sheet.style.setProperty("--export-contact-size", String(Math.min(60, Math.max(8, Number(site.export_header_contact_size) || 10))));

    /* Kop surat: dua logo mengapit tiga baris judul, lalu baris
     * sekretariat dan garis penutup seperti surat resmi. */
    const letterhead = document.createElement("div");
    letterhead.className = "registration-print-letterhead";
    const headLogo = document.createElement("img");
    headLogo.src = "/media/export_logo/1";
    headLogo.alt = "Logo kiri";
    headLogo.className = "registration-print-logo";
    const logoSizeLeft = Math.min(200, Math.max(20, Number(site.export_logo_1_size) || 74));
    headLogo.style.width = `${logoSizeLeft}px`;
    headLogo.style.height = `${logoSizeLeft}px`;
    headLogo.addEventListener("error", () => { headLogo.style.display = "none"; });
    const headText = document.createElement("div");
    headText.className = "registration-print-letterhead-text";
    const headLines = [
      site.export_header_title,
      site.export_header_line_2,
      site.export_header_line_3,
    ].filter(Boolean);
    headLines.forEach((line, index) => {
      const element = document.createElement(index === 0 ? "h2" : "p");
      element.textContent = line;
      headText.append(element);
    });
    const headLogoRight = document.createElement("img");
    headLogoRight.src = "/media/export_logo/2";
    headLogoRight.alt = "Logo kanan";
    headLogoRight.className = "registration-print-logo";
    const logoSizeRight = Math.min(200, Math.max(20, Number(site.export_logo_2_size) || 74));
    headLogoRight.style.width = `${logoSizeRight}px`;
    headLogoRight.style.height = `${logoSizeRight}px`;
    headLogoRight.addEventListener("error", () => { headLogoRight.style.display = "none"; });
    /* Logo kiri dan kanan mengapit satu blok teks yang berisi judul dan
     * kontak sekaligus. Karena kontak bagian dari blok yang sama, logo
     * memusat terhadap seluruh teks dan jarak kontak ke judul selalu
     * tetap berapa pun ukuran logonya. */
    const letterheadBody = document.createElement("div");
    letterheadBody.className = "registration-print-letterhead-body";
    letterheadBody.append(headText);
    if (site.export_header_line_4) {
      const contactText = document.createElement("p");
      contactText.className = "registration-print-letterhead-contact";
      contactText.textContent = site.export_header_line_4;
      letterheadBody.append(contactText);
    }
    letterhead.append(headLogo, letterheadBody, headLogoRight);
    sheet.append(letterhead);
    const rule = document.createElement("div");
    rule.className = "registration-print-rule";
    sheet.append(rule);

    const formTitle = document.createElement("h1");
    formTitle.className = "registration-print-form-title";
    formTitle.textContent = "FORMULIR PENDAFTARAN BADAN SOSIAL KEMATIAN";
    sheet.append(formTitle);

    /* Data kepala keluarga. ALAMAT RUMAH disusun berbaris: jalan, RT/RW,
     * lalu baris kelurahan/kecamatan/kota dari pengaturan kop. */
    const addressBlock = document.createElement("div");
    addressBlock.append(document.createTextNode(printText(registration.address)), document.createElement("br"));
    const rtLine = document.createElement("span");
    rtLine.className = "registration-print-rt";
    rtLine.textContent = `RT. ${String(registration.rt || "-").padStart(3, "0")}`;
    const rwLine = document.createElement("span");
    rwLine.className = "registration-print-rw";
    rwLine.textContent = `RW. ${String(registration.rw || "-").padStart(3, "0")}`;
    addressBlock.append(rtLine, rwLine, document.createElement("br"));
    for (const line of String(site.export_address_lines || "").split("\n")) {
      const text = line.trim();
      if (text) addressBlock.append(document.createTextNode(text), document.createElement("br"));
    }

    const headTable = document.createElement("table");
    headTable.className = "registration-print-fields";
    const headBody = document.createElement("tbody");
    for (const row of [
      buildFieldRow("NO KARTU KELUARGA", registration.family_card_number),
      buildFieldRow("STATUS", buildStatusChoices(registration.residence_status)),
      buildFieldRow("NAMA KEPALA KELUARGA", registration.head_name),
      buildFieldRow("NIK KTP", registration.national_id_number),
      buildFieldRow("TEMPAT & TANGGAL LAHIR", `${printText(registration.birthplace)}, ${printText(registration.birth_date)}`),
      buildFieldRow("AGAMA", registration.religion),
      buildFieldRow("JENIS KELAMIN", registration.gender),
      buildFieldRow("ALAMAT RUMAH", addressBlock),
      buildFieldRow("PEKERJAAN", registration.job),
      buildFieldRow("NOMOR HP", registration.phone),
    ]) {
      headBody.append(row);
    }
    headTable.append(headBody);
    sheet.append(headTable);

    /* Anggota keluarga. Baris kosong disediakan supaya warga bisa
     * menambah anggota dengan tangan di kertas seperti formulir asli. */
    /* Lebar tiap kolom ditetapkan lewat colgroup. Tanpa itu, table-layout
     * fixed membagi lebar halaman sama rata ke delapan kolom sehingga
     * kolom NIK terlalu lebar sementara KET terlalu sempit, dan tabelnya
     * terlihat tidak simetris.
     *
     * NAMA diberi lebar terbesar karena isinya paling sering panjang
     * (nama ganda) dan tidak masalah kalau membungkus dua baris.
     * NIK dikecilkan karena 16 digit tetap muat dengan kolom lebih ramping,
     * sementara KET diperbesar supaya catatannya lega. */
    const memberTable = document.createElement("table");
    memberTable.className = "registration-print-members";
    memberTable.innerHTML = `<colgroup>
      <col style="width:6%"><col style="width:26%"><col style="width:18%"><col style="width:12%">
      <col style="width:12%"><col style="width:4%"><col style="width:10%"><col style="width:12%">
    </colgroup>
    <thead><tr><th>NO</th><th>NAMA</th><th>NIK</th><th>TEMPAT LAHIR</th><th>TANGGAL LAHIR</th><th>L/P</th><th>HUBUNGAN</th><th>KET</th></tr></thead>`;
    const memberBody = document.createElement("tbody");
    const members = registration.members || [];
    const appendMemberRow = (values) => {
      const row = document.createElement("tr");
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value === "" || value === null || value === undefined ? "" : String(value);
        row.append(cell);
      }
      memberBody.append(row);
    };
    members.forEach((member, index) => {
      appendMemberRow([
        index + 1, member.full_name, member.national_id_number, member.birthplace,
        member.birth_date, member.gender, member.relationship, member.remark,
      ]);
    });
    for (let index = members.length; index < BLANK_MEMBER_ROWS; index += 1) {
      appendMemberRow([index + 1, "", "", "", "", "", "", ""]);
    }
    memberTable.append(memberBody);
    sheet.append(memberTable);

    if (registration.agreement_note) {
      const agreement = document.createElement("div");
      agreement.className = "registration-print-agreement";
      const lead = document.createElement("p");
      lead.textContent = "DENGAN INI KAMI BERSEDIA :";
      const list = document.createElement("ol");
      for (const line of String(registration.agreement_note).split("\n")) {
        const text = line.trim();
        if (!text) continue;
        const item = document.createElement("li");
        // Nomor urut sudah ikut menempel pada teks, jadi penomoran
        // otomatis dimatikan agar tidak tercetak dua kali.
        item.textContent = text.replace(/^\s*\d+[.)]\s*/, "");
        list.append(item);
      }
      agreement.append(lead, list);
      sheet.append(agreement);
    }
    if (registration.status === "Ditolak" && registration.review_note) {
      const rejected = document.createElement("p");
      rejected.className = "registration-print-agreement";
      rejected.textContent = `Catatan penolakan: ${registration.review_note}`;
      sheet.append(rejected);
    }

    /* ---------------------------------------------------------------
     * Blok tanda tangan
     *
     * Bagian atas: Ketua RT (warga) di kiri dan Yang Mengisi Data
     * (pengurus) di kanan, dengan tanggal di tengah atas keduanya.
     * Bagian bawah: "Mengetahui / Menyetujui" dengan tiga jabatan
     * (LMK, Ketua RW, Ketua BSK) bersebelahan.
     * ------------------------------------------------------------- */
    const signatureOf = (role) =>
      (registration.signatures || []).find((item) => item.role === role) || {};
    const labelOf = (role) =>
      site[`signature_label_${role}`] ||
      (SIGNATURE_ROLES.find((item) => item.role === role) || {}).label ||
      role.toUpperCase();

    /* Tanggal cetak diambil dari pengaturan "Tanggal Tanda Tangan" supaya
     * pengurus bisa mencatat hari, bulan, dan tahun saat formulir ditandatangani,
     * bukan tanggal hari ini yang terus bergerak. Kalau pengaturan masih
     * kosong, jatuh ke tanggal hari ini supaya cetakan tidak pernah kosong. */
    const today = new Intl.DateTimeFormat("id-ID", {
      day: "numeric", month: "long", year: "numeric",
    }).format(new Date()).toUpperCase();
    const printDate = String(site.signature_date || "").trim().toUpperCase() || today;

    /* Seluruh blok dibungkus satu wadah agar tidak pernah terbelah dua
     * halaman. Tanpa pembungkus ini peramban sewaktu-waktu memindahkan
     * tiga jabatan ke halaman berikutnya. */
    const signatures = document.createElement("div");
    signatures.className = "registration-print-signatures";

    /* Ukuran huruf tanggal ikut diatur lewat input di dialog supaya
     * pengguna bisa memperbesar atau memperkecil tanpa membuka
     * pengaturan terpisah. Nilai disimpan per pengguna di localStorage
     * supaya tidak hilang saat dialog ditutup. */
    const storedSize = Number.parseFloat(
      window.localStorage?.getItem(REGISTRATION_DATE_SIZE_KEY) || "",
    );
    const dateFontSize = Number.isFinite(storedSize) && storedSize >= 7 && storedSize <= 24
      ? storedSize
      : DEFAULT_DATE_FONT_SIZE;

    /* ---- Bagian atas: Ketua RT + Yang Mengisi Data ---- */
    const topDate = document.createElement("p");
    topDate.className = "registration-print-place-date";
    topDate.style.fontSize = `${dateFontSize}pt`;
    topDate.textContent = `${printText(site.signature_place, "JAKARTA")}, ${printDate}`;
    signatures.append(topDate);

    const topGrid = document.createElement("div");
    topGrid.className = "registration-print-top-grid";

    const rtCell = document.createElement("div");
    rtCell.className = "registration-print-sig-cell";
    const rtLabel = document.createElement("strong");
    rtLabel.className = "registration-print-sig-label";
    rtLabel.textContent = labelOf("rt");
    const rtPreview = document.createElement("div");
    rtPreview.className = "registration-print-sig-preview";
    const rtSignature = signatureOf("rt");
    if (rtSignature.has_image) {
      const rtImage = document.createElement("img");
      rtImage.src = `${rtSignature.image_url}?v=${encodeURIComponent(rtSignature.signed_at || "1")}`;
      rtImage.alt = `Tanda tangan ${labelOf("rt")}`;
      rtPreview.append(rtImage);
    }
    const rtName = document.createElement("span");
    rtName.className = "registration-print-sig-name";
    rtName.textContent = rtSignature.name ? `( ${rtSignature.name} )` : "";
    rtCell.append(rtLabel, rtPreview, rtName);

    const makerCell = document.createElement("div");
    makerCell.className = "registration-print-sig-cell";
    const makerLabel = document.createElement("strong");
    makerLabel.className = "registration-print-sig-label";
    makerLabel.textContent = "yang membuat,";
    const makerPreview = document.createElement("div");
    makerPreview.className = "registration-print-sig-preview";
    const makerSignature = signatureOf("maker");
    if (makerSignature.has_image) {
      const makerImage = document.createElement("img");
      makerImage.src = `${makerSignature.image_url}?v=${encodeURIComponent(makerSignature.signed_at || "1")}`;
      makerImage.alt = "Tanda tangan Yang Mengisi Data";
      makerPreview.append(makerImage);
    }
    const makerName = document.createElement("span");
    makerName.className = "registration-print-sig-name";
    makerName.textContent = makerSignature.name ? `( ${makerSignature.name} )` : "";
    makerCell.append(makerLabel, makerPreview, makerName);

    topGrid.append(rtCell, makerCell);
    signatures.append(topGrid);

    /* ---- Bagian bawah: Mengetahui / Menyetujui ---- */
    const approval = document.createElement("div");
    approval.className = "registration-print-approval";
    const approvalNote = document.createElement("p");
    approvalNote.className = "registration-print-approval-note";
    approvalNote.textContent = site.signature_note || "Mengetahui / Menyetujui";
    const approvalGrid = document.createElement("div");
    approvalGrid.className = "registration-print-approval-grid";
    for (const role of ["lmk", "rw", "bsk"]) {
      const cell = document.createElement("div");
      cell.className = "registration-print-sig-cell";
      const label = document.createElement("strong");
      label.className = "registration-print-sig-label";
      label.textContent = labelOf(role);
      const preview = document.createElement("div");
      preview.className = "registration-print-sig-preview";
      const signature = signatureOf(role);
      if (signature.has_image) {
        const image = document.createElement("img");
        image.src = `${signature.image_url}?v=${encodeURIComponent(signature.signed_at || "1")}`;
        image.alt = `Tanda tangan ${labelOf(role)}`;
        preview.append(image);
      }
      const name = document.createElement("span");
      name.className = "registration-print-sig-name";
      name.textContent = signature.name ? `( ${signature.name} )` : "";
      cell.append(label, preview, name);
      approvalGrid.append(cell);
    }
    approval.append(approvalNote, approvalGrid);
    signatures.append(approval);
    sheet.append(signatures);
  }

  /* ---------------------------------------------------------------
   * Pengaturan cetakan di dalam dialog
   *
   * Tempat dan tanggal disimpan ke server karena keduanya ikut dipakai
   * juga oleh ekspor PDF, jadi tidak boleh berbeda antar dokumen.
   * Ukuran huruf hanya relevan untuk cetakan formulir sehingga disimpan
   * di localStorage, cukup untuk satu perangkat yang sedang dipakai.
   * ------------------------------------------------------------- */
  const printPlaceInput = byId("registration-print-place");
  const printDateInput = byId("registration-print-date");
  const printSizeInput = byId("registration-print-size");
  const printSettingsStatus = byId("registration-print-settings-status");
  const printSettingsSave = byId("registration-print-settings-save");

  function fillPrintSettingsInputs() {
    const site = registrationSettings();
    if (printPlaceInput) printPlaceInput.value = site.signature_place || "";
    if (printDateInput) printDateInput.value = site.signature_date || "";
    if (printSizeInput) {
      const stored = Number.parseFloat(window.localStorage?.getItem(REGISTRATION_DATE_SIZE_KEY) || "");
      printSizeInput.value = String(
        Number.isFinite(stored) && stored >= 7 && stored <= 24 ? stored : DEFAULT_DATE_FONT_SIZE,
      );
    }
    if (printSettingsStatus) printSettingsStatus.textContent = "";
  }

  if (printSettingsSave) {
    printSettingsSave.addEventListener("click", async () => {
      const place = (printPlaceInput?.value || "").trim();
      const date = (printDateInput?.value || "").trim();
      const size = Number.parseFloat(printSizeInput?.value || "");
      if (printSettingsStatus) printSettingsStatus.textContent = "Menyimpan…";
      printSettingsSave.disabled = true;
      try {
        if (Number.isFinite(size) && size >= 7 && size <= 24) {
          window.localStorage?.setItem(REGISTRATION_DATE_SIZE_KEY, String(size));
        }
        await request("/api/settings", {
          method: "POST",
          body: JSON.stringify({ signature_place: place, signature_date: date }),
        });
        // Menerima balik nilai settings terbaru supaya form di bawah
        // ikut memakai tanggal yang baru saja disimpan.
        await window.kifayahLoadSettings?.();
        const site = registrationSettings();
        site.signature_place = place;
        site.signature_date = date;
        if (printSettingsStatus) printSettingsStatus.textContent = "Tersimpan. Cetak ulang untuk melihat perubahan.";
      } catch (error) {
        if (printSettingsStatus) printSettingsStatus.textContent = error.message;
      } finally {
        printSettingsSave.disabled = false;
      }
    });
  }

  /* Logo dan tanda tangan adalah gambar. Kalau print() dipanggil sebelum
   * gambar selesai diunduh, kertas keluar tanpa kop dan tanpa tanda tangan.
   * Tunggu gambar dulu, tapi jangan menggantung bila ada yang gagal. */
  function waitForPrintImages(root) {
    const images = Array.from(root.querySelectorAll("img"));
    const pending = images.filter((image) => !image.complete);
    if (!pending.length) return Promise.resolve();
    return Promise.all(pending.map((image) => new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    })));
  }

  /* Aturan @page tidak bisa di-scope ke kelas tertentu, jadi untuk mencetak
   * formulir ini stylenya disisipkan sementara ke <head> lalu
   * dicabut lagi setelah selesai. Dengan begitu cetakan daftar warga,
   * kontak, dan iuran tetap memakai ukuran kertas pilihan pengguna. */
  const PRINT_PAGE_STYLE_ID = "registration-print-page-rule";
  function mountRegistrationPrintPageRule() {
    const style = document.createElement("style");
    style.id = PRINT_PAGE_STYLE_ID;
    style.textContent = "@page { size: A4 portrait; margin: 10mm; }";
    document.head.append(style);
  }
  function unmountRegistrationPrintPageRule() {
    document.getElementById(PRINT_PAGE_STYLE_ID)?.remove();
  }

  const registrationPrintButton = byId("registration-print-button");
  if (registrationPrintButton) {
    registrationPrintButton.addEventListener("click", async () => {
      if (!activeRegistration) return;
      const sheet = byId("registration-print-sheet");
      buildRegistrationPrintSheet(activeRegistration);
      registrationPrintButton.disabled = true;
      if (sheet) await waitForPrintImages(sheet);
      // Kelas penanda hanya diperlukan selama dialog printer terbuka,
      // lalu dilepas lagi supaya tampilan layar tidak ikut berubah.
      document.body.classList.add("is-printing-registration");
      mountRegistrationPrintPageRule();
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        document.body.classList.remove("is-printing-registration");
        unmountRegistrationPrintPageRule();
        window.removeEventListener("afterprint", restore);
        registrationPrintButton.disabled = false;
      };
      window.addEventListener("afterprint", restore);
      window.print();
      // Pengaman bila peramban tidak memicu afterprint, misal printer
      // dibatalkan dari dialog sistem.
      window.setTimeout(restore, 30000);
    });
  }

  const registrationDialogClose = byId("registration-dialog-close");
  if (registrationDialogClose && registrationDialog) {
    registrationDialogClose.addEventListener("click", () => registrationDialog.close());
    registrationDialog.addEventListener("click", (event) => {
      if (event.target === registrationDialog) registrationDialog.close();
    });
    registrationDialog.addEventListener("cancel", () => registrationDialog.close());
  }

  byId("registration-approve")?.addEventListener("click", async () => {
    if (!activeRegistration) return;
    const errorElement = byId("registration-review-error");
    errorElement.textContent = "";
    const note = byId("registration-review-note")?.value || "";
    try {
      const result = await request("/api/admin/registrations/review", {
        method: "POST",
        body: JSON.stringify({ registration_id: activeRegistration.id, decision: "approve", note }),
      });
      applyRegistration(result.registration);
      const status = byId("registration-list-status");
      if (status) status.textContent = `${activeRegistration.head_name} disetujui dan masuk ke daftar warga.`;
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });

  byId("registration-reject")?.addEventListener("click", async () => {
    if (!activeRegistration) return;
    const errorElement = byId("registration-review-error");
    errorElement.textContent = "";
    const note = byId("registration-review-note")?.value || "";
    if (!note.trim()) {
      errorElement.textContent = "Tuliskan alasan penolakan agar warga dapat memperbaiki data.";
      return;
    }
    if (!window.confirm(`Tolak formulir atas nama ${activeRegistration.head_name}?`)) return;
    try {
      const result = await request("/api/admin/registrations/review", {
        method: "POST",
        body: JSON.stringify({ registration_id: activeRegistration.id, decision: "reject", note }),
      });
      applyRegistration(result.registration);
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });

  /* ---------------------------------------------------------------
   * Pencatatan manual oleh admin
   * ------------------------------------------------------------- */
  const createDialog = byId("registration-create-dialog");
  const createForm = byId("registration-create-form");

  function fillCreateAreaSelects() {
    fillAreaOptions(byId("registration-create-rt"), "RT", registrationSettings().rt_count || 1);
    fillAreaOptions(byId("registration-create-rw"), "RW", registrationSettings().rw_count || 1);
  }

  /* ---------------------------------------------------------------
   * Ambil data kepala keluarga dari daftar warga iuran
   *
   * Hanya tersedia di formulir admin. Menghemat pengetikan kepala keluarga
   * beserta semua anggotanya. Bila warga belum terdaftar di iuran, kolom
   * dibiarkan kosong untuk diisi manual seperti biasa.
   * ------------------------------------------------------------- */
  const familySearchInput = byId("registration-family-search");
  const familyResults = byId("registration-family-results");

  function renderFamilyResults(families, query) {
    if (!familyResults) return;
    familyResults.replaceChildren();
    familyResults.hidden = false;
    if (!families.length) {
      const empty = document.createElement("p");
      empty.className = "form-hint";
      empty.textContent = `Tidak ada warga iuran yang cocok dengan "${query}". Isi formulir secara manual.`;
      familyResults.append(empty);
      return;
    }
    const hint = document.createElement("p");
    hint.className = "form-hint";
    hint.textContent = `${families.length} warga ditemukan. Pilih salah satu untuk mengisi formulir.`;
    familyResults.append(hint);
    for (const family of families) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "registration-family-option";
      const area = [family.rt ? `RT ${family.rt}` : "", family.rw ? `RW ${family.rw}` : ""].filter(Boolean).join(" / ") || "Tanpa RT/RW";
      const meta = [
        family.relationship ? family.relationship : "Tanpa hubungan",
        family.family_card_number ? `KK ${family.family_card_number}` : "KK kosong",
        family.national_id_number ? `NIK ${family.national_id_number}` : "NIK kosong",
        family.members.length ? `${family.members.length} anggota` : "Tanpa anggota lain",
      ];
      button.innerHTML = `
        <strong></strong>
        <span></span>
        <small></small>`;
      button.querySelector("strong").textContent = family.full_name || "(tanpa nama)";
      button.querySelector("span").textContent = `${area} · ${meta.join(" · ")}`;
      button.querySelector("small").textContent = family.members.length
        ? family.members.map((member) => `${member.full_name}${member.relationship ? ` (${member.relationship})` : ""}`).join(", ")
        : "Tidak ada anggota lain di data iuran.";
      button.addEventListener("click", () => applyFamilyToCreateForm(family));
      familyResults.append(button);
    }
  }

  function applyFamilyToCreateForm(family) {
    const form = byId("registration-create-form");
    if (!form) return;
    const hasContent = ["head_name", "family_card_number", "national_id_number"]
      .some((name) => String(form.elements[name]?.value || "").trim());
    if (hasContent && !window.confirm(
      `Formulir sudah berisi data. Data yang ada akan diganti dengan data ${family.full_name || "warga ini"}. Lanjutkan?`,
    )) return;
    const setValue = (name, value) => {
      const field = form.elements[name];
      if (field) field.value = value == null ? "" : String(value);
    };
    setValue("head_name", family.full_name);
    setValue("gender", family.gender ? String(family.gender).toUpperCase().slice(0, 1) : "");
    setValue("family_card_number", family.family_card_number);
    setValue("national_id_number", family.national_id_number);
    setValue("birthplace", family.birthplace);
    setValue("birth_date", family.birth_date);
    setValue("religion", family.religion);
    setValue("residence_status", family.residence_status);
    setValue("rt", family.rt);
    setValue("rw", family.rw);
    setValue("address", family.address);
    setValue("phone", family.phone);
    // Anggota keluarga mengikuti data iuran. Kepala keluarga sendiri tidak
    // ikut karena sudah mengisi kolom kepala keluarga.
    resetMemberRows(byId("registration-create-member-rows"), byId("registration-create-member-add"), "Anggota");
    const memberContainer = byId("registration-create-member-rows");
    if (memberContainer) {
      family.members.forEach((member) => {
        const row = memberRow();
        fillMemberRow(row, member);
        memberContainer.append(row);
      });
    }
    syncMemberFamilyCards({ form, containerId: "registration-create-member-rows" });
    renumberMemberRows();
    byId("registration-family-status")?.removeAttribute("hidden");
    closeFamilyResults();
  }

  let familySearchTimer = null;
  // Pencarian terakhir yang masih berjalan. Dipakai untuk membuang jawaban
  // yang tiba setelah pengguna sudah memilih keluarga: tanpa ini, daftar
  // hasil lama akan muncul lagi di layar setelah ditutup.
  let latestFamilyQuery = "";

  /* Tutup daftar hasil pencarian dan kosongkan kolom cari.
   *
   * Dipanggil setelah keluarga dipilih supaya formulir langsung bisa
   * diisi tanpa harus menekan tombol × lebih dulu. Kolom cari dikosongkan
   * karena isinya sudah terpakai; bila tidak dikosongkan, daftar akan
   * muncul lagi hanya begitu pengguna menyentuh kolom itu. */
  function closeFamilyResults() {
    window.clearTimeout(familySearchTimer);
    latestFamilyQuery = "";
    if (!familyResults) return;
    familyResults.replaceChildren();
    familyResults.hidden = true;
    if (familySearchInput) familySearchInput.value = "";
    // Status "tidak ada yang cocok" ikut disembunyikan supaya tidak
    // tertinggal di layar setelah data sudah masuk.
    const status = byId("registration-family-status");
    if (status) status.setAttribute("hidden", "");
  }

  familySearchInput?.addEventListener("input", () => {
    window.clearTimeout(familySearchTimer);
    const query = familySearchInput.value.trim();
    latestFamilyQuery = query;
    if (query.length < 2) {
      if (familyResults) {
        familyResults.replaceChildren();
        familyResults.hidden = true;
      }
      return;
    }
    familySearchTimer = window.setTimeout(async () => {
      try {
        const payload = await request(`/api/admin/registrations/family-search?q=${encodeURIComponent(query)}`);
        // Buang jawaban yang sudah tidak relevan.
        if (latestFamilyQuery !== query) return;
        renderFamilyResults(payload.families || [], query);
      } catch (error) {
        if (latestFamilyQuery !== query) return;
        if (!familyResults) return;
        familyResults.replaceChildren();
        familyResults.hidden = false;
        const message = document.createElement("p");
        message.className = "form-error";
        message.textContent = error.message;
        familyResults.append(message);
      }
    }, 280);
  });

  byId("add-registration")?.addEventListener("click", () => {
    fillCreateAreaSelects();
    createForm?.reset();
    resetMemberRows(
      byId("registration-create-member-rows"),
      byId("registration-create-member-add"),
      "Anggota",
    );
    syncMemberFamilyCards({ form: createForm, containerId: "registration-create-member-rows" });
    const errorElement = byId("registration-create-error");
    if (errorElement) errorElement.textContent = "";
    createDialog?.showModal();
  });

  byId("registration-create-close")?.addEventListener("click", () => createDialog?.close());
  byId("registration-create-cancel")?.addEventListener("click", () => createDialog?.close());
  if (createDialog) {
    createDialog.addEventListener("click", (event) => {
      if (event.target === createDialog) createDialog.close();
    });
    createDialog.addEventListener("cancel", () => createDialog.close());
  }

  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorElement = byId("registration-create-error");
    errorElement.textContent = "";
    const payload = Object.fromEntries(new FormData(createForm));
    payload.members = collectMembers(byId("registration-create-member-rows"));
    const identityError = validateMemberIdentities(createForm, payload.members);
    if (identityError) {
      errorElement.textContent = identityError;
      return;
    }
    try {
      await request("/api/admin/registrations", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      createDialog?.close();
      await loadRegistrations();
      const status = byId("registration-list-status");
      if (status) status.textContent = "Formulir tersimpan dan masuk ke antrean verifikasi.";
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });

  /* ---------------------------------------------------------------
   * Wiring
   * ------------------------------------------------------------- */
  let searchTimer = null;
  byId("registration-search")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadRegistrations, 250);
  });
  byId("registration-status-filter")?.addEventListener("change", loadRegistrations);

  // Modul lain butuh memuat ulang antrean setelah perubahan.
  window.loadRegistrations = loadRegistrations;
  window.loadResidentRegistrations = loadResidentRegistrations;

  if (residentForm) {
    fillRegistrationAreaSelects();
    resetMemberRows(byId("resident-member-rows"), byId("resident-member-add"), "Anggota");
    residentForm.elements.family_card_number?.addEventListener("input", () =>
      syncMemberFamilyCards({ form: residentForm, containerId: "resident-member-rows" }));
  }
  if (createForm) {
    fillCreateAreaSelects();
    resetMemberRows(
      byId("registration-create-member-rows"),
      byId("registration-create-member-add"),
      "Anggota",
    );
    createForm.elements.family_card_number?.addEventListener("input", () =>
      syncMemberFamilyCards({ form: createForm, containerId: "registration-create-member-rows" }));
  }
})();
