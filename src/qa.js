import { expect } from "@playwright/test";
import { expect as chaiExpect } from "chai";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { API } from "./api.js";
import { ExpectFramework } from "./expect.js";
import { DEFAULT_WAIT_TIME, TAGS } from "./constants.js";
import { QAReporter } from "./reporter.js";
import { WeightPointCalculator } from "./points.js";
import { ConsoleLogger } from "./console.js";
import { UserActionRecorder, AI_AGENT_PAUSE_GUIDANCE } from "./user-actions.js";

// How long `_highlight` may wait for its locator to resolve before skipping the highlight.
// Cosmetic only — see `_highlight` for why it must be bounded.
const HIGHLIGHT_RESOLVE_TIMEOUT = 1000;

export class QAError extends Error {
    constructor(message) {
        super(message);
        this.name = "QAError";
    }
}

export class QA {
    DEFAULT_WAIT_TIME = DEFAULT_WAIT_TIME;
    // DEFAULT_MATCHING_WEIGHT = 0.5;
    // DEFAULT_PARTIAL_MATCHING_WEIGHT = 0.1;
    // MATCHING_WEIGHTS = MATCHING_WEIGHTS;
    TAGS = TAGS;

    static reporter = null;

    /**
     * @param {import('@playwright/test').Page} page
     * @param {Object} options
     * @param {number} options.timeout
     * @param {import('@playwright/test').Waiter} options.waiter
     * @param {boolean} options.withHighlight
     * @param {boolean} options.withHint
     * @param {boolean} options.withSnapshots
     * @param {Object} options.restrictionMapping
     * @param {import('@playwright/test').TestInfo} options.testInfo
     * @param {boolean} options.safeMode
     * @param {boolean} options.recordUserActionsOnPause - log manual user actions performed while `pause()` holds the run (default true)
     * @param {Function} options.apiResponseCallback
     * @param {Object} options.consoleLoggerOptions
     * @param {boolean} options.consoleLoggerOptions.warn
     * @param {boolean} options.consoleLoggerOptions.info
     * @param {boolean} options.consoleLoggerOptions.error
     * @param {boolean} options.consoleLoggerOptions.success
     * @param {boolean} options.consoleLoggerOptions.log
     * @returns {QA}
     */
    constructor(
        page,
        options = {
            timeout: this.DEFAULT_WAIT_TIME,
            waiter: null,
            withHighlight: true,
            withHint: false,
            withSnapshots: false,
            restrictionMapping: {},
            testInfo: null,
            safeMode: false,
            consoleLoggerOptions: {
                warn: true,
                info: false,
                error: true,
                success: false,
                log: false,
            },
            apiResponseCallback: (log) => this._defaultApiResponseCallback(log),
        }
    ) {
        this._originalOptions = { ...options };
        this.testInfo = options.testInfo || null;
        if (options.testInfo) {
            QA.reporter = new QAReporter(page, options.testInfo);
        }
        /** @type {import('@playwright/test').Page} */
        this.page = page;
        /** @type {boolean} */
        this.safeMode = options.safeMode;
        this.parentElement = null;
        this.currentElement = null;
        /** @type {number} */
        this.timeout = options.timeout;
        this.queue = [];
        /** @type {import('@playwright/test').Waiter} */
        this.waiter = options.waiter;
        /** @type {boolean} */
        this.withHighlight = options.withHighlight;
        /** @type {boolean} */
        this.withHint = options.withHint;
        /** @type {boolean} */
        this.withSnapshots = options.withSnapshots;
        this.restrictionMapping = options.restrictionMapping || {};
        /** @type {Array<{tag: string, identifiers: string[], exceptIdentifiers: string[], index: number}>} */
        this.matchedElements = [];
        /** @type {API} */
        this.api = new API(
            page,
            {},
            options.apiResponseCallback !== undefined
                ? options.apiResponseCallback
                : (log) => this._defaultApiResponseCallback(log)
        );

        this._expect = new ExpectFramework(this);

        this._pauseResolver = null;
        this._pausedExecutionTrace = null;
        this._pausedReason = null;
        this._aborting = false;
        /** @type {boolean} */
        this.recordUserActionsOnPause = options.recordUserActionsOnPause !== false;
        /** @type {UserActionRecorder} */
        this._userActionRecorder = new UserActionRecorder(page, {
            onAction: (message) => this._reportUserAction(message),
        });
        this.consoleLogger = new ConsoleLogger(page, options.consoleLoggerOptions);
        this.consoleLogger.startLogging();
        return this;
    }

    _defaultApiResponseCallback(log) {
        if (log.status >= 400 && log.status < 500) {
            QA.reporter.log(
                `API Response: ${log.url} ${log.status} ${log.method}\nBody: ${JSON.stringify(log.body)}\nResponse: ${JSON.stringify(log.response)}`,
                "warning"
            );
        } else if (log.status >= 500) {
            QA.reporter.log(
                `API Response: ${log.url} ${log.status} ${log.method}\nBody: ${JSON.stringify(log.body)}\nResponse: ${JSON.stringify(log.response)}`,
                "error"
            );
        }
    }

    static setReporter(page, testInfo) {
        QA.reporter = new QAReporter(page, testInfo);
    }

    setRestrictionMapping(mapping) {
        this.restrictionMapping = mapping;
        return this;
    }

    async open(url, ...args) {
        if (!url) {
            // Activate (open) the tab (page) if it is not activated/focused
            if (this.page && typeof this.page.bringToFront === "function") {
                await this.page.bringToFront();
            }
            return this;
        }
        this.parentElement = null;
        this.currentElement = null;
        this.matchedElements = [];
        this.queue = [];
        let fullUrl = url;
        for (const arg of args) {
            if (typeof arg === "string") {
                fullUrl = `${fullUrl}/${arg}`;
            }
        }
        await this.page.goto(fullUrl);
        return this;
    }

    /**
     * @param {string} url
     * @param {boolean} [incognito=false]
     * @returns {Promise<QA>}
     */
    async openTab(url, incognito = false) {
        let context;

        if (incognito) {
            // create isolated (incognito) context
            context = await this.page.context().browser().newContext();
        } else {
            // reuse existing context
            context = this.page.context();
        }

        const newPage = await context.newPage();
        await newPage.goto(url);

        return new QA(newPage, { ...this._originalOptions });
    }

    async getTab(index = 0) {
        const tabs = await this.page.context().pages();
        return new QA(tabs[index], { ...this._originalOptions });
    }

    async refreshPage() {
        await this.page.reload();
        this.currentElement = null;
        this.matchedElements = [];
        this.queue = [];
        await this.waitFor(2000, false);
        return this;
    }

    get(tag, identifiers = [], index = 0, exceptIdentifiers = [], aroundDepth = 0) {
        this._validateTag(tag);
        const normalizedIdentifiers = this._normalizeIdentifiers(identifiers, exceptIdentifiers);
        this.queue.push({
            tag,
            identifiers: normalizedIdentifiers.identifiers,
            exceptIdentifiers: normalizedIdentifiers.exceptIdentifiers,
            index,
            aroundDepth,
        });
        return this;
    }

    getAround(tag, identifiers = [], index = 0, exceptIdentifiers = [], aroundDepth = 5) {
        return this.get(tag, identifiers, exceptIdentifiers, index, aroundDepth);
    }

    getParent(index = 0) {
        this.queue.push({ parent: index });
        return this;
    }

