import { readFileSync } from "fs";

/**
 * Parse a CSV file into an array of rows, each row an array of trimmed
 * string cell values. Handles quoted fields (including embedded delimiters,
 * newlines, and escaped "" quotes).
 * @param {string} filePath
 * @param {Object} [options]
 * @param {string} [options.delimiter=","]
 * @returns {string[][]}
 */
export const parseCsv = (filePath, { delimiter = "," } = {}) => {
    const text = readFileSync(filePath, "utf8").replace(/^﻿/, "");
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === delimiter) {
            row.push(cell.trim());
            cell = "";
        } else if (ch === "\r") {
            // skip, \n (or end of file) terminates the row
        } else if (ch === "\n") {
            row.push(cell.trim());
            rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += ch;
        }
    }
    if (cell !== "" || row.length > 0) {
        row.push(cell.trim());
        rows.push(row);
    }
    return rows;
};
