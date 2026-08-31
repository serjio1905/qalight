/**
 * Live capture of the variables that surround a QA step.
 *
 * A trace built from an `Error` stack says *where* the run stopped, but not *with what data*: the
 * `orderId`, the fixture user, the value the spec computed two lines above the failing step. Those
 * live in the frame of the `*.spec.js` file that called into the framework, and V8 only exposes
 * them through the inspector protocol, so this module opens a short-lived in-process
 * `node:inspector` session, pauses the VM for the duration of one statement, reads the scope chain
 * of the test-script frames and resumes immediately.
 *
 * Timing is the whole trick: a suspended `async` frame is *not* on the physical stack, so by the
 * time a pause is triggered from deep inside the framework the spec frame is usually gone. The
 * capture therefore has to run at an entry point — the first statement of a step, before the
 * framework awaits anything — which is why `QA` captures eagerly per step and only formats the
 * stored result later (see `QA._captureStepContext`).
 *
 * Nothing here may throw: a diagnostic must never break the run it is diagnosing.
 */

import { Session, url as inspectorUrl } from "node:inspector";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Frames of the framework itself carry no test data. When qalight is consumed from `node_modules`
// the dependency filter already removes them; this covers the checkout-and-run-the-tests case.
// Read from a stack frame rather than `import.meta.url`, because the test runner transpiles these
// sources to CommonJS, where `import.meta` is not available.
const FRAMEWORK_DIR = dirname(fileOfStackFrame(1));

const SPEC_FILE_PATTERN = /\.(spec|test)\.[cm]?[jt]sx?$/i;
// Scope types worth reading: `global` is noise, `script`/`eval` never hold test data.
const READABLE_SCOPE_TYPES = ["local", "block", "catch", "closure", "module"];
const MAX_FRAMES = 5;
const MAX_VARIABLES_PER_SCOPE = 40;
// Guard against a trace that drowns the reason it was printed for.
const MAX_SECTION_LENGTH = 8000;

/**
 * Serializes one scope object into `{ name: renderedValue }`. Runs inside the debuggee via
 * `Runtime.callFunctionOn` with the scope object as `this`, so it must be self-contained ES5-ish
 * source and must never throw: an exception here would lose the whole scope.
 */
const SCOPE_SERIALIZER = `function () {
    var MAX_VALUE_LENGTH = 200;
    var MAX_ITEMS = 10;
    var describe = function (value, depth) {
        if (value === null) return "null";
        var type = typeof value;
        if (type === "undefined") return "undefined";
        if (type === "function") return null;
        if (type === "string") {
            var text = value.length > MAX_VALUE_LENGTH ? value.slice(0, MAX_VALUE_LENGTH) + "…" : value;
            return JSON.stringify(text);
        }
        if (type !== "object") return String(value);
        // Imported modules: a namespace object, or the interop object the transpiler builds for it.
        if (value.__esModule === true) return null;
        if (Object.prototype.toString.call(value) === "[object Module]") return null;
        if (value instanceof Error) return "[" + value.name + ": " + value.message + "]";
        if (typeof value.then === "function") return "[Promise]";
        if (value instanceof Date) return "[Date " + value.toISOString() + "]";
        if (Array.isArray(value)) {
            if (depth >= 2) return "[Array(" + value.length + ")]";
            var items = [];
            for (var i = 0; i < value.length && i < MAX_ITEMS; i++) {
                var item = describe(value[i], depth + 1);
                items.push(item === null ? (typeof value[i] === "function" ? "[Function]" : "[Object]") : item);
            }
            if (value.length > MAX_ITEMS) items.push("… " + (value.length - MAX_ITEMS) + " more");
            return "[" + items.join(", ") + "]";
        }
        // Class instances (a Playwright Page, a Locator, the QA object itself) would serialize into
        // pages of internals — the type name is all a reader needs.
        var constructorName = value.constructor && value.constructor.name;
        if (constructorName && constructorName !== "Object") return "[" + constructorName + "]";
        if (depth >= 2) return "[Object]";
        var keys = Object.keys(value);
        var parts = [];
        for (var k = 0; k < keys.length && k < MAX_ITEMS; k++) {
            var rendered;
            try {
                rendered = describe(value[keys[k]], depth + 1);
            } catch (error) {
                rendered = "[unreadable]";
            }
            if (rendered !== null) parts.push(keys[k] + ": " + rendered);
        }
        if (keys.length > MAX_ITEMS) parts.push("…");
        // Everything the object held was skipped — an imported module, a bag of helpers. Rendering
        // it as "{}" would claim it is empty, so it is dropped instead.
        if (parts.length === 0 && keys.length > 0) return null;
        return "{" + parts.join(", ") + "}";
    };
    var result = {};
    var names = Object.keys(this);
    for (var n = 0; n < names.length; n++) {
        var name = names[n];
        var value;
        try {
            value = describe(this[name], 0);
        } catch (error) {
            value = "[unreadable]";
        }
        // Functions are skipped: imported helpers and callbacks say nothing about the test data.
        if (value !== null) result[name] = value;
    }
    return JSON.stringify(result);
}`;

