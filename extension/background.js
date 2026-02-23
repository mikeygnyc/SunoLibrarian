// Background service worker for Suno Tracks Exporter

// Import metadata utilities
importScripts("metadata.js");

//Clean up old data on update
// chrome.runtime.onInstalled.addListener((details) => {
//   if (details.reason === "update") {
//     console.log("Extension updated, cleaning up old cache...");
//     // Clear track cache to avoid conflicts with new metadata structure
//     // We keep authToken, deviceId, and download status
//     chrome.storage.local.get(null, (items) => {
//       const keysToRemove = Object.keys(items).filter(
//         (key) => key.startsWith("tracks_") || key.startsWith("workspace_")
//       );
//       if (keysToRemove.length > 0) {
//         chrome.storage.local.remove(keysToRemove, () => {
//           console.log(`Removed ${keysToRemove.length} cached items`);
//         });
//       }
//     });
//   }
// });

// Intercept network requests to capture auth tokens
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (
      details.url.includes("studio-api.prod.suno.com") &&
      details.requestHeaders
    ) {
      const authHeader = details.requestHeaders.find(
        (header) => header.name.toLowerCase() === "authorization"
      );
      if (authHeader && authHeader.value) {
        const token = authHeader.value.replace("Bearer ", "");
        // Save token to storage
        chrome.storage.local.set({ authToken: token }, () => {});
      }
    }
  },
  {
    urls: ["https://studio-api.prod.suno.com/*"],
  },
  ["requestHeaders"]
);

// Store filenames for downloads initiated by our extension (keyed by URL)
const downloadFilenames = new Map();
const downloadIdToClipId = new Map(); // Map downloadId to {clipId, format}

// Listen for download completion to mark tracks as downloaded
chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (downloadDelta.state && downloadDelta.state.current === "complete") {
    const downloadId = downloadDelta.id;
    const downloadInfo = downloadIdToClipId.get(downloadId);

    if (downloadInfo) {
      // Send message to content script to mark track as downloaded
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url && tabs[0].url.includes("suno.com")) {
          chrome.tabs
            .sendMessage(tabs[0].id, {
              action: "markDownloaded",
              clipId: downloadInfo.clipId,
              format: downloadInfo.format,
            })
            .catch(() => {
              // Ignore errors if content script is not available
            });
        }
      });

      // Clean up
      downloadIdToClipId.delete(downloadId);
    }
  }
});

