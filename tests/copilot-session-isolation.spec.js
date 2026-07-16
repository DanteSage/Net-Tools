const { EventEmitter } = require('events');
const { test, expect } = require('@playwright/test');
const {
    callLLM,
    createCopilotSession,
    executeToolCalls,
    registerCopilotHandlers
} = require('../main/tools/copilot');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
        this.listeners = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }

    on(channel, listener) {
        this.listeners.set(channel, listener);
    }
}

class FakeSender extends EventEmitter {
    constructor(id) {
        super();
        this.id = id;
        this.messages = [];
        this.destroyed = false;
    }

    send(channel, payload) {
        this.messages.push({ channel, payload });
    }

    isDestroyed() {
        return this.destroyed;
    }

    destroySender() {
        this.destroyed = true;
        this.emit('destroyed');
    }
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeToolCall(command, id = 'call-1') {
    return {
        id,
        function: {
            name: 'execute_command',
            arguments: JSON.stringify({ command, is_write_command: false })
        }
    };
}

function flushTasks() {
    return new Promise(resolve => setImmediate(resolve));
}

function createHandlerHarness() {
    const ipcMain = new FakeIpcMain();
    const graphs = [];

    registerCopilotHandlers({}, {
        ipcMain,
        loadAiConfig: () => ({
            apiKey: 'test-key',
            apiUrl: 'https://example.test/v1/chat/completions',
            model: 'test-model'
        }),
        createGraph: (...args) => {
            const session = args[6];
            const deferred = createDeferred();
            const request = {
                destroyCalls: 0,
                destroy() {
                    this.destroyCalls += 1;
                }
            };
            session.activeHttpRequest = request;
            const record = { session, deferred, request };
            graphs.push(record);
            return { run: () => deferred.promise };
        }
    });

    return {
        graphs,
        handlers: ipcMain.handlers,
        listeners: ipcMain.listeners
    };
}

const chatPayload = {
    messages: [{ role: 'user', content: 'check ospf' }],
    systemPrompt: '',
    connectionId: null,
    deviceType: 'cisco'
};

test.describe('Copilot request isolation', () => {
    test('aborting one sender does not affect another sender', async () => {
        const harness = createHandlerHarness();
        const senderA = new FakeSender(1);
        const senderB = new FakeSender(2);

        await harness.listeners.get('copilot:chat')({ sender: senderA }, chatPayload);
        await harness.listeners.get('copilot:chat')({ sender: senderB }, chatPayload);
        const [graphA, graphB] = harness.graphs;

        harness.listeners.get('copilot:abort')({ sender: senderA });

        expect(graphA.session.signal.aborted).toBe(true);
        expect(graphA.request.destroyCalls).toBe(1);
        expect(graphB.session.signal.aborted).toBe(false);
        expect(graphB.request.destroyCalls).toBe(0);

        graphA.deferred.resolve();
        graphB.deferred.resolve();
        await flushTasks();
    });

    test('a newer chat replaces only the previous chat from the same sender', async () => {
        const harness = createHandlerHarness();
        const sender = new FakeSender(3);

        await harness.listeners.get('copilot:chat')({ sender }, chatPayload);
        const first = harness.graphs[0];
        await harness.listeners.get('copilot:chat')({ sender }, chatPayload);
        const second = harness.graphs[1];

        expect(first.session.signal.aborted).toBe(true);
        expect(first.request.destroyCalls).toBe(1);
        expect(second.session.signal.aborted).toBe(false);

        first.deferred.resolve();
        await flushTasks();
        harness.listeners.get('copilot:abort')({ sender });

        expect(second.session.signal.aborted).toBe(true);
        expect(second.request.destroyCalls).toBe(1);

        second.deferred.resolve();
        await flushTasks();
    });

    test('destroying a sender aborts its active request', async () => {
        const harness = createHandlerHarness();
        const sender = new FakeSender(4);

        await harness.listeners.get('copilot:chat')({ sender }, chatPayload);
        const graph = harness.graphs[0];
        sender.destroySender();

        expect(graph.session.signal.aborted).toBe(true);
        expect(graph.request.destroyCalls).toBe(1);

        graph.deferred.resolve();
        await flushTasks();
    });

    test('late HTTP events after abort do not emit chunks or errors', async () => {
        const sender = new FakeSender(5);
        const event = { sender };
        const session = createCopilotSession(sender);
        const response = new EventEmitter();
        response.statusCode = 200;
        const request = new EventEmitter();
        request.destroyCalls = 0;
        request.write = () => {};
        request.end = () => {};
        request.destroy = () => { request.destroyCalls += 1; };
        let requestOptions;
        let responseHandler;
        const transport = {
            request(options, handler) {
                requestOptions = options;
                responseHandler = handler;
                return request;
            }
        };

        const resultPromise = callLLM(event, [], '', {
            apiKey: 'test-key',
            apiUrl: 'http://example.test/v1/chat/completions',
            model: 'test-model'
        }, session, { http: transport });
        responseHandler(response);
        session.abort();
        response.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"late"}}]}\n'));
        response.emit('end');

