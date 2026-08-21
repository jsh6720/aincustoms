// Google Sheets API integration for the requirements browser client.

const TABLE_NAME_MAP = {
    users: 'users',
    chemical_confirmation: 'chemical_confirmation',
    msds: 'msds',
    radio_law: 'radio_law',
    electrical_law: 'electrical_law',
    medical_device: 'medical_device',
    non_target: 'non_target',
    review_needed: 'review_needed'
};

const dataCache = {
    storage: {},
    ttl: 30 * 60 * 1000,

    get(key) {
        const cached = this.storage[key];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > this.ttl) {
            delete this.storage[key];
            return null;
        }
        return cached.data;
    },

    set(key, data) {
        this.storage[key] = { data, timestamp: Date.now() };
    },

    clear() {
        this.storage = {};
    },

    clearTable(tableName) {
        Object.keys(this.storage).forEach(key => {
            if (key === tableName || key.startsWith(`${tableName}_`)) {
                delete this.storage[key];
            }
        });
    }
};

function currentSession() {
    try {
        return JSON.parse(sessionStorage.getItem('ainRequirementsSession') || 'null');
    } catch (error) {
        sessionStorage.removeItem('ainRequirementsSession');
        dataCache.clear();
        return null;
    }
}

function mapApiErrorCodeToStatus(errorCode) {
    return {
        UNAUTHORIZED: 401,
        STALE_SESSION: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        SERVICE_UNAVAILABLE: 503
    }[errorCode] || 400;
}

const originalFetch = window.fetch;
const pendingTableReads = new Map();
let readCacheEpoch = 0;
const MAX_CONCURRENT_READS = 2;
const MAX_READ_ATTEMPTS = 3;
const READ_TIMEOUT_MS = 90000;
let activeReadCount = 0;
const queuedReads = [];

function activeSessionToken() {
    return currentSession()?.token || '';
}

function isCurrentSessionToken(token) {
    return activeSessionToken() === token;
}

function staleSessionResult() {
    return { success: false, error_code: 'STALE_SESSION' };
}

function staleRefreshResult() {
    return { success: false, error_code: 'STALE_REFRESH' };
}

function unavailableResult() {
    return { success: false, error_code: 'SERVICE_UNAVAILABLE', status: 503 };
}

function expireSessionForToken(token) {
    if (!token || !isCurrentSessionToken(token)) return false;
    sessionStorage.removeItem('ainRequirementsSession');
    dataCache.clear();
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('ain-requirements-session-expired'));
    }
    return true;
}

function runQueuedRead(task) {
    return new Promise((resolve) => {
        const start = () => {
            activeReadCount += 1;
            Promise.resolve(task()).then(resolve)
                .finally(() => {
                    activeReadCount -= 1;
                    const next = queuedReads.shift();
                    if (next) next();
                });
        };
        if (activeReadCount < MAX_CONCURRENT_READS) start();
        else queuedReads.push(start);
    });
}