// Listen for download events to suppress save dialogs
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  // Check if we have a stored filename for this download URL
  const storedFilename = downloadFilenames.get(downloadItem.url);

  if (storedFilename) {
    // Use the filename we stored
    suggest({
      filename: storedFilename,
      conflictAction: "uniquify",
    });
    // Clean up after use (with a delay to handle retries)
    setTimeout(() => {
      downloadFilenames.delete(downloadItem.url);
    }, 1000);
  } else {
    // For other downloads, use the filename from downloadItem if available
    let filename =
      downloadItem.filename || downloadItem.suggestedFilename || "";

    // If filename is empty, try to extract from URL
    if (!filename && downloadItem.url) {
      const urlParts = downloadItem.url.split("/");
      filename = urlParts[urlParts.length - 1].split("?")[0];
    }

    // Remove any folder path, keep only the filename
    if (filename) {
      const pathParts = filename.split(/[\/\\]/);
      filename = pathParts[pathParts.length - 1];
    }

    suggest({
      filename: filename || "download",
      conflictAction: "uniquify",
    });
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getTracks") {
    fetchTracks(request.cursor, request.limit, request.workspaceId || "default")
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (request.action === "getToken") {
    getTokenFromStorage()
      .then((token) => sendResponse({ success: true, token }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "saveToken") {
    chrome.storage.local.set({ authToken: request.token }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "downloadFile") {
    downloadFile(request.url, request.filename, request.clipId, request.format)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "initiateWavConversion") {
    initiateWavConversion(request.clipId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "pollWavFile") {
    pollWavFile(request.clipId)
      .then((url) => sendResponse({ success: true, url }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getWorkspaces") {
    getWorkspaces()
      .then((workspaces) => sendResponse({ success: true, workspaces }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getWorkspacesPage") {
    fetchWorkspacesPage(request.page || 1)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "openDownloadSettings") {
    chrome.tabs.create({ url: "chrome://settings/downloads" });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "getTrackMetadata") {
    fetchTrackMetadata(request.clipId)
      .then((metadata) => sendResponse({ success: true, metadata }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getCachedTracks") {
    getCachedTracks(request.workspaceId)
      .then((data) =>
        sendResponse({
          success: true,
          tracks: data.tracks,
          timestamp: data.timestamp,
        })
      )
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getCacheTimestamp") {
    getCacheTimestamp(request.workspaceId)
      .then((timestamp) => sendResponse({ success: true, timestamp }))
      .catch(() => sendResponse({ success: false, timestamp: null }));
    return true;
  }

  if (request.action === "refreshAllWorkspaces") {
    refreshAllWorkspaces()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "refreshWorkspaceTracks") {
    refreshWorkspaceTracks(request.workspaceId)
      .then((tracks) => sendResponse({ success: true, tracks }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "cacheTracks") {
    cacheTracks(request.workspaceId, request.tracks)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "fetchAllTracksMetadata") {
    fetchAllTracksMetadata(request.trackIds)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Get token from storage or fetch from current tab
async function getTokenFromStorage() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["authToken"], (result) => {
      if (result.authToken) {
        resolve(result.authToken);
      } else {
        reject(new Error("No token found. Please visit suno.com first."));
      }
    });
  });
}

// Get or generate device ID (stored per user)
function getDeviceId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["deviceId"], (result) => {
      if (result.deviceId) {
        resolve(result.deviceId);
      } else {
        // Generate a new device ID
        const deviceId = generateUUID();
        chrome.storage.local.set({ deviceId: deviceId }, () => {
          resolve(deviceId);
        });
      }
    });
  });
}

// Generate a UUID v4
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Generate browser token
function generateBrowserToken() {
  const timestamp = Date.now();
  const token = btoa(JSON.stringify({ timestamp }));
  return JSON.stringify({ token });
}

// Rate limit configuration - dynamically adjustable
let rateLimitConfig = {
  baseDelay: 300, // Base delay between requests (ms)
  workspaceDelay: 500, // Delay between workspace requests (ms)
  trackDelay: 300, // Delay between track page requests (ms)
  metadataDelay: 500, // Delay between metadata requests (ms)
  maxRetries: 5, // Maximum retry attempts for 429 errors
  initialBackoff: 2000, // Initial backoff delay (ms)
  maxBackoff: 30000, // Maximum backoff delay (ms)
  backoffMultiplier: 2, // Exponential backoff multiplier
  rateLimitDetected: false, // Flag to indicate rate limiting detected
};

// Update rate limit config (can be called to adjust dynamically)
async function updateRateLimitConfig(newConfig) {
  rateLimitConfig = { ...rateLimitConfig, ...newConfig };
  await chrome.storage.local.set({ rateLimitConfig });
}

// Load rate limit config from storage
async function loadRateLimitConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["rateLimitConfig"], (result) => {
      if (result.rateLimitConfig) {
        rateLimitConfig = { ...rateLimitConfig, ...result.rateLimitConfig };
      }
      resolve(rateLimitConfig);
    });
  });
}

// Notify user about rate limiting
function notifyRateLimit(workspaceName = null) {
  const message = workspaceName
    ? `Rate limit detected while fetching ${workspaceName}. Increasing delays and retrying...`
    : "Rate limit detected. Increasing delays between requests and retrying...";

  // Send notification to content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes("suno.com")) {
      chrome.tabs
        .sendMessage(tabs[0].id, {
          action: "rateLimitNotification",
          message: message,
        })
        .catch(() => {
          // Ignore if content script not available
        });
    }
  });

  console.warn(message);
}

// Retry with exponential backoff
async function retryWithBackoff(fn, context = "", retryCount = 0) {
  try {
    return await fn();
  } catch (error) {
    const isRateLimit =
      error.message &&
      (error.message.includes("429") ||
        error.message.includes("Too many requests") ||
        error.status === 429);

    if (isRateLimit && retryCount < rateLimitConfig.maxRetries) {
      // Calculate exponential backoff delay
      const backoffDelay = Math.min(
        rateLimitConfig.initialBackoff *
          Math.pow(rateLimitConfig.backoffMultiplier, retryCount),
        rateLimitConfig.maxBackoff
      );

      // Add jitter to avoid thundering herd
      const jitter = Math.random() * 1000;
      const delay = backoffDelay + jitter;

      // Notify user on first retry
      if (retryCount === 0) {
        notifyRateLimit(context);
        // Increase delays when rate limit detected
        rateLimitConfig.baseDelay = Math.min(
          rateLimitConfig.baseDelay * 2,
          2000
        );
        rateLimitConfig.workspaceDelay = Math.min(
          rateLimitConfig.workspaceDelay * 2,
          5000
        );
        rateLimitConfig.trackDelay = Math.min(
          rateLimitConfig.trackDelay * 2,
          2000
        );
        rateLimitConfig.metadataDelay = Math.min(
          rateLimitConfig.metadataDelay * 2,
          3000
        );
        rateLimitConfig.rateLimitDetected = true;
        await updateRateLimitConfig(rateLimitConfig);
      }

      console.warn(
        `Rate limit detected${
          context ? ` for ${context}` : ""
        }. Retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${
          rateLimitConfig.maxRetries
        })...`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));

      return retryWithBackoff(fn, context, retryCount + 1);
    }

    // If not rate limit or max retries reached, throw error
    throw error;
  }
}

