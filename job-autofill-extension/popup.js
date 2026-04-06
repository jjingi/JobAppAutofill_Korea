const statusEl = document.getElementById("status");

document.getElementById("openOptions").addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
});

document.getElementById("fillBtn").addEventListener("click", async () => {
  try {
    statusEl.textContent = "현재 페이지를 분석 중...";

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab || !tab.id) {
      statusEl.textContent = "활성 탭을 찾을 수 없습니다.";
      return;
    }

    // Inject in order: rules → detect → main (later scripts can call functions from earlier ones)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["autofill-rules.js", "autofill-detect.js", "content.js"]
    });

    statusEl.textContent = "자동완성 스크립트를 실행했습니다.";
  } catch (error) {
    console.error(error);
    statusEl.textContent = "실행 실패: " + error.message;
  }
});
