// Content script to inject UI and extract tokens from Suno website

// Get translation helper
function getMessage(key) {
  return chrome.i18n.getMessage(key) || key;
}

function formatMessage(key, replacements = {}) {
  let message = getMessage(key) || key;
  Object.entries(replacements).forEach(([token, value]) => {
    const regex = new RegExp(`\\{${token}\\}`, "g");
    message = message.replace(regex, value);
  });
  return message;
}

// Extract authorization token from network requests
function extractTokenFromRequests() {
  // Method 1: Intercept fetch requests
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = args[0];
    const options = args[1] || {};

    // Check if this is a Suno API request with authorization header
    if (
      typeof url === "string" &&
      url.includes("studio-api.prod.suno.com") &&
      options.headers
    ) {
      const authHeader =
        options.headers.authorization ||
        options.headers.Authorization ||
        (options.headers.get && options.headers.get("authorization"));

      if (authHeader) {
        const token = String(authHeader).replace("Bearer ", "").trim();
        if (token) {
          // Save token to extension storage
          chrome.runtime.sendMessage(
            { action: "saveToken", token: token },
            () => {}
          );
        }
      }
    }

    return originalFetch.apply(this, args);
  };

  // Method 2: Intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._url && this._url.includes("studio-api.prod.suno.com")) {
      const authHeader =
        this.getRequestHeader?.("authorization") ||
        this.getRequestHeader?.("Authorization");
      if (authHeader) {
        const token = String(authHeader).replace("Bearer ", "").trim();
        if (token) {
          chrome.runtime.sendMessage(
            { action: "saveToken", token: token },
            () => {}
          );
        }
      }
    }
    return originalXHRSend.apply(this, args);
  };

  // Method 3 removed to avoid inline script CSP violations
}

// Inject download button into Suno interface - REMOVED per user request
// Users can access via extension popup only
function injectDownloadButton() {
  // Button removed - only accessible via extension popup
  return;
}