// Load config on startup
loadRateLimitConfig();

// Fetch a single page of workspaces
async function fetchWorkspacesPage(page = 1) {
  return retryWithBackoff(async () => {
    const authToken = await getTokenFromStorage();
    const deviceId = await getDeviceId();
    const browserToken = generateBrowserToken();

    const response = await fetch(
      `https://studio-api.prod.suno.com/api/project/me?page=${page}&sort=created_at&show_trashed=false`,
      {
        method: "GET",
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.8",
          authorization: `Bearer ${authToken}`,
          "browser-token": browserToken,
          "cache-control": "no-cache",
          "device-id": deviceId,
          origin: "https://suno.com",
          pragma: "no-cache",
          referer: "https://suno.com/",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`HTTP ${response.status}: ${errorText}`);
      error.status = response.status;
      throw error;
    }

    return await response.json();
  }, `workspace page ${page}`);
}

// Get all workspaces with pagination support
async function getWorkspaces() {
  const allWorkspaces = [];
  let page = 1;
  let hasMore = true;
  const pageSize = 20; // Typical page size for workspaces API

  while (hasMore) {
    try {
      const data = await fetchWorkspacesPage(page);
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
          await new Promise((resolve) =>
            setTimeout(resolve, rateLimitConfig.baseDelay)
          );
          page++;
        } else {
          break;
        }
      }
    } catch (error) {
      const isRateLimit =
        error.message &&
        (error.message.includes("429") ||
          error.message.includes("Too many requests") ||
          error.status === 429);

      // If error on page 1, throw it (retry logic is in fetchWorkspacesPage)
      if (page === 1) {
        throw error;
      }

      // For rate limit errors on later pages, log and continue with what we have
      if (isRateLimit) {
        console.warn(
          `Rate limit error on workspace page ${page}. Continuing with ${allWorkspaces.length} workspaces fetched so far.`
        );
        notifyRateLimit();
      } else {
        // For other errors on later pages, we've probably reached the end
        console.error(`Error fetching workspace page ${page}:`, error.message);
      }
      break;
    }
  }

  return allWorkspaces;
}

