const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

function loadMismatchFormatter() {
    const source = readFileSync(new URL("../src/expect.js", `file://${__filename}`), "utf8")
        .replace('import { expect as chaiExpect } from "chai";', "const chaiExpect = null;")
        .replace("export function buildEqualMismatchDetails", "function buildEqualMismatchDetails")
        .split("export class ExpectFramework")[0];
    const context = {};
    vm.createContext(context);
    vm.runInContext(`${source}\nthis.buildEqualMismatchDetails = buildEqualMismatchDetails;`, context);
    return context.buildEqualMismatchDetails;
}

const buildEqualMismatchDetails = loadMismatchFormatter();

test("buildEqualMismatchDetails keeps short mismatch messages unchanged", () => {
    const details = buildEqualMismatchDetails("actual", "expected");

    assert.equal(details.message, "Failed to check if actual is equal to expected");
    assert.equal(details.traceDetails, "");
});

test("buildEqualMismatchDetails summarizes long mismatches and keeps full values trace-only", () => {
    const actual = `${"a".repeat(210)}actual-tail`;
    const expected = `${"a".repeat(210)}expected-tail`;
    const details = buildEqualMismatchDetails(actual, expected);

    assert.match(details.message, /Actual length: 221 chars; expected length: 223 chars/);
    assert.match(details.message, /Mismatch: \d+ of 223 chars by position \(\d+\.\d%\)/);
    assert.match(details.message, /First mismatch at index 210/);
    assert.match(details.message, /Show trace in console/);
    assert.doesNotMatch(details.message, /actual-tail/);
    assert.doesNotMatch(details.message, /expected-tail/);

    assert.match(details.traceDetails, /Actual:/);
    assert.match(details.traceDetails, /<<<actual>>>/);
    assert.match(details.traceDetails, /Expected:/);
    assert.match(details.traceDetails, /<<<expected>>>/);
});
