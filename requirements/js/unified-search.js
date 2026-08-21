// 통합 검색 기능
// Version: 2.4.0 - 테이블별 검색 필드 확장(확인필요 description 등), 공백/하이픈 무시, 중복검색 방지

// 법령부호 매핑 함수
function getLawCode(lawName) {
    const lawMapping = {
        '가축전염병예방법': '13',
        '의료기기법': '72',
        '전파법': '39',
        '인체조직법': '74',
        '어린이제품특별법': '88',
        '수입식품안전관리 특별법': '89',
        '수입식품안전관리특별법': '89',
        '전안법': '23',
        '원안법': '53',
        '약사법': '01',
        '사료관리법': '10',
        '식물방역법': '12',
        '화생무기금지법': '27',
        '방위사업법': '34',
        '유해화학물질관리법': '41',
        '먹는물관리법': '44',
        '산업안전보건법': '48',
        '총포도검법': '55',
        '에너지이용합리화법': '64',
        '마약류관리법': '69',
        '화장품법': '70',
        '야생동식물보호법': '71',
        '통신비밀보호법': '75',
        '석면안전관리법': '81',
        '생활주변방사선법': '86',
        '생활살생물제법': '87',
        '위생용품관리법': '94'
    };

    // 법령명에서 키워드 검색 (부분 일치)
    for (const [key, code] of Object.entries(lawMapping)) {
        if (lawName && lawName.includes(key)) {
            return code;
        }
    }

    return '-';
}

// 통합 검색 중복 실행 방지 플래그
let isUnifiedSearching = false;

// 통합 검색 실행
async function performUnifiedSearch() {
    const viewRequest = beginRequirementsViewRequest('unified-search');
    const searchInput = document.getElementById('unifiedSearch');
    const searchValue = searchInput.value.trim();

    if (!searchValue) {
        alert('규격정제 또는 인증번호를 입력해주세요.');
        return;
    }

    isUnifiedSearching = true;
    const resultDiv = document.getElementById('unifiedSearchResult');
    resultDiv.innerHTML = '<div class="unified-result-empty"><i class="fas fa-spinner fa-spin"></i> 검색 중... (처음 검색은 데이터 로딩으로 다소 걸릴 수 있습니다)</div>';

    try {
        const results = await Promise.all([
            searchInTable('chemical_confirmation', searchValue),
            searchInTable('msds', searchValue),
            searchInTable('radio_law', searchValue),
            searchInTable('electrical_law', searchValue),
            searchInTable('medical_device', searchValue),
            searchInTable('non_target', searchValue),
            searchInTable('review_needed', searchValue)
        ]);
        if (!isCurrentRequirementsViewRequest(viewRequest) || results.some(result => result === null)) return;

        const [chemicalData, msdsData, radioData, electricalData, medicalData, nonTargetData, reviewNeededData] = results;
        displayUnifiedSearchResult({
            chemical: chemicalData,
            msds: msdsData,
            radio: radioData,
            electrical: electricalData,
            medical: medicalData,
            nonTarget: nonTargetData,
            reviewNeeded: reviewNeededData
        }, searchValue);
    } catch (error) {
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        console.error('통합 검색 오류');
        resultDiv.innerHTML = '<div class="unified-result-empty"><i class="fas fa-exclamation-triangle"></i> 검색 중 오류가 발생했습니다.</div>';
    } finally {
        if (isCurrentRequirementsViewRequest(viewRequest)) isUnifiedSearching = false;
    }
}

// 검색 비교용 문자열 정규화 (소문자 + 모든 공백/하이픈/특수문자 제거)
// 예: "R-R-YL0 Essence 380", "STD 85000-01" → "rryl0essence380", "std8500001"
function normalizeForSearch(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\u3000/g, '')        // 전각 공백 제거
        .replace(/[\s\-\_\/.,()·・~]/g, ''); // 일반공백, 하이픈, 언더바, 슬래시, 점, 쉼표, 괄호, 중점, 물결 제거
}

