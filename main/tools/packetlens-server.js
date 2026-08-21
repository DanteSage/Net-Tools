const fs = require('fs');
const http = require('http');
const path = require('path');

const CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.gz': 'application/gzip',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
};

function getAllowedAssets(root) {
    const packetLensRoot = path.join(root, 'PacketLens');
    return new Map([
        ['/', path.join(packetLensRoot, 'index.html')],
        ['/index.html', path.join(packetLensRoot, 'index.html')],
        ['/GeoLite2-ASN.mmdb.gz', path.join(packetLensRoot, 'GeoLite2-ASN.mmdb.gz')],
        ['/GeoLite2-Country.mmdb.gz', path.join(packetLensRoot, 'GeoLite2-Country.mmdb.gz')],
        ['/integration.css', path.join(packetLensRoot, 'integration.css')],
        ['/integration.js', path.join(packetLensRoot, 'integration.js')],
        ['/styles/components/themes.css', path.join(root, 'styles', 'components', 'themes.css')]
    ]);
}

function sendError(response, statusCode, message) {
    response.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(message),
        'Cache-Control': 'no-store'
    });
    response.end(message);
}

function createRequestHandler(root) {
    const allowedAssets = getAllowedAssets(root);

    return function serveAsset(request, response) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.setHeader('Allow', 'GET, HEAD');
            sendError(response, 405, 'Method Not Allowed');
            return;
        }

        let pathname;
        try {
            pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        } catch (_) {
            sendError(response, 400, 'Bad Request');
            return;
        }

        const filePath = allowedAssets.get(pathname);
        if (!filePath || !fs.existsSync(filePath)) {
            sendError(response, 404, 'Not Found');
            return;
        }

        const stat = fs.statSync(filePath);
        response.writeHead(200, {
            'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': pathname.endsWith('.mmdb.gz') ? 'private, max-age=86400' : 'no-store',
            'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'",
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff'
        });
        if (request.method === 'HEAD') {
            response.end();
            return;
        }

        const stream = fs.createReadStream(filePath);
        stream.on('error', () => response.destroy());
        stream.pipe(response);
    };
}

function startServer(root) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(createRequestHandler(root));
        const handleError = (error) => {
            server.close();
            reject(error);
        };
        server.once('error', handleError);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', handleError);
            const address = server.address();
            resolve({ server, origin: `http://127.0.0.1:${address.port}` });
        });
    });
}

module.exports = { getAllowedAssets, startServer };
