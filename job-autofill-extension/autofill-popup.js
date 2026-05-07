const statusEl = document.getElementById("status");

const DEFAULT_AI_MODEL = "gpt-5.4-mini";

document.getElementById("openOptions").addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
});

document.getElementById("debugBtn").addEventListener("click", async () => {
  try {
    setStatus("현재 페이지 진단 정보를 수집 중...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      setStatus("활성 탭을 찾을 수 없습니다.");
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: collectAutofillDebugInfo
    });
    const stored = await chrome.storage.local.get(["resumeFile", "portfolioFile"]);
    result.savedFiles = {
      resumeFile: stored.resumeFile ? {
        name: stored.resumeFile.name || "",
        type: stored.resumeFile.type || "",
        size: stored.resumeFile.size || 0,
        hasData: Boolean(stored.resumeFile.data)
      } : null,
      portfolioFile: stored.portfolioFile ? {
        name: stored.portfolioFile.name || "",
        type: stored.portfolioFile.type || "",
        size: stored.portfolioFile.size || 0,
        hasData: Boolean(stored.portfolioFile.data)
      } : null
    };

    const text = JSON.stringify(result, null, 2);
    await navigator.clipboard.writeText(text);
    setStatus(`진단 정보를 클립보드에 복사했습니다.\n여기에 붙여넣어 주세요.\n(${text.length}자)`);
  } catch (error) {
    console.error(error);
    setStatus("진단 정보 복사 실패: " + error.message);
  }
});

document.getElementById("fillBtn").addEventListener("click", async () => {
  try {
    setStatus("현재 페이지를 분석 중...");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      setStatus("활성 탭을 찾을 수 없습니다.");
      return;
    }

    const stored = await chrome.storage.local.get([
      "profile",
      "resumeFile",
      "portfolioFile",
      "openaiApiKey",
      "aiSettings"
    ]);
    const fileStatus = getSavedFileStatus(stored);
    if (!stored.resumeFile || !stored.resumeFile.data) {
      console.warn("[Job Autofill] resume file is not saved in extension storage.");
    }
    if (!stored.portfolioFile || !stored.portfolioFile.data) {
      console.warn("[Job Autofill] portfolio file is not saved in extension storage.");
    }

    let aiSummary = "";
    if (stored.aiSettings && stored.aiSettings.enabled) {
      if (!stored.openaiApiKey) {
        aiSummary = "AI 키가 없어 규칙 기반 자동완성만 실행했습니다.";
      } else {
        try {
          setStatus("AI가 페이지 질문을 읽고 입력 위치를 판단 중...");
          const result = await runAiAutofill(tab.id, stored);
          aiSummary = `AI 자동완성: ${result.filled}개 입력`;
          if (result.skipped > 0) aiSummary += `, ${result.skipped}개 건너뜀`;
        } catch (error) {
          console.warn("[Job Autofill] AI autofill failed", error);
          aiSummary = "AI 자동완성 실패: " + error.message;
        }
      }
    }

    setStatus(aiSummary ? `${aiSummary}\n추가 질문과 파일 업로드 처리 중...` : "추가 질문과 파일 업로드 처리 중...");
    const fallbackAnswers = await runKoreanLongAnswerFallback(tab.id, stored.profile || {});
    const fileCount = await runFileUploadAutofill(tab.id, stored);
    const finalParts = ["자동완성 스크립트를 실행했습니다."];
    if (aiSummary) finalParts.unshift(aiSummary);
    finalParts.push(fileStatus);
    if (fallbackAnswers > 0) finalParts.push(`추가 질문: ${fallbackAnswers}개 작성`);
    if (fileCount > 0) finalParts.push(`파일 업로드: ${fileCount}개 처리`);
    setStatus(finalParts.join("\n"));
  } catch (error) {
    console.error(error);
    setStatus("실행 실패: " + error.message);
  }
});

function setStatus(message) {
  statusEl.textContent = message;
}

function getSavedFileStatus(stored) {
  const parts = [];
  if (stored.resumeFile && stored.resumeFile.data) {
    parts.push(`이력서 저장됨: ${stored.resumeFile.name || "파일명 없음"}`);
  } else {
    parts.push("이력서 저장 안 됨");
  }

  if (stored.portfolioFile && stored.portfolioFile.data) {
    parts.push(`포트폴리오 저장됨: ${stored.portfolioFile.name || "파일명 없음"}`);
  } else {
    parts.push("포트폴리오 저장 안 됨");
  }

  return parts.join("\n");
}

async function runAiAutofill(tabId, stored) {
  const [{ result: pageContext }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectAiFormContext
  });

  if (!pageContext || !pageContext.fields || pageContext.fields.length === 0) {
    return { filled: 0, skipped: 0 };
  }

  const aiPlan = await requestAiFillPlan({
    apiKey: stored.openaiApiKey,
    model: (stored.aiSettings && stored.aiSettings.model) || DEFAULT_AI_MODEL,
    profile: stored.profile || {},
    pageContext
  });

  const fills = (aiPlan.fields || [])
    .filter(item => item && item.action === "fill")
    .filter(item => item.id && item.value && Number(item.confidence || 0) >= 0.45)
    .map(item => ({
      id: String(item.id),
      value: String(item.value),
      confidence: Number(item.confidence || 0),
      note: item.note || "",
      profileKey: item.profileKey || null
    }));

  const skipped = (aiPlan.fields || []).length - fills.length;
  if (fills.length === 0) return { filled: 0, skipped };

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: applyAiFills,
    args: [fills]
  });

  return { filled: result && result.filled ? result.filled : 0, skipped };
}

async function runKoreanLongAnswerFallback(tabId, profile) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillKoreanLongAnswerFallback,
    args: [compactObject(profile)]
  });
  return result && result.filled ? result.filled : 0;
}