// Fetch tracks from Suno API for a specific workspace
async function fetchTracks(
  cursor = null,
  limit = 100,
  workspaceId = "default"
) {
  return retryWithBackoff(async () => {
    const authToken = await getTokenFromStorage();
    const deviceId = await getDeviceId();
    const browserToken = generateBrowserToken();

    const response = await fetch(
      "https://studio-api.prod.suno.com/api/feed/v3",
      {
        method: "POST",
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.8",
          authorization: `Bearer ${authToken}`,
          "browser-token": browserToken,
          "cache-control": "no-cache",
          "content-type": "application/json",
          "device-id": deviceId,
          origin: "https://suno.com",
          pragma: "no-cache",
          referer: "https://suno.com/",
        },
        body: JSON.stringify({
          cursor: cursor,
          limit: limit,
          filters: {
            disliked: "False",
            trashed: "False",
            // Removed stem filter to include STEMs and regular tracks
            workspace: {
              presence: "True",
              workspaceId: workspaceId,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`HTTP ${response.status}: ${errorText}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();

    // Log track properties for debugging stems/uploads
    if (data.clips && data.clips.length > 0) {
      console.log(`=== FETCHED ${data.clips.length} TRACKS FROM API ===`);
      data.clips.slice(0, 3).forEach((track, index) => {
        // Log first 3 tracks as sample
        console.log(
          `\n--- Sample Track ${index + 1}: ${track.title || track.id} ---`
        );
        console.log("All track keys:", Object.keys(track));
        console.log("Track properties:", {
          id: track.id,
          title: track.title,
          type: track.type,
          is_stem: track.is_stem,
          metadata: track.metadata
            ? {
                ...track.metadata,
                metadataKeys: Object.keys(track.metadata),
              }
            : null,
          // Log important properties
          audio_url: track.audio_url ? "present" : "missing",
          status: track.status,
          // Log any other interesting properties
          allTopLevelProps: Object.keys(track).reduce((acc, key) => {
            const value = track[key];
            if (
              typeof value === "object" &&
              value !== null &&
              !Array.isArray(value)
            ) {
              acc[key] = `[Object: ${Object.keys(value).join(", ")}]`;
            } else if (Array.isArray(value)) {
              acc[key] = `[Array: ${value.length} items]`;
            } else {
              acc[key] = value;
            }
            return acc;
          }, {}),
        });
      });
      console.log("=== END TRACK SAMPLES ===\n");
    }

    return data;
  }, `workspace ${workspaceId}`);
}

// Generate sidecar file content
function generateSidecarFile(metadata, filename) {
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
  if (metadata.comment) lines.push(`Prompt: ${metadata.comment}`); // metadata.comment corresponds to prompt/styles
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
    lines.push("--- Raw API Response ---");
    try {
      lines.push(JSON.stringify(metadata.fullData, null, 2));
    } catch (e) {
      lines.push("(Error serializing raw data)");
    }
  }

  return lines.join("\n");
}

// Download file with metadata embedding (CDN files don't have metadata, so we embed client-side)
async function downloadFileWithMetadataFromBillingEndpoint(
  clipId,
  filename,
  format = "mp3",
  url = null
) {
  try {
    // If we have a specific URL provided (e.g. for WAV files), use it
    // Otherwise fallback to billing endpoint + CDN logic
    let audioUrl = url;
    let audioBlob = null;

    // For MP3s without a specific URL, we can use the billing endpoint for tracking
    if (!audioUrl && format === "mp3") {
      const authToken = await getTokenFromStorage();
      const deviceId = await getDeviceId();
      const browserToken = generateBrowserToken();

      // Call the billing download endpoint (for tracking/analytics, same as web UI)
      try {
        const downloadResponse = await fetch(
          `https://studio-api.prod.suno.com/api/billing/clips/${clipId}/download/`,
          {
            method: "POST",
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.8",
              authorization: `Bearer ${authToken}`,
              "browser-token": browserToken,
              "cache-control": "no-cache",
              "device-id": deviceId,
              origin: "https://suno.com",
              pragma: "no-cache",
              referer: "https://suno.com/",
            },
          }
        );
        // Don't fail if this endpoint fails, it's just for tracking
        if (downloadResponse.ok) {
          await downloadResponse.json();
        }
      } catch (error) {
        console.warn("Billing endpoint call failed (non-critical):", error);
      }
    }

    // Fetch track metadata
    const trackMetadata = await fetchTrackMetadata(clipId);

    // If no URL provided, get it from metadata or CDN
    if (!audioUrl) {
      audioUrl =
        trackMetadata.fullData?.audio_url ||
        `https://cdn1.suno.ai/${clipId}.mp3`;
    }

    // Fetch audio file as blob
    console.log(`Fetching audio from: ${audioUrl}`);
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to fetch audio file: ${audioResponse.status}`);
    }
    audioBlob = await audioResponse.blob();

    // Ensure blob has a type
    if (!audioBlob.type && format === "mp3") {
      console.log("Audio blob missing type, defaulting to audio/mpeg");
      audioBlob = new Blob([audioBlob], { type: "audio/mpeg" });
    } else if (!audioBlob.type && format === "wav") {
      audioBlob = new Blob([audioBlob], { type: "audio/wav" });
    }

    // Extract metadata from track data
    const metadata = extractMetadataFromTrack(
      trackMetadata.fullData || trackMetadata
    );
    console.log("Extracted metadata for embedding:", metadata);
    console.log("Cover art URL:", metadata.coverArt);

    // For WAV files, use direct URL download to avoid message size limits
    // WAV files are too large to send through Chrome messages
    if (format === "wav") {
      console.log(
        "Using direct URL download for WAV file (too large for message transfer)"
      );
      // Use direct URL download for WAV files
      return downloadFromUrl(
        audioUrl,
        filename,
        clipId,
        format,
        null, // No blob needed
        trackMetadata,
        metadata
      );
    }

    // Embed metadata into audio blob
    // Skip embedding for WAV files as requested to avoid issues, or if format is not mp3
    if (format === "mp3" && Object.keys(metadata).length > 0) {
      try {
        audioBlob = await embedMetadata(audioBlob, metadata);
        console.log("Metadata embedding completed");
      } catch (error) {
        console.error(
          "Failed to embed metadata, continuing with original file:",
          error
        );
        // Continue with original blob if embedding fails
      }
    }

    // For large files, use content script to download (it can use URL.createObjectURL)
    // For small files, use data URL
    const fileSize = audioBlob.size;

    // CHANGE THIS LINE: Set to 0 to force the robust Content Script method for ALL files
    const maxDataUrlSize = 0;

    if (fileSize > maxDataUrlSize) {
      // Use content script for large files (can use URL.createObjectURL)
      return new Promise((resolve, reject) => {
        // Send message to content script to handle large file download
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].url && tabs[0].url.includes("suno.com")) {
            // Convert blob to base64 for transfer (chunked to avoid memory issues)
            const reader = new FileReader();
            reader.onloadend = () => {
              if (reader.error) {
                reject(
                  new Error("Failed to read blob: " + reader.error.message)
                );
                return;
              }
              const base64 = reader.result.split(",")[1];

              // Check message size - Chrome has a limit (~64MB, but base64 increases size by ~33%)
              // If too large, fall back to direct URL download
              const estimatedSize = base64.length * 0.75; // Approximate binary size
              if (estimatedSize > 50 * 1024 * 1024) {
                // 50MB safety limit
                console.warn(
                  "File too large for message transfer, using direct URL download"
                );
                return downloadFromUrl(
                  audioUrl,
                  filename,
                  clipId,
                  format,
                  audioBlob,
                  trackMetadata,
                  metadata
                )
                  .then(resolve)
                  .catch(reject);
              }

              chrome.tabs.sendMessage(
                tabs[0].id,
                {
                  action: "downloadLargeFileWithMetadata",
                  blobData: base64,
                  blobType: audioBlob.type,
                  filename: filename,
                  clipId: clipId,
                  format: format,
                  metadata: metadata,
                },
                (response) => {
                  if (chrome.runtime.lastError) {
                    // If message fails due to size, fall back to direct URL
                    if (
                      chrome.runtime.lastError.message.includes(
                        "Message length exceeded"
                      )
                    ) {
                      console.warn(
                        "Message too large, falling back to direct URL download"
                      );
                      downloadFromUrl(
                        audioUrl,
                        filename,
                        clipId,
                        format,
                        audioBlob,
                        trackMetadata,
                        metadata
                      )
                        .then(resolve)
                        .catch(reject);
                    } else if (
                      chrome.runtime.lastError.message.includes(
                        "Receiving end does not exist"
                      ) ||
                      chrome.runtime.lastError.message.includes(
                        "Could not establish connection"
                      )
                    ) {
                      // Content script not available, fall back to direct URL
                      console.warn(
                        "Content script not available, using direct URL download"
                      );
                      downloadFromUrl(
                        audioUrl,
                        filename,
                        clipId,
                        format,
                        audioBlob,
                        trackMetadata,
                        metadata
                      )
                        .then(resolve)
                        .catch(reject);
                    } else {
                      reject(new Error(chrome.runtime.lastError.message));
                    }
                  } else if (response && response.success) {
                    resolve(1); // Success
                  } else {
                    reject(new Error(response?.error || "Download failed"));
                  }
                }
              );
            };
            reader.onerror = () => reject(new Error("Failed to read blob"));
            reader.readAsDataURL(audioBlob);
          } else {
            // Fallback: try to use data URL even for large files (may fail but worth trying)
            console.warn(
              "Suno.com tab not found, attempting data URL for large file"
            );
            downloadBlobAsDataUrl(
              audioBlob,
              filename,
              clipId,
              format,
              trackMetadata,
              metadata
            )
              .then(resolve)
              .catch(reject);
          }
        });
      });
    } else {
      // Use data URL for small files
      return downloadBlobAsDataUrl(
        audioBlob,
        filename,
        clipId,
        format,
        trackMetadata,
        metadata
      );
    }
  } catch (error) {
    console.error("Error downloading with metadata:", error);
    throw error;
  }
}

// Helper function to download blob as data URL
async function downloadBlobAsDataUrl(
  audioBlob,
  filename,
  clipId,
  format,
  trackMetadata = null,
  metadata = {}
) {
  // Convert blob to data URL (service workers don't support URL.createObjectURL)
  const fileSize = audioBlob.size;
  const maxDataUrlSize = 2 * 1024 * 1024; // 2MB limit

  let downloadUrl;
  if (fileSize <= maxDataUrlSize) {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      // Convert in chunks to avoid stack overflow
      let base64 = "";
      const chunkSize = 8192;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.slice(i, i + chunkSize);
        base64 += btoa(String.fromCharCode.apply(null, chunk));
      }
      downloadUrl = `data:${audioBlob.type || "audio/mpeg"};base64,${base64}`;
    } catch (error) {
      console.warn("Failed to create data URL, using original URL:", error);
      // Fallback: get original URL from track data
      if (!trackMetadata && clipId) {
        trackMetadata = await fetchTrackMetadata(clipId);
      }
      downloadUrl =
        trackMetadata?.fullData?.audio_url ||
        `https://cdn1.suno.ai/${clipId}.mp3`;
    }
  } else {
    console.warn(
      `File too large (${fileSize} bytes) for data URL, using original URL.`
    );
    if (!trackMetadata && clipId) {
      trackMetadata = await fetchTrackMetadata(clipId);
    }
    downloadUrl =
      trackMetadata?.fullData?.audio_url ||
      `https://cdn1.suno.ai/${clipId}.mp3`;
  }

  return downloadFromUrl(
    downloadUrl,
    filename,
    clipId,
    format,
    audioBlob,
    trackMetadata,
    metadata
  );
}

// Download file with metadata embedding (fallback method)
async function downloadFileWithMetadata(
  url,
  filename,
  clipId = null,
  format = "mp3"
) {
  try {
    // Always use the billing endpoint approach if we have clipId (embeds metadata client-side)
    if (clipId) {
      try {
        return await downloadFileWithMetadataFromBillingEndpoint(
          clipId,
          filename,
          format,
          url // Pass the URL (important for WAV)
        );
      } catch (error) {
        console.warn(
          "Metadata embedding failed, falling back to direct download:",
          error
        );
        // Fall through to direct download without metadata
      }
    }

    // Fallback: direct download without metadata (shouldn't normally happen)
    downloadFilenames.set(url, filename);
    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: url,
          filename: filename,
          saveAs: false,
          conflictAction: "uniquify",
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            downloadFilenames.delete(url);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            if (clipId) {
              downloadIdToClipId.set(downloadId, { clipId, format });
            }
            setTimeout(() => {
              downloadFilenames.delete(url);
            }, 1000);
            resolve(downloadId);
          }
        }
      );
    });
  } catch (error) {
    throw error;
  }
}

