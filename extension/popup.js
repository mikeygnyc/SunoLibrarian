// Popup script

// Get translation helper
function getMessage(key) {
  return chrome.i18n.getMessage(key) || key;
}

document.addEventListener("DOMContentLoaded", () => {
  // Update static HTML text with translations (title always in English)
  document.querySelector("h1").textContent = "Suno Tracks Exporter";
  document.getElementById("open-downloader").textContent = getMessage("openDownloader");
  document.getElementById("extract-token").textContent = getMessage("extractToken");
  document.querySelector(".info p strong").textContent = getMessage("instructions");
  const instructions = document.querySelectorAll(".info ol li");
  if (instructions.length >= 4) {
    instructions[0].textContent = getMessage("instruction1");
    instructions[1].textContent = getMessage("instruction2");
    instructions[2].textContent = getMessage("instruction3");
    instructions[3].textContent = getMessage("instruction4");
  }

  const statusDiv = document.getElementById("status");
  const openButton = document.getElementById("open-downloader");

  // Check token status and page
  chrome.runtime.sendMessage({ action: "getToken" }, (tokenResponse) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      const isOnSuno = currentTab.url && currentTab.url.includes("suno.com");

      if (tokenResponse && tokenResponse.success) {
        statusDiv.innerHTML = `
          <div class="status success">
            ✅ ${getMessage("tokenFound")}
          </div>
        `;
        openButton.textContent = getMessage("openDownloader");
      } else if (isOnSuno) {
        statusDiv.innerHTML = `
          <div class="status error">
            ⚠️ ${getMessage("tokenNotFound")}<br>
            ${getMessage("tokenNotFoundInstructions")}
          </div>
        `;
        openButton.textContent = getMessage("openDownloader");
      } else {
        statusDiv.innerHTML = `
          <div class="status error">
            ⚠️ ${getMessage("pleaseVisitSuno")}
          </div>
        `;
        openButton.textContent = getMessage("goToSuno");
      }
    });
  });

  openButton.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab.url && currentTab.url.includes("suno.com")) {
        // Inject content script to show modal
        chrome.tabs.sendMessage(currentTab.id, { action: "showDownloader" });
        window.close();
      } else {
        // Navigate to suno.com
        chrome.tabs.create({ url: "https://suno.com" });
        window.close();
      }
    });
  });

  // Extract token button
  const extractButton = document.getElementById("extract-token");
  extractButton.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab.url && currentTab.url.includes("suno.com")) {
        extractButton.disabled = true;
        extractButton.textContent = getMessage("extracting");

        // Navigate to library page which will trigger API calls
        chrome.tabs.update(currentTab.id, { url: "https://suno.com/?wid=default" }, () => {
          extractButton.textContent = getMessage("waitingForToken");
          statusDiv.innerHTML = `
            <div class="status" style="background: #fff3cd; color: #856404; border: 1px solid #ffeaa7;">
              ⏳ ${getMessage("navigatingToLibrary")}
            </div>
          `;

          // Check for token every second for up to 10 seconds
          let attempts = 0;
          const checkInterval = setInterval(() => {
            attempts++;
            chrome.runtime.sendMessage({ action: "getToken" }, (tokenResponse) => {
              if (tokenResponse && tokenResponse.success) {
                clearInterval(checkInterval);
                extractButton.disabled = false;
                extractButton.textContent = getMessage("extractToken");
                statusDiv.innerHTML = `
                  <div class="status success">
                    ✅ ${getMessage("tokenCaptured")}
                  </div>
                `;
              } else if (attempts >= 10) {
                clearInterval(checkInterval);
                extractButton.disabled = false;
                extractButton.textContent = getMessage("extractToken");
                statusDiv.innerHTML = `
                  <div class="status error">
                    ⚠️ ${getMessage("tokenNotCaptured")}<br>
                    ${getMessage("tokenNotCapturedInstructions").replace(/\n/g, "<br>")}
                  </div>
                `;
              }
            });
          }, 1000);
        });
      } else {
        statusDiv.innerHTML = `
          <div class="status error">
            ⚠️ ${getMessage("pleaseVisitSuno")}
          </div>
        `;
      }
    });
  });
});
