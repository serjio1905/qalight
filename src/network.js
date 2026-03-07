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
        QA.reporter.log(`RESPONSE`, "info");
        // if (!this.isRequestJson(response)) return;
        try {
            // const data = await response.json();
            const log = {
                url: response.url(),
                // status: response.status(),
                // method: response.request().method(),
                // response: data,
                // headers: response.headers(),
                // cookies: response.request().cookies(),
                // params: response.request().params(),
                // query: response.request().query(),
                // path: response.request().path(),
                // body: response.request().body(),
                // time: Date.now() - response.request().startTime(),
                // duration: Date.now() - response.request().startTime(),
            };
            // this.responses.push(log);
            if (this.responseCallback) {
                this.responseCallback?.(log);
            }
        } catch (e) {}
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

            await this.page.waitForTimeout(pollMs);
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
