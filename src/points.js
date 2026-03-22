export class WeightPointCalculator {
    constructor(element, identifiers = [], exceptIdentifiers = []) {
        this.element = element;
        this.identifiers = identifiers;
        this.exceptIdentifiers = exceptIdentifiers;
    }

    DEFAULT_WEIGHT = 50;
    ATTR_BONUS = {
        id: 10,
        name: 10,
        value: 10,
        text: 10,
        columnName: 10,
        columnThHtml: 10,
        placeholder: 8,
        label: 8,
        html: 6,
        class: 5,
        parentText: 5,
        inlineStyle: 2,
        checked: 2,
    };

    _partialMismatchPenalty(key) {
        return this.ATTR_BONUS[key] / 5;
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
        } else if (
            typeof value === "string" &&
            typeof actualValue === "string" &&
            actualValue?.includes?.(value.toLowerCase().trim())
        ) {
            bonus = this._attributeBonus(attr, value, actualValue);
            penalty = this._partialMismatchPenalty(attr);
        }
        return bonus - penalty;
    }

    calculateWeight(except = false) {
        let weight = this.DEFAULT_WEIGHT;
        let bonus = 0;
        let identifierCount = 0;

        for (const identifier of except ? this.exceptIdentifiers : this.identifiers) {
            const { attr, value } = this._validateData(identifier);
            if (attr) {
                bonus += this._calculateBonus(attr, value);
                bonus += this._attributeDefinedBonus(attr);
            } else {
                let bestAttrBonus = 0;
                for (const attr of Object.keys(this.ATTR_BONUS)) {
                    const attrBonus = this._calculateBonus(attr, value);
                    bestAttrBonus = Math.max(bestAttrBonus, attrBonus);
                }
                bonus += bestAttrBonus;
            }
            bonus += this._identifierNumberBonus(identifierCount);
            identifierCount++;
        }
        return (except ? 0 : weight) + bonus;
    }
}
