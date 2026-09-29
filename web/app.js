const listElement = document.querySelector("#record-list");
const searchInput = document.querySelector("#search-input");
const sortSelect = document.querySelector("#sort-select");
const countElement = document.querySelector("#record-count");
const emptyState = document.querySelector("#empty-state");
const dialog = document.querySelector("#admin-dialog");
const loginForm = document.querySelector("#login-form");
const managerPanel = document.querySelector("#manager-panel");
const recordForm = document.querySelector("#record-form");
const settingsForm = document.querySelector("#settings-form");
const records = [];
const settings = { rt_count: 1, rw_count: 7, icon_zoom_1: 100, icon_zoom_2: 100 };
const THEME_STORAGE_KEY = "kifayah-theme";
let importRows = [];
let isAdmin = false;
let currentUser = null;
let selectedGenderFilter = "";
const isAdminPage = window.location.pathname === "/admin";
document.body.classList.toggle("admin-page", isAdminPage);
if (isAdminPage) document.title = "Admin | Data Kifayah";

const importFields = [
  ["full_name", "Nama", "text"],
  ["gender", "Jenis kelamin", "gender"],
  ["rt", "RT", "number"],
  ["rw", "RW", "number"],
  ["date_of_death", "Tanggal wafat", "date"],
  ["address", "Alamat", "text"],
  ["family_card_number", "Nomor kartu keluarga", "text"],
  ["national_id_number", "NIK", "text"],
  ["birthplace", "Tempat lahir", "text"],
  ["birth_date", "Tanggal lahir", "date"],
  ["religion", "Agama", "text"],
  ["living_family_name", "Nama anggota keluarga", "text"],
  ["living_family_relationship", "Hubungan keluarga", "text"],
];

// TEMA: preferensi yang sama dipakai di beranda dan panel pengelola.
function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  document.querySelector("#browser-theme-color").content = isDark ? "#151c18" : "#174d3c";
  const toggle = document.querySelector("#theme-toggle");
  if (!toggle) return;
  toggle.textContent = isDark ? "☀️" : "🌙";
  toggle.setAttribute("aria-pressed", String(isDark));
  toggle.setAttribute("aria-label", isDark ? "Aktifkan mode terang" : "Aktifkan mode malam");
  toggle.title = isDark ? "Aktifkan mode terang" : "Aktifkan mode malam";
}

