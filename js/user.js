/* ==========================================================================
   USER.JS - Xử lý toàn bộ trang User: Tài liệu (Hashtag) / Upload / Tìm kiếm / Thảo luận
   Dùng cho: html/user.html
   Phụ thuộc: js/config.js, js/comment.js (nhúng TRƯỚC file này)
   ========================================================================== */

// ---------- 1. TRẠNG THÁI DÙNG CHUNG TOÀN FILE ----------
const BUCKET_NAME = "documents"; // Bucket cố định dùng chung cho mọi file
let currentUser = null;          // { id, name, email }
let hashtagList = [];            // Cache danh sách hashtag
let selectedHashtagId = null;    // Hashtag đang chọn lọc (null = tất cả)
let allSearchableFiles = [];     // Cache toàn bộ file cho tab Tìm kiếm
let searchDataLoaded = false;
let toastTimer;

// ---------- 2. LẤY PHẦN TỬ HTML HAY DÙNG ----------
const elSidebar = document.getElementById("sidebar");
const elBreadcrumbCurrent = document.getElementById("breadcrumbCurrent");
const elUserNameLabel = document.getElementById("userNameLabel");
const elUserAvatar = document.getElementById("userAvatar");

// ---------- 3. KHỞI CHẠY TRANG ----------
bootstrapUserPage();

async function bootstrapUserPage() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  const { data: profile, error } = await supabaseClient
    .from("user")
    .select("user_name, status, is_admin, color")
    .eq("id", session.user.id)
    .single();

  if (error || !profile || !profile.status) {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
    return;
  }

  if (profile.is_admin) {
    window.location.href = "admin.html";
    return;
  }

  currentUser = { id: session.user.id, name: profile.user_name || "Người dùng", email: session.user.email };
  elUserNameLabel.textContent = currentUser.name;
  elUserAvatar.textContent = currentUser.name.slice(0, 2).toUpperCase();

  initThemeToggle(profile.color);
  await loadHashtags();
  await filterByHashtag(null);
  await loadMyFileCount();
  await loadLeaderboard();
  await CommentModule.init("commentRoot", { userId: currentUser.id, isAdmin: false });
  restorePageFromHash();
}

async function loadMyFileCount() {
  const { count } = await supabaseClient
    .from("file")
    .select("id", { count: "exact", head: true })
    .eq("id_user", currentUser.id);

  document.getElementById("userFileCountLabel").textContent = `${count || 0} file đã upload`;
}

// ---------- 4. ĐIỀU HƯỚNG GIỮA CÁC TAB ----------
document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-page]");
  if (nav) switchPage(nav.dataset.page);
});

document.getElementById("menuToggle").addEventListener("click", () => {
  elSidebar.classList.toggle("open");
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

const pageTitles = {
  documents: "Tài liệu",
  leaderboard: "Bảng xếp hạng",
  upload: "Upload",
  search: "Tìm kiếm",
  discussion: "Thảo luận",
  account: "Tài khoản",
};

function switchPage(page) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });

  document.querySelectorAll(".page").forEach((section) => section.classList.remove("active"));
  document.getElementById(`${page}Page`).classList.add("active");
  elBreadcrumbCurrent.textContent = pageTitles[page];
  elSidebar.classList.remove("open");

  if (window.location.hash !== `#${page}`) {
    history.replaceState(null, "", `#${page}`);
  }

  if (page === "search" && !searchDataLoaded) {
    loadSearchData();
  }
}

function restorePageFromHash() {
  const savedPage = window.location.hash.replace("#", "");
  if (savedPage && pageTitles[savedPage]) {
    switchPage(savedPage);
  }
}

// ==========================================================================
// TAB: TÀI LIỆU (QUẢN LÝ THEO HASHTAG)
// ==========================================================================

async function loadHashtags() {
  const { data, error } = await supabaseClient
    .from("hashtag")
    .select("id, name")
    .order("name");

  if (error) {
    showToast("Không tải được Hashtags", error.message);
    return;
  }

  hashtagList = data || [];
  renderHashtagGrid();
}

