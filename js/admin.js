/* ==========================================================================
   ADMIN.JS - Xử lý toàn bộ trang Admin:
   Quản lý file / Quản lý Hashtag / Quản lý user / Upload / Lịch sử / Thảo luận
   Dùng cho: html/admin.html
   Phụ thuộc: js/config.js, js/comment.js (nhúng TRƯỚC file này)
   ========================================================================== */

// ---------- 1. TRẠNG THÁI DÙNG CHUNG TOÀN FILE ----------
const BUCKET_NAME = "documents";
let currentUser = null;
let hashtagListAdmin = [];
let allFiles = [];
let allUsers = [];
let toastTimer;

const elSidebar = document.getElementById("sidebar");
const elBreadcrumbCurrent = document.getElementById("breadcrumbCurrent");
const elUserNameLabel = document.getElementById("userNameLabel");
const elUserAvatar = document.getElementById("userAvatar");

// ---------- 2. KHỞI CHẠY TRANG ----------
bootstrapAdminPage();

async function bootstrapAdminPage() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  const { data: profile, error } = await supabaseClient
    .from("user")
    .select("user_name, status, is_admin, is_super_admin, color")
    .eq("id", session.user.id)
    .single();

  if (error || !profile || !profile.status || !profile.is_admin) {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
    return;
  }

  currentUser = {
    id: session.user.id,
    name: profile.user_name || "Admin",
    email: session.user.email,
    isAdmin: true,
    isSuperAdmin: !!profile.is_super_admin,
  };

  elUserNameLabel.textContent = currentUser.name + (currentUser.isSuperAdmin ? " (Super Admin)" : "");
  elUserAvatar.textContent = currentUser.name.slice(0, 2).toUpperCase();

  initThemeToggle(profile.color);
  await loadHashtagsAdmin();
  await loadFiles();
  await loadUsers();
  await loadHistory();
  await loadSettings();
  await loadLeaderboard();
  await CommentModule.init("commentRoot", { userId: currentUser.id, isAdmin: true });
  restorePageFromHash();
}

// ---------- 3. ĐIỀU HƯỚNG ----------
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
  files: "Quản lý file",
  hashtags: "Quản lý Hashtag",
  users: "Quản lý user",
  leaderboard: "Bảng xếp hạng",
  upload: "Upload",
  history: "Lịch sử",
  discussion: "Thảo luận",
  settings: "Cài đặt",
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
}

function restorePageFromHash() {
  const savedPage = window.location.hash.replace("#", "");
  if (savedPage && pageTitles[savedPage]) {
    switchPage(savedPage);
  }
}

// ==========================================================================
// TAB: QUẢN LÝ FILE
// ==========================================================================

document.getElementById("fileSearchInput").addEventListener("input", renderFileTable);

async function loadFiles() {
  const { data, error } = await supabaseClient
    .from("file")
    .select("id, file_name, storage_path, status, created_at, id_user, user:id_user(user_name), file_hashtag(hashtag:id_hashtag(name))")
    .order("created_at", { ascending: false });

  if (error) {
    showToast("Không tải được file", error.message);
    return;
  }

  allFiles = data || [];
  renderFileTable();
}