const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
applyTheme(savedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

function applyIconZoom(slot, value) {
  document.documentElement.style.setProperty(`--brand-logo-zoom-${slot}`, String(value / 100));
}

function importDateIsValid(value) {
  const parsedDate = new Date(`${value}T00:00:00Z`);
  return Boolean(value) && !Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString().slice(0, 10) === value;
}

function importRowIsValid(row) {
  const text = (field) => typeof row[field] === "string" ? row[field].trim() : "";
  const fullName = text("full_name");
  const gender = text("gender").toUpperCase();
  const dateOfDeath = text("date_of_death");
  const birthDate = text("birth_date");
  const rtText = text("rt");
  const rwText = text("rw");
  const rt = Number(rtText);
  const rw = Number(rwText);
  const familyName = text("living_family_name");
  const familyRelationship = text("living_family_relationship");
  return fullName.length <= 120
    && (!gender || ["P", "L"].includes(gender))
    && (!dateOfDeath || importDateIsValid(dateOfDeath))
    && (!rtText || (Number.isInteger(rt) && /^\d+$/.test(rtText) && rt >= 1 && rt <= settings.rt_count))
    && (!rwText || (Number.isInteger(rw) && /^\d+$/.test(rwText) && rw >= 1 && rw <= settings.rw_count))
    && text("address").length <= 300
    && text("family_card_number").length <= 32
    && text("national_id_number").length <= 32
    && text("birthplace").length <= 100
    && (!birthDate || importDateIsValid(birthDate))
    && text("religion").length <= 50
    && familyName.length <= 120
    && familyRelationship.length <= 60;
}

function updateImportSummary() {
  const selectedRows = importRows.filter((row) => row.selected);
  const validCount = selectedRows.filter(importRowIsValid).length;
  const skippedCount = selectedRows.length - validCount;
  const selectableRows = importRows.filter((row) => !row.duplicate);
  const selectedSelectableCount = selectableRows.filter((row) => row.selected).length;
  const selectAll = document.querySelector("#import-select-all");
  selectAll.disabled = selectableRows.length === 0;
  selectAll.checked = selectableRows.length > 0 && selectedSelectableCount === selectableRows.length;
  selectAll.indeterminate = selectedSelectableCount > 0 && selectedSelectableCount < selectableRows.length;
  const button = document.querySelector("#import-commit");
  button.disabled = validCount === 0;
  document.querySelector("#import-summary").textContent = importRows.length
    ? `${importRows.length} baris ditemukan. ${selectedRows.length} dipilih; ${validCount} siap diimpor${skippedCount ? `; ${skippedCount} baris memiliki format di luar batas dan akan dilewati` : ""}.`
    : "";
}

function renderImportRows() {
  const list = document.querySelector("#import-preview-list");
  list.replaceChildren();
  importRows.forEach((row, index) => {
    const card = document.createElement("article");
    card.className = "import-row";
    card.dataset.rowIndex = String(index);
    const heading = document.createElement("div");
    heading.className = "import-row-heading";
    const selectLabel = document.createElement("label");
    selectLabel.className = "import-row-select";
    const select = document.createElement("input");
    select.type = "checkbox";
    select.checked = !row.duplicate;
    select.disabled = Boolean(row.duplicate);
    row.selected = select.checked;
    select.addEventListener("change", () => {
      row.selected = select.checked;
      updateImportSummary();
    });
    selectLabel.append(select, document.createTextNode(`Baris ${index + 1}`));
    const title = document.createElement("strong");
    title.textContent = row.full_name || "Nama belum terbaca";
    const status = document.createElement("span");
    status.className = row.duplicate ? "import-status duplicate" : row.ocr_confidence < 0.7 ? "import-status review" : "import-status";
    status.textContent = row.duplicate ? "Duplikat" : row.ocr_confidence < 0.7 ? "Periksa OCR" : "Pratinjau";
    heading.append(selectLabel, title, status);
    const fields = document.createElement("div");
    fields.className = "import-fields";
    for (const [field, labelText, type] of importFields) {
      const label = document.createElement("label");
      label.textContent = labelText;
      const input = type === "gender" ? document.createElement("select") : document.createElement("input");
      if (type === "gender") {
        input.add(new Option("Pilih Jenis Kelamin", ""));
        input.add(new Option("P — Perempuan", "P"));
        input.add(new Option("L — Laki-laki", "L"));
      } else {
        input.type = type;
      }
      input.dataset.importField = field;
      input.value = row[field] ?? "";
      if (type === "number") {
        input.min = "1";
        input.max = String(field === "rt" ? settings.rt_count : settings.rw_count);
      }
      input.addEventListener("input", () => {
        row[field] = input.value;
        if (field === "full_name") title.textContent = input.value || "Nama belum terbaca";
        updateImportSummary();
      });
      label.append(input);
      fields.append(label);
    }
    card.append(heading, fields);
    list.append(card);
  });
  updateImportSummary();
}

// BERANDA: label tanggal, wilayah, dan tautan lokasi.
function formatDate(value) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatAreaLabel(value) {
  const match = String(value || "").match(/RT\s*0*(\d+).*?RW\s*0*(\d+)/i);
  return match ? `RT ${match[1].padStart(3, "0")} / RW ${match[2].padStart(3, "0")}` : value;
}

function mapLink(label, address, service) {
  const url = service === "apple"
    ? `https://maps.apple.com/?q=${encodeURIComponent(address)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const link = document.createElement("a");
  link.className = "map-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  link.append(document.createTextNode(label));
  return link;
}

function visibleRecords() {
  const query = searchInput.value.trim().toLocaleLowerCase("id-ID");
  const filtered = records.filter((record) => `${record.full_name} ${record.area}`.toLocaleLowerCase("id-ID").includes(query)
    && (!selectedGenderFilter || record.gender === selectedGenderFilter));
  if (sortSelect.value === "name") return filtered.sort((a, b) => a.full_name.localeCompare(b.full_name, "id"));
  return filtered.sort((a, b) => sortSelect.value === "oldest"
    ? a.date_of_death.localeCompare(b.date_of_death)
    : b.date_of_death.localeCompare(a.date_of_death));
}

function openRecordDetail(record, index) {
  const dialogContent = document.querySelector("#record-detail-content");
  dialogContent.replaceChildren();
  if (record.portrait_url) {
    const portrait = document.createElement("img");
    portrait.className = "record-detail-portrait";
    portrait.src = record.portrait_url;
    portrait.alt = `Foto ${record.full_name}`;
    dialogContent.append(portrait);
  }
  const title = document.createElement("h2");
  title.id = "record-detail-name";
  title.textContent = `${String(index + 1).padStart(2, "0")}. ${record.full_name || "Nama belum dilengkapi"}`;
  const metadata = document.createElement("div");
  metadata.className = "record-detail-meta";
  const details = [formatAreaLabel(record.area)];
  if (record.gender === "L") details.push("Laki-Laki");
  if (record.gender === "P") details.push("Perempuan");
  if (record.date_of_death) details.push(formatDate(record.date_of_death));
  metadata.textContent = details.join(" · ");
  dialogContent.append(title, metadata);
  if (record.address) {
    const address = document.createElement("p");
    address.className = "record-detail-address";
    address.textContent = record.address;
    const mapLinks = document.createElement("div");
    mapLinks.className = "record-detail-map-links";
    mapLinks.append(mapLink("Google Maps", record.address, "google"), mapLink("Apple Maps", record.address, "apple"));
    dialogContent.append(address, mapLinks);
  }
  document.querySelector("#record-detail-dialog").showModal();
}

function render() {
  document.querySelector("#total-data strong").textContent = records.length;
  document.querySelector("#total-l strong").textContent = records.filter((record) => record.gender === "L").length;
  document.querySelector("#total-p strong").textContent = records.filter((record) => record.gender === "P").length;
  document.querySelector("#total-data").setAttribute("aria-pressed", String(!selectedGenderFilter));
  document.querySelector("#total-l").setAttribute("aria-pressed", String(selectedGenderFilter === "L"));
  document.querySelector("#total-p").setAttribute("aria-pressed", String(selectedGenderFilter === "P"));
  const visible = visibleRecords();
  listElement.replaceChildren();
  countElement.textContent = new Intl.NumberFormat("id-ID").format(visible.length);
  emptyState.hidden = visible.length > 0;
  document.querySelector("#empty-title").textContent = records.length ? "Tidak Ada Hasil" : "Belum Ada Data";
  document.querySelector("#empty-copy").textContent = records.length
  ? "Coba kata kunci atau jenis kelamin lainnya."
  : "Entri yang telah diverifikasi akan ditampilkan di sini.";

  visible.forEach((record, index) => {
    const article = document.createElement("article");
    article.className = "record-card";
    if (record.portrait_url) {
      const portrait = document.createElement("img");
      portrait.className = "record-portrait";
      portrait.src = record.portrait_url;
      portrait.alt = `Foto ${record.full_name}`;
      article.append(portrait);
    }
    const main = document.createElement("div");
    main.className = "record-main";
    const name = document.createElement("button");
    name.className = "record-detail-trigger";
    name.type = "button";
    name.textContent = `${String(index + 1).padStart(2, "0")}. ${record.full_name || "Nama belum dilengkapi"}`;
    name.setAttribute("aria-haspopup", "dialog");
    name.setAttribute("aria-label", `Buka detail ${record.full_name || "warga tanpa nama"}`);
    name.addEventListener("click", () => openRecordDetail(record, index));
    const meta = document.createElement("div");
    meta.className = "record-meta";
    const area = document.createElement("span");
    area.textContent = formatAreaLabel(record.area) || "Wilayah belum dilengkapi";
    const gender = document.createElement("span");
    gender.textContent = record.gender === "L" ? "Laki-Laki" : record.gender === "P" ? "Perempuan" : "";
    const date = document.createElement("span");
    date.textContent = record.date_of_death ? formatDate(record.date_of_death) : "Tanggal wafat belum dilengkapi";
    if (area.textContent) meta.append(area);
    if (gender.textContent) meta.append(gender);
    meta.append(date);
    main.append(name, meta);
    article.append(main);
    if (record.address) {
      const links = document.createElement("div");
      links.className = "record-links";
      links.append(mapLink("Google Maps", record.address, "google"), mapLink("Apple Maps", record.address, "apple"));
      article.append(links);
    }
    listElement.append(article);
  });
}

function formatNewsDate(value) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

let newsArticles = [];
let newsArchivePage = 0;
const NEWS_ARCHIVE_PAGE_SIZE = 2;

function openNewsArticle(article) {
  const content = document.querySelector("#news-detail-content");
  content.replaceChildren();
  if (article.image_url) {
    const image = document.createElement("img");
    image.src = article.image_url;
    image.alt = article.title;
    content.append(image);
  }
  const title = document.createElement("h2");
  title.id = "news-detail-title";
  title.textContent = article.title;
  const headline = document.createElement("p");
  headline.className = "news-detail-headline";
  headline.textContent = article.headline;
  const metadata = document.createElement("div");
  metadata.className = "news-detail-meta";
  metadata.textContent = `${article.author} · ${formatNewsDate(article.uploaded_at)}`;
  const body = document.createElement("p");
  body.className = "news-detail-body";
  body.textContent = article.body;
  content.append(title, headline, metadata, body);
  document.querySelector("#news-detail-dialog").showModal();
}

function createNewsCard(article, featured = false) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = featured ? "news-featured" : "news-article-card";
  card.setAttribute("aria-label", `Baca berita: ${article.title}`);
  if (article.image_url) {
    const image = document.createElement("img");
    image.className = featured ? "news-featured-image" : "news-article-image";
    image.src = article.image_url;
    image.alt = "";
    image.loading = "lazy";
    card.append(image);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = featured ? "news-featured-placeholder" : "news-article-placeholder";
    placeholder.textContent = "Kifayah";
    card.append(placeholder);
  }
  const copy = document.createElement("span");
  copy.className = featured ? "news-featured-copy" : "news-article-copy";
  const date = document.createElement("time");
  date.dateTime = article.uploaded_at;
  date.textContent = formatNewsDate(article.uploaded_at);
  const title = document.createElement("span");
  title.className = featured ? "news-featured-title" : "news-article-title";
  title.textContent = article.title;
  const headline = document.createElement("span");
  headline.className = featured ? "news-featured-headline" : "news-article-headline";
  headline.textContent = article.headline;
  const author = document.createElement("span");
  author.className = featured ? "news-byline" : "news-article-author";
  author.textContent = article.author;
  copy.append(date, title, headline, author);
  card.append(copy);
  card.addEventListener("click", () => openNewsArticle(article));
  return card;
}

function renderNewsArchive() {
  const list = document.querySelector("#news-list");
  const archive = newsArticles.slice(1);
  const pageCount = Math.ceil(archive.length / NEWS_ARCHIVE_PAGE_SIZE);
  newsArchivePage = Math.min(newsArchivePage, Math.max(0, pageCount - 1));
  const start = newsArchivePage * NEWS_ARCHIVE_PAGE_SIZE;
  list.replaceChildren(...archive.slice(start, start + NEWS_ARCHIVE_PAGE_SIZE).map((article) => createNewsCard(article)));
  const archiveSection = document.querySelector("#news-archive");
  archiveSection.hidden = archive.length === 0;
  document.querySelector("#news-page-status").textContent = pageCount ? `${newsArchivePage + 1} / ${pageCount}` : "";
  document.querySelector("#news-previous").disabled = newsArchivePage === 0;
  document.querySelector("#news-next").disabled = newsArchivePage >= pageCount - 1;
}

function renderNews(articles) {
  newsArticles = articles;
  const section = document.querySelector("#news-section");
  const featured = document.querySelector("#news-featured");
  featured.replaceChildren();
  section.hidden = articles.length === 0;
  if (articles.length) featured.append(createNewsCard(articles[0], true));
  renderNewsArchive();
}

async function loadNews() {
  try {
    const payload = await request("/api/news");
    renderNews(payload.articles);
  } catch {
    document.querySelector("#news-section").hidden = true;
  }
}

document.querySelector("#news-previous")?.addEventListener("click", () => {
  newsArchivePage = Math.max(0, newsArchivePage - 1);
  renderNewsArchive();
});
document.querySelector("#news-next")?.addEventListener("click", () => {
  const pageCount = Math.ceil(Math.max(0, newsArticles.length - 1) / NEWS_ARCHIVE_PAGE_SIZE);
  newsArchivePage = Math.min(pageCount - 1, newsArchivePage + 1);
  renderNewsArchive();
});
document.querySelector("#news-detail-close")?.addEventListener("click", () => {
  document.querySelector("#news-detail-dialog").close();
});
document.querySelector("#record-detail-close")?.addEventListener("click", () => {
  document.querySelector("#record-detail-dialog").close();
});
for (const selector of ["#news-detail-dialog", "#record-detail-dialog"]) {
  const detailDialog = document.querySelector(selector);
  detailDialog.addEventListener("click", (event) => {
    if (event.target !== detailDialog) return;
    const bounds = detailDialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom
    ) {
      detailDialog.close();
    }
  });
}

const processingDialog = document.querySelector("#processing-dialog");
let processingCount = 0;
let processingTimer;

processingDialog.addEventListener("cancel", (event) => event.preventDefault());

function beginProcessing() {
  window.clearTimeout(processingTimer);
  processingCount += 1;
  if (!processingDialog.open) processingDialog.showModal();
  document.body.setAttribute("aria-busy", "true");
}

function endProcessing() {
  processingCount = Math.max(0, processingCount - 1);
  if (processingCount) return;
  processingTimer = window.setTimeout(() => {
    processingTimer = null;
    if (!processingCount && processingDialog.open) {
      processingDialog.close();
      document.body.removeAttribute("aria-busy");
    }
  }, 120);
}

async function withProcessing(operation) {
  beginProcessing();
  try {
    return await operation();
  } finally {
    endProcessing();
  }
}

async function request(url, options = {}) {
  const sendRequest = async () => {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Permintaan tidak dapat diproses.");
    return payload;
  };
  if (["/api/admin/media", "/api/admin/import/preview", "/api/admin/import/commit"].includes(url)) {
    return withProcessing(sendRequest);
  }
  return sendRequest();
}

function fillLocationSelect(select, prefix, count) {
  const selected = Number(select.value);
  select.replaceChildren();
  for (let value = 1; value <= count; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${prefix} ${String(value).padStart(3, "0")}`;
    select.append(option);
  }
  if (selected > 0 && selected <= count) select.value = String(selected);
}

