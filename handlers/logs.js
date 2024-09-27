require('dotenv').config();

const fs = require('fs');
const axios = require('axios');

function hexToDecimal(hex) {
    return parseInt(hex.replace("#", ""), 16);
}

function log(message) {
    const logMessage = `[LOG] ${message}\n`;
    fs.appendFile(process.env.LOGS_PATH, logMessage, (err) => {
        if (err) console.log(`Failed to save log: ${err}`);
    });
    console.log(logMessage);
}

function logError (message, error = '') {
    const errorMessage = `[ERROR] ${message} (${error})\n`;
    fs.appendFile(process.env.LOGS_ERROR_PATH, errorMessage, (err) => {
        if (err) console.log(`Failed to save log: ${err}`);
    });
    console.log(errorMessage);
}

async function logToDiscord(action, message) {
    const log = require('../storage/log.json');

    if (!log.logging.status) return;
    if (!log.logging.actions.user[action] && !log.logging.actions.admin[action]) return;

    try {
        await axios.post(log.logging.webhook, {
            embeds: [
                {
                    color: hexToDecimal('#191c24'),
                    title: `Event: \`${action}\``,
                    description: message,
                    author: {
                        name: 'Logging'
                    },
                    thumbnail: {
                        _comment: "Replace the url for the webhook image",
                        url: `https://overnode.fr/favicon.png`
                    },
                    footer: {
                        text: 'Powered by fixed-palladium',
                        _comment: "Replace the url for the webhook image footer",
                        icon_url: `https://overnode.fr/favicon.png`
                    },
                    timestamp: new Date()
                }
            ]
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        logError('Error logging to Discord', error);
    }
}

module.exports = {
    log,
    logError,
    logToDiscord
}