async function requestAiFillPlan({ apiKey, model, profile, pageContext }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["fields"],
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "action", "profileKey", "value", "confidence", "note"],
          properties: {
            id: { type: "string" },
            action: { type: "string", enum: ["fill", "skip"] },
            profileKey: { type: "string" },
            value: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            note: { type: "string" }
          }
        }
      }
    }
  };

  const profileForModel = compactObject(profile);
  const instructions = [
    "You are a careful Korean job application autofill assistant.",
    "Read the page form context and decide which applicant profile value belongs in each field.",
    "Use Korean for generated long-answer responses unless the field clearly asks for another language.",
    "For short factual fields, use the applicant profile exactly. Do not invent emails, phone numbers, schools, dates, salary, visa status, legal attestations, or certifications.",
    "For long Korean application questions, draft a concise, professional answer from the supplied profile, summary, experience, skills, desired role, and notes.",
    "For long-answer fields, use the field.questionText and field.hints to directly answer that exact question.",
    "Different long-answer questions must receive meaningfully different answers. Do not reuse a generic introduction across multiple questions.",
    "If a long-answer field has no identifiable question text, skip it instead of writing a vague answer.",
    "When no profile key directly applies, set profileKey to an empty string.",
    "If there is not enough information or the field is a sensitive consent/eligibility question, skip it.",
    "For select fields, choose one of the provided option labels exactly.",
    "Return only fields that were provided in the page context."
  ].join("\n");

  const userPrompt = JSON.stringify({
    applicantProfile: profileForModel,
    page: pageContext
  });

  const body = {
    model: model || DEFAULT_AI_MODEL,
    store: false,
    max_output_tokens: 7000,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: instructions }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "job_application_autofill_plan",
        strict: true,
        schema
      }
    }
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : `OpenAI API error ${response.status}`;
    throw new Error(message);
  }

  const text = extractResponseText(data);
  if (!text) throw new Error("AI 응답이 비어 있습니다.");

  try {
    return JSON.parse(text);
  } catch (error) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error("AI 응답 JSON을 읽을 수 없습니다.");
  }
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
    if (value == null) continue;
    const text = String(value).trim();
    if (text) output[key] = text;
  }
  return output;
}

