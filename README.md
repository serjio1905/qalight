# qalight

`qalight` is a stateful Playwright helper for UI tests. It wraps a Playwright
`Page`, finds visible elements by semantic identifiers, performs actions, and
provides assertions, hints, screenshots, API calls, and manual safe-mode
recovery.

The main export is the `QA` class:

```js
import { QA } from "qalight";

const qa = new QA(page, {
    timeout: 200,
    withHint: false,
    withHighlight: false,
    safeMode: false,
});

await qa.open("https://example.com");
await qa.get("input", "Email").fill("user@example.com");
await qa.get("button", "Sign in").click();
await qa.get("h1").shouldHaveText("Dashboard");
```

## Exports

`index.js` exports:

- `QA`: the browser/UI automation class.
- `QAError`: errors raised by QA element selection and restrictions.
- `QAReporter`: optional Playwright test attachment logger.
- `QAAPI`: the HTTP helper exposed as `qa.api`.
- `ExpectFramework`: the value assertion helper exposed as `qa.expect`.

`QAError` is an `Error` subclass. Its constructor is `new QAError(message)`;
the message describes the invalid tag, missing element, or failed restriction.

`QA.reporter` is a static `QAReporter | null` reference. It is created by the
constructor when `testInfo` is supplied and is shared by all QA instances.

## Important execution model

`QA` is stateful. A `QA` instance owns one Playwright `Page`, one current
restriction, and a selector queue.

1. Selector methods such as `get()` and `getParent()` append operations to the
   queue and return the same `QA` instance.
2. A terminal method such as `click()`, `fill()`, `getText()`, or an assertion
   executes the queued selectors.
3. After execution, the queue is cleared and the selected element becomes
   `currentElement`.
4. The current element is not a Playwright locator exposed to callers. Use QA
   methods for actions and reads; use `qa.page` only when direct Playwright is
   needed.

Most action and assertion methods return `qa`, so this is valid:

```js
await qa.get("form", "login").get("input", "Email").fill("user@example.com");
```

Methods that return data (`getText`, `getValue`, `count`, geometry methods,
`getStyles`, and `indexOf`) return that data instead of `qa`. `waitFor()` also
returns `undefined`, so it is normally used as a standalone awaited call.

## Creating a QA instance

### `new QA(page, options)`

Creates a QA controller for a Playwright `Page`.

Parameters:

- `page` (`Page`): the Playwright page controlled by this instance.
- `options` (`object`): configuration. The source has a default options object
  only when the argument is omitted; when passing a partial object, explicitly
  provide the values the test needs.

Supported options:

- `timeout` (`number`, default `1000` when using the constructor defaults):
  settle delay before selector execution and default highlight duration.
- `waiter` (`Function | null`): optional async callback executed before each
  queued selector is resolved. TDS-v2-qa uses it to wait for its loader to
  disappear.
- `withHighlight` (`boolean`): highlight the resolved element during actions.
- `withHint` (`boolean`): show the in-page status bar and manual-recovery
  buttons.
- `withSnapshots` (`boolean`): attach screenshots for reporter hint messages.
- `restrictionMapping` (`object`): maps short string identifiers to one or
  more full identifiers.
- `testInfo` (`TestInfo | null`): Playwright test information. When provided,
  the constructor creates the static `QA.reporter` for this page/test.
- `safeMode` (`boolean`): on an action/assertion failure, pause for manual
  recovery when true; abort the process when false.
- `apiResponseCallback` (`Function | null`): callback for JSON API responses
  observed by `qa.api.network`.
- `consoleLoggerOptions` (`object`): booleans for forwarding page console
  messages: `warn`, `info`, `error`, `success`, and `log`.

Recommended automation setting: use `safeMode: false` for unattended CI or AI
runs. `safeMode: true` requires `withHint: true` if a failed action must be
continued manually; otherwise the pause has no visible Continue/Stop controls.

TDS-v2-qa creates QA in `tests/helpers/actions.js` and passes the Playwright
`testInfo` from `tests/fixtures/browser-size-fixture.js`:

