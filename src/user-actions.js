/**
 * Records the actions a human performs in the browser while `QA.pause()` holds the test process.
 *
 * Everything captured here happened *outside* the test scenario: the script stopped, a person
 * clicked/typed/dragged to move the run forward. Those steps are exactly what a maintainer (human
 * or AI agent) must move into the spec file so the same pause does not happen on the next run,
 * which is why every emitted log line carries the manual marker and the fix guidance.
 */

// Page binding used by the in-page listeners to push events back into Node.
const USER_ACTION_BINDING = "__qalight__userAction";
// Guard so the listeners are installed once per document, even when both `addInitScript` and the
// direct `evaluate` call run against the same frame.
const INSTALL_FLAG = "__qalight__userActionListenersInstalled";
// Bumped in the page on every pause: identifies which pause the in-page interaction tracking belongs to.
const SCOPE_KEY = "__qalight__userActionScope";
// Ids of the QA hint overlay. Clicks on Continue/Stop/Show trace are pause controls, not actions
// performed against the application under test, so they are never reported as user actions.
const OVERLAY_IDS = ["qa-hint-popup", "qa-hint-popup-wrapper"];

const MAX_TEXT_LENGTH = 80;

// A page binding can be exposed only once per page, but several QA instances may wrap the same page
// (`getTab`). The binding is therefore installed once and dispatches to every recorder attached to
// that page; only the ones currently recording consume the event.
/** @type {WeakMap<import('@playwright/test').Page, Set<UserActionRecorder>>} */
const recordersByPage = new WeakMap();

export const AI_AGENT_PAUSE_GUIDANCE = [
    "AI AGENT GUIDANCE: this pause means the scenario could not continue on its own and a human had to",
    "take over. Do not treat the manual steps recorded in this report as an acceptable outcome. Fix the",
    "test (or the application) so that no pause is needed next time: every action performed manually",
    "during this pause must be scripted explicitly in the test file (correct selectors/identifiers,",
    "required waits, missing preconditions, extra steps), so the scenario runs to the end unattended.",
].join("\n");

export const AI_AGENT_ACTION_HINT =
    "AI AGENT: this step was NOT in the scenario — script it in the test file so this pause does not happen next time.";

/**
 * Installed in the page (and in every document created during the pause). Attaches capture-phase
 * listeners for user input and forwards a serializable description of each one to Node.
 * Must stay self-contained: it is serialized and evaluated in the browser.
 */
