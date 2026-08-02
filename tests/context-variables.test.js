const assert = require("node:assert/strict");
const { test } = require("node:test");

const SPEC_FILE_LEVEL = { environment: "staging" };

let contextVariables;

async function load() {
    contextVariables = contextVariables || (await import("../src/context-variables.js"));
    return contextVariables;
}

test("captureContextVariables reads the locals of the frame that called into the framework", async () => {
    const { captureContextVariables } = await load();

    const captured = (function stepEntry() {
        const orderId = 42;
        const customer = { name: "olha", roles: ["admin", "qa"] };
        assert.equal(orderId, 42);
        assert.ok(customer);
        return captureContextVariables();
    })();

    assert.ok(captured.frames.length > 0, captured.unavailable);
    const variables = Object.assign({}, ...captured.frames.flatMap((frame) => frame.scopes.map((s) => s.variables)));
    assert.equal(variables.orderId, "42");
    assert.equal(variables.customer, '{name: "olha", roles: ["admin", "qa"]}');
});

test("captureContextVariables reports the frames of the test file only", async () => {
    const { captureContextVariables } = await load();

    const captured = captureContextVariables();

    assert.ok(captured.frames.length > 0, captured.unavailable);
    for (const frame of captured.frames) {
        assert.match(frame.location, /context-variables\.test\.js:\d+:\d+$/);
        assert.equal(frame.isSpec, true);
    }
});

test("captureContextVariables explains why a suspended frame yields nothing", async () => {
    const { captureContextVariables } = await load();

    const captured = await (async function afterAnAwait() {
        await new Promise((resolve) => setTimeout(resolve, 1));
        // The caller is suspended at this point, so only this frame is left on the stack and it
        // belongs to a helper the runner drives — nothing of the test script remains to read.
        return captureContextVariables({ cwd: "/nowhere" });
    })();

    assert.deepEqual(captured.frames, []);
    assert.match(captured.unavailable, /no test-script frame was on the stack/);
});

test("formatContextVariables renders frames, scopes and file-level variables", async () => {
    const { formatContextVariables } = await load();

    const report = formatContextVariables({
        frames: [
            {
                functionName: "checkout",
                location: "tests/checkout.spec.js:12:5",
                isSpec: true,
                scopes: [{ type: "local", name: "", variables: { orderId: "42" } }],
            },
        ],
        files: [{ file: "tests/checkout.spec.js", isSpec: true, variables: { BASE_URL: '"https://example.com"' } }],
    });

    assert.match(report, /checkout \(tests\/checkout\.spec\.js:12:5\)/);
    assert.match(report, /local \(variables at the call site\):/);
    assert.match(report, /orderId = 42/);
    assert.match(report, /File-level variables of tests\/checkout\.spec\.js \(spec file\):/);
    assert.match(report, /BASE_URL = "https:\/\/example\.com"/);
});

test("formatContextVariables states why nothing is shown when the capture is empty", async () => {
    const { formatContextVariables } = await load();

    assert.match(formatContextVariables(null), /not available — nothing was captured/);
    assert.match(
        formatContextVariables({ frames: [], files: [], unavailable: "the debugger did not report a paused stack" }),
        /not available — the debugger did not report a paused stack/
    );
});

test("the spec file-level variables are part of the capture", async () => {
    const { captureContextVariables } = await load();

    // Referenced here so V8 keeps it in the context of this function — an unused module variable is
    // stack-allocated and invisible to the debugger.
    assert.equal(SPEC_FILE_LEVEL.environment, "staging");
    const captured = captureContextVariables();

    const fileVariables = Object.assign({}, ...captured.files.map((file) => file.variables));
    const frameVariables = Object.assign(
        {},
        ...captured.frames.flatMap((frame) => frame.scopes.map((scope) => scope.variables))
    );
    assert.equal({ ...fileVariables, ...frameVariables }.SPEC_FILE_LEVEL, '{environment: "staging"}');
});
