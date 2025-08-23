const winston = require('winston');

class WinstonLoggerWrapper {
    constructor() {
        this.winston = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} ${level.toUpperCase().padEnd(5)} ${message}`;
                })
            ),
            transports: [
                new winston.transports.Console()
            ]
        });
    }

    setLevel(level) {
        if (level === 'trace') {
            this.winston.level = 'debug';
        } else {
            this.winston.level = level;
        }
    }

    info(message) {
        this.winston.info(message);
    }

    error(message) {
        this.winston.error(message);
    }

    warn(message) {
        this.winston.warn(message);
    }

    debug(message) {
        this.winston.debug(message);
    }

    trace(message) {
        this.winston.debug(message);
    }
}

module.exports = {
    createSimpleLogger: () => new WinstonLoggerWrapper()
};