```js
const qa = new QA(page, {
    timeout: 200,
    waiter: async () => waitForLoaderDisappear(page),
    withHighlight: SETTINGS.ENABLE_HIGHLIGHT,
    withHint: SETTINGS.ENABLE_HINT,
    withSnapshots: SETTINGS.ENABLE_SNAPSHOTS,
    restrictionMapping,
    testInfo,
    safeMode: process.env.QA_SAFE_MODE !== "false",
});
```

## Selector identifiers

### Valid tags

`get()` accepts keys from `QA.TAGS`, including `input`, `button`, `a`, `textarea`,
`select`, `div`, `span`, `label`, `table`, `tr`, `td`, `th`, `ul`, `li`, `h1`
through `h6`, `form`, `i`, `body`, and related HTML tags. The argument is a
semantic tag key, not an arbitrary CSS selector.

### Identifier forms

`identifiers` and `exceptIdentifiers` can be:

- a string, for example `"Email"`;
- an object, for example `{ placeholder: "Email" }`;
- an array mixing strings and objects, for example `["Save", { class: "primary" }]`;
- an empty value, meaning no identifier filter.

String identifiers are scored against prepared element data such as text,
value, HTML, class, id, name, placeholder, title, label, and related DOM data.
Object identifiers select by a named attribute and are also scored by partial
match. A string or object can match a substring; the highest-weight visible
candidate wins. `exceptIdentifiers` subtracts matching candidates.

Examples:

```js
await qa.get("button", "Save").click();
await qa.get("input", { placeholder: "Search" }).fill("Playwright");
await qa.get("tr", ["Order 123", { class: "table-row" }]).click();
await qa.get("button", ["Save", { class: "danger" }], 0, "disabled").click();
```

`index` selects the candidate after matching. `0` is the first candidate;
`-1` is the last candidate. Parent candidates are removed when a more deeply
nested matched candidate exists, which usually makes a row/cell match more
useful than its containing table.

## QA class and instance API

The following are the supported public methods of `QA`. Unless stated
otherwise, every async method returns a `Promise`.

### Class-level methods

#### `QA.setReporter(page, testInfo)`

Parameters:

- `page` (`Page`): page used for screenshots.
- `testInfo` (`TestInfo`): Playwright test information used for attachments.

Returns: `void`.

Sets the static `QA.reporter`. Usually unnecessary because the constructor does
the same when `options.testInfo` is supplied. Because the reporter is static,
the most recently configured QA instance replaces the previous reporter.

### Page and lifecycle

#### `qa.setRestrictionMapping(mapping)`

Parameters:

- `mapping` (`object`): map from reusable identifier names to an identifier or
  array of identifiers.

Returns: `qa`.

Replaces the identifier mapping used by future `get()` and
`setRestriction()` calls.

#### `qa.open(url, ...pathParts)`

Parameters:

- `url` (`string`): URL to open. If empty, brings the current page to front.
- `pathParts` (`string[]`): optional path segments appended with `/`.

Returns: `Promise<qa>`.

Navigates the page. Navigation resets `parentElement`, `currentElement`,
`matchedElements`, and the selector queue.

#### `qa.openTab(url, incognito = false)`

Parameters:

- `url` (`string`): URL for the new page.
- `incognito` (`boolean`): when true, creates a new browser context; when false,
  reuses the current context.

Returns: `Promise<QA>` for the new page.

Creates and returns an independent QA instance. It copies the original
constructor options but has its own page and selector state.

#### `qa.getTab(index = 0)`

Parameters:

- `index` (`number`): index in `page.context().pages()`.

Returns: `Promise<QA>` for the selected page.

Creates a QA wrapper around an existing page in the current browser context.

#### `qa.refreshPage()`

Parameters: none.

Returns: `Promise<qa>`.

Reloads the page, clears current selection/restriction queue state, and waits
approximately two seconds.

### Selecting elements and restrictions

#### `qa.get(tag, identifiers = [], index = 0, exceptIdentifiers = [], aroundDepth = 0)`

Parameters:

- `tag` (`string`): key from `QA.TAGS`.
- `identifiers` (`string | object | Array`): positive semantic identifiers.
- `index` (`number`): matching candidate index; negative values count from the
  end.
- `exceptIdentifiers` (`string | object | Array`): identifiers that lower or
  exclude candidates.
- `aroundDepth` (`number`): retry search depth around the current element; `0`
  disables this fallback.

Returns: `qa`.