function collectAutofillDebugInfo() {
  function shortText(text, limit) {
    return (text || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function safeHtml(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll("script, style, svg, img").forEach(node => node.remove());
    clone.querySelectorAll("input, textarea").forEach(node => {
      node.removeAttribute("value");
      if (node.tagName.toLowerCase() === "textarea") node.textContent = "";
    });
    return clone.outerHTML.replace(/\s+/g, " ").slice(0, 1400);
  }

  function elementSummary(el) {
    const rect = el.getBoundingClientRect();
    const block = el.closest("label, fieldset, dl, [class*='upload'], [class*='Upload'], [class*='file'], [class*='File'], [class*='attachment'], [class*='Attachment'], [class*='form-field'], [class*='field-form'], [class*='form-group'], [class*='Question'], [class*='question']");
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      role: el.getAttribute("role") || "",
      id: el.id || "",
      name: el.getAttribute("name") || "",
      fileCount: el.files ? el.files.length : undefined,
      fileNames: el.files ? Array.from(el.files).map(file => file.name) : undefined,
      autofillFileKey: el.getAttribute("data-job-autofill-file-key") || "",
      autofillFileName: el.getAttribute("data-job-autofill-file-name") || "",
      autofillQuestion: el.getAttribute("data-job-autofill-question") || "",
      className: typeof el.className === "string" ? el.className.slice(0, 300) : "",
      ariaLabel: el.getAttribute("aria-label") || "",
      text: shortText(el.innerText || el.textContent || "", 500),
      blockText: block ? shortText(block.innerText || block.textContent || "", 700) : "",
      html: safeHtml(block || el),
      position: {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  const uploadCandidateSelector = [
    "input[type='file']",
    "button",
    "label",
    "[role='button']",
    "[tabindex]",
    "[class*='upload']",
    "[class*='Upload']",
    "[class*='file']",
    "[class*='File']",
    "[class*='attachment']",
    "[class*='Attachment']"
  ].join(",");

  const textCandidateSelector = [
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "input:not([type])",
    "input[type='text']",
    "input[type='url']",
    "select"
  ].join(",");

  const uploadCandidates = Array.from(document.querySelectorAll(uploadCandidateSelector))
    .filter(el => {
      const text = shortText([
        el.innerText || el.textContent || "",
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.getAttribute("name") || "",
        el.id || "",
        el.className || ""
      ].join(" "), 800).toLowerCase();
      return el.matches("input[type='file']") ||
        /이력서|자소서|자기소개서|포트폴리오|첨부|파일|업로드|resume|cv|cover letter|portfolio|attachment|upload|file/.test(text);
    })
    .slice(0, 40)
    .map(elementSummary);

  const answerCandidates = Array.from(document.querySelectorAll(textCandidateSelector))
    .filter(el => {
      const block = el.closest("label, fieldset, dl, [class*='form-field'], [class*='field-form'], [class*='form-group'], [class*='Question'], [class*='question']");
      const text = shortText([
        el.getAttribute("aria-label") || "",
        el.getAttribute("placeholder") || "",
        el.getAttribute("name") || "",
        el.id || "",
        block ? (block.innerText || block.textContent || "") : ""
      ].join(" "), 900).toLowerCase();
      return el.tagName.toLowerCase() === "textarea" ||
        el.isContentEditable ||
        el.getAttribute("role") === "textbox" ||
        /자기소개|지원동기|경험|역량|강점|포부|프로젝트|question|answer|essay|motivation|describe|tell us/.test(text);
    })
    .slice(0, 40)
    .map(elementSummary);

  return {
    url: location.href,
    title: document.title,
    language: document.documentElement.lang || navigator.language || "",
    fileInputs: Array.from(document.querySelectorAll("input[type='file']")).map(elementSummary),
    uploadCandidates,
    answerCandidates,
    uploadDiagnostics: window.__jobAutofillUploadDiagnostics || []
  };
}

function fillKoreanLongAnswerFallback(profile) {
  function clean(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function dispatchTextEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
  }

  function nearestQuestionText(el) {
    const rect = el.getBoundingClientRect();
    const fieldTop = rect.top + window.scrollY;
    const fieldLeft = rect.left + window.scrollX;
    const fieldRight = fieldLeft + rect.width;

    function cleanupQuestion(text) {
      let value = clean(text)
        .replace(/필수|선택/g, " ")
        .replace(/답변\s*\d+\s*\/\s*\d+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const parts = value
        .split(/(?<=\?)\s+|(?<=요\.)\s+|(?<=니다\.)\s+/)
        .map(clean)
        .filter(Boolean);
      const questionPart = parts.find(part =>
        /[?？]|알려주세요|작성해|기재해|설명해|소개해|지원|동기|기여|경험|역량|강점|포부|프로젝트|이유|왜|어떻게|무엇|어떤|question|answer|essay|motivation|describe|tell us|why|how|what/i.test(part)
      );
      value = questionPart || value;
      return value.slice(0, 360);
    }

    const direct = [
      el.getAttribute("aria-label") || "",
      el.getAttribute("placeholder") || ""
    ].map(clean).find(Boolean);
    if (direct) return cleanupQuestion(direct);

    let node = el;
    const structuralCandidates = [];
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
      const parent = node.parentElement;
      if (!parent) continue;

      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(node);
      for (let i = index - 1; i >= 0 && i >= index - 5; i--) {
        const text = clean(siblings[i].innerText || siblings[i].textContent || "");
        if (text && text.length <= 900) {
          structuralCandidates.push({
            text,
            score: 1000 - depth * 100 - (index - i) * 10
          });
        }
      }

      const blockText = clean(parent.innerText || parent.textContent || "");
      const controls = parent.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='textbox']");
      if (blockText && blockText.length <= 900 && controls.length <= 2) {
        structuralCandidates.push({ text: blockText, score: 600 - depth * 80 });
      }
    }

    const bestStructural = structuralCandidates
      .map(item => ({ text: cleanupQuestion(item.text), score: item.score }))
      .filter(item => item.text && /[?？]|알려주세요|작성해|기재해|설명해|소개해|지원|동기|기여|경험|역량|강점|포부|프로젝트|이유|왜|어떻게|무엇|어떤|question|answer|essay|motivation|describe|tell us|why|how|what/i.test(item.text))
      .sort((a, b) => b.score - a.score)[0];
    if (bestStructural) return bestStructural.text;

    const candidates = Array.from(document.querySelectorAll("label, legend, h1, h2, h3, h4, p, span, div"))
      .filter(candidate => candidate !== el && !candidate.contains(el) && isVisible(candidate))
      .map(candidate => {
        const candidateRect = candidate.getBoundingClientRect();
        const top = candidateRect.top + window.scrollY;
        const left = candidateRect.left + window.scrollX;
        const right = left + candidateRect.width;
        const text = clean(candidate.innerText || candidate.textContent || "");
        return { candidate, text, top, left, right, height: candidateRect.height };
      })
      .filter(item => {
        if (!item.text || item.text.length > 700) return false;
        if (item.top >= fieldTop) return false;
        if (fieldTop - item.top > 420) return false;
        const horizontallyNear = item.right >= fieldLeft - 80 && item.left <= fieldRight + 80;
        const looksQuestionLike = /[?？]|필수|선택|질문|답변|지원|동기|소개|경험|역량|기여|강점|약점|포부|프로젝트|이유|왜|어떻게|무엇|어떤|question|answer|essay|motivation|describe|tell us|why|how|what/i.test(item.text);
        return horizontallyNear && looksQuestionLike;
      })
      .sort((a, b) => b.top - a.top)
      .map(item => cleanupQuestion(item.text))
      .find(Boolean);

    const name = clean(el.getAttribute("name") || "");
    if (name && !/^답변$|^answer$/i.test(name)) return name;
    return "";
  }

  function sentence(parts) {
    return parts.map(clean).filter(Boolean).join(" ");
  }

  function companyLabel() {
    const title = clean(document.title || "");
    const host = location.hostname.replace(/^www\./, "");
    return title && title.length <= 40 ? title : host || "해당 회사";
  }

  function motivationAnswer(questionText) {
    const company = companyLabel();
    const role = profile.desiredRole || "해당 직무";
    const intro = profile.summary || `${role}에서 사용자의 문제를 깊이 이해하고 실질적인 결과를 만드는 일을 하고 싶습니다.`;
    const skills = profile.skills ? `특히 ${profile.skills} 역량을 바탕으로` : "제가 쌓아온 역량을 바탕으로";
    const experience = profile.experience ? ` ${profile.experience}` : "";
    const goals = profile.careerGoals ? ` ${profile.careerGoals}` : "";
    return sentence([
      `${company}에 지원한 이유는 제가 지향하는 성장 방향과 ${role}에서 만들고 싶은 가치가 잘 맞는다고 느꼈기 때문입니다.`,
      intro,
      `${skills} 팀과 사용자에게 실질적으로 도움이 되는 결과를 만드는 데 기여하고 싶습니다.`,
      experience,
      goals
    ]);
  }

  function contributionAnswer(questionText) {
    const skills = profile.skills ? `${profile.skills}을 활용해` : "제가 가진 역량을 활용해";
    const experience = profile.experience ? ` ${profile.experience}` : "";
    const goals = profile.careerGoals ? ` ${profile.careerGoals}` : "";
    return sentence([
      `이 질문에 대해서는 ${questionText ? `"${questionText}"라는 관점에서 ` : ""}제가 만들 수 있는 구체적인 기여를 중심으로 말씀드리고 싶습니다.`,
      `저는 ${skills} 문제를 구조적으로 이해하고, 팀이 바로 활용할 수 있는 실행 가능한 결과물로 정리하는 데 기여하고 싶습니다.`,
      experience,
      goals
    ]);
  }

  function experienceAnswer(questionText) {
    return sentence([
      questionText ? `이 질문과 관련해 가장 먼저 말씀드리고 싶은 경험은 다음과 같습니다.` : "",
      profile.experience,
      profile.skills ? `이 과정에서 ${profile.skills}을 활용했습니다.` : "",
      profile.summary
    ]) || genericAnswer();
  }

  function strengthAnswer(questionText) {
    return sentence([
      questionText ? `질문에서 요구하는 역량과 연결해 보면, ` : "",
      profile.skills ? `저의 강점은 ${profile.skills}을 바탕으로 문제를 구조화하고 끝까지 실행하는 점입니다.` : "저의 강점은 문제를 구조적으로 이해하고 책임감 있게 실행하는 점입니다.",
      profile.experience,
      profile.summary
    ]);
  }

  function genericAnswer(questionText) {
    if (!questionText) return "";
    return sentence([
      `"${questionText}"에 대해 제 경험과 역량을 연결해 답변드리겠습니다.`,
      profile.summary,
      profile.experience,
      profile.careerGoals
    ]) || "이력서와 포트폴리오에 관련 내용을 기재해 두었습니다.";
  }

  function answerFor(questionText) {
    if (/지원동기|지원하시게 된 동기|왜 지원|motivation|why/i.test(questionText)) return motivationAnswer(questionText);
    if (/브랜드|기여|입사 후|포부|contribute|contribution/i.test(questionText)) return contributionAnswer(questionText);
    if (/경험|프로젝트|성과|해결|협업|experience|project|challenge|solve/i.test(questionText)) return experienceAnswer(questionText);
    if (/강점|역량|장점|strength|skill|competenc/i.test(questionText)) return strengthAnswer(questionText);
    return genericAnswer(questionText);
  }

  function fillField(field, value) {
    if (!field || !value) return false;
    const current = "value" in field ? field.value : (field.innerText || field.textContent || "");
    if (clean(current)) return false;

    const maxLength = Number(field.getAttribute("maxlength") || 0);
    const finalValue = maxLength > 0 && value.length > maxLength ? value.slice(0, maxLength) : value;
    if ("value" in field) setNativeValue(field, finalValue);
    else field.textContent = finalValue;
    field.setAttribute("data-job-autofill-question", clean(field.__jobAutofillQuestion || ""));
    dispatchTextEvents(field);
    field.style.outline = "2px solid #1f9d7a";
    field.title = "[Job Autofill] 저장된 프로필로 작성했습니다. 제출 전 확인하세요.";
    return true;
  }

  let filled = 0;
  const fields = Array.from(document.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']"));

  fields.forEach(field => {
    const questionText = nearestQuestionText(field);
    const isTextarea = field.tagName.toLowerCase() === "textarea";
    const maxLength = Number(field.getAttribute("maxlength") || 0);
    const current = "value" in field ? field.value : (field.innerText || field.textContent || "");
    const isLongAnswerField = isTextarea || field.isContentEditable || field.getAttribute("role") === "textbox" || maxLength > 180;
    field.__jobAutofillQuestion = questionText;
    if (!isLongAnswerField || clean(current)) {
      return;
    }

    if (!questionText) return;

    const answer = answerFor(questionText);
    if (fillField(field, answer)) filled++;
  });

  return { filled };
}

function collectAiFormContext() {
  const FIELD_ATTR = "data-job-autofill-ai-id";
  const TEXT_CONTROL_SEL = "input, textarea, select, [contenteditable='true'], [role='textbox']";
  const blockedTypes = new Set(["hidden", "password", "checkbox", "radio", "file", "submit", "button", "reset", "image"]);

  function normalize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/\u00a0/g, " ")
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0 &&
      !el.disabled;
  }

  function isFillable(el) {
    const tag = el.tagName.toLowerCase();
    const editable = el.isContentEditable || el.getAttribute("role") === "textbox";
    if (!["input", "textarea", "select"].includes(tag) && !editable) return false;
    const type = normalize(el.getAttribute("type"));
    if (blockedTypes.has(type)) return false;
    return isVisible(el);
  }

  function controlValue(el) {
    if (el.tagName.toLowerCase() === "select") return el.value;
    if ("value" in el) return el.value;
    return el.innerText || el.textContent || "";
  }

  function shortText(text, limit) {
    return (text || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function nearestFieldBlock(input) {
    function countControls(el) {
      return el.querySelectorAll(TEXT_CONTROL_SEL).length;
    }

    function usefulQuestionText(el) {
      var text = shortText(el.innerText || el.textContent || "", 900);
      return text && countControls(el) <= 2 && text.length <= 900;
    }

    const selectors = [
      "label",
      '[data-testid*="질문"]',
      '[class*="question"]',
      '[class*="Question"]',
      '[class*="answer"]',
      '[class*="Answer"]',
      '[class*="ApplicationFormInput__Layout"]',
      '[class*="ApplicationInputLayout__Layout"]',
      '[class*="field-form"]',
      '[class*="form-field"]',
      '[class*="form-group"]',
      '[class*="input-group"]',
      '[class*="field-wrap"]',
      '[class*="field-row"]',
      "dl",
      "fieldset"
    ];

    for (const selector of selectors) {
      const block = input.closest(selector);
      if (block && usefulQuestionText(block)) return block;
    }

    let node = input.parentElement;
    let fallback = null;
    while (node && node !== document.body) {
      const controls = node.querySelectorAll(TEXT_CONTROL_SEL);
      const text = shortText(node.innerText || node.textContent || "", 350);
      if (controls.length <= 2 && text.length > 0) return node;
      if (!fallback && controls.length <= 4 && text.length > 0 && text.length <= 900) fallback = node;
      node = node.parentElement;
    }

    return fallback || input.parentElement || input;
  }

  function pushHint(hints, seen, text, source) {
    const clean = shortText(text, 220);
    const norm = normalize(clean);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    hints.push({ source, text: clean });
  }

  function extractHints(block, input) {
    const hints = [];
    const seen = new Set();

    if (input.labels) {
      Array.from(input.labels).forEach(label => pushHint(hints, seen, label.innerText || label.textContent, "native-label"));
    }

    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) pushHint(hints, seen, label.innerText || label.textContent, "for-label");
    }

    pushHint(hints, seen, input.getAttribute("aria-label"), "aria-label");
    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach(id => {
        const ref = document.getElementById(id);
        if (ref) pushHint(hints, seen, ref.innerText || ref.textContent, "aria-labelledby");
      });
    }

    pushHint(hints, seen, input.getAttribute("placeholder"), "placeholder");
    pushHint(hints, seen, input.getAttribute("name"), "name");
    pushHint(hints, seen, input.id, "id");

    block.querySelectorAll('label, legend, [role="label"], [contenteditable="false"]').forEach(el => {
      pushHint(hints, seen, el.innerText || el.textContent, "block-label");
    });

    let node = input;
    for (let depth = 0; node && node !== block && depth < 5; depth++, node = node.parentElement) {
      const parent = node.parentElement;
      if (!parent) continue;
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(node);
      for (let i = index - 1; i >= 0; i--) {
        pushHint(hints, seen, siblings[i].innerText || siblings[i].textContent, "previous-sibling");
      }
    }

    var nearbyText = [];
    var scan = input;
    for (var up = 0; scan && scan !== document.body && up < 8; up++, scan = scan.parentElement) {
      var prev = scan.previousElementSibling;
      var guard = 0;
      while (prev && guard < 5) {
        var text = (prev.innerText || prev.textContent || "").trim();
        if (text && text.length <= 700) nearbyText.unshift(text);
        prev = prev.previousElementSibling;
        guard++;
      }
      if (nearbyText.length) break;
    }
    pushHint(hints, seen, nearbyText.join(" "), "nearby-question");

    var rect = input.getBoundingClientRect();
    var fieldTop = rect.top + window.scrollY;
    var fieldLeft = rect.left + window.scrollX;
    var fieldRight = fieldLeft + rect.width;
    Array.from(document.querySelectorAll("label, legend, h1, h2, h3, h4, p, span, div"))
      .filter(function(candidate) { return candidate !== input && !candidate.contains(input) && isVisible(candidate); })
      .map(function(candidate) {
        var candidateRect = candidate.getBoundingClientRect();
        var top = candidateRect.top + window.scrollY;
        var left = candidateRect.left + window.scrollX;
        var right = left + candidateRect.width;
        return {
          text: shortText(candidate.innerText || candidate.textContent || "", 700),
          top: top,
          left: left,
          right: right
        };
      })
      .filter(function(item) {
        if (!item.text || item.text.length > 700) return false;
        if (item.top >= fieldTop || fieldTop - item.top > 420) return false;
        var horizontallyNear = item.right >= fieldLeft - 80 && item.left <= fieldRight + 80;
        var looksQuestionLike = /[?？]|필수|선택|질문|답변|지원|동기|소개|경험|역량|기여|강점|약점|포부|프로젝트|이유|왜|어떻게|무엇|어떤|question|answer|essay|motivation|describe|tell us|why|how|what/i.test(item.text);
        return horizontallyNear && looksQuestionLike;
      })
      .sort(function(a, b) { return b.top - a.top; })
      .slice(0, 5)
      .reverse()
      .forEach(function(item) {
        pushHint(hints, seen, item.text, "nearby-visible-question");
      });

    pushHint(hints, seen, block.innerText || block.textContent, "field-block");
    return hints.slice(0, 10);
  }

  function cleanHtml(block, input) {
    const source = block || input;
    const clone = source.cloneNode(true);
    clone.querySelectorAll("script, style, svg, img").forEach(el => el.remove());
    clone.querySelectorAll(TEXT_CONTROL_SEL).forEach(el => {
      el.removeAttribute("value");
      el.removeAttribute(FIELD_ATTR);
      if (el.tagName.toLowerCase() === "textarea") el.textContent = "";
      if (el.isContentEditable || el.getAttribute("role") === "textbox") el.textContent = "";
    });
    return clone.outerHTML.replace(/\s+/g, " ").slice(0, 1600);
  }

  function optionTexts(select) {
    if (select.tagName.toLowerCase() !== "select") return [];
    return Array.from(select.options)
      .map(option => shortText(option.textContent || option.value, 120))
      .filter(Boolean)
      .slice(0, 80);
  }

  function isLikelyLongAnswer(input, hints) {
    const tag = input.tagName.toLowerCase();
    const maxLength = Number(input.getAttribute("maxlength") || 0);
    const joined = normalize(hints.map(h => h.text).join(" "));
    return tag === "textarea" ||
      input.isContentEditable ||
      input.getAttribute("role") === "textbox" ||
      maxLength > 180 ||
      /자기소개|지원동기|성장|경험|역량|강점|약점|입사 후|포부|프로젝트|문제 해결|협업|도전|why|cover letter|motivation|essay|describe|tell us/.test(joined);
  }

  function bestQuestionText(hints) {
    var preferredSources = [
      "nearby-visible-question",
      "nearby-question",
      "native-label",
      "for-label",
      "aria-label",
      "aria-labelledby",
      "block-label",
      "previous-sibling",
      "placeholder"
    ];

    for (var i = 0; i < preferredSources.length; i++) {
      var source = preferredSources[i];
      var hint = hints.find(function(item) {
        return item.source === source &&
          /[?？]|알려주세요|작성해|기재해|설명해|소개해|지원|동기|기여|경험|역량|강점|포부|프로젝트|이유|왜|어떻게|무엇|어떤|question|answer|essay|motivation|describe|tell us|why|how|what/i.test(item.text);
      });
      if (hint) return hint.text;
    }

    return "";
  }

  const fields = [];
  const controls = Array.from(document.querySelectorAll(TEXT_CONTROL_SEL))
    .filter((control, index, arr) => !arr.some(other => other !== control && other.contains(control) && (other.isContentEditable || other.getAttribute("role") === "textbox")));

  controls.forEach((input, index) => {
    if (!isFillable(input)) return;
    if (controlValue(input) && String(controlValue(input)).trim() !== "") return;

    const id = `ai-${Date.now()}-${index}`;
    input.setAttribute(FIELD_ATTR, id);

    const block = nearestFieldBlock(input);
    const hints = extractHints(block, input);
    const rect = input.getBoundingClientRect();
    const questionText = bestQuestionText(hints);

    fields.push({
      id,
      tag: input.tagName.toLowerCase(),
      type: normalize(input.getAttribute("type") || ""),
      name: input.getAttribute("name") || "",
      role: input.getAttribute("role") || "",
      contentEditable: Boolean(input.isContentEditable),
      autocomplete: input.getAttribute("autocomplete") || "",
      required: Boolean(input.required || input.getAttribute("aria-required") === "true"),
      maxLength: Number(input.getAttribute("maxlength") || 0),
      options: optionTexts(input),
      hints,
      isLongAnswer: isLikelyLongAnswer(input, hints),
      questionText,
      html: cleanHtml(block, input),
      position: {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX)
      }
    });
  });

  const headings = Array.from(document.querySelectorAll("h1, h2, h3, legend"))
    .map(el => shortText(el.innerText || el.textContent || "", 120))
    .filter(Boolean)
    .slice(0, 12);

  return {
    url: location.href,
    title: document.title,
    language: document.documentElement.lang || navigator.language || "ko",
    headings,
    fields: fields.slice(0, 80)
  };
}