// Show download modal
function showDownloadModal() {
  // Remove existing modal if any
  const existing = document.getElementById("suno-download-modal");
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement("div");
  modal.id = "suno-download-modal";
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // Detect dark mode for modal
  const isDarkMode =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const modalBgColor = isDarkMode ? "#1e1e1e" : "white";
  const modalTextColor = isDarkMode ? "#e0e0e0" : "#333";
  const secondaryTextColor = isDarkMode ? "#b0b0b0" : "#666";
  const borderColor = isDarkMode ? "#444" : "#e0e0e0";

  const content = document.createElement("div");
  content.style.cssText = `
    background: ${modalBgColor};
    color: ${modalTextColor};
    border-radius: 12px;
    padding: 24px;
    width: 85vw !important;
    max-width: 85vw !important;
    height: 90vh;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  `;

  content.innerHTML = `
    <div style="flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img src="${chrome.runtime.getURL(
          "icon128.png"
        )}" alt="Suno Tracks Exporter" style="width: 40px; height: 40px; border-radius: 6px;" />
        <h2 style="margin: 0; color: ${modalTextColor};">Suno Tracks Exporter</h2>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <a href="https://www.buymeacoffee.com/VogelCodes" target="_blank" rel="noopener noreferrer" style="display: inline-block; text-decoration: none;">
          <img src="https://img.buymeacoffee.com/button-api/?text=Buy me a pizza&emoji=🍕&slug=VogelCodes&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a pizza" style="height: 40px; width: auto; border: none;" />
        </a>
        <button id="reset-extension-data" title="${
          getMessage("clearAllDataTitle") ||
          "Clear all extension data and reset to fresh install"
        }" style="padding: 6px 12px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">${
    getMessage("errorsResetHere") || "Errors? Reset Here"
  }</button>
        <button id="close-modal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: ${modalTextColor};">&times;</button>
      </div>
    </div>
    <div style="flex-shrink: 0; display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 2px solid ${borderColor};">
      <button id="tab-all-tracks" class="modal-tab active" style="padding: 8px 16px; background: ${
        isDarkMode ? "#2a2a2a" : "#f5f5f5"
      }; color: ${modalTextColor}; border: none; border-bottom: 2px solid ${
    isDarkMode ? "#667eea" : "#667eea"
  }; cursor: pointer; font-size: 14px; font-weight: 600;">${getMessage(
    "tabAllTracks"
  )}</button>
      <button id="tab-custom-download" class="modal-tab" style="padding: 8px 16px; background: transparent; color: ${secondaryTextColor}; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 14px; font-weight: 600;">${getMessage(
    "tabCustomDownload"
  )}</button>
    </div>
    <div id="tab-content-all-tracks" class="tab-content" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0;">
      <div id="download-content" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0;">
        <p>${getMessage("loadingTracks")}</p>
      </div>
    </div>
    <div id="tab-content-custom-download" class="tab-content" style="flex: 1; display: none; flex-direction: column; overflow: hidden; min-height: 0;">
      <div id="custom-download-content" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; padding: 20px;">
        <h3 style="margin: 0 0 16px 0; color: ${modalTextColor};">${getMessage(
    "customDownloadTitle"
  )}</h3>
        <p style="color: ${secondaryTextColor}; font-size: 14px; margin: 0 0 20px 0;">
          ${getMessage("customDownloadDescription")}
        </p>
        <div id="file-drop-zone" style="border: 2px dashed ${
          isDarkMode ? "#555" : "#ccc"
        }; border-radius: 8px; padding: 40px; text-align: center; cursor: pointer; background: ${
    isDarkMode ? "#252525" : "#fafafa"
  }; transition: all 0.3s;">
          <input type="file" id="file-input" accept=".txt" style="display: none;">
          <div style="font-size: 48px; margin-bottom: 16px;">📁</div>
          <p style="margin: 0; color: ${modalTextColor}; font-size: 16px; font-weight: 600;">${getMessage(
    "dropFileHere"
  )}</p>
          <p style="margin: 8px 0 0 0; color: ${secondaryTextColor}; font-size: 12px;">${getMessage(
    "missingTracksFileName"
  )}</p>
        </div>
        <div id="custom-download-status" style="margin-top: 20px; display: none;">
          <p id="custom-download-status-text" style="color: ${modalTextColor}; margin: 0 0 8px 0;"></p>
          <div id="custom-download-progress" style="display: none;">
            <div style="background: ${
              isDarkMode ? "#333" : "#f0f0f0"
            }; border-radius: 4px; height: 24px; overflow: hidden; margin-bottom: 8px;">
              <div id="custom-progress-bar" style="background: #667eea; height: 100%; width: 0%; transition: width 0.3s;"></div>
            </div>
            <button id="stop-custom-download" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: none;">Stop</button>
          </div>
        </div>
      </div>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  // Close button
  document.getElementById("close-modal").addEventListener("click", () => {
    modal.remove();
  });

  // Close on outside click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // Reset extension data button
  const resetBtn = document.getElementById("reset-extension-data");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      const confirmMessage =
        getMessage("confirmClearAllData") ||
        "This will clear ALL extension data including:\n- All cached tracks and workspaces\n- All metadata\n- Download history\n- Authentication token\n\nYou will need to visit suno.com again to re-authenticate.\n\nThis action cannot be undone. Continue?";

      if (confirm(confirmMessage)) {
        resetBtn.disabled = true;
        resetBtn.textContent = "⏳";

        try {
          await clearAllExtensionData();
          alert(
            getMessage("clearAllDataComplete") ||
              "All extension data has been cleared. The page will reload."
          );
          window.location.reload();
        } catch (error) {
          console.error("Error clearing extension data:", error);
          const errorMsg =
            formatMessage("clearAllDataError", { error: error.message }) ||
            `Error clearing data: ${error.message}`;
          alert(errorMsg);
          resetBtn.disabled = false;
          resetBtn.textContent =
            getMessage("errorsResetHere") || "Errors? Reset Here";
        }
      }
    });
  }

  // Tab switching
  const tabAllTracks = document.getElementById("tab-all-tracks");
  const tabCustomDownload = document.getElementById("tab-custom-download");
  const contentAllTracks = document.getElementById("tab-content-all-tracks");
  const contentCustomDownload = document.getElementById(
    "tab-content-custom-download"
  );

  tabAllTracks.addEventListener("click", () => {
    tabAllTracks.classList.add("active");
    tabCustomDownload.classList.remove("active");
    tabAllTracks.style.background = isDarkMode ? "#2a2a2a" : "#f5f5f5";
    tabAllTracks.style.color = modalTextColor;
    tabAllTracks.style.borderBottom = `2px solid ${
      isDarkMode ? "#667eea" : "#667eea"
    }`;
    tabCustomDownload.style.background = "transparent";
    tabCustomDownload.style.color = secondaryTextColor;
    tabCustomDownload.style.borderBottom = "2px solid transparent";
    contentAllTracks.style.display = "flex";
    contentCustomDownload.style.display = "none";
  });

  tabCustomDownload.addEventListener("click", () => {
    tabCustomDownload.classList.add("active");
    tabAllTracks.classList.remove("active");
    tabCustomDownload.style.background = isDarkMode ? "#2a2a2a" : "#f5f5f5";
    tabCustomDownload.style.color = modalTextColor;
    tabCustomDownload.style.borderBottom = `2px solid ${
      isDarkMode ? "#667eea" : "#667eea"
    }`;
    tabAllTracks.style.background = "transparent";
    tabAllTracks.style.color = secondaryTextColor;
    tabAllTracks.style.borderBottom = "2px solid transparent";
    contentCustomDownload.style.display = "flex";
    contentAllTracks.style.display = "none";
  });

  // File drop zone functionality
  setupCustomDownloadTab(
    content,
    isDarkMode,
    modalTextColor,
    secondaryTextColor
  );

  // Load tracks
  loadTracksIntoModal(content.querySelector("#download-content"));
}

// Track downloaded files in localStorage
function markTrackAsDownloaded(clipId, format = "mp3") {
  const key = `downloaded_${clipId}_${format}`;
  localStorage.setItem(key, Date.now().toString());
}

function isTrackDownloaded(clipId, format = "mp3") {
  const key = `downloaded_${clipId}_${format}`;
  return localStorage.getItem(key) !== null;
}

function clearDownloadedTracks() {
  // Clear all downloaded track markers
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (key.startsWith("downloaded_")) {
      localStorage.removeItem(key);
    }
  });
}

function clearTrackDownload(clipId, format = null) {
  // Clear download status for a specific track
  if (format) {
    // Clear specific format
    const key = `downloaded_${clipId}_${format}`;
    localStorage.removeItem(key);
  } else {
    // Clear both formats
    localStorage.removeItem(`downloaded_${clipId}_mp3`);
    localStorage.removeItem(`downloaded_${clipId}_wav`);
  }
}

// Clear all extension data (reset to fresh install)
async function clearAllExtensionData() {
  return new Promise((resolve, reject) => {
    // Clear all chrome.storage.local data
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      // Clear all localStorage data related to the extension
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        // Clear download tracking
        if (key.startsWith("downloaded_")) {
          localStorage.removeItem(key);
        }
        // Clear filter preferences
        if (key.startsWith("filter") || key === "filtersEnabled") {
          localStorage.removeItem(key);
        }
      });

      resolve();
    });
  });
}

function refreshTrackUI(clipId) {
  // Refresh the UI for a specific track
  const trackItem = document.querySelector(
    `.track-item[data-clip-id="${clipId}"]`
  );
  if (!trackItem) return;

  const isMp3Downloaded = isTrackDownloaded(clipId, "mp3");
  const isWavDownloaded = isTrackDownloaded(clipId, "wav");
  const isAnyDownloaded = isMp3Downloaded || isWavDownloaded;

  // Update opacity and filter
  if (isAnyDownloaded) {
    trackItem.style.opacity = "0.5";
    trackItem.style.filter = "grayscale(50%)";
  } else {
    trackItem.style.opacity = "1";
    trackItem.style.filter = "none";
  }

  // Update checkbox
  const checkbox = trackItem.querySelector(".track-checkbox");
  if (checkbox) {
    checkbox.disabled = isAnyDownloaded;
  }

  // Update MP3 button
  const mp3Button = trackItem.querySelector(".download-single-mp3");
  if (mp3Button) {
    if (isMp3Downloaded) {
      mp3Button.disabled = true;
      mp3Button.style.background = "#6c757d";
      mp3Button.style.cursor = "not-allowed";
      mp3Button.textContent = `✓ ${getMessage("downloadMP3")}`;
    } else {
      mp3Button.disabled = false;
      mp3Button.style.background = "#667eea";
      mp3Button.style.cursor = "pointer";
      mp3Button.textContent = getMessage("downloadMP3");
    }
  }

  // Update WAV button
  const wavButton = trackItem.querySelector(".download-single-wav");
  if (wavButton) {
    if (isWavDownloaded) {
      wavButton.disabled = true;
      wavButton.style.background = "#6c757d";
      wavButton.style.cursor = "not-allowed";
      wavButton.textContent = `✓ ${getMessage("downloadWAV")}`;
    } else {
      wavButton.disabled = false;
      wavButton.style.background = "#28a745";
      wavButton.style.cursor = "pointer";
      wavButton.textContent = getMessage("downloadWAV");
    }
  }

  // Update unlock button visibility
  const unlockButton = trackItem.querySelector(".unlock-track");
  if (unlockButton) {
    unlockButton.style.display = isAnyDownloaded ? "block" : "none";
  }

  // Update title
  const titleDiv = trackItem.querySelector("div > div:first-child");
  if (titleDiv) {
    let titleText = titleDiv.textContent.replace(" ✓", "");
    if (isAnyDownloaded) {
      titleText += " ✓";
    }
    titleDiv.textContent = titleText;
  }

  // Update ID text
  const idDiv = trackItem.querySelector("div > div:last-child");
  if (idDiv) {
    let idText = trackItem.dataset.clipId;
    if (isMp3Downloaded) {
      idText += " [MP3 ✓]";
    }
    if (isWavDownloaded) {
      idText += " [WAV ✓]";
    }
    idDiv.textContent = idText;
  }
}

// Update a single workspace's tracks in the UI
async function updateWorkspaceTracksInUI(
  container,
  workspaceId,
  newTracks,
  allWorkspaces
) {
  const workspace = allWorkspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;

  // Add workspace info to each clip
  newTracks.forEach((clip) => {
    clip.workspaceId = workspace.id;
    clip.workspaceName = workspace.name;
  });

  const downloadableTracks = newTracks.filter(
    (clip) => clip.status === "complete" && clip.audio_url
  );

  // Find the workspace group in the UI
  const workspaceGroup = container.querySelector(
    `.workspace-group[data-workspace="${workspaceId}"]`
  );
  if (!workspaceGroup) return;

  const tracksDiv = document.getElementById(`workspace-${workspaceId}`);
  if (!tracksDiv) return;

  // Detect dark mode
  const isDarkMode =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const textColor = isDarkMode ? "#e0e0e0" : "#333";
  const secondaryTextColor = isDarkMode ? "#b0b0b0" : "#666";
  const trackBgColor = isDarkMode ? "#252525" : "white";
  const trackBorderColor = isDarkMode ? "#3a3a3a" : "#e8e8e8";

  // Update track count in header
  const header = workspaceGroup.querySelector(".workspace-header");
  const countSpan = header.querySelector("span:last-of-type");
  if (countSpan) {
    countSpan.textContent = `${downloadableTracks.length} ${
      downloadableTracks.length !== 1
        ? getMessage("tracks")
        : getMessage("track")
    }`;
  }

  // Render new tracks
  const tracksHTML = downloadableTracks
    .map((track, index) => {
      const isMp3Downloaded = isTrackDownloaded(track.id, "mp3");
      const isWavDownloaded = isTrackDownloaded(track.id, "wav");
      const isAnyDownloaded = isMp3Downloaded || isWavDownloaded;
      const opacity = isAnyDownloaded ? "0.5" : "1";
      const downloadedStyle = isAnyDownloaded
        ? `opacity: ${opacity}; filter: grayscale(50%);`
        : "";
      return `
        <div class="track-item" data-clip-id="${
          track.id
        }" style="padding: 10px; border: 1px solid ${trackBorderColor}; border-radius: 6px; margin-bottom: 6px; display: flex; align-items: center; gap: 12px; background: ${trackBgColor}; ${downloadedStyle}">
          <input type="checkbox" class="track-checkbox" data-clip-id="${
            track.id
          }" data-audio-url="${
        track.audio_url
      }" data-workspace="${workspaceId}" style="cursor: pointer;" ${
        isAnyDownloaded ? "disabled" : ""
      }>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: ${textColor}; font-size: 14px;">${
        track.title || "(Untitled)"
      }${isAnyDownloaded ? " ✓" : ""}</div>
            <div style="font-size: 11px; color: ${secondaryTextColor}; margin-top: 2px;">${
        track.id
      }${isMp3Downloaded ? " [MP3 ✓]" : ""}${
        isWavDownloaded ? " [WAV ✓]" : ""
      }</div>
          </div>
          <div style="display: flex; gap: 4px; align-items: center;">
            <button class="download-single-mp3" data-clip-id="${
              track.id
            }" data-audio-url="${track.audio_url}" data-title="${(
        track.title || "Untitled"
      ).replace(/[<>:"/\\|?*]/g, "_")}" style="padding: 6px 12px; background: ${
        isMp3Downloaded ? "#6c757d" : "#667eea"
      }; color: white; border: none; border-radius: 4px; cursor: ${
        isMp3Downloaded ? "not-allowed" : "pointer"
      }; font-size: 12px;" ${isMp3Downloaded ? "disabled" : ""}>${
        isMp3Downloaded ? "✓ " : ""
      }${getMessage("downloadMP3")}</button>
            <button class="download-single-wav" data-clip-id="${
              track.id
            }" data-title="${(track.title || "Untitled").replace(
        /[<>:"/\\|?*]/g,
        "_"
      )}" style="padding: 6px 12px; background: ${
        isWavDownloaded ? "#6c757d" : "#28a745"
      }; color: white; border: none; border-radius: 4px; cursor: ${
        isWavDownloaded ? "not-allowed" : "pointer"
      }; font-size: 12px;" ${isWavDownloaded ? "disabled" : ""}>${
        isWavDownloaded ? "✓ " : ""
      }${getMessage("downloadWAV")}</button>
            <button class="unlock-track" data-clip-id="${
              track.id
            }" title="Reset download status" style="display: ${
        isAnyDownloaded ? "flex" : "none"
      }; padding: 6px; background: transparent; border: 1px solid ${
        isDarkMode ? "#444" : "#e0e0e0"
      }; border-radius: 4px; cursor: pointer; font-size: 16px; color: ${textColor}; width: 32px; height: 32px; align-items: center; justify-content: center;">🔓</button>
          </div>
        </div>
      `;
    })
    .join("");

  tracksDiv.innerHTML = tracksHTML;

  // Re-attach event listeners for the new tracks in this workspace
  attachTrackEventListeners(container, downloadableTracks, workspaceId);

  // Also update the workspace checkbox state
  const workspaceCheckbox = header.querySelector(".workspace-checkbox");
  if (workspaceCheckbox) {
    const trackCheckboxes = tracksDiv.querySelectorAll(".track-checkbox");
    const allChecked =
      trackCheckboxes.length > 0 &&
      Array.from(trackCheckboxes).every((cb) => cb.checked);
    const someChecked = Array.from(trackCheckboxes).some((cb) => cb.checked);
    workspaceCheckbox.checked = allChecked;
    workspaceCheckbox.indeterminate = someChecked && !allChecked;
  }
}

// Attach event listeners to track items in a specific workspace
function attachTrackEventListeners(container, tracks, workspaceId) {
  // Get workspace name from tracks
  const workspaceName =
    tracks.length > 0 ? tracks[0].workspaceName || "Unknown" : "Unknown";

  // Individual download buttons - MP3 (only in this workspace)
  const workspaceTracksDiv = document.getElementById(
    `workspace-${workspaceId}`
  );
  if (workspaceTracksDiv) {
    workspaceTracksDiv
      .querySelectorAll(".download-single-mp3")
      .forEach((btn) => {
        // Remove existing listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener("click", () => {
          const clipId = newBtn.dataset.clipId;
          const audioUrl = newBtn.dataset.audioUrl;
          const title = newBtn.dataset.title;

          // Use downloadSelectedTracks to show progress UI (treat as batch of one)
          const track = {
            id: clipId,
            audio_url: audioUrl,
            title: title,
            workspaceName: workspaceName,
          };
          downloadSelectedTracks([track], "mp3");
        });
      });

    // Individual download buttons - WAV
    workspaceTracksDiv
      .querySelectorAll(".download-single-wav")
      .forEach((btn) => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener("click", async () => {
          const clipId = newBtn.dataset.clipId;
          const audioUrl = newBtn.dataset.audioUrl; // Added for consistency
          const title = newBtn.dataset.title;

          // Use downloadSelectedTracksAsWav to show progress UI (treat as batch of one)
          const track = {
            id: clipId,
            audio_url: audioUrl,
            title: title,
            workspaceName: workspaceName,
          };
          downloadSelectedTracksAsWav([track]);
        });
      });

    // Unlock buttons
    workspaceTracksDiv.querySelectorAll(".unlock-track").forEach((btn) => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener("click", () => {
        const clipId = newBtn.dataset.clipId;
        clearTrackDownload(clipId);
        refreshTrackUI(clipId);
      });
    });
  }
}

// Load tracks into modal
async function loadTracksIntoModal(container) {
  try {
    container.innerHTML = `<p>${getMessage("fetchingWorkspaces")}</p>`;

    // First, try to extract token from current page if not already stored
    await attemptTokenExtraction();

    // Fetch all workspaces with pagination and progress feedback
    const allWorkspaces = [];
    let page = 1;
    let hasMore = true;
    const pageSize = 20;

    while (hasMore) {
      // Update UI with progress
      const currentCount = allWorkspaces.length;
      container.innerHTML = `<p>${formatMessage("fetchingWorkspacesProgress", {
        count: currentCount,
        page: page,
      })}</p>`;

      const pageResponse = await chrome.runtime.sendMessage({
        action: "getWorkspacesPage",
        page: page,
      });

      if (!pageResponse.success) {
        // If error on page 1, throw it
        if (page === 1) {
          throw new Error(pageResponse.error || "Failed to fetch workspaces");
        }
        // If error on later pages, we've probably reached the end
        console.error(
          `Error fetching workspace page ${page}:`,
          pageResponse.error
        );
        break;
      }

      const data = pageResponse.data;
      const projects = data.projects || [];
      const receivedCount = projects.length;

      if (receivedCount === 0) {
        // No more workspaces
        hasMore = false;
      } else {
        allWorkspaces.push(...projects);

        // Determine if there are more pages
        // Check explicit pagination fields first
        if (data.has_more === true) {
          hasMore = true;
        } else if (data.has_more === false) {
          hasMore = false;
        } else if (data.total_pages !== undefined) {
          hasMore = page < data.total_pages;
        } else if (data.next_page !== null && data.next_page !== undefined) {
          hasMore = true;
        } else {
          // If we got a full page, assume there might be more (improved strategy)
          hasMore = receivedCount >= pageSize;
        }

        // Add delay between requests to avoid rate limiting
        if (hasMore) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          page++;
        } else {
          break;
        }
      }
    }

    const workspaces = allWorkspaces;
    container.innerHTML = `<p>${formatMessage("loadingAllTracksSummary", {
      count: workspaces.length,
    })}</p>`;

    // Fetch tracks from all workspaces
    const allTracks = [];

    for (let i = 0; i < workspaces.length; i++) {
      const workspace = workspaces[i];

      // Update UI with progress
      container.innerHTML = `<p>${formatMessage("loadingWorkspaceTracks", {
        total: workspaces.length,
        current: i + 1,
        name: workspace.name,
      })}</p>`;

      // Try to get cached tracks first (always use cache if available)
      let workspaceClips = [];
      let useCache = false;
      let cacheTimestamp = null;
      try {
        const cachedResponse = await chrome.runtime.sendMessage({
          action: "getCachedTracks",
          workspaceId: workspace.id,
        });
        if (
          cachedResponse.success &&
          cachedResponse.tracks &&
          cachedResponse.tracks.length > 0
        ) {
          workspaceClips = cachedResponse.tracks;
          cacheTimestamp = cachedResponse.timestamp;
          useCache = true;
          console.log(
            `Using cached tracks for workspace ${workspace.name}: ${
              workspaceClips.length
            } tracks (cached ${
              cacheTimestamp
                ? new Date(cacheTimestamp).toLocaleString()
                : "unknown"
            })`
          );
        }
      } catch (error) {
        // No cache available, will fetch fresh
        console.log(
          `No cache for workspace ${workspace.name}, will fetch fresh tracks`
        );
      }

      // Store cache timestamp for display
      if (useCache && cacheTimestamp) {
        workspaceClips._cacheTimestamp = cacheTimestamp;
      }

      // Only fetch fresh if no cache available
      if (!useCache || workspaceClips.length === 0) {
        // Add delay between workspaces to avoid rate limiting (except for the first one)
        if (i > 0) {
          // Random delay between 500-1000ms to avoid predictable patterns
          const delay = 500 + Math.random() * 500;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        let cursor = null;
        let hasMore = true;

        while (hasMore) {
          const response = await chrome.runtime.sendMessage({
            action: "getTracks",
            cursor: cursor,
            limit: 100, // Increased from 20 to 100 to reduce number of requests and avoid rate limiting
            workspaceId: workspace.id,
          });

          if (!response.success) {
            // Handle rate limiting (429) with exponential backoff
            if (response.error && response.error.includes("429")) {
              console.warn(
                `Rate limited while fetching from workspace ${workspace.name}. Waiting before retry...`
              );
              // Wait 2-4 seconds before retrying
              const backoffDelay = 2000 + Math.random() * 2000;
              await new Promise((resolve) => setTimeout(resolve, backoffDelay));

              // Retry once
              const retryResponse = await chrome.runtime.sendMessage({
                action: "getTracks",
                cursor: cursor,
                limit: 100,
                workspaceId: workspace.id,
              });

              if (!retryResponse.success) {
                console.error(
                  `Failed to fetch from workspace ${workspace.name} after retry: ${retryResponse.error}`
                );
                break;
              }

              // Use retry response data
              const data = retryResponse.data;
              const receivedCount = (data.clips || []).length;
              workspaceClips.push(...(data.clips || []));
              hasMore =
                data.has_more === true ||
                (receivedCount === 100 && data.next_cursor);
              cursor = data.next_cursor;

              // Add delay to avoid rate limiting
              if (hasMore) {
                await new Promise((resolve) => setTimeout(resolve, 300));
              }
              continue;
            }

            // If token error, try to extract again
            if (response.error && response.error.includes("token")) {
              await attemptTokenExtraction();
              // Retry once
              const retryResponse = await chrome.runtime.sendMessage({
                action: "getTracks",
                cursor: cursor,
                limit: 100, // Updated limit
                workspaceId: workspace.id,
              });
              if (!retryResponse.success) {
                console.error(
                  `Failed to fetch from workspace ${workspace.name}: ${retryResponse.error}`
                );
                break;
              }
              const data = retryResponse.data;
              const receivedCount = (data.clips || []).length;
              workspaceClips.push(...(data.clips || []));
              // Improved pagination: continue if has_more is true OR if we got a full page (might be more)
              hasMore =
                data.has_more === true ||
                (receivedCount === 100 && data.next_cursor);
              cursor = data.next_cursor;

              // Add delay to avoid rate limiting
              if (hasMore) {
                await new Promise((resolve) => setTimeout(resolve, 300));
              }
              continue;
            }

            console.error(
              `Failed to fetch from workspace ${workspace.name}: ${response.error}`
            );
            break;
          }

          const data = response.data;
          const receivedCount = (data.clips || []).length;
          workspaceClips.push(...(data.clips || []));

          // Improved pagination logic: continue if has_more is true OR if we got a full page (might be more)
          // This handles cases where API stops returning has_more due to throttling
          hasMore =
            data.has_more === true ||
            (receivedCount === 100 && data.next_cursor);
          cursor = data.next_cursor;

          // Add delay between requests to avoid rate limiting (increased from 200ms to 300ms)
          if (hasMore) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          } else {
            break;
          }
        }

        // Cache the fetched tracks in background script
        if (workspaceClips.length > 0) {
          try {
            await chrome.runtime.sendMessage({
              action: "cacheTracks",
              workspaceId: workspace.id,
              tracks: workspaceClips,
            });
          } catch (error) {
            console.warn("Failed to cache tracks:", error);
          }
        }
      }

      // Add workspace info to each clip
      workspaceClips.forEach((clip) => {
        clip.workspaceId = workspace.id;
        clip.workspaceName = workspace.name;
        // Preserve cache timestamp if using cache
        if (cacheTimestamp) {
          clip._cacheTimestamp = cacheTimestamp;
        }
      });

      allTracks.push(...workspaceClips);
    }

    const downloadableTracks = allTracks.filter(
      (clip) => clip.status === "complete" && clip.audio_url
    );

    // Group tracks by workspace
    const tracksByWorkspace = {};
    downloadableTracks.forEach((track) => {
      const workspaceName = track.workspaceName || "Unknown Workspace";
      if (!tracksByWorkspace[workspaceName]) {
        tracksByWorkspace[workspaceName] = [];
      }
      tracksByWorkspace[workspaceName].push(track);
    });

    // Store all tracks for metadata download later (before rendering modal)
    if (downloadableTracks.length > 0) {
      container.dataset.allTracks = JSON.stringify(downloadableTracks);
    }

    // No prompt - user can click the download button when ready

    // Detect dark mode for all UI elements
    const isDarkMode =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const textColor = isDarkMode ? "#e0e0e0" : "#333";
    const secondaryTextColor = isDarkMode ? "#b0b0b0" : "#666";
    const bgColor = isDarkMode ? "#1e1e1e" : "white";
    const borderColor = isDarkMode ? "#444" : "#e0e0e0";
    const headerBgColor = isDarkMode ? "#2a2a2a" : "#f5f5f5";
    const trackBgColor = isDarkMode ? "#252525" : "white";
    const trackBorderColor = isDarkMode ? "#3a3a3a" : "#e8e8e8";
    const tipBgColor = isDarkMode ? "#1a3a5a" : "#e3f2fd";
    const tipBorderColor = isDarkMode ? "#4a9eff" : "#2196f3";
    const tipTextColor = isDarkMode ? "#b0d4ff" : "#333";
    const progressBgColor = isDarkMode ? "#333" : "#f0f0f0";

    // Render tracks grouped by workspace
    const workspaceSections = Object.entries(tracksByWorkspace)
      .map(([workspaceName, tracks]) => {
        const workspaceId =
          tracks[0].workspaceId ||
          workspaceName.toLowerCase().replace(/\s+/g, "-");
        return `
          <div class="workspace-group" data-workspace="${workspaceId}" style="margin-bottom: 16px; border: 1px solid ${borderColor}; border-radius: 8px; overflow: hidden;">
            <div class="workspace-header" data-workspace-id="${workspaceId}" style="background: ${headerBgColor}; padding: 12px; cursor: pointer; display: flex; align-items: center; gap: 12px; user-select: none;">
              <span class="workspace-toggle" data-workspace-id="${workspaceId}" style="font-size: 14px; transition: transform 0.2s; color: ${textColor};">▶</span>
              <input type="checkbox" class="workspace-checkbox" data-workspace="${workspaceId}" style="cursor: pointer;">
              <span style="font-weight: 600; color: ${textColor}; flex: 1;">📁 ${workspaceName}</span>
              <span style="font-size: 12px; color: ${secondaryTextColor};">
                ${tracks.length} ${
          tracks.length !== 1 ? getMessage("tracks") : getMessage("track")
        }
                ${
                  tracks.length > 0 && tracks[0]._cacheTimestamp
                    ? ` • ${getMessage("cached")} ${new Date(
                        tracks[0]._cacheTimestamp
                      ).toLocaleString()}`
                    : ""
                }
              </span>
              <button class="refresh-workspace" data-workspace-id="${workspaceId}" title="${getMessage(
          "refreshWorkspace"
        )}" style="background: none; border: none; cursor: pointer; font-size: 16px; color: ${textColor}; padding: 4px; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">🔄</button>
            </div>
            <div class="workspace-tracks" id="workspace-${workspaceId}" style="display: none; padding: 8px;">
              ${tracks
                .map((track, index) => {
                  const isMp3Downloaded = isTrackDownloaded(track.id, "mp3");
                  const isWavDownloaded = isTrackDownloaded(track.id, "wav");
                  const isAnyDownloaded = isMp3Downloaded || isWavDownloaded;
                  const opacity = isAnyDownloaded ? "0.5" : "1";
                  const downloadedStyle = isAnyDownloaded
                    ? `opacity: ${opacity}; filter: grayscale(50%);`
                    : "";
                  return `
                <div class="track-item" data-clip-id="${
                  track.id
                }" style="padding: 10px; border: 1px solid ${trackBorderColor}; border-radius: 6px; margin-bottom: 6px; display: flex; align-items: center; gap: 12px; background: ${trackBgColor}; ${downloadedStyle}">
                  <input type="checkbox" class="track-checkbox" data-clip-id="${
                    track.id
                  }" data-audio-url="${
                    track.audio_url
                  }" data-workspace="${workspaceId}" style="cursor: pointer;" ${
                    isAnyDownloaded ? "disabled" : ""
                  }>
                  <div style="flex: 1;">
                    <div style="font-weight: 600; color: ${textColor}; font-size: 14px;">${
                    track.title || "(Untitled)"
                  }${isAnyDownloaded ? " ✓" : ""}</div>
                    <div style="font-size: 11px; color: ${secondaryTextColor}; margin-top: 2px;">${
                    track.id
                  }${isMp3Downloaded ? " [MP3 ✓]" : ""}${
                    isWavDownloaded ? " [WAV ✓]" : ""
                  }</div>
                  </div>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <button class="download-single-mp3" data-clip-id="${
                      track.id
                    }" data-audio-url="${track.audio_url}" data-title="${(
                    track.title || "Untitled"
                  ).replace(
                    /[<>:"/\\|?*]/g,
                    "_"
                  )}" style="padding: 6px 12px; background: ${
                    isMp3Downloaded ? "#6c757d" : "#667eea"
                  }; color: white; border: none; border-radius: 4px; cursor: ${
                    isMp3Downloaded ? "not-allowed" : "pointer"
                  }; font-size: 12px;" ${isMp3Downloaded ? "disabled" : ""}>${
                    isMp3Downloaded ? "✓ " : ""
                  }${getMessage("downloadMP3")}</button>
                    <button class="download-single-wav" data-clip-id="${
                      track.id
                    }" data-title="${(track.title || "Untitled").replace(
                    /[<>:"/\\|?*]/g,
                    "_"
                  )}" style="padding: 6px 12px; background: ${
                    isWavDownloaded ? "#6c757d" : "#28a745"
                  }; color: white; border: none; border-radius: 4px; cursor: ${
                    isWavDownloaded ? "not-allowed" : "pointer"
                  }; font-size: 12px;" ${isWavDownloaded ? "disabled" : ""}>${
                    isWavDownloaded ? "✓ " : ""
                  }${getMessage("downloadWAV")}</button>
                    <button class="unlock-track" data-clip-id="${
                      track.id
                    }" title="Reset download status" style="display: ${
                    isAnyDownloaded ? "flex" : "none"
                  }; padding: 6px; background: transparent; border: 1px solid ${borderColor}; border-radius: 4px; cursor: pointer; font-size: 16px; color: ${textColor}; width: 32px; height: 32px; align-items: center; justify-content: center;">🔓</button>
                  </div>
                </div>
              `;
                })
                .join("")}
            </div>
          </div>
        `;
      })
      .join("");

    // Calculate oldest cache timestamp from all workspaces
    let oldestCacheTimestamp = null;
    let allCached = true;
    workspaces.forEach((workspace) => {
      const workspaceTracks = tracksByWorkspace[workspace.name] || [];
      if (workspaceTracks.length > 0 && workspaceTracks[0]._cacheTimestamp) {
        const ts = workspaceTracks[0]._cacheTimestamp;
        if (!oldestCacheTimestamp || ts < oldestCacheTimestamp) {
          oldestCacheTimestamp = ts;
        }
      } else {
        allCached = false;
      }
    });

    const cacheInfo = oldestCacheTimestamp
      ? `Last fetched: ${new Date(oldestCacheTimestamp).toLocaleString()}`
      : "No cache available";

    container.innerHTML = `
      <div style="display: flex; gap: 16px; height: 100%; box-sizing: border-box; overflow: hidden;">
        <!-- Left Column: Actions and Explanations -->
        <div style="flex: 0 0 320px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; padding-right: 8px;">
          <div style="flex-shrink: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <p style="color: ${textColor}; margin: 0; font-size: 14px;"><strong> ${
      downloadableTracks.length
    } ${getMessage("downloadableTracks")} ${
      Object.keys(tracksByWorkspace).length
    } ${getMessage("workspaces")}</strong></p>
              <button id="refresh-all-workspaces" title="${getMessage(
                "refreshAllWorkspaces"
              )}" style="background: none; border: none; cursor: pointer; font-size: 16px; color: ${textColor}; padding: 4px; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">🔄</button>
            </div>
            <div style="font-size: 11px; color: ${secondaryTextColor}; margin-bottom: 12px;">${cacheInfo}</div>
          </div>
          
          <div style="flex-shrink: 0;">
            <h4 style="color: ${textColor}; margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">Information</h4>
            <div style="background: ${
              isDarkMode ? "#4a2a0a" : "#fff3cd"
            }; border-left: 4px solid ${
      isDarkMode ? "#ff9800" : "#ffc107"
    }; padding: 12px; border-radius: 4px; font-size: 12px; color: ${
      isDarkMode ? "#ffcc80" : "#856404"
    }; line-height: 1.5;">
              <strong>⚠️ ${getMessage("warning")}</strong><br>
              ${getMessage("warningMessage")} 
              <button id="open-download-settings" style="background: none; border: none; color: ${
                isDarkMode ? "#ff9800" : "#856404"
              }; text-decoration: underline; font-weight: 600; cursor: pointer; padding: 0; font-size: 12px; font-family: inherit; margin: 0;">${getMessage(
      "changeChromeSettings"
    )}</button> 
              ${getMessage("turnOffAskWhere")}
            </div>
          </div>

          <div id="metadata-fetch-progress" style="flex-shrink: 0; display: none; padding-top: 8px; border-top: 1px solid ${borderColor};">
            <h4 style="color: ${textColor}; margin: 0 0 8px 0; font-size: 12px; font-weight: 600;">${
      getMessage("fetchingMetadata") || "Fetching metadata"
    }</h4>
            <div style="background: ${progressBgColor}; border-radius: 4px; height: 12px; overflow: hidden;">
              <div id="metadata-progress-bar" style="background: #20c997; height: 100%; width: 0%; transition: width 0.3s;"></div>
            </div>
            <p id="metadata-progress-text" style="font-size: 11px; color: ${secondaryTextColor}; margin: 4px 0 0 0;"></p>
          </div>

          <div id="download-progress" style="flex-shrink: 0; display: none; padding-top: 8px; border-top: 1px solid ${borderColor};">
            <div style="background: ${progressBgColor}; border-radius: 4px; height: 24px; overflow: hidden;">
              <div id="progress-bar" style="background: #667eea; height: 100%; width: 0%; transition: width 0.3s;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
              <p id="progress-text" style="font-size: 12px; color: ${secondaryTextColor}; margin: 0;"></p>
              <button id="stop-download" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: none;">${getMessage(
                "stop"
              )}</button>
            </div>
          </div>

          <div style="flex-shrink: 0; padding-top: 8px; border-top: 1px solid ${borderColor};">
            <h4 style="color: ${textColor}; margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">Actions</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <button id="download-selected-mp3" style="padding: 10px 16px; background: #764ba2; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; width: 100%;">${getMessage(
                "downloadSelectedMP3"
              )}</button>
              <button id="download-selected-wav" style="padding: 10px 16px; background: #20c997; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; width: 100%;">${getMessage(
                "downloadSelectedWAV"
              )}</button>
              <button id="export-sunolibrary" style="padding: 10px 16px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; width: 100%;">📦 ${
                getMessage("downloadTrackList") || "Download Track List"
              }</button>
              <button id="reset-all-downloads" style="padding: 10px 16px; background: ${
                isDarkMode ? "#444" : "#e0e0e0"
              }; color: ${textColor}; border: 1px solid ${borderColor}; border-radius: 6px; cursor: pointer; font-size: 13px; width: 100%;" title="${getMessage(
      "resetDownloadsTitle"
    )}">🔄 ${getMessage("resetDownloads")}</button>
            </div>
          </div>
        </div>

        <!-- Right Column: Filters and Track List -->
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0;">
          <div id="filter-container-all-tracks" style="flex-shrink: 0;"></div>
          <div id="tracks-list" style="flex: 1; overflow-y: auto; min-height: 0; box-sizing: border-box; overflow-x: hidden;">
            <div id="all-workspaces-header-container-all-tracks"></div>
            ${workspaceSections}
          </div>
        </div>
      </div>
    `;

    // Add event listeners for workspace headers (toggle expand/collapse)
    container.querySelectorAll(".workspace-header").forEach((header) => {
      header.addEventListener("click", (e) => {
        // Don't toggle if clicking on the checkbox or refresh button
        if (
          e.target.type === "checkbox" ||
          e.target.classList.contains("refresh-workspace")
        ) {
          return;
        }
        const workspaceId = header.dataset.workspaceId;
        const tracksDiv = document.getElementById(`workspace-${workspaceId}`);
        const toggle = header.querySelector(".workspace-toggle");

        if (tracksDiv.style.display === "none" || !tracksDiv.style.display) {
          tracksDiv.style.display = "block";
          if (toggle) toggle.style.transform = "rotate(90deg)";
        } else {
          tracksDiv.style.display = "none";
          if (toggle) toggle.style.transform = "rotate(0deg)";
        }
      });
    });

    // Store workspaces in container for refresh handlers to access
    container.dataset.workspaces = JSON.stringify(workspaces);

    // Add event listener for refresh all button
    const refreshAllBtn = container.querySelector("#refresh-all-workspaces");
    if (refreshAllBtn) {
      refreshAllBtn.addEventListener("click", async (e) => {
        e.stopPropagation();

        // Disable button and show loading state
        refreshAllBtn.disabled = true;
        refreshAllBtn.textContent = "⏳";
        refreshAllBtn.style.cursor = "not-allowed";

        try {
          // Refresh all workspaces
          const refreshResponse = await chrome.runtime.sendMessage({
            action: "refreshAllWorkspaces",
          });

          if (refreshResponse.success) {
            // Reload the modal to show updated tracks
            loadTracksIntoModal(container);
          } else {
            alert(`Failed to refresh all workspaces: ${refreshResponse.error}`);
            refreshAllBtn.disabled = false;
            refreshAllBtn.textContent = "🔄";
            refreshAllBtn.style.cursor = "pointer";
          }
        } catch (error) {
          console.error("Error refreshing all workspaces:", error);
          alert(`Error refreshing all workspaces: ${error.message}`);
          refreshAllBtn.disabled = false;
          refreshAllBtn.textContent = "🔄";
          refreshAllBtn.style.cursor = "pointer";
        }
      });
    }

    // Add event listeners for refresh buttons
    container.querySelectorAll(".refresh-workspace").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const workspaceId = btn.dataset.workspaceId;
        // Get workspaces from container data
        const storedWorkspaces = JSON.parse(
          container.dataset.workspaces || "[]"
        );
        const workspace = storedWorkspaces.find((w) => w.id === workspaceId);
        if (!workspace) {
          console.error(`Workspace ${workspaceId} not found`);
          return;
        }

        // Disable button and show loading state
        btn.disabled = true;
        btn.textContent = "⏳";
        btn.style.cursor = "not-allowed";

        try {
          // Refresh tracks for this workspace
          const refreshResponse = await chrome.runtime.sendMessage({
            action: "refreshWorkspaceTracks",
            workspaceId: workspaceId,
          });

          if (refreshResponse.success) {
            // Get all current tracks from the UI to maintain state
            const allCurrentTracks = [];
            container.querySelectorAll(".track-item").forEach((item) => {
              const clipId = item.dataset.clipId;
              const track = {
                id: clipId,
                workspaceId:
                  item.querySelector(".track-checkbox")?.dataset.workspace,
                audio_url:
                  item.querySelector(".track-checkbox")?.dataset.audioUrl,
                title: item
                  .querySelector("div > div:first-child")
                  ?.textContent.replace(" ✓", ""),
              };
              if (track.workspaceId !== workspaceId) {
                allCurrentTracks.push(track);
              }
            });

            // Add the refreshed tracks
            refreshResponse.tracks.forEach((track) => {
              track.workspaceId = workspaceId;
              track.workspaceName = workspace.name;
              allCurrentTracks.push(track);
            });

            // Update only this workspace's tracks in the UI
            updateWorkspaceTracksInUI(
              container,
              workspaceId,
              refreshResponse.tracks,
              storedWorkspaces
            );
            btn.disabled = false;
            btn.textContent = "🔄";
            btn.style.cursor = "pointer";
          } else {
            alert(`Failed to refresh workspace: ${refreshResponse.error}`);
            btn.disabled = false;
            btn.textContent = "🔄";
            btn.style.cursor = "pointer";
          }
        } catch (error) {
          console.error("Error refreshing workspace:", error);
          alert(`Error refreshing workspace: ${error.message}`);
          btn.disabled = false;
          btn.textContent = "🔄";
          btn.style.cursor = "pointer";
        }
      });
    });

    // Add event listeners for workspace checkboxes
    container.querySelectorAll(".workspace-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent header toggle
        const workspaceId = checkbox.dataset.workspace;
        // Only select visible tracks (not hidden by filters)
        const trackItems = Array.from(
          container.querySelectorAll(`.track-item[data-clip-id]`)
        ).filter((item) => {
          const clipId = item.dataset.clipId;
          const cb = item.querySelector(
            `.track-checkbox[data-workspace="${workspaceId}"]`
          );
          return (
            clipId &&
            cb &&
            item.style.display !== "none" &&
            !cb.disabled &&
            !isTrackDownloaded(clipId, "mp3") &&
            !isTrackDownloaded(clipId, "wav")
          );
        });
        trackItems.forEach((item) => {
          const cb = item.querySelector(
            `.track-checkbox[data-workspace="${workspaceId}"]`
          );
          if (cb) cb.checked = checkbox.checked;
        });
      });
    });

    // Create filter component
    const filterComponent = createFilterComponent(
      "filter-container-all-tracks",
      isDarkMode,
      textColor,
      secondaryTextColor,
      borderColor
    );

    // Create "All workspaces" header
    const allWorkspacesHeader = createAllWorkspacesHeader(
      isDarkMode,
      textColor,
      secondaryTextColor,
      borderColor,
      headerBgColor
    );
    const allWorkspacesHeaderContainer = document.getElementById(
      "all-workspaces-header-container-all-tracks"
    );
    if (allWorkspacesHeaderContainer) {
      allWorkspacesHeaderContainer.appendChild(allWorkspacesHeader.element);
    }

    function updateWorkspaceCounts() {
      container.querySelectorAll(".workspace-group").forEach((group) => {
        const workspaceId = group.dataset.workspace;
        const visibleTracks = group.querySelectorAll(
          `.track-item:not([style*="display: none"])`
        );
        const header = group.querySelector(".workspace-header");
        const countSpan = header.querySelector("span:last-of-type");

        // Get cached info if present (it's text content usually)
        let cachedInfo = "";
        if (countSpan && countSpan.textContent.includes("• Cached")) {
          cachedInfo = " • Cached" + countSpan.textContent.split("• Cached")[1];
        }

        if (countSpan) {
          countSpan.textContent = `${visibleTracks.length} track${
            visibleTracks.length !== 1 ? "s" : ""
          }${cachedInfo}`;
        }
      });
    }

    // Filter function using new filter component
    function filterTracks() {
      if (!filterComponent) return;

      const filterState = filterComponent.state();
      const filteredResults = applyFiltersToTracks(
        downloadableTracks,
        filterState
      );

      const allTrackItems = container.querySelectorAll(".track-item");
      filteredResults.forEach(({ track, shouldShow }) => {
        const item = Array.from(allTrackItems).find(
          (el) => el.dataset.clipId === track.id
        );
        if (!item) return;

        item.style.display = shouldShow ? "flex" : "none";

        // Uncheck hidden tracks so they're not included in batch downloads
        if (!shouldShow) {
          const checkbox = item.querySelector(".track-checkbox");
          if (checkbox) checkbox.checked = false;
        }
      });

      // Update counts
      updateWorkspaceCounts();
    }

    // Set up filter component update callback
    if (filterComponent) {
      filterComponent.updateFilter = filterTracks;
    }

    // Initial filter
    setTimeout(filterTracks, 0);

    // Start background metadata fetch (after modal is rendered)
    if (downloadableTracks.length > 0) {
      // Use setTimeout to ensure DOM is ready
      setTimeout(() => {
        startBackgroundMetadataFetch(downloadableTracks);
      }, 100);
    }

    // Select All functionality
    allWorkspacesHeader.selectAllCheckbox.addEventListener("change", (e) => {
      const allTrackCheckboxes = Array.from(
        container.querySelectorAll(".track-checkbox")
      ).filter((cb) => {
        const trackItem = cb.closest(".track-item");
        return trackItem && trackItem.style.display !== "none";
      });

      allTrackCheckboxes.forEach((cb) => {
        cb.checked = e.target.checked;
      });

      // Update workspace checkboxes
      container.querySelectorAll(".workspace-checkbox").forEach((wsCb) => {
        const workspaceId = wsCb.dataset.workspace;
        const workspaceTrackCheckboxes = Array.from(
          container.querySelectorAll(
            `.track-item .track-checkbox[data-workspace="${workspaceId}"]`
          )
        ).filter((cb) => {
          const trackItem = cb.closest(".track-item");
          const clipId = trackItem?.dataset.clipId;
          return (
            trackItem &&
            trackItem.style.display !== "none" &&
            !cb.disabled &&
            !isTrackDownloaded(clipId, "mp3") &&
            !isTrackDownloaded(clipId, "wav")
          );
        });

        if (workspaceTrackCheckboxes.length > 0) {
          const allChecked = workspaceTrackCheckboxes.every((cb) => cb.checked);
          const someChecked = workspaceTrackCheckboxes.some((cb) => cb.checked);
          wsCb.checked = allChecked;
          wsCb.indeterminate = someChecked && !allChecked;
        }
      });
    });

    // Update workspace checkbox when individual tracks are selected/deselected
    container.querySelectorAll(".track-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const workspaceId = checkbox.dataset.workspace;
        const workspaceCheckbox = container.querySelector(
          `.workspace-checkbox[data-workspace="${workspaceId}"]`
        );
        // Only consider visible tracks when updating workspace checkbox state
        const workspaceTrackCheckboxes = Array.from(
          container.querySelectorAll(
            `.track-checkbox[data-workspace="${workspaceId}"]`
          )
        ).filter((cb) => {
          const trackItem = cb.closest(".track-item");
          const clipId = trackItem?.dataset.clipId;
          return (
            trackItem &&
            trackItem.style.display !== "none" &&
            !cb.disabled &&
            !isTrackDownloaded(clipId, "mp3") &&
            !isTrackDownloaded(clipId, "wav")
          );
        });
        const allChecked =
          workspaceTrackCheckboxes.length > 0 &&
          workspaceTrackCheckboxes.every((cb) => cb.checked);
        const someChecked = workspaceTrackCheckboxes.some((cb) => cb.checked);
        workspaceCheckbox.checked = allChecked;
        workspaceCheckbox.indeterminate = someChecked && !allChecked;
      });
    });

    // Open Chrome Downloads Settings button
    const openSettingsBtn = container.querySelector("#open-download-settings");
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage(
          { action: "openDownloadSettings" },
          () => {}
        );
      });
    }

    // Download selected MP3
    document
      .getElementById("download-selected-mp3")
      .addEventListener("click", () => {
        // Only get checked tracks that are visible (not hidden by filters)
        const baseSelection = Array.from(
          container.querySelectorAll(".track-checkbox:checked")
        )
          .filter((cb) => {
            const trackItem = cb.closest(".track-item");
            return trackItem && trackItem.style.display !== "none";
          })
          .map((cb) => {
            const track = downloadableTracks.find(
              (t) => t.id === cb.dataset.clipId
            );
            return {
              id: cb.dataset.clipId,
              audio_url: cb.dataset.audioUrl,
              title: track?.title || "Untitled",
              workspaceName: track?.workspaceName || "Unknown",
            };
          });

        const selected = baseSelection.filter((track) => {
          const alreadyDownloaded =
            isTrackDownloaded(track.id, "mp3") ||
            isTrackDownloaded(track.id, "wav");
          if (alreadyDownloaded) {
            const checkbox = container.querySelector(
              `.track-checkbox[data-clip-id="${track.id}"]`
            );
            if (checkbox) checkbox.checked = false;
          }
          return !alreadyDownloaded;
        });

        if (selected.length === 0) {
          alert(getMessage("noNewTracksSelected"));
          return;
        }

        downloadSelectedTracks(selected, "mp3");
      });

    // Download selected WAV
    document
      .getElementById("download-selected-wav")
      .addEventListener("click", () => {
        // Only get checked tracks that are visible (not hidden by filters)
        const baseSelection = Array.from(
          container.querySelectorAll(".track-checkbox:checked")
        )
          .filter((cb) => {
            const trackItem = cb.closest(".track-item");
            return trackItem && trackItem.style.display !== "none";
          })
          .map((cb) => {
            const track = downloadableTracks.find(
              (t) => t.id === cb.dataset.clipId
            );
            return {
              id: cb.dataset.clipId,
              audio_url: cb.dataset.audioUrl,
              title: track?.title || "Untitled",
              workspaceName: track?.workspaceName || "Unknown",
            };
          });

        const selected = baseSelection.filter((track) => {
          const alreadyDownloaded =
            isTrackDownloaded(track.id, "mp3") ||
            isTrackDownloaded(track.id, "wav");
          if (alreadyDownloaded) {
            const checkbox = container.querySelector(
              `.track-checkbox[data-clip-id="${track.id}"]`
            );
            if (checkbox) checkbox.checked = false;
          }
          return !alreadyDownloaded;
        });

        if (selected.length === 0) {
          alert(getMessage("noNewTracksSelected"));
          return;
        }

        downloadSelectedTracksAsWav(selected);
      });

    // Individual download buttons - MP3
    container.querySelectorAll(".download-single-mp3").forEach((btn) => {
      btn.addEventListener("click", () => {
        const clipId = btn.dataset.clipId;
        const audioUrl = btn.dataset.audioUrl;
        const title = btn.dataset.title;
        const track = downloadableTracks.find((t) => t.id === clipId);
        const workspaceName = track?.workspaceName || "Unknown";

        // Use downloadSelectedTracks to show progress UI (treat as batch of one)
        const trackObj = {
          id: clipId,
          audio_url: audioUrl,
          title: title,
          workspaceName: workspaceName,
        };
        downloadSelectedTracks([trackObj], "mp3");
      });
    });

    // Individual download buttons - WAV
    container.querySelectorAll(".download-single-wav").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const clipId = btn.dataset.clipId;
        const title = btn.dataset.title;
        const track = downloadableTracks.find((t) => t.id === clipId);
        const workspaceName = track?.workspaceName || "Unknown";

        // Use downloadSelectedTracksAsWav to show progress UI (treat as batch of one)
        const trackObj = {
          id: clipId,
          audio_url: track?.audio_url,
          title: title,
          workspaceName: workspaceName,
        };
        downloadSelectedTracksAsWav([trackObj]);
      });
    });

    // Unlock buttons - reset individual track download status
    container.querySelectorAll(".unlock-track").forEach((btn) => {
      btn.addEventListener("click", () => {
        const clipId = btn.dataset.clipId;
        clearTrackDownload(clipId);
        refreshTrackUI(clipId);
      });
    });

    // Export button - starts as "Download Track List", changes to "Download All Metadata" after metadata fetch
    const exportBtn = container.querySelector("#export-sunolibrary");
    if (exportBtn) {
      // Store initial state
      exportBtn.dataset.isSimple = "true";

      exportBtn.addEventListener("click", async () => {
        exportBtn.disabled = true;
        exportBtn.textContent = `⏳ ${
          getMessage("exporting") || "Exporting..."
        }`;
        try {
          const isSimple = exportBtn.dataset.isSimple === "true";
          if (isSimple) {
            // Download simple CSV (no metadata)
            await downloadSimpleTrackList(downloadableTracks);
            exportBtn.textContent = `📦 ${
              getMessage("downloadTrackList") || "Download Track List"
            }`;
          } else {
            // Download full CSV + JSON (with metadata)
            await downloadTracksAsCSVZip(downloadableTracks);
            exportBtn.textContent = `📋 ${
              getMessage("downloadAllMetadata") || "Download All Metadata"
            }`;
          }
          exportBtn.disabled = false;
        } catch (error) {
          console.error("Error exporting:", error);
          alert(`Error exporting: ${error.message}`);
          exportBtn.disabled = false;
          const isSimple = exportBtn.dataset.isSimple === "true";
          exportBtn.textContent = isSimple
            ? `📦 ${getMessage("downloadTrackList") || "Download Track List"}`
            : `📋 ${
                getMessage("downloadAllMetadata") || "Download All Metadata"
              }`;
        }
      });
    }

    // Reset all downloads button
    const resetAllBtn = container.querySelector("#reset-all-downloads");
    if (resetAllBtn) {
      resetAllBtn.addEventListener("click", () => {
        if (confirm(getMessage("confirmReset"))) {
          clearDownloadedTracks();
          // Refresh all track UIs
          downloadableTracks.forEach((track) => {
            refreshTrackUI(track.id);
          });
        }
      });
    }

    // Clear all extension data button
    const clearAllDataBtn = container.querySelector("#clear-all-data");
    if (clearAllDataBtn) {
      clearAllDataBtn.addEventListener("click", async () => {
        const confirmMessage =
          getMessage("confirmClearAllData") ||
          "This will clear ALL extension data including:\n- All cached tracks and workspaces\n- All metadata\n- Download history\n- Authentication token\n\nYou will need to visit suno.com again to re-authenticate.\n\nThis action cannot be undone. Continue?";

        if (confirm(confirmMessage)) {
          clearAllDataBtn.disabled = true;
          clearAllDataBtn.textContent =
            "⏳ " + (getMessage("clearing") || "Clearing...");

          try {
            await clearAllExtensionData();
            alert(
              getMessage("clearAllDataComplete") ||
                "All extension data has been cleared. The page will reload."
            );
            window.location.reload();
          } catch (error) {
            console.error("Error clearing extension data:", error);
            const errorMsg =
              formatMessage("clearAllDataError", { error: error.message }) ||
              `Error clearing data: ${error.message}`;
            alert(errorMsg);
            clearAllDataBtn.disabled = false;
            clearAllDataBtn.textContent =
              "🗑️ " + (getMessage("clearAllData") || "Clear All Data");
          }
        }
      });
    }
  } catch (error) {
    container.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
  }
}

// Create reusable filter component
function createFilterComponent(
  containerId,
  isDarkMode,
  textColor,
  secondaryTextColor,
  borderColor
) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container ${containerId} not found`);
    return null;
  }

  // Load saved state from localStorage (default: all off)
  const savedStems = localStorage.getItem("filterStems");
  const savedUpload = localStorage.getItem("filterUpload");
  const savedLiked = localStorage.getItem("filterLiked");
  const savedNotLiked = localStorage.getItem("filterNotLiked");

  // Default to all off if not set
  const defaultStems = savedStems === null ? false : savedStems === "true";
  const defaultUpload = savedUpload === null ? false : savedUpload === "true";
  const defaultLiked = savedLiked === null ? false : savedLiked === "true";
  const defaultNotLiked =
    savedNotLiked === null ? false : savedNotLiked === "true";

  // Create filter bar element
  const filterBar = document.createElement("div");
  filterBar.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 16px;
    padding: 12px;
    background: ${isDarkMode ? "#2a2a2a" : "#f5f5f5"};
    border-radius: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  `;

  // Add "Hide" title/label
  const hideLabel = document.createElement("span");
  hideLabel.style.cssText = `color: ${textColor}; font-size: 13px; font-weight: 600; margin-right: 8px;`;
  hideLabel.textContent = getMessage("hide") || "Hide";
  filterBar.appendChild(hideLabel);

  // Filter checkboxes (without "Hide:" prefix in label)
  const filters = [
    {
      key: "stems",
      label: getMessage("filterStems") || "Stems",
    },
    {
      key: "upload",
      label: getMessage("filterUpload") || "Upload",
    },
    {
      key: "notLiked",
      label: getMessage("filterNotLiked") || "Not Liked",
    },
    {
      key: "liked",
      label: getMessage("filterLiked") || "Liked",
    },
  ];

  const filterCheckboxes = {};
  filters.forEach((filter) => {
    const label = document.createElement("label");
    label.style.cssText = `display: flex; align-items: center; gap: 8px; color: ${textColor}; font-size: 13px;`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `${containerId}-filter-${filter.key}`;
    // Load saved state for each filter (default: off)
    if (filter.key === "stems") {
      checkbox.checked = defaultStems;
    } else if (filter.key === "upload") {
      checkbox.checked = defaultUpload;
    } else if (filter.key === "liked") {
      checkbox.checked = defaultLiked;
    } else if (filter.key === "notLiked") {
      checkbox.checked = defaultNotLiked;
    }
    checkbox.style.cursor = "pointer";
    filterCheckboxes[filter.key] = checkbox;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(filter.label));
    filterBar.appendChild(label);
  });

  container.appendChild(filterBar);

  // Get current state
  const getState = () => ({
    stems: filterCheckboxes.stems.checked,
    upload: filterCheckboxes.upload.checked,
    liked: filterCheckboxes.liked.checked,
    notLiked: filterCheckboxes.notLiked.checked,
  });

  // Save state to localStorage
  const saveState = () => {
    const state = getState();
    localStorage.setItem("filterStems", state.stems);
    localStorage.setItem("filterUpload", state.upload);
    localStorage.setItem("filterLiked", state.liked);
    localStorage.setItem("filterNotLiked", state.notLiked);
  };

  // Create filter component object
  const filterComponent = {
    state: getState,
    element: filterBar,
    filterCheckboxes,
    updateFilter: null, // Will be set by caller
  };

  // Individual filter checkboxes
  Object.values(filterCheckboxes).forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      saveState();
      // Trigger filter update if callback is set
      if (filterComponent.updateFilter) {
        filterComponent.updateFilter();
      }
    });
  });

  return filterComponent;
}

// Create "All workspaces" header component
function createAllWorkspacesHeader(
  isDarkMode,
  textColor,
  secondaryTextColor,
  borderColor,
  headerBgColor
) {
  const header = document.createElement("div");
  header.className = "all-workspaces-header";
  header.style.cssText = `
    background: ${headerBgColor};
    padding: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    user-select: none;
    border: 1px solid ${borderColor};
    border-radius: 8px;
    margin-bottom: 8px;
  `;

  const selectAllCheckbox = document.createElement("input");
  selectAllCheckbox.type = "checkbox";
  selectAllCheckbox.className = "select-all-workspaces";
  selectAllCheckbox.style.cursor = "pointer";

  const titleSpan = document.createElement("span");
  titleSpan.style.cssText = `font-weight: 600; color: ${textColor}; flex: 1;`;
  titleSpan.textContent = getMessage("allWorkspaces") || "All workspaces";

  header.appendChild(selectAllCheckbox);
  header.appendChild(titleSpan);

  return {
    element: header,
    selectAllCheckbox,
  };
}

// Reusable filter function for tracks
function applyFiltersToTracks(tracks, filterState) {
  const { stems, upload, liked, notLiked } = filterState;

  // Hide mode: by default show all tracks, hide tracks that match checked filters
  return tracks.map((track) => {
    // Determine track types
    const isStem =
      (track.metadata && track.metadata.stem_from_id) ||
      (track.metadata && track.metadata.stem_type_id) ||
      (track.metadata && track.metadata.stem_type_group_name) ||
      (track.metadata && track.metadata.type === "stem") ||
      track.is_stem === true ||
      (track.title && track.title.toLowerCase().includes("(stem)")) ||
      track.type === "stem";

    const isUpload =
      (track.metadata && track.metadata.type === "upload") ||
      track.type === "upload";

    const isLiked =
      track.liked === true ||
      track.is_liked === true ||
      track.favorite === true ||
      (track.metadata && track.metadata.liked === true) ||
      (track.metadata && track.metadata.is_liked === true);

    const isNotLiked = !isLiked;

    // Hide tracks that match any checked filter
    const shouldHide =
      (stems && isStem) ||
      (upload && isUpload) ||
      (liked && isLiked) ||
      (notLiked && isNotLiked);

    // Show track if it should not be hidden
    return { track, shouldShow: !shouldHide };
  });
}

// Helper function to sanitize filename
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100); // Limit length
}

// Global flag to stop downloads
let stopDownloadFlag = false;

// Download selected tracks
async function downloadSelectedTracks(tracks, format = "mp3") {
  const progressDiv = document.getElementById("download-progress");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const stopButton = document.getElementById("stop-download");

  progressDiv.style.display = "block";
  progressBar.style.width = "0%";
  stopButton.style.display = "block";
  stopButton.disabled = false;
  stopButton.textContent = getMessage("stop");
  stopDownloadFlag = false;

  // Add stop button handler
  const stopHandler = () => {
    stopDownloadFlag = true;
    stopButton.disabled = true;
    stopButton.textContent = getMessage("stoppingDownloads");
    progressText.textContent = `⏹️ ${getMessage("stoppingDownloads")}`;
  };
  stopButton.onclick = stopHandler;

  let completed = 0;
  let failed = 0;
  const total = tracks.length;

  // Sequential downloads with random delays to avoid API blocks
  for (let i = 0; i < tracks.length; i++) {
    if (stopDownloadFlag) {
      progressText.textContent = `⏹️ ${getMessage("stopped")} ${getMessage(
        "downloaded"
      )} ${completed} ${getMessage("of")} ${total} ${getMessage("tracks")}${
        failed > 0 ? ` (${failed} failed)` : ""
      }`;
      stopButton.style.display = "none";
      break;
    }

    const track = tracks[i];
    const workspaceName = sanitizeFilename(track.workspaceName || "Unknown");
    const trackName = sanitizeFilename(track.title || "Untitled");
    const filename = `${workspaceName}-${trackName}-${track.id}.${format}`;

    // Update progress before download
    progressText.textContent = `${getMessage("downloading")} ${
      i + 1
    }/${total}: ${trackName}...`;

    // Wait for download to complete before starting next (sequential, not concurrent)
    try {
      await downloadTrack(track.audio_url, filename, track.id, format);
      if (!stopDownloadFlag) {
        completed++;
        // Update progress
        const percent = Math.round(((completed + failed) / total) * 100);
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${getMessage(
          "downloaded"
        )} ${completed} ${getMessage("of")} ${total} ${getMessage(
          "tracks"
        )} (${percent}%)${failed > 0 ? ` - ${failed} failed` : ""}`;

        if (completed + failed === total) {
          progressText.textContent = `✅ ${getMessage(
            "completed"
          )} ${getMessage("downloaded")} ${completed} ${getMessage(
            "of"
          )} ${total} ${getMessage("tracks")}${
            failed > 0 ? ` (${failed} failed)` : ""
          }`;
          stopButton.style.display = "none";
        }
      }
    } catch (error) {
      if (!stopDownloadFlag) {
        console.error(`Failed to download ${track.title}:`, error);
        failed++;
        const percent = Math.round(((completed + failed) / total) * 100);
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${getMessage(
          "downloaded"
        )} ${completed} ${getMessage("of")} ${total} ${getMessage(
          "tracks"
        )} (${percent}%)${failed > 0 ? ` - ${failed} failed` : ""}`;

        if (completed + failed === total) {
          progressText.textContent = `✅ ${getMessage(
            "completed"
          )} ${getMessage("downloaded")} ${completed} ${getMessage(
            "of"
          )} ${total} ${getMessage("tracks")}${
            failed > 0 ? ` (${failed} failed)` : ""
          }`;
          stopButton.style.display = "none";
        }
      }
    }

    // Random delay between downloads to avoid API throttling (1-3 seconds)
    if (i < tracks.length - 1 && !stopDownloadFlag) {
      const delay = 1000 + Math.random() * 2000; // 1000-3000ms
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Download a single track
async function downloadTrack(url, filename, clipId = null, format = "mp3") {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "downloadFile",
        url: url,
        filename: filename,
        clipId: clipId,
        format: format,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.success) {
          resolve();
        } else {
          reject(new Error(response?.error || "Download failed"));
        }
      }
    );
  });
}

// Update track UI when marked as downloaded
function updateTrackUI(clipId, format) {
  // Mark as downloaded in localStorage
  markTrackAsDownloaded(clipId, format);

  // Use refreshTrackUI to update the UI
  refreshTrackUI(clipId);
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "markDownloaded") {
    updateTrackUI(request.clipId, request.format);
    sendResponse({ success: true });
  }
  if (request.action === "rateLimitNotification") {
    // Show notification to user
    showRateLimitNotification(request.message);
    sendResponse({ success: true });
  }
});

// Show rate limit notification to user
function showRateLimitNotification(message) {
  // Try to find existing notification or create new one
  let notification = document.getElementById("suno-rate-limit-notification");

  if (!notification) {
    notification = document.createElement("div");
    notification.id = "suno-rate-limit-notification";
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff9800;
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      max-width: 400px;
      font-size: 14px;
      line-height: 1.5;
      display: flex;
      align-items: center;
      gap: 12px;
    `;
    document.body.appendChild(notification);
  }

  notification.innerHTML = `
    <span style="font-size: 20px;">⚠️</span>
    <div>
      <strong>Rate Limit Detected</strong><br>
      <span style="font-size: 12px; opacity: 0.9;">${message}</span>
    </div>
  `;

  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (notification && notification.parentNode) {
      notification.style.opacity = "0";
      notification.style.transition = "opacity 0.5s";
      setTimeout(() => {
        if (notification && notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 500);
    }
  }, 10000);
}

