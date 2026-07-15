const { test, expect } = require('@playwright/test');
const { FtpClient } = require('../main/connections/ftp');

function createClient() {
    const client = new FtpClient();
    client.socket = {
        writes: [],
        write(data) {
            this.writes.push(data);
        }
    };
    return client;
}

test.describe('FTP control response handling', () => {
    test('handles preliminary and completion responses from the same TCP chunk', async () => {
        const client = createClient();
        const response = client.sendTransferCmd('RETR /config.txt');

        client.buffer = '150 Opening data connection\r\n226 Transfer complete\r\n';
        client.parseResponses();

        await expect(response).resolves.toEqual({
            code: 226,
            text: 'Transfer complete'
        });
        expect(client.cmdQueue).toHaveLength(0);
        expect(client.socket.writes).toEqual(['RETR /config.txt\r\n']);
    });

    test('returns an immediate transfer failure without waiting for a second response', async () => {
        const client = createClient();
        const response = client.sendTransferCmd('RETR /missing.txt');

        client.buffer = '550 File unavailable\r\n';
        client.parseResponses();

        await expect(response).resolves.toEqual({
            code: 550,
            text: 'File unavailable'
        });
        expect(client.cmdQueue).toHaveLength(0);
    });
});