async function loadSettings() {
  const payload = await request("/api/settings");
  settings.rt_count = payload.rt_count;
  settings.rw_count = payload.rw_count;
  settings.icon_zoom_1 = payload.icon_zoom_1;
  settings.icon_zoom_2 = payload.icon_zoom_2;
  for (const slot of [1, 2]) {
    const zoom = settings[`icon_zoom_${slot}`];
    applyIconZoom(slot, zoom);
    const slider = document.querySelector(`#icon-zoom-${slot}`);
    if (document.activeElement !== slider) slider.value = zoom;
    document.querySelector(`#icon-zoom-${slot}-value`).value = `${zoom}%`;
  }
  fillLocationSelect(document.querySelector("#rt-select"), "RT", settings.rt_count);
  fillLocationSelect(document.querySelector("#rw-select"), "RW", settings.rw_count);
  fillLocationSelect(document.querySelector("#edit-rt-select"), "RT", settings.rt_count);
  fillLocationSelect(document.querySelector("#edit-rw-select"), "RW", settings.rw_count);
  if (document.activeElement !== settingsForm.elements.rt_count) settingsForm.elements.rt_count.value = settings.rt_count;
  if (document.activeElement !== settingsForm.elements.rw_count) settingsForm.elements.rw_count.value = settings.rw_count;
  const favicon = document.querySelector("#dynamic-favicon");
  const iconUrl = payload.site_icon_ready ? "/media/site-icon" : "/favicon.ico";
  if (new URL(favicon.href).pathname !== iconUrl) favicon.href = iconUrl;
  const brandIcon = document.querySelector("#brand-icon");
  const secondaryIcon = document.querySelector("#brand-icon-secondary");
  const logoGroup = document.querySelector("#brand-logo-group");
  const divider = document.querySelector("#brand-logo-divider");
  const brandMarkText = document.querySelector("#brand-mark-text");
  document.querySelector(".brand-mark").classList.toggle("has-icon", payload.site_icon_ready);
  logoGroup.hidden = !payload.site_icon_ready;
  brandMarkText.hidden = payload.site_icon_ready;
  if (payload.site_icon_ready && brandIcon.getAttribute("src") !== iconUrl) brandIcon.src = iconUrl;
  secondaryIcon.hidden = !payload.site_icon_2_ready;
  divider.hidden = !payload.site_icon_2_ready;
  if (payload.site_icon_2_ready && secondaryIcon.getAttribute("src") !== "/media/site-icon/2") {
    secondaryIcon.src = "/media/site-icon/2";
  }
  const heroVisual = document.querySelector("#hero-visual");
  heroVisual.hidden = !payload.hero_image_ready;
  const heroImage = document.querySelector("#hero-image");
  if (payload.hero_image_ready && heroImage.getAttribute("src") !== "/media/hero") heroImage.src = "/media/hero";
}