// Convert and download a single track as WAV
async function convertAndDownloadWav(clipId, filename) {
  const progressDiv = document.getElementById("download-progress");
  const progressText = document.getElementById("progress-text");

  if (progressDiv) {
    progressDiv.style.display = "block";
    progressText.textContent = `${getMessage("converting")} ${filename}...`;
  }

  try {
    // Step 1: Initiate conversion
    const initiateResponse = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "initiateWavConversion", clipId: clipId },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.success) {
            resolve();
          } else {
            reject(
              new Error(response?.error || "Conversion initiation failed")
            );
          }
        }
      );
    });

    // Step 2: Poll for WAV file
    if (progressText) {
      progressText.textContent = `${getMessage("waitingForConversion")}`;
    }

    const wavUrlResponse = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "pollWavFile", clipId: clipId },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.success) {
            resolve(response.url);
          } else {
            reject(new Error(response?.error || "WAV conversion failed"));
          }
        }
      );
    });

    // Step 3: Download WAV file
    if (progressText) {
      progressText.textContent = `${getMessage("downloading")} ${filename}...`;
    }

    await downloadTrack(wavUrlResponse, filename, clipId, "wav");

    if (progressText) {
      progressText.textContent = `✅ ${getMessage("downloaded")} ${filename}`;
    }

    return wavUrlResponse;
  } catch (error) {
    if (progressText) {
      progressText.textContent = `❌ Error: ${error.message}`;
    }
    throw error;
  }
}

