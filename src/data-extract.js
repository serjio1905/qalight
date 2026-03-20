export function elumitateHtmlChars(value) {
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

export function getTdColumnName(el) {
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

export function getTdColumnThHtml(el) {
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

export function getLabel(el, maxDepth = 4) {
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

export function getValuesOfAllInnerElements(el) {
    return Array.from(el.querySelectorAll("input, textarea, select"))
        .map((el) => el.value)
        .join(" ");
}