function renderHashtagGrid() {
  const grid = document.getElementById("hashtagGrid");
  if (!grid) return;

  grid.innerHTML = `
    <article class="stat-card ${selectedHashtagId === null ? 'active' : ''}" data-hashtag-id="ALL">
      <span class="stat-icon">#</span>
      <div class="stat-copy">
        <strong>Tất cả</strong>
        <span>Toàn bộ tài liệu</span>
      </div>
      <b>›</b>
    </article>
  ` + hashtagList.map((h) => `
    <article class="stat-card ${selectedHashtagId === h.id ? 'active' : ''}" data-hashtag-id="${h.id}">
      <span class="stat-icon">#</span>
      <div class="stat-copy">
        <strong>${escapeHTML(h.name)}</strong>
      </div>
      <b>›</b>
    </article>
  `).join("");

  grid.querySelectorAll("[data-hashtag-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const hid = card.dataset.hashtagId;
      if (hid === "ALL") {
        filterByHashtag(null);
      } else {
        const tag = hashtagList.find(t => t.id === hid);
        filterByHashtag(hid, tag?.name);
      }
    });
  });
}

async function filterByHashtag(hashtagId, tagName = null) {
  selectedHashtagId = hashtagId;
  renderHashtagGrid();

  document.getElementById("documentsTitle").textContent = tagName ? `#${tagName}` : "Tất cả tài liệu";
  document.getElementById("documentsDesc").textContent = tagName
    ? `Các file đang được gắn hashtag #${tagName}`
    : "Hiển thị tất cả tài liệu trong hệ thống";

  const { data, error } = await supabaseClient
    .from("file")
    .select("id, file_name, storage_path, bio, created_at, id_user, status, user:id_user(user_name), file_hashtag(hashtag:id_hashtag(id, name))")
    .order("created_at", { ascending: false });

  if (error) {
    showToast("Không tải được danh sách file", error.message);
    return;
  }

  let visibleFiles = (data || []).filter((f) => f.status || f.id_user === currentUser.id);

  if (hashtagId) {
    visibleFiles = visibleFiles.filter(f =>
      f.file_hashtag && f.file_hashtag.some(fh => fh.hashtag?.id === hashtagId)
    );
  }

  renderFileList(visibleFiles);
}

function renderFileList(files) {
  const body = document.getElementById("fileListBody");
  document.getElementById("fileCount").textContent = files.length;
  document.getElementById("fileEmptyState").hidden = files.length > 0;
  document.querySelector("#fileListCard .table-scroll").hidden = files.length === 0;

  body.innerHTML = files.map((file) => renderFileRow(file)).join("");
  attachFileRowEvents(body);
}

function renderFileRow(file) {
  const isOwner = file.id_user === currentUser.id;
  const uploaderName = file.user?.user_name || "?";
  const statusBadge = file.status
    ? `<span class="status active">Hoạt động</span>`
    : `<span class="status inactive">Đã ẩn</span>`;

  const tagsHtml = (file.file_hashtag || [])
    .map(fh => fh.hashtag?.name ? `<span class="badge">#${escapeHTML(fh.hashtag.name)}</span>` : '')
    .join(' ') || '<span style="color:var(--text-faint);">-</span>';

  return /* html */ `
    <tr data-file-id="${file.id}" data-storage-path="${escapeAttr(file.storage_path)}">
      <td>${escapeHTML(file.file_name)}</td>
      <td>${tagsHtml}</td>
      <td>${escapeHTML(uploaderName)}</td>
      <td>${formatDate(file.created_at)}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="actions">
          <button class="action-btn" data-view-file title="Xem">👁</button>
          <button class="action-btn" data-download-file title="Tải về">⬇</button>
          ${isOwner ? `<button class="action-btn" data-rename-file title="Đổi tên">✎</button>` : ""}
          ${isOwner
      ? `<button class="action-btn" data-toggle-status="${file.status}" title="${file.status ? "Ẩn file" : "Hiện lại file"}">${file.status ? "🚫" : "↺"}</button>`
      : ""}
          ${isOwner ? `<button class="action-btn delete" data-delete-file title="Xóa vĩnh viễn">⌫</button>` : ""}
        </div>
      </td>
    </tr>`;
}

function attachFileRowEvents(container) {
  container.querySelectorAll("tr[data-file-id]").forEach((row) => {
    const fileId = row.dataset.fileId;
    const storagePath = row.dataset.storagePath;

    row.querySelector("[data-view-file]")?.addEventListener("click", () => {
      const newTab = window.open("", "_blank");
      openFileUrl(storagePath, false, newTab);
    });
    row.querySelector("[data-download-file]")?.addEventListener("click", () => {
      const newTab = window.open("", "_blank");
      openFileUrl(storagePath, true, newTab);
    });
    row.querySelector("[data-rename-file]")?.addEventListener("click", () => renameFile(fileId, row));
    row.querySelector("[data-delete-file]")?.addEventListener("click", () => deleteFileForever(fileId, storagePath));

    const toggleBtn = row.querySelector("[data-toggle-status]");
    if (toggleBtn) {
      const currentStatus = toggleBtn.dataset.toggleStatus === "true";
      toggleBtn.addEventListener("click", () => toggleFileStatus(fileId, currentStatus));
    }
  });
}