// Download selected tracks as WAV
async function downloadSelectedTracksAsWav(tracks) {
  const progressDiv = document.getElementById("download-progress");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const stopButton = document.getElementById("stop-download");

  progressDiv.style.display = "block";
  progressBar.style.width = "0%";
  stopButton.style.display = "block";
  stopButton.disabled = false;
  stopButton.textContent = getMessage("stop");
  stopDownloadFlag = false;

  // Add stop button handler
  const stopHandler = () => {
    stopDownloadFlag = true;
    stopButton.disabled = true;
    stopButton.textContent = getMessage("stoppingDownloads");
    progressText.textContent = `⏹️ ${getMessage("stoppingDownloads")}`;
  };
  stopButton.onclick = stopHandler;

  let completed = 0;
  let failed = 0;
  const total = tracks.length;

  for (let i = 0; i < tracks.length; i++) {
    if (stopDownloadFlag) {
      progressText.textContent = `⏹️ ${getMessage("stopped")} ${getMessage(
        "converting"
      )} ${completed} ${getMessage("of")} ${total} ${getMessage("tracks")}${
        failed > 0 ? ` (${failed} failed)` : ""
      }`;
      stopButton.style.display = "none";
      break;
    }

    const track = tracks[i];
    const workspaceName = sanitizeFilename(track.workspaceName || "Unknown");
    const trackName = sanitizeFilename(track.title || "Untitled");
    const filename = `${workspaceName}-${trackName}-${track.id}.wav`;

    try {
      progressText.textContent = `${getMessage("converting")} ${
        i + 1
      }/${total}: ${track.title || "Untitled"}...`;
      await convertAndDownloadWav(track.id, filename);
      if (!stopDownloadFlag) {
        completed++;
        // Update progress
        const percent = Math.round(((completed + failed) / total) * 100);
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${getMessage(
          "converting"
        )} ${completed} ${getMessage("of")} ${total} ${getMessage(
          "tracks"
        )} (${percent}%)${failed > 0 ? ` - ${failed} failed` : ""}`;
      }
    } catch (error) {
      if (!stopDownloadFlag) {
        console.error(`Failed to convert ${track.title}:`, error);
        failed++;
        const percent = Math.round(((completed + failed) / total) * 100);
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${getMessage(
          "converting"
        )} ${completed} ${getMessage("of")} ${total} ${getMessage(
          "tracks"
        )} (${percent}%)${failed > 0 ? ` - ${failed} failed` : ""}`;
      }
    }

    // Random delay between conversions to avoid rate limiting (2-4 seconds)
    if (i < tracks.length - 1 && !stopDownloadFlag) {
      const delay = 2000 + Math.random() * 2000; // 2000-4000ms
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  if (!stopDownloadFlag) {
    progressText.textContent = `✅ ${getMessage("completed")} ${getMessage(
      "converting"
    )} ${completed} ${getMessage("of")} ${total} ${getMessage("tracks")}${
      failed > 0 ? ` (${failed} failed)` : ""
    }`;
    stopButton.style.display = "none";
  }
}

// Attempt to extract token from page
async function attemptTokenExtraction() {
  // The webRequest listener in background.js will automatically capture tokens
  // from any API requests the page makes. We just need to wait a bit for
  // the page to make its natural API calls.

  // Also try to trigger a page navigation/refresh to capture token from existing requests
  // by checking if we can access the page's fetch calls that might already have happened

  // Wait a moment for any pending requests
  await new Promise((resolve) => setTimeout(resolve, 500));
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractToken") {
    attemptTokenExtraction();
    // Wait a bit and check if token was saved
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: "getToken" }, (response) => {
        sendResponse({ success: response && response.success });
      });
    }, 1000);
    return true;
  }
  if (request.action === "showDownloader") {
    showDownloadModal();
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "downloadLargeFileWithMetadata") {
    // Handle large file download with metadata (content script can use URL.createObjectURL)
    handleLargeFileDownload(request)
      .then((downloadId) => sendResponse({ success: true, downloadId }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

// Handle large file download in content script (can use URL.createObjectURL)
async function handleLargeFileDownload(request) {
  try {
    // Convert base64 back to blob
    const byteCharacters = atob(request.blobData);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: request.blobType });

    // Create blob URL (content scripts can use this)
    const blobUrl = URL.createObjectURL(blob);

    // Create download link and trigger download (content script can do this)
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = request.filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up blob URL after a delay
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 30000); // Increased timeout to prevent Network Error on slow systems

    // Mark as downloaded if clipId provided
    if (request.clipId) {
      markTrackAsDownloaded(request.clipId, request.format);
      refreshTrackUI(request.clipId);
    }

    // Generate and download sidecar file if metadata is available
    if (request.metadata && Object.keys(request.metadata).length > 0) {
      const sidecarContent = generateSidecarFileContent(
        request.metadata,
        request.filename
      );
      const sidecarBlob = new Blob([sidecarContent], { type: "text/plain" });
      const sidecarBlobUrl = URL.createObjectURL(sidecarBlob);
      // Use .mp3.txt or .wav.txt to avoid conflicts
      const sidecarFilename = request.filename + ".txt";

      const sidecarLink = document.createElement("a");
      sidecarLink.href = sidecarBlobUrl;
      sidecarLink.download = sidecarFilename;
      sidecarLink.style.display = "none";
      document.body.appendChild(sidecarLink);
      sidecarLink.click();
      document.body.removeChild(sidecarLink);

      setTimeout(() => {
        URL.revokeObjectURL(sidecarBlobUrl);
      }, 30000);
    }

    return Promise.resolve(1); // Return success
  } catch (error) {
    throw error;
  }
}

