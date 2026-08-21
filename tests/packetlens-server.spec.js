const { test, expect } = require('@playwright/test');
const path = require('path');
const { startServer } = require('../main/tools/packetlens-server');

test('serves only PacketLens application assets with hardening headers', async () => {
    const root = path.join(__dirname, '..');
    const { server, origin } = await startServer(root);

    try {
        const [page, integrationCss, integrationJs, country, traversal, post] = await Promise.all([
            fetch(`${origin}/index.html`),
            fetch(`${origin}/integration.css`),
            fetch(`${origin}/integration.js`),
            fetch(`${origin}/GeoLite2-Country.mmdb.gz`, { method: 'HEAD' }),
            fetch(`${origin}/package.json`),
            fetch(`${origin}/index.html`, { method: 'POST' })
        ]);

        expect(page.status).toBe(200);
        expect(page.headers.get('content-type')).toContain('text/html');
        expect(page.headers.get('content-security-policy')).toContain("object-src 'none'");
        expect(page.headers.get('x-content-type-options')).toBe('nosniff');
        const pageSource = await page.text();
        expect(pageSource.slice(0, 1000)).toContain('<title>PacketLens');
        expect(pageSource).not.toMatch(/addColorStop\([^\n]*var\(/);
        expect(pageSource).toContain("getPropertyValue('--primary-rgb')");
        expect(pageSource).toContain('function themePaint()');
        expect(pageSource).toContain('class="panel dev-info-panel"');
        expect(pageSource).toContain('class="dev-info-grid"');
        expect(pageSource).toContain("summaryEl.id = 'overviewSummary'");
        expect(pageSource).toContain("icon: 'shield'");
        expect(pageSource).toContain("icon: 'alert'");
        expect(pageSource).toContain("insightGrid.id = 'overviewInsightGrid'");
        expect(pageSource).toContain('class="find overview-finding ');
        expect(pageSource).toContain("TT('整体战况')");
        expect(pageSource).toContain('class="soc-verdict-lead"');
        expect(pageSource).toContain('class="soc-verdict-icon"');
        expect(pageSource).toContain("protoView: 'tree'");
        expect(pageSource).toContain('id="protoTreeView"');
        expect(pageSource).toContain('id="protoDistView"');
        expect(pageSource).toContain('aside.id = \'protoDistribution\'');
        expect(pageSource).toContain('function protoDistributionHtml(M)');

        expect(integrationCss.status).toBe(200);
        const integrationCssSource = await integrationCss.text();
        expect(integrationCssSource).toContain('html.light-theme #nav a.on');
        expect(integrationCssSource).toContain('html.light-theme ::-webkit-scrollbar-thumb');
        expect(integrationCssSource).toContain('html.light-theme .nrow .nh b');
        expect(integrationCssSource).toContain('html.light-theme .chstep');
        expect(integrationCssSource).toContain('html[data-theme="light"] .tribtn');
        expect(integrationCssSource).toContain('html[data-theme="light"] #socNote');
        expect(integrationCssSource).toContain('header.top .brand .lens');
        expect(integrationCssSource).toContain('#boot .brand');
        expect(integrationCssSource).toMatch(/#boot \.brand,\s*#boot \.tagline\s*\{\s*display:\s*none;/s);
        expect(integrationCssSource).toContain('#devInfoPanel .dev-info-main');
        expect(integrationCssSource).toContain('@container (max-width: 350px)');
        expect(integrationCssSource).not.toMatch(/\.dev-info-icon\s*\{[^}]*display:\s*none/s);
        expect(integrationCssSource).toContain('#overviewSummary #kpis');
        expect(integrationCssSource).toContain('#overviewSummary .overview-risk-ioc');
        expect(integrationCssSource).toContain('grid-template-columns: repeat(8, minmax(0, 1fr))');
        expect(integrationCssSource).toContain('#overviewInsightGrid #ovNarrative');
        expect(integrationCssSource).toContain('#overviewInsightGrid #ovFindings .overview-finding');
        expect(integrationCssSource).toContain('#overviewInsightGrid #ovMeta td:first-child');
        expect(integrationCssSource).toContain('section[data-v="situation"] > .soc-head');
        expect(integrationCssSource).toContain('section[data-v="situation"] > #socBar .soc-verdict-icon::before');
        expect(integrationCssSource).toContain('section[data-v="situation"] > #socBar .chstep.on');
        expect(integrationCssSource).toContain('section[data-v="situation"] > #socBar .trichip.t-confirmed');
        expect(integrationCssSource).toContain('grid-template-columns: minmax(210px, 17.65%) minmax(0, 1fr) minmax(250px, 21.45%)');
        expect(integrationCssSource).toContain('aspect-ratio: 6.9 / 1');
        expect(integrationCssSource).toContain('flex-wrap: nowrap');
        expect(integrationCssSource).not.toContain('padding-left: 58px');
        expect(integrationCssSource).not.toContain('minmax(170px, 185px)');
        expect(integrationCssSource).toContain('section[data-v="proto"] > .proto-head');
        expect(integrationCssSource).toContain('section[data-v="proto"].proto-distribution-on .proto-workspace');
        expect(integrationCssSource).toContain('section[data-v="proto"] .proto-layer.l3');
        expect(integrationCssSource).toContain('section[data-v="proto"] .proto-mini-area');
        expect(integrationCssSource).toContain('html[data-theme="light"] section[data-v="proto"]');

        expect(integrationJs.status).toBe(200);
        const integrationJsSource = await integrationJs.text();
        expect(integrationJsSource).toContain("window.dispatchEvent(new Event('resize'))");
        expect(integrationJsSource).toContain('function removeBootGithubLink()');
        expect(integrationJsSource).toContain("prefix.textContent.replace(/\\s*·\\s*$/, '')");
        expect(integrationJsSource).toContain("var text = '分析仅在本地完成，文件不会离开这台设备。'");
        expect(integrationJsSource).toContain('function updateBootContent()');

        expect(country.status).toBe(200);
        expect(Number(country.headers.get('content-length'))).toBeGreaterThan(1_000_000);
        expect(country.headers.get('content-type')).toBe('application/gzip');

        expect(traversal.status).toBe(404);
        expect(post.status).toBe(405);
        expect(post.headers.get('allow')).toBe('GET, HEAD');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