function applyAiFills(fills) {
  const FIELD_ATTR = "data-job-autofill-ai-id";

  function normalize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/\u00a0/g, " ")
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function fillSelect(el, value) {
    const target = normalize(value);
    let fallback = null;
    for (const opt of el.options) {
      const text = normalize(opt.textContent);
      const optValue = normalize(opt.value);
      if (text === target || optValue === target) {
        el.value = opt.value;
        return true;
      }
      if (!fallback && target && (text.includes(target) || target.includes(text))) fallback = opt;
    }
    if (fallback) {
      el.value = fallback.value;
      return true;
    }
    return false;
  }

  function fillElement(el, value) {
    if (!el || value == null || value === "") return false;
    const tag = el.tagName.toLowerCase();
    const editable = el.isContentEditable || el.getAttribute("role") === "textbox";
    const currentValue = "value" in el ? el.value : (el.innerText || el.textContent || "");
    if (currentValue && String(currentValue).trim() !== "") return false;

    let finalValue = String(value).trim();
    const maxLength = Number(el.getAttribute("maxlength") || 0);
    if (maxLength > 0 && finalValue.length > maxLength) {
      finalValue = finalValue.slice(0, maxLength);
    }

    if (tag === "select") {
      if (!fillSelect(el, finalValue)) return false;
    } else if (editable) {
      el.focus();
      el.textContent = finalValue;
    } else {
      setNativeValue(el, finalValue);
    }

    try {
      el.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: finalValue
      }));
    } catch (_) {}
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.style.outline = "2px solid #1f9d7a";
    el.title = "[Job Autofill AI] AI가 입력했습니다. 제출 전 확인하세요.";
    return true;
  }

  let filled = 0;
  for (const item of fills) {
    const el = document.querySelector(`[${FIELD_ATTR}="${CSS.escape(item.id)}"]`);
    if (fillElement(el, item.value)) filled++;
  }
  return { filled };
}

