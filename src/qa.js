import readline from "readline";
import { expect } from "@playwright/test";
import { expect as chaiExpect } from "chai";
import { API } from "./api.js";
import { ExpectFramework } from "./expect.js";
import { DEFAULT_WAIT_TIME, MATCHING_WEIGHTS, TAGS } from "./constants.js";
import { QAReporter } from "./reporter.js";

export class QAError extends Error {
    constructor(message) {
        super(message);
        this.name = "QAError";
    }
}

export class QA {
    DEFAULT_WAIT_TIME = DEFAULT_WAIT_TIME;
    DEFAULT_MATCHING_WEIGHT = 0.5;
    DEFAULT_PARTIAL_MATCHING_WEIGHT = 0.1;
    MATCHING_WEIGHTS = MATCHING_WEIGHTS;
    TAGS = TAGS;

    static reporter = null;

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
            apiResponseCallback: (log) => this._defaultApiResponseCallback(log),
        }
    ) {
        this._originalOptions = { ...options };
        if (options.testInfo) {
            QA.reporter = new QAReporter(page, options.testInfo);
        }
        /** @type {import('@playwright/test').Page} */
        this.page = page;
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
        this.expect = new ExpectFramework(this);

        this._pauseResolver = null;
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
     * @param {any[]} args
     * @returns {Promise<QA>}
     */
    async openTab(url, ...args) {
        const newPage = await this.page.context().newPage();
        await newPage.goto(url, ...args);
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

    get(tag, identifiers = [], exceptIdentifiers = [], index = 0) {
        this._validateTag(tag);
        const normalizedIdentifiers = this._normalizeIdentifiers(identifiers, exceptIdentifiers);
        this.queue.push({
            tag,
            identifiers: normalizedIdentifiers.identifiers,
            exceptIdentifiers: normalizedIdentifiers.exceptIdentifiers,
            index,
        });
        return this;
    }

    getParent(index = 0) {
        this.queue.push({ parent: index });
        return this;
    }

    setRestriction(tag, identifiers = [], exceptIdentifiers = [], index = 0) {
        const normalizedIdentifiers = this._normalizeIdentifiers(identifiers, exceptIdentifiers);
        this.parentElement = {
            tag,
            identifiers: normalizedIdentifiers.identifiers,
            exceptIdentifiers: normalizedIdentifiers.exceptIdentifiers,
            index,
        };
        return this;
    }

    clearRestrinction() {
        this.parentElement = null;
        return this;
    }

    async click(double = false) {
        await this._executeQueue();
        try {
            await this._showHint(`Clicking on ${this._describeLastElementInQueue()}`, "info");
            if (double) {
                await this.currentElement.locator.dblclick();
            } else {
                await this.currentElement.locator.click();
            }
        } catch (error) {
            await this._showHint(`Error clicking on ${this._describeLastElementInQueue()}`, "error");
            await this.waitFor(3000, false);
            throw error;
        }
        await this._hideHint();
        return this;
    }

    async check(value = true) {
        await this._executeQueue();
        try {
            await this._showHint(`Checking ${this._describeLastElementInQueue()}`, "info");
            if (value) {
                await this.currentElement.locator.check({ force: true });
            } else {
                await this.currentElement.locator.uncheck({ force: true });
            }
        } catch (error) {
            if (!error.message?.includes("did not change its state")) {
                await this._showHint(`Error checking ${this._describeLastElementInQueue()}`, "error");
                await this.waitFor(3000, false);
                throw error;
            }
        }
        await this._hideHint();
        return this;
    }

    async fill(text) {
        await this._executeQueue();
        // In rare cases (e.g. password fields) Playwright's .fill() may only fill the first character.
        // Workaround: clear first, then type char-by-char if .fill() fails.
        // await this.currentElement.locator.fill(""); // Always clear before filling
        try {
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
            await this._showHint(`Error filling "${text}" in ${this._describeLastElementInQueue()}`, "error");
            await this.waitFor(3000, false);
            throw error;
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
            await this._showHint(`Error blurring ${this._describeLastElementInQueue()}`, "error");
            await this.waitFor(3000, false);
            throw error;
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
            await this._showHint(`Error focusing ${this._describeLastElementInQueue()}`, "error");
            await this.waitFor(3000, false);
            throw error;
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
            await this._showHint(`Error selecting in ${this._describeLastElementInQueue()}`, "error");
            await this.waitFor(3000, false);
            throw error;
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
            await this._showHint(`Error setting date and time to "${yyyy}-${MM}-${dd} ${HH}:${mm}"`, "error");
            await this.waitFor(3000, false);
            throw error;
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
            await this._showHint(`Error setting month to "${yyyy}-${month}"`, "error");
            await this.waitFor(3000, false);
            throw error;
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
            await this.currentElement.locator.scrollIntoViewIfNeeded();
        } catch (error) {
            await this._showHint(`Error scrolling to ${this._describeLastElementInQueue()}`, "error");
            await this.waitFor(3000, false);
            throw error;
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
            await this._showHint(`Error scrolling to ${text}`, "error");
            await this.waitFor(3000, false);
            throw error;
        }
        return this;
    }

    async getStyles() {
        await this._executeQueue();
        return this.currentElement.locator.evaluate((el) => {
            const style = window.getComputedStyle(el);
            const styleJson = {};
            for (let i = 0; i < style.length; i++) {
                const key = style[i];
                styleJson[key] = style.getPropertyValue(key);
            }
            return styleJson;
        });
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
            await this._showHint(`Error pressing Enter on ${this._describeLastElementInQueue()}`, "error");
            await this.waitFor(3000, false);
            throw error;
        }
        await this._hideHint();
        return this;
    }

    async getAttribute(attribute) {
        await this._executeQueue();
        return await this.currentElement.locator.getAttribute(attribute);
    }

    async getText() {
        await this._executeQueue();
        return await this.currentElement.locator.textContent();
    }

    async getValue() {
        await this._executeQueue();
        return await this.currentElement.locator.inputValue();
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} contains ${text}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} does not contain ${text}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} has text ${text}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} contains HTML ${html}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} does not contain HTML ${html}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} has value ${value}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} contains value ${value}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    async shouldExist(throwError = true) {
        await this._executeQueue(0, true);
        try {
            const count = await this.currentElement.locator.count();
            if (count === 0) {
                throw new Error(`Element does not exist: ${this._describeLastElementInQueue()}`);
            }
            await expect(this.currentElement.locator.first()).toBeVisible();
            await this._showHint(`${this._describeLastElementInQueue()} exists`, "success");
        } catch (error) {
            if (throwError) {
                await this._showHint(`Error checking if ${this._describeLastElementInQueue()} exists`, "error");
                await this.waitFor(3000, false);
                throw error;
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
                await this._showHint(`Error checking if ${this._describeLastElementInQueue()} does not exist`, "error");
                await this.waitFor(3000, false);
                throw new Error(`Element exists: ${this._describeLastElementInQueue()}`);
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} is ${value ? "checked" : "unchecked"}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} contains class ${className}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
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
                await this._showHint(
                    `Error checking if ${this._describeLastElementInQueue()} does not contain class ${className}`,
                    "error"
                );
                await this.waitFor(3000, false);
                throw error;
            }
            return false;
        }
        await this._hideHint();
        return true;
    }

    pause() {
        this._showHint("Paused. Call resume() to continue.", "info", [
            { text: "Resume", onClick: () => this.resume() },
        ]);
        return new Promise((resolve) => {
            this._pauseResolver = resolve;
        });
    }

    resume() {
        if (this._pauseResolver) {
            this._hideHint();
            this._pauseResolver();
            this._pauseResolver = null;
        }
    }

    async _executeQueue(tries = 0, checking = false) {
        if (this.queue.length === 0) return this;
        await this.waitFor(this.timeout, false);
        await this.api.waitForIdle();
        this.currentElement = null;
        this.matchedElements = [];
        if (typeof this.waiter === "function") await this.waiter();
        if (this.parentElement) {
            const { element, elements } = await this._getElement(
                this.page.locator("body"),
                this.parentElement.tag,
                this.parentElement.identifiers,
                this.parentElement.exceptIdentifiers,
                this.parentElement.index,
                tries
            );
            this.currentElement = element;
            this.matchedElements = elements;
        }
        for (const item of this.queue) {
            if (typeof item === "object" && !item.hasOwnProperty("parent")) {
                const { element, elements } = await this._getElement(
                    this.currentElement?.locator || this.page.locator("body"),
                    item.tag,
                    item.identifiers,
                    item.exceptIdentifiers,
                    item.index,
                    tries
                );
                this.currentElement = element;
                this.matchedElements = elements;
            } else if (typeof item === "object" && item.hasOwnProperty("parent") && this.currentElement?.locator) {
                // if (this.currentElement?.then) this.currentElement = await this.currentElement;
                this.currentElement.locator = this.currentElement.locator.locator(`..`).nth(item.parent);
                this.currentElement.data = await this._extractDataFromLocator(this.currentElement.locator);
                this.currentElement.data.stringified = `Parent of ${this.currentElement.data.stringified}`;
            }
        }
        if (this.currentElement?.locator) {
            this._describeLastElementInQueue();
            this.queue = [];
            // await this._highlight(this.currentElement.locator, { ms: this.timeout });
        } else {
            if (tries > 4 && !checking) {
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

    async _getElement(parent, tag, identifiers = [], exceptIdentifiers = [], index = 0, tries = 0) {
        const elements = await this._getAllElements(parent, tag, identifiers, tries);
        let maxPoints = 0;
        for (const element of elements) {
            const pointsPlus = this._calculateMatchingPoints(element.data, identifiers || []);
            const pointsMinus = this._calculateMatchingPoints(element.data, exceptIdentifiers || []);
            element.points = pointsPlus - pointsMinus;
            maxPoints = Math.max(maxPoints, element.points);
        }
        const matchedElements = elements.filter(
            (element) => element.points === maxPoints && (element.points > 0 || identifiers.length === 0)
        );
        return { element: matchedElements?.[index] ?? null, elements: matchedElements };
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
            await this._injectQaHintPopup(color, buttons);
            const hintPopupElement = await this.page.$("#qa-hint-popup");
            if (hintPopupElement) {
                await hintPopupElement.evaluate(
                    (el, { text, color }) => {
                        el.style.backgroundColor = color;
                        el.textContent = text;
                        el.style.display = "block";
                    },
                    { text, color }
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
            const hintPopupElement = await this.page.$("#qa-hint-popup");
            await this.waitFor(200, false);
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
                const data = await this._extractDataFromLocator(result);
                elements.push({ locator: result, data });
            } catch (error) {
                console.error(`Error extracting data from locator: ${result.toString()}, error: ${error.message}`);
            }
        }
        return elements;
    }

    _calculateMatchingPoints(data, identifiers = []) {
        let points = 0;
        for (const identifier of identifiers) {
            if (typeof identifier === "string") {
                const value = identifier;
                const dataEntries = Object.entries(data);
                let bestPoint = 0;
                for (let i = 0; i < dataEntries.length; i++) {
                    let [key, foundValue] = dataEntries[i];
                    if (typeof foundValue === "string") {
                        foundValue = foundValue.toLowerCase().trim();
                    }
                    if (foundValue === value.toLowerCase().trim()) {
                        bestPoint = Math.max(
                            bestPoint,
                            this.MATCHING_WEIGHTS?.[key]?.withoutKey?.fullMatching || this.DEFAULT_MATCHING_WEIGHT
                        );
                    } else if (foundValue?.includes?.(value.toLowerCase().trim())) {
                        const lengthDifference = Math.abs(foundValue.length - value.length);
                        let coefficient = 1;
                        if (
                            key === "text" ||
                            key === "value" ||
                            key === "html" ||
                            key === "parentText" ||
                            key === "label" ||
                            key === "columnName" ||
                            key === "columnThHtml"
                        ) {
                            coefficient = 1 - (lengthDifference / foundValue.length) * 0.5;
                        }
                        const partialPoint =
                            (this.MATCHING_WEIGHTS?.[key]?.withoutKey?.partialMatching ||
                                this.DEFAULT_PARTIAL_MATCHING_WEIGHT) * coefficient;
                        bestPoint = Math.max(bestPoint, partialPoint);
                    }
                }
                points += bestPoint;
            }
            if (typeof identifier === "object") {
                const [key, value] = Object.entries(identifier)[0];
                if (data.hasOwnProperty(key)) {
                    const bonusCoefficient = 0.1;
                    const foundValue = typeof data[key] === "string" ? data[key].toLowerCase().trim() : data[key];
                    if (foundValue === value.toLowerCase().trim()) {
                        points +=
                            (this.MATCHING_WEIGHTS?.[key]?.withKey?.fullMatching || this.DEFAULT_MATCHING_WEIGHT) *
                            (1 + bonusCoefficient);
                    } else if (foundValue?.includes?.(value.toLowerCase().trim())) {
                        const lengthDifference = Math.abs(foundValue.length - value.length);
                        let coefficient = 1;
                        if (
                            key === "text" ||
                            key === "value" ||
                            key === "html" ||
                            key === "parentText" ||
                            key === "label" ||
                            key === "columnName" ||
                            key === "columnThHtml"
                        ) {
                            coefficient = 1 - (lengthDifference / foundValue.length) * 0.5;
                        }
                        const partialPoint =
                            (this.MATCHING_WEIGHTS?.[key]?.withoutKey?.partialMatching ||
                                this.DEFAULT_PARTIAL_MATCHING_WEIGHT) *
                            (coefficient + bonusCoefficient);
                        points += partialPoint;
                    }
                }
            }
        }
        return points;
    }

    async _extractDataFromLocator(locator) {
        // const timeout = this.timeout ?? 5000;
        // const opts = { timeout };
        const [dom, isVisible, isEnabled] = await Promise.all([
            locator.evaluate((el) => {
                function elumitateHtmlChars(value) {
                    if (typeof value !== "string") return value;
                    return value
                        .replaceAll(/&amp;/g, "&")
                        .replaceAll(/&lt;/g, "<")
                        .replaceAll(/&gt;/g, ">")
                        .replaceAll(/&quot;/g, '"')
                        .replaceAll(/&apos;/g, "'")
                        .replaceAll(/&copy;/g, "©")
                        .replaceAll(/&reg;/g, "®")
                        .replaceAll(/&trade;/g, "™")
                        .replaceAll(/&euro;/g, "€")
                        .replaceAll(/&pound;/g, "£")
                        .replaceAll(/&yen;/g, "¥")
                        .replaceAll(/&dollar;/g, "$")
                        .replaceAll(/&cent;/g, "¢")
                        .replaceAll(/&percnt;/g, "%")
                        .replaceAll(/&nbsp;/g, " ")
                        .replaceAll(/\s+/g, " ")
                        .trim();
                }

                function getTdColumnName(el) {
                    const tag = el.tagName.toLowerCase();
                    if (tag !== "td") return null;

                    const td = el;

                    const tr = td.closest("tr");
                    const table = td.closest("table");
                    if (!tr || !table) return null;

                    // index within row among td/th
                    const cells = Array.from(tr.querySelectorAll("th,td"));
                    const colIndex = cells.indexOf(td);
                    if (colIndex < 0) return null;

                    // prefer thead -> first header row
                    const theadRow = table.querySelector("thead tr");
                    if (theadRow) {
                        const ths = Array.from(theadRow.querySelectorAll("th"));
                        return (ths[colIndex]?.textContent || "").trim();
                    }

                    // fallback: first row th
                    const firstRow = table.querySelector("tr");
                    if (firstRow) {
                        const ths = Array.from(firstRow.querySelectorAll("th"));
                        return (ths[colIndex]?.textContent || "").trim();
                    }

                    return null;
                }

                function getTdColumnThHtml(el) {
                    const tag = el.tagName.toLowerCase();
                    if (tag !== "td") return null;

                    const td = el;

                    const tr = td.closest("tr");
                    const table = td.closest("table");
                    if (!tr || !table) return null;

                    // index within row among td/th
                    const cells = Array.from(tr.querySelectorAll("th,td"));
                    const colIndex = cells.indexOf(td);
                    if (colIndex < 0) return null;

                    // prefer thead -> first header row
                    const theadRow = table.querySelector("thead tr");
                    if (theadRow) {
                        const ths = Array.from(theadRow.querySelectorAll("th"));
                        return ths[colIndex]?.outerHTML;
                    }

                    // fallback: first row th
                    const firstRow = table.querySelector("tr");
                    if (firstRow) {
                        const ths = Array.from(firstRow.querySelectorAll("th"));
                        return ths[colIndex]?.outerHTML;
                    }

                    return null;
                }

                function getLabel(el, maxDepth = 4) {
                    let label = el.closest("label")?.textContent?.trim() || null;
                    if (!label && maxDepth > 0) {
                        const labels = Array.from(el.parentElement?.querySelectorAll("label") || []);
                        label =
                            labels
                                .map((l) => l.textContent?.trim())
                                .filter(Boolean)
                                .join(" ") || null;
                        if (!label) {
                            label = getLabel(el.parentElement, maxDepth - 1);
                        }
                    }
                    return label;
                }

                function getValuesOfAllInnerElements(el) {
                    return Array.from(el.querySelectorAll("input, textarea, select"))
                        .map((el) => el.value)
                        .join(" ");
                }

                const e = el;

                // all attributes on the element
                const attrs = {};
                for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;

                // tag-level inline style (style="...")
                const inlineStyle = el.getAttribute("style") ?? "";

                // common “value/checked” for form elements
                const input = el;
                const value = "value" in input ? input.value : getValuesOfAllInnerElements(el);
                const checked = el.checked === "";

                const dom = {
                    tagName: el.tagName.toLowerCase(),

                    // common attributes
                    id: el.id || null,
                    name: el.getAttribute("name"),
                    className: e.className ?? null, // string for HTML
                    classList: Array.from(el.classList),
                    // styles
                    inlineStyle, // only defined on tag level
                    // computedStyle: window.getComputedStyle(el).cssText,  // optional (heavy / huge)

                    // form-ish
                    value,
                    checked,

                    // everything else
                    text: elumitateHtmlChars(el.textContent),
                    parentText: elumitateHtmlChars(el.parentElement?.textContent?.trim() || null),
                    html: elumitateHtmlChars(el.outerHTML),
                    columnName: elumitateHtmlChars(getTdColumnName?.(el)),
                    columnThHtml: elumitateHtmlChars(getTdColumnThHtml?.(el)),
                    label: elumitateHtmlChars(getLabel?.(el)),
                    ...attrs,
                };
                let identifier = dom.text || dom.name || dom.id || dom.className || dom.placeholder;
                dom.stringified = `${el.tagName.toLowerCase()} (${identifier})`;
                return dom;
            }),
            locator.isVisible(),
            locator.isEnabled(),
        ]);
        return { ...dom, visible: isVisible, enabled: isEnabled };
    }

    async _injectQaHintPopup(color, buttons = []) {
        await this.page.evaluate((color) => {
            const ID = "qa-hint-popup";

            let el = document.getElementById(ID);
            if (!el) {
                el = document.createElement("div");
                el.id = ID;

                // styling: doesn't reflow page, doesn't block clicks
                el.style.position = "fixed";
                el.style.display = "block";
                el.style.left = "50%";
                el.style.bottom = "16px";
                el.style.transform = "translateX(-50%)";
                el.style.zIndex = "2147483647";
                el.style.backgroundColor = color;
                el.style.color = "white";
                el.style.fontWeight = "700";
                el.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
                el.style.fontSize = "14px";
                el.style.lineHeight = "1.25";
                el.style.padding = "10px 14px";
                el.style.borderRadius = "10px";
                el.style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
                el.style.maxWidth = "80vw";
                el.style.textAlign = "center";
                el.style.whiteSpace = "pre-wrap";
                el.style.pointerEvents = "none"; // IMPORTANT: don't break UI interactions
                if (buttons.length > 0) {
                    buttons.forEach((button) => {
                        const { text, onClick } = button;
                        const buttonElement = document.createElement("button");
                        buttonElement.textContent = text;
                        buttonElement.addEventListener("click", onClick);
                        el.appendChild(buttonElement);
                    });
                }
                document.documentElement.appendChild(el);
            }
        }, color);
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
        await locator.evaluate(async (el, ms) => {
            const prevOutline = el.style.outline;
            const prevOutlineOffset = el.style.outlineOffset;
            const backgroundColor = el.style.backgroundColor;

            el.style.outline = "3px solid #ff00ff";
            el.style.outlineOffset = "2px";
            el.style.backgroundColor = "rgba(255, 0, 255, 0.5)";

            setTimeout(() => {
                el.style.outline = prevOutline;
                el.style.outlineOffset = prevOutlineOffset;
                el.style.backgroundColor = backgroundColor;
            }, ms);
        }, ms);
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
                        for (const identifier of elem.identifiers) {
                            if (typeof identifier === "string") {
                                if (addSpecialSymbol && identifier) {
                                    details += " > ";
                                    addSpecialSymbol = false;
                                }
                                details += `${identifier}`;
                            } else if (Array.isArray(identifier)) {
                                if (addSpecialSymbol && identifier) {
                                    details += " > ";
                                    addSpecialSymbol = false;
                                }
                                details += `${JSON.stringify(
                                    identifier.map((item) => {
                                        if (typeof item === "string") {
                                            return item;
                                        } else if (typeof item === "object") {
                                            return `${Object.entries(item)
                                                .map(([key, value]) => `${key}=${value}`)
                                                .join(", ")}`;
                                        }
                                    })
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
                        }
                    }
                }
            }
            description = lastElement ? `${lastElement.tag} (${details})` : "";
            this._shadowDescription = description;
        }
        return description || this._shadowDescription;
    }

    async _checkIfVisible(target) {
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
}