async function refreshRecords() {
  try {
    await loadSettings();
    const payload = await request(isAdmin ? "/api/admin/records" : "/api/records");
    records.splice(0, records.length, ...payload.records);
    render();
    await loadNews();
    document.querySelector("#last-updated").textContent = `Diperbarui ${new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    if (isAdmin) renderManageList();
  } catch {
    document.querySelector("#last-updated").textContent = "Koneksi belum tersedia";
  }
}

function renderManageList() {
  const list = document.querySelector("#manage-list");
  list.replaceChildren();
  document.querySelector("#managed-count").textContent = `${records.length} entri`;
  records.forEach((record) => {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = record.full_name || `Nama belum dilengkapi (ID ${record.id})`;
    const detail = document.createElement("small");
    detail.textContent = record.publish_address ? "Alamat tampil untuk publik" : "Alamat hanya untuk pengelola";
    text.append(detail);
    const actions = document.createElement("div");
    actions.className = "manage-item-actions";
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEditRecord(record));
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Hapus data ${record.full_name}?`)) return;
      try {
        await request(`/api/records/${record.id}`, { method: "DELETE" });
        await refreshRecords();
      } catch (error) {
        window.alert(error.message);
      }
    });
    if (currentUser?.role === "Staff") actions.hidden = true;
    actions.append(edit, remove);
    item.append(text, actions);
    list.append(item);
  });
  if (!records.length) {
    const item = document.createElement("li");
    item.textContent = "Belum ada entri tersimpan.";
    list.append(item);
  }
  const printBody = document.querySelector("#print-records-body");
  if (printBody) {
    printBody.replaceChildren();
    records.forEach((record, index) => {
      const row = document.createElement("tr");
      const values = [
        String(index + 1), record.full_name, record.gender || "", formatAreaLabel(record.area),
        record.date_of_death ? formatDate(record.date_of_death) : "", record.address || "",
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      printBody.append(row);
    });
  }
  const select = document.querySelector("#detail-record-select");
  const selectedId = select.value;
  select.replaceChildren(new Option("Pilih entri", ""));
  records.forEach((record) => select.add(new Option(record.full_name, String(record.id))));
  if (records.some((record) => String(record.id) === selectedId)) select.value = selectedId;
  showSelectedPrivateData();
}

function openEditRecord(record) {
  const form = document.querySelector("#edit-record-form");
  const area = String(record.area || "");
  const rt = area.match(/RT\s*0*(\d+)/i);
  const rw = area.match(/RW\s*0*(\d+)/i);
  form.dataset.recordId = String(record.id);
  form.elements.full_name.value = record.full_name || "";
  form.elements.gender.value = record.gender || "";
  form.elements.rt.value = rt?.[1] || "";
  form.elements.rw.value = rw?.[1] || "";
  form.elements.date_of_death.value = record.date_of_death || "";
  form.elements.address.value = record.address || "";
  form.elements.publish_address.checked = Boolean(record.publish_address);
  for (const field of ["family_card_number", "national_id_number", "birthplace", "birth_date", "religion"]) {
    form.elements[field].value = record[field] || "";
  }
  document.querySelector("#edit-record-error").textContent = "";
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.elements.full_name.focus({ preventScroll: true });
}

