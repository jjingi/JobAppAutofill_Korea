# Job Application Autofill Korea

A Chrome extension for Korean job applications. It stores a structured applicant profile, reads job application pages with AI, fills matching fields, drafts Korean long-form answers, and uploads saved resume or portfolio files when the page supports file inputs.

## Features

- AI-assisted form matching for Korean and English job application fields
- Korean long-answer drafting based on saved profile, resume, and portfolio context
- Step-by-step profile setup:
  - Basic information
  - Education
  - Experience
  - Projects
  - Additional information such as military, veteran, disability, and recommender fields
  - Resume and portfolio files
- Structured repeated entries for education, work experience, and projects
- Resume and portfolio parsing into reusable profile context
- File upload support for hidden and visible upload inputs
- Korean user-facing status and error messages
- Chrome extension icon set included

## Project Structure

```text
job-autofill-extension/
  manifest.json
  autofill-popup.html
  autofill-popup.js
  profile-settings.html
  profile-settings.js
  icons/
```

## Local Development

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `job-autofill-extension` folder.
5. Open the extension options page and enter your profile information.
6. Refresh the extension after code changes.

## Setup

1. Open the extension options page.
2. Fill each profile step:
   - Basic information
   - Education
   - Experience
   - Projects
   - Additional information
   - Files and AI settings
3. Save your OpenAI API key if you want AI-based field matching and long-answer generation.
4. Upload your resume and portfolio files if you want the extension to reuse them for file upload fields.

## Usage

1. Open a job application page.
2. Click the extension icon.
3. Click **현재 페이지 자동완성**.
4. Review every field before submitting.

The extension is designed to help prepare applications, not submit them automatically. Always confirm generated answers and uploaded files before final submission.

## Privacy And Security

This extension stores profile data, OpenAI API key, resume file, and portfolio file in Chrome extension local storage.

When AI is enabled, the extension sends the current page form context and saved profile information to the OpenAI API to decide what to fill and to generate Korean answers. Do not enable AI or upload files unless you are comfortable sending that information to the configured API provider.

Sensitive fields such as disability, veteran status, military status, eligibility, and legal attestations should only be filled when the user explicitly saves those values in the profile. The extension should not infer them from unrelated information.

## Build A Chrome Web Store Zip

From the project root:

```sh
cd job-autofill-extension
zip -r ../job-autofill-extension-webstore.zip . -x '*.DS_Store'
```

Upload `job-autofill-extension-webstore.zip` to the Chrome Web Store Developer Dashboard.

## Validation

Run syntax checks before packaging:

```sh
node --check job-autofill-extension/autofill-popup.js
node --check job-autofill-extension/profile-settings.js
node -e "JSON.parse(require('fs').readFileSync('job-autofill-extension/manifest.json', 'utf8')); console.log('manifest ok')"
```

## Notes

- This project currently uses Manifest V3.
- AI behavior depends on the saved profile quality and the structure of the target application page.
- Some sites use custom upload widgets or multi-step forms; always test and review results manually.