    setRestriction(tag, identifiers = [], index = 0, exceptIdentifiers = []) {
        const normalizedIdentifiers = this._normalizeIdentifiers(identifiers, exceptIdentifiers);
        this.parentElement = {
            tag,
            identifiers: normalizedIdentifiers.identifiers,
            exceptIdentifiers: normalizedIdentifiers.exceptIdentifiers,
            index,
        };
        return this;
    }

    async restrict() {
        await this._executeQueue();
        if (this.currentElement) {
            this.parentElement = this.currentElement;
        } else {
            throw new QAError(`No element was found to restrict`, this.queue);
        }
        return this;
    }

    clearRestrinction() {
        this.parentElement = null;
        return this;
    }

    async click(double = false) {
        try {
            await this._executeQueue();
            await this._showHint(`Clicking on ${this._describeLastElementInQueue()}`, "info");
            if (double) {
                await this.currentElement.locator.dblclick();
            } else {
                await this.currentElement.locator.click();
            }
        } catch (error) {
            if (this.safeMode) {
                await this.pause(
                    `Failed to click on ${this._describeLastElementInQueue()}. Perform manual action and continue.`
                );
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    async check(value = true) {
        try {
            await this._executeQueue();
            await this._showHint(`Checking ${this._describeLastElementInQueue()}`, "info");
            if (value) {
                await this.currentElement.locator.check({ force: true });
            } else {
                await this.currentElement.locator.uncheck({ force: true });
            }
        } catch (error) {
            if (!error.message?.includes("did not change its state")) {
                if (this.safeMode) {
                    await this.pause(`Failed to check ${this._describeLastElementInQueue()}`);
                } else {
                    await this.abort();
                }
            }
        }
        await this._hideHint();
        return this;
    }

    async fill(text) {
        // In rare cases (e.g. password fields) Playwright's .fill() may only fill the first character.
        // Workaround: clear first, then type char-by-char if .fill() fails.
        // await this.currentElement.locator.fill(""); // Always clear before filling
        try {
            await this._executeQueue();
            await this._showHint(`Filling "${text}" in ${this._describeLastElementInQueue()}`, "info");
            if (typeof text === "number") text = String(text);
            await this.currentElement.locator.fill(text);
            // Check if the fill was successful (compare value)
            // Only do this for input/textarea elements, skip for others
            const tagName = await this.currentElement.locator.evaluate((el) => el.tagName.toLowerCase());
            if (tagName === "input" || tagName === "textarea") {
                const filledValue = await this.currentElement.locator.inputValue();
                if (filledValue !== text) {
                    // Sometimes Playwright or browser (esp. with password fields) only enters the first char
                    // Fallback: type char by char
                    await this.currentElement.locator.fill(""); // clear again
                    await this.currentElement.locator.type(text, { delay: 30 });
                }
            }
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to fill "${text}" in ${this._describeLastElementInQueue()}`);
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    async blur() {
        await this._executeQueue();
        try {
            await this._showHint(`Blurring ${this._describeLastElementInQueue()}`, "info");
            await this.currentElement.locator.focus();
            await this.page.evaluate(() => {
                document.activeElement && document.activeElement.blur();
            });
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to blur ${this._describeLastElementInQueue()}`);
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    async focus() {
        await this._executeQueue();
        try {
            await this._showHint(`Focusing ${this._describeLastElementInQueue()}`, "info");
            await this.page.evaluate(() => {
                document.activeElement && document.activeElement.focus();
            });
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to focus ${this._describeLastElementInQueue()}`);
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    async select(value) {
        await this._executeQueue();
        try {
            await this._showHint(`Selecting in ${this._describeLastElementInQueue()}`, "info");
            await this.currentElement.locator.selectOption(value);
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to select in ${this._describeLastElementInQueue()}`);
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    async setDateTime(yyyy, MM, dd, HH, mm) {
        await this._executeQueue();
        try {
            await this._showHint(`Setting date and time to "${yyyy}-${MM}-${dd} ${HH}:${mm}"`, "info");
            let value = `${yyyy}-${MM < 10 ? `0${MM}` : MM}-${dd < 10 ? `0${dd}` : dd}`;
            if (HH >= 0 && HH < 24 && mm >= 0 && mm < 60) {
                value += `T${HH < 10 ? `0${HH}` : HH}:${mm < 10 ? `0${mm}` : mm}`;
            }
            await this.currentElement.locator.fill(value);
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to set date and time to "${yyyy}-${MM}-${dd} ${HH}:${mm}"`);
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    async setMonth(yyyy, month) {
        // for inputs with type="month"
        await this._executeQueue();
        try {
            await this._showHint(`Setting month to "${yyyy}-${month}"`, "info");
            // For <input type="month"> the format must be 'YYYY-MM'. Ensure leading zero in month.
            const monthString = month < 10 ? `0${month}` : `${month}`;
            await this.currentElement.locator.fill(`${yyyy}-${monthString}`);
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to set month to "${yyyy}-${month}"`);
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    async waitFor(timeout = this.DEFAULT_WAIT_TIME, hint) {
        // if (typeof hint === "string" && hint) this._showHint(hint, "info");
        // if (typeof hint === true) hint = "Waiting for " + timeout + "ms";
        try {
            if (hint) await this._showHint(hint, "info");
            await this.page.waitForTimeout(timeout);
            if (hint) await this._hideHint();
        } catch (error) {}
        // if (hint) await this._hideHint();
    }

    async scroll() {
        await this._executeQueue();
        try {
            await this._showHint(`Scrolling to ${this._describeLastElementInQueue()}`, "info");
            await this._scrollCurrentElementIntoViewport();
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to scroll to ${this._describeLastElementInQueue()}`);
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    async scrollToCurrentElement() {
        await this._executeQueue();
        try {
            await this._showHint(`Scrolling to ${this._describeLastElementInQueue()}`, "info");
            await this._scrollCurrentElementIntoViewport();
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to scroll to ${this._describeLastElementInQueue()}`);
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    /**
     *
     * @param {string} tag
     * @param {string} text
     * @param {Record<string, string>} attrs
     * @param {("vertical" | "horizontal")} direction
     * @returns {Promise<QA>}
     */
    async scrollTo(tag, text, attrs = {}, direction = "vertical") {
        await this._executeQueue();
        try {
            await this._showHint(`Scrolling to ${text}`, "info");
            let identifiersString = `${tag}`;
            if (Object.keys(attrs).length > 0) {
                identifiersString += `[`;
                let isFirst = true;
                for (const [key, value] of Object.entries(attrs)) {
                    if (isFirst) {
                        identifiersString += `${key}*="${value}"`;
                        isFirst = false;
                    } else {
                        identifiersString += `, ${key}*="${value}"`;
                    }
                }
                identifiersString += `]`;
            }
            const targetElement = this.page.locator(identifiersString, { hasText: text });
            await this._scrollContairnerUntilTargetVisible(this.currentElement.locator, targetElement, { direction });
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to scroll to ${text}`);
            } else {
                await this.abort();
            }
        }
        return this;
    }

    async drag(x = 0, y = 0, percentage = false) {
        await this._executeQueue();
        try {
            const element = this.currentElement.locator;
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error(
                    `Invalid drag coordinates for ${this._describeLastElementInQueue()}: x="${x}", y="${y}". Both values must be finite numbers.`
                );
            }
            let xPixels = x;
            let yPixels = y;
            const box = await element.boundingBox();
            if (!box) {
                throw new Error(
                    `Cannot drag ${this._describeLastElementInQueue()} because its bounding box is unavailable. Make sure the element is rendered and visible.`
                );
            }
            if (percentage) {
                xPixels = (x / 100) * box.width;
                yPixels = (y / 100) * box.height;
            }
            await this._showHint(
                `Dragging ${this._describeLastElementInQueue()} to x=${xPixels}px, y=${yPixels}px`,
                "info"
            );
            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;
            await this.page.mouse.move(startX, startY);
            await this.page.mouse.down();
            await this.page.mouse.move(startX + xPixels, startY + yPixels, { steps: 10 });
            await this.page.mouse.up();
        } catch (error) {
            const errorMessage = `Failed to drag ${this._describeLastElementInQueue()}: ${error.message}`;
            if (this.safeMode) {
                await this.pause(errorMessage);
            } else {
                await this.abort(errorMessage);
            }
        }
        await this._hideHint();
        return this;
    }

    async getStyles() {
        await this._executeQueue();
        const styles = await this.currentElement.locator.evaluate((el) => {
            const style = window.getComputedStyle(el);
            const styleJson = {};
            for (let i = 0; i < style.length; i++) {
                const key = style[i];
                styleJson[key] = style.getPropertyValue(key);
            }
            return styleJson;
        });
        await this._showHint(
            `Got styles of ${this._describeLastElementInQueue()} is ${JSON.stringify(styles)}`,
            "info"
        );
        await this._hideHint();
        return styles;
    }

    async indexOf(searchWorld = "") {
        await this._executeQueue();
        let biggestDistance = 0;
        for (const element of this.matchedElements) {
            let distance = element.data._domPath.length;
            if (distance > biggestDistance) {
                biggestDistance = distance;
            }
        }
        let results = this.matchedElements.filter((element) => element.data._domPath.length === biggestDistance);
        let index = -1;
        for (let i = 0; i < results.length; i++) {
            if (results[i].data.text?.toLowerCase().includes(searchWorld.toLowerCase())) {
                index = i;
                break;
            }
        }
        if (index === -1) {
            for (let i = 0; i < results.length; i++) {
                if (results[i].data.html?.toLowerCase().includes(searchWorld.toLowerCase())) {
                    index = i;
                    break;
                }
            }
        }
        await this._showHint(
            `Gained index of ${this._describeLastElementInQueue()} ${searchWorld} is ${index}`,
            "info"
        );
        await this._hideHint();
        return index;
    }

    async count() {
        await this._executeQueue(0, true);
        return this.matchedElements.length;
    }

    async pressEnter() {
        await this._executeQueue();
        try {
            await this._showHint(`Pressing Enter on ${this._describeLastElementInQueue()}`, "info");
            await this.currentElement.locator.press("Enter");
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to press Enter on ${this._describeLastElementInQueue()}`);
            } else {
                await this.abort();
            }
        }
        await this._hideHint();
        return this;
    }

    /**
     * @param {string} attribute
     * @param {boolean} showHint
     * @returns {Promise<string>}
     */
    async getAttribute(attribute, showHint = true) {
        await this._executeQueue();
        const value = this.currentElement?.data[attribute];
        if (showHint) {
            await this._showHint(
                `Got attribute ${attribute} of ${this._describeLastElementInQueue()} is ${value}`,
                "info"
            );
            await this._hideHint();
        }
        return value;
    }

    /**
     * @param {boolean} showHint
     * @returns {Promise<string>}
     */
    async getText(showHint = true) {
        return this.getAttribute("text", showHint);
    }

    async _getBoundingBox() {
        await this._executeQueue();
        const box = await this.currentElement.locator.boundingBox();
        if (!box) {
            throw new Error(
                `Cannot get bounding box of ${this._describeLastElementInQueue()} because its bounding box is unavailable. Make sure the element is rendered and visible.`
            );
        }
        return box;
    }

    async getHeight() {
        const box = await this._getBoundingBox();
        await this._showHint(`Gained height of ${this._describeLastElementInQueue()} is ${box.height}px`, "info");
        await this._hideHint();
        return box.height;
    }

    async getWidth() {
        const box = await this._getBoundingBox();
        await this._showHint(`Gained width of ${this._describeLastElementInQueue()} is ${box.width}px`, "info");
        await this._hideHint();
        return box.width;
    }

    async getX() {
        const box = await this._getBoundingBox();
        await this._showHint(`Gained x of ${this._describeLastElementInQueue()} is ${box.x}px`, "info");
        await this._hideHint();
        return box.x;
    }

    async getY() {
        const box = await this._getBoundingBox();
        await this._showHint(`Gained y of ${this._describeLastElementInQueue()} is ${box.y}px`, "info");
        await this._hideHint();
        return box.y;
    }

    async getCenterX() {
        const box = await this._getBoundingBox();
        const centerX = box.x + box.width / 2;
        await this._showHint(`Gained center x of ${this._describeLastElementInQueue()} is ${centerX}px`, "info");
        await this._hideHint();
        return centerX;
    }

    async getCenterY() {
        const box = await this._getBoundingBox();
        const centerY = box.y + box.height / 2;
        await this._showHint(`Gained center y of ${this._describeLastElementInQueue()} is ${centerY}px`, "info");
        await this._hideHint();
        return centerY;
    }

    /**
     * @param {boolean} showHint
     * @returns {Promise<string>}
     */
    async getValue(showHint = true) {
        return this.getAttribute("value", showHint);
    }

    async highlight() {
        await this._executeQueue();
        if (!this.currentElement) return this;
        await this._highlight(this.currentElement.locator);
        return this;
    }

    async shouldContainText(text, throwError = true) {
        await this._executeQueue();
        try {
            chaiExpect(
                this.currentElement.data.text || this.currentElement.data.value || this.currentElement.data.html
            ).to.contain(text);
            await this._showHint(`${this._describeLastElementInQueue()} contains ${text}`, "success");
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(`Failed to check if ${this._describeLastElementInQueue()} contains ${text}`);
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldNotContainText(text, throwError = true) {
        await this._executeQueue();
        try {
            chaiExpect(
                this.currentElement.data.text || this.currentElement.data.value || this.currentElement.data.html
            ).to.not.contain(text);
            await this._showHint(`${this._describeLastElementInQueue()} does not contain ${text}`, "success");
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(
                        `Failed to check if ${this._describeLastElementInQueue()} does not contain ${text}`
                    );
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldHaveText(text, throwError = true) {
        await this._executeQueue();
        const actualText = this._cleanText(this.currentElement.data.text);
        const expectedText = this._cleanText(text);
        try {
            chaiExpect(actualText).to.equal(expectedText);
            await this._showHint(`${this._describeLastElementInQueue()} has text ${text}`, "success");
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(`Failed to check if ${this._describeLastElementInQueue()} has text ${text}`);
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldContainHtml(html, throwError = true) {
        await this._executeQueue();
        try {
            chaiExpect(this.currentElement.data.html).to.contain(html);
            await this._showHint(`${this._describeLastElementInQueue()} contains HTML ${html}`, "success");
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(`Failed to check if ${this._describeLastElementInQueue()} contains HTML ${html}`);
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldNotContainHtml(html, throwError = true) {
        await this._executeQueue();
        try {
            chaiExpect(this.currentElement.data.html).to.not.contain(html);
            await this._showHint(`${this._describeLastElementInQueue()} does not contain HTML ${html}`, "success");
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(
                        `Failed to check if ${this._describeLastElementInQueue()} does not contain HTML ${html}`
                    );
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldHaveValue(value, throwError = true) {
        await this._executeQueue();
        // Clean up any HTML entities like &nbsp; by replacing them with spaces before comparison
        const actualValue = this._cleanText(this.currentElement.data.value);
        const expectedValue = this._cleanText(value);
        try {
            chaiExpect(actualValue).to.equal(expectedValue);
            await this._showHint(`${this._describeLastElementInQueue()} has value ${value}`, "success");
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(
                        `Failed to check if ${this._describeLastElementInQueue()} has value ${value}, actual value is ${actualValue}, expected value is ${expectedValue}`
                    );
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldContainValue(value, throwError = true) {
        await this._executeQueue();
        try {
            chaiExpect(this.currentElement.data.value).to.contain(value);
            await this._showHint(`${this._describeLastElementInQueue()} contains value ${value}`, "success");
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(
                        `Failed to check if ${this._describeLastElementInQueue()} contains value ${value}`
                    );
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldExist(throwError = true) {
        try {
            await this._executeQueue(0, true);
            const count = await this.currentElement.locator.count();
            if (count === 0) {
                if (!throwError) {
                    return false;
                }
                throw new Error(`Element does not exist: ${this._describeLastElementInQueue()}`);
            }
            await expect(this.currentElement.locator.first()).toBeVisible();
            if (throwError) {
                await this._showHint(`${this._describeLastElementInQueue()} exists`, "success");
            }
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(`Failed to check if ${this._describeLastElementInQueue()} exists`);
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldNotExist(throwError = true) {
        await this._executeQueue(0, true);
        if (!this.currentElement?.locator) return true;
        const count = await this.currentElement.locator.count();
        if (count > 0) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(`Failed to check if ${this._describeLastElementInQueue()} does not exist`);
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._showHint(`${this._describeLastElementInQueue()} does not exist`, "success");
        await this._hideHint();
        return true;
    }

    async shouldBeChecked(value = true, throwError = true) {
        await this._executeQueue();
        try {
            chaiExpect(
                this.currentElement.data.checked === "" || this.currentElement.data.checked ? true : false
            ).to.equal(value);
            await this._showHint(
                `${this._describeLastElementInQueue()} is ${value ? "checked" : "unchecked"}`,
                "success"
            );
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(
                        `Failed to check if ${this._describeLastElementInQueue()} is ${value ? "checked" : "unchecked"}`
                    );
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldBeEnabled(throwError = true) {
        await this._executeQueue();
        try {
            if (!this.currentElement.data.disabled) {
                await this._showHint(`${this._describeLastElementInQueue()} is enabled`, "success");
            } else {
                if (throwError) {
                    if (this.safeMode) {
                        await this.pause(`Failed to check if ${this._describeLastElementInQueue()} is enabled`);
                    } else {
                        await this.abort();
                    }
                }
                return false;
            }
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(`Failed to check if ${this._describeLastElementInQueue()} is enabled`);
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldBeDisabled(throwError = true) {
        await this._executeQueue();
        try {
            chaiExpect(this.currentElement.data.disabled).to.be.true;
            await this._showHint(`${this._describeLastElementInQueue()} is disabled`, "success");
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(`Failed to check if ${this._describeLastElementInQueue()} is disabled`);
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldContainClass(className, throwError = true) {
        await this._executeQueue();
        try {
            chaiExpect(this.currentElement.data.class).to.contain(className);
            await this._showHint(`${this._describeLastElementInQueue()} contains class ${className}`, "success");
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(
                        `Failed to check if ${this._describeLastElementInQueue()} contains class ${className}`
                    );
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldNotContainClass(className, throwError = true) {
        await this._executeQueue();
        try {
            chaiExpect(this.currentElement.data.class).to.not.contain(className);
            await this._showHint(
                `${this._describeLastElementInQueue()} does not contain class ${className}`,
                "success"
            );
        } catch (error) {
            if (throwError) {
                if (this.safeMode) {
                    await this.pause(
                        `Failed to check if ${this._describeLastElementInQueue()} does not contain class ${className}`
                    );
                } else {
                    await this.abort();
                }
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    /**
     * @type {import("./expect.js").ExpectFramework}
     */
    get expect() {
        return this._expect;
    }

    /**
     * Pause the test execution and show a hint with the given text, buttons and type.
     * @param {string} text - The text to show in the hint.
     * @param {Array<{ text: string, onClick: () => void }>} buttons - The buttons to show in the hint.
     * @param {"info" | "success" | "warning" | "error"} type - The type of the hint.
     * @param {string} traceDetails - Extra details to include only when the trace is shown.
     * @returns {Promise<void>}
     */
    pause(
        text = "Paused",
        buttons = [
            { text: "Continue", onClick: async () => await this.continue() },
            {
                text: "Stop",
                onClick: async () => await this.abort(),
            },
            {
                text: "Show trace in console",
                onClick: async () => await this.showTrace(),
            },
        ],
        type = "warning",
        traceDetails = ""
    ) {
        this._pausedReason = text;
        this._pausedExecutionTrace = this._buildExecutionTrace(text, traceDetails);
        return new Promise(async (resolve) => {
            await this._startUserActionRecording(text);
            await this._showHint(text, type, buttons);
            // setTimeout(() => {
            //     if (this._pauseResolver) {
            //         this._showHint(text, type, buttons);
            //     }
            // }, 2000);
            this._pauseResolver = resolve;
        });
    }

    continue() {
        if (this._pauseResolver) {
            this._logPauseRelease();
            this._hideHint();
            this._pauseResolver();
            this._pauseResolver = null;
        }
    }

    /**
     * Logs where the run was suspended and starts capturing the manual actions performed while the
     * pause holds the process. Never throws: a diagnostic must not break the pause itself.
     * @param {string} reason
     * @returns {Promise<void>}
     */
    async _startUserActionRecording(reason) {
        if (!this.recordUserActionsOnPause) return;
        try {
            await this._userActionRecorder.start();
        } catch (error) {}
        const pauseNumber = this._userActionRecorder.pauseNumber;
        const message = [
            `MANUAL PAUSE #${pauseNumber} — the scenario stopped here and waits for a human: "${reason}"`,
            "Every action performed from now until Continue/Stop is a manual user action, not a scripted step.",
            this._pausedExecutionTrace || this._buildExecutionTrace(reason),
            AI_AGENT_PAUSE_GUIDANCE,
        ].join("\n");
        if (QA.reporter) {
            try {
                await QA.reporter.log(message, "warning", this.withSnapshots);
            } catch (error) {}
        }
    }

    /**
     * Stops the recorder and logs what the released pause means for the scenario: which test-script
     * line did not complete (was skipped and replaced by the human), the trace of that line, and the
     * manual actions performed instead of it.
     * Synchronous on purpose: `continue()` resolves the pause immediately, so the recording flag and
     * the log line must be registered before the scenario resumes.
     * @returns {void}
     */
    _logPauseRelease() {
        let captured = [];
        if (this.recordUserActionsOnPause) {
            try {
                captured = this._userActionRecorder.stop();
            } catch (error) {}
        }
        if (!QA.reporter) return;

        const reason = this._pausedReason || "Paused";
        const trace = this._pausedExecutionTrace || this._buildExecutionTrace(reason);
        const specLocation = this._extractSpecLocation(trace);
        const pauseNumber = this._userActionRecorder.pauseNumber;
        const aborted = !!this._aborting;

        const lines = aborted
            ? [
                  `MANUAL PAUSE #${pauseNumber} released by Stop/abort — the scenario step never completed: "${reason}"`,
                  `Test-script line that did not complete: ${specLocation}`,
              ]
            : [
                  `MANUAL PAUSE #${pauseNumber} released (Continue) — SKIPPED SCENARIO STEP: "${reason}"`,
                  `Skipped test-script line: ${specLocation}`,
                  "This line of the test script did not do its job: the run was resumed by a human instead of by the scenario, so treat this step as skipped/unverified.",
              ];

        if (!this.recordUserActionsOnPause) {
            lines.push(
                "Manual user action logging is disabled (recordUserActionsOnPause: false), so what the human did during this pause was not captured."
            );
        } else if (captured.length) {
            lines.push(
                `${captured.length} manual user action(s) were performed instead of the skipped step, none of them scripted in the scenario:`,
                ...captured.map((action) => `   ${action.index}. ${action.description}`)
            );
        } else {
            lines.push(
                "No user action was captured in the page — the pause was released without interacting with the application."
            );
        }

        lines.push(trace, AI_AGENT_PAUSE_GUIDANCE);

        try {
            // Not awaited: `QAReporter.log` records the line synchronously before its first await.
            Promise.resolve(QA.reporter.log(lines.join("\n"), aborted ? "error" : "warning")).catch(() => {});
        } catch (error) {}
    }

    /**
     * Pulls the `*.spec` file location out of a trace produced by `_buildExecutionTrace`.
     * @param {string} trace
     * @returns {string} the `file:line:column` of the paused step, or a hint to read the trace.
     */
    _extractSpecLocation(trace) {
        const prefix = "Spec location: ";
        const line = String(trace || "")
            .split("\n")
            .find((candidate) => candidate.startsWith(prefix));
        return line ? line.slice(prefix.length) : "unknown — see the stack frames in the trace below";
    }

    /**
     * Reporter sink for a single manual action captured by `UserActionRecorder`.
     * @param {string} message
     * @returns {void}
     */
    _reportUserAction(message) {
        if (!QA.reporter) return;
        try {
            // Not awaited: the human keeps interacting with the page while this resolves, and the log
            // line itself is recorded synchronously.
            Promise.resolve(QA.reporter.userAction(message, this.withSnapshots)).catch(() => {});
        } catch (error) {}
    }

    async showTrace() {
        const trace = this._pausedExecutionTrace || this._buildExecutionTrace("Trace requested outside pause()");
        console.log(trace);
        try {
            await this.page.evaluate((traceText) => {
                console.log(traceText);
            }, trace);
        } catch (error) {}
        if (QA.reporter) {
            await QA.reporter.log(trace, "info");
        }
    }

    async abort(msg = "Aborted.") {
        // The pause released below ends the run, so nothing is "skipped and continued" — the release
        // log must say the step never completed instead.
        this._aborting = true;
        // Capture where in the *.spec file execution stopped, and a screenshot of this moment.
        const trace = this._pausedExecutionTrace || this._buildExecutionTrace(msg);
        console.log(trace);
        if (QA.reporter) {
            try {
                await QA.reporter.log(trace, "error");
            } catch (error) {}
            try {
                await QA.reporter.snapshot(`Aborted: ${msg}`);
            } catch (error) {}
        }

        this.continue();
        await this._showHint(msg, "error");
        await this.waitFor(2000, false);
        this._hideHint();
        if (typeof process !== "undefined" && typeof process.exit === "function") {
            process.exit(1);
        } else {
            // Forcefully halt further JS execution
            // eslint-disable-next-line no-constant-condition
            while (true) {
                /* infinite loop to halt execution in browser environment */
            }
        }
    }

    async copy(text) {
        await this.page.evaluate((text) => {
            navigator.clipboard.writeText(text);
        }, text);
        await this._showHint(`Copied ${text} to clipboard`, "success");
        await this._hideHint();
    }

    async paste() {
        // Get the currently copied-to-clipboard value from the browser context
        let clipboardValue;
        try {
            clipboardValue = await this.page.evaluate(async () => {
                // Prefer modern Clipboard API
                if (navigator.clipboard && navigator.clipboard.readText) {
                    return await navigator.clipboard.readText();
                }
                // Fallback for older browsers (rarely needed in automation)
                if (window.clipboardData && window.clipboardData.getData) {
                    // IE
                    return window.clipboardData.getData("Text");
                }
                // No clipboard access
                return null;
            });
        } catch (error) {
            await this._showHint(`Failed to get clipboard value: ${error.message}`, "error");
            return null;
        } finally {
            await this._hideHint();
        }
        return clipboardValue;
    }

    /**
     * Trigger a file download and save it to a temp path. Use when a click/action
     * causes the browser to download a file (report/export button, etc.).
     * @param {string} hint - Description shown in the snapshot/log.
     * @param {(page: import('playwright').Page) => Promise<void>} triggerAction - Performs the action that starts the download.
     * @param {"info" | "success" | "warning" | "error"} [type="info"]
     * @returns {Promise<{ filename: string, path: string, download: import('playwright').Download }>}
     */
    async download(hint, triggerAction, type = "info") {
        await this._showHint(hint, type);
        try {
            const [dl] = await Promise.all([this.page.waitForEvent("download"), triggerAction(this.page)]);
            const path = join(tmpdir(), `qalight_download_${randomUUID()}_${dl.suggestedFilename()}`);
            await dl.saveAs(path);
            return { filename: dl.suggestedFilename(), path, download: dl };
        } catch (error) {
            if (this.safeMode) {
                await this.pause(`Failed to download after "${hint}". Perform manual action and continue.`);
            } else {
                await this.abort();
            }
        } finally {
            await this._hideHint();
        }
    }

    /**
     * Same as `download`, but also parses the saved file with the given parser
     * (e.g. `parseXlsx`/`parseCsv` from `qalight/src/files/*`).
     * @param {string} hint
     * @param {(page: import('playwright').Page) => Promise<void>} triggerAction
     * @param {(path: string) => any} parser
     * @param {"info" | "success" | "warning" | "error"} [type="info"]
     * @returns {Promise<{ filename: string, path: string, rows: any }>}
     */
    async downloadAndParse(hint, triggerAction, parser, type = "info") {
        const { filename, path } = await this.download(hint, triggerAction, type);
        return { filename, path, rows: parser(path) };
    }

    async _goToParent(item) {
        if (!this.currentElement) return;
        this.currentElement.locator = this.currentElement.locator.locator(`..`).nth(item.parent);
        this.currentElement.data = await WeightPointCalculator.prepareData(this.currentElement.locator);
        this.currentElement.data.stringified = `Parent of ${this.currentElement.data.stringified}`;
    }

    async _executeQueue(tries = 0, checking = false) {
        if (this.queue.length === 0) return this;
        await this.waitFor(this.timeout, false);
        await this.api.waitForIdle();
        this.currentElement = null;
        this.matchedElements = [];
        if (typeof this.waiter === "function") await this.waiter();
        if (this.parentElement) {
            if (this.parentElement.locator) {
                this.currentElement = this.parentElement;
            } else {
                const { element, elements } = await this._getElement(
                    this.page.locator("body"),
                    this.parentElement.tag,
                    this.parentElement.identifiers,
                    this.parentElement.exceptIdentifiers,
                    this.parentElement.index,
                    tries,
                    checking
                );
                this.currentElement = element;
                this.matchedElements = elements;
                if (!element) {
                    await this._showHint(
                        `No element was found ${this._describeLastElementInQueue()}`,
                        checking ? "info" : "error"
                    );
                    await this.waitFor(3000, false);
                    await this._hideHint();
                    this.queue = [];
                    if (checking) {
                        return this;
                    }
                    throw new QAError(`No element was found ${this._describeLastElementInQueue()}`, this.queue);
                }
            }
        }
        for (const item of this.queue) {
            if (typeof item === "object" && !item.hasOwnProperty("parent")) {
                let { element, elements } = await this._getElement(
                    this.currentElement?.locator || this.page.locator("body"),
                    item.tag,
                    item.identifiers,
                    item.exceptIdentifiers,
                    item.index,
                    tries,
                    checking
                );
                if (item.aroundDepth > 0 && !element && this.currentElement) {
                    let currentDepth = 1;
                    while (currentDepth < item.aroundDepth && !element) {
                        const result = await this._getElement(
                            this.currentElement.locator,
                            item.tag,
                            item.identifiers,
                            item.exceptIdentifiers,
                            item.index,
                            tries,
                            checking
                        );
                        element = result?.element;
                        elements = result?.elements;
                        currentDepth++;
                    }
                }
                this.currentElement = element;
                this.matchedElements = elements;
                if (!element) {
                    await this._showHint(
                        `No element was found ${this._describeLastElementInQueue()}`,
                        checking ? "info" : "error"
                    );
                    await this.waitFor(1000, false);
                    await this._hideHint();
                    this.queue = [];
                    if (checking) {
                        return this;
                    }
                    throw new QAError(`No element was found ${this._describeLastElementInQueue()}`, this.queue);
                }
            } else if (typeof item === "object" && item.hasOwnProperty("parent") && this.currentElement?.locator) {
                await this._goToParent(item);
            }
        }
        if (this.currentElement?.locator) {
            this._describeLastElementInQueue();
            this.queue = [];
            if (!(await this._checkIfVisible())) {
                await this._scrollCurrentElementIntoViewport();
            }
        } else {
            if (tries > 3 && !checking) {
                await this._showHint(`No element was found ${this._describeLastElementInQueue()}`, "error");
                await this.waitFor(3000, false);
                await this._hideHint();
                throw new QAError(`No element was found ${this._describeLastElementInQueue()}`, this.queue);
            }
            if (checking && tries > 1) {
                this._describeLastElementInQueue();
                this.queue = [];
                return this;
            }
            await this._showHint(
                `No element found (${this._describeLastElementInQueue()}), retrying... (${tries + 1})`
            );
            await this.waitFor(1000 * (tries + 1), false);
            await this._hideHint();
            return await this._executeQueue(tries + 1, checking);
        }
        return this;
    }

    async _getElement(
        parent,
        tag,
        identifiers = [],
        exceptIdentifiers = [],
        index = 0,
        tries = 0,
        allIdentifiers = false
    ) {
        const elements = await this._getAllElements(parent, tag, identifiers, tries);
        let maxWeight = 0;
        for (const element of elements) {
            const weightCalculator = new WeightPointCalculator(element, identifiers, exceptIdentifiers);
            const weightPlus = weightCalculator.calculateWeight(false, allIdentifiers);
            const weightMinus = weightCalculator.calculateWeight(true, allIdentifiers);
            element.weight = weightPlus - weightMinus;
            maxWeight = Math.max(maxWeight, element.weight);
        }
        const matchedElements = elements.filter(
            (element) => element.weight === maxWeight && (element.weight > 0 || identifiers.length === 0)
        );
        for (let i = 0; i < matchedElements.length; i++) {
            for (let j = 0; j < matchedElements.length; j++) {
                if (
                    i !== j &&
                    !matchedElements[j].data._isParent &&
                    this._isParent(matchedElements[j], matchedElements[i])
                ) {
                    matchedElements[j].data._isParent = true;
                }
            }
        }
        const matchedElementsExludeParents = matchedElements.filter((element) => !element.data._isParent);
        if (index < 0) {
            index = matchedElementsExludeParents.length + index;
        }
        return { element: matchedElementsExludeParents?.[index] ?? null, elements: matchedElementsExludeParents };
    }

    _isParent(parentElement, childElement) {
        const parentPath = parentElement.data._domPath;
        const childPath = childElement.data._domPath;
        if (!Array.isArray(parentPath) || !Array.isArray(childPath)) {
            throw new Error("isParentDomPath: both arguments must be arrays");
        }

        if (parentPath.length >= childPath.length) {
            return false;
        }

        for (let i = 0; i < parentPath.length; i++) {
            if (parentPath[i].tag !== childPath[i].tag || parentPath[i].index !== childPath[i].index) {
                return false;
            }
        }

        return true;
    }

    _validateTag(tag) {
        if (typeof tag !== "string" || !this.TAGS.hasOwnProperty(tag))
            throw new QAError("Tag must be a string and one of the following: " + Object.keys(this.TAGS).join(", "));
        return this.TAGS[tag];
    }

    _normalizeIdentifiers(identifiers, exceptIdentifiers) {
        if (!identifiers) identifiers = [];
        if (!exceptIdentifiers) exceptIdentifiers = [];
        if (typeof identifiers === "string") identifiers = [identifiers];
        if (typeof exceptIdentifiers === "string") exceptIdentifiers = [exceptIdentifiers];
        if (typeof identifiers === "object" && !Array.isArray(identifiers))
            identifiers = Object.entries(identifiers).map(([key, value]) => ({ [key]: value }));
        if (typeof exceptIdentifiers === "object" && !Array.isArray(exceptIdentifiers))
            exceptIdentifiers = Object.entries(exceptIdentifiers).map(([key, value]) => ({ [key]: value }));
        if (this.restrictionMapping) {
            const additionalIdentifiers = [];
            identifiers = identifiers.filter((identifier) => {
                if (typeof identifier === "string" && this.restrictionMapping.hasOwnProperty(identifier)) {
                    if (Array.isArray(this.restrictionMapping[identifier])) {
                        additionalIdentifiers.push(...this.restrictionMapping[identifier]);
                    } else {
                        additionalIdentifiers.push(this.restrictionMapping[identifier]);
                    }
                    return false;
                }
                return true;
            });
            identifiers = [...identifiers, ...additionalIdentifiers];
        }
        if (this.restrictionMapping) {
            const additionalExceptIdentifiers = [];
            exceptIdentifiers = exceptIdentifiers.filter((identifier) => {
                if (typeof identifier === "string" && this.restrictionMapping.hasOwnProperty(identifier)) {
                    if (Array.isArray(this.restrictionMapping[identifier])) {
                        additionalExceptIdentifiers.push(...this.restrictionMapping[identifier]);
                    } else {
                        additionalExceptIdentifiers.push(this.restrictionMapping[identifier]);
                    }
                    return false;
                }
                return true;
            });
            exceptIdentifiers = [...exceptIdentifiers, ...additionalExceptIdentifiers];
        }
        return { identifiers, exceptIdentifiers };
    }

    async _showHint(text = "", type = "info", buttons = []) {
        if (!this.withHint) return;
        const colors = {
            info: "blue",
            success: "green",
            warning: "orange",
            error: "red",
        };
        const color = colors[type] || colors.info;
        try {
            for (let idx = 0; idx < buttons.length; idx++) {
                const button = buttons[idx];
                if (typeof button.onClick === "function") {
                    this._buttonActionsHandlers[idx] = async () => await button.onClick?.();
                    try {
                        await this.page.exposeFunction("__qalight__dispatcher", async (idx) =>
                            this._buttonActionsHandlers[idx]?.()
                        );
                    } catch (error) {}
                }
            }
            const hintPopupElementWrapper = await this.page.$("#qa-hint-popup-wrapper");
            if (!hintPopupElementWrapper) {
                await this._injectQaHintPopup(color);
            }
            if (hintPopupElementWrapper) {
                await hintPopupElementWrapper.evaluate(
                    (el, { color }) => {
                        el.style.backgroundColor = color;
                        el.style.display = "flex";
                    },
                    { color }
                );
            }
            const hintPopupElement = await this.page.$("#qa-hint-popup");
            if (hintPopupElement) {
                await hintPopupElement.evaluate(
                    (el, { text, color, buttons }) => {
                        // el.style.backgroundColor = color;
                        // The style property cannot set "!important"; use setProperty for that
                        // document.body.style.setProperty("padding-top", "30px", "important");
                        el.textContent = text;
                        el.style.display = "flex";
                        if (buttons?.length > 0) {
                            buttons.forEach((button, idx) => {
                                const buttonElement = document.createElement("button");
                                buttonElement.textContent = button.text;
                                buttonElement.addEventListener("click", () => {
                                    window["__qalight__dispatcher"](idx);
                                });
                                el.appendChild(buttonElement);
                            });
                        }
                    },
                    { text, color, buttons: buttons.map((button) => ({ text: button.text })) }
                );
            }
            if (this.currentElement?.locator) {
                await this._highlight(this.currentElement.locator, { ms: this.timeout });
            }
            if (QA.reporter) {
                await QA.reporter.log(text, type, this.withSnapshots);
            }
        } catch (error) {}
    }

    async _hideHint() {
        if (!this.withHint) return;
        try {
            const hintPopupElementWrapper = await this.page.$("#qa-hint-popup-wrapper");
            const hintPopupElement = await this.page.$("#qa-hint-popup");
            await this.waitFor(200, false);
            if (hintPopupElementWrapper) {
                await hintPopupElementWrapper.evaluate((el) => {
                    el.style.backgroundColor = "blue";
                    el.style.display = "none";
                });
            }
            if (hintPopupElement) {
                await hintPopupElement.evaluate((el) => {
                    el.style.display = "none";
                });
            }
        } catch (error) {}
    }

    async _getAllElements(parent, tag, identifiers = [], tries = 0) {
        let results = [];
        const elements = [];
        await this.page.waitForLoadState("load");
        let selectors = identifiers
            .filter((identifier) => typeof identifier === "object" && !identifier.hasOwnProperty("parent"))
            .map((identifier) => {
                return Object.entries(identifier).map(([key, value]) => `${tag}:visible[${key}*="${value}"]`);
            })
            .join(", ");
        selectors = selectors || `${tag}:visible`;
        const loc = parent.locator(selectors);
        try {
            await loc.first().waitFor({ state: "visible", timeout: 1000 * (tries + 1) });
            results = await loc.all();
        } catch (error) {
            results = [];
        }
        for (const result of results) {
            try {
                const data = await WeightPointCalculator.prepareData(result);
                elements.push({ locator: result, data });
            } catch (error) {
                console.error(`Error extracting data from locator: ${result.toString()}, error: ${error.message}`);
            }
        }
        return elements;
    }

    async _injectQaHintPopup(color) {
        await this.page.evaluate(
            ({ color }) => {
                const ID = "qa-hint-popup";
                const WRAPPER_ID = "qa-hint-popup-wrapper";

                let wrapper = document.getElementById(WRAPPER_ID);
                if (!wrapper) {
                    wrapper = document.createElement("div");
                    wrapper.id = WRAPPER_ID;
                    wrapper.style.position = "fixed";
                    wrapper.style.display = "flex";
                    wrapper.style.alignItems = "center";
                    wrapper.style.justifyContent = "center";
                    wrapper.style.top = "0";
                    wrapper.style.right = "0";
                    wrapper.style.zIndex = "2147483647";
                    wrapper.style.width = "100vw";
                    wrapper.style.minHeight = "20px";
                    wrapper.style.backgroundColor = color;
                    document.documentElement.appendChild(wrapper);
                    // document.body.style.setProperty("padding-top", "30px", "important");
                }

                let el = document.getElementById(ID);
                if (!el) {
                    el = document.createElement("div");
                    el.id = ID;

                    // styling: doesn't reflow page, doesn't block clicks
                    el.style.position = "relative";
                    el.style.display = "block";
                    el.style.color = "white";
                    el.style.fontWeight = "600";
                    el.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
                    el.style.fontSize = "12px";
                    el.style.lineHeight = "1.25";
                    el.style.textAlign = "center";
                    el.style.whiteSpace = "pre-wrap";
                    el.style.display = "flex";
                    el.style.alignItems = "center";
                    el.style.justifyContent = "center";
                    el.style.gap = "5px";
                    wrapper.appendChild(el);
                }
            },
            { color }
        );
    }

    // Optional helper to remove it
    async _removeQaHintPopup() {
        await this.page.evaluate(() => {
            try {
                const el = document.getElementById("qa-hint-popup");
                if (el) el.remove();
            } catch (error) {}
        });
    }

    async _highlight(locator, { ms = 800 } = {}) {
        if (!this.withHighlight) return;
        // `locator.evaluate` auto-waits for the element to resolve. A caller can legitimately hand
        // us a locator whose element is already gone (e.g. a hint shown right after a click that
        // closed the dropdown containing the clicked <li>), and since consumers typically leave
        // Playwright's `actionTimeout` unset, that wait is unbounded — it would hang until the
        // whole test times out. Highlighting is purely cosmetic, so bound it and give up quietly.
        try {
            await locator.evaluate(
                async (el, ms) => {
                    const prevOutline = el.style.outline;
                    const prevOutlineOffset = el.style.outlineOffset;
                    const backgroundColor = el.style.backgroundColor;

                    el.style.outline = "3px solid #ff00ff";
                    el.style.outlineOffset = "2px";
                    el.style.backgroundColor = "#ff00ff";

                    setTimeout(() => {
                        el.style.outline = prevOutline;
                        el.style.outlineOffset = prevOutlineOffset;
                        el.style.backgroundColor = backgroundColor;
                    }, ms);
                },
                ms,
                { timeout: HIGHLIGHT_RESOLVE_TIMEOUT }
            );
        } catch (error) {}
    }

    _cleanText(val) {
        if (val === null || val === undefined) return "";
        if (typeof val !== "string") val = String(val);
        return val
            .replace(/\u00A0|&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .trim();
    }

    _describeLastElementInQueue() {
        // const lastElement = this.queue[this.queue.length - 1];
        let description = null;
        if (this.queue.length > 0) {
            let details = "";
            const lastElement = this.queue[this.queue.length - 1];
            for (const elem of this.queue) {
                let addSpecialSymbol = false;
                if (details.length > 0) addSpecialSymbol = true;
                if (typeof elem === "object") {
                    if (Array.isArray(elem.identifiers)) {
                        let isFirstIdentifier = true;
                        for (const identifier of elem.identifiers) {
                            if (typeof identifier === "string") {
                                if (addSpecialSymbol && identifier) {
                                    details += " > ";
                                    addSpecialSymbol = false;
                                }
                                details += `${isFirstIdentifier ? "" : ", "}${identifier}`;
                            } else if (Array.isArray(identifier)) {
                                if (addSpecialSymbol && identifier) {
                                    details += " > ";
                                    addSpecialSymbol = false;
                                }
                                details += `${JSON.stringify(
                                    identifier
                                        .map((item) => {
                                            if (typeof item === "string") {
                                                return item;
                                            } else if (typeof item === "object") {
                                                return `${Object.entries(item)
                                                    .map(([key, value]) => `${key}=${value}`)
                                                    .join(", ")}`;
                                            }
                                        })
                                        .join(", ")
                                )}`;
                            } else if (typeof identifier === "object") {
                                if (addSpecialSymbol && identifier) {
                                    details += " > ";
                                    addSpecialSymbol = false;
                                }
                                details += `${Object.entries(identifier)
                                    .map(([key, value]) => `${key}=${value}`)
                                    .join(", ")}`;
                            }
                            isFirstIdentifier = false;
                        }
                    }
                }
            }
            description = lastElement ? `${lastElement.tag} (${details})` : "";
            this._shadowDescription = description;
        }
        return description || this._shadowDescription;
    }

    _buildExecutionTrace(reason = "Paused", details = "") {
        const traceError = new Error(reason);
        if (typeof Error.captureStackTrace === "function") {
            Error.captureStackTrace(traceError, this._buildExecutionTrace);
        }

        const rawStack = typeof traceError.stack === "string" ? traceError.stack : `${reason}`;
        const lines = rawStack.split("\n").map((line) => line.trimEnd());
        const stackLines = lines.slice(1).filter(Boolean);
        const cwd =
            typeof process !== "undefined" && typeof process.cwd === "function"
                ? process.cwd().replace(/\\/g, "/")
                : "";

        const isWorkspaceFrame = (line) => cwd && line.replace(/\\/g, "/").includes(cwd);
        const isInternalQaFrame = (line) =>
            /\/src\/(qa|expect|console|reporter)\.js:\d+:\d+/.test(line.replace(/\\/g, "/"));

        const relevantFrames = stackLines.filter((line) => isWorkspaceFrame(line) && !isInternalQaFrame(line));
        const fallbackFrames = stackLines.filter((line) => isWorkspaceFrame(line));
        const displayFrames = (relevantFrames.length > 0 ? relevantFrames : fallbackFrames).slice(0, 12);
        const specFrame =
            displayFrames.find((line) => /\.spec\.[jt]sx?:\d+:\d+/.test(line)) ||
            relevantFrames.find((line) => /\.spec\.[jt]sx?:\d+:\d+/.test(line)) ||
            fallbackFrames.find((line) => /\.spec\.[jt]sx?:\d+:\d+/.test(line)) ||
            null;

        const traceLines = [`QA execution trace: ${reason}`];
        if (this.testInfo?.title) {
            traceLines.push(`Test: ${this.testInfo.title}`);
        }
        if (this.testInfo?.file) {
            const testLocationParts = [this.testInfo.file];
            if (typeof this.testInfo.line === "number") {
                testLocationParts.push(this.testInfo.line);
                if (typeof this.testInfo.column === "number") {
                    testLocationParts.push(this.testInfo.column);
                }
            }
            traceLines.push(`Test file: ${testLocationParts.join(":")}`);
        }
        if (specFrame) {
            traceLines.push(`Spec location: ${specFrame.replace(/^\s*at\s+/, "")}`);
        }
        if (this.page && typeof this.page.url === "function") {
            try {
                traceLines.push(`Page: ${this.page.url()}`);
            } catch (error) {}
        }
        traceLines.push("Relevant stack frames:");
        if (displayFrames.length > 0) {
            traceLines.push(...displayFrames);
        } else {
            traceLines.push(...stackLines.slice(0, 12));
        }
        if (details) {
            traceLines.push(details);
        }

        return traceLines.join("\n");
    }

    async _checkIfVisible(target = this.currentElement.locator) {
        try {
            const isVisible = await target.first().isVisible();
            if (isVisible) {
                const isInViewport = await target.first().evaluate((el) => {
                    const rect = el.getBoundingClientRect();
                    return (
                        rect.top >= 0 &&
                        rect.left >= 0 &&
                        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
                    );
                });
                if (isInViewport) return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    async _scrollCurrentElementIntoViewport() {
        if (!this.currentElement?.locator) return;

        if (await this._checkIfVisible(this.currentElement.locator)) return;

        await this.currentElement.locator.first().evaluate((el) => {
            const isScrollable = (node, axis) => {
                const style = window.getComputedStyle(node);
                const overflow = axis === "y" ? style.overflowY : style.overflowX;
                const hasScrollableOverflow = overflow === "auto" || overflow === "scroll" || overflow === "overlay";
                const canScroll =
                    axis === "y" ? node.scrollHeight > node.clientHeight : node.scrollWidth > node.clientWidth;

                return hasScrollableOverflow && canScroll;
            };

            let parent = el.parentElement;
            while (parent) {
                const parentRect = parent.getBoundingClientRect();
                const elementRect = el.getBoundingClientRect();

                if (isScrollable(parent, "y")) {
                    if (elementRect.top < parentRect.top) {
                        parent.scrollTop -= parentRect.top - elementRect.top;
                    } else if (elementRect.bottom > parentRect.bottom) {
                        parent.scrollTop += elementRect.bottom - parentRect.bottom;
                    }
                }

                if (isScrollable(parent, "x")) {
                    if (elementRect.left < parentRect.left) {
                        parent.scrollLeft -= parentRect.left - elementRect.left;
                    } else if (elementRect.right > parentRect.right) {
                        parent.scrollLeft += elementRect.right - parentRect.right;
                    }
                }

                parent = parent.parentElement;
            }

            const rect = el.getBoundingClientRect();
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const verticalPadding = Math.min(80, Math.max(viewportHeight * 0.1, 16));
            const horizontalPadding = Math.min(80, Math.max(viewportWidth * 0.1, 16));

            if (rect.top < verticalPadding || rect.bottom > viewportHeight - verticalPadding) {
                const top = window.scrollY + rect.top - Math.max((viewportHeight - rect.height) / 2, verticalPadding);
                window.scrollTo({ top, behavior: "auto" });
            }

            if (rect.left < horizontalPadding || rect.right > viewportWidth - horizontalPadding) {
                const left = window.scrollX + rect.left - Math.max((viewportWidth - rect.width) / 2, horizontalPadding);
                window.scrollTo({ left, behavior: "auto" });
            }
        });

        if (!(await this._checkIfVisible(this.currentElement.locator))) {
            await this.currentElement.locator.scrollIntoViewIfNeeded();
        }
    }

    async _scrollContairnerUntilTargetVisible(
        container,
        target,
        { direction = "vertical", step = 400, maxTries = 50, delayMs = 50 }
    ) {
        if (await this._checkIfVisible(target)) return;

        await container.evaluate((el) => {
            el.scrollTop = 0;
            el.scrollLeft = 0;
        });

        let found = false;
        for (let i = 0; i < maxTries; i++) {
            if (await this._checkIfVisible(target)) {
                found = true;
                step = 50;
            }
            await container.evaluate(
                (el, { direction, step }) => {
                    if (direction === "vertical") {
                        el.scrollTop += step;
                    } else if (direction === "horizontal") {
                        el.scrollLeft += step;
                    } else {
                        throw new Error(`Invalid direction: ${direction}`);
                    }
                },
                { direction, step }
            );
            if (found) return;
            await this.page.waitForTimeout(delayMs);
        }
        await expect(target).toBeVisible();
    }

    _buttonActionsHandlers = [];
}
