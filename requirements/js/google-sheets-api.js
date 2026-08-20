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
        FORBIDDEN: 403,
        NOT_FOUND: 404
    }[errorCode] || 400;
}

const originalFetch = window.fetch;

async function callApi(action, params = {}, { anonymous = false } = {}) {
    const session = currentSession();
    const body = { action, ...params };
    if (!anonymous) body.token = session?.token || '';

    try {
        const response = await originalFetch(AIN_REQUIREMENTS_CONFIG.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(body)
        });
        const result = await response.json();
        if (!result.success && result.error_code === 'UNAUTHORIZED') {
            sessionStorage.removeItem('ainRequirementsSession');
            dataCache.clear();
        }
        return result;
    } catch (error) {
        console.error(`[Google Sheets API] ${action} 오류:`, error);
        return { success: false, error_code: 'NETWORK_ERROR', error: error.message };
    }
}

const GoogleSheetsAPI = {
    async call(action, params = {}, options = {}) {
        return callApi(action, params, options);
    },

    async login(username, password) {
        return this.call('login', { username, password }, { anonymous: true });
    },

    async getData(tableName) {
        const session = currentSession();
        if (!session?.token) {
            dataCache.clear();
        } else {
            const cached = dataCache.get(tableName);
            if (cached) return cached;
        }

        const mappedTable = TABLE_NAME_MAP[tableName] || tableName;
        const result = await this.call('getData', { tableName: mappedTable });
        if (!result.success) return result;

        const response = {
            data: result.data || [],
            total: result.total || (result.data ? result.data.length : 0),
            page: 1,
            limit: 10000
        };
        dataCache.set(tableName, response);
        return response;
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