// Helper to download from URL with optional metadata
async function downloadFromUrl(
  downloadUrl,
  filename,
  clipId,
  format,
  audioBlob = null,
  trackMetadata = null,
  metadata = {}
) {
  // Store the filename by download URL
  downloadFilenames.set(downloadUrl, filename);

  // Download the file
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: downloadUrl,
        filename: filename,
        saveAs: false,
        conflictAction: "uniquify",
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          downloadFilenames.delete(downloadUrl);
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          // Store clipId and format for tracking
          if (clipId) {
            downloadIdToClipId.set(downloadId, { clipId, format });
          }

          // Generate and save sidecar file if metadata is available
          if (trackMetadata && Object.keys(metadata).length > 0) {
            // Use .mp3.txt or .wav.txt to avoid conflicts
            const sidecarFilename = filename + ".txt";
            const sidecarContent = generateSidecarFile(metadata, filename);
            const sidecarBase64 = btoa(
              unescape(encodeURIComponent(sidecarContent))
            );
            const sidecarDataUrl = `data:text/plain;base64,${sidecarBase64}`;

            downloadFilenames.set(sidecarDataUrl, sidecarFilename);

            chrome.downloads.download(
              {
                url: sidecarDataUrl,
                filename: sidecarFilename,
                saveAs: false,
                conflictAction: "uniquify",
              },
              () => {
                // Clean up after a delay
                setTimeout(() => {
                  downloadFilenames.delete(sidecarDataUrl);
                }, 1000);
              }
            );
          }

          // Clean up after a delay
          setTimeout(() => {
            downloadFilenames.delete(downloadUrl);
          }, 1000);

          resolve(downloadId);
        }
      }
    );
  });
}

