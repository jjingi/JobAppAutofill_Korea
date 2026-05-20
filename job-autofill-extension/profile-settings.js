const FIELDS = [
  "firstName", "lastName", "fullName", "email", "phone",
  "gender", "birthday", "nationality", "joinPossibleDate",
  "city", "state", "zip", "address", "addressDetail", "university",
  "linkedin", "github", "portfolio", "homepage", "otherSNS", "summary",
  "desiredRole", "skills", "experience", "careerGoals", "resumeContext",
  "disabilityStatus", "veteranStatus", "militaryStatus", "militaryRank",
  "militaryStartDate", "militaryEndDate", "militaryDischarge",
  "recommenderName", "recommenderRelationship", "recommenderContact",
  "recommenderDepartment", "recommenderComment"
];

const DEFAULT_AI_MODEL = "gpt-5.4-mini";
const hasChromeStorage = Boolean(globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local);

const LIST_CONFIGS = {
  educationItems: {
    containerId: "educationList",
    addButtonId: "addEducationBtn",
    title: "학력",
    emptyItem: {
      school: "",
      degree: "",
      major: "",
      startDate: "",
      endDate: "",
      graduationStatus: "",
      gpa: "",
      maxGpa: "",
      notes: ""
    },
    fields: [
      { key: "school", label: "학교명", placeholder: "예: UC San Diego" },
      { key: "degree", label: "학위 / 과정", placeholder: "예: 학사, 석사, 고등학교" },
      { key: "major", label: "전공", placeholder: "예: Cognitive Science" },
      { key: "startDate", label: "입학일", placeholder: "YYYY.MM" },
      { key: "endDate", label: "졸업일", placeholder: "YYYY.MM" },
      { key: "graduationStatus", label: "졸업구분", placeholder: "졸업 / 졸업예정 / 재학 / 수료" },
      { key: "gpa", label: "평점", placeholder: "예: 3.8" },
      { key: "maxGpa", label: "만점", placeholder: "예: 4.0" },
      { key: "notes", label: "비고", type: "textarea", full: true }
    ]
  },
  experienceItems: {
    containerId: "experienceList",
    addButtonId: "addExperienceBtn",
    title: "경력",
    emptyItem: {
      company: "",
      department: "",
      position: "",
      startDate: "",
      endDate: "",
      current: "",
      responsibilities: "",
      achievements: ""
    },
    fields: [
      { key: "company", label: "회사 / 조직명", placeholder: "예: Company Inc." },
      { key: "department", label: "부서", placeholder: "예: 콘텐츠팀" },
      { key: "position", label: "직급 / 역할", placeholder: "예: 인턴, PM" },
      { key: "startDate", label: "시작일", placeholder: "YYYY.MM" },
      { key: "endDate", label: "종료일", placeholder: "YYYY.MM" },
      { key: "current", label: "재직여부", placeholder: "재직중 / 퇴사" },
      { key: "responsibilities", label: "담당업무", type: "textarea", full: true },
      { key: "achievements", label: "성과", type: "textarea", full: true }
    ]
  },
  projectItems: {
    containerId: "projectList",
    addButtonId: "addProjectBtn",
    title: "프로젝트",
    emptyItem: {
      name: "",
      role: "",
      startDate: "",
      endDate: "",
      skills: "",
      url: "",
      description: ""
    },
    fields: [
      { key: "name", label: "프로젝트명" },
      { key: "role", label: "역할" },
      { key: "startDate", label: "시작일", placeholder: "YYYY.MM" },
      { key: "endDate", label: "종료일", placeholder: "YYYY.MM" },
      { key: "skills", label: "사용 기술 / 역량" },
      { key: "url", label: "링크" },
      { key: "description", label: "설명 / 성과", type: "textarea", full: true }
    ]
  }
};

