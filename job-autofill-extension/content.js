// ─── content.js ──────────────────────────────────────────────────────────────
// Entry point. DOM utilities + main autofill loop.
// Load order enforced by popup.js: autofill-rules.js → autofill-detect.js → content.js

(async () => {
  const stored = await chrome.storage.local.get(["profile", "resumeFile", "portfolioFile"]);
  const profile       = stored.profile       || {};
  const resumeFile    = stored.resumeFile    || null;
  const portfolioFile = stored.portfolioFile || null;
  const fileStore     = { resumeFile, portfolioFile };

  if (Object.keys(profile).length === 0 && !resumeFile && !portfolioFile) {
    alert("먼저 확장 프로그램 옵션 페이지에서 프로필을 저장하세요.");
    return;
  }

  // ─── Score thresholds ─────────────────────────────────────────────────────
  const SCORE_FILL      = 50;  // fill automatically
  const SCORE_HIGHLIGHT = 20;  // show yellow border, skip auto-fill

  // ─── DOM helpers ──────────────────────────────────────────────────────────
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    const rect  = el.getBoundingClientRect();
    return (
      style.display     !== "none"   &&
      style.visibility  !== "hidden" &&
      rect.width  > 0 &&
      rect.height > 0 &&
      !el.disabled
    );
  }

  function isFillable(el) {
    if (!isVisible(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (!["input", "textarea", "select"].includes(tag)) return false;
    const type    = normalize(el.getAttribute("type"));
    const blocked = ["hidden","password","checkbox","radio","file","submit","button","reset"];
    if (blocked.includes(type)) return false;
    return true;
  }

  function setNativeValue(el, value) {
    const proto      = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function fillElement(el, value) {
    if (value == null || value === "") return false;

    try {
      if (el.tagName.toLowerCase() === "select") {
        const target = normalize(String(value));
        for (const opt of el.options) {
          if (normalize(opt.textContent) === target || normalize(opt.value) === target) {
            el.value = opt.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }

      setNativeValue(el, String(value));
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur",   { bubbles: true }));
      return true;
    } catch (err) {
      console.warn("[Job Autofill] fill error", err, el);
      return false;
    }
  }

  function highlightUncertain(el) {
    el.style.outline = "2px solid #f5a623";
    el.title = "[Job Autofill] 필드를 인식하지 못했습니다. 직접 입력해 주세요.";
  }

  // ─── File input helper ────────────────────────────────────────────────────
  // Converts stored base64 back to a File and injects it via DataTransfer API.
  function fillFileInput(el, fileData) {
    if (!fileData || !fileData.data) return false;
    try {
      const base64 = fileData.data.split(",")[1];
      const binary  = atob(base64);
      const bytes   = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const file = new File([bytes], fileData.name, { type: fileData.type });
      const dt   = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      return true;
    } catch (err) {
      console.warn("[Job Autofill] file fill error", err, el);
      return false;
    }
  }

  // ─── Main loop ────────────────────────────────────────────────────────────
  const elements        = [...document.querySelectorAll("input, textarea, select")];
  let   filledCount     = 0;
  let   highlightedCount = 0;

  for (const el of elements) {
    // ── file inputs ──
    if (normalize(el.getAttribute("type")) === "file") {
      if (!isVisible(el) || el.disabled) continue;
      const fileKey = detectFileField(el);
      if (fileKey && fileStore[fileKey]) {
        const ok = fillFileInput(el, fileStore[fileKey]);
        if (ok) {
          filledCount++;
          console.log(`[Job Autofill] file → ${fileKey}`, el);
        }
      }
      continue;
    }

    // ── text / select / textarea ──
    if (!isFillable(el)) continue;
    if (el.value && String(el.value).trim() !== "") continue;

    // scoreField() is defined in autofill-detect.js
    const { key, score, block } = scoreField(el);

    console.log(
      `[Job Autofill] <${el.tagName.toLowerCase()}> key=${key ?? "—"} score=${score.toFixed(1)}`,
      { el, block }
    );

    if (score >= SCORE_FILL && key && profile[key]) {
      const ok = fillElement(el, profile[key]);
      if (ok) filledCount++;
    } else if (score >= SCORE_HIGHLIGHT) {
      highlightUncertain(el);
      highlightedCount++;
    }
  }

  const parts = [`자동완성 완료: ${filledCount}개 필드 입력`];
  if (highlightedCount > 0) {
    parts.push(`⚠ ${highlightedCount}개 필드 인식 불확실 → 노란 테두리 확인`);
  }

  console.log(`[Job Autofill] filled=${filledCount} highlighted=${highlightedCount}`);
  alert(parts.join("\n"));
})();
