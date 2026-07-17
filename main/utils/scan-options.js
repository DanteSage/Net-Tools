const DEFAULT_SCAN_CONCURRENCY = 50;
const MAX_SCAN_CONCURRENCY = 200;
const DEFAULT_SCAN_TIMEOUT_MS = 2000;
const MIN_SCAN_TIMEOUT_MS = 100;
const MAX_SCAN_TIMEOUT_MS = 30000;

function normalizeScanConcurrency(value) {
    if (value === null || value === undefined ||
        (typeof value === 'string' && !value.trim())) {
        return DEFAULT_SCAN_CONCURRENCY;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return DEFAULT_SCAN_CONCURRENCY;
    }

    return Math.max(1, Math.min(Math.trunc(numericValue), MAX_SCAN_CONCURRENCY));
}

function normalizeScanTimeout(value) {
    if (value === null || value === undefined ||
        (typeof value === 'string' && !value.trim())) {
        return DEFAULT_SCAN_TIMEOUT_MS;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return DEFAULT_SCAN_TIMEOUT_MS;
    }

    return Math.max(
        MIN_SCAN_TIMEOUT_MS,
        Math.min(Math.trunc(numericValue), MAX_SCAN_TIMEOUT_MS)
    );
}

module.exports = {
    DEFAULT_SCAN_CONCURRENCY,
    MAX_SCAN_CONCURRENCY,
    DEFAULT_SCAN_TIMEOUT_MS,
    MIN_SCAN_TIMEOUT_MS,
    MAX_SCAN_TIMEOUT_MS,
    normalizeScanConcurrency,
    normalizeScanTimeout
};