const storage = {
  async get(keys) {
    if (hasChromeStorage) return globalThis.chrome.storage.local.get(keys);

    const keyList = Array.isArray(keys) ? keys : [keys];
    const result = {};
    for (const key of keyList) {
      const raw = localStorage.getItem(`jobAutofill.${key}`);
      if (raw != null) {
        try {
          result[key] = JSON.parse(raw);
        } catch (_) {
          result[key] = raw;
        }
      }
    }
    return result;
  },
  async set(values) {
    if (hasChromeStorage) return globalThis.chrome.storage.local.set(values);

    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(`jobAutofill.${key}`, JSON.stringify(value));
    }
  },
  async remove(key) {
    if (hasChromeStorage) return globalThis.chrome.storage.local.remove(key);

    const keys = Array.isArray(key) ? key : [key];
    keys.forEach(item => localStorage.removeItem(`jobAutofill.${item}`));
  }
};

// ─── Profile (text fields) ────────────────────────────────────────────────────
async function loadProfile() {
  const { profile = {}, openaiApiKey = "", aiSettings = {} } =
    await storage.get(["profile", "openaiApiKey", "aiSettings"]);
  applyProfileToForm(profile);

  document.getElementById("aiEnabled").checked = Boolean(aiSettings.enabled);
  document.getElementById("openaiApiKey").value = openaiApiKey;
  document.getElementById("aiModel").value = aiSettings.model || DEFAULT_AI_MODEL;
}

function applyProfileToForm(profile) {
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (el) el.value = profile[key] || "";
  }
  renderAllStructuredLists(profile);
}

function collectProfileFromForm() {
  const profile = {};
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (el) profile[key] = el.value.trim();
  }
  profile.educationItems = collectListItems("educationItems");
  profile.experienceItems = collectListItems("experienceItems");
  profile.projectItems = collectListItems("projectItems");
  return profile;
}

function renderAllStructuredLists(profile) {
  renderListItems("educationItems", normalizeList(profile.educationItems, legacyEducationItem(profile)));
  renderListItems("experienceItems", normalizeList(profile.experienceItems, legacyExperienceItem(profile)));
  renderListItems("projectItems", normalizeList(profile.projectItems, null));
}

function normalizeList(items, legacyItem) {
  const normalized = Array.isArray(items)
    ? items.filter(item => item && typeof item === "object" && hasAnyValue(item))
    : [];
  if (normalized.length > 0) return normalized;
  return legacyItem && hasAnyValue(legacyItem) ? [legacyItem] : [];
}

function legacyEducationItem(profile) {
  return {
    school: profile.university || "",
    degree: "",
    major: "",
    startDate: "",
    endDate: "",
    graduationStatus: "",
    gpa: "",
    maxGpa: "",
    notes: ""
  };
}

function legacyExperienceItem(profile) {
  return {
    company: "",
    department: "",
    position: "",
    startDate: "",
    endDate: "",
    current: "",
    responsibilities: profile.experience || "",
    achievements: ""
  };
}

function renderListItems(listKey, items) {
  const config = LIST_CONFIGS[listKey];
  const container = document.getElementById(config.containerId);
  if (!container) return;

  container.textContent = "";
  const rows = items.length > 0 ? items : [{ ...config.emptyItem }];
  rows.forEach((item, index) => {
    container.appendChild(createListItemElement(listKey, item, index));
  });
}

function createListItemElement(listKey, item, index) {
  const config = LIST_CONFIGS[listKey];
  const wrapper = document.createElement("div");
  wrapper.className = "repeat-item";
  wrapper.dataset.listKey = listKey;

  const header = document.createElement("div");
  header.className = "repeat-header";
  const title = document.createElement("span");
  title.textContent = `${config.title} ${index + 1}`;
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-item";
  removeButton.textContent = "삭제";
  removeButton.addEventListener("click", () => {
    wrapper.remove();
    refreshListTitles(listKey);
  });
  header.append(title, removeButton);

  const grid = document.createElement("div");
  grid.className = "grid";

  for (const field of config.fields) {
    const fieldWrap = document.createElement("div");
    fieldWrap.className = field.full ? "field full" : "field";

    const label = document.createElement("label");
    label.textContent = field.label;

    const input = field.type === "textarea"
      ? document.createElement("textarea")
      : document.createElement("input");
    input.dataset.fieldKey = field.key;
    input.value = item[field.key] || "";
    if (field.placeholder) input.placeholder = field.placeholder;

    fieldWrap.append(label, input);
    grid.appendChild(fieldWrap);
  }

  wrapper.append(header, grid);
  return wrapper;
}