async function runFileUploadAutofill(tabId, stored) {
  const hasFiles = stored.resumeFile || stored.portfolioFile;
  if (!hasFiles) return 0;

  const [{ result: existingResult }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fillExistingFileInputs,
    args: [{
      resumeFile: stored.resumeFile || null,
      portfolioFile: stored.portfolioFile || null
    }]
  });
  const existingFilled = existingResult && existingResult.filled ? existingResult.filled : 0;
  const stackedHiddenUploaderHandled = existingResult && existingResult.stackedHiddenUploaderHandled;
  if (stackedHiddenUploaderHandled && existingFilled >= 2) return existingFilled;

  const [{ result: targets }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const LAYOUT_SEL = '[class*="FileUploadInput__Layout"],[class*="FileUpload__Layout"]';
      const INPUT_BTN_SEL = '[class*="FileUploadInput__InputButton"],[class*="FileUpload__InputButton"]';

      function normalize(text) {
        return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
      }

      function isVisible(el) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !el.disabled;
      }

      function uploadKeyFromText(text) {
        const t = normalize(text);
        if (!/(이력서|자소서|자기소개서|포트폴리오|첨부|파일|업로드|resume|cv|cover letter|portfolio|attachment|upload|file)/.test(t)) {
          return null;
        }
        if (/(포트폴리오|portfolio|작품|작업물)/.test(t)) return "portfolioFile";
        return "resumeFile";
      }

      function surroundingText(el) {
        const pieces = [el.innerText || el.textContent || "", el.getAttribute("aria-label") || "", el.getAttribute("title") || ""];
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          labelledBy.split(/\s+/).forEach(id => {
            const ref = document.getElementById(id);
            if (ref) pieces.push(ref.innerText || ref.textContent || "");
          });
        }
        const block = el.closest("label, fieldset, dl, [class*='upload'], [class*='Upload'], [class*='file'], [class*='File'], [class*='attachment'], [class*='Attachment'], [class*='form-field'], [class*='field-form'], [class*='form-group']");
        if (block) pieces.push(block.innerText || block.textContent || "");
        return pieces.join(" ").slice(0, 500);
      }

      const allLayouts = [...document.querySelectorAll(LAYOUT_SEL)];
      console.log("[Job Autofill] upload layouts detected:", allLayouts.length, allLayouts);

      const seen = new Set();
      const results = [];

      function addTarget(btn, key) {
        if (!btn || seen.has(btn) || !isVisible(btn)) return;
        if (btn.closest("[data-autofill-btn-id]")) return;
        seen.add(btn);
        const btnId = Math.random().toString(36).slice(2);
        btn.setAttribute("data-autofill-btn-id", btnId);
        results.push({ btnId, key });
        console.log("[Job Autofill] upload target ->", key, btn);
      }

      for (const layout of allLayouts) {
        const rect = layout.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (layout.parentElement && layout.parentElement.closest(LAYOUT_SEL)) continue;
        if (seen.has(layout)) continue;

        const btn = layout.querySelector(INPUT_BTN_SEL) || layout;
        const key = uploadKeyFromText(layout.innerText || "") || "resumeFile";
        addTarget(btn, key);
      }

      const clickableSelector = [
        "button",
        "label",
        "a",
        "[role='button']",
        "[tabindex]",
        "[class*='upload']",
        "[class*='Upload']",
        "[class*='file']",
        "[class*='File']",
        "[class*='attachment']",
        "[class*='Attachment']"
      ].join(",");

      for (const el of document.querySelectorAll(clickableSelector)) {
        if (results.length >= 8) break;
        if (el.closest("input[type='file']")) continue;
        const text = surroundingText(el);
        const key = uploadKeyFromText(text);
        if (!key) continue;

        const btn = el.closest("button, label, a, [role='button']") || el;
        if (btn.querySelector("input[type='file']")) continue;
        addTarget(btn, key);
      }

      return results;
    }
  });

  console.log("[Job Autofill popup] upload targets:", targets);

  let uploaded = existingFilled;
  for (const { btnId, key } of (targets || [])) {
    const fileData = stored[key];
    if (!fileData || !fileData.data) continue;

    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (bid, fd) => {
        const btn = document.querySelector('[data-autofill-btn-id="' + bid + '"]');
        if (!btn) { console.warn("[Job Autofill] button not found:", bid); return; }
        btn.removeAttribute("data-autofill-btn-id");

        let done = false;
        const origClick = HTMLInputElement.prototype.click;

        function doInject(input) {
          if (done) return;
          done = true;
          HTMLInputElement.prototype.click = origClick;
          try { mo.disconnect(); } catch (_) {}
          try { clearTimeout(timer); } catch (_) {}
          try {
            const raw = atob(fd.data.split(",")[1]);
            const buf = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
            const file = new File([buf], fd.name, { type: fd.type });
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("input", { bubbles: true }));
            console.log("[Job Autofill] file injected:", fd.name);
          } catch (e) {
            console.warn("[Job Autofill] inject error:", e);
          }
        }

        HTMLInputElement.prototype.click = function () {
          if (this.type === "file") { doInject(this); return; }
          return origClick.call(this);
        };

        const mo = new MutationObserver(mutations => {
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.nodeType !== 1) continue;
              const inputs = node.type === "file"
                ? [node]
                : [...node.querySelectorAll("input[type='file']")];
              if (!inputs.length) continue;
              inputs[0].click = () => {};
              doInject(inputs[0]);
              return;
            }
          }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });

        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            HTMLInputElement.prototype.click = origClick;
            mo.disconnect();
            console.warn("[Job Autofill] upload timeout - no file input created for:", fd.name);
          }
        }, 3000);

        btn.click();
      },
      args: [btnId, { name: fileData.name, type: fileData.type, data: fileData.data }]
    });

    uploaded++;
    await new Promise(resolve => setTimeout(resolve, 700));
  }

  return uploaded;
}