// Generate sidecar file content (helper function)
function generateSidecarFileContent(metadata, filename) {
  const lines = [];
  lines.push(`Metadata for: ${filename}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("--- Track Information ---");

  if (metadata.title) lines.push(`Title: ${metadata.title}`);
  if (metadata.artist) lines.push(`Artist: ${metadata.artist}`);
  if (metadata.album) lines.push(`Album: ${metadata.album}`);
  if (metadata.genre) lines.push(`Genre: ${metadata.genre}`);
  if (metadata.year) lines.push(`Year: ${metadata.year}`);
  if (metadata.trackNumber) lines.push(`Track Number: ${metadata.trackNumber}`);

  lines.push("");
  lines.push("--- Musical Information ---");
  if (metadata.bpm) lines.push(`BPM: ${metadata.bpm}`);
  if (metadata.key) lines.push(`Key: ${metadata.key}`);

  lines.push("");
  lines.push("--- Creation Details ---");
  if (metadata.comment) lines.push(`Prompt: ${metadata.comment}`);
  if (metadata.id) lines.push(`Track ID: ${metadata.id}`);

  lines.push("");
  if (metadata.lyrics) {
    lines.push("--- Lyrics ---");
    lines.push(metadata.lyrics);
  }

  if (metadata.coverArt) {
    lines.push("");
    lines.push(`Cover Art URL: ${metadata.coverArt}`);
  }

  // Add raw API output
  if (metadata.fullData) {
    lines.push("");
    lines.push(getMessage("rawApiResponse"));
    try {
      lines.push(JSON.stringify(metadata.fullData, null, 2));
    } catch (e) {
      lines.push("(Error serializing raw data)");
    }
  }

  return lines.join("\n");
}

// Generate CSV from tracks
function generateTracksCSV(tracks, metadataMap = {}) {
  // CSV headers (simplified - no long text fields like Lyrics, Prompt)
  const headers = [
    "ID",
    "Title",
    "Workspace",
    "Workspace ID",
    "Audio URL",
    "Status",
    "Created At",
    "Duration",
    "Type",
    "Is Stem",
    "BPM",
    "Key",
    "Tags",
    "Genre",
    "Artist",
    "Cover Art URL",
    "Liked",
    "Is Upload",
  ];

  // CSV rows
  const rows = tracks.map((track) => {
    const metadata = metadataMap[track.id] || {};

    // Escape CSV values (handle commas, quotes, newlines)
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    return [
      escapeCSV(track.id),
      escapeCSV(track.title || metadata.title || ""),
      escapeCSV(track.workspaceName || ""),
      escapeCSV(track.workspaceId || ""),
      escapeCSV(track.audio_url || ""),
      escapeCSV(track.status || ""),
      escapeCSV(track.created_at || ""),
      escapeCSV(
        track.metadata?.duration || track.duration || metadata.duration || ""
      ),
      escapeCSV(track.type || ""),
      escapeCSV(track.is_stem || false),
      // Simple fields only (no Lyrics, Prompt - those go in JSON)
      escapeCSV(metadata.bpm || ""),
      escapeCSV(metadata.key || ""),
      escapeCSV(metadata.tags || ""),
      escapeCSV(metadata.genre || ""),
      escapeCSV(metadata.artist || ""),
      escapeCSV(metadata.coverArt || ""),
      escapeCSV(track.liked || metadata.liked || false),
      escapeCSV(track.type === "upload" || metadata.type === "upload"),
    ].join(",");
  });

  // Combine headers and rows
  return [headers.join(","), ...rows].join("\n");
}

// Generate JSON file with full metadata including long text fields
function generateTracksJSON(tracks, metadataMap = {}) {
  const tracksData = tracks.map((track) => {
    const metadata = metadataMap[track.id] || {};
    return {
      id: track.id,
      title: track.title || metadata.title || "",
      workspace: track.workspaceName || "",
      workspaceId: track.workspaceId || "",
      audioUrl: track.audio_url || "",
      status: track.status || "",
      createdAt: track.created_at || "",
      duration:
        track.metadata?.duration || track.duration || metadata.duration || null,
      type: track.type || "",
      isStem: track.is_stem || false,
      // Include all metadata fields including long text
      lyrics: metadata.lyrics || null,
      bpm: metadata.bpm || null,
      key: metadata.key || null,
      prompt: metadata.prompt || null,
      tags: metadata.tags || null,
      genre: metadata.genre || null,
      artist: metadata.artist || "",
      coverArtUrl: metadata.coverArt || null,
      liked: track.liked || metadata.liked || false,
      isUpload: track.type === "upload" || metadata.type === "upload",
    };
  });

  return JSON.stringify(tracksData, null, 2);
}

// Generate simple CSV without metadata (for initial download)
function generateSimpleTracksCSV(tracks) {
  const headers = [
    "ID",
    "Title",
    "Workspace",
    "Workspace ID",
    "Audio URL",
    "Status",
    "Created At",
    "Duration",
    "Type",
    "Is Stem",
  ];

  const escapeCSV = (value) => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = tracks.map((track) => {
    return [
      escapeCSV(track.id),
      escapeCSV(track.title || ""),
      escapeCSV(track.workspaceName || ""),
      escapeCSV(track.workspaceId || ""),
      escapeCSV(track.audio_url || ""),
      escapeCSV(track.status || ""),
      escapeCSV(track.created_at || ""),
      escapeCSV(track.metadata?.duration || track.duration || ""),
      escapeCSV(track.type || ""),
      escapeCSV(track.is_stem || false),
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// Helper function to generate scripts (used by both simple and full downloads)
function generateScripts() {
  // Helper function to sanitize strings for scripts
  function sanitizeForScript(text) {
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const checkingMsg = sanitizeForScript(getMessage("scriptCheckingMissing"));
  const totalTracksMsg = sanitizeForScript(getMessage("scriptTotalTracks"));
  const foundMsg = sanitizeForScript(getMessage("scriptFoundTracks"));
  const missingMsg = sanitizeForScript(getMessage("scriptMissingTracks"));
  const duplicatesMsg = sanitizeForScript(getMessage("scriptDuplicates"));
  const mp3OnlyMsg = sanitizeForScript(getMessage("scriptMp3Only"));
  const wavOnlyMsg = sanitizeForScript(getMessage("scriptWavOnly"));
  const bothFormatsMsg = sanitizeForScript(getMessage("scriptBothFormats"));
  const resultsSavedMsg = sanitizeForScript(getMessage("scriptResultsSaved"));
  const missingTracksFileMsg = sanitizeForScript(
    getMessage("scriptMissingTracksFile")
  );
  const useCustomDownloadMsg = sanitizeForScript(
    getMessage("scriptUseCustomDownload")
  );
  const extensionLimitationMsg = sanitizeForScript(
    getMessage("scriptExtensionLimitation")
  );

  // Generate .bat script (same as in full download - copy the entire script)
  const batScript = `@echo off
setlocal enabledelayedexpansion

echo ${checkingMsg}
echo.

set "missingCount=0"
set "foundCount=0"
set "totalCount=0"
set "duplicateCount=0"
set "mp3OnlyCount=0"
set "wavOnlyCount=0"
set "bothFormatsCount=0"

REM Clear existing files
if exist "missing-tracks.txt" del "missing-tracks.txt"
if exist "duplicates.txt" del "duplicates.txt"
type nul > "missing-tracks.txt"
type nul > "duplicates.txt"

REM Write header to missing-tracks.txt
echo trackId,mp3Found,wavFound,txtFound > "missing-tracks.txt"

REM Read CSV file and check each track
for /f "usebackq tokens=1,2,3* delims=," %%a in ("suno-tracks-list.csv") do (
    REM Skip header row
    if /i not "%%a"=="ID" (
        set "trackId=%%a"
        set "title=%%b"
        set "workspace=%%c"
        
        REM Remove quotes if present
        set "trackId=!trackId:"=!"
        set "title=!title:"=!"
        set "workspace=!workspace:"=!"
        
        REM Skip if trackId is empty
        if not "!trackId!"=="" (
            set /a totalCount+=1
            set "mp3Found=false"
            set "wavFound=false"
            set "txtFound=false"
            set "mp3Count=0"
            set "wavCount=0"
            set "txtCount=0"
            set "mp3Files="
            set "wavFiles="
            set "txtFiles="
            
            REM Check for .mp3 files
            for %%f in (*!trackId!*.mp3) do (
                set /a mp3Count+=1
                set "mp3Found=true"
                for %%t in ("%%f") do set "fileDate=%%~tf"
                set "mp3Files=!mp3Files!%%f|!fileDate!;"
                set "fileDate="
            )
            
            REM Check for .wav files
            for %%f in (*!trackId!*.wav) do (
                set /a wavCount+=1
                set "wavFound=true"
                for %%t in ("%%f") do set "fileDate=%%~tf"
                set "wavFiles=!wavFiles!%%f|!fileDate!;"
                set "fileDate="
            )
            
            REM Check for .txt files
            for %%f in (*!trackId!*.txt) do (
                set /a txtCount+=1
                set "txtFound=true"
                for %%t in ("%%f") do set "fileDate=%%~tf"
                set "txtFiles=!txtFiles!%%f|!fileDate!;"
                set "fileDate="
            )
            
            REM Build duplicates info
            set "hasDuplicates=0"
            if !mp3Count! gtr 1 set "hasDuplicates=1"
            if !wavCount! gtr 1 set "hasDuplicates=1"
            if !txtCount! gtr 1 set "hasDuplicates=1"
            
            if "!hasDuplicates!"=="1" (
                echo !trackId! >> "duplicates.txt"
                if !mp3Count! gtr 1 (
                    set "tempStr=!mp3Files!"
                    :loopMp3
                    for /f "tokens=1* delims=;" %%a in ("!tempStr!") do (
                        set "fileEntry=%%a"
                        if defined fileEntry (
                            for /f "tokens=1 delims=|" %%f in ("!fileEntry!") do echo %%f >> "duplicates.txt"
                        )
                        set "tempStr=%%b"
                    )
                    if defined tempStr goto loopMp3
                )
                if !wavCount! gtr 1 (
                    set "tempStr=!wavFiles!"
                    :loopWav
                    for /f "tokens=1* delims=;" %%a in ("!tempStr!") do (
                        set "fileEntry=%%a"
                        if defined fileEntry (
                            for /f "tokens=1 delims=|" %%f in ("!fileEntry!") do echo %%f >> "duplicates.txt"
                        )
                        set "tempStr=%%b"
                    )
                    if defined tempStr goto loopWav
                )
                if !txtCount! gtr 1 (
                    set "tempStr=!txtFiles!"
                    :loopTxt
                    for /f "tokens=1* delims=;" %%a in ("!tempStr!") do (
                        set "fileEntry=%%a"
                        if defined fileEntry (
                            for /f "tokens=1 delims=|" %%f in ("!fileEntry!") do echo %%f >> "duplicates.txt"
                        )
                        set "tempStr=%%b"
                    )
                    if defined tempStr goto loopTxt
                )
                echo. >> "duplicates.txt"
                echo. >> "duplicates.txt"
                set /a duplicateCount+=1
            )
            
            REM Count format types
            if "!mp3Found!"=="true" (
                if "!wavFound!"=="true" (
                    set /a bothFormatsCount+=1
                ) else (
                    set /a mp3OnlyCount+=1
                )
            ) else if "!wavFound!"=="true" (
                set /a wavOnlyCount+=1
            )
            
            REM Check if track is missing
            set "isMissing=0"
            if "!mp3Found!"=="false" set "isMissing=1"
            if "!wavFound!"=="false" set "isMissing=1"
            if "!txtFound!"=="false" set "isMissing=1"
            
            REM Write to missing-tracks.txt ONLY if track is missing
            if "!isMissing!"=="1" (
                echo !trackId!,!mp3Found!,!wavFound!,!txtFound! >> "missing-tracks.txt"
            )
            
            REM Count found and missing
            if "!mp3Found!"=="true" set "found=1"
            if "!wavFound!"=="true" set "found=1"
            if "!txtFound!"=="true" set "found=1"
            
            if defined found (
                set /a foundCount+=1
                set "found="
            ) else (
                set /a missingCount+=1
            )
        )
    )
)

echo.
echo ${totalTracksMsg} !totalCount!
echo ${foundMsg} !foundCount! tracks ^(!mp3OnlyCount! ${mp3OnlyMsg}, !wavOnlyCount! ${wavOnlyMsg}, !bothFormatsCount! ${bothFormatsMsg}^)
echo ${missingMsg} !missingCount! tracks
if !duplicateCount! gtr 0 (
    echo ${duplicatesMsg} !duplicateCount! tracks
)
echo.
echo ${missingTracksFileMsg}
echo.
echo ${useCustomDownloadMsg}
echo.
echo ${extensionLimitationMsg}
echo.
pause
`;

  // Generate .sh script (simplified version)
  const shScript = `#!/bin/bash
# ${checkingMsg}

missing_count=0
found_count=0
total_count=0
duplicate_count=0
mp3_only_count=0
wav_only_count=0
both_formats_count=0

rm -f missing-tracks.txt duplicates.txt
echo "trackId,mp3Found,wavFound,txtFound" > missing-tracks.txt

while IFS=',' read -r track_id title workspace rest; do
    if [[ "\\$track_id" == "ID" ]]; then
        continue
    fi
    
    track_id=\$(echo "\\$track_id" | tr -d '"')
    if [[ -z "\\$track_id" ]]; then
        continue
    fi
    
    ((total_count++))
    
    mp3_found=false
    wav_found=false
    txt_found=false
    mp3_count=0
    wav_count=0
    txt_count=0
    mp3_files=""
    wav_files=""
    txt_files=""
    
    for file in *"\\$track_id"*.mp3; do
        if [[ -f "\\$file" ]]; then
            ((mp3_count++))
            mp3_found=true
            file_date=\$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "\\$file" 2>/dev/null || stat -c "%y" "\\$file" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
            mp3_files="\${mp3_files}\${file}|\${file_date};"
        fi
    done
    
    for file in *"\\$track_id"*.wav; do
        if [[ -f "\\$file" ]]; then
            ((wav_count++))
            wav_found=true
            file_date=\$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "\\$file" 2>/dev/null || stat -c "%y" "\\$file" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
            wav_files="\${wav_files}\${file}|\${file_date};"
        fi
    done
    
    for file in *"\\$track_id"*.txt; do
        if [[ -f "\\$file" ]]; then
            ((txt_count++))
            txt_found=true
            file_date=\$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "\\$file" 2>/dev/null || stat -c "%y" "\\$file" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
            txt_files="\${txt_files}\${file}|\${file_date};"
        fi
    done
    
    has_duplicates=0
    if [[ \\$mp3_count -gt 1 ]] || [[ \\$wav_count -gt 1 ]] || [[ \\$txt_count -gt 1 ]]; then
        has_duplicates=1
    fi
    
    if [[ \\$has_duplicates -eq 1 ]]; then
        echo "\\$track_id" >> duplicates.txt
        if [[ \\$mp3_count -gt 1 ]]; then
            IFS=';' read -ra MP3_ARRAY <<< "\\$mp3_files"
            for file_entry in "\${MP3_ARRAY[@]}"; do
                if [[ -n "\\$file_entry" ]]; then
                    filename=\$(echo "\\$file_entry" | cut -d'|' -f1)
                    echo "\\$filename" >> duplicates.txt
                fi
            done
        fi
        if [[ \\$wav_count -gt 1 ]]; then
            IFS=';' read -ra WAV_ARRAY <<< "\\$wav_files"
            for file_entry in "\${WAV_ARRAY[@]}"; do
                if [[ -n "\\$file_entry" ]]; then
                    filename=\$(echo "\\$file_entry" | cut -d'|' -f1)
                    echo "\\$filename" >> duplicates.txt
                fi
            done
        fi
        if [[ \\$txt_count -gt 1 ]]; then
            IFS=';' read -ra TXT_ARRAY <<< "\\$txt_files"
            for file_entry in "\${TXT_ARRAY[@]}"; do
                if [[ -n "\\$file_entry" ]]; then
                    filename=\$(echo "\\$file_entry" | cut -d'|' -f1)
                    echo "\\$filename" >> duplicates.txt
                fi
            done
        fi
        echo "" >> duplicates.txt
        echo "" >> duplicates.txt
        ((duplicate_count++))
    fi
    
    if [[ "\\$mp3_found" == "true" ]]; then
        if [[ "\\$wav_found" == "true" ]]; then
            ((both_formats_count++))
        else
            ((mp3_only_count++))
        fi
    elif [[ "\\$wav_found" == "true" ]]; then
        ((wav_only_count++))
    fi
    
    is_missing=0
    if [[ "\\$mp3_found" == "false" ]] || [[ "\\$wav_found" == "false" ]] || [[ "\\$txt_found" == "false" ]]; then
        is_missing=1
    fi
    
    if [[ \\$is_missing -eq 1 ]]; then
        if [[ \\$has_duplicates -eq 1 ]]; then
            echo "\\$track_id,\\$mp3_found,\\$wav_found,\\$txt_found,\"\\$duplicates_info\"" >> missing-tracks.txt
        else
            echo "\\$track_id,\\$mp3_found,\\$wav_found,\\$txt_found," >> missing-tracks.txt
        fi
    fi
    
    if [[ "\\$mp3_found" == "true" ]] || [[ "\\$wav_found" == "true" ]] || [[ "\\$txt_found" == "true" ]]; then
        ((found_count++))
    else
        ((missing_count++))
    fi
done < suno-tracks-list.csv

echo ""
echo "${totalTracksMsg} \\$total_count"
echo "${foundMsg} \\$found_count tracks (\\$mp3_only_count ${mp3OnlyMsg}, \\$wav_only_count ${wavOnlyMsg}, \\$both_formats_count ${bothFormatsMsg})"
echo "${missingMsg} \\$missing_count tracks"
if [[ \\$duplicate_count -gt 0 ]]; then
    echo "${duplicatesMsg} \\$duplicate_count tracks"
fi
echo ""
echo "${missingTracksFileMsg}"
echo ""
echo "${useCustomDownloadMsg}"
echo ""
echo "${extensionLimitationMsg}"
echo ""
`;

  // Generate README content
  const readmeContent = `${getMessage("readmeTitle")}

${getMessage("readmeContains")}
${getMessage("readmeCsvFile")}
${
  getMessage("readmeJsonFile") ||
  "- suno-tracks-list.json (Full metadata including lyrics and prompts)"
}
${getMessage("readmeBatFile")}
${getMessage("readmeShFile")}
${getMessage("readmeReadmeFile")}

${getMessage("readmeHowToUse")}

${getMessage("readmeWindows")}
${getMessage("readmeWindowsStep1")}
${getMessage("readmeWindowsStep2")}
${getMessage("readmeWindowsStep3")}
${getMessage("readmeWindowsStep3a")}
${getMessage("readmeWindowsStep3b")}
${getMessage("readmeWindowsStep4")}

${getMessage("readmeLinux")}
${getMessage("readmeLinuxStep1")}
${getMessage("readmeLinuxStep2")}
${getMessage("readmeLinuxStep3")}
${getMessage("readmeLinuxStep3a")}
${getMessage("readmeLinuxStep4")}
${getMessage("readmeLinuxStep4a")}
${getMessage("readmeLinuxStep5")}
${getMessage("readmeLinuxStep5a")}
${getMessage("readmeLinuxStep5b")}
${getMessage("readmeLinuxStep6")}

${getMessage("readmeWhatScriptsDo")}

${getMessage("readmeScriptsCheck")}
${getMessage("readmeScriptsCheckMp3")}
${getMessage("readmeScriptsCheckWav")}
${getMessage("readmeScriptsCheckTxt")}

${getMessage("readmeResults")}
${getMessage("readmeMissingTracksFormat")}
${getMessage("readmeMissingTracksFormatDetail")}
${getMessage("readmeMissingTracksExample")}

${getMessage("readmeDuplicatesFormat")}
${getMessage("readmeDuplicatesFormatDetail")}
${getMessage("readmeDuplicatesNote")}

${getMessage("readmeCustomDownload")}

${getMessage("readmeCustomDownloadStep1")}
${getMessage("readmeCustomDownloadStep2")}
${getMessage("readmeCustomDownloadStep3")}
${getMessage("readmeCustomDownloadStep4")}
${getMessage("readmeCustomDownloadStep5")}

${getMessage("readmeNote")}

${getMessage("readmeSupport")}
`;

  return { batScript, shScript, readmeContent };
}

// Download simple track list (CSV + scripts, no metadata)
async function downloadSimpleTrackList(tracks) {
  try {
    if (typeof JSZip === "undefined") {
      alert("JSZip library not loaded. Please refresh the page and try again.");
      return;
    }

    const csvContent = generateSimpleTracksCSV(tracks);
    const zip = new JSZip();
    zip.file("suno-tracks-list.csv", csvContent);

    // Generate and add scripts
    const { batScript, shScript, readmeContent } = generateScripts();

    zip.file("check-library.bat", batScript);
    zip.file("check-library.sh", shScript);
    zip.file("README.txt", readmeContent);

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `suno-tracks-list-${
      new Date().toISOString().split("T")[0]
    }.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error downloading simple track list:", error);
    throw error;
  }
}