function installUserActionListeners(config) {
    const { binding, installFlag, scopeKey, overlayIds, maxTextLength } = config;
    if (window[installFlag]) return;
    window[installFlag] = true;

    // `change` fires on blur, so a value typed by the *script* before the pause can be committed by
    // the first manual click. Elements the human actually interacted with during the current pause
    // are tracked here so such a late `change` can be flagged instead of reported as a manual edit.
    let scopeSeen = window[scopeKey];
    let touched = new WeakSet();

    const syncScope = () => {
        if (window[scopeKey] !== scopeSeen) {
            scopeSeen = window[scopeKey];
            touched = new WeakSet();
        }
    };

    const touch = (node) => {
        syncScope();
        if (!node || node.nodeType !== 1) return;
        touched.add(node);
        // A click on a <label> is what the user did; the change event comes from its control.
        try {
            const label = typeof node.closest === "function" ? node.closest("label") : null;
            if (label && label.control) touched.add(label.control);
        } catch (error) {}
    };

    const wasTouched = (node) => {
        syncScope();
        return !!node && node.nodeType === 1 && touched.has(node);
    };

    const send = (payload) => {
        try {
            const fn = window[binding];
            if (typeof fn === "function") fn(payload);
        } catch (error) {
            /* the binding may be gone after navigation teardown */
        }
    };

    const isElement = (node) => !!node && node.nodeType === 1;

    const isOverlay = (node) => {
        let current = node;
        while (current) {
            if (isElement(current) && current.id && overlayIds.indexOf(current.id) !== -1) return true;
            const root = current.getRootNode ? current.getRootNode() : null;
            current = current.parentElement || (root && root.host) || null;
        }
        return false;
    };

    const attr = (el, name) => {
        if (!isElement(el) || typeof el.getAttribute !== "function") return undefined;
        const value = el.getAttribute(name);
        return value === null || value === "" ? undefined : value;
    };

    const clean = (value) =>
        String(value === undefined || value === null ? "" : value)
            .replace(/\s+/g, " ")
            .trim();

    const cssPath = (el) => {
        const parts = [];
        let node = el;
        let depth = 0;
        while (isElement(node) && depth < 5) {
            if (node.id) {
                parts.unshift(`#${node.id}`);
                break;
            }
            const tag = node.tagName.toLowerCase();
            const testId = attr(node, "data-testid") || attr(node, "data-test-id") || attr(node, "data-qa");
            if (testId) {
                parts.unshift(`${tag}[data-testid="${testId}"]`);
                break;
            }
            let part = tag;
            const classes = clean(attr(node, "class"))
                .split(" ")
                .filter((cls) => cls && cls.indexOf("ng-") !== 0 && !/^[a-z]+-?\d{3,}$/.test(cls))
                .slice(0, 2);
            if (classes.length) part += `.${classes.join(".")}`;
            const parent = node.parentElement;
            if (parent) {
                const sameTag = Array.prototype.filter.call(parent.children, (child) => child.tagName === node.tagName);
                if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
            }
            parts.unshift(part);
            node = parent;
            depth++;
        }
        return parts.join(" > ");
    };

    const isSecret = (el) =>
        isElement(el) &&
        (String(el.type).toLowerCase() === "password" ||
            /password|secret/i.test(attr(el, "autocomplete") || "") ||
            /password|secret/i.test(attr(el, "name") || "") ||
            /password|secret/i.test(attr(el, "id") || ""));

    const mask = (value) => `***(${String(value === undefined || value === null ? "" : value).length} chars)`;

    const valueOf = (el) => {
        if (!isElement(el)) return undefined;
        const raw = "value" in el && el.value !== undefined && el.value !== null ? String(el.value) : el.isContentEditable ? clean(el.textContent) : undefined;
        if (raw === undefined) return undefined;
        return isSecret(el) ? mask(raw) : raw.slice(0, 200);
    };

    const describe = (el) => {
        if (!isElement(el)) return null;
        return {
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            testId: attr(el, "data-testid") || attr(el, "data-test-id") || attr(el, "data-qa"),
            name: attr(el, "name"),
            type: attr(el, "type"),
            role: attr(el, "role"),
            ariaLabel: attr(el, "aria-label"),
            placeholder: attr(el, "placeholder"),
            title: attr(el, "title"),
            href: attr(el, "href"),
            text: clean(el.innerText || el.textContent).slice(0, maxTextLength) || undefined,
            selector: cssPath(el),
        };
    };

    const modifiers = (event) => {
        const list = [];
        if (event.ctrlKey) list.push("Ctrl");
        if (event.metaKey) list.push("Meta");
        if (event.altKey) list.push("Alt");
        if (event.shiftKey) list.push("Shift");
        return list;
    };

    const frameUrl = () => {
        try {
            return location.href;
        } catch (error) {
            return undefined;
        }
    };

    const emit = (payload) => send({ ...payload, url: frameUrl() });

    // --- click / double click / right click -------------------------------------------------
    document.addEventListener(
        "click",
        (event) => {
            if (isOverlay(event.target)) return;
            touch(event.target);
            emit({
                kind: "click",
                button: event.button,
                clickCount: event.detail,
                modifiers: modifiers(event),
                x: Math.round(event.clientX),
                y: Math.round(event.clientY),
                target: describe(event.target),
            });
        },
        true
    );

    document.addEventListener(
        "contextmenu",
        (event) => {
            if (isOverlay(event.target)) return;
            emit({ kind: "contextmenu", target: describe(event.target) });
        },
        true
    );

    // --- typing ---------------------------------------------------------------------------
    // Printable keys are reported once as the resulting field value (debounced) instead of one log
    // line per keystroke; non-printable keys and shortcuts are reported individually.
    let inputTimer = null;
    let inputElement = null;

    const flushInput = () => {
        if (inputTimer) {
            clearTimeout(inputTimer);
            inputTimer = null;
        }
        if (inputElement) {
            const element = inputElement;
            inputElement = null;
            emit({ kind: "input", value: valueOf(element), target: describe(element) });
        }
    };

    document.addEventListener(
        "input",
        (event) => {
            if (isOverlay(event.target)) return;
            touch(event.target);
            if (inputElement && inputElement !== event.target) flushInput();
            inputElement = event.target;
            if (inputTimer) clearTimeout(inputTimer);
            inputTimer = setTimeout(flushInput, 600);
        },
        true
    );

    document.addEventListener(
        "keydown",
        (event) => {
            if (isOverlay(event.target)) return;
            touch(event.target);
            const isPrintable = event.key && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
            // Printable keys are reported once through the debounced `input`/`change` value.
            if (isPrintable) return;
            // A modifier pressed on its own is not an action — it is reported with the key it modifies.
            if (["Control", "Shift", "Alt", "Meta", "CapsLock", "Dead"].indexOf(event.key) !== -1) return;
            if (event.key === "Enter" || event.key === "Tab" || event.key === "Escape") flushInput();
            emit({
                kind: "key",
                key: event.key,
                code: event.code,
                modifiers: modifiers(event),
                target: describe(event.target),
            });
        },
        true
    );

    // --- committed values (select, checkbox, radio, file, blurred inputs) -------------------
    document.addEventListener(
        "change",
        (event) => {
            if (isOverlay(event.target)) return;
            const element = event.target;
            if (inputElement === element) {
                if (inputTimer) clearTimeout(inputTimer);
                inputTimer = null;
                inputElement = null;
            }
            const payload = { kind: "change", target: describe(element), stale: !wasTouched(element) };
            const tag = isElement(element) ? element.tagName.toLowerCase() : "";
            const type = isElement(element) ? String(element.type).toLowerCase() : "";
            if (tag === "select") {
                payload.value = valueOf(element);
                payload.selectedText = element.selectedOptions
                    ? Array.prototype.map.call(element.selectedOptions, (option) => clean(option.text)).join(", ")
                    : undefined;
            } else if (type === "checkbox" || type === "radio") {
                payload.checked = !!element.checked;
                payload.value = valueOf(element);
            } else if (type === "file") {
                payload.files = element.files
                    ? Array.prototype.map.call(element.files, (file) => file.name).join(", ")
                    : "";
            } else {
                payload.value = valueOf(element);
            }
            emit(payload);
        },
        true
    );

    document.addEventListener(
        "submit",
        (event) => {
            if (isOverlay(event.target)) return;
            flushInput();
            emit({ kind: "submit", target: describe(event.target) });
        },
        true
    );

    // --- drag and text selection -----------------------------------------------------------
    let pointerStart = null;
    let htmlDragSource = null;
    let htmlDragHandled = false;
    let lastSelection = "";

    document.addEventListener(
        "mousedown",
        (event) => {
            if (isOverlay(event.target)) return;
            htmlDragHandled = false;
            pointerStart = {
                x: Math.round(event.clientX),
                y: Math.round(event.clientY),
                target: describe(event.target),
            };
        },
        true
    );

    document.addEventListener(
        "dragstart",
        (event) => {
            if (isOverlay(event.target)) return;
            htmlDragSource = describe(event.target);
        },
        true
    );

    document.addEventListener(
        "drop",
        (event) => {
            if (isOverlay(event.target)) return;
            touch(event.target);
            htmlDragHandled = true;
            emit({
                kind: "drag",
                from: htmlDragSource || (pointerStart && pointerStart.target),
                target: describe(event.target),
                x: Math.round(event.clientX),
                y: Math.round(event.clientY),
            });
            htmlDragSource = null;
        },
        true
    );

    document.addEventListener(
        "mouseup",
        (event) => {
            if (isOverlay(event.target)) return;
            const selection = window.getSelection ? clean(String(window.getSelection())) : "";
            const start = pointerStart;
            pointerStart = null;

            if (selection && selection !== lastSelection) {
                lastSelection = selection;
                emit({
                    kind: "select",
                    text: selection.slice(0, maxTextLength),
                    target: describe(event.target),
                });
                return;
            }
            if (!selection) lastSelection = "";

            if (!start || htmlDragHandled) return;
            const distance = Math.hypot(Math.round(event.clientX) - start.x, Math.round(event.clientY) - start.y);
            if (distance < 12) return;
            emit({
                kind: "drag",
                from: start.target,
                target: describe(event.target),
                fromX: start.x,
                fromY: start.y,
                x: Math.round(event.clientX),
                y: Math.round(event.clientY),
            });
        },
        true
    );

    // --- clipboard -------------------------------------------------------------------------
    ["copy", "cut", "paste"].forEach((kind) => {
        document.addEventListener(
            kind,
            (event) => {
                if (isOverlay(event.target)) return;
                touch(event.target);
                let text;
                try {
                    const data = event.clipboardData ? event.clipboardData.getData("text") : "";
                    text = isSecret(event.target) ? mask(data) : clean(data).slice(0, maxTextLength);
                } catch (error) {
                    text = undefined;
                }
                emit({ kind: "clipboard", clipboardAction: kind, text, target: describe(event.target) });
            },
            true
        );
    });

    // --- scroll (throttled; only meaningful movement) ---------------------------------------
    let lastScrollAt = 0;
    let lastScrollPosition = -1;
    document.addEventListener(
        "scroll",
        (event) => {
            const node = event.target === document || event.target === document.documentElement ? null : event.target;
            if (node && isOverlay(node)) return;
            const position = node && isElement(node) ? node.scrollTop : window.scrollY;
            const now = typeof performance !== "undefined" ? performance.now() : 0;
            if (now - lastScrollAt < 1000) return;
            if (lastScrollPosition >= 0 && Math.abs(position - lastScrollPosition) < 40) return;
            lastScrollAt = now;
            lastScrollPosition = position;
            emit({
                kind: "scroll",
                position: Math.round(position),
                target: node && isElement(node) ? describe(node) : null,
            });
        },
        true
    );
}

