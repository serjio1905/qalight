import { QA } from "./qa.js";

export class NetworkTracker {
    constructor(page, responseCallback = null) {
        this.page = page;
        this.pending = new Set();
        this.pendingCount = 0;
        this.responses = [];
        this.responseCallback = responseCallback;
        this.onRequest = this.onRequest.bind(this);
        this.onRequestFinished = this.onRequestFinished.bind(this);
        this.onRequestFailed = this.onRequestFailed.bind(this);
        this.onResponse = this.onResponse.bind(this);

        this.page.on("request", this.onRequest);
        this.page.on("requestfinished", this.onRequestFinished);
        this.page.on("requestfailed", this.onRequestFailed);
        this.page.on("response", this.onResponse);
    }

    isRequestJson(request) {
        const contentType = request.headers()["content-type"] || "";
        return contentType.includes("application/json");
    }

    onRequest(request) {
        // if (!this.isRequestJson(request)) return;
        // this.pending.add(request);
        this.pendingCount++;
    }

    onRequestFinished(request) {
        // if (!this.isRequestJson(request)) return;
        // this.pending.delete(request);
        this.pendingCount--;
    }

    onRequestFailed(request) {
        // if (!this.isRequestJson(request)) return;
        // this.pending.delete(request);
        this.pendingCount--;
    }

    async onResponse(response) {
        if (!this.isRequestJson(response)) return;
        try {
            const data = await response.json();
            const log = {
                url: response.url(),
                status: response.status(),
                method: response.request().method(),
                response: data,
                body: response.request().postData(),
                headers: response.headers(),
            };
            if (this.responseCallback) {
                this.responseCallback?.(log);
            }
        } catch (e) {}
    }

    /**
     * @param {(log: {url: string, status: number, method: string, response: any, body: string|null|undefined, headers: Record<string, string>}) => void} callback
     */
    setResponseCallback(callback) {
        this.responseCallback = callback;
    }

    async waitForIdle({ timeout = 10000, idleMs = 300, pollMs = 50 } = {}) {
        const start = Date.now();
        let idleStart = null;

        while (Date.now() - start < timeout) {
            if (this.pendingCount === 0) {
                if (!idleStart) idleStart = Date.now();
                if (Date.now() - idleStart >= idleMs) return;
            } else {
                idleStart = null;
            }

            // Instead of this.page.waitForTimeout (which fails if test ended), use a regular delay
            await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
        this.pendingCount = 0;
    }

    dispose() {
        this.page.off("request", this.onRequest);
        this.page.off("requestfinished", this.onRequestFinished);
        this.page.off("requestfailed", this.onRequestFailed);
        this.page.off("response", this.onResponse);
    }
}
