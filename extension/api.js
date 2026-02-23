// API Client for Suno Auth Sharing

const DEFAULT_BACKEND_URL = ""; // User needs to configure this

class ApiClient {
    constructor() {
        this.backendUrl = DEFAULT_BACKEND_URL;
        this.loadBackendUrl();
    }

    async loadBackendUrl() {
        const result = await chrome.storage.local.get(["backendUrl"]);
        if (result.backendUrl) {
            this.backendUrl = result.backendUrl;
        }
    }

    async setBackendUrl(url) {
        this.backendUrl = url;
        await chrome.storage.local.set({ backendUrl: url });
    }

    async _post(action, data) {
        if (!this.backendUrl) {
            throw new Error("Backend URL not configured");
        }

        try {
            const response = await fetch(this.backendUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    action,
                    ...data,
                }),
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`API Error (${action}):`, error);
            throw error;
        }
    }

    // Receiver: Request access from a target hash
    async requestAccess(requesterHash, targetHash) {
        return this._post("request", { requesterHash, targetHash });
    }

    // Sharer: Poll for pending requests
    async pollRequests(userHash) {
        return this._post("poll", { userHash });
    }

    // Sharer: Approve a request and send credentials
    async approveRequest(requestId, credentials) {
        return this._post("approve", { requestId, credentials });
    }

    // Receiver: Claim credentials using OTP
    async claimCredentials(requestId, otp) {
        return this._post("claim", { requestId, otp });
    }
}

export const api = new ApiClient();
