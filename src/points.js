export class WeightPointCalculator {
    constructor(element, identifiers = [], exceptIdentifiers = []) {
        this.element = element;
        this.identifiers = identifiers;
        this.exceptIdentifiers = exceptIdentifiers;
    }

    DEFAULT_WEIGHT = 0;
    ATTR_BONUS = {
        id: 10,
        name: 10,
        value: 10,
        text: 10,
        columnName: 10,
        columnThHtml: 10,
        placeholder: 8,
        title: 8,
        label: 8,
        class: 5,
        html: 2,
        parentText: 2,
        inlineStyle: 2,
        checked: 2,
    };

    _partialMismatchPenalty(key) {
        return (this.ATTR_BONUS[key] || 3) / 5;
    }

    _attributeBonus(key) {
        return this.ATTR_BONUS[key] || 1;
    }

    _identifierNumberBonus(identifierCount) {
        return 10 / (identifierCount + 1);
    }

    _validateData(identifier) {
        let attr = null;
        let value = identifier;
        if (typeof identifier === "object") {
            attr = Object.keys(identifier)[0];
            value = identifier[attr];
        }
        if (typeof value !== "string") {
            throw new Error("Value must be a string");
        }
        return { attr, value };
    }

    _attributeDefinedBonus(attr) {
        return (this.ATTR_BONUS[attr] || 3) / 3;
    }

    _labelDepthPenalty() {
        return (this.element.data.labelDepth || 0) / 10;
    }

    _calculateBonus(attr, value) {
        let bonus = 0;
        let penalty = 0;
        const { data } = this.element;
        let actualValue = data[attr];
        if (typeof actualValue === "string") {
            actualValue = actualValue.toLowerCase().trim();
        }
        if (value === actualValue || (typeof value === "string" && actualValue === value.toLowerCase().trim())) {
            bonus = this._attributeBonus(attr);
            if (attr === "label") {
                penalty += this._labelDepthPenalty();
            }
        } else if (
            typeof value === "string" &&
            typeof actualValue === "string" &&
            actualValue?.includes?.(value.toLowerCase().trim())
        ) {
            bonus = this._attributeBonus(attr, value, actualValue);
            penalty = this._partialMismatchPenalty(attr);
            if (attr === "label") {
                penalty += this._labelDepthPenalty();
            }
        }
        return bonus - penalty;
    }

    static async prepareData(locator) {
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
                    let depth = 0;
                    let label = el.closest("label")?.textContent?.trim() || null;
                    if (!label && maxDepth > 0) {
                        const labels = Array.from(el.parentElement?.querySelectorAll("label") || []);
                        label =
                            labels
                                .map((l) => l.textContent?.trim())
                                .filter(Boolean)
                                .join(" ") || null;
                        if (!label) {
                            label = getLabel(el.parentElement, maxDepth - 1)?.text;
                        }
                        depth++;
                    }
                    return { text: label, depth };
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

                const label = getLabel?.(el);

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
                    label: elumitateHtmlChars(label.text),
                    labelDepth: label.depth,
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

    calculateWeight(except = false, allIdentifiers = false) {
        let weight = this.DEFAULT_WEIGHT;
        let bonus = 0;
        let prevBonus = 0;
        let identifierCount = 0;

        let matchedIdentifiersCount = 0;
        for (const identifier of except ? this.exceptIdentifiers : this.identifiers) {
            const { attr, value } = this._validateData(identifier);
            if (attr) {
                bonus += this._calculateBonus(attr, value);
                if (bonus > 0) {
                    bonus += this._attributeDefinedBonus(attr);
                }
            } else {
                let bestAttrBonus = 0;
                for (const attr of Object.keys(this.element.data)) {
                    if (["parentText", "tagName", "stringified", "labelDepth"].includes(attr)) continue;
                    const attrBonus = this._calculateBonus(attr, value);
                    bestAttrBonus = Math.max(bestAttrBonus, attrBonus);
                }
                bonus += bestAttrBonus;
            }
            if (bonus > prevBonus) {
                bonus += this._identifierNumberBonus(identifierCount);
                matchedIdentifiersCount++;
            }
            prevBonus = bonus;
            identifierCount++;
        }
        if (allIdentifiers && matchedIdentifiersCount < this.identifiers.length) {
            return 0;
        }
        return (except ? 0 : weight) + bonus;
    }
}