function refreshListTitles(listKey) {
  const config = LIST_CONFIGS[listKey];
  const container = document.getElementById(config.containerId);
  if (!container) return;
  Array.from(container.querySelectorAll(".repeat-item")).forEach((item, index) => {
    const title = item.querySelector(".repeat-header span");
    if (title) title.textContent = `${config.title} ${index + 1}`;
  });
}

function addListItem(listKey) {
  const config = LIST_CONFIGS[listKey];
  const container = document.getElementById(config.containerId);
  if (!container) return;
  container.appendChild(createListItemElement(listKey, { ...config.emptyItem }, container.children.length));
}

function collectListItems(listKey) {
  const config = LIST_CONFIGS[listKey];
  const container = document.getElementById(config.containerId);
  if (!container) return [];

  return Array.from(container.querySelectorAll(".repeat-item"))
    .map(item => {
      const row = {};
      for (const field of config.fields) {
        const input = item.querySelector(`[data-field-key="${field.key}"]`);
        row[field.key] = input ? input.value.trim() : "";
      }
      return row;
    })
    .filter(hasAnyValue);
}

function hasAnyValue(item) {
  return Object.values(item || {}).some(value => String(value || "").trim());
}

function collectAiSettingsFromForm() {
  return {
    enabled: document.getElementById("aiEnabled").checked,
    model: document.getElementById("aiModel").value.trim() || DEFAULT_AI_MODEL
  };
}

async function persistSettings() {
  const profile = collectProfileFromForm();
  const aiSettings = collectAiSettingsFromForm();
  const openaiApiKey = document.getElementById("openaiApiKey").value.trim();

  await storage.set({ profile, aiSettings, openaiApiKey });
  return { profile, aiSettings, openaiApiKey };
}

async function saveProfile() {
  await persistSettings();
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
  const result = await storage.get(storageKey);
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
      await storage.set({
        [storageKey]: { name: file.name, type: file.type, size: file.size, data: base64 }
      });
      await loadFileStatus(storageKey, statusElId);
      fileStatusEl.textContent = `${file.name} 저장 완료`;
      await maybeAutoExtractProfileFromDocuments();
      setTimeout(() => { fileStatusEl.textContent = ""; }, 2500);
    } catch (error) {
      fileStatusEl.textContent = "저장 실패: " + getKoreanErrorMessage(error);
    }

    input.value = ""; // reset so same file can be re-selected
  });

  clearBtn.addEventListener("click", async () => {
    await storage.remove(storageKey);
    await loadFileStatus(storageKey, statusElId);
    const fileStatusEl = document.getElementById("fileStatus");
    fileStatusEl.textContent = "파일 삭제됨";
    setTimeout(() => { fileStatusEl.textContent = ""; }, 2000);
  });
}

async function maybeAutoExtractProfileFromDocuments() {
  const apiKey = document.getElementById("openaiApiKey").value.trim();
  const aiEnabled = document.getElementById("aiEnabled").checked;
  if (!apiKey || !aiEnabled) return false;
  return parseDocumentsIntoProfile({ automatic: true });
}