function showSelectedPrivateData() {
  const selectedId = Number(document.querySelector("#detail-record-select").value);
  const record = records.find((item) => item.id === selectedId);
  const canSeePrivate = currentUser?.role !== "Staff";
  const identityForm = document.querySelector("#identity-form");
  const familyForm = document.querySelector("#family-form");
  const portraitForm = document.querySelector("#portrait-form");
  identityForm.hidden = !record || !canSeePrivate;
  familyForm.hidden = !record || !canSeePrivate;
  portraitForm.hidden = !record || !canSeePrivate;
  if (!record || !canSeePrivate) return;
  if (identityForm.dataset.recordId !== String(record.id)) {
    for (const field of ["gender", "address", "family_card_number", "national_id_number", "birthplace", "birth_date", "religion"]) {
      identityForm.elements[field].value = record[field] || "";
    }
    identityForm.elements.publish_address.checked = Boolean(record.publish_address);
    document.querySelector("#family-address-hint").textContent = record.publish_address
      ? "Alamat akan ditampilkan secara publik."
      : "Alamat hanya dapat dilihat oleh pengelola.";
    identityForm.dataset.recordId = String(record.id);
  }
  const familyList = document.querySelector("#family-list");
  familyList.replaceChildren();
  for (const relative of record.family || []) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${relative.full_name || "Nama belum diisi"} · ${relative.relationship || "Hubungan belum diisi"}`;
    const actions = document.createElement("div");
    actions.className = "manage-item-actions";
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.type = "button";
    edit.textContent = "Edit";
    const editForm = document.createElement("form");
    editForm.className = "family-inline-edit";
    editForm.hidden = true;
    const nameInput = document.createElement("input");
    nameInput.name = "full_name";
    nameInput.maxLength = 120;
    nameInput.value = relative.full_name;
    nameInput.setAttribute("aria-label", "Nama anggota keluarga");
    const relationshipInput = document.createElement("input");
    relationshipInput.name = "relationship";
    relationshipInput.maxLength = 60;
    relationshipInput.value = relative.relationship;
    relationshipInput.setAttribute("aria-label", "Hubungan keluarga");
    const save = document.createElement("button");
    save.className = "edit-button";
    save.type = "submit";
    save.textContent = "Simpan";
    const cancel = document.createElement("button");
    cancel.className = "text-button";
    cancel.type = "button";
    cancel.textContent = "Batal";
    edit.addEventListener("click", () => {
      label.hidden = true;
      actions.hidden = true;
      editForm.hidden = false;
      nameInput.focus();
    });
    cancel.addEventListener("click", () => {
      editForm.hidden = true;
      label.hidden = false;
      actions.hidden = false;
    });
    editForm.append(nameInput, relationshipInput, save, cancel);
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await request("/api/admin/family/update", {
          method: "POST",
          body: JSON.stringify({
            family_id: relative.id,
            full_name: nameInput.value,
            relationship: relationshipInput.value,
          }),
        });
        await refreshRecords();
      } catch (error) {
        window.alert(error.message);
      }
    });
    actions.append(edit);
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.addEventListener("click", async () => {
      try {
        await request(`/api/admin/family/${relative.id}`, { method: "DELETE" });
        await refreshRecords();
      } catch (error) {
        window.alert(error.message);
      }
    });
    actions.append(remove);
    item.append(label, actions, editForm);
    familyList.append(item);
  }
}

async function imageBase64(file) {
  return withProcessing(async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  });
}

async function uploadImage(file, kind, extra = {}) {
  return request("/api/admin/media", {
    method: "POST",
    body: JSON.stringify({ kind, content_type: file.type, content_base64: await imageBase64(file), ...extra }),
  });
}

async function uploadNewsImage(articleId, file) {
  return withProcessing(async () => {
    const response = await fetch(`/api/admin/news/${articleId}/image`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Foto berita tidak dapat diunggah.");
    return payload;
  });
}

// PANEL PENGELOLA: navigasi dan kontrol sesuai jabatan.
function setAdminMode(enabled, user = null, forcePasswordChange = false) {
  isAdmin = enabled;
  currentUser = enabled ? (user || currentUser) : null;
  const mustChangePassword = Boolean(enabled && (forcePasswordChange || currentUser?.force_password_change));
  document.body.classList.toggle("admin-authenticated", enabled && !mustChangePassword);
  loginForm.hidden = enabled;
  document.querySelector("#change-password-form").hidden = !mustChangePassword;
  managerPanel.hidden = !enabled || mustChangePassword;
  document.querySelector("#dialog-title").textContent = mustChangePassword
    ? "Ganti Kata Sandi Awal"
    : enabled ? `Kelola Daftar Warga | ${currentUser?.role || ""}` : "Masuk Pengelola";
  if (!enabled || mustChangePassword) return;
  const role = currentUser?.role || "Staff";
  const isSuperAdmin = role === "Super Admin";
  const canManageRecords = role !== "Staff";
  document.querySelector('#record-form input[name="publish_address"]').closest("label").hidden = role === "Staff";
  document.querySelector("#staff-address-hint").hidden = role !== "Staff";
  document.querySelector('[data-admin-tab="import"]').hidden = !canManageRecords;
  document.querySelector('[data-admin-tab="news"]').hidden = !canManageRecords;
  document.querySelector('[data-admin-tab="news"]').hidden = !canManageRecords;
  document.querySelector('[data-admin-tab="area"]').hidden = !isSuperAdmin;
  document.querySelector('[data-admin-tab="family"]').hidden = !canManageRecords;
  document.querySelector('[data-admin-tab="media"]').hidden = !isSuperAdmin;
  document.querySelector('[data-admin-tab="users"]').hidden = !isSuperAdmin;
  document.querySelector("#edit-record-form").hidden = true;
  document.querySelector(".export-warning").hidden = !isSuperAdmin;
  document.querySelector(".export-button").hidden = !isSuperAdmin;
  if (isSuperAdmin) loadAdminUsers();
  const activeTab = document.querySelector(".admin-tab.active");
  if (activeTab?.hidden) setAdminTab("records");
}

// AKUN: daftar dan aksi khusus Super Admin.
async function loadAdminUsers() {
  const error = document.querySelector("#users-error");
  error.textContent = "";
  try {
    const payload = await request("/api/admin/users");
    renderAdminUsers(payload.users);
  } catch (requestError) {
    error.textContent = requestError.message;
  }
}

function renderAdminUsers(users) {
  const list = document.querySelector("#admin-user-list");
  list.replaceChildren();
  users.forEach((user, index) => {
    const row = document.createElement("tr");
    const number = document.createElement("td");
    number.textContent = String(index + 1).padStart(2, "0");
    const userCell = document.createElement("td");
    const userMain = document.createElement("div");
    userMain.className = "user-main";
    const avatar = document.createElement("span");
    avatar.className = "user-avatar";
    if (user.avatar_url) {
      const image = document.createElement("img");
      image.src = user.avatar_url;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => { image.hidden = true; });
      avatar.append(image);
    } else {
      avatar.textContent = user.display_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
    }
    const userCopy = document.createElement("span");
    userCopy.className = "user-main-copy";
    const name = document.createElement("strong");
    name.textContent = user.display_name;
    const username = document.createElement("small");
    username.textContent = `${user.username}${user.force_password_change ? " · Wajib Ganti Sandi" : ""}`;
    userCopy.append(name, username);
    userMain.append(avatar, userCopy);
    userCell.append(userMain);

    const phone = document.createElement("td");
    phone.textContent = user.phone || "—";
    const email = document.createElement("td");
    email.textContent = user.email || "—";
    const levelCell = document.createElement("td");
    const role = document.createElement("select");
    role.className = "user-level-select";
    role.setAttribute("aria-label", `Level ${user.username}`);
    for (const value of ["Staff", "Admin", "Super Admin"]) role.add(new Option(value, value));
    role.value = user.role;
    levelCell.append(role);

    const statusCell = document.createElement("td");
    const activeLabel = document.createElement("label");
    activeLabel.className = "user-status";
    const active = document.createElement("input");
    active.type = "checkbox";
    active.checked = Boolean(user.active);
    activeLabel.append(active, document.createTextNode(user.active ? "Aktif" : "Nonaktif"));
    statusCell.append(activeLabel);

    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "user-actions";
    const editProfile = document.createElement("button");
    editProfile.className = "edit-button";
    editProfile.type = "button";
    editProfile.textContent = "Edit";
    editProfile.setAttribute("aria-label", `Edit data ${user.username}`);
    editProfile.addEventListener("click", () => openUserDialog(user));
    const save = document.createElement("button");
    save.className = "edit-button";
    save.type = "button";
    save.textContent = "Simpan";
    save.addEventListener("click", async () => {
      try {
        await request("/api/admin/users/update", {
          method: "POST",
          body: JSON.stringify({ user_id: user.id, display_name: user.display_name, role: role.value, active: active.checked }),
        });
        await loadAdminUsers();
      } catch (error) {
        document.querySelector("#users-error").textContent = error.message;
      }
    });
    const newPassword = document.createElement("input");
    newPassword.type = "password";
    newPassword.minLength = 8;
    newPassword.className = "reset-password-input";
    newPassword.placeholder = "Sandi Baru";
    newPassword.autocomplete = "new-password";
    newPassword.setAttribute("aria-label", `Sandi baru ${user.username}`);
    const reset = document.createElement("button");
    reset.className = "text-button";
    reset.type = "button";
    reset.textContent = "Reset";
    reset.disabled = user.id === currentUser?.id;
    reset.addEventListener("click", async () => {
      try {
        await request("/api/admin/users/reset-password", {
          method: "POST",
          body: JSON.stringify({ user_id: user.id, new_password: newPassword.value }),
        });
        await loadAdminUsers();
      } catch (error) {
        document.querySelector("#users-error").textContent = error.message;
      }
    });
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.disabled = user.id === currentUser?.id;
    remove.title = remove.disabled ? "Akun Yang Sedang Digunakan Tidak Dapat Dihapus" : "Hapus Akun Ini Secara Permanen";
    remove.setAttribute("aria-label", `Hapus akun ${user.username}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Hapus akun ${user.display_name} (${user.username}) secara permanen?`)) return;
      try {
        await request(`/api/admin/users/${user.id}`, { method: "DELETE" });
        await loadAdminUsers();
      } catch (error) {
        document.querySelector("#users-error").textContent = error.message;
      }
    });
    actions.append(editProfile, save, newPassword, reset, remove);
    actionsCell.append(actions);
    row.append(number, userCell, phone, email, levelCell, statusCell, actionsCell);
    list.append(row);
  });
}

function localDateTimeInputValue(value = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const newsForm = document.querySelector("#news-form");
const newsFormTitle = document.querySelector("#news-admin-title");
const newsSubmitButton = document.querySelector("#news-submit");
const newsCancelButton = document.querySelector("#news-cancel-edit");
const newsError = document.querySelector("#news-error");
const newsResult = document.querySelector("#news-result");
const newsImageInput = newsForm.querySelector('input[name="image"]');
const newsImagePreview = document.querySelector("#news-image-preview");
let newsImagePreviewUrl = "";
let editingNewsId = null;
newsForm.elements.uploaded_at.value = localDateTimeInputValue();

function showNewsImagePreview(imageUrl = "", message = "Foto Opsional · PNG, JPG, WebP") {
  const nextObjectUrl = imageUrl.startsWith("blob:") ? imageUrl : "";
  if (newsImagePreviewUrl && newsImagePreviewUrl !== nextObjectUrl) URL.revokeObjectURL(newsImagePreviewUrl);
  newsImagePreviewUrl = nextObjectUrl;
  newsImagePreview.replaceChildren();
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "Pratinjau Foto Berita";
    newsImagePreview.append(image, document.createTextNode(message));
  } else {
    newsImagePreview.textContent = message;
  }
}

newsImageInput.addEventListener("change", () => {
  const file = newsImageInput.files[0];
  if (!file) {
    showNewsImagePreview();
    return;
  }
  showNewsImagePreview(URL.createObjectURL(file), file.name);
});

async function loadAdminNews() {
  try {
    const payload = await request("/api/admin/news");
    renderAdminNews(payload.articles);
  } catch (error) {
    newsError.textContent = error.message;
  }
}

function renderAdminNews(articles) {
  const list = document.querySelector("#admin-news-list");
  list.replaceChildren();
  articles.forEach((article) => {
    const item = document.createElement("li");
    item.className = "admin-news-item";
    if (article.image_url) {
      const image = document.createElement("img");
      image.className = "admin-news-image";
      image.src = article.image_url;
      image.alt = `Foto Berita: ${article.title}`;
      image.loading = "lazy";
      item.append(image);
    }
    const title = document.createElement("h4");
    title.textContent = article.title;
    const headline = document.createElement("p");
    headline.textContent = article.headline;
    const body = document.createElement("p");
    body.textContent = article.body.length > 260 ? `${article.body.slice(0, 260)}…` : article.body;
    const metadata = document.createElement("small");
    metadata.className = "admin-news-meta";
    metadata.textContent = `${article.author} · ${formatNewsDate(article.uploaded_at)}`;
    const actions = document.createElement("div");
    actions.className = "admin-news-actions";
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editingNewsId = article.id;
      newsForm.elements.article_id.value = String(article.id);
      newsForm.elements.title.value = article.title;
      newsForm.elements.headline.value = article.headline;
      newsForm.elements.body.value = article.body;
      newsForm.elements.author.value = article.author;
      newsForm.elements.uploaded_at.value = localDateTimeInputValue(new Date(article.uploaded_at));
      showNewsImagePreview(article.image_url, article.image_url ? "Foto Saat Ini · Pilih Untuk Mengganti" : "Foto Opsional · PNG, JPG, WebP");
      newsFormTitle.textContent = "Edit Berita";
      newsSubmitButton.textContent = "Simpan Perubahan";
      newsCancelButton.hidden = false;
      newsForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Hapus berita “${article.title}”?`)) return;
      try {
        await request(`/api/admin/news/${article.id}`, { method: "DELETE" });
        await loadAdminNews();
        await loadNews();
      } catch (error) {
        newsError.textContent = error.message;
      }
    });
    actions.append(edit, remove);
    item.append(title, headline, body, metadata, actions);
    list.append(item);
  });
  if (!articles.length) {
    const empty = document.createElement("li");
    empty.textContent = "Belum ada berita tersimpan.";
    list.append(empty);
  }
}

