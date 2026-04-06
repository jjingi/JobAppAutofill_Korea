// ─── autofill-detect.js ──────────────────────────────────────────────────────
// Field detection logic.
// Depends on: autofill-rules.js (RULES, AUTOCOMPLETE_MAP, PLACEHOLDER_PATTERNS,
//             ATS_FIELD_SELECTORS) and normalize() / isGenericPlaceholder()
//             defined in content.js — load order: rules → detect → content.

// ── 1. Find the nearest field-block wrapper ───────────────────────────────────
// Strategy A: known ATS class selectors (high confidence, site-specific)
// Strategy B: generic fallback — climb up looking for a block that wraps
//             exactly one form control and has a short visible text.
function findFieldBlock(input) {
  // A — try known ATS wrappers
  for (var i = 0; i < ATS_FIELD_SELECTORS.length; i++) {
    var el = input.closest(ATS_FIELD_SELECTORS[i]);
    if (el) return el;
  }

  // B — generic fallback
  var node = input.parentElement;
  while (node && node !== document.body) {
    var controls = node.querySelectorAll("input, textarea, select");
    var text = (node.innerText || node.textContent || "").trim();
    // single control + has text + not a huge container
    if (controls.length === 1 && text.length > 0 && text.length <= 300) {
      return node;
    }
    node = node.parentElement;
  }

  return input.parentElement || input;
}

// ── 2. Extract label hints from the field block ───────────────────────────────
// Returns [{ text, weight }] deduped.
// Sources in order of reliability:
//   1.0  explicit labels, aria-label, aria-labelledby, contenteditable=false divs
//   0.8  name attr, placeholder (meaningful)
//   0.6  id attr
//   0.7↓ previous siblings inside block (weight decreases with DOM depth)
//   0.4  full block text (lowest — too noisy otherwise)
function extractBlockText(block, input) {
  var hints = [];
  var seen  = {};

  function push(text, weight) {
    var t = normalize(text);
    if (!t || t.length > 200 || seen[t]) return;
    seen[t] = true;
    hints.push({ text: t, weight: weight });
  }

  // contenteditable=false divs → Ninehire / similar React ATS label pattern
  var ceEls = block.querySelectorAll('[contenteditable="false"]');
  ceEls.forEach(function(ce) { push(ce.innerText || ce.textContent, 1.0); });

  // standard label / role="label"
  var labelEls = block.querySelectorAll('label, [role="label"]');
  labelEls.forEach(function(l) { push(l.innerText || l.textContent, 1.0); });

  // input.labels (native association via for= or wrapping)
  if (input.labels) {
    Array.prototype.forEach.call(input.labels, function(l) {
      push(l.innerText || l.textContent, 1.0);
    });
  }

  // aria-label
  push(input.getAttribute("aria-label"), 1.0);

  // aria-labelledby → resolve referenced elements
  var labelledBy = input.getAttribute("aria-labelledby");
  if (labelledBy) {
    labelledBy.split(/\s+/).forEach(function(id) {
      var ref = document.getElementById(id);
      if (ref) push(ref.innerText || ref.textContent, 1.0);
    });
  }

  // name / id / placeholder
  push(input.getAttribute("name"), 0.8);
  var ph = (input.getAttribute("placeholder") || "").trim();
  if (!isGenericPlaceholder(ph)) push(ph, 0.8);
  push(input.id, 0.6);

  // climb from input up to (but not past) the block, reading previous siblings
  var node = input;
  for (var depth = 0; node && node !== block && depth < 6; depth++, node = node.parentElement) {
    var parent = node.parentElement;
    if (!parent) continue;
    var siblings = Array.prototype.slice.call(parent.children);
    var idx = siblings.indexOf(node);
    for (var i = idx - 1; i >= 0; i--) {
      var t = (siblings[i].innerText || siblings[i].textContent || "").trim();
      if (t && !isGenericPlaceholder(t) && t.length <= 120) {
        push(t, Math.max(0.1, 0.7 - depth * 0.08));
      }
    }
  }

  // entire block text at lowest weight (catch-all)
  var blockText = (block.innerText || block.textContent || "").trim();
  if (blockText && blockText.length <= 200) push(blockText, 0.4);

  return hints;
}