// 테이블별 통합검색 대상 필드 매핑
// (각 섹션 화면의 검색 필드와 동일하게 맞춰, 검색 결과 불일치를 방지)
const UNIFIED_SEARCH_FIELDS = {
    'chemical_confirmation': ['spec_no', 'product_name', 'model_spec', 'company'],
    'msds':                  ['spec_no', 'substance', 'importer'],
    'radio_law':             ['spec_no', 'model_name', 'derived_model_name', 'certification_no', 'consignee'],
    'electrical_law':        ['spec_no', 'model_name', 'derived_model_name', 'certification_no', 'consignee'],
    'medical_device':        ['spec_no', 'importer', 'model_name', 'permit_no', 'item_name_eng'],
    'non_target':            ['spec_no', 'law', 'importer', 'exporter', 'non_target_reason'],
    'review_needed':         ['spec_no', 'description', 'importer', 'exporter']
};

// 특정 테이블에서 검색 (테이블별 지정 필드 대상, 공백/하이픈 무시)
async function searchInTable(tableName, searchValue) {
    try {
        const response = await fetch(`tables/${tableName}?limit=1000`);
        if (response.status === 409) return null;
        if (!response.ok) return [];

        const result = await response.json();
        const data = Array.isArray(result) ? result : (result.data || []);
        const searchNorm = normalizeForSearch(searchValue);
        const fields = UNIFIED_SEARCH_FIELDS[tableName] || ['spec_no'];
        return data.filter(item =>
            fields.some(field => normalizeForSearch(item[field]).includes(searchNorm))
        );
    } catch (error) {
        console.error(`${tableName} 검색 오류`);
        return [];
    }
}

// 통합 검색 결과 표시
function displayUnifiedSearchResult(results, searchValue) {
    const resultDiv = document.getElementById('unifiedSearchResult');

    const totalCount = results.chemical.length + results.msds.length +
                      results.radio.length + results.electrical.length + results.medical.length +
                      (results.nonTarget ? results.nonTarget.length : 0) +
                      (results.reviewNeeded ? results.reviewNeeded.length : 0);

    if (totalCount === 0) {
        resultDiv.innerHTML = `
            <div class="unified-result-empty">
                <i class="fas fa-search"></i>
                <p>"${searchValue}"에 대한 검색 결과가 없습니다.</p>
            </div>
        `;
        return;
    }

    let html = `
        <div class="unified-result-card">
            <div class="unified-result-header">
                <i class="fas fa-list-check"></i> "${searchValue}" 검색 결과 (총 ${totalCount}건)
            </div>
            <div class="unified-result-grid">
    `;

    // 화학물질확인
    html += generateResultItem(
        '화학물질확인',
        'fas fa-flask',
        results.chemical.length > 0,
        results.chemical.length > 0 ? {
            수입자: results.chemical.map(r => r.company).filter((v, i, a) => a.indexOf(v) === i).join(', '),
            건수: `${results.chemical.length}건`
        } : null,
        'chemical'
    );

    // MSDS
    html += generateResultItem(
        'MSDS 등록/신고',
        'fas fa-file-medical',
        results.msds.length > 0,
        results.msds.length > 0 ? {
            수입자: results.msds.map(r => r.importer).filter((v, i, a) => a.indexOf(v) === i).join(', '),
            건수: `${results.msds.length}건`
        } : null,
        'msds'
    );

    // 전파법
    html += generateResultItem(
        '전파법',
        'fas fa-broadcast-tower',
        results.radio.length > 0,
        results.radio.length > 0 ? {
            화주: results.radio.map(r => r.consignee).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            인증번호: results.radio.map(r => r.certification_no).filter(v => v).join(', '),
            건수: `${results.radio.length}건`
        } : null,
        'radio'
    );

    // 전안법
    html += generateResultItem(
        '전안법',
        'fas fa-plug',
        results.electrical.length > 0,
        results.electrical.length > 0 ? {
            인증기관: results.electrical.map(r => r.certification_agency).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            화주: results.electrical.map(r => r.consignee).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            인증번호: results.electrical.map(r => r.certification_no).filter(v => v).join(', '),
            '비고(정격전압)': results.electrical.map(r => r.note).filter(v => v).join(', '),
            건수: `${results.electrical.length}건`
        } : null,
        'electrical'
    );

    // 의료기기/원안법 등
    html += generateResultItem(
        '의료기기/원안법 등',
        'fas fa-notes-medical',
        results.medical.length > 0,
        results.medical.length > 0 ? {
            법령부호: results.medical.map(r => r.law_code || getLawCode(r.law)).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            법령: results.medical.map(r => r.law).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            수입자: results.medical.map(r => r.importer).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            '확인 여부': results.medical.map(r => r.confirmation_status).filter(v => v).join(', '),
            건수: `${results.medical.length}건`
        } : null,
        'medical'
    );

    // 비대상
    html += generateResultItem(
        '비대상',
        'fas fa-times-circle',
        results.nonTarget && results.nonTarget.length > 0,
        results.nonTarget && results.nonTarget.length > 0 ? {
            법령부호: results.nonTarget.map(r => r.law_code || getLawCode(r.law)).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            법령: results.nonTarget.map(r => r.law).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            수입자: results.nonTarget.map(r => r.importer).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            수출자: results.nonTarget.map(r => r.exporter).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            '비대상 사유': results.nonTarget.map(r => r.non_target_reason).filter(v => v).join(', '),
            건수: `${results.nonTarget.length}건`
        } : null,
        'non_target'
    );

    // 확인 필요 List
    html += generateResultItem(
        '확인 필요 List',
        'fas fa-exclamation-triangle',
        results.reviewNeeded && results.reviewNeeded.length > 0,
        results.reviewNeeded && results.reviewNeeded.length > 0 ? {
            수입자상호: results.reviewNeeded.map(r => r.importer).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            해외공급처: results.reviewNeeded.map(r => r.exporter).filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
            비고: results.reviewNeeded.map(r => r.note).filter(v => v).join(', '),
            건수: `${results.reviewNeeded.length}건`
        } : null,
        'review_needed'
    );

    html += `
            </div>
        </div>
    `;

    resultDiv.innerHTML = html;
}