Appends a lazy selector step. It does not query the page until a terminal
method executes the queue.

#### `qa.getAround(tag, identifiers = [], index = 0, exceptIdentifiers = [], aroundDepth = 5)`

Parameters: the same parameters as `get()`; `aroundDepth` defaults to `5`.

Returns: `qa`.

Intended as a convenience for searching around the current element. The
current implementation forwards the `index` and `exceptIdentifiers` arguments
inconsistently; prefer `get(..., aroundDepth)` or verify this method before
using it in a new integration.

#### `qa.getParent(index = 0)`

Parameters:

- `index` (`number`): parent level; `0` is the immediate parent, and negative
  values use Playwright's `nth()` behavior for matched parents.

Returns: `qa`.

Appends a step that moves from the current matched element to an ancestor. It
is commonly used between two `get()` calls:

```js
await qa.get("input", "Email").getParent().get("button", "Clear").click();
```

#### `qa.setRestriction(tag, identifiers = [], index = 0, exceptIdentifiers = [])`

Parameters: the same selector parameters as `get()`, except there is no
`aroundDepth` parameter.

Returns: `qa`.

Sets the root element for later selector queues. Every subsequent `get()` is
resolved inside this element until the restriction is changed or cleared.

#### `qa.restrict()`

Parameters: none.

Returns: `Promise<qa>`.

Executes the current queue and makes the selected element the restriction root.
Throws `QAError` if no element is selected.

#### `qa.clearRestrinction()`

Parameters: none.

Returns: `qa`.

Clears the current restriction. The method name contains the existing spelling
`Restrinction` and must be called exactly that way.

Recommended restriction lifecycle:

```js
qa.clearRestrinction();
qa.setRestriction("div", "modal");
await qa.get("input", "Email").fill("user@example.com");
qa.clearRestrinction();
```

### Browser actions

#### `qa.click(double = false)`

Parameters:

- `double` (`boolean`): use `dblclick()` when true; otherwise use `click()`.

Returns: `Promise<qa>`.

Resolves the queued element and clicks it. On failure, pauses in safe mode or
aborts in normal mode.

#### `qa.check(value = true)`

Parameters:

- `value` (`boolean`): `true` calls `check({ force: true })`; `false` calls
  `uncheck({ force: true })`.

Returns: `Promise<qa>`.

Changes a checkbox/radio state. A Playwright "did not change its state" error is
ignored because the requested state may already be set.

#### `qa.fill(text)`

Parameters:

- `text` (`string | number`): value to enter. Numbers are converted to strings.

Returns: `Promise<qa>`.

Fills the selected element. For inputs and textareas it verifies the resulting
value and falls back to character-by-character typing if the browser only
accepted part of the value.

#### `qa.blur()`

Parameters: none.

Returns: `Promise<qa>`.

Resolves the selection, focuses it, then calls `document.activeElement.blur()`.

#### `qa.focus()`

Parameters: none.

Returns: `Promise<qa>`.

Attempts to focus after resolving the selection. The current implementation
calls `document.activeElement.focus()` rather than the selected locator's
`focus()`, so do not rely on it to move focus to a different element.

#### `qa.select(value)`

Parameters:

- `value` (`string | string[] | object`): value accepted by Playwright
  `locator.selectOption()`.

Returns: `Promise<qa>`.

Selects an option in the selected `<select>` element.

#### `qa.setDateTime(yyyy, MM, dd, HH, mm)`

Parameters: numeric year, month, day, hour, and minute.

Returns: `Promise<qa>`.

Fills an ISO date value in `YYYY-MM-DD` form. If the hour/minute are valid, it
appends `T HH:MM` for a datetime input.

#### `qa.setMonth(yyyy, month)`

Parameters:

- `yyyy` (`number | string`): four-digit year.
- `month` (`number | string`): month number, padded to two digits.

Returns: `Promise<qa>`.

Fills an `<input type="month">` with `YYYY-MM`.

#### `qa.pressEnter()`

Parameters: none.

Returns: `Promise<qa>`.

Presses `Enter` on the selected locator.

#### `qa.drag(x = 0, y = 0, percentage = false)`

Parameters:

- `x`, `y` (`number`): horizontal and vertical movement.
- `percentage` (`boolean`): when true, interpret each value as a percentage of
  the selected element's width/height; otherwise interpret pixels.

Returns: `Promise<qa>`.

Drags from the center of the selected element using mouse events. Coordinates
must be finite numbers and the element must have a bounding box.

#### `qa.scroll()`

Parameters: none.

Returns: `Promise<qa>`.

Scrolls the selected element into view, including its scrollable ancestors.

#### `qa.scrollToCurrentElement()`

Parameters: none.

Returns: `Promise<qa>`.

Alias-like explicit form of `scroll()` for the current queued element.

#### `qa.scrollTo(tag, text, attrs = {}, direction = "vertical")`

Parameters:

- `tag` (`string`): tag used to build the target locator inside the current
  element.
- `text` (`string`): target text passed as Playwright `hasText`.
- `attrs` (`object`): optional attributes; values are matched with CSS `*=`.
- `direction` (`"vertical" | "horizontal"`): scroll axis.

Returns: `Promise<qa>`.

Scrolls the current container in steps until a matching descendant is visible.
The method requires a current selected container and throws for an invalid
direction.

#### `qa.highlight()`

Parameters: none.

Returns: `Promise<qa>`.

Highlights the current selected element when `withHighlight` is enabled. If no
element is selected, it simply returns `qa`.

### Waiting and reading values

#### `qa.waitFor(timeout = qa.DEFAULT_WAIT_TIME, hint)`

Parameters:

- `timeout` (`number`): milliseconds to wait.
- `hint` (`string | falsy`): optional in-page hint while waiting.

Returns: `Promise<void>`.

Waits with Playwright `page.waitForTimeout()`. Errors are swallowed. This is a
fixed delay, not a condition wait; use `qa.waiter` or direct Playwright waits
for application conditions.

#### `qa.getStyles()`

Parameters: none.

Returns: `Promise<Record<string, string>>`.

Returns all computed CSS properties of the selected element.

#### `qa.indexOf(searchWord = "")`

Parameters:

- `searchWord` (`string`): optional text to find among the deepest matched
  candidates.

Returns: `Promise<number>`; `-1` when no candidate matches the search text or
HTML.

Returns the index of the deepest matching candidate, first searching text and
then HTML.

#### `qa.count()`

Parameters: none.

Returns: `Promise<number>`.

Executes the queue in checking mode and returns the number of matched elements.
It retries less aggressively than a normal action and does not abort merely
because the element is absent.

#### `qa.getAttribute(attribute, showHint = true)`

Parameters:

- `attribute` (`string`): prepared element-data property, such as `text`,
  `value`, `html`, `class`, `id`, `label`, or `disabled`.
- `showHint` (`boolean`): show the read result in the in-page hint.

Returns: `Promise<unknown>`; `undefined` when there is no current element or
the property is not present.

Reads the selected element's prepared data. It does not call
`locator.getAttribute()` directly.

#### `qa.getText(showHint = true)`

Parameters: `showHint` (`boolean`).

Returns: `Promise<unknown>`.

Shortcut for `getAttribute("text", showHint)`.

#### `qa.getValue(showHint = true)`

Parameters: `showHint` (`boolean`).

Returns: `Promise<unknown>`.

Shortcut for `getAttribute("value", showHint)`.

#### `qa.getHeight()` / `qa.getWidth()` / `qa.getX()` / `qa.getY()`

Parameters: none.

Returns: `Promise<number>`.

Returns the corresponding value from the selected element's Playwright
bounding box. `getX()` and `getY()` are viewport coordinates.

#### `qa.getCenterX()` / `qa.getCenterY()`

Parameters: none.

Returns: `Promise<number>`.

Returns the center coordinate calculated from the selected element's bounding
box.

### UI assertions

All methods in this section return `Promise<boolean>`. A passing assertion
returns `true`. A failing assertion returns `false` when `throwError` is false;
when `throwError` is true, safe mode pauses and normal mode aborts the process.

#### `qa.shouldContainText(text, throwError = true)`

Checks that prepared text/value/HTML contains `text`.

#### `qa.shouldNotContainText(text, throwError = true)`

Checks that prepared text/value/HTML does not contain `text`.

#### `qa.shouldHaveText(text, throwError = true)`