// Download tracks as CSV in a ZIP file with empty scripts
async function downloadTracksAsCSVZip(tracks) {
  try {
    // Check if JSZip is available
    if (typeof JSZip === "undefined") {
      alert("JSZip library not loaded. Please refresh the page and try again.");
      return;
    }

    // Fetch metadata for all tracks from storage
    const trackIds = tracks.map((t) => t.id);
    const metadataMap = {};

    // We need to do this in chunks to not hit storage limits if any
    // Actually chrome.storage.local.get with keys array works fine for reasonable amounts
    const storageKeys = trackIds.map((id) => `track_metadata_${id}`);

    await new Promise((resolve) => {
      chrome.storage.local.get(storageKeys, (result) => {
        trackIds.forEach((trackId) => {
          const key = `track_metadata_${trackId}`;
          if (result[key]) {
            metadataMap[trackId] = result[key];
          }
        });
        resolve();
      });
    });

    // Generate CSV content with metadata (simplified, no long text fields)
    const csvContent = generateTracksCSV(tracks, metadataMap);

    // Generate JSON content with full metadata (including lyrics, prompt, etc.)
    const jsonContent = generateTracksJSON(tracks, metadataMap);

    // Create ZIP file
    const zip = new JSZip();

    // Add CSV file (simple format for easy parsing)
    zip.file("suno-tracks-list.csv", csvContent);

    // Add JSON file (full metadata including long text fields)
    zip.file("suno-tracks-list.json", jsonContent);

    // Helper function to sanitize strings for scripts (remove special chars, keep only A-Z, a-z, 0-9, spaces)
    function sanitizeForScript(text) {
      return text
        .normalize("NFD") // Decompose accented characters
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
        .replace(/[^A-Za-z0-9\s]/g, " ") // Replace special chars with space
        .replace(/\s+/g, " ") // Collapse multiple spaces
        .trim();
    }

    // Get user's locale for script messages
    const locale = chrome.i18n.getUILanguage() || "en";
    const checkingMsg = sanitizeForScript(getMessage("scriptCheckingMissing"));
    const totalTracksMsg = sanitizeForScript(getMessage("scriptTotalTracks"));
    const foundMsg = sanitizeForScript(getMessage("scriptFoundTracks"));
    const missingMsg = sanitizeForScript(getMessage("scriptMissingTracks"));
    const duplicatesMsg = sanitizeForScript(getMessage("scriptDuplicates"));
    const mp3OnlyMsg = sanitizeForScript(getMessage("scriptMp3Only"));
    const wavOnlyMsg = sanitizeForScript(getMessage("scriptWavOnly"));
    const bothFormatsMsg = sanitizeForScript(getMessage("scriptBothFormats"));
    const resultsSavedMsg = sanitizeForScript(getMessage("scriptResultsSaved"));
    const missingTracksFileMsg = sanitizeForScript(
      getMessage("scriptMissingTracksFile")
    );
    const useCustomDownloadMsg = sanitizeForScript(
      getMessage("scriptUseCustomDownload")
    );
    const extensionLimitationMsg = sanitizeForScript(
      getMessage("scriptExtensionLimitation")
    );

    // Generate .bat script that checks for downloaded files and creates missing-tracks.txt
    const batScript = `@echo off
setlocal enabledelayedexpansion

echo ${checkingMsg}
echo.

set "missingCount=0"
set "foundCount=0"
set "totalCount=0"
set "duplicateCount=0"
set "mp3OnlyCount=0"
set "wavOnlyCount=0"
set "bothFormatsCount=0"

REM Clear existing files
if exist "missing-tracks.txt" del "missing-tracks.txt"
if exist "duplicates.txt" del "duplicates.txt"
type nul > "missing-tracks.txt"
type nul > "duplicates.txt"

REM Write header to missing-tracks.txt
echo trackId,mp3Found,wavFound,txtFound > "missing-tracks.txt"

REM Read CSV file and check each track
for /f "usebackq tokens=1,2,3* delims=," %%a in ("suno-tracks-list.csv") do (
    REM Skip header row
    if /i not "%%a"=="ID" (
        set "trackId=%%a"
        set "title=%%b"
        set "workspace=%%c"
        
        REM Remove quotes if present
        set "trackId=!trackId:"=!"
        set "title=!title:"=!"
        set "workspace=!workspace:"=!"
        
        REM Skip if trackId is empty
        if not "!trackId!"=="" (
            set /a totalCount+=1
            set "mp3Found=false"
            set "wavFound=false"
            set "txtFound=false"
            set "mp3Count=0"
            set "wavCount=0"
            set "txtCount=0"
            set "mp3Files="
            set "wavFiles="
            set "txtFiles="
            
            REM Check for .mp3 files and collect filenames with dates
            for %%f in (*!trackId!*.mp3) do (
                set /a mp3Count+=1
                set "mp3Found=true"
                REM Get file date/time - use forfiles if available, otherwise use dir
                set "fileDate="
                for /f "tokens=*" %%d in ('forfiles /m "%%f" /c "cmd /c echo @fdate @ftime" 2^>nul') do set "fileDate=%%d"
                if "!fileDate!"=="" (
                    REM Fallback: use dir to get date
                    for /f "tokens=1-4" %%a in ('dir /t:w "%%f" 2^>nul ^| findstr /i /c:"%%f"') do (
                        set "fileDate=%%d-%%a-%%b %%c"
                    )
                )
                if "!fileDate!"=="" (
                    REM Last resort: use file timestamp
                    for %%t in ("%%f") do set "fileDate=%%~tf"
                )
                set "mp3Files=!mp3Files!%%f|!fileDate!;"
                set "fileDate="
            )
            
            REM Check for .wav files and collect filenames with dates
            for %%f in (*!trackId!*.wav) do (
                set /a wavCount+=1
                set "wavFound=true"
                REM Get file date/time - use forfiles if available, otherwise use dir
                set "fileDate="
                for /f "tokens=*" %%d in ('forfiles /m "%%f" /c "cmd /c echo @fdate @ftime" 2^>nul') do set "fileDate=%%d"
                if "!fileDate!"=="" (
                    REM Fallback: use dir to get date
                    for /f "tokens=1-4" %%a in ('dir /t:w "%%f" 2^>nul ^| findstr /i /c:"%%f"') do (
                        set "fileDate=%%d-%%a-%%b %%c"
                    )
                )
                if "!fileDate!"=="" (
                    REM Last resort: use file timestamp
                    for %%t in ("%%f") do set "fileDate=%%~tf"
                )
                set "wavFiles=!wavFiles!%%f|!fileDate!;"
                set "fileDate="
            )
            
            REM Check for .txt files and collect filenames with dates
            for %%f in (*!trackId!*.txt) do (
                set /a txtCount+=1
                set "txtFound=true"
                REM Get file date/time - use forfiles if available, otherwise use dir
                set "fileDate="
                for /f "tokens=*" %%d in ('forfiles /m "%%f" /c "cmd /c echo @fdate @ftime" 2^>nul') do set "fileDate=%%d"
                if "!fileDate!"=="" (
                    REM Fallback: use dir to get date
                    for /f "tokens=1-4" %%a in ('dir /t:w "%%f" 2^>nul ^| findstr /i /c:"%%f"') do (
                        set "fileDate=%%d-%%a-%%b %%c"
                    )
                )
                if "!fileDate!"=="" (
                    REM Last resort: use file timestamp
                    for %%t in ("%%f") do set "fileDate=%%~tf"
                )
                set "txtFiles=!txtFiles!%%f|!fileDate!;"
                set "fileDate="
            )
            
            REM Build duplicates info
            set "hasDuplicates=0"
            if !mp3Count! gtr 1 set "hasDuplicates=1"
            if !wavCount! gtr 1 set "hasDuplicates=1"
            if !txtCount! gtr 1 set "hasDuplicates=1"
            
            if "!hasDuplicates!"=="1" (
                echo !trackId! >> "duplicates.txt"
                if !mp3Count! gtr 1 (
                    set "tempStr=!mp3Files!"
                    :loopMp3
                    for /f "tokens=1* delims=;" %%a in ("!tempStr!") do (
                        set "fileEntry=%%a"
                        if defined fileEntry (
                            for /f "tokens=1 delims=|" %%f in ("!fileEntry!") do echo %%f >> "duplicates.txt"
                        )
                        set "tempStr=%%b"
                    )
                    if defined tempStr goto loopMp3
                )
                if !wavCount! gtr 1 (
                    set "tempStr=!wavFiles!"
                    :loopWav
                    for /f "tokens=1* delims=;" %%a in ("!tempStr!") do (
                        set "fileEntry=%%a"
                        if defined fileEntry (
                            for /f "tokens=1 delims=|" %%f in ("!fileEntry!") do echo %%f >> "duplicates.txt"
                        )
                        set "tempStr=%%b"
                    )
                    if defined tempStr goto loopWav
                )
                if !txtCount! gtr 1 (
                    set "tempStr=!txtFiles!"
                    :loopTxt
                    for /f "tokens=1* delims=;" %%a in ("!tempStr!") do (
                        set "fileEntry=%%a"
                        if defined fileEntry (
                            for /f "tokens=1 delims=|" %%f in ("!fileEntry!") do echo %%f >> "duplicates.txt"
                        )
                        set "tempStr=%%b"
                    )
                    if defined tempStr goto loopTxt
                )
                echo. >> "duplicates.txt"
                echo. >> "duplicates.txt"
                set /a duplicateCount+=1
            )
            
            REM Count format types
            if "!mp3Found!"=="true" (
                if "!wavFound!"=="true" (
                    set /a bothFormatsCount+=1
                ) else (
                    set /a mp3OnlyCount+=1
                )
            ) else if "!wavFound!"=="true" (
                set /a wavOnlyCount+=1
            )
            
            REM If any file found, count as found
            if "!mp3Found!"=="true" set "found=1"
            if "!wavFound!"=="true" set "found=1"
            if "!txtFound!"=="true" set "found=1"
            
            REM Check if track is missing (at least one format is missing)
            set "isMissing=0"
            if "!mp3Found!"=="false" set "isMissing=1"
            if "!wavFound!"=="false" set "isMissing=1"
            if "!txtFound!"=="false" set "isMissing=1"
            
            REM Write to missing-tracks.txt ONLY if track is missing (at least one format missing)
            if "!isMissing!"=="1" (
                if "!hasDuplicates!"=="1" (
                    echo !trackId!,!mp3Found!,!wavFound!,!txtFound!,"!duplicatesInfo!" >> "missing-tracks.txt"
                ) else (
                    echo !trackId!,!mp3Found!,!wavFound!,!txtFound!, >> "missing-tracks.txt"
                )
            )
            
            REM Count found and missing tracks
            if defined found (
                set /a foundCount+=1
                set "found="
            ) else (
                set /a missingCount+=1
            )
        )
    )
)

echo.
echo ${totalTracksMsg} !totalCount!
echo ${foundMsg} !foundCount! tracks ^(!mp3OnlyCount! ${mp3OnlyMsg}, !wavOnlyCount! ${wavOnlyMsg}, !bothFormatsCount! ${bothFormatsMsg}^)
echo ${missingMsg} !missingCount! tracks
if !duplicateCount! gtr 0 (
    echo ${duplicatesMsg} !duplicateCount! tracks
)
echo.
echo ${missingTracksFileMsg}
echo.
echo ${useCustomDownloadMsg}
echo.
echo ${extensionLimitationMsg}
echo.
pause
`;

    // Add .bat script
    zip.file("check-library.bat", batScript);

    // Generate .sh script (basic version for Linux/Mac)
    const shScript = `#!/bin/bash
# ${checkingMsg}

missing_count=0
found_count=0
total_count=0
duplicate_count=0
mp3_only_count=0
wav_only_count=0
both_formats_count=0

# Clear existing files
rm -f missing-tracks.txt duplicates.txt
echo "trackId,mp3Found,wavFound,txtFound" > missing-tracks.txt

# Read CSV file and check each track
while IFS=',' read -r track_id title workspace rest; do
    # Skip header row
    if [[ "\\$track_id" == "ID" ]]; then
        continue
    fi
    
    # Remove quotes
    track_id=\$(echo "\\$track_id" | tr -d '"')
    if [[ -z "\\$track_id" ]]; then
        continue
    fi
    
    ((total_count++))
    
    mp3_found=false
    wav_found=false
    txt_found=false
    mp3_count=0
    wav_count=0
    txt_count=0
    mp3_files=""
    wav_files=""
    txt_files=""
    
    # Check for MP3 files and collect filenames with dates
    for file in *"\\$track_id"*.mp3; do
        if [[ -f "\\$file" ]]; then
            ((mp3_count++))
            mp3_found=true
            file_date=\$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "\\$file" 2>/dev/null || stat -c "%y" "\\$file" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
            mp3_files="\${mp3_files}\${file}|\${file_date};"
        fi
    done
    
    # Check for WAV files and collect filenames with dates
    for file in *"\\$track_id"*.wav; do
        if [[ -f "\\$file" ]]; then
            ((wav_count++))
            wav_found=true
            file_date=\$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "\\$file" 2>/dev/null || stat -c "%y" "\\$file" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
            wav_files="\${wav_files}\${file}|\${file_date};"
        fi
    done
    
    # Check for TXT files and collect filenames with dates
    for file in *"\\$track_id"*.txt; do
        if [[ -f "\\$file" ]]; then
            ((txt_count++))
            txt_found=true
            file_date=\$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "\\$file" 2>/dev/null || stat -c "%y" "\\$file" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
            txt_files="\${txt_files}\${file}|\${file_date};"
        fi
    done
    
    # Build duplicates info
    has_duplicates=0
    if [[ \\$mp3_count -gt 1 ]] || [[ \\$wav_count -gt 1 ]] || [[ \\$txt_count -gt 1 ]]; then
        has_duplicates=1
    fi
    
    # Write to duplicates.txt
    if [[ \\$has_duplicates -eq 1 ]]; then
        echo "\\$track_id" >> duplicates.txt
        if [[ \\$mp3_count -gt 1 ]]; then
            IFS=';' read -ra MP3_ARRAY <<< "\\$mp3_files"
            for file_entry in "\${MP3_ARRAY[@]}"; do
                if [[ -n "\\$file_entry" ]]; then
                    filename=\$(echo "\\$file_entry" | cut -d'|' -f1)
                    echo "\\$filename" >> duplicates.txt
                fi
            done
        fi
        if [[ \\$wav_count -gt 1 ]]; then
            IFS=';' read -ra WAV_ARRAY <<< "\\$wav_files"
            for file_entry in "\${WAV_ARRAY[@]}"; do
                if [[ -n "\\$file_entry" ]]; then
                    filename=\$(echo "\\$file_entry" | cut -d'|' -f1)
                    echo "\\$filename" >> duplicates.txt
                fi
            done
        fi
        if [[ \\$txt_count -gt 1 ]]; then
            IFS=';' read -ra TXT_ARRAY <<< "\\$txt_files"
            for file_entry in "\${TXT_ARRAY[@]}"; do
                if [[ -n "\\$file_entry" ]]; then
                    filename=\$(echo "\\$file_entry" | cut -d'|' -f1)
                    echo "\\$filename" >> duplicates.txt
                fi
            done
        fi
        echo "" >> duplicates.txt
        echo "" >> duplicates.txt
        ((duplicate_count++))
    fi
    
    # Count format types
    if [[ "\\$mp3_found" == "true" ]]; then
        if [[ "\\$wav_found" == "true" ]]; then
            ((both_formats_count++))
        else
            ((mp3_only_count++))
        fi
    elif [[ "\\$wav_found" == "true" ]]; then
        ((wav_only_count++))
    fi
    
    # Check if track is missing (at least one format is missing)
    is_missing=0
    if [[ "\\$mp3_found" == "false" ]] || [[ "\\$wav_found" == "false" ]] || [[ "\\$txt_found" == "false" ]]; then
        is_missing=1
    fi
    
    # Write to missing-tracks.txt ONLY if track is missing (at least one format missing)
    if [[ \\$is_missing -eq 1 ]]; then
        echo "\\$track_id,\\$mp3_found,\\$wav_found,\\$txt_found" >> missing-tracks.txt
    fi
    
    # Count found and missing
    if [[ "\\$mp3_found" == "true" ]] || [[ "\\$wav_found" == "true" ]] || [[ "\\$txt_found" == "true" ]]; then
        ((found_count++))
    else
        ((missing_count++))
    fi
done < suno-tracks-list.csv

echo ""
echo "${totalTracksMsg} \\$total_count"
echo "${foundMsg} \\$found_count tracks (\\$mp3_only_count ${mp3OnlyMsg}, \\$wav_only_count ${wavOnlyMsg}, \\$both_formats_count ${bothFormatsMsg})"
echo "${missingMsg} \\$missing_count tracks"
if [[ \\$duplicate_count -gt 0 ]]; then
    echo "${duplicatesMsg} \\$duplicate_count tracks"
fi
echo ""
echo "${missingTracksFileMsg}"
echo ""
echo "${useCustomDownloadMsg}"
echo ""
echo "${extensionLimitationMsg}"
echo ""
`;

    // Add .sh script
    zip.file("check-library.sh", shScript);

    // Generate README.txt with instructions in user's language
    const readmeContent = `${getMessage("readmeTitle")}

${getMessage("readmeContains")}
${getMessage("readmeCsvFile")}
${
  getMessage("readmeJsonFile") ||
  "- suno-tracks-list.json (Full metadata including lyrics and prompts)"
}
${getMessage("readmeBatFile")}
${getMessage("readmeShFile")}
${getMessage("readmeReadmeFile")}

${getMessage("readmeHowToUse")}

${getMessage("readmeWindows")}
${getMessage("readmeWindowsStep1")}
${getMessage("readmeWindowsStep2")}
${getMessage("readmeWindowsStep3")}
${getMessage("readmeWindowsStep3a")}
${getMessage("readmeWindowsStep3b")}
${getMessage("readmeWindowsStep4")}

${getMessage("readmeLinux")}
${getMessage("readmeLinuxStep1")}
${getMessage("readmeLinuxStep2")}
${getMessage("readmeLinuxStep3")}
${getMessage("readmeLinuxStep3a")}
${getMessage("readmeLinuxStep4")}
${getMessage("readmeLinuxStep4a")}
${getMessage("readmeLinuxStep5")}
${getMessage("readmeLinuxStep5a")}
${getMessage("readmeLinuxStep5b")}
${getMessage("readmeLinuxStep6")}

${getMessage("readmeWhatScriptsDo")}

${getMessage("readmeScriptsCheck")}
${getMessage("readmeScriptsCheckMp3")}
${getMessage("readmeScriptsCheckWav")}
${getMessage("readmeScriptsCheckTxt")}

${getMessage("readmeResults")}
${getMessage("readmeMissingTracksFormat")}
${getMessage("readmeMissingTracksFormatDetail")}
${getMessage("readmeMissingTracksExample")}

${getMessage("readmeDuplicatesFormat")}
${getMessage("readmeDuplicatesFormatDetail")}
${getMessage("readmeDuplicatesNote")}

${getMessage("readmeCustomDownload")}

${getMessage("readmeCustomDownloadStep1")}
${getMessage("readmeCustomDownloadStep2")}
${getMessage("readmeCustomDownloadStep3")}
${getMessage("readmeCustomDownloadStep4")}
${getMessage("readmeCustomDownloadStep5")}

${getMessage("readmeNote")}

${getMessage("readmeSupport")}
`;

    // Add README.txt
    zip.file("README.txt", readmeContent);

    // Generate ZIP file as blob
    const zipBlob = await zip.generateAsync({ type: "blob" });

    // Create download link
    const zipBlobUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = zipBlobUrl;
    link.download = `suno-tracks-${new Date().toISOString().split("T")[0]}.zip`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up blob URL after a delay
    setTimeout(() => {
      URL.revokeObjectURL(zipBlobUrl);
    }, 30000);

    console.log(`Downloaded ZIP file with ${tracks.length} tracks`);
  } catch (error) {
    console.error("Error creating ZIP file:", error);
    alert(`Error creating ZIP file: ${error.message}`);
  }
}