// 개별 결과 아이템 생성
function generateResultItem(title, icon, hasData, details, dataType) {
    const clickableClass = hasData ? 'clickable' : '';
    const onclickAttr = hasData ? `onclick="navigateToSection('${dataType}')"` : '';

    let html = `
        <div class="result-item ${hasData ? 'has-data' : ''} ${clickableClass}" ${onclickAttr}>
            <div class="result-item-header">
                <div class="result-item-title">
                    <i class="${icon}"></i> ${title}
                </div>
                <div class="result-status ${hasData ? 'registered' : 'not-registered'}">
                    ${hasData ? 'O' : 'X'}
                </div>
            </div>
    `;

    if (hasData && details) {
        html += '<div class="result-item-details">';
        for (const [key, value] of Object.entries(details)) {
            if (value) {
                html += `<div><strong>${key}:</strong> ${value}</div>`;
            }
        }
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// 통합검색에서 섹션으로 이동
async function navigateToSection(dataType) {
    const searchValue = document.getElementById('unifiedSearch').value.trim();
    const searchInputMap = {
        'chemical': 'chemicalSearch', 'msds': 'msdsSearch', 'radio': 'radioSearch',
        'electrical': 'electricalSearch', 'medical': 'medicalSearch',
        'non_target': 'non_targetSearch', 'review_needed': 'reviewNeededSearch'
    };
    const searchInput = document.getElementById(searchInputMap[dataType]);
    const menuItem = document.querySelector('.menu-item[data-section="' + dataType + '"]');
    if (!menuItem || !searchInput) return;
    searchInput.value = searchValue;
    searchInput.focus();
    window.__ainRequirementsPendingSectionSearch = { section: dataType, query: searchValue };
    const clickResult = menuItem.click();
    const loadPromise = window.__ainRequirementsMenuLoadPromise;
    if (loadPromise) await loadPromise;
    else await clickResult;
}

// 엔터키로 통합 검색
document.addEventListener('DOMContentLoaded', () => {
    const unifiedSearchInput = document.getElementById('unifiedSearch');
    if (unifiedSearchInput) {
        unifiedSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performUnifiedSearch();
            }
        });
    }
});

// 통합 다운로드 기능 제거됨 (성능 이슈로 인해 삭제)
