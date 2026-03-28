export class ConsoleLogger {
    constructor(
        /** @type {import('@playwright/test').Page} */
        page,
        /** @type {{warn: boolean, info: boolean, error: boolean, success: boolean, log: boolean}} */
        options = {
            warn: true,
            info: false,
            error: true,
            success: true,
            log: false,
        }
    ) {
        this.page = page;
        this.options = options;
    }

    _prepareMessage(message, icon) {
        return `[${new Date().toISOString()}] ${icon} Console: ${message.text()}`;
    }

    startLogging() {
        this.page.on("console", (message) => {
            switch (message.type()) {
                case "log":
                    if (this.options.log) {
                        console.log(this._prepareMessage(message, "ℹ️"));
                    }
                    break;
                case "warn":
                    if (this.options.warn) {
                        console.warn(this._prepareMessage(message, "⚠️"));
                    }
                    break;
                case "error":
                    if (this.options.error) {
                        console.error(this._prepareMessage(message, "❌"));
                    }
                    break;
                case "success":
                    if (this.options.success) {
                        console.success(this._prepareMessage(message, "✅"));
                    }
                    break;
                case "info":
                    if (this.options.info) {
                        console.info(this._prepareMessage(message, "ℹ️"));
                    }
                    break;
                default:
                    if (this.options.log) {
                        console.log(this._prepareMessage(message, "ℹ️"));
                    }
                    break;
            }
        });
    }
}