// Setup Custom Download tab functionality
function setupCustomDownloadTab(
  container,
  isDarkMode,
  modalTextColor,
  secondaryTextColor
) {
  const fileDropZone = document.getElementById("file-drop-zone");
  const fileInput = document.getElementById("file-input");
  const statusDiv = document.getElementById("custom-download-status");
  const statusText = document.getElementById("custom-download-status-text");
  const progressDiv = document.getElementById("custom-download-progress");
  const progressBar = document.getElementById("custom-progress-bar");
  const stopButton = document.getElementById("stop-custom-download");

  // Click to browse
  fileDropZone.addEventListener("click", () => {
    fileInput.click();
  });

  // Drag and drop
  fileDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZone.style.borderColor = isDarkMode ? "#667eea" : "#667eea";
    fileDropZone.style.background = isDarkMode ? "#2a2a2a" : "#f0f0f0";
  });

  fileDropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZone.style.borderColor = isDarkMode ? "#555" : "#ccc";
    fileDropZone.style.background = isDarkMode ? "#252525" : "#fafafa";
  });

  fileDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZone.style.borderColor = isDarkMode ? "#555" : "#ccc";
    fileDropZone.style.background = isDarkMode ? "#252525" : "#fafafa";

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleMissingTracksFile(files[0]);
    }
  });

  // File input change
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleMissingTracksFile(e.target.files[0]);
    }
  });

  // Handle missing tracks file
  async function handleMissingTracksFile(file) {
    if (!file.name.endsWith(".txt")) {
      statusDiv.style.display = "block";
      statusText.textContent = `❌ ${getMessage("pleaseSelectTxtFile")}`;
      statusText.style.color = "#dc3545";
      return;
    }

    try {
      const text = await file.text();
      // Parse the new format: trackId,mp3Found,wavFound,txtFound
      // Or fallback to old format: just trackId per line
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.length > 0 &&
            !line.startsWith("#") &&
            !line.toLowerCase().startsWith("trackid")
        );

      // Parse track IDs and their file status
      const trackFileStatus = new Map(); // trackId -> {mp3Found, wavFound, txtFound}
      const trackIds = lines.map((line) => {
        // Check if it's the new CSV format
        if (line.includes(",")) {
          const parts = line.split(",").map((p) => p.trim());
          const trackId = parts[0];
          if (parts.length >= 4) {
            // New format: trackId,mp3Found,wavFound,txtFound
            trackFileStatus.set(trackId, {
              mp3Found: parts[1].toLowerCase() === "true",
              wavFound: parts[2].toLowerCase() === "true",
              txtFound: parts[3].toLowerCase() === "true",
            });
          }
          return trackId;
        }
        // Old format: just trackId (assume all files missing)
        return line;
      });

      if (trackIds.length === 0) {
        statusDiv.style.display = "block";
        statusText.textContent = `❌ ${getMessage("noTrackIdsFound")}`;
        statusText.style.color = "#dc3545";
        return;
      }

      // Hide file drop zone and show loading
      fileDropZone.style.display = "none";
      statusDiv.style.display = "block";
      statusText.textContent = formatMessage("foundTrackIds", {
        count: trackIds.length,
      });
      statusText.style.color = modalTextColor;

      // Get all workspaces
      const workspacesResponse = await chrome.runtime.sendMessage({
        action: "getWorkspaces",
      });

      if (!workspacesResponse.success) {
        throw new Error(workspacesResponse.error || "Failed to get workspaces");
      }

      const workspaces = workspacesResponse.workspaces || [];

      // Load tracks from cache for all workspaces
      const allCachedTracks = [];
      for (const workspace of workspaces) {
        try {
          const cachedResponse = await chrome.runtime.sendMessage({
            action: "getCachedTracks",
            workspaceId: workspace.id,
          });
          if (cachedResponse.success && cachedResponse.tracks) {
            // Add workspace info to tracks
            cachedResponse.tracks.forEach((track) => {
              track.workspaceId = workspace.id;
              track.workspaceName = workspace.name;
            });
            allCachedTracks.push(...cachedResponse.tracks);
          }
        } catch (error) {
          // No cache for this workspace, skip
        }
      }

      // Match track IDs with cached tracks
      const trackIdSet = new Set(trackIds.map((id) => id.trim()));
      const foundTracks = allCachedTracks.filter((track) =>
        trackIdSet.has(track.id)
      );
      const foundTrackIds = new Set(foundTracks.map((t) => t.id));
      const missingTrackIds = trackIds.filter(
        (id) => !foundTrackIds.has(id.trim())
      );

      statusText.textContent = formatMessage("foundInCacheFetching", {
        found: foundTracks.length,
        missing: missingTrackIds.length,
      });

      // Only fetch missing tracks (with delays to avoid rate limiting)
      const fetchedTracks = [];
      if (missingTrackIds.length > 0) {
        progressDiv.style.display = "block";
        progressBar.style.width = "0%";

        for (let i = 0; i < missingTrackIds.length; i++) {
          const trackId = missingTrackIds[i].trim();
          try {
            const response = await chrome.runtime.sendMessage({
              action: "getTrackMetadata",
              clipId: trackId,
            });

            if (response.success && response.metadata) {
              const metadata = response.metadata.fullData || response.metadata;
              if (metadata.audio_url && metadata.status === "complete") {
                fetchedTracks.push({
                  id: metadata.id || trackId,
                  audio_url: metadata.audio_url,
                  title: metadata.title || "Untitled",
                  workspaceName: metadata.workspaceName || "Unknown",
                  workspaceId: metadata.workspaceId || "unknown",
                  status: metadata.status,
                });
              }
            }

            const percent = Math.round(
              ((i + 1) / missingTrackIds.length) * 100
            );
            progressBar.style.width = `${percent}%`;
            statusText.textContent = formatMessage("fetchingMissingTracks", {
              current: i + 1,
              total: missingTrackIds.length,
              percent: percent,
            });

            // Delay to avoid rate limiting (500ms between requests)
            if (i < missingTrackIds.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          } catch (error) {
            console.error(`Error fetching track ${trackId}:`, error);
          }
        }
      }

      // Combine found and fetched tracks
      const allTracks = [...foundTracks, ...fetchedTracks].filter(
        (track) => track.status === "complete" && track.audio_url
      );

      if (allTracks.length === 0) {
        statusText.textContent = `❌ ${getMessage(
          "noDownloadableTracksFound"
        )}`;
        statusText.style.color = "#dc3545";
        progressDiv.style.display = "none";
        fileDropZone.style.display = "block";
        return;
      }

      // Add file status from missing-tracks.txt to each track
      // Only include tracks that are actually missing (at least one format is false)
      const missingTracks = [];
      allTracks.forEach((track) => {
        const status = trackFileStatus.get(track.id);
        if (status) {
          track.mp3Found = status.mp3Found;
          track.wavFound = status.wavFound;
          track.txtFound = status.txtFound;

          // Only include if at least one format is missing
          if (!status.mp3Found || !status.wavFound || !status.txtFound) {
            missingTracks.push(track);
          }
        } else {
          // If not in missing-tracks.txt, assume all files are missing
          track.mp3Found = false;
          track.wavFound = false;
          track.txtFound = false;
          missingTracks.push(track);
        }
      });

      if (missingTracks.length === 0) {
        statusText.textContent = `✅ ${
          getMessage("allTracksDownloaded") ||
          "All tracks are already downloaded!"
        }`;
        statusText.style.color = "#28a745";
        progressDiv.style.display = "none";
        fileDropZone.style.display = "block";
        return;
      }

      // Hide status and show tracks UI
      statusDiv.style.display = "none";
      progressDiv.style.display = "none";

      // Display tracks organized by workspace (similar to All Tracks tab)
      displayCustomDownloadTracks(
        missingTracks,
        container,
        isDarkMode,
        modalTextColor,
        secondaryTextColor,
        trackFileStatus
      );
    } catch (error) {
      console.error("Error reading file:", error);
      statusDiv.style.display = "block";
      statusText.textContent = `❌ Error: ${error.message}`;
      statusText.style.color = "#dc3545";
      fileDropZone.style.display = "block";
    }
  }

  // Display custom download tracks organized by workspace
  function displayCustomDownloadTracks(
    tracks,
    container,
    isDarkMode,
    modalTextColor,
    secondaryTextColor,
    trackFileStatus = null
  ) {
    const customContent = document.getElementById("custom-download-content");
    const borderColor = isDarkMode ? "#444" : "#e0e0e0";
    const headerBgColor = isDarkMode ? "#2a2a2a" : "#f5f5f5";
    const trackBgColor = isDarkMode ? "#252525" : "white";
    const trackBorderColor = isDarkMode ? "#3a3a3a" : "#e8e8e8";

    // Group tracks by workspace
    const tracksByWorkspace = {};
    tracks.forEach((track) => {
      const workspaceName = track.workspaceName || "Unknown Workspace";
      if (!tracksByWorkspace[workspaceName]) {
        tracksByWorkspace[workspaceName] = [];
      }
      tracksByWorkspace[workspaceName].push(track);
    });

    // Render tracks grouped by workspace
    const workspaceSections = Object.entries(tracksByWorkspace)
      .map(([workspaceName, workspaceTracks]) => {
        const workspaceId =
          workspaceTracks[0].workspaceId ||
          workspaceName.toLowerCase().replace(/\s+/g, "-");
        return `
          <div class="workspace-group" data-workspace="${workspaceId}" style="margin-bottom: 16px; border: 1px solid ${borderColor}; border-radius: 8px; overflow: hidden;">
            <div class="workspace-header" data-workspace-id="${workspaceId}" style="background: ${headerBgColor}; padding: 12px; cursor: pointer; display: flex; align-items: center; gap: 12px; user-select: none;">
              <span class="workspace-toggle" data-workspace-id="${workspaceId}" style="font-size: 14px; transition: transform 0.2s; color: ${modalTextColor};">▶</span>
              <input type="checkbox" class="workspace-checkbox" data-workspace="${workspaceId}" style="cursor: pointer;">
              <span style="font-weight: 600; color: ${modalTextColor}; flex: 1;">📁 ${workspaceName}</span>
              <span style="font-size: 12px; color: ${secondaryTextColor};">
                ${workspaceTracks.length} ${
          workspaceTracks.length !== 1
            ? getMessage("tracks")
            : getMessage("track")
        }
              </span>
            </div>
            <div class="workspace-tracks" id="custom-workspace-${workspaceId}" style="display: none; padding: 8px;">
              ${workspaceTracks
                .map((track) => {
                  // Use missing-tracks.txt status if available, otherwise check localStorage
                  const mp3Found =
                    track.mp3Found !== undefined
                      ? track.mp3Found
                      : isTrackDownloaded(track.id, "mp3");
                  const wavFound =
                    track.wavFound !== undefined
                      ? track.wavFound
                      : isTrackDownloaded(track.id, "wav");
                  const mp3Missing = !mp3Found;
                  const wavMissing = !wavFound;
                  const hasAnyFile = mp3Found || wavFound;

                  // Only gray out if BOTH formats are found
                  const opacity =
                    hasAnyFile && !mp3Missing && !wavMissing ? "0.5" : "1";
                  const downloadedStyle =
                    hasAnyFile && !mp3Missing && !wavMissing
                      ? `opacity: ${opacity}; filter: grayscale(50%);`
                      : "";

                  return `
                <div class="track-item" data-clip-id="${
                  track.id
                }" data-mp3-missing="${mp3Missing}" data-wav-missing="${wavMissing}" style="padding: 10px; border: 1px solid ${trackBorderColor}; border-radius: 6px; margin-bottom: 6px; display: flex; align-items: center; gap: 12px; background: ${trackBgColor}; ${downloadedStyle}">
                  <input type="checkbox" class="track-checkbox" data-clip-id="${
                    track.id
                  }" data-audio-url="${
                    track.audio_url
                  }" data-workspace="${workspaceId}" data-mp3-missing="${mp3Missing}" data-wav-missing="${wavMissing}" style="cursor: pointer;">
                  <div style="flex: 1;">
                    <div style="font-weight: 600; color: ${modalTextColor}; font-size: 14px;">${
                    track.title || "(Untitled)"
                  }${hasAnyFile && !mp3Missing && !wavMissing ? " ✓" : ""}</div>
                    <div style="font-size: 11px; color: ${secondaryTextColor}; margin-top: 2px;">${
                    track.id
                  }${mp3Found ? " [MP3 ✓]" : " [MP3 ✗]"}${
                    wavFound ? " [WAV ✓]" : " [WAV ✗]"
                  }</div>
                  </div>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <button class="download-single-mp3" data-clip-id="${
                      track.id
                    }" data-audio-url="${track.audio_url}" data-title="${(
                    track.title || "Untitled"
                  ).replace(
                    /[<>:"/\\|?*]/g,
                    "_"
                  )}" style="padding: 6px 12px; background: ${
                    mp3Found ? "#6c757d" : "#667eea"
                  }; color: white; border: none; border-radius: 4px; cursor: ${
                    mp3Found ? "not-allowed" : "pointer"
                  }; font-size: 12px;" ${mp3Found ? "disabled" : ""}>${
                    mp3Found ? "✓ " : ""
                  }${getMessage("downloadMP3")}</button>
                    <button class="download-single-wav" data-clip-id="${
                      track.id
                    }" data-title="${(track.title || "Untitled").replace(
                    /[<>:"/\\|?*]/g,
                    "_"
                  )}" style="padding: 6px 12px; background: ${
                    wavFound ? "#6c757d" : "#28a745"
                  }; color: white; border: none; border-radius: 4px; cursor: ${
                    wavFound ? "not-allowed" : "pointer"
                  }; font-size: 12px;" ${wavFound ? "disabled" : ""}>${
                    wavFound ? "✓ " : ""
                  }${getMessage("downloadWAV")}</button>
                  </div>
                </div>
              `;
                })
                .join("")}
            </div>
          </div>
        `;
      })
      .join("");

    const progressBgColor = isDarkMode ? "#333" : "#f0f0f0";
    const textColor = modalTextColor;

    customContent.innerHTML = `
      <div style="display: flex; gap: 16px; height: 100%; box-sizing: border-box; overflow: hidden;">
        <!-- Left Column: Actions and Explanations -->
        <div style="flex: 0 0 320px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; padding-right: 8px;">
          <div style="flex-shrink: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <p style="color: ${textColor}; margin: 0; font-size: 14px;"><strong>${
      tracks.length
    } ${getMessage("downloadableTracks")} from ${
      Object.keys(tracksByWorkspace).length
    } ${getMessage("workspaces")}</strong></p>
              <button id="back-to-file-drop" style="padding: 6px 12px; background: ${
                isDarkMode ? "#444" : "#e0e0e0"
              }; color: ${modalTextColor}; border: 1px solid ${borderColor}; border-radius: 4px; cursor: pointer; font-size: 12px;">← ${getMessage(
      "backToFileDrop"
    )}</button>
            </div>
          </div>
          
          <div id="custom-download-progress-display" style="flex-shrink: 0; display: none; padding-top: 8px; border-top: 1px solid ${borderColor};">
            <div style="background: ${progressBgColor}; border-radius: 4px; height: 24px; overflow: hidden;">
              <div id="custom-progress-bar-display" style="background: #667eea; height: 100%; width: 0%; transition: width 0.3s;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
              <p id="custom-progress-text" style="font-size: 12px; color: ${secondaryTextColor}; margin: 0;"></p>
              <button id="stop-custom-download-display" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: none;">${getMessage(
                "stop"
              )}</button>
            </div>
          </div>

          <div style="flex-shrink: 0; padding-top: 8px; border-top: 1px solid ${borderColor};">
            <h4 style="color: ${textColor}; margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">Actions</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <button id="download-selected-mp3-custom" style="padding: 10px 16px; background: #764ba2; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; width: 100%;">${getMessage(
                "downloadSelectedMP3"
              )}</button>
              <button id="download-selected-wav-custom" style="padding: 10px 16px; background: #20c997; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; width: 100%;">${getMessage(
                "downloadSelectedWAV"
              )}</button>
            </div>
          </div>
        </div>

        <!-- Right Column: Filters and Track List -->
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0;">
          <div id="filter-container-custom-download" style="flex-shrink: 0;"></div>
          <div id="custom-tracks-list" style="flex: 1; overflow-y: auto; min-height: 0; box-sizing: border-box; overflow-x: hidden;">
            <div id="all-workspaces-header-container-custom-download"></div>
            ${workspaceSections}
          </div>
        </div>
      </div>
    `;

    // Add event listeners
    setupCustomDownloadTracksUI(
      customContent,
      tracks,
      isDarkMode,
      modalTextColor,
      secondaryTextColor
    );
  }

  // Setup UI for custom download tracks
  function setupCustomDownloadTracksUI(
    customContent,
    tracks,
    isDarkMode,
    modalTextColor,
    secondaryTextColor
  ) {
    const borderColor = isDarkMode ? "#444" : "#e0e0e0";

    // Back button
    const backButton = customContent.querySelector("#back-to-file-drop");
    if (backButton) {
      backButton.addEventListener("click", () => {
        const customContent = document.getElementById(
          "custom-download-content"
        );
        customContent.innerHTML = `
          <h3 style="margin: 0 0 16px 0; color: ${modalTextColor};">${getMessage(
          "customDownloadTitle"
        )}</h3>
          <p style="color: ${secondaryTextColor}; font-size: 14px; margin: 0 0 20px 0;">
            ${getMessage("customDownloadDescription")}
          </p>
          <div id="file-drop-zone" style="border: 2px dashed ${
            isDarkMode ? "#555" : "#ccc"
          }; border-radius: 8px; padding: 40px; text-align: center; cursor: pointer; background: ${
          isDarkMode ? "#252525" : "#fafafa"
        }; transition: all 0.3s;">
            <input type="file" id="file-input" accept=".txt" style="display: none;">
            <div style="font-size: 48px; margin-bottom: 16px;">📁</div>
            <p style="margin: 0; color: ${modalTextColor}; font-size: 16px; font-weight: 600;">${getMessage(
          "dropFileHere"
        )}</p>
            <p style="margin: 8px 0 0 0; color: ${secondaryTextColor}; font-size: 12px;">${getMessage(
          "missingTracksFileName"
        )}</p>
          </div>
          <div id="custom-download-status" style="margin-top: 20px; display: none;">
            <p id="custom-download-status-text" style="color: ${modalTextColor}; margin: 0 0 8px 0;"></p>
            <div id="custom-download-progress" style="display: none;">
              <div style="background: ${
                isDarkMode ? "#333" : "#f0f0f0"
              }; border-radius: 4px; height: 24px; overflow: hidden; margin-bottom: 8px;">
                <div id="custom-progress-bar" style="background: #667eea; height: 100%; width: 0%; transition: width 0.3s;"></div>
              </div>
              <button id="stop-custom-download" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: none;">Stop</button>
            </div>
          </div>
        `;
        setupCustomDownloadTab(
          customContent.parentElement,
          isDarkMode,
          modalTextColor,
          secondaryTextColor
        );
      });
    }

    // Workspace toggle
    customContent.querySelectorAll(".workspace-header").forEach((header) => {
      header.addEventListener("click", (e) => {
        if (
          e.target.type === "checkbox" ||
          e.target.classList.contains("workspace-checkbox")
        ) {
          return;
        }
        const workspaceId = header.dataset.workspaceId;
        const tracksDiv = customContent.querySelector(
          `#custom-workspace-${workspaceId}`
        );
        const toggle = header.querySelector(".workspace-toggle");

        if (tracksDiv.style.display === "none" || !tracksDiv.style.display) {
          tracksDiv.style.display = "block";
          if (toggle) toggle.style.transform = "rotate(90deg)";
        } else {
          tracksDiv.style.display = "none";
          if (toggle) toggle.style.transform = "rotate(0deg)";
        }
      });
    });

    // Workspace checkbox - select all visible tracks in workspace
    customContent
      .querySelectorAll(".workspace-checkbox")
      .forEach((checkbox) => {
        checkbox.addEventListener("click", (e) => {
          e.stopPropagation();
          const workspaceId = checkbox.dataset.workspace;
          const trackCheckboxes = customContent.querySelectorAll(
            `.track-checkbox[data-workspace="${workspaceId}"]`
          );
          trackCheckboxes.forEach((cb) => {
            const trackItem = cb.closest(".track-item");
            if (trackItem && trackItem.style.display !== "none") {
              cb.checked = checkbox.checked;
            }
          });
        });
      });

    // Create filter component
    const filterComponent = createFilterComponent(
      "filter-container-custom-download",
      isDarkMode,
      modalTextColor,
      secondaryTextColor,
      borderColor
    );

    // Create "All workspaces" header
    const headerBgColor = isDarkMode ? "#2a2a2a" : "#f5f5f5";
    const allWorkspacesHeader = createAllWorkspacesHeader(
      isDarkMode,
      modalTextColor,
      secondaryTextColor,
      borderColor,
      headerBgColor
    );
    const allWorkspacesHeaderContainer = document.getElementById(
      "all-workspaces-header-container-custom-download"
    );
    if (allWorkspacesHeaderContainer) {
      allWorkspacesHeaderContainer.appendChild(allWorkspacesHeader.element);
    }

    function updateWorkspaceCounts() {
      customContent.querySelectorAll(".workspace-group").forEach((group) => {
        const workspaceId = group.dataset.workspace;
        const visibleTracks = group.querySelectorAll(
          `.track-item:not([style*="display: none"])`
        );
        const header = group.querySelector(".workspace-header");
        const countSpan = header.querySelector("span:last-of-type");
        if (countSpan) {
          countSpan.textContent = `${visibleTracks.length} track${
            visibleTracks.length !== 1 ? "s" : ""
          }`;
        }
      });
    }

    // Filter function using new filter component
    function filterCustomTracks() {
      if (!filterComponent) return;

      const filterState = filterComponent.state();
      const filteredResults = applyFiltersToTracks(tracks, filterState);

      const allTrackItems = customContent.querySelectorAll(".track-item");
      filteredResults.forEach(({ track, shouldShow }) => {
        const item = Array.from(allTrackItems).find(
          (el) => el.dataset.clipId === track.id
        );
        if (!item) return;

        item.style.display = shouldShow ? "flex" : "none";

        // Uncheck hidden tracks
        if (!shouldShow) {
          const checkbox = item.querySelector(".track-checkbox");
          if (checkbox) checkbox.checked = false;
        }
      });

      // Update workspace counts
      updateWorkspaceCounts();
    }

    // Set up filter component update callback
    if (filterComponent) {
      filterComponent.updateFilter = filterCustomTracks;
    }

    // Initial filter
    setTimeout(filterCustomTracks, 0);

    // Select All functionality
    allWorkspacesHeader.selectAllCheckbox.addEventListener("change", (e) => {
      const allTrackCheckboxes = Array.from(
        customContent.querySelectorAll(".track-checkbox")
      ).filter((cb) => {
        const trackItem = cb.closest(".track-item");
        return trackItem && trackItem.style.display !== "none";
      });

      allTrackCheckboxes.forEach((cb) => {
        cb.checked = e.target.checked;
      });

      // Update workspace checkboxes
      customContent.querySelectorAll(".workspace-checkbox").forEach((wsCb) => {
        const workspaceId = wsCb.dataset.workspace;
        const workspaceTrackCheckboxes = Array.from(
          customContent.querySelectorAll(
            `.track-item .track-checkbox[data-workspace="${workspaceId}"]`
          )
        ).filter((cb) => {
          const trackItem = cb.closest(".track-item");
          return trackItem && trackItem.style.display !== "none";
        });

        if (workspaceTrackCheckboxes.length > 0) {
          const allChecked = workspaceTrackCheckboxes.every((cb) => cb.checked);
          const someChecked = workspaceTrackCheckboxes.some((cb) => cb.checked);
          wsCb.checked = allChecked;
          wsCb.indeterminate = someChecked && !allChecked;
        }
      });
    });

    // Download selected MP3 - respect checkbox selections, filter by missing MP3
    const downloadMP3Btn = customContent.querySelector(
      "#download-selected-mp3-custom"
    );
    if (downloadMP3Btn) {
      downloadMP3Btn.addEventListener("click", () => {
        // Get checked checkboxes first
        const checkedBoxes = Array.from(
          customContent.querySelectorAll(".track-checkbox:checked")
        ).filter((cb) => {
          const trackItem = cb.closest(".track-item");
          return trackItem && trackItem.style.display !== "none";
        });

        let selected = [];

        if (checkedBoxes.length > 0) {
          // Use checked checkboxes, but only include tracks missing MP3
          selected = checkedBoxes
            .filter((cb) => {
              const trackItem = cb.closest(".track-item");
              return trackItem?.dataset.mp3Missing === "true";
            })
            .map((cb) => {
              const track = tracks.find((t) => t.id === cb.dataset.clipId);
              return {
                id: cb.dataset.clipId,
                audio_url: cb.dataset.audioUrl,
                title: track?.title || "Untitled",
                workspaceName: track?.workspaceName || "Unknown",
              };
            });
        } else {
          // If no checkboxes checked, auto-select all tracks missing MP3
          selected = Array.from(
            customContent.querySelectorAll(
              ".track-item[data-mp3-missing='true']"
            )
          )
            .filter((item) => item.style.display !== "none")
            .map((item) => {
              const clipId = item.dataset.clipId;
              const track = tracks.find((t) => t.id === clipId);
              return {
                id: clipId,
                audio_url:
                  item.querySelector(".track-checkbox")?.dataset.audioUrl ||
                  track?.audio_url,
                title: track?.title || "Untitled",
                workspaceName: track?.workspaceName || "Unknown",
              };
            });
        }

        if (selected.length === 0) {
          alert(formatMessage("noTracksMissingFormat", { format: "MP3" }));
          return;
        }

        // Use custom progress display
        downloadSelectedTracksCustom(selected, "mp3", customContent);
      });
    }

    // Download selected WAV - respect checkbox selections, filter by missing WAV
    const downloadWAVBtn = customContent.querySelector(
      "#download-selected-wav-custom"
    );
    if (downloadWAVBtn) {
      downloadWAVBtn.addEventListener("click", () => {
        // Get checked checkboxes first
        const checkedBoxes = Array.from(
          customContent.querySelectorAll(".track-checkbox:checked")
        ).filter((cb) => {
          const trackItem = cb.closest(".track-item");
          return trackItem && trackItem.style.display !== "none";
        });

        let selected = [];

        if (checkedBoxes.length > 0) {
          // Use checked checkboxes, but only include tracks missing WAV
          selected = checkedBoxes
            .filter((cb) => {
              const trackItem = cb.closest(".track-item");
              return trackItem?.dataset.wavMissing === "true";
            })
            .map((cb) => {
              const track = tracks.find((t) => t.id === cb.dataset.clipId);
              return {
                id: cb.dataset.clipId,
                audio_url: cb.dataset.audioUrl,
                title: track?.title || "Untitled",
                workspaceName: track?.workspaceName || "Unknown",
              };
            });
        } else {
          // If no checkboxes checked, auto-select all tracks missing WAV
          selected = Array.from(
            customContent.querySelectorAll(
              ".track-item[data-wav-missing='true']"
            )
          )
            .filter((item) => item.style.display !== "none")
            .map((item) => {
              const clipId = item.dataset.clipId;
              const track = tracks.find((t) => t.id === clipId);
              return {
                id: clipId,
                audio_url:
                  item.querySelector(".track-checkbox")?.dataset.audioUrl ||
                  track?.audio_url,
                title: track?.title || "Untitled",
                workspaceName: track?.workspaceName || "Unknown",
              };
            });
        }

        if (selected.length === 0) {
          alert(formatMessage("noTracksMissingFormat", { format: "WAV" }));
          return;
        }

        // Use custom progress display
        downloadSelectedTracksAsWavCustom(selected, customContent);
      });
    }

    // Individual download buttons - MP3 (only if MP3 is missing)
    customContent.querySelectorAll(".download-single-mp3").forEach((btn) => {
      btn.addEventListener("click", () => {
        const clipId = btn.dataset.clipId;
        const trackItem = btn.closest(".track-item");
        const mp3Missing = trackItem?.dataset.mp3Missing === "true";

        if (!mp3Missing) {
          alert(formatMessage("fileAlreadyExists", { format: "MP3" }));
          return;
        }

        const audioUrl = btn.dataset.audioUrl;
        const title = btn.dataset.title;
        const track = tracks.find((t) => t.id === clipId);
        const workspaceName = track?.workspaceName || "Unknown";

        const trackObj = {
          id: clipId,
          audio_url: audioUrl,
          title: title,
          workspaceName: workspaceName,
        };
        downloadSelectedTracksCustom([trackObj], "mp3", customContent);
      });
    });

    // Individual download buttons - WAV (only if WAV is missing)
    customContent.querySelectorAll(".download-single-wav").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const clipId = btn.dataset.clipId;
        const trackItem = btn.closest(".track-item");
        const wavMissing = trackItem?.dataset.wavMissing === "true";

        if (!wavMissing) {
          alert(formatMessage("fileAlreadyExists", { format: "WAV" }));
          return;
        }

        const title = btn.dataset.title;
        const track = tracks.find((t) => t.id === clipId);
        const workspaceName = track?.workspaceName || "Unknown";

        const trackObj = {
          id: clipId,
          audio_url: track?.audio_url,
          title: title,
          workspaceName: workspaceName,
        };
        downloadSelectedTracksAsWavCustom([trackObj], customContent);
      });
    });

    // Unlock buttons
    customContent.querySelectorAll(".unlock-track").forEach((btn) => {
      btn.addEventListener("click", () => {
        const clipId = btn.dataset.clipId;
        clearTrackDownload(clipId);
        refreshTrackUI(clipId);
      });
    });
  }

  // Download selected tracks with custom progress display
  async function downloadSelectedTracksCustom(tracks, format, container) {
    const progressDiv = container.querySelector(
      "#custom-download-progress-display"
    );
    const progressBar = container.querySelector("#custom-progress-bar-display");
    const progressText = container.querySelector("#custom-progress-text");
    const stopButton = container.querySelector("#stop-custom-download-display");

    progressDiv.style.display = "block";
    progressBar.style.width = "0%";
    stopButton.style.display = "block";
    stopButton.disabled = false;
    stopButton.textContent = getMessage("stop");
    let stopFlag = false;

    stopButton.onclick = () => {
      stopFlag = true;
      stopButton.disabled = true;
      stopButton.textContent = getMessage("stoppingDownloads");
      progressText.textContent = `⏹️ ${getMessage("stoppingDownloads")}`;
    };

    let completed = 0;
    let failed = 0;
    const total = tracks.length;

    for (let i = 0; i < tracks.length; i++) {
      if (stopFlag) {
        progressText.textContent = `⏹️ ${getMessage("stopped")} ${getMessage(
          "downloaded"
        )} ${completed} ${getMessage("of")} ${total} ${getMessage("tracks")}${
          failed > 0 ? ` (${failed} failed)` : ""
        }`;
        stopButton.style.display = "none";
        break;
      }

      const track = tracks[i];
      const workspaceName = sanitizeFilename(track.workspaceName || "Unknown");
      const trackName = sanitizeFilename(track.title || "Untitled");
      const filename = `${workspaceName}-${trackName}-${track.id}.${format}`;

      progressText.textContent = `${getMessage("downloading")} ${
        i + 1
      }/${total}: ${trackName}...`;

      try {
        await downloadTrack(track.audio_url, filename, track.id, format);
        if (!stopFlag) {
          completed++;
          const percent = Math.round(((completed + failed) / total) * 100);
          progressBar.style.width = `${percent}%`;
          progressText.textContent = `${getMessage(
            "downloaded"
          )} ${completed} ${getMessage("of")} ${total} ${getMessage(
            "tracks"
          )} (${percent}%)${failed > 0 ? ` - ${failed} failed` : ""}`;

          if (completed + failed === total) {
            progressText.textContent = `✅ ${getMessage(
              "completed"
            )} ${getMessage("downloaded")} ${completed} ${getMessage(
              "of"
            )} ${total} ${getMessage("tracks")}${
              failed > 0 ? ` (${failed} failed)` : ""
            }`;
            stopButton.style.display = "none";
          }
        }
      } catch (error) {
        if (!stopFlag) {
          console.error(`Failed to download ${track.title}:`, error);
          failed++;
          const percent = Math.round(((completed + failed) / total) * 100);
          progressBar.style.width = `${percent}%`;
          progressText.textContent = `${getMessage(
            "downloaded"
          )} ${completed} ${getMessage("of")} ${total} ${getMessage(
            "tracks"
          )} (${percent}%)${failed > 0 ? ` - ${failed} failed` : ""}`;

          if (completed + failed === total) {
            progressText.textContent = `✅ ${getMessage(
              "completed"
            )} ${getMessage("downloaded")} ${completed} ${getMessage(
              "of"
            )} ${total} ${getMessage("tracks")}${
              failed > 0 ? ` (${failed} failed)` : ""
            }`;
            stopButton.style.display = "none";
          }
        }
      }

      if (i < tracks.length - 1 && !stopFlag) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 + Math.random() * 2000)
        );
      }
    }
  }

  // Download selected tracks as WAV with custom progress display
  async function downloadSelectedTracksAsWavCustom(tracks, container) {
    const progressDiv = container.querySelector(
      "#custom-download-progress-display"
    );
    const progressBar = container.querySelector("#custom-progress-bar-display");
    const progressText = container.querySelector("#custom-progress-text");
    const stopButton = container.querySelector("#stop-custom-download-display");

    progressDiv.style.display = "block";
    progressBar.style.width = "0%";
    stopButton.style.display = "block";
    stopButton.disabled = false;
    stopButton.textContent = getMessage("stop");
    let stopFlag = false;

    stopButton.onclick = () => {
      stopFlag = true;
      stopButton.disabled = true;
      stopButton.textContent = getMessage("stoppingDownloads");
      progressText.textContent = `⏹️ ${getMessage("stoppingDownloads")}`;
    };

    let completed = 0;
    let failed = 0;
    const total = tracks.length;

    for (let i = 0; i < tracks.length; i++) {
      if (stopFlag) {
        progressText.textContent = `⏹️ ${getMessage("stopped")} ${getMessage(
          "converting"
        )} ${completed} ${getMessage("of")} ${total} ${getMessage("tracks")}${
          failed > 0 ? ` (${failed} failed)` : ""
        }`;
        stopButton.style.display = "none";
        break;
      }

      const track = tracks[i];
      const workspaceName = sanitizeFilename(track.workspaceName || "Unknown");
      const trackName = sanitizeFilename(track.title || "Untitled");
      const filename = `${workspaceName}-${trackName}-${track.id}.wav`;

      try {
        progressText.textContent = `${getMessage("converting")} ${
          i + 1
        }/${total}: ${track.title || "Untitled"}...`;
        await convertAndDownloadWav(track.id, filename);
        if (!stopFlag) {
          completed++;
          const percent = Math.round(((completed + failed) / total) * 100);
          progressBar.style.width = `${percent}%`;
          progressText.textContent = `${getMessage(
            "converting"
          )} ${completed} ${getMessage("of")} ${total} ${getMessage(
            "tracks"
          )} (${percent}%)${failed > 0 ? ` - ${failed} failed` : ""}`;
        }
      } catch (error) {
        if (!stopFlag) {
          console.error(`Failed to convert ${track.title}:`, error);
          failed++;
          const percent = Math.round(((completed + failed) / total) * 100);
          progressBar.style.width = `${percent}%`;
          progressText.textContent = `${getMessage(
            "converting"
          )} ${completed} ${getMessage("of")} ${total} ${getMessage(
            "tracks"
          )} (${percent}%)${failed > 0 ? ` - ${failed} failed` : ""}`;
        }
      }

      if (i < tracks.length - 1 && !stopFlag) {
        await new Promise((resolve) =>
          setTimeout(resolve, 2000 + Math.random() * 2000)
        );
      }
    }

    if (!stopFlag) {
      progressText.textContent = `✅ ${getMessage("completed")} ${getMessage(
        "converting"
      )} ${completed} ${getMessage("of")} ${total} ${getMessage("tracks")}${
        failed > 0 ? ` (${failed} failed)` : ""
      }`;
      stopButton.style.display = "none";
    }
  }
}