async function callApi(action, params = {}, { anonymous = false, sessionToken, deferUnauthorized = false } = {}) {
    const token = anonymous ? '' : (sessionToken ?? activeSessionToken());
    const body = { action, ...params };
    if (!anonymous) body.token = token;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), READ_TIMEOUT_MS) : null;
    try {
        const response = await originalFetch(AIN_REQUIREMENTS_CONFIG.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(body),
            ...(controller ? { signal: controller.signal } : {})
        });
        const status = Number(response?.status) || 0;
        let parsed;
        try {
            parsed = JSON.parse(await response.text());
        } catch (error) {
            parsed = null;
        }
        if (status === 401 || status === 403) {
            const result = {
                success: false,
                error_code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
                status
            };
            if (result.error_code === 'UNAUTHORIZED' && !deferUnauthorized) {
                expireSessionForToken(token);
            }
            return result;
        }
        if (response?.ok === false || !parsed || typeof parsed !== 'object') {
            return {
                success: false,
                error_code: status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
                status
            };
        }
        if (parsed.success === false) {
            const result = { success: false, error_code: parsed.error_code || 'UPSTREAM_ERROR' };
            if (status) result.status = status;
            if (result.error_code === 'UNAUTHORIZED' && !deferUnauthorized) {
                expireSessionForToken(token);
            }
            return result;
        }
        return parsed;
    } catch (error) {
        return { success: false, error_code: 'NETWORK_ERROR' };
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function isRetryableReadFailure(result) {
    return result?.error_code === 'INTERNAL_ERROR' ||
        result?.error_code === 'NETWORK_ERROR' ||
        result?.status === 429 ||
        result?.status >= 500;
}

async function readDataWithRetries(mappedTable, token) {
    let result;
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
        if (!isCurrentSessionToken(token)) return staleSessionResult();
        result = await runQueuedRead(() => {
            if (!isCurrentSessionToken(token)) return staleSessionResult();
            return callApi('getData', { tableName: mappedTable }, {
                sessionToken: token,
                deferUnauthorized: true
            });
        });
        if (!isCurrentSessionToken(token)) return staleSessionResult();
        if (!isRetryableReadFailure(result)) return result;
    }
    return unavailableResult();
}
const GoogleSheetsAPI = {
    async call(action, params = {}, options = {}) {
        return callApi(action, params, options);
    },

    async login(username, password) {
        return this.call('login', { username, password }, { anonymous: true });
    },

    async getData(tableName) {
        const token = activeSessionToken();
        if (!token) {
            dataCache.clear();
        } else {
            const cached = dataCache.get(tableName);
            if (cached) return cached;
        }

        const mappedTable = TABLE_NAME_MAP[tableName] || tableName;
        const epoch = readCacheEpoch;
        const pendingKey = `${epoch}:${token}:${mappedTable}`;
        const existing = pendingTableReads.get(pendingKey);
        if (existing) return existing;

        const pending = (async () => {
            const result = await readDataWithRetries(mappedTable, token);
            if (epoch !== readCacheEpoch) return staleRefreshResult();
            if (!isCurrentSessionToken(token)) return staleSessionResult();
            if (!result.success) {
                if (result.error_code === 'UNAUTHORIZED') expireSessionForToken(token);
                return result;
            }

            const response = {
                data: result.data || [],
                total: result.total || (result.data ? result.data.length : 0),
                page: 1,
                limit: 10000
            };
            if (epoch !== readCacheEpoch) return staleRefreshResult();
            if (!isCurrentSessionToken(token)) return staleSessionResult();
            dataCache.set(tableName, response);
            return response;
        })();
        pendingTableReads.set(pendingKey, pending);
        try {
            return await pending;
        } finally {
            pendingTableReads.delete(pendingKey);
        }
    },
    async addData(tableName, data) {
        const mappedTable = TABLE_NAME_MAP[tableName] || tableName;
        const result = await this.call('addData', { tableName: mappedTable, data });
        if (result.success) dataCache.clearTable(tableName);
        return result;
    },

    async updateData(tableName, id, data) {
        const mappedTable = TABLE_NAME_MAP[tableName] || tableName;
        const result = await this.call('updateData', { tableName: mappedTable, id, data });
        if (result.success) dataCache.clearTable(tableName);
        return result;
    },

    async deleteData(tableName, id) {
        const mappedTable = TABLE_NAME_MAP[tableName] || tableName;
        const result = await this.call('deleteData', { tableName: mappedTable, id });
        if (result.success) dataCache.clearTable(tableName);
        return result;
    },

    clearAllCache() {
        readCacheEpoch += 1;
        dataCache.clear();
    }
};

function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function apiResultStatus(result, successStatus) {
    return result.success ? successStatus : mapApiErrorCodeToStatus(result.error_code);
}

window.fetch = function(url, options = {}) {
    if (typeof url !== 'string' || !url.startsWith('tables/')) {
        return originalFetch(url, options);
    }

    const urlParts = url.split('/');
    const tableName = urlParts[1].split('?')[0];
    const recordId = urlParts[2] ? urlParts[2].split('?')[0] : null;
    const method = options.method || 'GET';

    if (method === 'GET') {
        return GoogleSheetsAPI.getData(tableName).then(result => {
            if (result.success === false) {
                return jsonResponse(result, mapApiErrorCodeToStatus(result.error_code));
            }
            if (!recordId) return jsonResponse(result, 200);

            const record = result.data.find(item => String(item.id) === String(recordId));
            return record
                ? jsonResponse(record, 200)
                : jsonResponse({ success: false, error_code: 'NOT_FOUND', error: 'Record not found' }, 404);
        });
    }

    if (method === 'POST' && !recordId) {
        const data = JSON.parse(options.body);
        return GoogleSheetsAPI.addData(tableName, data)
            .then(result => jsonResponse(result, apiResultStatus(result, 201)));
    }

    if ((method === 'PUT' || method === 'PATCH') && recordId) {
        const data = JSON.parse(options.body);
        return GoogleSheetsAPI.updateData(tableName, recordId, data)
            .then(result => jsonResponse(result, apiResultStatus(result, 200)));
    }

    if (method === 'DELETE' && recordId) {
        return GoogleSheetsAPI.deleteData(tableName, recordId).then(result => {
            if (result.success) return new Response(null, { status: 204 });
            return jsonResponse(result, mapApiErrorCodeToStatus(result.error_code));
        });
    }

    return jsonResponse({ success: false, error: 'Unsupported request' }, 400);
};
