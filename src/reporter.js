export class QAReporter {
    static TYPES = {
        info: "info",
        success: "success",
        warning: "warning",
        error: "error",
        // Something a human did by hand while the test was paused — never a scripted step.
        action: "action",
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
                [QAReporter.TYPES.action]: "👤",
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

    /**
     * Logs an action a human performed manually (e.g. while `qa.pause()` held the run), as opposed
     * to a step executed by the scenario.
     * @param {string} message
     * @param {boolean} [withSnapshot=false]
     */
    async userAction(message, withSnapshot = false) {
        return await this.log(message, QAReporter.TYPES.action, withSnapshot);
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
