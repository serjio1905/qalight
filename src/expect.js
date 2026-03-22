import { expect as chaiExpect } from "chai";

export class ExpectFramework {
    constructor(qa) {
        this.qa = qa;
    }

    async equal(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.equal(expectedValue);
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is equal to ${expectedValue}`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async notEqual(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.not.equal(expectedValue);
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is not equal to ${expectedValue}`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async contain(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.contain(expectedValue);
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} contains ${expectedValue}`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async notContain(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.not.contain(expectedValue);
        await this.qa._showHint(
            `${this.qa._describeLastElementInQueue()} does not contain ${expectedValue}`,
            "success"
        );
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async greaterThan(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.be.greaterThan(expectedValue);
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is greater than ${expectedValue}`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async lessThan(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.be.lessThan(expectedValue);
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is less than ${expectedValue}`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async greaterThanOrEqual(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.be.greaterThanOrEqual(expectedValue);
        await this.qa._showHint(
            `${this.qa._describeLastElementInQueue()} is greater than or equal to ${expectedValue}`,
            "success"
        );
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async lessThanOrEqual(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.be.lessThanOrEqual(expectedValue);
        await this._showHint(
            `${this.qa._describeLastElementInQueue()} is less than or equal to ${expectedValue}`,
            "success"
        );
        await this.waitFor(Math.max(this.timeout, 500), false);
        await this._hideHint();
    }
    async isBetween(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.be.between(expectedValue[0], expectedValue[1]);
        await this.qa._showHint(
            `${this.qa._describeLastElementInQueue()} is between ${expectedValue[0]} and ${expectedValue[1]}`,
            "success"
        );
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async isNotBetween(actualValue, expectedValue, hint) {
        chaiExpect(actualValue).to.not.be.between(expectedValue[0], expectedValue[1]);
        await this.qa._showHint(
            `${this.qa._describeLastElementInQueue()} is not between ${expectedValue[0]} and ${expectedValue[1]}`,
            "success"
        );
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async isNotEmpty(actualValue, hint) {
        chaiExpect(actualValue).to.not.be.empty;
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is not empty`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async isEmpty(actualValue, hint) {
        chaiExpect(actualValue).to.be.empty;
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is empty`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async isNotNull(actualValue, hint) {
        chaiExpect(actualValue).to.not.be.null;
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is not null`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async isNull(actualValue, hint) {
        chaiExpect(actualValue).to.be.null;
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is null`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async isNotUndefined(actualValue, hint) {
        chaiExpect(actualValue).to.not.be.undefined;
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is not undefined`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async isUndefined(actualValue, hint) {
        chaiExpect(actualValue).to.be.undefined;
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is undefined`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async notNullOrEmpty(actualValue, hint) {
        chaiExpect(actualValue).to.not.be.null;
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is not null or empty`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
    async nullOrEmpty(actualValue, hint) {
        chaiExpect(actualValue).to.be.null;
        await this.qa._showHint(`${this.qa._describeLastElementInQueue()} is null or empty`, "success");
        await this.qa.waitFor(Math.max(this.timeout, 500), false);
        await this.qa._hideHint();
    }
}
