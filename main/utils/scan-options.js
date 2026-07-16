const DEFAULT_SCAN_CONCURRENCY = 50;
const MAX_SCAN_CONCURRENCY = 200;

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

module.exports = {
    DEFAULT_SCAN_CONCURRENCY,
    MAX_SCAN_CONCURRENCY,
    normalizeScanConcurrency
};