/**
 * @typedef {Object} ContextScope
 * @property {string} type - inspector scope type (`local`, `closure`, `module`, ...)
 * @property {string} name
 * @property {Record<string, string>} variables - variable name to rendered value
 *
 * @typedef {Object} ContextFrame
 * @property {string} functionName
 * @property {string} location - `file:line:column`, relative to the working directory
 * @property {boolean} isSpec - the frame belongs to a `*.spec.js` / `*.test.js` file
 * @property {ContextScope[]} scopes - call-site scopes only; file-level ones are merged into `files`
 *
 * @typedef {Object} ContextFile
 * @property {string} file - path relative to the working directory
 * @property {boolean} isSpec
 * @property {Record<string, string>} variables - module-level variables of that file
 *
 * @typedef {Object} ContextVariables
 * @property {ContextFrame[]} frames
 * @property {ContextFile[]} files
 * @property {string} [unavailable] - why nothing could be captured
 */

/**
 * Reads the live variables of the test-script frames currently on the stack.
 *
 * Must be called from the synchronous entry of a step: once the framework has awaited anything, the
 * spec frame is suspended and V8 no longer exposes its scopes.
 *
 * @param {Object} [options]
 * @param {string} [options.cwd] - only frames under this directory are read
 * @param {number} [options.maxFrames]
 * @returns {ContextVariables}
 */
export function captureContextVariables({ cwd = safeCwd(), maxFrames = MAX_FRAMES } = {}) {
    // `Debugger.pause` below stops the one V8 debugger the whole process shares, so under
    // `--inspect` the attached client (VS Code, Chrome DevTools) reports every capture as a stop
    // with no breakpoint, on the `noop()` statement this module pauses on. A debugging session is
    // worth more than the variables, so the capture stands down while one can be attached —
    // `inspector.url()` is only defined once the inspector has been opened.
    if (inspectorUrl() !== undefined) {
        return { frames: [], files: [], unavailable: "an external debugger is attached (running under --inspect)" };
    }

    // The inspector reports positions in the code V8 actually runs, which for a transpiled spec is
    // not the code the user wrote. An `Error` stack taken here covers the same frames in the same
    // order and is source-mapped by the test runner, so it supplies the readable positions.
    const stackLocations = readStackLocations(cwd);
    let session;
    try {
        session = new Session();
        session.connect();
    } catch (error) {
        return { frames: [], files: [], unavailable: `the inspector session could not be opened (${error.message})` };
    }

    // `Debugger.enable` replays `scriptParsed` for already-loaded scripts; without that map the
    // paused call frames of ES modules come back with an empty `url`.
    const scriptUrls = new Map();
    const onScriptParsed = ({ params }) => scriptUrls.set(params.scriptId, params.url);
    let callFrames = null;
    const onPaused = ({ params }) => {
        callFrames = params.callFrames;
    };

    try {
        session.on("Debugger.scriptParsed", onScriptParsed);
        session.on("Debugger.paused", onPaused);
        session.post("Debugger.enable");
        session.post("Debugger.pause");
        // `Debugger.pause` stops V8 on the next statement executed. This is that statement: the
        // `Debugger.paused` notification is delivered synchronously to the in-process session, so
        // `callFrames` is populated once this line returns.
        noop();

        if (!callFrames) {
            return { frames: [], files: [], unavailable: "the debugger did not report a paused stack" };
        }

        const frames = [];
        // A file's module scope is the same data for every one of its frames, and V8 exposes a
        // different subset of it per frame, so the scopes are merged per file instead of repeated.
        const fileVariables = new Map();
        for (const callFrame of callFrames) {
            if (frames.length >= maxFrames) break;
            const file = resolveFrameFile(callFrame, scriptUrls);
            if (!isTestContextFile(file, cwd)) continue;
            const mappedLocation = stackLocations[frames.length];
            frames.push(
                readFrame(
                    session,
                    callFrame,
                    file,
                    cwd,
                    fileVariables,
                    mappedLocation?.file === file ? mappedLocation : null
                )
            );
        }

        if (frames.length === 0) {
            return {
                frames: [],
                files: [],
                unavailable:
                    "no test-script frame was on the stack (the step was reached after an await, so the spec frame is suspended)",
            };
        }
        return { frames, files: [...fileVariables.values()] };
    } catch (error) {
        return { frames: [], files: [], unavailable: `the variables could not be read (${error.message})` };
    } finally {
        try {
            session.post("Debugger.resume");
        } catch (error) {}
        try {
            session.off("Debugger.paused", onPaused);
            session.off("Debugger.scriptParsed", onScriptParsed);
            session.post("Debugger.disable");
            session.disconnect();
        } catch (error) {}
    }
}