async function parseDocumentsIntoProfile({ automatic = false } = {}) {
  const fileStatusEl = document.getElementById("fileStatus");

  try {
    const { profile, aiSettings, openaiApiKey } = await persistSettings();
    const stored = await storage.get(["resumeFile", "portfolioFile"]);
    const files = [stored.resumeFile, stored.portfolioFile].filter(file => file && file.data);

    if (!openaiApiKey) {
      fileStatusEl.textContent = "OpenAI API Key를 저장한 뒤 추출할 수 있습니다.";
      return false;
    }

    if (files.length === 0) {
      fileStatusEl.textContent = "먼저 이력서 또는 포트폴리오 파일을 저장해 주세요.";
      return false;
    }

    const unsupported = files.filter(file => !isSupportedExtractionFile(file));
    if (unsupported.length > 0) {
      fileStatusEl.textContent = `PDF 파일만 AI 추출할 수 있습니다: ${unsupported.map(file => file.name).join(", ")}`;
      return false;
    }

    fileStatusEl.textContent = "AI가 이력서/포트폴리오를 분석 중...";
    const extracted = await requestDocumentProfileExtraction({
      apiKey: openaiApiKey,
      model: aiSettings.model || DEFAULT_AI_MODEL,
      profile,
      resumeFile: stored.resumeFile,
      portfolioFile: stored.portfolioFile
    });

    const mergedProfile = mergeExtractedProfile(profile, extracted);
    await storage.set({
      profile: mergedProfile,
      parsedProfile: {
        extracted,
        updatedAt: new Date().toISOString(),
        files: files.map(file => ({ name: file.name, type: file.type, size: file.size }))
      }
    });

    applyProfileToForm(mergedProfile);
    fileStatusEl.textContent = automatic
      ? "파일 저장 및 프로필 추출 완료"
      : "이력서/포트폴리오에서 프로필 추출 완료";
    return true;
  } catch (error) {
    fileStatusEl.textContent = "프로필 추출 실패: " + getKoreanErrorMessage(error);
    return false;
  }
}

