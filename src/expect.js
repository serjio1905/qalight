import { expect as chaiExpect } from "chai";

const LONG_VALUE_LENGTH = 200;

function stringifyValue(value) {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "undefined") {
        return "undefined";
    }
    try {
        const serializedValue = JSON.stringify(value);
        if (typeof serializedValue === "string") {
            return serializedValue;
        }
    } catch (error) {}
    return String(value);
}

export function buildEqualMismatchDetails(actualValue, expectedValue) {
    const actualText = stringifyValue(actualValue);
    const expectedText = stringifyValue(expectedValue);
    if (actualText.length <= LONG_VALUE_LENGTH && expectedText.length <= LONG_VALUE_LENGTH) {
        return {
            message: `Failed to check if ${actualText} is equal to ${expectedText}`,
            traceDetails: "",
        };
    }

    const maxLength = Math.max(actualText.length, expectedText.length);
    let mismatchCount = 0;
    let firstMismatchIndex = -1;
    for (let index = 0; index < maxLength; index++) {
        if (actualText[index] !== expectedText[index]) {
            mismatchCount++;
            if (firstMismatchIndex === -1) {
                firstMismatchIndex = index;
            }
        }
    }

    let commonPrefixLength = 0;
    while (
        commonPrefixLength < actualText.length &&
        commonPrefixLength < expectedText.length &&
        actualText[commonPrefixLength] === expectedText[commonPrefixLength]
    ) {
        commonPrefixLength++;
    }

    let commonSuffixLength = 0;
    while (
        commonSuffixLength < actualText.length - commonPrefixLength &&
        commonSuffixLength < expectedText.length - commonPrefixLength &&
        actualText[actualText.length - 1 - commonSuffixLength] ===
            expectedText[expectedText.length - 1 - commonSuffixLength]
    ) {
        commonSuffixLength++;
    }

    const markMismatch = (value) => {
        const prefix = value.slice(0, commonPrefixLength);
        const mismatchEnd = value.length - commonSuffixLength;
        const mismatch = value.slice(commonPrefixLength, mismatchEnd) || "(empty)";
        const suffix = commonSuffixLength > 0 ? value.slice(value.length - commonSuffixLength) : "";
        return `${prefix}<<<${mismatch}>>>${suffix}`;
    };

    const mismatchPercent = maxLength === 0 ? 0 : (mismatchCount / maxLength) * 100;
    const summary = [
        "Failed to check if actual value is equal to expected value.",
        `Actual length: ${actualText.length} chars; expected length: ${expectedText.length} chars.`,
        `Mismatch: ${mismatchCount} of ${maxLength} chars by position (${mismatchPercent.toFixed(1)}%).`,
        `First mismatch at index ${firstMismatchIndex}.`,
        'Use "Show trace in console" to view full values with mismatched sections marked.',
    ].join(" ");

    const traceDetails = [
        "",
        "Equal comparison details:",
        `Actual length: ${actualText.length} chars`,
        `Expected length: ${expectedText.length} chars`,
        `Mismatching by position: ${mismatchCount} of ${maxLength} chars (${mismatchPercent.toFixed(1)}%)`,
        `First mismatch index: ${firstMismatchIndex}`,
        "Markers <<< >>> wrap the differing section.",
        "Actual:",
        markMismatch(actualText),
        "Expected:",
        markMismatch(expectedText),
    ].join("\n");

    return {
        message: summary,
        traceDetails,
    };
}

export class ExpectFramework {
    /**
     * @typedef {import("./qa.js").QA} QA
     * @param {import("./qa.js").QA} qa
     * @returns {ExpectFramework}
     */
    constructor(qa) {
        this.qa = qa;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async equal(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.equal(expectedValue);
            await this.qa._showHint(`${actualValue} is equal to ${expectedValue}`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                const mismatchDetails = buildEqualMismatchDetails(actualValue, expectedValue);
                if (this.qa.safeMode) {
                    await this.qa.pause(mismatchDetails.message, undefined, undefined, mismatchDetails.traceDetails);
                } else {
                    this.qa.abort(mismatchDetails.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async notEqual(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.not.equal(expectedValue);
            await this.qa._showHint(`${actualValue} is not equal to ${expectedValue}`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is not equal to ${expectedValue}`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async contain(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.contain(expectedValue);
            await this.qa._showHint(`${actualValue} contains ${expectedValue}`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} contains ${expectedValue}`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async notContain(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.not.contain(expectedValue);
            await this.qa._showHint(`${actualValue} does not contain ${expectedValue}`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} does not contain ${expectedValue}`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async greaterThan(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.be.greaterThan(expectedValue);
            await this.qa._showHint(`${actualValue} is greater than ${expectedValue}`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is greater than ${expectedValue}`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async lessThan(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.be.lessThan(expectedValue);
            await this.qa._showHint(`${actualValue} is less than ${expectedValue}`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is less than ${expectedValue}`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async greaterThanOrEqual(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.be.greaterThanOrEqual(expectedValue);
            await this.qa._showHint(`${actualValue} is greater than or equal to ${expectedValue}`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(
                        `Failed to check if ${actualValue} is greater than or equal to ${expectedValue}`
                    );
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async lessThanOrEqual(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.be.lessThanOrEqual(expectedValue);
            await this.qa._showHint(`${actualValue} is less than or equal to ${expectedValue}`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is less than or equal to ${expectedValue}`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async isBetween(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.be.between(expectedValue[0], expectedValue[1]);
            await this.qa._showHint(`${actualValue} is between ${expectedValue[0]} and ${expectedValue[1]}`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(
                        `Failed to check if ${actualValue} is between ${expectedValue[0]} and ${expectedValue[1]}`
                    );
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {string} expectedValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async isNotBetween(actualValue, expectedValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.not.be.between(expectedValue[0], expectedValue[1]);
            await this.qa._showHint(
                `${actualValue} is not between ${expectedValue[0]} and ${expectedValue[1]}`,
                "success"
            );
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(
                        `Failed to check if ${actualValue} is not between ${expectedValue[0]} and ${expectedValue[1]}`
                    );
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async isNotEmpty(actualValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.not.be.empty;
            await this.qa._showHint(`${actualValue} is not empty`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is not empty`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async isEmpty(actualValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.be.empty;
            await this.qa._showHint(`${actualValue} is empty`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is empty`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async isNull(actualValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.be.null;
            await this.qa._showHint(`${actualValue} is null`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is null`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async isNotUndefined(actualValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.not.be.undefined;
            await this.qa._showHint(`${actualValue} is not undefined`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is not undefined`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async notNullOrEmpty(actualValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.not.be.null;
            await this.qa._showHint(`${actualValue} is not null or empty`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is not null or empty`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }

    /**
     * @param {string} actualValue
     * @param {boolean} throwError
     * @returns {Promise<boolean>}
     */
    async nullOrEmpty(actualValue, throwError = true) {
        try {
            chaiExpect(actualValue).to.be.null;
            await this.qa._showHint(`${actualValue} is null or empty`, "success");
            await this.qa.waitFor(Math.max(this.timeout, 500), false);
            await this.qa._hideHint();
        } catch (error) {
            if (throwError) {
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is null or empty`);
                } else {
                    this.qa.abort(error.message);
                }
            }
            return false;
        }
        return true;
    }
}
