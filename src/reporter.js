export class QAReporter {
    static TYPES = {
        info: "info",
        success: "success",
        warning: "warning",
        error: "error",
    };

    constructor(page, testInfo) {
        /** @type {import('@playwright/test').Page} */
        this.page = page;
        this.testInfo = testInfo;
        this.logs = [];
    }

    _icon(type) {
        return (
            {
                [QAReporter.TYPES.info]: "ℹ️",
                [QAReporter.TYPES.success]: "✅",
                [QAReporter.TYPES.warning]: "⚠️",
                [QAReporter.TYPES.error]: "❌",
            }[type] || "ℹ️"
        );
    }

    async log(message, type = QAReporter.TYPES.info, withSnapshot = false) {
        const log = `${this._icon(type)} ${message}`;
        const line = `[${new Date().toISOString()}] ${log}`;
        this.logs.push(line);
        if (withSnapshot) {
            await this.snapshot(log);
        }

        // IMPORTANT: remove console.log to avoid "STDOUT" in HTML report
        // if (!this.silent) console.log(line);
    }

    async info(message) {
        return await this.log(message, QAReporter.TYPES.info);
    }

    async success(message) {
        return await this.log(message, QAReporter.TYPES.success);
    }

    async warning(message) {
        return await this.log(message, QAReporter.TYPES.warning);
    }

    async error(message) {
        return await this.log(message, QAReporter.TYPES.error);
    }

    async snapshot(name = "snapshot", opts = {}) {
        const img = await this.page.screenshot({ fullPage: !!opts.fullPage });
        await this.testInfo.attach(`📸 ${name}`, {
            body: img,
            contentType: "image/png",
        });
    }

    // Call once at end of test (best via fixture teardown)
    async flush(name = "QA Log") {
        await this.testInfo.attach(name, {
            body: Buffer.from(this.logs.join("\n"), "utf-8"),
            contentType: "text/plain",
        });
    }
}
