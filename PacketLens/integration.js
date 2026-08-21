(function () {
    'use strict';

    function applyTheme(theme) {
        if (!theme) return;
        var root = document.documentElement;
        var mode = theme.mode === 'light' ? 'light' : 'dark';
        root.classList.toggle('light-theme', mode === 'light');
        root.classList.toggle('light', mode === 'light');
        root.setAttribute('data-theme', mode);
        root.setAttribute('data-theme-name', theme.key || mode);

        // PacketLens charts are Canvas-based and need an explicit repaint after a live theme switch.
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                window.dispatchEvent(new Event('resize'));
            });
        });
    }

    function removeBootGithubLink() {
        var link = document.querySelector('#boot .privacy a[href*="github.com"]');
        if (!link) return;
        var prefix = link.previousSibling;
        if (prefix && prefix.nodeType === 3) {
            prefix.textContent = prefix.textContent.replace(/\s*·\s*$/, '');
        }
        link.remove();
    }

    function updateBootPrivacyCopy() {
        var copy = document.querySelector('#drop > .muted');
        if (!copy) return;
        var text = '分析仅在本地完成，文件不会离开这台设备。';
        copy.textContent = text;
        if (globalThis.PacketLensI18N && typeof globalThis.PacketLensI18N.add === 'function') {
            var translations = {};
            translations[text] = 'Analysis is completed locally; the file never leaves this device.';
            globalThis.PacketLensI18N.add(translations);
        }
    }

    function updateBootContent() {
        removeBootGithubLink();
        updateBootPrivacyCopy();
    }

    try {
        var query = new URLSearchParams(location.search);
        document.documentElement.classList.toggle('nettools-host', query.get('embedded') === '1');
        applyTheme({ mode: query.get('mode'), key: query.get('theme') });
    } catch (_) {}

    if (window.packetLensHost && typeof window.packetLensHost.onThemeChanged === 'function') {
        window.packetLensHost.onThemeChanged(applyTheme);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateBootContent, { once: true });
    } else {
        updateBootContent();
    }
})();