function renderFileTable() {
  const rawKeyword = document.getElementById("fileSearchInput").value.trim().toLowerCase().replace(/^#/, "");

  const list = allFiles.filter((file) => {
    const tagsText = (file.file_hashtag || []).map(fh => fh.hashtag?.name || "").join(" ").toLowerCase();
    const haystack = `${file.id} ${file.file_name} ${file.user?.user_name || ""} ${tagsText}`.toLowerCase();
    return haystack.includes(rawKeyword);
  });

  document.getElementById("fileResultCount").textContent = list.length;
  document.getElementById("fileEmptyState").hidden = list.length > 0;
  document.querySelector("#filesPage .table-scroll").hidden = list.length === 0;

  const body = document.getElementById("fileTableBody");
  body.innerHTML = list.map(renderFileRow).join("");
  attachFileRowEvents(body);
}

function renderFileRow(file) {
  const statusHtml = file.status
    ? `<span class="status active">Hoạt động</span>`
    : `<span class="status inactive">Đã xóa mềm</span>`;

  const tagsHtml = (file.file_hashtag || [])
    .map(fh => fh.hashtag?.name ? `<span class="badge">#${escapeHTML(fh.hashtag.name)}</span>` : '')
    .join(' ') || '-';

  return /* html */ `
    <tr data-file-id="${file.id}" data-storage-path="${escapeAttr(file.storage_path)}" data-status="${file.status}">
      <td>#${file.id.slice(0, 8)}...</td>
      <td>${escapeHTML(file.file_name)}</td>
      <td>${tagsHtml}</td>
      <td>${escapeHTML(file.user?.user_name || "-")}</td>
      <td>${statusHtml}</td>
      <td>${formatDate(file.created_at)}</td>
      <td>
        <div class="actions">
          <button class="action-btn" data-view-file title="Xem">👁</button>
          <button class="action-btn" data-download-file title="Tải về">⬇</button>
          <button class="action-btn" data-rename-file title="Đổi tên">✎</button>
          <button class="action-btn" data-toggle-status="${file.status}" title="${file.status ? "Ẩn file" : "Hiện lại file"}">${file.status ? "🚫" : "↺"}</button>
          <button class="action-btn delete" data-purge-file title="Xóa vĩnh viễn">⌫</button>
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
    const toggleBtn = row.querySelector("[data-toggle-status]");
    if (toggleBtn) {
      const currentStatus = toggleBtn.dataset.toggleStatus === "true";
      toggleBtn.addEventListener("click", () => toggleFileStatus(fileId, currentStatus));
    }
    row.querySelector("[data-purge-file]")?.addEventListener("click", () => purgeFile(fileId));
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
  const oldName = row.children[1].textContent;
  const newName = prompt("Nhập tên mới cho file:", oldName);
  if (!newName || newName.trim() === "" || newName === oldName) return;

  const { error } = await supabaseClient
    .from("file")
    .update({ file_name: newName.trim(), updated_at: new Date().toISOString() })
    .eq("id", fileId);

  if (error) return showToast("Không đổi tên được", error.message);

  await logHistory(fileId, "Đã sửa");
  showToast("Đã đổi tên file", "");
  await loadFiles();
}

async function toggleFileStatus(fileId, currentStatus) {
  const newStatus = !currentStatus;
  const { error } = await supabaseClient.from("file").update({ status: newStatus }).eq("id", fileId);
  if (error) return showToast("Không cập nhật được", error.message);

  await logHistory(fileId, newStatus ? "Đã sửa" : "Đã xóa");
  showToast(newStatus ? "Đã hiện lại file" : "Đã ẩn file", "");
  await loadFiles();
}

async function purgeFile(fileId) {
  const file = allFiles.find((f) => f.id === fileId);
  if (!file) return;
  if (!confirm(`XÓA VĨNH VIỄN file "${file.file_name}"?`)) return;

  try {
    await supabaseClient.from("history_file").delete().eq("id_file", fileId);

    const bucketName = file.storage_path.split("/")[0];
    const pathInsideBucket = file.storage_path.split("/").slice(1).join("/");
    await supabaseClient.storage.from(bucketName).remove([pathInsideBucket]);

    const { error } = await supabaseClient.from("file").delete().eq("id", fileId);
    if (error) throw error;

    showToast("Đã xóa vĩnh viễn", `File "${file.file_name}" đã bị xóa.`);
    await loadFiles();
    await loadHistory();
    await loadLeaderboard();
  } catch (error) {
    showToast("Không xóa vĩnh viễn được", error.message);
  }
}

async function logHistory(fileId, change) {
  await supabaseClient.from("history_file").insert({ id_file: fileId, id_user: currentUser.id, change });
}

// ==========================================================================
// TAB: QUẢN LÝ HASHTAG
// ==========================================================================

async function loadHashtagsAdmin() {
  const { data, error } = await supabaseClient
    .from("hashtag")
    .select("id, name, created_at")
    .order("name");

  if (error) return showToast("Không tải được Hashtag", error.message);

  hashtagListAdmin = data || [];
  renderHashtagManageList();
}

function renderHashtagManageList() {
  const body = document.getElementById("hashtagManageBody");
  if (!body) return;

  body.innerHTML = hashtagListAdmin.map((h) => /* html */ `
    <tr data-hashtag-id="${h.id}">
      <td><strong>#${escapeHTML(h.name)}</strong></td>
      <td>${formatDate(h.created_at)}</td>
      <td>
        <div class="actions">
          <button class="action-btn" data-edit-hashtag="${h.id}" title="Sửa tên">✎</button>
          <button class="action-btn delete" data-delete-hashtag="${h.id}" title="Xóa">⌫</button>
        </div>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll("[data-edit-hashtag]").forEach((btn) => {
    btn.addEventListener("click", () => handleEditHashtag(btn.dataset.editHashtag));
  });
  body.querySelectorAll("[data-delete-hashtag]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteHashtag(btn.dataset.deleteHashtag));
  });
}

