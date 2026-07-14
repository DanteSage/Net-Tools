const { test, expect } = require('@playwright/test');
const {
    createTerminalRendererController
} = require('../scripts/modules/terminal/terminal-renderer-controller');

function createAddon() {
    return {
        disposed: false,
        contextLossHandler: null,
        onContextLoss(handler) {
            this.contextLossHandler = handler;
        },
        dispose() {
            this.disposed = true;
        }
    };
}

test.describe('terminal renderer controller', () => {
    test('recovers WebGL twice and then stays on canvas', () => {
        const addons = [];
        const scheduled = [];
        const terminal = {
            loaded: [],
            loadAddon(addon) {
                this.loaded.push(addon);
            }
        };
        const controller = createTerminalRendererController(terminal, {
            createAddon: () => {
                const addon = createAddon();
                addons.push(addon);
                return addon;
            },
            schedule: (callback, delay) => {
                const timer = { callback, delay };
                scheduled.push(timer);
                return timer;
            },
            cancelSchedule: () => {},
            recoveryDelayMs: 10,
            maxRecoveryAttempts: 2
        });

        expect(controller.getStats().mode).toBe('webgl');
        addons[0].contextLossHandler();
        expect(addons[0].disposed).toBe(true);
        expect(scheduled[0].delay).toBe(10);

        scheduled.shift().callback();
        expect(controller.getStats().mode).toBe('webgl');
        addons[1].contextLossHandler();
        expect(scheduled[0].delay).toBe(20);

        scheduled.shift().callback();
        addons[2].contextLossHandler();

        expect(controller.getStats()).toMatchObject({
            mode: 'canvas',
            recoveryAttempts: 2,
            contextLosses: 3,
            recoveryScheduled: false
        });
        expect(scheduled).toHaveLength(0);
    });

    test('cancels pending recovery when disposed', () => {
        const addon = createAddon();
        let scheduledTimer = null;
        let cancelledTimer = null;
        const controller = createTerminalRendererController({ loadAddon() {} }, {
            createAddon: () => addon,
            schedule: (callback) => {
                scheduledTimer = { callback };
                return scheduledTimer;
            },
            cancelSchedule: (timer) => {
                cancelledTimer = timer;
            }
        });

        addon.contextLossHandler();
        controller.dispose();

        expect(cancelledTimer).toBe(scheduledTimer);
        expect(controller.getStats().mode).toBe('disposed');
    });
});
