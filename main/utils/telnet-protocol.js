/**
 * Stateful Telnet IAC protocol processing.
 */

const TELNET_IAC = 0xFF;
const TELNET_WILL = 0xFB;
const TELNET_WONT = 0xFC;
const TELNET_DO = 0xFD;
const TELNET_DONT = 0xFE;
const TELNET_SB = 0xFA;
const TELNET_SE = 0xF0;

const TELOPT_ECHO = 1;
const TELOPT_SGA = 3;
const TELOPT_TTYPE = 24;
const TELOPT_NAWS = 31;

const PARSER_DATA = 0;
const PARSER_IAC = 1;
const PARSER_OPTION = 2;
const PARSER_SUBNEGOTIATION = 3;
const PARSER_SUBNEGOTIATION_IAC = 4;

function sendTelnetWindowSize(socket, cols, rows) {
    if (!socket || socket.destroyed || socket.writable === false || !socket._telnetNawsEnabled) {
        return false;
    }

    const safeCols = Math.max(2, Math.min(65535, Math.floor(Number(cols) || 80)));
    const safeRows = Math.max(1, Math.min(65535, Math.floor(Number(rows) || 24)));
    const sizeBytes = [
        (safeCols >> 8) & 0xFF,
        safeCols & 0xFF,
        (safeRows >> 8) & 0xFF,
        safeRows & 0xFF
    ];
    const escapedSizeBytes = [];

    for (const byte of sizeBytes) {
        escapedSizeBytes.push(byte);
        if (byte === TELNET_IAC) escapedSizeBytes.push(TELNET_IAC);
    }

    socket.write(Buffer.from([
        TELNET_IAC,
        TELNET_SB,
        TELOPT_NAWS,
        ...escapedSizeBytes,
        TELNET_IAC,
        TELNET_SE
    ]));
    return true;
}

function createTelnetNegotiator(socket) {
    if (!socket || typeof socket.write !== 'function') {
        throw new TypeError('socket with write() is required');
    }

    let state = PARSER_DATA;
    let pendingCommand = null;

    function handleOption(command, option, responses) {
        if (command === TELNET_DO) {
            if (option === TELOPT_SGA) {
                responses.push(Buffer.from([TELNET_IAC, TELNET_WILL, option]));
                return false;
            }
            if (option === TELOPT_NAWS) {
                socket._telnetNawsEnabled = true;
                responses.push(Buffer.from([TELNET_IAC, TELNET_WILL, option]));
                return true;
            }
            responses.push(Buffer.from([TELNET_IAC, TELNET_WONT, option]));
            return false;
        }

        if (command === TELNET_DONT) {
            if (option === TELOPT_NAWS) socket._telnetNawsEnabled = false;
            responses.push(Buffer.from([TELNET_IAC, TELNET_WONT, option]));
            return false;
        }

        if (command === TELNET_WILL) {
            const accepted = option === TELOPT_ECHO || option === TELOPT_SGA;
            responses.push(Buffer.from([
                TELNET_IAC,
                accepted ? TELNET_DO : TELNET_DONT,
                option
            ]));
            return false;
        }

        responses.push(Buffer.from([TELNET_IAC, TELNET_DONT, option]));
        return false;
    }

    function push(data) {
        const input = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
        const filtered = [];
        const responses = [];
        let shouldSendWindowSize = false;

        for (const byte of input) {
            if (state === PARSER_DATA) {
                if (byte === TELNET_IAC) state = PARSER_IAC;
                else filtered.push(byte);
                continue;
            }

            if (state === PARSER_IAC) {
                if (byte === TELNET_IAC) {
                    filtered.push(TELNET_IAC);
                    state = PARSER_DATA;
                } else if (
                    byte === TELNET_DO || byte === TELNET_DONT ||
                    byte === TELNET_WILL || byte === TELNET_WONT
                ) {
                    pendingCommand = byte;
                    state = PARSER_OPTION;
                } else if (byte === TELNET_SB) {
                    state = PARSER_SUBNEGOTIATION;
                } else {
                    state = PARSER_DATA;
                }
                continue;
            }

            if (state === PARSER_OPTION) {
                shouldSendWindowSize = handleOption(pendingCommand, byte, responses) || shouldSendWindowSize;
                pendingCommand = null;
                state = PARSER_DATA;
                continue;
            }

            if (state === PARSER_SUBNEGOTIATION) {
                if (byte === TELNET_IAC) state = PARSER_SUBNEGOTIATION_IAC;
                continue;
            }

            if (state === PARSER_SUBNEGOTIATION_IAC) {
                state = byte === TELNET_SE ? PARSER_DATA : PARSER_SUBNEGOTIATION;
            }
        }

        if (responses.length > 0 && !socket.destroyed && socket.writable !== false) {
            socket.write(Buffer.concat(responses));
        }
        if (shouldSendWindowSize) {
            sendTelnetWindowSize(socket, socket._terminalCols, socket._terminalRows);
        }

        return Buffer.from(filtered);
    }

    return {
        push,
        reset() {
            state = PARSER_DATA;
            pendingCommand = null;
        },
        getState: () => state
    };
}

function handleTelnetNegotiation(data, socket) {
    if (!socket._telnetNegotiator) {
        Object.defineProperty(socket, '_telnetNegotiator', {
            configurable: true,
            value: createTelnetNegotiator(socket)
        });
    }
    return socket._telnetNegotiator.push(data);
}

module.exports = {
    TELNET_IAC,
    TELNET_WILL,
    TELNET_WONT,
    TELNET_DO,
    TELNET_DONT,
    TELNET_SB,
    TELNET_SE,
    TELOPT_ECHO,
    TELOPT_SGA,
    TELOPT_TTYPE,
    TELOPT_NAWS,
    createTelnetNegotiator,
    handleTelnetNegotiation,
    sendTelnetWindowSize
};