// Start background metadata fetching
function startBackgroundMetadataFetch(tracks) {
  // Extract IDs from tracks that might need metadata
  // We send all IDs, the background script will check cache
  const trackIds = tracks.map((t) => t.id);

  // Show progress UI
  const progressDiv = document.getElementById("metadata-fetch-progress");
  if (progressDiv) {
    progressDiv.style.display = "block";
    const progressText = document.getElementById("metadata-progress-text");
    if (progressText) {
      progressText.textContent =
        formatMessage("metadataProgress", {
          current: 0,
          total: trackIds.length,
          percentage: 0,
        }) || `Fetching metadata: 0/${trackIds.length} (0%)`;
    }
  }

  // Send message to background script
  chrome.runtime.sendMessage({
    action: "fetchAllTracksMetadata",
    trackIds: trackIds,
  });
}

// Listen for metadata fetch progress
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "metadataFetchProgress") {
    const { current, total, percentage } = request;
    const progressBar = document.getElementById("metadata-progress-bar");
    const progressText = document.getElementById("metadata-progress-text");

    if (progressBar && progressText) {
      const progressDiv = document.getElementById("metadata-fetch-progress");
      if (progressDiv) progressDiv.style.display = "block";
      progressBar.style.width = `${percentage}%`;
      progressText.textContent =
        formatMessage("metadataProgress", { current, total, percentage }) ||
        `Fetching metadata: ${current}/${total} (${percentage}%)`;
    }
  } else if (request.action === "metadataFetchComplete") {
    const { successCount, failedCount } = request;
    const progressDiv = document.getElementById("metadata-fetch-progress");
    if (progressDiv) {
      progressDiv.style.display = "none";
    }

    // Change export button to "Download All Metadata" after metadata fetch completes
    const exportBtn = document.getElementById("export-sunolibrary");
    if (exportBtn) {
      exportBtn.dataset.isSimple = "false";
      exportBtn.textContent = `📋 ${
        getMessage("downloadAllMetadata") || "Download All Metadata"
      }`;
      exportBtn.style.background = "#17a2b8"; // Change color to match metadata theme
    }
  }
});

// Initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    extractTokenFromRequests();
    attemptTokenExtraction();
    setTimeout(injectDownloadButton, 2000); // Wait for page to load
  });
} else {
  extractTokenFromRequests();
  attemptTokenExtraction();
  setTimeout(injectDownloadButton, 2000);
}
