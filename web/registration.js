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
      row.remove();
      renumberMemberRows();
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
    const form = scope?.form;
    if (!form) return;
    const kk = headFamilyCardNumber(form);
    const containers = scope
      ? [byId(scope.containerId)]
      : [byId("resident-member-rows"), byId("registration-create-member-rows")];
    for (const container of containers) {
      if (!container) continue;
      container.querySelectorAll("[data-field='family_card_number']").forEach((input) => {
        input.value = kk;
      });
    }
    containers.forEach((container) => {
      if (!container) return;
      const note = container.closest("fieldset")?.querySelector("[data-kk-note]");
      if (note) {
        note.textContent = kk
          ? `Semua anggota memakai Nomor Kartu Keluarga ${kk}, sama dengan kepala keluarga.`
          : "Isi Nomor Kartu Keluarga pada Langkah 1; nomor itu otomatis dipakai semua anggota.";
      }
    });
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

  function renumberMemberRows() {
    for (const container of [byId("resident-member-rows"), byId("registration-create-member-rows")]) {
      container?.querySelectorAll(".registration-member-row").forEach(labelMemberRow);
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
        container.append(memberRow());
        renumberMemberRows();
        syncMemberFamilyCards();
        container.lastElementChild?.querySelector("input:not([readonly])")?.focus();
      };
    }
  }

  /* ---------------------------------------------------------------
   * Sisi warga
   * ------------------------------------------------------------- */
  const residentForm = byId("resident-registration-form");

  function fillRegistrationAreaSelects() {
    const rt = byId("resident-registration-rt");
    const rw = byId("resident-registration-rw");
    const rtCount = registrationSettings().rt_count || 1;
    const rwCount = registrationSettings().rw_count || 1;
    if (rt && !rt.dataset.filled) {
      for (let value = 1; value <= rtCount; value += 1) {
        rt.append(new Option(`RT ${String(value).padStart(3, "0")}`, String(value)));
      }
      rt.dataset.filled = "true";
    }
    if (rw && !rw.dataset.filled) {
      for (let value = 1; value <= rwCount; value += 1) {
        rw.append(new Option(`RW ${String(value).padStart(3, "0")}`, String(value)));
      }
      rw.dataset.filled = "true";
    }
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
    const tab = byId("admin-tab-registrations");
    if (tab) {
      tab.title = pendingTotal
        ? `${pendingTotal} formulir menunggu verifikasi`
        : "Tidak ada formulir yang menunggu";
    }
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
    const locked = registration.status === "Disetujui";
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
      name.disabled = locked;
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
      const draw = document.createElement("button");
      draw.type = "button";
      draw.className = "action-button";
      draw.textContent = "Tanda Tangan Langsung";
      draw.disabled = locked;
      draw.addEventListener("click", () => {
        window.openRegistrationSignaturePad(meta.role, name.value.trim());
      });
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "text-button";
      clear.textContent = "Hapus";
      clear.hidden = !signature.has_image;
      clear.disabled = locked;
      clear.addEventListener("click", async () => {
        if (!window.confirm(`Hapus tanda tangan ${meta.label} dari formulir ini?`)) return;
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
      actions.append(draw, clear);
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

  async function openRegistration(registrationId) {
    const errorElement = byId("registration-review-error");
    if (errorElement) errorElement.textContent = "";
    try {
      const payload = await request(`/api/admin/registrations/${registrationId}`);
      renderRegistrationDetail(payload.registration);
      registrationDialog?.showModal();
    } catch (error) {
      const listStatus = byId("registration-list-status");
      if (listStatus) listStatus.textContent = error.message;
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
    if (typeof clear === "function") clear();
    else {
      const ctx = pad.getContext("2d");
      ctx.clearRect(0, 0, pad.width, pad.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pad.width, pad.height);
    }
    padDialog.showModal();
  };

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
    const rt = byId("registration-create-rt");
    const rw = byId("registration-create-rw");
    const rtCount = registrationSettings().rt_count || 1;
    const rwCount = registrationSettings().rw_count || 1;
    if (rt && !rt.dataset.filled) {
      for (let value = 1; value <= rtCount; value += 1) {
        rt.append(new Option(`RT ${String(value).padStart(3, "0")}`, String(value)));
      }
      rt.dataset.filled = "true";
    }
    if (rw && !rw.dataset.filled) {
      for (let value = 1; value <= rwCount; value += 1) {
        rw.append(new Option(`RW ${String(value).padStart(3, "0")}`, String(value)));
      }
      rw.dataset.filled = "true";
    }
  }

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