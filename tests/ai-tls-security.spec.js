const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const root = path.join(__dirname, '..');
const authenticatedAiClients = [
    'main/tools/copilot.js',
    'main/tools/tshark-analyzer.js'
];

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test.describe('AI API TLS security', () => {
    for (const relativePath of authenticatedAiClients) {
        test(`${relativePath} verifies HTTPS certificates when sending credentials`, () => {
            const source = read(relativePath);

            expect(source).toMatch(/(?:Authorization|api-key)/);
            expect(source).toMatch(/rejectUnauthorized\s*:\s*true/);
            expect(source).not.toMatch(/rejectUnauthorized\s*:\s*false/);
        });
    }
});