export class UserActionRecorder {
    /**
     * @param {import('@playwright/test').Page} page
     * @param {Object} options
     * @param {(message: string) => any} options.onAction - called with a formatted, ready-to-log line.
     */
    constructor(page, { onAction } = {}) {
        /** @type {import('@playwright/test').Page} */
        this.page = page;
        this._onAction = typeof onAction === "function" ? onAction : () => {};
        this._installed = false;
        this._recording = false;
        /** @type {Array<{index: number, description: string, url: string|undefined, message: string}>} */
        this.actions = [];
        this._pauseNumber = 0;
        this._navigationHandler = null;
        this._popupHandler = null;
    }

    get isRecording() {
        return this._recording;
    }

    /**
     * Starts recording. Safe to call repeatedly; listeners are installed once per document and
     * re-installed automatically after navigations that happen during the pause.
     * @returns {Promise<void>}
     */
    async start() {
        this._pauseNumber += 1;
        this.actions = [];
        this._recording = true;
        await this._install();
        await this._openScope();
        this._attachPageListeners();
    }

    /**
     * Stops recording. The recording flag is cleared synchronously so that no event fired after the
     * pause was released can be misreported as a manual action.
     * @returns {Array<{index: number, description: string, url: string|undefined, message: string}>} actions captured during the pause that just ended.
     */
    stop() {
        const captured = this.actions.slice();
        this._recording = false;
        this._detachPageListeners();
        return captured;
    }

