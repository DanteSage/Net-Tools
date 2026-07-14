const { test, expect } = require('@playwright/test');
const iconv = require('iconv-lite');
const { MockBinding } = require('@serialport/binding-mock');
const { SerialPortMock } = require('serialport');
const {
    normalizeSerialConfig,
    registerSerialHandlers
} = require('../main/connections/serial');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
        this.listeners = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }

    on(channel, handler) {
        this.listeners.set(channel, handler);
    }
}

function waitForEvents() {
    return new Promise((resolve) => setTimeout(resolve, 20));
}

function createHarness() {
    const ipcMain = new FakeIpcMain();
    const activeSerialPorts = new Map();
    const messages = [];
    const webContents = {
        isDestroyed: () => false,
        send: (channel, payload) => messages.push({ channel, payload })
    };
    const mainWindow = {
        isDestroyed: () => false,
        webContents
    };

    registerSerialHandlers({
        activeSerialPorts,
        getMainWindow: () => mainWindow,
        isQuitting: () => false
    }, {
        ipcMain,
        SerialPort: SerialPortMock
    });

    return {
        activeSerialPorts,
        handlers: ipcMain.handlers,
        messages
    };
}

test.describe('serial connection', () => {
    test.beforeEach(() => {
        MockBinding.reset();
        MockBinding.createPort('COM_TEST', {
            echo: false,
            record: true,
            manufacturer: 'Codex Serial Test'
        });
    });

    test('normalizes extended serial options and rejects invalid values', () => {
        expect(normalizeSerialConfig({
            path: ' COM_TEST ',
            baudRate: '230400',
            dataBits: '6',
            stopBits: '1.5',
            parity: 'MARK',
            rtscts: 1,
            xon: true,
            encoding: 'GBK'
        })).toEqual({
            path: 'COM_TEST',
            baudRate: 230400,
            dataBits: 6,
            stopBits: 1.5,
            parity: 'mark',
            rtscts: true,
            xon: true,
            xoff: false,
            slowSend: false,
            sendDelayMs: 5,
            encoding: 'gbk'
        });

        expect(() => normalizeSerialConfig({ path: 'COM_TEST', dataBits: 9 }))
            .toThrow('数据位');
        expect(() => normalizeSerialConfig({ path: '', baudRate: 9600 }))
            .toThrow('请选择串口');
    });

    test('applies flow control and decodes incoming data with the connection encoding', async () => {
        const harness = createHarness();
        const result = await harness.handlers.get('serial:connect')({}, {
            path: 'COM_TEST',
            baudRate: 230400,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            rtscts: true,
            xon: true,
            xoff: true,
            encoding: 'gbk'
        });

        expect(result.success).toBe(true);
        const port = harness.activeSerialPorts.get(result.connectionId);
        expect(port.settings).toMatchObject({
            baudRate: 230400,
            rtscts: true,
            xon: true,
            xoff: true,
            xany: false
        });

        port.port.emitData(iconv.encode('串口正常', 'gbk'));
        await waitForEvents();

        expect(harness.messages).toContainEqual({
            channel: 'serial:data',
            payload: {
                connectionId: result.connectionId,
                data: '串口正常'
            }
        });

        const disconnected = await harness.handlers.get('serial:disconnect')({}, {
            connectionId: result.connectionId
        });
        expect(disconnected.success).toBe(true);
        expect(harness.activeSerialPorts.has(result.connectionId)).toBe(false);
    });

    test('encodes outgoing data and cleans up after a port error', async () => {
        const harness = createHarness();
        const result = await harness.handlers.get('serial:connect')({}, {
            path: 'COM_TEST',
            baudRate: 9600,
            encoding: 'gbk'
        });
        const port = harness.activeSerialPorts.get(result.connectionId);

        const writeResult = await harness.handlers.get('serial:write')({}, {
            connectionId: result.connectionId,
            data: '测试'
        });
        expect(writeResult.success).toBe(true);
        expect(port.port.recording).toEqual(iconv.encode('测试', 'gbk'));

        port.emit('error', new Error('device disconnected'));
        await waitForEvents();

        expect(harness.activeSerialPorts.has(result.connectionId)).toBe(false);
        expect(harness.messages.filter(x => x.channel === 'serial:error')).toHaveLength(1);
        expect(harness.messages.filter(x => x.channel === 'serial:close')).toHaveLength(1);
    });
});