// Download file using Chrome downloads API (legacy function, now uses metadata version)
async function downloadFile(url, filename, clipId = null, format = "mp3") {
  // Use the new metadata-enabled download function
  return downloadFileWithMetadata(url, filename, clipId, format);
}

// Initiate WAV conversion
async function initiateWavConversion(clipId) {
  const authToken = await getTokenFromStorage();
  const deviceId = await getDeviceId();
  const browserToken = generateBrowserToken();

  const response = await fetch(
    `https://studio-api.prod.suno.com/api/gen/${clipId}/convert_wav/`,
    {
      method: "POST",
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.8",
        authorization: `Bearer ${authToken}`,
        "browser-token": browserToken,
        "cache-control": "no-cache",
        "device-id": deviceId,
        origin: "https://suno.com",
        pragma: "no-cache",
        referer: "https://suno.com/",
      },
    }
  );

  // Accept 204 No Content as success
  if (!response.ok && response.status !== 204) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
}

// Poll for WAV file URL
async function pollWavFile(clipId, maxAttempts = 60, interval = 2000) {
  const authToken = await getTokenFromStorage();
  const deviceId = await getDeviceId();
  const browserToken = generateBrowserToken();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `https://studio-api.prod.suno.com/api/gen/${clipId}/wav_file/`,
      {
        method: "GET",
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.8",
          authorization: `Bearer ${authToken}`,
          "browser-token": browserToken,
          "cache-control": "no-cache",
          "device-id": deviceId,
          origin: "https://suno.com",
          pragma: "no-cache",
          referer: "https://suno.com/",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        // Not ready yet, continue polling
        await new Promise((resolve) => setTimeout(resolve, interval));
        continue;
      }
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    if (data.wav_file_url) {
      return data.wav_file_url;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`WAV conversion timeout after ${maxAttempts} attempts`);
}