async function openFileUrl(storagePath, isDownload, targetWindow) {
  const bucketName = storagePath.split("/")[0];
  const pathInsideBucket = storagePath.split("/").slice(1).join("/");
  const extension = pathInsideBucket.split(".").pop().toLowerCase();

  const { data, error } = await supabaseClient.storage
    .from(bucketName)
    .createSignedUrl(pathInsideBucket, 300, isDownload ? { download: true } : undefined);

  if (error) {
    showToast("Không mở được file", error.message);
    targetWindow?.close();
    return;
  }

  if (isDownload) {
    if (targetWindow) targetWindow.location.href = data.signedUrl;
    else window.open(data.signedUrl, "_blank");
    return;
  }

  const officeExtensions = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"];
  const finalUrl = officeExtensions.includes(extension)
    ? `https://docs.google.com/gview?url=${encodeURIComponent(data.signedUrl)}&embedded=true`
    : data.signedUrl;

  if (targetWindow) targetWindow.location.href = finalUrl;
  else window.open(finalUrl, "_blank");
}

async function renameFile(fileId, row) {
  const oldName = row.children[0].textContent;
  const newName = prompt("Nhập tên mới cho file:", oldName);
  if (!newName || newName.trim() === "" || newName === oldName) return;

  const { error } = await supabaseClient
    .from("file")
    .update({ file_name: newName.trim(), updated_at: new Date().toISOString() })
    .eq("id", fileId);

  if (error) return showToast("Không đổi tên được", error.message);

  await logHistory(fileId, "Đã sửa");
  showToast("Đã đổi tên file", "");
  await filterByHashtag(selectedHashtagId);
}

async function deleteFileForever(fileId, storagePath) {
  if (!confirm("XÓA VĨNH VIỄN file này? Không thể hoàn tác.")) return;

  try {
    await supabaseClient.from("history_file").delete().eq("id_file", fileId);

    const bucketName = storagePath.split("/")[0];
    const pathInsideBucket = storagePath.split("/").slice(1).join("/");
    await supabaseClient.storage.from(bucketName).remove([pathInsideBucket]);

    const { error } = await supabaseClient.from("file").delete().eq("id", fileId);
    if (error) throw error;

    showToast("Đã xóa vĩnh viễn", "File đã bị xóa hoàn toàn khỏi hệ thống.");
    await loadHashtags();
    await filterByHashtag(selectedHashtagId);
    if (searchDataLoaded) await loadSearchData();
    await loadMyFileCount();
    await loadLeaderboard();
  } catch (error) {
    showToast("Không xóa được", error.message);
  }
}

async function toggleFileStatus(fileId, currentStatus) {
  const newStatus = !currentStatus;
  const confirmMsg = newStatus
    ? "Hiện lại file này? Mọi user khác sẽ thấy được."
    : "Ẩn file này? Chỉ mình bạn còn thấy được (Admin vẫn thấy).";
  if (!confirm(confirmMsg)) return;

  const { error } = await supabaseClient.from("file").update({ status: newStatus }).eq("id", fileId);
  if (error) return showToast("Không cập nhật được", error.message);

  await logHistory(fileId, newStatus ? "Đã sửa" : "Đã xóa");
  showToast(newStatus ? "Đã hiện lại file" : "Đã ẩn file", "");
  await filterByHashtag(selectedHashtagId);
}

async function logHistory(fileId, change) {
  await supabaseClient.from("history_file").insert({
    id_file: fileId,
    id_user: currentUser.id,
    change,
  });
}

// ==========================================================================
// TAB: UPLOAD (GẮN HASHTAGS)
// ==========================================================================

document.getElementById("uploadForm").addEventListener("submit", handleUpload);

