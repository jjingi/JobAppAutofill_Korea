// ─── autofill-rules.js ───────────────────────────────────────────────────────
// Shared constants. Loaded before autofill-detect.js and content.js.
// All declarations use var so they are visible across injected scripts.

// autocomplete attribute value → profile field key
var AUTOCOMPLETE_MAP = {
  "given-name":         "firstName",
  "family-name":        "lastName",
  "name":               "fullName",
  "email":              "email",
  "tel":                "phone",
  "tel-national":       "phone",
  "address-level2":     "city",
  "address-level1":     "state",
  "postal-code":        "zip",
  "organization-title": "summary"
};

// keyword rules: { fieldKey: [[keyword, basePoints], ...] }
var RULES = {
  firstName:  [
    ["이름",10],["성명",8],
    ["first name",10],["given name",10],["first_name",8],["firstname",8]
  ],
  lastName:   [
    ["성",10],["성씨",10],
    ["last name",10],["family name",10],["surname",10],["last_name",8],["lastname",8]
  ],
  fullName:   [
    ["이름",10],["성명",12],["본명",10],["지원자명",12],
    ["full name",10],["legal name",10],["your name",8],["applicant name",8]
  ],
  email:      [
    ["이메일",12],["이메일 주소",14],
    ["e-mail",10],["email address",12],["email",8]
  ],
  phone:      [
    ["휴대폰",12],["휴대전화",12],["연락처",10],["전화번호",12],["전화",8],["핸드폰",10],
    ["phone number",12],["mobile number",12],["phone",8],["mobile",8],["telephone",8],["tel",6],["cell",6]
  ],
  city:       [
    ["시",8],["도시",10],["거주 도시",12],["시/군/구",10],
    ["city",8],["town",6]
  ],
  state:      [
    ["도",8],["시/도",10],["거주지",8],["지역",8],
    ["state",8],["province",8],["region",6]
  ],
  zip:        [
    ["우편번호",12],
    ["zip code",10],["postal code",10],["postcode",10],["zip",6],["postal",6]
  ],
  linkedin:   [
    ["링크드인",12],["linkedin",12]
  ],
  github:     [
    ["깃허브",12],["github",12]
  ],
  portfolio:  [
    ["포트폴리오",12],["개인 사이트",10],["홈페이지",10],["블로그",8],["개인/업무 유관 url",14],["url",8],
    ["portfolio",10],["personal site",10],["personal website",10],["homepage",8],["website",6]
  ],
  university: [
    ["대학교",12],["학교",8],["출신학교",12],["최종학력",10],["대학",10],
    ["university",10],["college",8],["school",6],["institution",8]
  ],
  summary:    [
    ["자기소개",12],["자기소개서",14],["지원동기",12],["간략 소개",10],["한 줄 소개",10],
    ["cover letter",12],["about yourself",12],["about you",10],["about me",10],["introduction",8],["summary",8],["bio",6]
  ]
};

// Placeholder patterns that signal a specific field strongly.
// Matched after normalize(). { pattern (string|RegExp), key, score }
var PLACEHOLDER_PATTERNS = [
  { pattern: "example@domain.com",  key: "email",     score: 70 },
  { pattern: /^[\w.+-]+@/,          key: "email",     score: 50 },
  { pattern: "01012345678",          key: "phone",     score: 70 },
  { pattern: /^0\d{8,10}$/,         key: "phone",     score: 50 },
  { pattern: "linkedin.com/in/",    key: "linkedin",  score: 80 },
  { pattern: "github.com/",         key: "github",    score: 80 },
  { pattern: /^https?:\/\//,        key: "portfolio", score: 55 },
];

// ─── Shared text utilities ────────────────────────────────────────────────────
// Declared here (global) so autofill-detect.js can call them as free variables.

var normalize = function (text) {
  return (text || "")
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

var isGenericPlaceholder = function (text) {
  return /^(내용을 입력해 주세요\.?|please enter.*|enter.*here|type here|input here|\.\.\.)$/i
    .test((text || "").trim());
};

// Keyword rules for file upload inputs
var FILE_RULES = {
  resumeFile: [
    ["이력서",14],["자소서",10],["cv",12],["resume",12],["curriculum vitae",12]
  ],
  portfolioFile: [
    ["포트폴리오",14],["portfolio",12],["작품",8],["작업물",8]
  ]
};

// CSS selectors for known ATS field wrappers (checked inside-out via closest())
var ATS_FIELD_SELECTORS = [
  '[class*="ApplicationFormInput__Layout"]',
  '[class*="ApplicationInputLayout__Layout"]',
  '[class*="N_Input__"]',
  '[class*="field-form"]',
  '[class*="form-field"]',
  '[class*="form-group"]',
  '[class*="input-group"]',
  '[class*="field-wrap"]',
  '[class*="field-row"]',
  "dl",
  "fieldset"
];