async function requestDocumentProfileExtraction({ apiKey, model, profile, resumeFile, portfolioFile }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "fullName", "email", "phone", "city", "state", "zip", "university",
      "linkedin", "github", "portfolio", "summary", "desiredRole",
      "skills", "experienceHighlights", "projectHighlights",
      "educationHighlights", "portfolioHighlights", "careerGoals", "resumeContext",
      "educationItems", "experienceItems", "projectItems"
    ],
    properties: {
      fullName: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      city: { type: "string" },
      state: { type: "string" },
      zip: { type: "string" },
      university: { type: "string" },
      linkedin: { type: "string" },
      github: { type: "string" },
      portfolio: { type: "string" },
      summary: { type: "string" },
      desiredRole: { type: "string" },
      skills: { type: "array", items: { type: "string" } },
      experienceHighlights: { type: "array", items: { type: "string" } },
      projectHighlights: { type: "array", items: { type: "string" } },
      educationHighlights: { type: "array", items: { type: "string" } },
      portfolioHighlights: { type: "array", items: { type: "string" } },
      careerGoals: { type: "string" },
      resumeContext: { type: "string" },
      educationItems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["school", "degree", "major", "startDate", "endDate", "graduationStatus", "gpa", "maxGpa", "notes"],
          properties: {
            school: { type: "string" },
            degree: { type: "string" },
            major: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            graduationStatus: { type: "string" },
            gpa: { type: "string" },
            maxGpa: { type: "string" },
            notes: { type: "string" }
          }
        }
      },
      experienceItems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["company", "department", "position", "startDate", "endDate", "current", "responsibilities", "achievements"],
          properties: {
            company: { type: "string" },
            department: { type: "string" },
            position: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            current: { type: "string" },
            responsibilities: { type: "string" },
            achievements: { type: "string" }
          }
        }
      },
      projectItems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "role", "startDate", "endDate", "skills", "url", "description"],
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            skills: { type: "string" },
            url: { type: "string" },
            description: { type: "string" }
          }
        }
      }
    }
  };

  const content = [];
  addFileInput(content, resumeFile);
  addFileInput(content, portfolioFile);
  content.push({
    type: "input_text",
    text: JSON.stringify({
      task: "Extract a structured applicant profile from these resume/portfolio files for Korean job application autofill.",
      instructions: [
        "Use only information grounded in the files or existing profile.",
        "Keep answers concise but useful for job application long-answer generation.",
        "Write summary, highlights, careerGoals, and resumeContext in Korean.",
        "Extract repeated education, experience, and project entries into structured arrays.",
        "Do not invent degrees, companies, dates, links, certifications, or metrics.",
        "If a field is unknown, return an empty string or empty array."
      ],
      existingProfile: compactObject(profile)
    })
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || DEFAULT_AI_MODEL,
      store: false,
      max_output_tokens: 6000,
      input: [
        {
          role: "user",
          content
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "resume_portfolio_profile",
          strict: true,
          schema
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error && data.error.message ? data.error.message : `OpenAI API error ${response.status}`);
    error.status = response.status;
    error.type = data.error && data.error.type;
    error.code = data.error && data.error.code;
    throw error;
  }

  const text = extractResponseText(data);
  if (!text) throw new Error("AI 추출 응답이 비어 있습니다.");
  return JSON.parse(text);
}

function addFileInput(content, fileData) {
  if (!fileData || !fileData.data) return;
  const fileDataUrl = fileData.data.startsWith("data:")
    ? fileData.data
    : `data:${fileData.type || "application/pdf"};base64,${fileData.data}`;
  content.push({
    type: "input_file",
    filename: fileData.name || "document.pdf",
    file_data: fileDataUrl
  });
}

function isSupportedExtractionFile(fileData) {
  const name = (fileData.name || "").toLowerCase();
  const type = (fileData.type || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function getKoreanErrorMessage(error) {
  const status = error && error.status;
  const code = String((error && error.code) || "").toLowerCase();
  const type = String((error && error.type) || "").toLowerCase();
  const message = String((error && error.message) || error || "").toLowerCase();

  if (status === 401 || code.includes("invalid_api_key") || message.includes("api key")) {
    return "OpenAI API Key가 올바르지 않습니다. 키를 다시 확인해 주세요.";
  }
  if (status === 429 || code.includes("rate_limit") || message.includes("quota") || message.includes("rate limit")) {
    return "OpenAI 사용량 한도 또는 요청 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (status === 400 || type.includes("invalid_request")) {
    return "AI 요청 형식에 문제가 있습니다. 모델 이름과 업로드한 PDF 파일을 확인해 주세요.";
  }
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
  }
  if (message.includes("quota") || message.includes("storage")) {
    return "확장 프로그램 저장 공간에 문제가 있습니다. 파일 크기를 줄이거나 기존 파일을 삭제한 뒤 다시 시도해 주세요.";
  }
  if (message.includes("permission") || message.includes("denied")) {
    return "권한 문제로 작업을 완료하지 못했습니다. 확장 프로그램 권한을 확인해 주세요.";
  }
  if (error && error.message && /[가-힣]/.test(error.message)) return error.message;
  return "처리 중 오류가 발생했습니다. 설정을 확인한 뒤 다시 시도해 주세요.";
}

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function compactObject(obj) {
  const output = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const compacted = compactValue(value);
    if (compacted == null) continue;
    if (typeof compacted === "string" && !compacted.trim()) continue;
    if (Array.isArray(compacted) && compacted.length === 0) continue;
    if (typeof compacted === "object" && !Array.isArray(compacted) && Object.keys(compacted).length === 0) continue;
    output[key] = compacted;
  }
  return output;
}

function compactValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value
      .map(compactValue)
      .filter(item => {
        if (item == null) return false;
        if (typeof item === "string") return Boolean(item.trim());
        if (Array.isArray(item)) return item.length > 0;
        if (typeof item === "object") return Object.keys(item).length > 0;
        return true;
      });
  }
  if (typeof value === "object") return compactObject(value);
  const text = String(value).trim();
  return text || null;
}