document.getElementById("hashtagForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = document.getElementById("hashtagSubmitBtn");
  const input = document.getElementById("hashtagName");
  const tagName = input.value.trim().replace(/^#/, "");

  if (!tagName) return;
  submitBtn.disabled = true;

  const { error } = await supabaseClient.from("hashtag").insert({
    name: tagName,
    created_by: currentUser.id
  });

  submitBtn.disabled = false;
  if (error) return showToast("Không tạo được Hashtag", error.message);

  showToast("Đã tạo Hashtag mới", `#${tagName}`);
  input.value = "";
  await loadHashtagsAdmin();
});

async function handleEditHashtag(hashtagId) {
  const tag = hashtagListAdmin.find((h) => h.id === hashtagId);
  const newName = prompt("Nhập tên Hashtag mới (không nhập dấu #):", tag?.name || "");
  const cleanName = (newName || "").trim().replace(/^#/, "");

  if (!cleanName || cleanName === tag?.name) return;

  const { error } = await supabaseClient
    .from("hashtag")
    .update({ name: cleanName })
    .eq("id", hashtagId);

  if (error) return showToast("Không đổi tên được", error.message);

  showToast("Đã cập nhật Hashtag", `#${cleanName}`);
  await loadHashtagsAdmin();
  await loadFiles();
}

async function handleDeleteHashtag(hashtagId) {
  const tag = hashtagListAdmin.find((h) => h.id === hashtagId);
  if (!confirm(`Xóa Hashtag #${tag?.name}? Các file đang gắn hashtag này sẽ bị gỡ thẻ.`)) return;

  const { error } = await supabaseClient.from("hashtag").delete().eq("id", hashtagId);

  if (error) return showToast("Không xóa được Hashtag", error.message);

  showToast("Đã xóa Hashtag", "");
  await loadHashtagsAdmin();
  await loadFiles();
}

// ==========================================================================
// TAB: QUẢN LÝ USER
// ==========================================================================

document.getElementById("userSearchInput").addEventListener("input", renderUserTable);

async function loadUsers() {
  const { data, error } = await supabaseClient
    .from("user")
    .select("id, user_name, gender, status, is_admin, is_super_admin, last_sign_in_at")
    .order("created_at", { ascending: false });

  if (error) return showToast("Không tải được user", error.message);

  allUsers = data || [];
  await loadUserFileCounts();
  renderUserTable();
}

async function loadUserFileCounts() {
  const results = await Promise.all(
    allUsers.map(async (u) => {
      const { count } = await supabaseClient
        .from("file")
        .select("id", { count: "exact", head: true })
        .eq("id_user", u.id);
      return { id: u.id, count: count || 0 };
    })
  );
  const countMap = Object.fromEntries(results.map((r) => [r.id, r.count]));
  allUsers = allUsers.map((u) => ({ ...u, fileCount: countMap[u.id] || 0 }));
}

function renderUserTable() {
  const keyword = document.getElementById("userSearchInput").value.trim().toLowerCase();
  const list = allUsers.filter((u) => (u.user_name || "").toLowerCase().includes(keyword));

  document.getElementById("userResultCount").textContent = list.length;
  document.getElementById("userEmptyState").hidden = list.length > 0;
  document.querySelector("#usersPage .table-scroll").hidden = list.length === 0;

  const body = document.getElementById("userTableBody");
  body.innerHTML = list.map(renderUserRow).join("");
  attachUserRowEvents(body);
}

function renderUserRow(user) {
  const statusHtml = user.status
    ? `<span class="status active">Đã duyệt</span>`
    : `<span class="status inactive">Chờ duyệt</span>`;

  let roleHtml = `<span class="badge">User</span>`;
  if (user.is_super_admin) roleHtml = `<span class="badge">Super Admin</span>`;
  else if (user.is_admin) roleHtml = `<span class="badge">Admin</span>`;

  const isSelf = user.id === currentUser.id;
  const canManageRole = currentUser.isSuperAdmin && !isSelf && !user.is_super_admin;
  const canDelete = !isSelf && !user.is_super_admin && (currentUser.isSuperAdmin || !user.is_admin);
  const canToggleStatus = !isSelf && (currentUser.isSuperAdmin || !user.is_admin);

  return /* html */ `
    <tr data-user-id="${user.id}">
      <td>${escapeHTML(user.user_name || "-")}</td>
      <td>${user.gender === true ? "Nam" : user.gender === false ? "Nữ" : "-"}</td>
      <td>${statusHtml}</td>
      <td>${roleHtml}</td>
      <td>${user.fileCount ?? 0}</td>
      <td>${user.last_sign_in_at ? formatDate(user.last_sign_in_at) : "-"}</td>
      <td>
        <div class="actions">
          ${!user.status && canToggleStatus ? `<button class="action-btn" data-approve-user title="Duyệt">✓</button>` : ""}
          ${user.status && canToggleStatus ? `<button class="action-btn" data-lock-user title="Khóa">🔒</button>` : ""}
          ${canManageRole
      ? `<button class="action-btn" data-toggle-admin title="${user.is_admin ? "Thu quyền Admin" : "Cấp quyền Admin"}">${user.is_admin ? "▾" : "▴"}</button>`
      : ""}
          ${canDelete ? `<button class="action-btn delete" data-delete-user title="Xóa">⌫</button>` : ""}
        </div>
      </td>
    </tr>`;
}

function attachUserRowEvents(container) {
  container.querySelectorAll("tr[data-user-id]").forEach((row) => {
    const userId = row.dataset.userId;

    row.querySelector("[data-approve-user]")?.addEventListener("click", () => setUserStatus(userId, true));
    row.querySelector("[data-lock-user]")?.addEventListener("click", () => setUserStatus(userId, false));
    row.querySelector("[data-toggle-admin]")?.addEventListener("click", () => toggleAdmin(userId, row));
    row.querySelector("[data-delete-user]")?.addEventListener("click", () => deleteUser(userId));
  });
}

async function setUserStatus(userId, status) {
  const { error } = await supabaseClient.from("user").update({ status }).eq("id", userId);
  if (error) return showToast("Không cập nhật được", error.message);

  showToast(status ? "Đã duyệt tài khoản" : "Đã khóa tài khoản", "");
  await loadUsers();
}

async function toggleAdmin(userId, row) {
  const user = allUsers.find((u) => u.id === userId);
  const { error } = await supabaseClient
    .from("user")
    .update({ is_admin: !user.is_admin })
    .eq("id", userId);

  if (error) return showToast("Không đổi được quyền", error.message);

  showToast(!user.is_admin ? "Đã cấp quyền Admin" : "Đã thu quyền Admin", "");
  await loadUsers();
}

async function deleteUser(userId) {
  if (!confirm("Xóa VĨNH VIỄN tài khoản này?")) return;

  const { data, error } = await supabaseClient.functions.invoke("delete-user", {
    body: { userId },
  });

  if (error || data?.error) {
    return showToast("Không xóa được", data?.error || error.message);
  }

  showToast("Đã xóa user", "Tài khoản đã được xóa hoàn toàn khỏi hệ thống.");
  await loadUsers();
}

// ==========================================================================
// TAB: UPLOAD (DÙNG CHUNG BUCKET DOCUMENTS)
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

    if (!rawFile) throw new Error("Vui lòng chọn file.");

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
      .insert({ file_name: displayName, storage_path: storagePath, id_user: currentUser.id, bio })
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
    await loadFiles();
    await loadHashtagsAdmin();
    await loadLeaderboard();
  } catch (error) {
    showToast("Tải lên thất bại", error.message || "Vui lòng thử lại.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "⬆ Tải lên";
  }
}