Normalizes whitespace and common HTML entities, then checks exact text equality.

#### `qa.shouldContainHtml(html, throwError = true)`

Checks that prepared outer HTML contains `html`.

#### `qa.shouldNotContainHtml(html, throwError = true)`

Checks that prepared outer HTML does not contain `html`.

#### `qa.shouldHaveValue(value, throwError = true)`

Normalizes whitespace/entities and checks exact input value equality.

#### `qa.shouldContainValue(value, throwError = true)`

Checks that the prepared input value contains `value`.

#### `qa.shouldExist(throwError = true)`

Checks that at least one matching element exists and the first match is visible.
With `throwError = false`, absence returns `false` without pausing or aborting.

#### `qa.shouldNotExist(throwError = true)`

Checks that no matching element exists. With `throwError = false`, a present
element returns `false` without pausing or aborting.

#### `qa.shouldBeChecked(value = true, throwError = true)`

Checks checkbox/radio state against `value`.

#### `qa.shouldBeEnabled(throwError = true)`

Checks that the selected element is not disabled.

#### `qa.shouldBeDisabled(throwError = true)`

Checks that the selected element is disabled.

#### `qa.shouldContainClass(className, throwError = true)`

Checks that prepared class data contains `className`.

#### `qa.shouldNotContainClass(className, throwError = true)`

Checks that prepared class data does not contain `className`.

### Manual recovery, clipboard, and diagnostics

#### `qa.expect`

Returns: `ExpectFramework`.

Provides value assertions that do not require a selected element. See the
`qa.expect` section below.

#### `qa.pause(text = "Paused", buttons, type = "warning", traceDetails = "")`

Parameters:

- `text` (`string`): message shown in the hint.
- `buttons` (`Array<{text, onClick}>`): custom buttons. Omitting it creates
  Continue, Stop, and Show trace in console buttons.
- `type` (`"info" | "success" | "warning" | "error"`): hint color/type.
- `traceDetails` (`string`): extra text appended only to the generated trace.

Returns: `Promise<void>` that resolves when `continue()` is called.

Captures a Node-side execution trace, shows the hint, and suspends execution.
This is useful for safe/manual test runs. Custom buttons replace the defaults.

#### `qa.continue()`

Parameters: none.

Returns: `void`.

Resolves the currently active pause and hides the hint. It does nothing when no
pause is active.

#### `qa.showTrace()`

Parameters: none.

Returns: `Promise<void>`.

Prints the pause-time trace with regular `console.log`, mirrors it into the
browser console, and records it through `QA.reporter` when configured. The
trace includes the test file/line when `testInfo` was provided.

#### `qa.abort(message = "Aborted by user.")`

Parameters:

- `message` (`string`): message shown before aborting.

Returns: `Promise<never>` in Node because it calls `process.exit(1)`; the
browser-only fallback intentionally never resolves.

Closes the active pause, shows an error hint briefly, then terminates the test
process. Use `safeMode: false` for automatic failure termination.

#### `qa.copy(text)`

Parameters:

- `text` (`string`): text written to `navigator.clipboard`.

Returns: `Promise<void>`.

Copies text in the browser context and displays a success hint.

#### `qa.paste()`

Parameters: none.

Returns: `Promise<string | null>`.

Reads browser clipboard text. It uses the modern Clipboard API first and a
legacy `window.clipboardData` fallback. On failure it shows an error hint and
returns `null`.

## `qa.expect`: value assertions

`qa.expect` is an `ExpectFramework` created for the QA instance. Each method
returns `Promise<boolean>` and accepts `throwError = true` as its final
parameter. A failure returns `false` when `throwError` is false; otherwise it
uses the parent QA instance's safe-mode behavior.

Methods:

- `equal(actualValue, expectedValue, throwError = true)`: strict equality.
- `notEqual(actualValue, expectedValue, throwError = true)`: strict inequality.
- `contain(actualValue, expectedValue, throwError = true)`: value contains the expected value.
- `notContain(actualValue, expectedValue, throwError = true)`: value does not contain the expected value.
- `greaterThan(actualValue, expectedValue, throwError = true)`: `actualValue > expectedValue`.
- `lessThan(actualValue, expectedValue, throwError = true)`: `actualValue < expectedValue`.
- `greaterThanOrEqual(actualValue, expectedValue, throwError = true)`: `actualValue >= expectedValue`.
- `lessThanOrEqual(actualValue, expectedValue, throwError = true)`: `actualValue <= expectedValue`.
- `isBetween(actualValue, [min, max], throwError = true)`: Chai `between` assertion.
- `isNotBetween(actualValue, [min, max], throwError = true)`: inverse of `isBetween`.
- `isNotEmpty(actualValue, throwError = true)`: value is not empty.
- `isEmpty(actualValue, throwError = true)`: value is empty.
- `isNull(actualValue, throwError = true)`: value is `null`.
- `isNotUndefined(actualValue, throwError = true)`: value is not `undefined`.
- `notNullOrEmpty(actualValue, throwError = true)`: checks that value is not null. The current implementation does not independently check empty values.
- `nullOrEmpty(actualValue, throwError = true)`: checks that value is null. The current implementation does not independently check empty values.

Example:

```js
const amount = await qa.get("td", "Total").getText();
await qa.expect.equal(Number(amount), 4000);
await qa.expect.greaterThan(Number(amount), 0);
const optional = await qa.get("div", "Optional").shouldExist(false);
await qa.expect.equal(optional, false);
```

## `qa.api`: HTTP and network helper

Every QA instance exposes an `API` object as `qa.api`. TDS-v2-qa configures it
like this:

```js
qa.api.config.baseURL = SETTINGS.API_URL;
qa.api.config.headers.Authorization = `Bearer ${token}`;
qa.api.network.setResponseCallback((response) => {
    // response.url, response.status, response.method, response.data,
    // response.body, and response.headers are available here.
});
```

### `qa.api.get(url, params = {}, headers = {})`

Returns `Promise<{status, data, time}>`.

### `qa.api.post(url, data = {}, headers = {})`

Returns `Promise<{status, data, time}>`.

### `qa.api.put(url, data = {}, headers = {})`

Returns `Promise<{status, data, time}>`.

### `qa.api.patch(url, data = {}, headers = {})`

Returns `Promise<{status, data, time}>`.

### `qa.api.delete(url, data = {}, headers = {})`

Returns `Promise<{status, data, time}>`.

All request methods use `qa.api.config.baseURL`, merge configured headers with
per-request headers, and use credentials. The result contains the HTTP status,
JSON response data, and elapsed time in milliseconds. Request failures are
logged and rethrown.

### `qa.api.waitForIdle(timeout = 10000)`

Returns: `Promise<void>`.

Waits for tracked JSON/network requests to become idle. QA automatically calls
this before resolving a selector queue.

### `qa.api.config`

Mutable request configuration:

- `baseURL` (`string | null`)
- `headers` (`object`)
- `cookies` (`array`, retained for configuration compatibility)

### `qa.api.network`

The underlying `NetworkTracker` exposes:

- `setResponseCallback(callback)`: replace the JSON response callback.
- `waitForIdle({timeout, idleMs, pollMs})`: wait for no pending requests.
- `dispose()`: remove page request/response listeners.

## `QAReporter`

The reporter stores QA messages and can attach them to a Playwright test. The
TDS-v2-qa fixture calls `await QA.reporter.flush()` after the test body.

### `new QAReporter(page, testInfo)`

Parameters:

- `page` (`Page`): page used for screenshots.
- `testInfo` (`TestInfo`): Playwright test attachment target.

Returns: `QAReporter`.

### `reporter.log(message, type = "info", withSnapshot = false)`

Returns: `Promise<void>`.

Stores a timestamped message. When `withSnapshot` is true, also attaches a
screenshot.

### `reporter.info(message)` / `reporter.success(message)` /
`reporter.warning(message)` / `reporter.error(message)`

Parameters:

- `message` (`string`): message to store.

Returns: `Promise<void>`.

Convenience wrappers around `log()` with the corresponding message type.

### `reporter.snapshot(name = "snapshot", opts = {})`

Parameters:

- `name` (`string`): attachment name.
- `opts.fullPage` (`boolean`): capture the full page when true.

Returns: `Promise<void>`.

Attaches a PNG screenshot to the current Playwright test.

### `reporter.flush(name = "QA Log")`

Parameters:

- `name` (`string`): attachment name.

