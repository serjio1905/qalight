import { expect as chaiExpect } from "chai";

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
                if (this.qa.safeMode) {
                    await this.qa.pause(`Failed to check if ${actualValue} is equal to ${expectedValue}`);
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
