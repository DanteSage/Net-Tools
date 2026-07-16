const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
    isCommandPotentiallyWrite,
    isApprovalGranted,
    executeToolCalls
} = require('../main/tools/copilot');

function makeToolCall(command, suggestedIsWrite = false, id = 'call-1') {
    return {
        id,
        function: {
            name: 'execute_command',
            arguments: JSON.stringify({
                command,
                is_write_command: suggestedIsWrite
            })
        }
    };
}

function makeEvent() {
    const messages = [];
    return {
        messages,
        event: {
            sender: {
                send: (channel, payload) => messages.push({ channel, payload })
            }
        }
    };
}

test.describe('Copilot command approval policy', () => {
    test('shows the target device in the approval dialog', () => {
        const root = path.join(__dirname, '..');
        const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
        const ui = fs.readFileSync(path.join(root, 'scripts/modules/copilot/copilot-ui.js'), 'utf8');

        expect(html).toContain('id="approval-device-name"');
        expect(ui).toContain("getElementById('approval-device-name')");
        expect(preload).toContain("ipcRenderer.on('copilot:approvalExpired'");
        expect(preload).toContain("ipcRenderer.removeAllListeners('copilot:approvalExpired')");
        expect(ui).toContain('onApprovalExpired');
        expect(ui).toContain("currentRequestId !== requestId");
        expect(ui).toContain('await window.api.copilot.approveResponse');
        expect(ui).toContain("showToast(response?.error || '审批请求已失效，命令未执行'");
    });

    test('accepts only the boolean true as approval', () => {
        expect(isApprovalGranted(true)).toBe(true);

        for (const value of [false, 'true', 'false', 1, {}, [], null, undefined]) {
            expect(isApprovalGranted(value), String(value)).toBe(false);
        }
    });

    test('uses a conservative command classification for display only', () => {
        const readOnlyCommands = [
            'show version',
            ' DISPLAY ip interface brief ',
            'ping 192.0.2.1',
            'Traceroute 2001:db8::1'
        ];

        for (const command of readOnlyCommands) {
            expect(isCommandPotentiallyWrite(command, false), command).toBe(false);
        }

        expect(isCommandPotentiallyWrite('show version', true)).toBe(true);
    });

    test('marks unknown and malformed commands as potentially write-capable', () => {
        const commands = [
            'copy running-config startup-config',
            'commit',
            'request system reboot',
            'clear counters',
            'bash -c reboot',
            'showcase version',
            '',
            '   ',
            null,
            undefined,
            42
        ];

        for (const command of commands) {
            expect(isCommandPotentiallyWrite(command, false), String(command)).toBe(true);
        }
    });

    test('marks compound commands and control syntax as potentially write-capable', () => {
        const commands = [
            'show version\nreload',
            'display version\r\nsystem-view',
            'show running-config | redirect tftp://192.0.2.1/config',
            'show version; reload',
            'show version && reload',
            'show version > flash:output.txt',
            'show version\treload',
            'show $(reload)'
        ];

        for (const command of commands) {
            expect(isCommandPotentiallyWrite(command, false), command).toBe(true);
        }
    });

    test('blocks an unknown command when the user rejects approval', async () => {
        const approvals = [];
        let executions = 0;
        const { event } = makeEvent();

        const toolMessages = await executeToolCalls(
            event,
            [makeToolCall('commit')],
            'connection-1',
            'huawei',
            {
                context: {},
                requestUserApproval: async (_context, connectionId, command) => {
                    approvals.push({ connectionId, command });
                    return false;
                },
                executeCommandOnActiveConnection: async () => {
                    executions++;
                    return { success: true, output: 'unexpected' };
                }
            }
        );

        expect(approvals).toEqual([{ connectionId: 'connection-1', command: 'commit' }]);
        expect(executions).toBe(0);
        expect(toolMessages[0].content).toBe('Error: Command execution rejected by user.');
    });

    test('requires approval even for an explicit read-only command', async () => {
        let approvals = 0;
        let executions = 0;
        const { event } = makeEvent();

        const toolMessages = await executeToolCalls(
            event,
            [makeToolCall('show version')],
            'connection-1',
            'cisco',
            {
                context: {},
                requestUserApproval: async () => {
                    approvals++;
                    return true;
                },
                executeCommandOnActiveConnection: async () => {
                    executions++;
                    return { success: true, output: 'Cisco IOS' };
                }
            }
        );

        expect(approvals).toBe(1);
        expect(executions).toBe(1);
        expect(toolMessages[0].content).toBe('Cisco IOS');
    });

    test('does not execute for a truthy non-boolean approval response', async () => {
        let executions = 0;
        const { event } = makeEvent();

        const toolMessages = await executeToolCalls(
            event,
            [makeToolCall('show version')],
            'connection-1',
            'cisco',
            {
                context: {},
                requestUserApproval: async () => 'true',
                executeCommandOnActiveConnection: async () => {
                    executions++;
                    return { success: true, output: 'unexpected' };
                }
            }
        );

        expect(executions).toBe(0);
        expect(toolMessages[0].content).toBe('Error: Command execution rejected by user.');
    });

    test('rejects an empty command before approval or execution', async () => {
        let approvals = 0;
        let executions = 0;
        const { event } = makeEvent();

        const toolMessages = await executeToolCalls(
            event,
            [makeToolCall(null)],
            'connection-1',
            'cisco',
            {
                context: {},
                requestUserApproval: async () => {
                    approvals++;
                    return true;
                },
                executeCommandOnActiveConnection: async () => {
                    executions++;
                    return { success: true, output: 'unexpected' };
                }
            }
        );

        expect(approvals).toBe(0);
        expect(executions).toBe(0);
        expect(toolMessages[0].content).toBe('Error: AI returned an empty or invalid command.');
    });

    test('rejects non-object tool arguments before approval or execution', async () => {
        let approvals = 0;
        let executions = 0;
        const { event } = makeEvent();
        const malformedCall = makeToolCall('show version');
        malformedCall.function.arguments = 'null';

        const toolMessages = await executeToolCalls(
            event,
            [malformedCall],
            'connection-1',
            'cisco',
            {
                context: {},
                requestUserApproval: async () => {
                    approvals++;
                    return true;
                },
                executeCommandOnActiveConnection: async () => {
                    executions++;
                    return { success: true, output: 'unexpected' };
                }
            }
        );

        expect(approvals).toBe(0);
        expect(executions).toBe(0);
        expect(toolMessages[0].content).toBe('Error: AI returned an empty or invalid command.');
    });
});