Returns: `Promise<void>`.

Attaches all stored QA messages as UTF-8 plain text and does not clear the
stored messages.

## TDS-v2-qa integration pattern

The consumer project keeps the QA instance in a fixture-level module variable:

```js
// fixture setup
const qa = _createQA(page, testInfo);
await use(page);
await QA.reporter.flush();
```

Action helpers retrieve that same instance with `getQA()` and deliberately
save/restore the current restriction while working in a modal or page:

```js
const qa = getQA();
const previousRestriction = qa.parentElement;
qa.clearRestrinction();
qa.setRestriction("div", modalIdentifier);
await qa.get("input", "Name").fill("Example");
qa.parentElement = previousRestriction;
```

Recommended rules for a consumer project:

- Create one QA per Playwright page, normally in a fixture.
- Pass `testInfo` if report attachments and test locations are wanted.
- Configure `qa.api.config` once in the fixture.
- Use action helpers for repeated workflows and direct QA calls for missing
  small operations.
- Use `setRestriction()` for a page/modal scope and always clear or restore it
  when the scope ends.
- Use `shouldExist(false)`/`shouldNotExist(false)` for optional UI branches.
- Await every async QA method.
- Set `safeMode: false` in unattended CI/AI runs.

## Internal implementation methods

Methods beginning with `_` are implementation details and are not part of the
stable consumer API. They are listed here so an AI inspecting the class knows
what they do and does not accidentally call them as normal test actions.

- `_defaultApiResponseCallback(log)`: sends 4xx/5xx API response summaries to
  the reporter.
- `_goToParent(item)`: replaces the current locator with an ancestor and
  refreshes its prepared data.
- `_executeQueue(tries = 0, checking = false)`: waits for the app/network,
  resolves the selector queue, updates `currentElement`/`matchedElements`,
  scrolls the result into view, and retries missing elements.
- `_getElement(parent, tag, identifiers, exceptIdentifiers, index, tries, allIdentifiers)`: gathers visible candidates, calculates weights, removes parent candidates, and selects one index.
- `_isParent(parentElement, childElement)`: compares prepared DOM paths.
- `_validateTag(tag)`: validates a tag key against `QA.TAGS` and throws `QAError` for unsupported tags.
- `_normalizeIdentifiers(identifiers, exceptIdentifiers)`: normalizes strings/objects/arrays and expands `restrictionMapping` aliases.
- `_showHint(text, type, buttons)`: injects/updates the in-page hint and registers button callbacks.
- `_hideHint()`: hides the in-page hint.
- `_getAllElements(parent, tag, identifiers, tries)`: builds the initial CSS candidate locator, waits for visible results, and prepares DOM metadata.
- `_injectQaHintPopup(color)`: creates the fixed hint wrapper in the page.
- `_removeQaHintPopup()`: removes the hint element from the page.
- `_highlight(locator, {ms})`: temporarily outlines a locator when highlighting is enabled.
- `_getBoundingBox()`: resolves the current element and returns its Playwright bounding box; throws when no box is available.
- `_cleanText(value)`: converts a value to text and normalizes common HTML entities and whitespace.
- `_describeLastElementInQueue()`: creates a human-readable description of the queued/last element.
- `_buildExecutionTrace(reason, details)`: captures and formats the Node-side trace used by `pause()` and `showTrace()`.
- `_checkIfVisible(target)`: checks viewport visibility of a locator.
- `_scrollCurrentElementIntoViewport()`: scrolls the selected element and its scrollable ancestors into view.
- `_scrollContairnerUntilTargetVisible(container, target, options)`: incrementally scrolls a container vertically or horizontally until a target is visible.

## Error and retry behavior

Element resolution is lazy and asynchronous. If no matching element is found,
QA waits and retries. After normal retries it raises `QAError`; action methods
then either call `pause()` in safe mode or `abort()` in normal mode. Assertion
methods follow the same policy unless `throwError` is false.

The `qa.queue`, `qa.parentElement`, `qa.currentElement`, and
`qa.matchedElements` fields are mutable internal state. Prefer the public
selector/restriction methods. Directly saving/restoring `parentElement`, as
TDS-v2-qa does in helper functions, is acceptable when a helper must preserve a
caller scope.