function resetNewsForm() {
  newsForm.reset();
  showNewsImagePreview();
  newsForm.elements.article_id.value = "";
  newsForm.elements.uploaded_at.value = localDateTimeInputValue();
  editingNewsId = null;
  newsFormTitle.textContent = "Tambah Berita";
  newsSubmitButton.textContent = "Simpan Berita";
  newsCancelButton.hidden = true;
  newsError.textContent = "";
}

newsCancelButton.addEventListener("click", resetNewsForm);
newsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  newsError.textContent = "";
  newsResult.hidden = true;
  const payload = Object.fromEntries(new FormData(newsForm));
  const photo = payload.image;
  delete payload.image;
  delete payload.article_id;
  const editing = editingNewsId !== null;
  if (editing) payload.article_id = editingNewsId;
  try {
    const saved = await request(editing ? "/api/admin/news/update" : "/api/admin/news", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const articleId = editing ? editingNewsId : saved.id;
    let photoError = "";
    if (photo instanceof File && photo.size) {
      try {
        await uploadNewsImage(articleId, photo);
      } catch (uploadError) {
        photoError = `Berita tersimpan, tetapi foto gagal diunggah: ${uploadError.message}`;
      }
    }
    resetNewsForm();
    newsResult.textContent = photoError || (editing ? "Perubahan berita tersimpan." : "Berita berhasil ditambahkan.");
    newsResult.hidden = false;
    await loadAdminNews();
    await loadNews();
  } catch (error) {
    newsError.textContent = error.message;
  }
});

function setAdminTab(name, focus = false) {
  const tabs = [...document.querySelectorAll(".admin-tab")];
  for (const tab of tabs) {
    const active = tab.dataset.adminTab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.querySelector(`[data-admin-panel="${tab.dataset.adminTab}"]`).hidden = !active;
    if (active && focus) tab.focus();
    if (active && tab.dataset.adminTab === "news") loadAdminNews();
  }
}

document.querySelectorAll(".admin-tab").forEach((tab, index, tabs) => {
  tab.addEventListener("click", () => setAdminTab(tab.dataset.adminTab));
  tab.addEventListener("keydown", (event) => {
    let nextIndex = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    setAdminTab(tabs[nextIndex].dataset.adminTab, true);
  });
});