function mergeExtractedProfile(profile, extracted) {
  const merged = { ...profile };

  function fillBlank(key, value) {
    const text = normalizeExtractedText(value);
    if (!merged[key] && text) merged[key] = text;
  }

  fillBlank("fullName", extracted.fullName);
  fillBlank("email", extracted.email);
  fillBlank("phone", extracted.phone);
  fillBlank("city", extracted.city);
  fillBlank("state", extracted.state);
  fillBlank("zip", extracted.zip);
  fillBlank("university", extracted.university);
  fillBlank("linkedin", extracted.linkedin);
  fillBlank("github", extracted.github);
  fillBlank("portfolio", extracted.portfolio);
  fillBlank("summary", extracted.summary);
  fillBlank("desiredRole", extracted.desiredRole);
  fillBlank("careerGoals", extracted.careerGoals);

  if (!merged.skills && extracted.skills && extracted.skills.length) {
    merged.skills = extracted.skills.map(normalizeExtractedText).filter(Boolean).join(", ");
  }

  if (!merged.experience) {
    merged.experience = [
      ...(extracted.experienceHighlights || []),
      ...(extracted.projectHighlights || [])
    ].map(normalizeExtractedText).filter(Boolean).join("\n");
  }

  if (!Array.isArray(merged.educationItems) || merged.educationItems.length === 0) {
    merged.educationItems = normalizeStructuredItems("educationItems", extracted.educationItems);
  }
  if (!Array.isArray(merged.experienceItems) || merged.experienceItems.length === 0) {
    merged.experienceItems = normalizeStructuredItems("experienceItems", extracted.experienceItems);
  }
  if (!Array.isArray(merged.projectItems) || merged.projectItems.length === 0) {
    merged.projectItems = normalizeStructuredItems("projectItems", extracted.projectItems);
  }

  merged.resumeContext = normalizeExtractedText(extracted.resumeContext) || [
    extracted.summary,
    arraySection("핵심 기술", extracted.skills),
    arraySection("경력/프로젝트", [...(extracted.experienceHighlights || []), ...(extracted.projectHighlights || [])]),
    arraySection("학력", extracted.educationHighlights),
    arraySection("포트폴리오", extracted.portfolioHighlights),
    extracted.careerGoals
  ].map(normalizeExtractedText).filter(Boolean).join("\n");

  return merged;
}

function normalizeStructuredItems(listKey, items) {
  const config = LIST_CONFIGS[listKey];
  if (!config || !Array.isArray(items)) return [];
  return items
    .filter(item => item && typeof item === "object")
    .map(item => {
      const row = {};
      for (const field of config.fields) {
        row[field.key] = normalizeExtractedText(item[field.key]);
      }
      return row;
    })
    .filter(hasAnyValue);
}

function arraySection(label, values) {
  const items = (values || []).map(normalizeExtractedText).filter(Boolean);
  return items.length ? `${label}: ${items.join("; ")}` : "";
}

function normalizeExtractedText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(normalizeExtractedText).filter(Boolean).join(", ");
  return String(value).replace(/\s+/g, " ").trim();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const previewNotice = document.getElementById("previewNotice");
  if (previewNotice && !hasChromeStorage) {
    previewNotice.hidden = false;
  }

  setupStepNavigation();
  setupStructuredListButtons();
  loadProfile();
  loadFileStatus("resumeFile",    "resumeFileStatus");
  loadFileStatus("portfolioFile", "portfolioFileStatus");

  setupFileInput("resumeFileInput",    "resumeFile",    "resumeFileStatus",    "resumeFileClear");
  setupFileInput("portfolioFileInput", "portfolioFile", "portfolioFileStatus", "portfolioFileClear");
});

document.getElementById("saveBtn").addEventListener("click", saveProfile);
document.getElementById("parseDocumentsBtn").addEventListener("click", () => {
  parseDocumentsIntoProfile({ automatic: false });
});

function setupStepNavigation() {
  document.querySelectorAll("[data-step-target]").forEach(button => {
    button.addEventListener("click", () => showStep(button.dataset.stepTarget));
  });
  document.querySelectorAll("[data-next-step]").forEach(button => {
    button.addEventListener("click", () => showStep(button.dataset.nextStep));
  });
  document.querySelectorAll("[data-prev-step]").forEach(button => {
    button.addEventListener("click", () => showStep(button.dataset.prevStep));
  });
}

function showStep(stepId) {
  document.querySelectorAll(".step-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === stepId);
  });
  document.querySelectorAll(".step-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.stepTarget === stepId);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupStructuredListButtons() {
  for (const [listKey, config] of Object.entries(LIST_CONFIGS)) {
    const button = document.getElementById(config.addButtonId);
    if (button) button.addEventListener("click", () => addListItem(listKey));
  }
}