// ── 3. Score a single input element ──────────────────────────────────────────
// Returns { key: string|null, score: number }
// Tiers (highest → lowest confidence):
//   T1  autocomplete attribute            +100
//   T2  input type (email/tel)            +80
//   T3  name / id exact key match         +80 / +60
//   T4  placeholder pattern match         +40…+80
//   T5  keyword matching vs block hints   pts × source weight
function scoreField(input) {
  var type         = normalize(input.getAttribute("type"));
  var autocomplete = normalize(input.getAttribute("autocomplete"));
  var placeholder  = normalize(input.getAttribute("placeholder") || "");
  var scores       = {};

  function add(key, pts) {
    scores[key] = (scores[key] || 0) + pts;
  }

  // T1 — autocomplete
  if (autocomplete) {
    autocomplete.split(/\s+/).forEach(function(token) {
      var key = AUTOCOMPLETE_MAP[token];
      if (key) add(key, 100);
    });
  }

  // T2 — input type
  if (type === "email") add("email",  80);
  if (type === "tel")   add("phone",  80);
  if (type === "url")   add("portfolio", 20);

  // T3 — name / id exact match against profile field keys
  var nameAttr = normalize(input.getAttribute("name") || "").replace(/[-_\s]/g, "");
  var idAttr   = normalize(input.id || "").replace(/[-_\s]/g, "");
  Object.keys(RULES).forEach(function(key) {
    var keyNorm = key.toLowerCase();
    if (nameAttr === keyNorm) add(key, 80);
    if (idAttr   === keyNorm) add(key, 60);
  });

  // T4 — placeholder patterns (Korean ATS style)
  PLACEHOLDER_PATTERNS.forEach(function(p) {
    var matched = (p.pattern instanceof RegExp)
      ? p.pattern.test(placeholder)
      : placeholder.includes(p.pattern);
    if (matched) add(p.key, p.score);
  });

  // T5 — block-level label text keyword matching
  var block    = findFieldBlock(input);
  var hints    = extractBlockText(block, input);
  var combined = hints.map(function(h) { return h.text; }).join(" | ");

  Object.keys(RULES).forEach(function(key) {
    RULES[key].forEach(function(pair) {
      var kw  = pair[0];
      var pts = pair[1];
      if (combined.includes(normalize(kw))) {
        var hint = hints.find(function(h) { return h.text.includes(normalize(kw)); });
        var w = hint ? hint.weight : 0.5;
        add(key, pts * w);
      }
    });
  });

  // Penalty: fullName should not fire when separate first/last name fields present
  if (combined.includes("first name") || combined.includes("last name") ||
      (combined.includes("성") && combined.includes("이름"))) {
    scores.fullName = (scores.fullName || 0) - 15;
  }

  // Pick winner
  var bestKey   = null;
  var bestScore = 0;
  Object.keys(scores).forEach(function(k) {
    if (scores[k] > bestScore) { bestScore = scores[k]; bestKey = k; }
  });

  return { key: bestKey, score: bestScore, block: block };
}

// ── 4. Detect what kind of file a file-input expects ─────────────────────────
// Returns "resumeFile" | "portfolioFile" | null
function detectFileField(input) {
  const accept = normalize(input.getAttribute("accept") || "");

  // name / id exact shortcut
  const nameAttr = normalize(input.getAttribute("name") || "").replace(/[-_\s]/g, "");
  const idAttr   = normalize(input.id || "").replace(/[-_\s]/g, "");
  if (["resume","cv","resumefile"].includes(nameAttr) ||
      ["resume","cv","resumefile"].includes(idAttr))   return "resumeFile";
  if (["portfolio","portfoliofile"].includes(nameAttr) ||
      ["portfolio","portfoliofile"].includes(idAttr))  return "portfolioFile";

  // keyword scoring from surrounding block text
  const block    = findFieldBlock(input);
  const hints    = extractBlockText(block, input);
  const combined = hints.map(function(h) { return h.text; }).join(" | ");

  var bestKey   = null;
  var bestScore = 0;

  Object.keys(FILE_RULES).forEach(function(key) {
    var score = 0;
    FILE_RULES[key].forEach(function(pair) {
      var kw  = pair[0];
      var pts = pair[1];
      if (combined.includes(normalize(kw))) {
        var hint = hints.find(function(h) { return h.text.includes(normalize(kw)); });
        score += pts * (hint ? hint.weight : 0.5);
      }
    });
    if (score > bestScore) { bestScore = score; bestKey = key; }
  });

  if (bestScore >= 8) return bestKey;

  // fallback: any document-type accept → assume resume
  if (accept && (accept.includes(".pdf") || accept.includes(".doc") ||
                 accept.includes("application/"))) {
    return "resumeFile";
  }

  return null;
}