// Cache tracks by workspace ID (no expiry - user controls refresh)
async function getCachedTracks(workspaceId) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(
      [`tracks_${workspaceId}`, `tracks_${workspaceId}_timestamp`],
      (result) => {
        const cachedTracks = result[`tracks_${workspaceId}`];
        const timestamp = result[`tracks_${workspaceId}_timestamp`];

        if (cachedTracks && timestamp) {
          resolve({ tracks: cachedTracks, timestamp: timestamp });
        } else {
          reject(new Error("No cached tracks"));
        }
      }
    );
  });
}

// Get cache timestamp for a workspace
async function getCacheTimestamp(workspaceId) {
  return new Promise((resolve) => {
    chrome.storage.local.get([`tracks_${workspaceId}_timestamp`], (result) => {
      resolve(result[`tracks_${workspaceId}_timestamp`] || null);
    });
  });
}

async function cacheTracks(workspaceId, tracks) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [`tracks_${workspaceId}`]: tracks,
        [`tracks_${workspaceId}_timestamp`]: Date.now(),
      },
      () => {
        resolve();
      }
    );
  });
}

async function refreshWorkspaceTracks(workspaceId) {
  // Fetch fresh tracks for the workspace
  const allTracks = [];
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore) {
    try {
      const response = await fetchTracks(cursor, 100, workspaceId);
      const clips = response.clips || [];
      allTracks.push(...clips);
      pageCount++;

      hasMore =
        response.has_more === true ||
        (clips.length === 100 && response.next_cursor);
      cursor = response.next_cursor;

      if (hasMore) {
        await new Promise((resolve) =>
          setTimeout(resolve, rateLimitConfig.trackDelay)
        );
      }
    } catch (error) {
      const isRateLimit =
        error.message &&
        (error.message.includes("429") ||
          error.message.includes("Too many requests") ||
          error.status === 429);

      if (isRateLimit) {
        // Retry logic is handled in fetchTracks, but if it still fails after max retries,
        // we should continue with what we have and log the error
        console.error(
          `Rate limit error fetching tracks for workspace ${workspaceId} after retries. Continuing with ${allTracks.length} tracks fetched so far.`
        );
        // Break to avoid infinite loop, but return what we have
        break;
      } else {
        // For other errors, rethrow
        throw error;
      }
    }
  }

  // Cache the tracks (even if incomplete due to rate limiting)
  if (allTracks.length > 0) {
    await cacheTracks(workspaceId, allTracks);
  }

  return allTracks;
}

// Refresh all workspaces and their tracks
async function refreshAllWorkspaces() {
  // Get all workspaces first
  const workspaces = await getWorkspaces();

  // Refresh tracks for each workspace
  for (let i = 0; i < workspaces.length; i++) {
    const workspace = workspaces[i];
    try {
      await refreshWorkspaceTracks(workspace.id);
      // Add delay between workspaces to avoid rate limiting
      if (i < workspaces.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, rateLimitConfig.workspaceDelay)
        );
      }
    } catch (error) {
      const isRateLimit =
        error.message &&
        (error.message.includes("429") ||
          error.message.includes("Too many requests") ||
          error.status === 429);

      if (isRateLimit) {
        console.error(
          `Error refreshing workspace ${
            workspace.name || workspace.id
          }: Rate limit error. Continuing with other workspaces...`
        );
        notifyRateLimit(workspace.name || workspace.id);
      } else {
        console.error(
          `Error refreshing workspace ${workspace.name || workspace.id}:`,
          error.message
        );
      }
      // Continue with other workspaces even on error
      if (i < workspaces.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, rateLimitConfig.workspaceDelay)
        );
      }
    }
  }

  return workspaces;
}