    get pauseNumber() {
        return this._pauseNumber;
    }

    async _install() {
        const config = {
            binding: USER_ACTION_BINDING,
            installFlag: INSTALL_FLAG,
            scopeKey: SCOPE_KEY,
            overlayIds: OVERLAY_IDS,
            maxTextLength: MAX_TEXT_LENGTH,
        };

        if (!this._installed) {
            let recorders = recordersByPage.get(this.page);
            if (!recorders) {
                recorders = new Set();
                recordersByPage.set(this.page, recorders);
                try {
                    await this.page.exposeBinding(USER_ACTION_BINDING, (source, payload) => {
                        for (const recorder of recorders) recorder._handle(payload);
                    });
                } catch (error) {
                    // The page was closed or the binding already exists from an earlier install.
                }
                try {
                    // Keeps the listeners alive for documents created while the test is paused.
                    await this.page.addInitScript(installUserActionListeners, config);
                } catch (error) {}
            }
            recorders.add(this);
            this._installed = true;
        }

        for (const frame of this._frames()) {
            try {
                await frame.evaluate(installUserActionListeners, config);
            } catch (error) {
                // Detached or cross-origin frame we cannot instrument — ignore.
            }
        }
    }

    /**
     * Marks a fresh interaction scope in every frame, so values typed before this pause are not
     * reported as manual edits when their `change` event finally fires.
     * @returns {Promise<void>}
     */
    async _openScope() {
        for (const frame of this._frames()) {
            try {
                await frame.evaluate(
                    ({ key, value }) => {
                        window[key] = value;
                    },
                    { key: SCOPE_KEY, value: `pause-${this._pauseNumber}` }
                );
            } catch (error) {}
        }
    }

    _frames() {
        try {
            return this.page.frames();
        } catch (error) {
            return [];
        }
    }

    _attachPageListeners() {
        if (this._navigationHandler) return;
        this._navigationHandler = (frame) => {
            if (!this._recording) return;
            if (frame !== this.page.mainFrame()) return;
            let url = "";
            try {
                url = frame.url();
            } catch (error) {}
            this._report(`page navigated to ${url} (triggered by the manual interaction, not by the scenario)`);
            // The new document needs its listeners and interaction scope back.
            this._install()
                .then(() => this._openScope())
                .catch(() => {});
        };
        this._popupHandler = (popup) => {
            if (!this._recording) return;
            let url = "";
            try {
                url = popup.url();
            } catch (error) {}
            this._report(`a new tab/popup was opened: ${url} (triggered by the manual interaction, not by the scenario)`);
        };
        try {
            this.page.on("framenavigated", this._navigationHandler);
            this.page.on("popup", this._popupHandler);
        } catch (error) {}
    }

