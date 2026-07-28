module.exports = {
    QA: require("./src/qa").QA,
    QAError: require("./src/qa").QAError,
    QAReporter: require("./src/reporter").QAReporter,
    QAAPI: require("./src/api").API,
    ExpectFramework: require("./src/expect").ExpectFramework,
    UserActionRecorder: require("./src/user-actions").UserActionRecorder,
    parseXlsx: require("./src/files/xlsx").parseXlsx,
    parseCsv: require("./src/files/csv").parseCsv,
};
