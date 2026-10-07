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
        STALE_SESSION: 409,
        STALE_REFRESH: 409,
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
const READ_TIMEOUT_MS = 60000;
const READ_BUDGET_MS = 90000; // Includes queueing and all retries, not per attempt.
let activeReadCount = 0;
const queuedReads = [];
const activeReadControllers = new Set();
let apiRequestSequence = 0;

function freshApiUrl() {
    // ContentService redirects must never replay an older request's response.
    const nonce = `${Date.now().toString(36)}-${++apiRequestSequence}-${Math.random().toString(36).slice(2)}`;
    const url = AIN_REQUIREMENTS_CONFIG.apiUrl;
    return `${url}${url.includes('?') ? '&' : '?'}_ainRequest=${nonce}`;
}

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

function drainReadQueue() {
    while (activeReadCount < MAX_CONCURRENT_READS && queuedReads.length > 0) {
        const entry = queuedReads.shift();
        if (entry.epoch !== readCacheEpoch) {
            entry.resolve(staleRefreshResult());
            continue;
        }
        activeReadCount += 1;
        let taskResult;
        try {
            taskResult = entry.epoch === readCacheEpoch ? entry.task() : staleRefreshResult();
        } catch (error) {
            taskResult = Promise.reject(error);
        }
        Promise.resolve(taskResult)
            .then(entry.resolve, entry.reject)
            .finally(() => {
                activeReadCount -= 1;
                drainReadQueue();
            });
    }
}

function runQueuedRead(task, epoch, deadline) {
    if (epoch !== readCacheEpoch) return Promise.resolve(staleRefreshResult());
    if (Date.now() >= deadline) return Promise.resolve(unavailableResult());
    return new Promise((resolve, reject) => {
        const entry = { task, epoch,
            resolve: value => { clearTimeout(timer); resolve(value); },
            reject: error => { clearTimeout(timer); reject(error); }
        };
        const timer = setTimeout(() => {
            const index = queuedReads.indexOf(entry);
            if (index >= 0) queuedReads.splice(index, 1);
            resolve(unavailableResult());
        }, Math.max(1, deadline - Date.now()));
        queuedReads.push(entry);
        drainReadQueue();
    });
}

async function callApi(action, params = {}, { anonymous = false, sessionToken, deferUnauthorized = false, readEpoch, timeoutMs } = {}) {
    const token = anonymous ? '' : (sessionToken ?? activeSessionToken());
    if (readEpoch !== undefined && readEpoch !== readCacheEpoch) return staleRefreshResult();
    const body = { action, ...params };
    if (!anonymous) body.token = token;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const activeRead = controller && readEpoch !== undefined ? { controller, epoch: readEpoch } : null;
    if (activeRead) activeReadControllers.add(activeRead);
    let timeout;
    let abortListener;
    try {
        if (readEpoch !== undefined && readEpoch !== readCacheEpoch) return staleRefreshResult();
        // Bound both headers and body, even when a fetch implementation ignores abort.
        const cancelled = new Promise((_, reject) => {
            abortListener = () => reject(new Error('REQUEST_CANCELLED'));
            controller?.signal.addEventListener('abort', abortListener, { once: true });
            timeout = setTimeout(() => {
                controller?.abort();
                reject(new Error('REQUEST_TIMEOUT'));
            }, timeoutMs ?? (action === 'getData' ? READ_TIMEOUT_MS : 90000));
        });
        const request = (async () => {
            const response = await originalFetch(freshApiUrl(), {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(body),
                ...(controller ? { signal: controller.signal } : {})
            });
            return { response, text: await response.text() };
        })();
        const { response, text } = await Promise.race([request, cancelled]);
        if (readEpoch !== undefined && readEpoch !== readCacheEpoch) return staleRefreshResult();
        const status = Number(response?.status) || 0;
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            parsed = null;
        }
        if (readEpoch !== undefined && readEpoch !== readCacheEpoch) return staleRefreshResult();
        if (status === 401 || status === 403) {
            const result = {
                success: false,
                error_code: status === 401
                    ? (parsed?.success === false && parsed.error_code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'SERVICE_UNAVAILABLE')
                    : 'FORBIDDEN',
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
        if (readEpoch !== undefined && readEpoch !== readCacheEpoch) return staleRefreshResult();
        return { success: false, error_code: 'NETWORK_ERROR' };
    } finally {
        if (timeout) clearTimeout(timeout);
        if (abortListener) controller?.signal.removeEventListener('abort', abortListener);
        if (activeRead) activeReadControllers.delete(activeRead);
    }
}

function isRetryableReadFailure(result) {
    return result?.error_code === 'INTERNAL_ERROR' ||
        result?.error_code === 'NETWORK_ERROR' ||
        result?.error_code === 'UPSTREAM_ERROR' ||
        result?.status === 429 ||
        result?.status >= 500;
}

async function readDataWithRetries(mappedTable, token, epoch) {
    const deadline = Date.now() + READ_BUDGET_MS;
    let result;
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
        if (epoch !== readCacheEpoch) return staleRefreshResult();
        if (!isCurrentSessionToken(token)) return staleSessionResult();
        if (Date.now() >= deadline) return unavailableResult();
        result = await runQueuedRead(() => {
            if (epoch !== readCacheEpoch) return staleRefreshResult();
            if (!isCurrentSessionToken(token)) return staleSessionResult();
            return callApi('getData', { tableName: mappedTable }, {
                sessionToken: token,
                deferUnauthorized: true,
                readEpoch: epoch,
                timeoutMs: Math.max(1, Math.min(READ_TIMEOUT_MS, deadline - Date.now()))
            });
        }, epoch, deadline);
        if (epoch !== readCacheEpoch) return staleRefreshResult();
        if (!isCurrentSessionToken(token)) return staleSessionResult();
        if (result?.success !== false && (result?.success !== true || !Array.isArray(result.data))) {
            result = { success: false, error_code: 'UPSTREAM_ERROR' };
        }
        if (!isRetryableReadFailure(result)) return result;
    }
    return epoch === readCacheEpoch ? unavailableResult() : staleRefreshResult();
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
            const result = await readDataWithRetries(mappedTable, token, epoch);
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

        for (let index = queuedReads.length - 1; index >= 0; index -= 1) {
            if (queuedReads[index].epoch !== readCacheEpoch) {
                const [stale] = queuedReads.splice(index, 1);
                stale.resolve(staleRefreshResult());
            }
        }
        activeReadControllers.forEach(read => {
            if (read.epoch !== readCacheEpoch) read.controller.abort();
        });
        drainReadQueue();
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