        await expect(resultPromise).resolves.toEqual({ error: 'Aborted', aborted: true });
        expect(requestOptions.signal).toBe(session.signal);
        expect(request.destroyCalls).toBe(1);
        expect(sender.messages).toEqual([]);
    });

    test('an approval resolving true after abort cannot execute a device command', async () => {
        const sender = new FakeSender(8);
        const session = createCopilotSession(sender);
        const approval = createDeferred();
        let executions = 0;

        const run = executeToolCalls(
            { sender },
            [makeToolCall('show version')],
            'connection-a',
            'cisco',
            {
                context: {},
                session,
                requestUserApproval: () => approval.promise,
                executeCommandOnActiveConnection: async () => {
                    executions += 1;
                    return { success: true, output: 'unexpected' };
                }
            }
        );
        await flushTasks();

        session.abort();
        approval.resolve(true);

        await expect(run).resolves.toEqual([]);
        expect(executions).toBe(0);
        expect(sender.messages.filter(item => item.channel === 'copilot:agentStep')).toHaveLength(1);
    });

    test('abort and approval responses are isolated to their owning sender', async () => {
        const ipcMain = new FakeIpcMain();
        registerCopilotHandlers({}, { ipcMain });
        const senderA = new FakeSender(6);
        const senderB = new FakeSender(7);
        const sessionA = createCopilotSession(senderA);
        const sessionB = createCopilotSession(senderB);
        let executionsA = 0;
        let executionsB = 0;

        const runA = executeToolCalls(
            { sender: senderA },
            [makeToolCall('show version', 'call-a')],
            'connection-a',
            'cisco',
            {
                context: {},
                session: sessionA,
                executeCommandOnActiveConnection: async () => {
                    executionsA += 1;
                    return { success: true, output: 'A' };
                }
            }
        );
        const runB = executeToolCalls(
            { sender: senderB },
            [makeToolCall('show version', 'call-b')],
            'connection-b',
            'cisco',
            {
                context: {},
                session: sessionB,
                executeCommandOnActiveConnection: async () => {
                    executionsB += 1;
                    return { success: true, output: 'B' };
                }
            }
        );
        await flushTasks();

        const approvalA = senderA.messages.find(item => item.channel === 'copilot:approveRequest');
        const approvalB = senderB.messages.find(item => item.channel === 'copilot:approveRequest');
        sessionA.abort();
        await expect(runA).resolves.toEqual([]);
        expect(executionsA).toBe(0);

        let runBSettled = false;
        runB.finally(() => { runBSettled = true; });
        await flushTasks();
        expect(runBSettled).toBe(false);

        await expect(ipcMain.handlers.get('copilot:approveResponse')(
            { sender: senderA },
            { requestId: approvalB.payload.requestId, approved: true }
        )).resolves.toEqual({ success: false, error: '审批请求不属于当前窗口' });
        expect(runBSettled).toBe(false);

        await expect(ipcMain.handlers.get('copilot:approveResponse')(
            { sender: senderB },
            { requestId: approvalB.payload.requestId, approved: true }
        )).resolves.toEqual({ success: true });
        await expect(runB).resolves.toHaveLength(1);
        expect(executionsB).toBe(1);
        expect(approvalA.payload.requestId).not.toBe(approvalB.payload.requestId);
        sessionB.abort();
    });
});
