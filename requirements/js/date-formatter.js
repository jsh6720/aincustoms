// 날짜 포맷팅 유틸리티

/**
 * 날짜를 한국어 형식으로 포맷팅
 * @param {string|number|Date} dateValue - 날짜 값 (ISO 문자열, 타임스탬프, Date 객체)
 * @returns {string} 포맷팅된 날짜 문자열 (예: "2024-01-15" 또는 "2024. 1. 15.")
 */
function formatDate(dateValue) {
    if (!dateValue || dateValue === '-' || dateValue === '') {
        return '-';
    }

    try {
        let date;

        // 이미 YYYY-MM-DD 형식이면 그대로 반환
        if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
            return dateValue;
        }

        // ISO 문자열 (2012-06-17T15:00:00.000Z 형식)
        if (typeof dateValue === 'string' && dateValue.includes('T')) {
            date = new Date(dateValue);
        }
        // 타임스탬프 (밀리초)
        else if (typeof dateValue === 'number') {
            date = new Date(dateValue);
        }
        // Date 객체
        else if (dateValue instanceof Date) {
            date = dateValue;
        }
        // 기타 문자열
        else {
            date = new Date(dateValue);
        }

        // Invalid Date 체크
        if (isNaN(date.getTime())) {
            return dateValue; // 원본 반환
        }

        // YYYY-MM-DD 형식으로 반환
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;

    } catch (error) {
        console.warn('[Date Formatter] 날짜 파싱 실패:', dateValue, error);
        return dateValue; // 오류 시 원본 반환
    }
}

/**
 * 날짜와 시간을 한국어 형식으로 포맷팅
 * @param {string|number|Date} dateValue - 날짜 값
 * @returns {string} 포맷팅된 날짜/시간 문자열 (예: "2024. 1. 15. 오후 3:30:45")
 */
function formatDateTime(dateValue) {
    if (!dateValue || dateValue === '-' || dateValue === '') {
        return '-';
    }

    try {
        let date;

        // ISO 문자열
        if (typeof dateValue === 'string' && dateValue.includes('T')) {
            date = new Date(dateValue);
        }
        // 타임스탬프
        else if (typeof dateValue === 'number') {
            date = new Date(dateValue);
        }
        // Date 객체
        else if (dateValue instanceof Date) {
            date = dateValue;
        }
        // 기타
        else {
            date = new Date(dateValue);
        }

        // Invalid Date 체크
        if (isNaN(date.getTime())) {
            return dateValue;
        }

        // 한국어 로케일로 날짜/시간 포맷팅
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

    } catch (error) {
        console.warn('[Date Formatter] 날짜/시간 파싱 실패:', dateValue, error);
        return dateValue;
    }
}

/**
 * 날짜 필드인지 확인
 * @param {string} fieldName - 필드명
 * @returns {boolean} 날짜 필드 여부
 */
function isDateField(fieldName) {
    const dateFields = [
        'receipt_date', // 접수일자
        'created_at',
        'updated_at',
        'request_date',
        'approved_date',
        'rejected_date',
        'date',
        // 추가 날짜 필드가 있으면 여기에 추가
    ];

    return dateFields.includes(fieldName) ||
           fieldName.toLowerCase().includes('date') ||
           fieldName.toLowerCase().includes('날짜') ||
           fieldName.toLowerCase().includes('일자');
}

/**
 * 객체의 모든 날짜 필드를 포맷팅
 * @param {Object} obj - 대상 객체
 * @returns {Object} 날짜가 포맷팅된 새 객체
 */
function formatObjectDates(obj) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }

    const formatted = { ...obj };

    for (const key in formatted) {
        if (isDateField(key)) {
            formatted[key] = formatDate(formatted[key]);
        }
    }

    return formatted;
}

console.log('[Date Formatter] 날짜 포맷팅 유틸리티 로드됨');