async function handleUpload(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("uploadSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Đang tải lên...";

  try {
    const rawFile = document.getElementById("uploadFile").files[0];
    const bio = document.getElementById("uploadBio").value.trim();
    const rawHashtags = document.getElementById("uploadHashtags").value;
    let displayName = document.getElementById("uploadName").value.trim() || rawFile.name;

    if (!rawFile) throw new Error("Vui lòng chọn file để tải lên.");

    const tagNames = [...new Set(rawHashtags.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean))];
    if (tagNames.length === 0) throw new Error("Vui lòng nhập ít nhất 1 Hashtag (cách nhau bởi dấu phẩy).");

    const safeExt = rawFile.name.includes(".") ? rawFile.name.split(".").pop() : "";
    const storageFileName = `${crypto.randomUUID()}${safeExt ? "." + safeExt : ""}`;
    const storagePath = `${BUCKET_NAME}/${currentUser.id}/${storageFileName}`;
    const pathInsideBucket = `${currentUser.id}/${storageFileName}`;

    const { error: uploadError } = await supabaseClient.storage
      .from(BUCKET_NAME)
      .upload(pathInsideBucket, rawFile);
    if (uploadError) throw uploadError;

    const { data: newFile, error: insertError } = await supabaseClient
      .from("file")
      .insert({
        file_name: displayName,
        storage_path: storagePath,
        id_user: currentUser.id,
        bio,
      })
      .select()
      .single();
    if (insertError) throw insertError;

    for (const tagName of tagNames) {
      let { data: tag } = await supabaseClient.from("hashtag").select("id").eq("name", tagName).single();
      if (!tag) {
        const { data: createdTag } = await supabaseClient
          .from("hashtag")
          .insert({ name: tagName, created_by: currentUser.id })
          .select()
          .single();
        tag = createdTag;
      }
      if (tag) {
        await supabaseClient.from("file_hashtag").insert({ id_file: newFile.id, id_hashtag: tag.id });
      }
    }

    await logHistory(newFile.id, "Đã thêm");

    showToast("Tải lên thành công", `File "${displayName}" đã được gắn thẻ: #${tagNames.join(", #")}`);
    document.getElementById("uploadForm").reset();
    searchDataLoaded = false;
    await loadHashtags();
    await filterByHashtag(null);
    await loadMyFileCount();
    await loadLeaderboard();
  } catch (error) {
    showToast("Tải lên thất bại", error.message || "Vui lòng thử lại.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "⬆ Tải lên";
  }
}

// ==========================================================================
// TAB: TÌM KIẾM
// ==========================================================================

document.getElementById("searchInput").addEventListener("input", renderSearchResults);

async function loadSearchData() {
  const { data, error } = await supabaseClient
    .from("file")
    .select("id, file_name, storage_path, id_user, status, user:id_user(user_name), file_hashtag(hashtag:id_hashtag(name))")
    .order("created_at", { ascending: false });

  if (error) return showToast("Không tải được dữ liệu tìm kiếm", error.message);

  allSearchableFiles = (data || []).filter((f) => f.status || f.id_user === currentUser.id);
  searchDataLoaded = true;
  renderSearchResults();
}

function renderSearchResults() {
  const keyword = document.getElementById("searchInput").value.trim().toLowerCase().replace(/^#/, "");

  const results = allSearchableFiles.filter((file) => {
    const tagsText = (file.file_hashtag || []).map(fh => fh.hashtag?.name || "").join(" ").toLowerCase();
    const haystack = `${file.id} ${file.file_name} ${file.user?.user_name || ""} ${tagsText}`.toLowerCase();
    return haystack.includes(keyword);
  });

  document.getElementById("searchResultCount").textContent = results.length;
  document.getElementById("searchEmptyState").hidden = results.length > 0;
  document.querySelector("#searchPage .table-scroll").hidden = results.length === 0;

  const body = document.getElementById("searchResultBody");
  body.innerHTML = results.map((file) => {
    const isOwner = file.id_user === currentUser.id;
    const statusBadge = file.status
      ? `<span class="status active">Hoạt động</span>`
      : `<span class="status inactive">Đã ẩn</span>`;
    const tagsHtml = (file.file_hashtag || [])
      .map(fh => fh.hashtag?.name ? `<span class="badge">#${escapeHTML(fh.hashtag.name)}</span>` : '')
      .join(' ') || '-';

    return /* html */ `
      <tr data-file-id="${file.id}" data-storage-path="${escapeAttr(file.storage_path)}">
        <td>${escapeHTML(file.file_name)}</td>
        <td>${tagsHtml}</td>
        <td>${escapeHTML(file.user?.user_name || "-")}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="actions">
            <button class="action-btn" data-view-file title="Xem">👁</button>
            <button class="action-btn" data-download-file title="Tải về">⬇</button>
            ${isOwner
        ? `<button class="action-btn" data-toggle-status="${file.status}" title="${file.status ? "Ẩn file" : "Hiện lại file"}">${file.status ? "🚫" : "↺"}</button>`
        : ""}
            ${isOwner ? `<button class="action-btn delete" data-delete-file title="Xóa vĩnh viễn">⌫</button>` : ""}
          </div>
        </td>
      </tr>`;
  }).join("");

  attachFileRowEvents(body);
}

// ==========================================================================
// TAB: TÀI KHOẢN
// ==========================================================================

document.getElementById("accountForm").addEventListener("submit", handleUpdateAccount);

async function handleUpdateAccount(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("accountSubmitBtn");
  submitBtn.disabled = true;

  try {
    const newName = document.getElementById("accountNewName").value.trim();
    const newPassword = document.getElementById("accountNewPassword").value;
    const confirmPassword = document.getElementById("accountConfirmPassword").value;
    const currentPassword = document.getElementById("accountCurrentPassword").value;

    if (!newName && !newPassword) throw new Error("Bạn chưa nhập gì để cập nhật.");
    if (newPassword && newPassword !== confirmPassword) throw new Error("Mật khẩu mới nhập lại không khớp.");
    if (newPassword && newPassword.length < 6) throw new Error("Mật khẩu mới cần tối thiểu 6 ký tự.");

    const { error: reauthError } = await supabaseClient.auth.signInWithPassword({
      email: currentUser.email,
      password: currentPassword,
    });
    if (reauthError) throw new Error("Mật khẩu hiện tại không đúng.");

    if (newName) {
      const { error } = await supabaseClient.from("user").update({ user_name: newName }).eq("id", currentUser.id);
      if (error) throw error;
      currentUser.name = newName;
      elUserNameLabel.textContent = currentUser.name;
      elUserAvatar.textContent = currentUser.name.slice(0, 2).toUpperCase();
    }

    if (newPassword) {
      const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
      if (error) throw error;
    }

    showToast("Đã cập nhật tài khoản", "");
    document.getElementById("accountForm").reset();
  } catch (error) {
    showToast("Không cập nhật được", error.message || "Vui lòng thử lại.");
  } finally {
    submitBtn.disabled = false;
  }
}

// ==========================================================================
// HÀM TIỆN ÍCH
// ==========================================================================

function showToast(title, message) {
  clearTimeout(toastTimer);
  document.getElementById("toastTitle").textContent = title;
  document.getElementById("toastMessage").textContent = message;
  document.getElementById("toast").classList.add("show");
  toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), 2800);
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("vi-VN");
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
  });
}