document.querySelector(".close-button").addEventListener("click", async () => {
  if (!isAdminPage) {
    dialog.close();
    return;
  }
  if (isAdmin) await request("/api/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/";
});
dialog.addEventListener("click", (event) => {
  if (!isAdminPage && event.target === dialog) dialog.close();
});
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#login-error");
  errorElement.textContent = "";
  try {
    const formData = new FormData(loginForm);
    const payload = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }),
    });
    loginForm.reset();
    setAdminMode(true, payload.user, payload.force_password_change);
    if (!payload.force_password_change) await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#change-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#change-password-error");
  errorElement.textContent = "";
  const values = new FormData(form);
  if (values.get("new_password") !== values.get("confirm_password")) {
    errorElement.textContent = "Kata sandi baru tidak sama.";
    return;
  }
  try {
    await request("/api/admin/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: values.get("current_password"), new_password: values.get("new_password") }),
    });
    form.reset();
    currentUser.force_password_change = 0;
    setAdminMode(true, currentUser, false);
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
// FORMULIR AKUN: pendaftaran user dengan foto profil opsional.
const userCreateDialog = document.querySelector("#user-create-dialog");
const createUserForm = document.querySelector("#create-user-form");
const photoInput = createUserForm.elements.photo;
let userPhotoPreviewUrl = "";
let editingUser = null;

function resetUserPhotoPreview() {
  if (userPhotoPreviewUrl) URL.revokeObjectURL(userPhotoPreviewUrl);
  userPhotoPreviewUrl = "";
  const preview = document.querySelector("#user-photo-preview");
  preview.replaceChildren(document.createTextNode("Foto opsional · PNG, JPG, WebP · maks. 5 MB"));
}

function openUserDialog(user = null) {
  editingUser = user;
  createUserForm.reset();
  resetUserPhotoPreview();
  document.querySelector("#create-user-error").textContent = "";
  const fullName = user?.display_name.trim().split(/\s+/) || [];
  createUserForm.elements.first_name.value = user?.first_name || fullName[0] || "";
  createUserForm.elements.last_name.value = user?.last_name || fullName.slice(1).join(" ");
  createUserForm.elements.phone.value = user?.phone || "";
  createUserForm.elements.email.value = user?.email || "";
  createUserForm.elements.username.value = user?.username || "";
  createUserForm.elements.username.readOnly = Boolean(user);
  createUserForm.elements.role.value = user?.role || "Staff";
  createUserForm.elements.password.required = !user;
  document.querySelector(".user-password-field").hidden = Boolean(user);
  document.querySelector("#user-create-title").textContent = user ? "Edit pengguna" : "Tambah pengguna";
  document.querySelector("#user-create-submit").textContent = user ? "Simpan perubahan" : "Simpan pengguna";
  if (user?.avatar_url) {
    const preview = document.querySelector("#user-photo-preview");
    preview.replaceChildren();
    const image = document.createElement("img");
    image.src = user.avatar_url;
    image.alt = "Foto pengguna saat ini";
    const label = document.createElement("span");
    label.textContent = "Foto saat ini · pilih file untuk mengganti";
    preview.append(image, label);
  }
  userCreateDialog.showModal();
}

document.querySelector("#add-user-button").addEventListener("click", () => openUserDialog());
for (const button of [document.querySelector("#user-create-close"), document.querySelector("#user-create-cancel")]) {
  button.addEventListener("click", () => userCreateDialog.close());
}
userCreateDialog.addEventListener("click", (event) => {
  if (event.target === userCreateDialog) userCreateDialog.close();
});
photoInput.addEventListener("change", () => {
  resetUserPhotoPreview();
  const file = photoInput.files[0];
  if (!file) return;
  userPhotoPreviewUrl = URL.createObjectURL(file);
  const preview = document.querySelector("#user-photo-preview");
  preview.replaceChildren();
  const image = document.createElement("img");
  image.src = userPhotoPreviewUrl;
  image.alt = "Pratinjau foto pengguna";
  const filename = document.createElement("span");
  filename.textContent = file.name;
  preview.append(image, filename);
});

createUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#create-user-error");
  errorElement.textContent = "";
  const values = Object.fromEntries(new FormData(createUserForm));
  const photo = values.photo;
  delete values.photo;
  if (photo instanceof File && photo.size > 5 * 1024 * 1024) {
    errorElement.textContent = "Ukuran foto maksimal 5 MB.";
    return;
  }
  try {
    const editing = Boolean(editingUser);
    if (editing) {
      values.user_id = editingUser.id;
      values.display_name = `${values.first_name} ${values.last_name}`.trim();
      values.active = Boolean(editingUser.active);
    }
    const saved = await request(editing ? "/api/admin/users/update" : "/api/admin/users", {
      method: "POST",
      body: JSON.stringify(values),
    });
    let photoError = "";
    if (photo instanceof File && photo.size) {
      try {
        await uploadImage(photo, "user_avatar", { user_id: editing ? editingUser.id : saved.id });
      } catch (uploadError) {
        photoError = `Akun tersimpan, tetapi foto gagal diunggah: ${uploadError.message}`;
      }
    }
    createUserForm.reset();
    resetUserPhotoPreview();
    editingUser = null;
    userCreateDialog.close();
    document.querySelector("#users-error").textContent = photoError;
    await loadAdminUsers();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#record-error");
  errorElement.textContent = "";
  const formData = new FormData(recordForm);
  try {
    await request("/api/records", {
      method: "POST",
      body: JSON.stringify({
        full_name: formData.get("full_name"),
        gender: formData.get("gender"),
        address: formData.get("address"),
        rt: Number(formData.get("rt")),
        rw: Number(formData.get("rw")),
        date_of_death: formData.get("date_of_death"),
        publish_address: formData.has("publish_address"),
      }),
    });
    recordForm.reset();
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
const editRecordForm = document.querySelector("#edit-record-form");
document.querySelector("#cancel-edit-record").addEventListener("click", () => {
  editRecordForm.reset();
  editRecordForm.hidden = true;
});
editRecordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#edit-record-error");
  errorElement.textContent = "";
  const formData = new FormData(editRecordForm);
  try {
    await request("/api/admin/record-update", {
      method: "POST",
      body: JSON.stringify({
        record_id: Number(editRecordForm.dataset.recordId),
        full_name: formData.get("full_name"),
        gender: formData.get("gender"),
        rt: Number(formData.get("rt")),
        rw: Number(formData.get("rw")),
        date_of_death: formData.get("date_of_death"),
        address: formData.get("address"),
        publish_address: formData.has("publish_address"),
        family_card_number: formData.get("family_card_number"),
        national_id_number: formData.get("national_id_number"),
        birthplace: formData.get("birthplace"),
        birth_date: formData.get("birth_date"),
        religion: formData.get("religion"),
      }),
    });
    editRecordForm.hidden = true;
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#import-error");
  const resultElement = document.querySelector("#import-result");
  const previewPanel = document.querySelector("#import-preview-panel");
  errorElement.textContent = "";
  resultElement.hidden = true;
  previewPanel.hidden = true;
  const file = form.elements.file.files[0];
  if (!file) {
    errorElement.textContent = "Pilih file terlebih dahulu.";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    errorElement.textContent = "Ukuran file maksimal 10 MB.";
    return;
  }
  try {
    const payload = await request("/api/admin/import/preview", {
      method: "POST",
      body: JSON.stringify({ filename: file.name, content_base64: await imageBase64(file) }),
    });
    importRows = payload.rows;
    const warningList = document.querySelector("#import-warnings");
    warningList.replaceChildren();
    payload.warnings.forEach((warning) => {
      const item = document.createElement("li");
      item.textContent = warning;
      warningList.append(item);
    });
    previewPanel.hidden = false;
    renderImportRows();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#import-select-all").addEventListener("change", (event) => {
  const checkboxes = document.querySelectorAll("#import-preview-list .import-row-select input");
  checkboxes.forEach((checkbox, index) => {
    if (importRows[index].duplicate) return;
    importRows[index].selected = event.currentTarget.checked;
    checkbox.checked = event.currentTarget.checked;
  });
  updateImportSummary();
});
document.querySelector("#import-cancel").addEventListener("click", () => {
  importRows = [];
  document.querySelector("#import-preview-panel").hidden = true;
  document.querySelector("#import-form").reset();
});
document.querySelector("#import-commit").addEventListener("click", async () => {
  const errorElement = document.querySelector("#import-commit-error");
  const resultElement = document.querySelector("#import-result");
  errorElement.textContent = "";
  const selectedImportRows = importRows.filter((row) => row.selected);
  const invalidCount = selectedImportRows.filter((row) => !importRowIsValid(row)).length;
  const selectedRows = selectedImportRows.filter(importRowIsValid).map((row) => {
    const cleanRow = {};
    for (const [field] of importFields) cleanRow[field] = row[field] ?? "";
    cleanRow.rt = Number(cleanRow.rt);
    cleanRow.rw = Number(cleanRow.rw);
    return cleanRow;
  });
  if (!selectedRows.length) {
    errorElement.textContent = "Pilih minimal satu baris dengan data valid untuk diimpor.";
    return;
  }
  try {
    const result = await request("/api/admin/import/commit", {
      method: "POST",
      body: JSON.stringify({ rows: selectedRows }),
    });
    resultElement.textContent = `Impor selesai: ${result.created} data ditambahkan; ${result.skipped_duplicates} duplikat dilewati${invalidCount ? `; ${invalidCount} baris tidak valid dilewati` : ""}.`;
    resultElement.hidden = false;
    importRows = [];
    document.querySelector("#import-preview-list").replaceChildren();
    document.querySelector("#import-warnings").replaceChildren();
    updateImportSummary();
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#detail-record-select").addEventListener("change", () => {
  document.querySelector("#identity-form").dataset.recordId = "";
  showSelectedPrivateData();
});
document.querySelector('#identity-form input[name="publish_address"]').addEventListener("change", (event) => {
  document.querySelector("#family-address-hint").textContent = event.currentTarget.checked
    ? "Alamat akan ditampilkan secara publik."
    : "Alamat hanya dapat dilihat oleh pengelola.";
});
document.querySelector("#identity-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#identity-error");
  errorElement.textContent = "";
  const fields = Object.fromEntries(new FormData(form));
  fields.address = form.elements.address.value;
  fields.publish_address = form.elements.publish_address.checked;
  try {
    await request("/api/admin/record-details", {
      method: "POST",
      body: JSON.stringify({ record_id: Number(document.querySelector("#detail-record-select").value), ...fields }),
    });
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#family-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#family-error");
  errorElement.textContent = "";
  try {
    const payload = Object.fromEntries(new FormData(form));
    const recordId = document.querySelector("#detail-record-select").value;
    await request(`/api/admin/records/${recordId}/family`, { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#portrait-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#portrait-error");
  errorElement.textContent = "";
  const file = new FormData(form).get("image");
  try {
    await uploadImage(file, "portrait", {
      record_id: Number(document.querySelector("#detail-record-select").value),
      publish_portrait: form.elements.publish_portrait.checked,
    });
    form.reset();
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#site-icon-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#site-icon-error");
  errorElement.textContent = "";
  const file = form.elements.image.files[0];
  if (!file) {
    errorElement.textContent = "Pilih file gambar untuk logo.";
    return;
  }
  try {
    const slot = Number(form.elements.slot.value);
    await uploadImage(file, "site_icon", { slot });
    form.reset();
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
for (const [formId, kind, errorId] of [
  ["hero-image-form", "hero_image", "hero-image-error"],
]) {
  document.querySelector(`#${formId}`).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorElement = document.querySelector(`#${errorId}`);
    errorElement.textContent = "";
    const file = new FormData(form).get("image");
    try {
      await uploadImage(file, kind);
      form.reset();
      await loadSettings();
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });
}
for (const slot of [1, 2]) {
  const slider = document.querySelector(`#icon-zoom-${slot}`);
  const field = `icon_zoom_${slot}`;
  slider.addEventListener("input", (event) => {
    const zoom = Number(event.currentTarget.value);
    applyIconZoom(slot, zoom);
    document.querySelector(`#icon-zoom-${slot}-value`).value = `${zoom}%`;
  });
  document.querySelector(`#icon-zoom-${slot}-form`).addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorElement = document.querySelector(`#icon-zoom-${slot}-error`);
    errorElement.textContent = "";
    const zoom = Number(slider.value);
    try {
      await request("/api/settings", {
        method: "POST",
        body: JSON.stringify({ rt_count: settings.rt_count, rw_count: settings.rw_count, [field]: zoom }),
      });
      settings[field] = zoom;
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });
}
settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#settings-error");
  errorElement.textContent = "";
  const formData = new FormData(settingsForm);
  try {
    await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        rt_count: Number(formData.get("rt_count")),
        rw_count: Number(formData.get("rw_count")),
      }),
    });
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#logout-button")
?.addEventListener("click", async () => {
  await request("/api/logout", { method: "POST" });
  setAdminMode(false);
  await refreshRecords();
});
document.querySelector("#print-records-button")?.addEventListener("click", () => {
  const preview = document.querySelector("#print-preview-panel");
  preview.hidden = false;
  preview.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#print-preview-back")?.addEventListener("click", () => {
  document.querySelector("#print-preview-panel").hidden = true;
});
document.querySelector("#print-preview-confirm")?.addEventListener("click", () => window.print());
document.querySelector("#total-data").addEventListener("click", () => {
  selectedGenderFilter = "";
  render();
});
for (const [selector, gender] of [["#total-l", "L"], ["#total-p", "P"]]) {
  document.querySelector(selector).addEventListener("click", () => {
    selectedGenderFilter = selectedGenderFilter === gender ? "" : gender;
    render();
  });
}
searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
});

if (isAdminPage) {
  dialog.setAttribute("open", "");
  request("/api/session").then(({ admin, user, force_password_change }) => {
    setAdminMode(admin, user, force_password_change);
    if (admin && !force_password_change) return refreshRecords();
  }).catch(() => setAdminMode(false));
} else {
  isAdmin = false;
  refreshRecords();
}
window.setInterval(refreshRecords, 15_000);

document.querySelector("#theme-toggle")?.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
});
``