// ==========================================================================
// TAB: LỊCH SỬ
// ==========================================================================

async function loadHistory() {
  const [fileHistoryResult, adminHistoryResult] = await Promise.all([
    supabaseClient
      .from("history_file")
      .select("id, created_at, change, file:id_file(file_name), user:id_user(user_name)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseClient
      .from("history_admin")
      .select("id, created_at, action, actor:actor_id(user_name), target:target_id(user_name)")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (fileHistoryResult.error) return showToast("Không tải được lịch sử file", fileHistoryResult.error.message);
  if (adminHistoryResult.error) return showToast("Không tải được lịch sử phân quyền", adminHistoryResult.error.message);

  const fileEntries = (fileHistoryResult.data || []).map((h) => ({
    time: h.created_at,
    target: h.file?.file_name || "(file đã bị xóa vĩnh viễn)",
    actor: h.user?.user_name || "-",
    action: h.change,
  }));

  const adminEntries = (adminHistoryResult.data || []).map((h) => ({
    time: h.created_at,
    target: h.target?.user_name || "-",
    actor: h.actor?.user_name || "-",
    action: h.action,
  }));

  const merged = [...fileEntries, ...adminEntries].sort((a, b) => new Date(b.time) - new Date(a.time));

  document.getElementById("historyEmptyState").hidden = merged.length > 0;
  document.querySelector("#historyPage .table-scroll").hidden = merged.length === 0;

  document.getElementById("historyTableBody").innerHTML = merged
    .map(
      (h) => /* html */ `
      <tr>
        <td>${formatDateTime(h.time)}</td>
        <td>${escapeHTML(h.target)}</td>
        <td>${escapeHTML(h.actor)}</td>
        <td>${escapeHTML(h.action)}</td>
      </tr>`
    )
    .join("");
}

// ==========================================================================
// TAB: CÀI ĐẶT
// ==========================================================================

document.getElementById("settingsForm").addEventListener("submit", handleSaveSettings);

async function loadSettings() {
  const { data, error } = await supabaseClient
    .from("site_setting")
    .select("phone, email, facebook")
    .eq("id", 1)
    .single();

  if (error || !data) return;

  document.getElementById("settingPhone").value = data.phone || "";
  document.getElementById("settingEmail").value = data.email || "";
  document.getElementById("settingFacebook").value = data.facebook || "";
}

async function handleSaveSettings(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("settingsSubmitBtn");
  submitBtn.disabled = true;

  const payload = {
    id: 1,
    phone: document.getElementById("settingPhone").value.trim(),
    email: document.getElementById("settingEmail").value.trim(),
    facebook: document.getElementById("settingFacebook").value.trim(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("site_setting").upsert(payload);

  submitBtn.disabled = false;
  if (error) return showToast("Không lưu được", error.message);

  showToast("Đã lưu cài đặt", "Thông tin liên hệ đã được cập nhật.");
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
      elUserNameLabel.textContent = currentUser.name + (currentUser.isSuperAdmin ? " (Super Admin)" : "");
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

function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString("vi-VN");
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