/**
 * Renders a capture for the console/report.
 * @param {ContextVariables | null} context
 * @param {string} [title]
 * @returns {string}
 */
export function formatContextVariables(context, title = "Test context variables") {
    if (!context || !context.frames || context.frames.length === 0) {
        return `${title}: not available — ${context?.unavailable || "nothing was captured"}.`;
    }

    const lines = [`${title} (values live at the test-script line that started this step):`];
    for (const frame of context.frames) {
        lines.push(`  ${frame.functionName} (${frame.location})${frame.isSpec ? "  <- spec file" : ""}`);
        if (frame.scopes.length === 0) {
            lines.push("    (no local variables in this frame)");
            continue;
        }
        for (const scope of frame.scopes) {
            lines.push(`    ${describeScope(scope)}:`);
            lines.push(...renderVariables(scope.variables));
        }
    }
    for (const file of context.files || []) {
        lines.push(`  File-level variables of ${file.file}${file.isSpec ? " (spec file)" : ""}:`);
        lines.push(...renderVariables(file.variables));
    }

    const section = lines.join("\n");
    return section.length > MAX_SECTION_LENGTH
        ? `${section.slice(0, MAX_SECTION_LENGTH)}\n… test context truncated`
        : section;
}

/**
 * @param {Record<string, string>} variables
 * @returns {string[]}
 */
function renderVariables(variables) {
    const entries = Object.entries(variables);
    const lines = entries.slice(0, MAX_VARIABLES_PER_SCOPE).map(([name, value]) => `      ${name} = ${value}`);
    if (entries.length > MAX_VARIABLES_PER_SCOPE) {
        lines.push(`      … ${entries.length - MAX_VARIABLES_PER_SCOPE} more variable(s)`);
    }
    return lines;
}

/**
 * @param {ContextScope} scope
 * @returns {string}
 */
function describeScope(scope) {
    if (scope.type === "local") return "local (variables at the call site)";
    if (scope.type === "closure") return `closure${scope.name ? ` of ${scope.name}` : ""}`;
    return scope.type;
}

/**
 * @param {Session} session
 * @param {Object} callFrame - inspector `Debugger.CallFrame`
 * @param {string} file
 * @param {string} cwd
 * @param {Map<string, ContextFile>} fileVariables - collects the module scopes, merged per file
 * @param {{ line: number, column: number } | null} mappedLocation - source-mapped position of this frame
 * @returns {ContextFrame}
 */
function readFrame(session, callFrame, file, cwd, fileVariables, mappedLocation) {
    const relativeFile = relativeToCwd(file, cwd);
    const isSpec = SPEC_FILE_PATTERN.test(file);
    const scopes = [];
    for (const scope of callFrame.scopeChain) {
        if (!READABLE_SCOPE_TYPES.includes(scope.type)) continue;
        const objectId = scope.object?.objectId;
        if (!objectId) continue;
        const variables = readScopeVariables(session, objectId);
        if (!variables || Object.keys(variables).length === 0) continue;
        if (scope.type === "module") {
            const collected = fileVariables.get(relativeFile) || { file: relativeFile, isSpec, variables: {} };
            Object.assign(collected.variables, variables);
            fileVariables.set(relativeFile, collected);
            continue;
        }
        scopes.push({ type: scope.type, name: scope.name || "", variables });
    }

    const line = mappedLocation ? mappedLocation.line : callFrame.location.lineNumber + 1;
    const column = mappedLocation ? mappedLocation.column : (callFrame.location.columnNumber ?? 0) + 1;
    return {
        functionName: callFrame.functionName || "<anonymous>",
        location: `${relativeFile}:${line}:${column}`,
        isSpec,
        scopes,
    };
}

