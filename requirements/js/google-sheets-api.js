// ================================================
// Google Sheets API 통합 모듈 (v4.0 - Clean Version)
// ================================================
// CORS 문제 해결: 모든 요청을 POST 방식으로 전환
// 기존 fetch() 호출을 투명하게 가로채서 Google Sheets로 라우팅
// ================================================

const GOOGLE_SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycby3hhpd2Nk2K4dFu48g_Y1zhrmmGaRZvMWNNfi-CaNi8mfrzBnWUIlK73GDJKR_NH18Fw/exec';

// 테이블 이름 매핑 (Genspark → Google Sheets)
const TABLE_NAME_MAP = {
    'users': 'users',
    'chemical_confirmation': 'chemical_confirmation',
    'msds': 'msds',
    'radio_law': 'radio_law',
    'electrical_law': 'electrical_law',
    'medical_device': 'medical_device',
    'non_target': 'non_target',
    'review_needed': 'review_needed'
};

// 데이터 캐시 (30분간 유효, 수정/추가/삭제 시 자동 무효화)
const dataCache = {
    storage: {},
    ttl: 30 * 60 * 1000, // 30분
    
    get(key) {
        const cached = this.storage[key];
        if (!cached) return null;
        
        const now = Date.now();
        if (now - cached.timestamp > this.ttl) {
            // 캐시 만료
            delete this.storage[key];
            return null;
        }
        
        console.log(`[Cache] ✅ 캐시 히트: ${key}`);
        return cached.data;
    },
    
    set(key, data) {
        this.storage[key] = {
            data: data,
            timestamp: Date.now()
        };
        console.log(`[Cache] 💾 캐시 저장: ${key}`);
    },
    
    clear() {
        this.storage = {};
        console.log(`[Cache] 🗑️ 캐시 전체 삭제`);
    },
    
    clearTable(tableName) {
        Object.keys(this.storage).forEach(key => {
            if (key.startsWith(`${tableName}_`)) {
                delete this.storage[key];
            }
        });
        console.log(`[Cache] 🗑️ ${tableName} 캐시 삭제`);
    }
};

// Google Sheets API 헬퍼 함수
const GoogleSheetsAPI = {
    // POST 방식으로 통합 API 호출 (CORS 우회)
    async call(action, params = {}) {
        try {
            const requestBody = {
                action: action,
                ...params
            };

            console.log(`[Google Sheets API] ${action} 요청:`, params);

            const response = await fetch(GOOGLE_SHEETS_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain' // CORS 우회를 위해 text/plain 사용
                },
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();
            console.log(`[Google Sheets API] ${action} 응답:`, result.success ? '성공' : result.error);
            
            return result;
        } catch (error) {
            console.error(`[Google Sheets API] ${action} 오류:`, error);
            return { success: false, error: error.message };
        }
    },

    // 로그인
    async login(username, password) {
        return await this.call('login', { username, password });
    },

    // 데이터 조회 (캐싱 적용)
    async getData(tableName, username, role, companyName) {
        // 캐시 키 생성
        const cacheKey = `${tableName}_${username}_${role}`;
        
        // 캐시 확인
        const cached = dataCache.get(cacheKey);
        if (cached) {
            return cached;
        }
        
        // 캐시 미스 - API 호출
        const mappedTable = TABLE_NAME_MAP[tableName] || tableName;
        const result = await this.call('getData', {
            tableName: mappedTable,
            username,
            role,
            companyName
        });

        if (result.success) {
            // Genspark API 응답 형식으로 변환
            const response = {
                data: result.data || [],
                total: result.total || (result.data ? result.data.length : 0),
                page: 1,
                limit: 10000
            };
            
            // 데이터 건수 로그 (진단용)
            console.log(`[Google Sheets API] ${mappedTable} → ${response.data.length}건 수신`);
            
            // 캐시에 저장
            dataCache.set(cacheKey, response);
            
            return response;
        } else {
            console.warn(`[Google Sheets API] ${tableName} 조회 실패:`, result.error);
            return { data: [], total: 0, page: 1, limit: 10000 };
        }
    },

    // 데이터 추가
    async addData(tableName, data, username) {
        const mappedTable = TABLE_NAME_MAP[tableName] || tableName;
        const result = await this.call('addData', {
            tableName: mappedTable,
            username,
            data
        });
        
        // 성공 시 해당 테이블 캐시 삭제
        if (result.success) {
            dataCache.clearTable(tableName);
        }
        
        return result;
    },

    // 데이터 수정
    async updateData(tableName, id, data, username, role, companyName) {
        const mappedTable = TABLE_NAME_MAP[tableName] || tableName;
        const result = await this.call('updateData', {
            tableName: mappedTable,
            id,
            username,
            role,
            companyName,
            data
        });
        
        // 성공 시 해당 테이블 캐시 삭제
        if (result.success) {
            dataCache.clearTable(tableName);
        }
        
        return result;
    },

    // 데이터 삭제
    async deleteData(tableName, id, username, role, companyName) {
        const mappedTable = TABLE_NAME_MAP[tableName] || tableName;
        const result = await this.call('deleteData', {
            tableName: mappedTable,
            id,
            username,
            role,
            companyName
        });
        
        // 성공 시 해당 테이블 캐시 삭제
        if (result.success) {
            dataCache.clearTable(tableName);
        }
        
        return result;
    }
};

