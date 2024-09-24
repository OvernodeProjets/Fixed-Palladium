require('dotenv').config();

const fs = require('fs');

const log = (message) => {
    const logMessage = `[LOG] ${message}\n`;
    fs.appendFile(process.env.LOGS_PATH, logMessage, (err) => {
        if (err) console.log(`Failed to save log: ${err}`);
    });
    console.log(logMessage);
}

const logError = (message, error = '') => {
    const errorMessage = `[ERROR] ${message}\n`;
    fs.appendFile(process.env.LOGS_ERROR_PATH, errorMessage, (err) => {
        if (err) console.log(`Failed to save log: ${err}`);
    });
    console.log(errorMessage);
}

module.exports = {
    log,
    logError
}