/**
 * @param {Session} session
 * @param {string} objectId
 * @returns {Record<string, string> | null}
 */
function readScopeVariables(session, objectId) {
    let variables = null;
    // The response of an in-process session is delivered synchronously while the VM is paused.
    session.post(
        "Runtime.callFunctionOn",
        { objectId, functionDeclaration: SCOPE_SERIALIZER, returnByValue: true, silent: true },
        (error, response) => {
            if (error || response?.exceptionDetails) return;
            try {
                variables = JSON.parse(response.result.value);
            } catch (parseError) {}
        }
    );
    return variables;
}

/**
 * @param {Object} callFrame - inspector `Debugger.CallFrame`
 * @param {Map<string, string>} scriptUrls
 * @returns {string} filesystem path of the frame, or "" when it is not a file
 */
function resolveFrameFile(callFrame, scriptUrls) {
    const url = callFrame.url || scriptUrls.get(callFrame.location.scriptId) || "";
    return url.startsWith("file://") ? toFilePath(url) : "";
}

/**
 * Test context is the project's own code: the spec files and whatever they call. Dependencies and
 * the framework's own sources are not.
 * @param {string} file
 * @param {string} cwd
 * @returns {boolean}
 */
function isTestContextFile(file, cwd) {
    if (!file) return false;
    if (file.includes("/node_modules/")) return false;
    if (cwd && !file.startsWith(`${cwd}/`)) return false;
    // A spec is test context wherever it is kept — including next to the framework sources.
    if (SPEC_FILE_PATTERN.test(file)) return true;
    if (FRAMEWORK_DIR && file.startsWith(`${FRAMEWORK_DIR}/`)) return false;
    return true;
}

/**
 * @param {string} file
 * @param {string} cwd
 * @returns {string}
 */
function relativeToCwd(file, cwd) {
    if (!cwd) return file;
    const relativePath = normalizePath(relative(cwd, file));
    return relativePath && !relativePath.startsWith("..") ? relativePath : file;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePath(value) {
    return String(value).replace(/\\/g, "/");
}

/**
 * Positions of the test-script frames on the current stack, innermost first, as the test runner
 * reports them (source-mapped when the specs are transpiled).
 *
 * Only the synchronous part of the stack is read: `at async ...` entries describe frames that are
 * suspended and therefore absent from the paused call frames these positions are matched against.
 *
 * @param {string} cwd
 * @returns {Array<{ file: string, line: number, column: number }>}
 */
function readStackLocations(cwd) {
    const previousLimit = Error.stackTraceLimit;
    let stack = "";
    try {
        Error.stackTraceLimit = 30;
        stack = new Error().stack || "";
    } catch (error) {
        return [];
    } finally {
        Error.stackTraceLimit = previousLimit;
    }

    const locations = [];
    for (const line of stack.split("\n").slice(1)) {
        if (/^\s*at\s+async\s/.test(line)) break;
        const match = line.match(/\(?([^()\s]+):(\d+):(\d+)\)?\s*$/);
        if (!match) continue;
        const file = toFilePath(match[1]);
        if (!isTestContextFile(file, cwd)) continue;
        locations.push({ file, line: Number(match[2]), column: Number(match[3]) });
    }
    return locations;
}

/**
 * Path of the file that owns the given stack frame (0 = this function's caller's frame line).
 * @param {number} depth
 * @returns {string} normalized path, or "" when the frame is not a file
 */
function fileOfStackFrame(depth) {
    try {
        const line = (new Error().stack || "").split("\n")[depth] || "";
        const match = line.match(/\(?([^()\s]+):\d+:\d+\)?\s*$/);
        return match ? toFilePath(match[1]) : "";
    } catch (error) {
        return "";
    }
}

/**
 * @param {string} value - a path or a `file://` URL
 * @returns {string} normalized filesystem path, or "" when it is not a file
 */
function toFilePath(value) {
    if (!value) return "";
    if (!value.startsWith("file://")) return value.startsWith("node:") ? "" : normalizePath(value);
    try {
        return normalizePath(fileURLToPath(value));
    } catch (error) {
        return "";
    }
}

/**
 * @returns {string}
 */
function safeCwd() {
    try {
        return normalizePath(process.cwd());
    } catch (error) {
        return "";
    }
}

/**
 * The statement `Debugger.pause` stops on. Declared once so the capture allocates nothing extra.
 * @returns {void}
 */
function noop() {}
