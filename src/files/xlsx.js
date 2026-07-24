import { readFileSync } from "fs";
import { inflateRawSync } from "zlib";

// Minimal, dependency-free .xlsx reader (the file is a ZIP). Extracts the
// first worksheet's rows as an array of trimmed string cell values. Supports
// inlineStr, shared strings and numeric cells.

const decodeEntities = (s) =>
    s
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");

// Reads the ZIP central directory → map {file_name: Buffer with decompressed content}
const readZipEntries = (buf, wanted) => {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error("xlsx: EOCD (end of ZIP) not found");
    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    const out = {};
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(off) !== 0x02014b50) break;
        const method = buf.readUInt16LE(off + 10);
        const compSize = buf.readUInt32LE(off + 20);
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const commentLen = buf.readUInt16LE(off + 32);
        const localOff = buf.readUInt32LE(off + 42);
        const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
        if (!wanted || wanted.includes(name)) {
            const lhNameLen = buf.readUInt16LE(localOff + 26);
            const lhExtraLen = buf.readUInt16LE(localOff + 28);
            const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
            const raw = buf.subarray(dataStart, dataStart + compSize);
            out[name] = method === 0 ? raw : inflateRawSync(raw);
        }
        off += 46 + nameLen + extraLen + commentLen;
    }
    return out;
};

const parseSharedStrings = (xml) => {
    if (!xml) return [];
    const out = [];
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml))) {
        const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeEntities(x[1]));
        out.push(parts.join(""));
    }
    return out;
};

const colToIndex = (ref) => {
    const letters = (ref.match(/^[A-Z]+/) || ["A"])[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
};

/**
 * Read the first worksheet of an .xlsx file into an array of rows,
 * each row an array of trimmed string cell values (index = column order).
 * @param {string} filePath
 * @returns {string[][]}
 */
export const parseXlsx = (filePath) => {
    const buf = readFileSync(filePath);
    const entries = readZipEntries(buf, ["xl/worksheets/sheet1.xml", "xl/sharedStrings.xml"]);
    const sheetXml = entries["xl/worksheets/sheet1.xml"]?.toString("utf8");
    if (!sheetXml) throw new Error("xlsx: xl/worksheets/sheet1.xml not found");
    const shared = parseSharedStrings(entries["xl/sharedStrings.xml"]?.toString("utf8"));

    const rows = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(sheetXml))) {
        const cells = [];
        const cellRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cm;
        while ((cm = cellRe.exec(rm[1]))) {
            const attrs = cm[1];
            const body = cm[2] || "";
            const ref = (attrs.match(/r="([^"]+)"/) || [])[1];
            const type = (attrs.match(/t="([^"]+)"/) || [])[1];
            let value = "";
            if (type === "inlineStr") {
                const tm = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
                value = tm ? decodeEntities(tm[1]) : "";
            } else if (type === "s") {
                const vm = body.match(/<v>([\s\S]*?)<\/v>/);
                value = vm ? shared[Number(vm[1])] ?? "" : "";
            } else {
                const vm = body.match(/<v>([\s\S]*?)<\/v>/);
                value = vm ? decodeEntities(vm[1]) : "";
            }
            const idx = ref ? colToIndex(ref) : cells.length;
            cells[idx] = value.trim();
        }
        rows.push(cells);
    }
    return rows;
};
