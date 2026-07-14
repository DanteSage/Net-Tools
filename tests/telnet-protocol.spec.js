const { test, expect } = require('@playwright/test');
const {
    TELNET_IAC,
    TELNET_WILL,
    TELNET_DO,
    TELNET_SB,
    TELNET_SE,
    TELOPT_NAWS,
    handleTelnetNegotiation,
    sendTelnetWindowSize
} = require('../main/utils/telnet-protocol');

function createSocket(overrides = {}) {
    const writes = [];
    return {
        socket: {
            destroyed: false,
            writable: true,
            _terminalCols: 120,
            _terminalRows: 40,
            write: (data) => writes.push(Buffer.from(data)),
            ...overrides
        },
        writes
    };
}

test.describe('telnet NAWS negotiation', () => {
    test('accepts NAWS and immediately reports the current terminal size', () => {
        const { socket, writes } = createSocket();
        const filtered = handleTelnetNegotiation(
            Buffer.from([TELNET_IAC, TELNET_DO, TELOPT_NAWS]),
            socket
        );

        expect(filtered).toEqual(Buffer.alloc(0));
        expect(socket._telnetNawsEnabled).toBe(true);
        expect(writes).toEqual([
            Buffer.from([TELNET_IAC, TELNET_WILL, TELOPT_NAWS]),
            Buffer.from([
                TELNET_IAC,
                TELNET_SB,
                TELOPT_NAWS,
                0,
                120,
                0,
                40,
                TELNET_IAC,
                TELNET_SE
            ])
        ]);
    });

    test('escapes IAC bytes inside the NAWS payload', () => {
        const { socket, writes } = createSocket({ _telnetNawsEnabled: true });

        expect(sendTelnetWindowSize(socket, 255, 511)).toBe(true);
        expect(writes).toEqual([
            Buffer.from([
                TELNET_IAC,
                TELNET_SB,
                TELOPT_NAWS,
                0,
                TELNET_IAC,
                TELNET_IAC,
                1,
                TELNET_IAC,
                TELNET_IAC,
                TELNET_IAC,
                TELNET_SE
            ])
        ]);
    });

    test('does not send a size before the server enables NAWS', () => {
        const { socket, writes } = createSocket();

        expect(sendTelnetWindowSize(socket, 80, 24)).toBe(false);
        expect(writes).toEqual([]);
    });

    test('preserves negotiation state across TCP chunks', () => {
        const { socket, writes } = createSocket();

        const first = handleTelnetNegotiation(
            Buffer.from([0x68, 0x69, TELNET_IAC, TELNET_DO]),
            socket
        );
        const second = handleTelnetNegotiation(
            Buffer.from([TELOPT_NAWS, 0x21]),
            socket
        );

        expect(first).toEqual(Buffer.from('hi'));
        expect(second).toEqual(Buffer.from('!'));
        expect(socket._telnetNawsEnabled).toBe(true);
        expect(writes).toHaveLength(2);
        expect(writes[0]).toEqual(Buffer.from([TELNET_IAC, TELNET_WILL, TELOPT_NAWS]));
    });

    test('preserves escaped IAC and subnegotiation state across chunks', () => {
        const { socket } = createSocket();

        expect(handleTelnetNegotiation(Buffer.from([0x41, TELNET_IAC]), socket))
            .toEqual(Buffer.from('A'));
        expect(handleTelnetNegotiation(Buffer.from([TELNET_IAC, 0x42, TELNET_IAC, TELNET_SB, TELOPT_NAWS]), socket))
            .toEqual(Buffer.from([TELNET_IAC, 0x42]));
        expect(handleTelnetNegotiation(Buffer.from([0x00, 0x50, TELNET_IAC]), socket))
            .toEqual(Buffer.alloc(0));
        expect(handleTelnetNegotiation(Buffer.from([TELNET_SE, 0x43]), socket))
            .toEqual(Buffer.from('C'));
    });

});