// Fetch detailed track metadata from Suno API
async function fetchTrackMetadata(clipId) {
  return retryWithBackoff(async () => {
    const authToken = await getTokenFromStorage();
    const deviceId = await getDeviceId();
    const browserToken = generateBrowserToken();

    const response = await fetch(
      `https://studio-api.prod.suno.com/api/feed/?ids=${clipId}`,
      {
        method: "GET",
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.8",
          authorization: `Bearer ${authToken}`,
          "browser-token": browserToken,
          "cache-control": "no-cache",
          "device-id": deviceId,
          origin: "https://suno.com",
          pragma: "no-cache",
          referer: "https://suno.com/",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`HTTP ${response.status}: ${errorText}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();

    // Log full response for investigation
    console.log("Full track metadata response:", JSON.stringify(data, null, 2));

    // Extract track data (API may return array or object)
    let track = null;
    if (Array.isArray(data)) {
      track = data[0] || data;
    } else if (data.clips && Array.isArray(data.clips)) {
      track = data.clips[0];
    } else if (data.id) {
      track = data;
    } else {
      track = data;
    }

    if (!track) {
      throw new Error("No track data found in API response");
    }

    // Extract metadata fields (investigate structure)
    const metadata = {
      // Basic fields
      title: track.title || null,
      id: track.id || clipId,

      // Lyrics - check multiple possible locations (infill_lyrics contains the actual lyrics)
      lyrics:
        track.metadata?.infill_lyrics ||
        track.lyrics ||
        track.metadata?.lyrics ||
        track.lyric ||
        track.metadata?.prompt ||
        null,

      // BPM/Tempo - check multiple possible locations
      bpm:
        track.bpm ||
        track.metadata?.bpm ||
        track.metadata?.tempo ||
        track.tempo ||
        null,

      // Key - check multiple possible locations
      key:
        track.key ||
        track.metadata?.key ||
        track.metadata?.musical_key ||
        track.musical_key ||
        null,

      // Prompt - check multiple possible locations
      // User requested "styles" for prompt, so prioritize tags/style fields
      prompt:
        track.metadata?.tags ||
        track.metadata?.gpt_description_prompt ||
        track.metadata?.prompt ||
        track.prompt ||
        null,

      // Cover Art - check multiple possible locations
      coverArt:
        track.image_url ||
        track.image_large_url ||
        track.cover_url ||
        track.metadata?.image_url ||
        track.metadata?.cover_url ||
        track.image ||
        track.cover_image ||
        null,

      // Additional metadata
      duration: track.metadata?.duration || track.duration || null,
      tags: track.metadata?.tags || track.tags || null,
      genre: track.metadata?.genre || track.genre || null,
      artist:
        track.metadata?.artist || track.artist || track.display_name || null,

      // Store full track data for reference
      fullData: track,
    };

    // Log extracted metadata for debugging
    console.log("Extracted metadata:", metadata);
    if (metadata.lyrics)
      console.log("Lyrics found, length:", metadata.lyrics.length);
    else console.warn("No lyrics found");

    if (metadata.prompt)
      console.log("Prompt found, length:", metadata.prompt.length);
    else console.warn("No prompt found");

    if (metadata.coverArt)
      console.log("Cover art URL found:", metadata.coverArt);
    else console.warn("No cover art URL found");

    return metadata;
  }, `track metadata ${clipId}`);
}

// Fetch metadata for all tracks in background
async function fetchAllTracksMetadata(trackIds) {
  let successCount = 0;
  let failedCount = 0;
  const total = trackIds.length;

  console.log(`Starting background metadata fetch for ${total} tracks...`);

  for (let i = 0; i < total; i++) {
    const trackId = trackIds[i];
    try {
      // Check if already cached to avoid unnecessary API calls
      const cached = await new Promise((resolve) => {
        chrome.storage.local.get([`track_metadata_${trackId}`], (result) => {
          resolve(result[`track_metadata_${trackId}`]);
        });
      });

      if (!cached) {
        // Fetch metadata
        const metadata = await fetchTrackMetadata(trackId);
        // Store in cache
        await new Promise((resolve) => {
          chrome.storage.local.set(
            { [`track_metadata_${trackId}`]: metadata },
            resolve
          );
        });
        // Delay between requests
        await new Promise((resolve) =>
          setTimeout(resolve, rateLimitConfig.metadataDelay)
        );
      }
      successCount++;
    } catch (error) {
      console.error(`Failed to fetch metadata for ${trackId}:`, error);
      failedCount++;
      // Continue with other tracks
    }

    // Send progress update
    const percentage = Math.round(((i + 1) / total) * 100);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs
          .sendMessage(tabs[0].id, {
            action: "metadataFetchProgress",
            current: i + 1,
            total: total,
            percentage: percentage,
          })
          .catch(() => {
            // Ignore errors if content script is not available or tab was closed
          });
      }
    });
  }

  console.log(
    `Metadata fetch complete. Success: ${successCount}, Failed: ${failedCount}`
  );

  // Send completion message
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].id) {
      chrome.tabs
        .sendMessage(tabs[0].id, {
          action: "metadataFetchComplete",
          successCount,
          failedCount,
        })
        .catch(() => {
          // Ignore errors if content script is not available or tab was closed
        });
    }
  });

  return { successCount, failedCount };
}