// ================================================
// fetch() 오버라이드 - 기존 코드 100% 호환
// ================================================
const originalFetch = window.fetch;

window.fetch = function(url, options = {}) {
    // tables/로 시작하는 요청만 가로채기
    if (typeof url === 'string' && url.startsWith('tables/')) {
        console.log(`[Fetch Override] 가로채기: ${url}`);

        // URL 파싱
        const urlParts = url.split('/');
        const tableNameWithParams = urlParts[1];
        const tableName = tableNameWithParams.split('?')[0];
        const recordId = urlParts[2] ? urlParts[2].split('?')[0] : null;

        // 현재 로그인 사용자 정보
        const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');

        if (!currentUser.username) {
            console.warn('[Fetch Override] 로그인 정보 없음, 빈 응답 반환');
            return Promise.resolve(new Response(JSON.stringify({ data: [], total: 0 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }));
        }

        const { username, role, company_name } = currentUser;

        // GET 요청 (데이터 조회)
        if (!options.method || options.method === 'GET') {
            return GoogleSheetsAPI.getData(tableName, username, role, company_name)
                .then(result => {
                    // 단일 레코드 조회 (recordId가 있는 경우)
                    if (recordId) {
                        const record = result.data.find(item => item.id === recordId);
                        if (record) {
                            console.log(`[Fetch Override] 단일 레코드 조회: ${recordId}`);
                            return new Response(JSON.stringify(record), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json' }
                            });
                        } else {
                            console.warn(`[Fetch Override] 레코드를 찾을 수 없음: ${recordId}`);
                            return new Response(JSON.stringify({ error: 'Record not found' }), {
                                status: 404,
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }
                    }
                    
                    // 전체 목록 조회
                    return new Response(JSON.stringify(result), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                });
        }

        // POST 요청 (데이터 추가)
        if (options.method === 'POST' && !recordId) {
            const data = JSON.parse(options.body);
            return GoogleSheetsAPI.addData(tableName, data, username)
                .then(result => {
                    return new Response(JSON.stringify(result), {
                        status: result.success ? 201 : 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                });
        }

        // PUT/PATCH 요청 (데이터 수정)
        if ((options.method === 'PUT' || options.method === 'PATCH') && recordId) {
            const data = JSON.parse(options.body);
            return GoogleSheetsAPI.updateData(tableName, recordId, data, username, role, company_name)
                .then(result => {
                    return new Response(JSON.stringify(result), {
                        status: result.success ? 200 : 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                });
        }

        // DELETE 요청 (데이터 삭제)
        if (options.method === 'DELETE' && recordId) {
            return GoogleSheetsAPI.deleteData(tableName, recordId, username, role, company_name)
                .then(result => {
                    if (result.success) {
                        // 캐시 무효화
                        dataCache.clearTable(tableName);
                        console.log(`[Fetch Override] ✅ 삭제 성공: ${recordId}`);
                        // 204 No Content는 body와 Content-Type 헤더 모두 없어야 함
                        return new Response(null, { status: 204 });
                    } else {
                        console.error(`[Fetch Override] ❌ 삭제 실패: ${result.error}`);
                        return new Response(JSON.stringify({ error: result.error }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                });
        }
    }

    // 그 외 요청은 원본 fetch 사용
    return originalFetch(url, options);
};

console.log('✅ Google Sheets API v4.0 초기화 완료');
console.log('📡 API URL:', GOOGLE_SHEETS_API_URL);
console.log('🔄 fetch() 오버라이드 활성화 (tables/* 요청 자동 변환)');