function escapeAttr(value = "") {
  return escapeHTML(value);
}

function enablePasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.toggleAttached) return;
    input.dataset.toggleAttached = "true";

    const wrapper = document.createElement("div");
    wrapper.className = "password-field-wrap";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "password-toggle-btn";
    toggleBtn.textContent = "👁";
    wrapper.appendChild(toggleBtn);

    toggleBtn.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggleBtn.textContent = showing ? "👁" : "🙈";
    });
  });
}
enablePasswordToggles();

function applyTheme(isDark) {
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
}

function initThemeToggle(isDark) {
  applyTheme(isDark);
  const toggle = document.getElementById("darkModeToggle");
  if (!toggle) return;
  toggle.checked = !!isDark;

  toggle.addEventListener("change", async () => {
    const newValue = toggle.checked;
    applyTheme(newValue);
    await supabaseClient.from("user").update({ color: newValue }).eq("id", currentUser.id);
  });
}

async function loadLeaderboard() {
  const { data, error } = await supabaseClient
    .from("user")
    .select("user_name, score")
    .order("score", { ascending: false })
    .limit(10);

  const list = document.getElementById("leaderboardList");
  if (!list) return;

  if (error || !data || data.length === 0) {
    list.innerHTML = `<p style="color:var(--text-sub);font-size:0.85rem;">Chưa có dữ liệu.</p>`;
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  list.innerHTML = data
    .map((u, i) => /* html */ `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 0;border-bottom:1px solid var(--border-color);">
        <span style="width:1.5rem;text-align:center;font-weight:bold;">${medals[i] || i + 1}</span>
        <span style="flex:1;">${escapeHTML(u.user_name || "Ẩn danh")}</span>
        <strong>${u.score ?? 0} file</strong>
      </div>`)
    .join("");
}