function fillExistingFileInputs(files) {
  const diagnostics = [];
  window.__jobAutofillUploadDiagnostics = diagnostics;

  function record(item) {
    diagnostics.push(Object.assign({ time: new Date().toISOString() }, item));
  }

  function normalize(text) {
    return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function buildFile(fd) {
    const raw = atob(fd.data.split(",")[1]);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return new File([buf], fd.name, { type: fd.type });
  }

  function setInputFiles(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);

    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
      if (descriptor && descriptor.set) descriptor.set.call(input, dt.files);
      else input.files = dt.files;
    } catch (_) {
      Object.defineProperty(input, "files", {
        configurable: true,
        get: function () { return dt.files; }
      });
    }
  }

  function dispatchFileDrop(target, file) {
    if (!target) return false;

    const dt = new DataTransfer();
    dt.items.add(file);

    ["dragenter", "dragover", "drop"].forEach(type => {
      let event;
      try {
        event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: dt
        });
      } catch (_) {
        event = new Event(type, {
          bubbles: true,
          cancelable: true,
          composed: true
        });
        Object.defineProperty(event, "dataTransfer", {
          configurable: true,
          get: function () { return dt; }
        });
      }
      target.dispatchEvent(event);
    });
    return true;
  }

  function visibleUploaderForIndex(index) {
    const containers = Array.from(document.querySelectorAll('[class*="file-uploader__Container"], [class*="FileUploader"]'));
    const visible = containers.filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return visible[index] || null;
  }

  function textForInput(input) {
    const pieces = [
      input.getAttribute("name") || "",
      input.id || "",
      input.getAttribute("accept") || "",
      input.getAttribute("aria-label") || ""
    ];

    if (input.labels) {
      Array.from(input.labels).forEach(label => pieces.push(label.innerText || label.textContent || ""));
    }

    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) pieces.push(label.innerText || label.textContent || "");
    }

    const block = input.closest("label, fieldset, dl, [class*='upload'], [class*='Upload'], [class*='file'], [class*='File'], [class*='attachment'], [class*='Attachment'], [class*='form-field'], [class*='field-form'], [class*='form-group']");
    if (block) pieces.push(block.innerText || block.textContent || "");
    return normalize(pieces.join(" "));
  }

  function detectKey(input, index, inputs) {
    const text = textForInput(input);
    if (/(포트폴리오|portfolio|작품|작업물)/.test(text)) return "portfolioFile";
    if (/(이력서|자소서|자기소개서|resume|cv|cover letter|curriculum vitae)/.test(text)) return "resumeFile";

    const className = String(input.className || "");
    const looksLikeStackedHiddenUploader = inputs.length >= 3 &&
      (/HiddenInput|hidden.*input|file-uploader/i.test(className) ||
       (input.getBoundingClientRect().width === 0 && input.getBoundingClientRect().height === 0));
    if (looksLikeStackedHiddenUploader) {
      if (index === 0) return "resumeFile";
      if (index === 1) return "portfolioFile";
      return null;
    }

    if (index > 0 && files.portfolioFile) return "portfolioFile";
    return "resumeFile";
  }

  function fireFileEvents(input) {
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
  }

  function fillOneInput(input, index, inputs, source) {
    const key = detectKey(input, index, inputs);
    if (!key) {
      record({ index, source, skipped: true, reason: "no file key" });
      return false;
    }

    const fd = files[key];
    if (!fd || !fd.data) {
      record({ index, source, key, skipped: true, reason: "file not saved" });
      return false;
    }

    try {
      const file = buildFile(fd);
      setInputFiles(input, file);
      fireFileEvents(input);
      const dropped = dispatchFileDrop(visibleUploaderForIndex(index), file);
      input.setAttribute("data-job-autofill-file-key", key);
      input.setAttribute("data-job-autofill-file-name", fd.name || "");
      record({
        index,
        source,
        key,
        name: fd.name || "",
        size: fd.size || file.size || 0,
        afterCount: input.files ? input.files.length : -1,
        dropped
      });
      console.log("[Job Autofill] existing file input filled:", key, fd.name, input);
      return input.files && input.files.length > 0;
    } catch (error) {
      record({ index, source, key, error: String(error && error.message ? error.message : error) });
      console.warn("[Job Autofill] existing file input fill error:", error, input);
      return false;
    }
  }

  let filled = 0;
  const inputs = Array.from(document.querySelectorAll("input[type='file']"));
  const stackedHiddenInputs = inputs.filter(input => {
    const className = String(input.className || "");
    return /HiddenInput|hidden.*input|file-uploader/i.test(className) ||
      (input.getBoundingClientRect().width === 0 && input.getBoundingClientRect().height === 0);
  });
  const stackedHiddenUploaderHandled = stackedHiddenInputs.length >= 3 && files.resumeFile && files.portfolioFile;
  const directInputs = stackedHiddenUploaderHandled ? stackedHiddenInputs.slice(0, 2) : inputs;
  directInputs.forEach((input, index) => {
    if (input.disabled) {
      record({ index, source: "direct", skipped: true, reason: "disabled" });
      return;
    }
    if (fillOneInput(input, index, stackedHiddenUploaderHandled ? stackedHiddenInputs : inputs, "direct")) filled++;
  });

  const stackedDropzones = Array.from(document.querySelectorAll('[class*="file-uploader__Container"], [class*="FileUploader"], [class*="upload"], [class*="Upload"]'))
    .filter(zone => {
      const rect = zone.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  if (!filled && stackedHiddenInputs.length >= 2 && stackedDropzones.length >= 2) {
    stackedDropzones.slice(0, 2).forEach((zone, index) => {
      const input = stackedHiddenInputs[index];
      const originalClick = input && input.click ? input.click.bind(input) : null;
      if (!input) return;

      input.click = function () {
        fillOneInput(input, index, stackedHiddenInputs, "hidden-uploader-click-intercept");
        fireFileEvents(input);
      };

      zone.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
      zone.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
      zone.click();

      if (originalClick) input.click = originalClick;
      if (input.files && input.files.length > 0 && !input.getAttribute("data-job-autofill-click-counted")) {
        input.setAttribute("data-job-autofill-click-counted", "1");
      }
    });
  }

  const finalFilled = inputs.filter(input => input.files && input.files.length > 0 && input.getAttribute("data-job-autofill-file-key")).length;
  record({ summary: true, inputCount: inputs.length, finalFilled, stackedHiddenUploaderHandled });

  return { filled: Math.max(filled, finalFilled), diagnostics, stackedHiddenUploaderHandled };
}