    _detachPageListeners() {
        try {
            if (this._navigationHandler) this.page.off("framenavigated", this._navigationHandler);
            if (this._popupHandler) this.page.off("popup", this._popupHandler);
        } catch (error) {}
        this._navigationHandler = null;
        this._popupHandler = null;
    }

    _handle(payload) {
        if (!this._recording || !payload) return;
        try {
            this._report(this._describeAction(payload), payload.url);
        } catch (error) {}
    }

    _report(description, url) {
        const index = this.actions.length + 1;
        const location = url ? `\n   page: ${url}` : "";
        const message = [
            `USER ACTION #${index} during pause #${this._pauseNumber} (performed manually by a human, NOT scripted in the scenario): ${description}${location}`,
            `   ${AI_AGENT_ACTION_HINT}`,
        ].join("\n");
        this.actions.push({ index, description, url, message });
        this._onAction(message);
    }

    _describeAction(payload) {
        const target = this._describeTarget(payload.target);
        const modifiers = payload.modifiers && payload.modifiers.length ? `${payload.modifiers.join("+")}+` : "";

        switch (payload.kind) {
            case "click": {
                const button = payload.button === 1 ? "middle-click" : payload.button === 2 ? "right-click" : "click";
                const kind = payload.clickCount >= 3 ? "triple-click" : payload.clickCount === 2 ? "double-click" : button;
                const position = Number.isFinite(payload.x) ? ` at (${payload.x}, ${payload.y})` : "";
                return `${modifiers}${kind} on ${target}${position}`;
            }
            case "contextmenu":
                return `context menu opened on ${target}`;
            case "key":
                return `pressed key ${modifiers}${payload.key} on ${target}`;
            case "input":
                return `typed value "${payload.value ?? ""}" into ${target}`;
            case "change": {
                // A `change` for an element the human never touched during this pause is a value that
                // was already in the field (typically a scripted `fill` committed by the first manual
                // click), so it is flagged rather than presented as a manual edit.
                const stale = payload.stale
                    ? " (the value was already in the field before this pause — most likely a scripted step committed on blur, verify before scripting it again)"
                    : "";
                if (payload.selectedText !== undefined) {
                    return `selected option "${payload.selectedText}" (value "${payload.value ?? ""}") in ${target}${stale}`;
                }
                if (payload.checked !== undefined) {
                    return `${payload.checked ? "checked" : "unchecked"} ${target}${stale}`;
                }
                if (payload.files !== undefined) {
                    return `chose file(s) "${payload.files}" in ${target}${stale}`;
                }
                return `committed value "${payload.value ?? ""}" in ${target}${stale}`;
            }
            case "submit":
                return `submitted form ${target}`;
            case "select":
                return `selected text "${payload.text}" in ${target}`;
            case "drag": {
                const from = payload.from ? this._describeTarget(payload.from) : "unknown element";
                const coordinates =
                    Number.isFinite(payload.fromX) && Number.isFinite(payload.x)
                        ? ` from (${payload.fromX}, ${payload.fromY}) to (${payload.x}, ${payload.y})`
                        : "";
                return `dragged ${from} onto ${target}${coordinates}`;
            }
            case "clipboard":
                return `${payload.clipboardAction} "${payload.text ?? ""}" on ${target}`;
            case "scroll":
                return `scrolled ${payload.target ? target : "the page"} to position ${payload.position}px`;
            default:
                return `${payload.kind} on ${target}`;
        }
    }

    _describeTarget(target) {
        if (!target) return "unknown element";
        const attributes = [];
        if (target.id) attributes.push(`#${target.id}`);
        if (target.testId) attributes.push(`data-testid="${target.testId}"`);
        if (target.name) attributes.push(`name="${target.name}"`);
        if (target.type) attributes.push(`type="${target.type}"`);
        if (target.role) attributes.push(`role="${target.role}"`);
        if (target.ariaLabel) attributes.push(`aria-label="${target.ariaLabel}"`);
        if (target.placeholder) attributes.push(`placeholder="${target.placeholder}"`);
        if (target.title) attributes.push(`title="${target.title}"`);
        if (target.href) attributes.push(`href="${target.href}"`);

        const head = `<${target.tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>`;
        const text = target.text ? ` text="${target.text}"` : "";
        const selector = target.selector ? ` | selector: ${target.selector}` : "";
        return `${head}${text}${selector}`;
    }
}
