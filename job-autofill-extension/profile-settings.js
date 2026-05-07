const FIELDS = [
  "firstName", "lastName", "fullName", "email", "phone",
  "city", "state", "zip", "university",
  "linkedin", "github", "portfolio", "summary",
  "desiredRole", "skills", "experience", "careerGoals"
];

const DEFAULT_AI_MODEL = "gpt-5.4-mini";

// ─── Profile (text fields) ────────────────────────────────────────────────────
async function loadProfile() {
  const { profile = {}, openaiApiKey = "", aiSettings = {} } =
    await chrome.storage.local.get(["profile", "openaiApiKey", "aiSettings"]);
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (el) el.value = profile[key] || "";
  }

  document.getElementById("aiEnabled").checked = Boolean(aiSettings.enabled);
  document.getElementById("openaiApiKey").value = openaiApiKey;
  document.getElementById("aiModel").value = aiSettings.model || DEFAULT_AI_MODEL;
}

async function saveProfile() {
  const profile = {};
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (el) profile[key] = el.value.trim();
  }

  const aiSettings = {
    enabled: document.getElementById("aiEnabled").checked,
    model: document.getElementById("aiModel").value.trim() || DEFAULT_AI_MODEL
  };
  const openaiApiKey = document.getElementById("openaiApiKey").value.trim();

  await chrome.storage.local.set({ profile, aiSettings, openaiApiKey });

  const status = document.getElementById("status");
  status.textContent = "저장 완료";
  setTimeout(() => { status.textContent = ""; }, 2000);
}

// ─── File storage helpers ─────────────────────────────────────────────────────
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result); // data:<mime>;base64,<data>
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadFileStatus(storageKey, statusElId) {
  const result = await chrome.storage.local.get(storageKey);
  const fileData = result[storageKey];
  const statusEl = document.getElementById(statusElId);
  if (fileData && fileData.name) {
    statusEl.textContent = `저장됨: ${fileData.name} (${formatBytes(fileData.size)})`;
    statusEl.classList.add("saved");
  } else {
    statusEl.textContent = "저장된 파일 없음";
    statusEl.classList.remove("saved");
  }
}

function formatBytes(bytes) {
  if (!bytes) return "?";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function setupFileInput(inputId, storageKey, statusElId, clearBtnId) {
  const input   = document.getElementById(inputId);
  const clearBtn = document.getElementById(clearBtnId);

  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;

    const fileStatusEl = document.getElementById("fileStatus");
    fileStatusEl.textContent = "파일 읽는 중...";

    try {
      const base64 = await readFileAsBase64(file);
      await chrome.storage.local.set({
        [storageKey]: { name: file.name, type: file.type, size: file.size, data: base64 }
      });
      await loadFileStatus(storageKey, statusElId);
      fileStatusEl.textContent = `${file.name} 저장 완료`;
      setTimeout(() => { fileStatusEl.textContent = ""; }, 2500);
    } catch (err) {
      fileStatusEl.textContent = "저장 실패: " + err.message;
    }

    input.value = ""; // reset so same file can be re-selected
  });

  clearBtn.addEventListener("click", async () => {
    await chrome.storage.local.remove(storageKey);
    await loadFileStatus(storageKey, statusElId);
    const fileStatusEl = document.getElementById("fileStatus");
    fileStatusEl.textContent = "파일 삭제됨";
    setTimeout(() => { fileStatusEl.textContent = ""; }, 2000);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadProfile();
  loadFileStatus("resumeFile",    "resumeFileStatus");
  loadFileStatus("portfolioFile", "portfolioFileStatus");

  setupFileInput("resumeFileInput",    "resumeFile",    "resumeFileStatus",    "resumeFileClear");
  setupFileInput("portfolioFileInput", "portfolioFile", "portfolioFileStatus", "portfolioFileClear");
});

document.getElementById("saveBtn").addEventListener("click", saveProfile);
