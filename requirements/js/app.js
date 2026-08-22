// 메인 애플리케이션 로직

let currentSection = 'overview';
let currentDataType = '';
let currentDetailRecord = null;
let currentDetailRequestId = 0;
const requirementsViewGenerations = new Map();
let requirementsViewSessionGeneration = 0;

function beginRequirementsViewRequest(view) {
    const generation = (requirementsViewGenerations.get(view) || 0) + 1;
    requirementsViewGenerations.set(view, generation);
    return { view, generation, sessionGeneration: requirementsViewSessionGeneration };
}

function isCurrentRequirementsViewRequest(request) {
    return request.sessionGeneration === requirementsViewSessionGeneration &&
        requirementsViewGenerations.get(request.view) === request.generation;
}

function invalidateRequirementsViewRequests() {
    requirementsViewSessionGeneration += 1;
    requirementsViewGenerations.clear();
    currentDetailRequestId += 1;
}

function resetRequirementsSessionUI() {
    invalidateRequirementsViewRequests();
    clearCurrentDetailState();
    currentSection = 'overview';
    currentDataType = '';

    const detailModal = document.getElementById('detailModal');
    if (detailModal) detailModal.classList.remove('show');
    const detailTitle = document.getElementById('detailModalTitle');
    if (detailTitle) detailTitle.textContent = '';
    const inputModal = document.getElementById('inputModal');
    if (inputModal) {
        inputModal.classList.remove('show');
        inputModal.style.display = 'none';
    }
    const tableInput = document.getElementById('tableInput');
    if (tableInput) tableInput.value = '';
    const manualInputForm = document.getElementById('manualInputForm');
    if (manualInputForm) manualInputForm.innerHTML = '';
    const csvFileInput = document.getElementById('csvFileInput');
    if (csvFileInput) {
        csvFileInput.value = '';
        csvFileInput.onchange = null;
    }

    const editModal = document.getElementById('editModal');
    if (editModal) {
        editModal.classList.remove('show');
        editModal.style.display = 'none';
    }
    ['editFormContainer', 'modalContent'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.innerHTML = '';
    });
    currentEditRecord = null;

    document.querySelectorAll('[data-requirements-session-modal]').forEach(modal => modal.remove());

    [
        'chemicalTableBody', 'msdsTableBody', 'radioTableBody', 'electricalTableBody',
        'medicalTableBody', 'nonTargetTableBody', 'reviewNeededTableBody', 'editRequestsTableBody',
        'unifiedSearchResult'
    ].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.innerHTML = '';
    });

    ['statChemical', 'statMsds', 'statRadio', 'statElectrical', 'statMedical', 'statNonTarget']
        .forEach(id => {
            const element = document.getElementById(id);
            if (element) element.textContent = '';
        });

    [
        'unifiedSearch', 'chemicalSearch', 'msdsSearch', 'radioSearch', 'electricalSearch',
        'medicalSearch', 'non_targetSearch', 'reviewNeededSearch'
    ].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });

    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === 'overview') item.classList.add('active');
    });
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
        if (section.id === 'overviewSection') section.classList.add('active');
    });
    document.body?.classList?.remove('master-user');

    if (typeof allReviewData !== 'undefined') allReviewData = [];
    if (typeof currentReviewFilter !== 'undefined') currentReviewFilter = 'all';
    window.__ainRequirementsPendingSectionSearch = null;
    window.__ainRequirementsMenuLoadPromise = null;
    window.__ainRequirementsDuplicateModalRequest = null;
}

function setDetailDeleteActionEnabled(enabled) {
    const deleteButton = document.querySelector('#detailModal .btn-danger');
    if (!deleteButton) return;
    deleteButton.disabled = !enabled;
    deleteButton.style.display = enabled ? '' : 'none';
}

function clearCurrentDetailState() {
    currentDetailRecord = null;
    const detailContent = document.getElementById('detailContent');
    if (detailContent) detailContent.innerHTML = '';
    setDetailDeleteActionEnabled(false);
}

async function loadCurrentSection(searchQuery = '') {
    switch (currentSection) {
        case 'chemical': await loadChemicalData(searchQuery); break;
        case 'msds': await loadMsdsData(searchQuery); break;
        case 'radio': await loadRadioData(searchQuery); break;
        case 'electrical': await loadElectricalData(searchQuery); break;
        case 'medical': await loadMedicalData(searchQuery); break;
        case 'non_target': await loadNonTargetData(searchQuery); break;
        case 'review_needed':
            if (typeof loadReviewNeededData === 'function') await loadReviewNeededData(searchQuery);
            break;
        case 'editRequests':
            if (typeof loadEditRequests === 'function') await loadEditRequests();
            break;
    }
}

const REQUIREMENTS_SECTION_SEARCH_INPUTS = {
    chemical: 'chemicalSearch',
    msds: 'msdsSearch',
    radio: 'radioSearch',
    electrical: 'electricalSearch',
    medical: 'medicalSearch',
    non_target: 'non_targetSearch',
    review_needed: 'reviewNeededSearch'
};

async function activateRequirementsSection(section, searchQuery = null) {
    const menuItem = document.querySelector('.menu-item[data-section="' + section + '"]');
    const targetSection = document.getElementById(section + 'Section');
    const searchInputId = searchQuery === null ? null : REQUIREMENTS_SECTION_SEARCH_INPUTS[section];
    const searchInput = searchInputId ? document.getElementById(searchInputId) : null;
    if (!menuItem || !targetSection || (searchQuery !== null && !searchInput)) {
        console.warn('[App] Section or search input not found:', section);
        return false;
    }

    const query = searchQuery === null ? '' : String(searchQuery).trim();
    if (searchInput) {
        searchInput.value = query;
        searchInput.focus();
    }

    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    menuItem.classList.add('active');
    document.querySelectorAll('.content-section').forEach(item => item.classList.remove('active'));
    targetSection.classList.add('active');
    currentSection = section;

    const loadPromise = section === 'review_needed' && searchQuery !== null && typeof searchReviewNeeded === 'function'
        ? searchReviewNeeded()
        : loadCurrentSection(query);
    window.__ainRequirementsMenuLoadPromise = loadPromise;
    await loadPromise;
    return true;
}

async function clearAndReloadFromDatabase() {
    GoogleSheetsAPI.clearAllCache();
    await loadDashboard();
    await loadCurrentSection();
}

document.getElementById('databaseRefreshBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const originalContent = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> 새로고침 중...';
    try {
        await clearAndReloadFromDatabase();
        alert('Google Sheet 기준으로 새로고침했습니다.');
    } catch (error) {
        console.error('DB 기준 새로고침 오류:', error);
        alert('DB 기준 새로고침에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
        button.disabled = false;
        button.innerHTML = originalContent;
    }
});

// 대시보드 로드
async function loadDashboard() {
    const viewRequest = beginRequirementsViewRequest('dashboard');
    try {
        // 각 테이블을 개별적으로 로드하여 일부 실패해도 계속 진행
        const loadTableSafely = async (url, defaultValue = { data: [] }) => {
            try {
                const response = await fetch(url);
                if (response.status === 409) return null;
                if (!response.ok) {
                    console.warn(`테이블 로드 실패: ${url} (status: ${response.status})`);
                    return defaultValue;
                }
                return await response.json();
            } catch (error) {
                console.warn(`테이블 로드 오류: ${url}`, error);
                return defaultValue;
            }
        };

        // 통계 데이터 로드 (실패해도 계속 진행)
        const [chemicalData, msdsData, radioData, electricalData, medicalData, nonTargetData] = await Promise.all([
            loadTableSafely('tables/chemical_confirmation?limit=1000'),
            loadTableSafely('tables/msds?limit=1000'),
            loadTableSafely('tables/radio_law?limit=1000'),
            loadTableSafely('tables/electrical_law?limit=1000'),
            loadTableSafely('tables/medical_device?limit=1000'),
            loadTableSafely('tables/non_target?limit=1000')
        ]);

        if (!isCurrentRequirementsViewRequest(viewRequest) ||
            [chemicalData, msdsData, radioData, electricalData, medicalData, nonTargetData].some(data => data === null)) {
            return;
        }

        // 통합검색 성능 개선: 확인필요 List도 백그라운드에서 미리 캐시 (await 안 함)
        loadTableSafely('tables/review_needed?limit=1000');

        // 권한에 따라 필터링
        const filterByUser = (data) => {
            if (isMasterUser()) return data;
            return data.filter(item => canAccessData(item.importer || item.consignee || item.created_by));
        };

        const filteredChemical = filterByUser(chemicalData.data || []);
        const filteredMsds = filterByUser(msdsData.data || []);
        const filteredRadio = filterByUser(radioData.data || []);
        const filteredElectrical = filterByUser(electricalData.data || []);
        const filteredMedical = filterByUser(medicalData.data || []);
        const filteredNonTarget = filterByUser(nonTargetData.data || []);

        // 통계 업데이트
        document.getElementById('statChemical').textContent = filteredChemical.length;
        document.getElementById('statMsds').textContent = filteredMsds.length;
        document.getElementById('statRadio').textContent = filteredRadio.length;
        document.getElementById('statElectrical').textContent = filteredElectrical.length;
        document.getElementById('statMedical').textContent = filteredMedical.length;
        document.getElementById('statNonTarget').textContent = filteredNonTarget.length;

    } catch (error) {
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        console.error('대시보드 로드 오류:', error);
        // 치명적인 오류만 알림 표시
        alert('대시보드 초기화 중 오류가 발생했습니다.\n\n' +
              '페이지를 새로고침해주세요.\n' +
              '상세 정보: ' + error.message);
    }
}

// 화학물질확인 데이터 로드
async function loadChemicalData(searchQuery = '') {
    const viewRequest = beginRequirementsViewRequest('list:chemical');
    try {
        const response = await fetch('tables/chemical_confirmation?limit=1000');
        if (!isCurrentRequirementsViewRequest(viewRequest) || response.status === 409) return;

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;

        let records = data.data || [];

        // Google Sheets API는 서버에서 이미 권한 필터링됨
        // 클라이언트 측 필터링 불필요

        // 검색 필터링
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            records = records.filter(item =>
                String(item.spec_no || '').toLowerCase().includes(query) ||
                String(item.product_name || '').toLowerCase().includes(query) ||
                String(item.model_spec || '').toLowerCase().includes(query) ||
                String(item.company || '').toLowerCase().includes(query)
            );
        }

        // 최신순 정렬 (created_at 기준 내림차순)
        records.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        // 테이블 렌더링
        const tbody = document.getElementById('chemicalTableBody');
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="empty-state"><i class="fas fa-inbox"></i><p>데이터가 없습니다.</p></td></tr>';
            return;
        }

        records.forEach(record => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="checkbox-cell">
                    <input type="checkbox" class="row-checkbox" data-id="${record.id}" data-type="chemical" onchange="updateSelectionCount('chemical')">
                </td>
                <td>${record.spec_no || '-'}</td>
                <td>${formatDate(record.receipt_date)}</td>
                <td>${record.receipt_number || '-'}</td>
                <td>${record.status || '-'}</td>
                <td>${record.company || '-'}</td>
                <td>${record.product_name || '-'}</td>
                <td>${record.model_spec || '-'}</td>
                <td>${record.import_country || '-'}</td>
                <td>${record.hsk_no || '-'}</td>
                <td>
                    <button class="action-btn btn-view" onclick="viewDetail('chemical', '${record.id}')">
                        <i class="fas fa-eye"></i> 보기
                    </button>
                    <button class="action-btn btn-edit" onclick="editRecord('chemical', '${record.id}')">
                        <i class="fas fa-edit"></i> 수정
                    </button>
                    ${isMasterUser() ? `<button class="action-btn btn-delete" onclick="deleteRecord('chemical', '${record.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });

    } catch (error) {
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        console.error('화학물질확인 데이터 로드 오류:', error);
        const tbody = document.getElementById('chemicalTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="11" class="empty-state" style="color: red;"><i class="fas fa-exclamation-triangle"></i><p>데이터를 불러올 수 없습니다.</p><p style="font-size: 12px;">테이블이 존재하지 않거나 네트워크 오류가 발생했습니다.</p></td></tr>';
        }
    }
}

// MSDS 혼합/단일 시약 분류 함수
function classifyMsdsMixtureType(records) {
    // 제외할 CAS No 목록 (물 = 7732-18-5)
    const EXCLUDED_CAS = ['7732-18-5'];

    // 규격정제별로 그룹화
    const groupedBySpec = {};
    records.forEach(record => {
        const specNo = record.spec_no;
        if (!specNo) return;

        if (!groupedBySpec[specNo]) {
            groupedBySpec[specNo] = [];
        }
        groupedBySpec[specNo].push(record);
    });

    // 각 규격정제별로 혼합/단일 분류
    Object.keys(groupedBySpec).forEach(specNo => {
        const specRecords = groupedBySpec[specNo];

        // 1. 제외 물질을 제외한 유효 물질 개수 계산
        const validSubstances = specRecords.filter(r => {
            const substance = (r.substance || '').trim();
            return substance && !EXCLUDED_CAS.includes(substance);
        });

        const uniqueValidSubstances = [...new Set(validSubstances.map(r => r.substance))];

        // 2. 비중의 합 계산 (숫자로 변환 가능한 것만)
        let totalGravity = 0;
        specRecords.forEach(r => {
            const gravity = parseFloat(r.specific_gravity);
            if (!isNaN(gravity)) {
                totalGravity += gravity;
            }
        });

        // 3. 분류 로직
        let mixtureType = '';

        if (uniqueValidSubstances.length === 0) {
            // 유효 물질이 없으면 단일시약 (물만 있는 경우)
            mixtureType = '단일시약';
        } else if (uniqueValidSubstances.length === 1) {
            // 유효 물질이 1개인 경우
            if (totalGravity < 100) {
                // 비중 합이 100 미만이면 혼합시약(LOC)
                mixtureType = '혼합시약(LOC)';
            } else {
                // 비중 합이 100 이상이면 단일시약
                mixtureType = '단일시약';
            }
        } else {
            // 유효 물질이 2개 이상이면 혼합시약
            mixtureType = '혼합시약';
        }

        // 4. 모든 레코드에 분류 결과 적용
        specRecords.forEach(record => {
            record.mixture_type = mixtureType;
        });
    });

    return records;
}

// MSDS 데이터 로드
async function loadMsdsData(searchQuery = '') {
    const viewRequest = beginRequirementsViewRequest('list:msds');
    try {
        const response = await fetch('tables/msds?limit=1000');
        if (!isCurrentRequirementsViewRequest(viewRequest) || response.status === 409) return;

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;

        let records = data.data || [];

        // 혼합/단일 시약 자동 분류
        records = classifyMsdsMixtureType(records);

        // 권한 필터링 (정규화된 회사명으로 비교)
        if (!isMasterUser()) {
            records = records.filter(item => canAccessData(item.importer));
        }

        // 검색 필터링
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            records = records.filter(item =>
                String(item.spec_no || '').toLowerCase().includes(query) ||
                String(item.substance || '').toLowerCase().includes(query) ||
                String(item.importer || '').toLowerCase().includes(query)
            );
        }

        // 최신순 정렬 (created_at 기준 내림차순)
        records.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        // 테이블 렌더링
        const tbody = document.getElementById('msdsTableBody');
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="empty-state"><i class="fas fa-inbox"></i><p>데이터가 없습니다.</p></td></tr>';
            return;
        }

        records.forEach(record => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="checkbox-cell">
                    <input type="checkbox" class="row-checkbox" data-id="${record.id}" data-type="msds" onchange="updateSelectionCount('msds')">
                </td>
                <td>${record.importer || '-'}</td>
                <td>${record.spec_no || '-'}</td>
                <td>${record.internal_mgmt_no || '-'}</td>
                <td>${record.substance || '-'}</td>
                <td>${record.specific_gravity || '-'}</td>
                <td>${record.existing_new || '-'}</td>
                <td>${record.hazardous || '-'}</td>
                <td>${record.note || '-'}</td>
                <td><strong>${record.mixture_type || '-'}</strong></td>
                <td>
                    <button class="action-btn btn-view" onclick="viewDetail('msds', '${record.id}')">
                        <i class="fas fa-eye"></i> 보기
                    </button>
                    <button class="action-btn btn-edit" onclick="editRecord('msds', '${record.id}')">
                        <i class="fas fa-edit"></i> 수정
                    </button>
                    ${isMasterUser() ? `<button class="action-btn btn-delete" onclick="deleteRecord('msds', '${record.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });

    } catch (error) {
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        console.error('MSDS 데이터 로드 오류:', error);
        const tbody = document.getElementById('msdsTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="11" class="empty-state" style="color: red;"><i class="fas fa-exclamation-triangle"></i><p>데이터를 불러올 수 없습니다.</p><p style="font-size: 12px;">테이블이 존재하지 않거나 네트워크 오류가 발생했습니다.</p></td></tr>';
        }
    }
}

// 전파법 데이터 로드
async function loadRadioData(searchQuery = '') {
    const viewRequest = beginRequirementsViewRequest('list:radio');
    try {
        const response = await fetch('tables/radio_law?limit=1000');
        if (!isCurrentRequirementsViewRequest(viewRequest) || response.status === 409) return;

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;

        let records = data.data || [];

        // 권한 필터링 (정규화된 회사명으로 비교)
        if (!isMasterUser()) {
            records = records.filter(item => canAccessData(item.consignee));
        }

        // 검색 필터링
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            records = records.filter(item =>
                String(item.spec_no || '').toLowerCase().includes(query) ||
                String(item.model_name || '').toLowerCase().includes(query) ||
                String(item.manufacturer || '').toLowerCase().includes(query) ||
                String(item.item_name || '').toLowerCase().includes(query) ||
                String(item.derived_model_name || '').toLowerCase().includes(query) ||
                String(item.certification_no || '').toLowerCase().includes(query)
            );
        }

        // 최신순 정렬 (created_at 기준 내림차순)
        records.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        // 테이블 렌더링
        const tbody = document.getElementById('radioTableBody');
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="12" class="empty-state"><i class="fas fa-inbox"></i><p>데이터가 없습니다.</p></td></tr>';
            return;
        }

        records.forEach(record => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="checkbox-cell">
                    <input type="checkbox" class="row-checkbox" data-id="${record.id}" data-type="radio" onchange="updateSelectionCount('radio')">
                </td>
                <td>${record.spec_no || '-'}</td>
                <td>${record.consignee || '-'}</td>
                <td>${record.model_name || '-'}</td>
                <td>${record.note || '-'}</td>
                <td>${record.manufacturer || '-'}</td>
                <td>${record.manufacturing_country || '-'}</td>
                <td>${record.certification_no || '-'}</td>
                <td>${formatDate(record.certification_date)}</td>
                <td>${record.item_name || '-'}</td>
                <td>${record.derived_model_name || '-'}</td>
                <td>
                    <button class="action-btn btn-view" onclick="viewDetail('radio', '${record.id}')">
                        <i class="fas fa-eye"></i> 보기
                    </button>
                    <button class="action-btn btn-edit" onclick="editRecord('radio', '${record.id}')">
                        <i class="fas fa-edit"></i> 수정
                    </button>
                    ${isMasterUser() ? `<button class="action-btn btn-delete" onclick="deleteRecord('radio', '${record.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });

    } catch (error) {
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        console.error('전파법 데이터 로드 오류:', error);
        const tbody = document.getElementById('radioTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="12" class="empty-state" style="color: red;"><i class="fas fa-exclamation-triangle"></i><p>데이터를 불러올 수 없습니다.</p><p style="font-size: 12px;">테이블이 존재하지 않거나 네트워크 오류가 발생했습니다.</p></td></tr>';
        }
    }
}

// 전안법 데이터 로드
async function loadElectricalData(searchQuery = '') {
    const viewRequest = beginRequirementsViewRequest('list:electrical');
    try {
        const response = await fetch('tables/electrical_law?limit=1000');
        if (!isCurrentRequirementsViewRequest(viewRequest) || response.status === 409) return;

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;

        let records = data.data || [];

        // 권한 필터링 (정규화된 회사명으로 비교)
        if (!isMasterUser()) {
            records = records.filter(item => canAccessData(item.consignee));
        }

        // 검색 필터링
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            records = records.filter(item =>
                String(item.spec_no || '').toLowerCase().includes(query) ||
                String(item.model_name || '').toLowerCase().includes(query) ||
                String(item.manufacturer || '').toLowerCase().includes(query) ||
                String(item.item_name || '').toLowerCase().includes(query) ||
                String(item.consignee || '').toLowerCase().includes(query) ||
                String(item.derived_model_name || '').toLowerCase().includes(query) ||
                String(item.certification_no || '').toLowerCase().includes(query)
            );
        }

        // 최신순 정렬 (created_at 기준 내림차순)
        records.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        // 테이블 렌더링
        const tbody = document.getElementById('electricalTableBody');
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="13" class="empty-state"><i class="fas fa-inbox"></i><p>데이터가 없습니다.</p></td></tr>';
            return;
        }

        records.forEach(record => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="checkbox-cell">
                    <input type="checkbox" class="row-checkbox" data-id="${record.id}" data-type="electrical" onchange="updateSelectionCount('electrical')">
                </td>
                <td>${record.spec_no || '-'}</td>
                <td>${record.certification_agency || '-'}</td>
                <td>${record.consignee || '-'}</td>
                <td>${record.model_name || '-'}</td>
                <td>${record.note || '-'}</td>
                <td>${record.manufacturer || '-'}</td>
                <td>${record.manufacturing_country || '-'}</td>
                <td>${record.certification_no || '-'}</td>
                <td>${formatDate(record.certification_date)}</td>
                <td>${record.item_name || '-'}</td>
                <td>${record.derived_model_name || '-'}</td>
                <td>
                    <button class="action-btn btn-view" onclick="viewDetail('electrical', '${record.id}')">
                        <i class="fas fa-eye"></i> 보기
                    </button>
                    <button class="action-btn btn-edit" onclick="editRecord('electrical', '${record.id}')">
                        <i class="fas fa-edit"></i> 수정
                    </button>
                    ${isMasterUser() ? `<button class="action-btn btn-delete" onclick="deleteRecord('electrical', '${record.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });

    } catch (error) {
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        console.error('전안법 데이터 로드 오류:', error);
        const tbody = document.getElementById('electricalTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="13" class="empty-state" style="color: red;"><i class="fas fa-exclamation-triangle"></i><p>데이터를 불러올 수 없습니다.</p><p style="font-size: 12px;">테이블이 존재하지 않거나 네트워크 오류가 발생했습니다.</p></td></tr>';
        }
    }
}

// 의료기기 데이터 로드
async function loadMedicalData(searchQuery = '') {
    const viewRequest = beginRequirementsViewRequest('list:medical');
    try {
        const response = await fetch('tables/medical_device?limit=1000');
        if (!isCurrentRequirementsViewRequest(viewRequest) || response.status === 409) return;

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;

        let records = data.data || [];

        // 권한 필터링 (정규화된 회사명으로 비교)
        if (!isMasterUser()) {
            records = records.filter(item => canAccessData(item.importer));
        }

        // 검색 필터링
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            records = records.filter(item =>
                String(item.spec_no || '').toLowerCase().includes(query) ||
                String(item.importer || '').toLowerCase().includes(query) ||
                String(item.model_name || '').toLowerCase().includes(query) ||
                String(item.permit_no || '').toLowerCase().includes(query) ||
                String(item.item_name_eng || '').toLowerCase().includes(query)
            );
        }

        // 최신순 정렬 (created_at 기준 내림차순)
        records.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        // 테이블 렌더링
        const tbody = document.getElementById('medicalTableBody');
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-inbox"></i><p>데이터가 없습니다.</p></td></tr>';
            return;
        }

        records.forEach(record => {
            // 법령부호 자동 계산
            const lawCode = record.law_code || getLawCode(record.law);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="checkbox-cell">
                    <input type="checkbox" class="row-checkbox" data-id="${record.id}" data-type="medical" onchange="updateSelectionCount('medical')">
                </td>
                <td>${record.spec_no || '-'}</td>
                <td>${lawCode}</td>
                <td>${record.law || '-'}</td>
                <td>${record.importer || '-'}</td>
                <td>${record.exporter || '-'}</td>
                <td>${record.confirmation_status || '-'}</td>
                <td>
                    <button class="action-btn btn-view" onclick="viewDetail('medical', '${record.id}')">
                        <i class="fas fa-eye"></i> 보기
                    </button>
                    <button class="action-btn btn-edit" onclick="editRecord('medical', '${record.id}')">
                        <i class="fas fa-edit"></i> 수정
                    </button>
                    ${isMasterUser() ? `<button class="action-btn btn-delete" onclick="deleteRecord('medical', '${record.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });

    } catch (error) {
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        console.error('의료기기 데이터 로드 오류:', error);
        const tbody = document.getElementById('medicalTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state" style="color: red;"><i class="fas fa-exclamation-triangle"></i><p>데이터를 불러올 수 없습니다.</p><p style="font-size: 12px;">테이블이 존재하지 않거나 네트워크 오류가 발생했습니다.</p></td></tr>';
        }
    }
}

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

// 비대상 데이터 로드
async function loadNonTargetData(searchQuery = '') {
    const viewRequest = beginRequirementsViewRequest('list:non_target');
    try {
        const response = await fetch('tables/non_target?limit=1000');
        if (!isCurrentRequirementsViewRequest(viewRequest) || response.status === 409) return;

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;

        let records = data.data || [];

        // 권한 필터링 (정규화된 회사명으로 비교)
        if (!isMasterUser()) {
            records = records.filter(item => canAccessData(item.importer));
        }

        // 검색 필터링
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            records = records.filter(item =>
                String(item.spec_no || '').toLowerCase().includes(query) ||
                String(item.law || '').toLowerCase().includes(query) ||
                String(item.importer || '').toLowerCase().includes(query) ||
                String(item.exporter || '').toLowerCase().includes(query) ||
                String(item.non_target_reason || '').toLowerCase().includes(query)
            );
        }

        // 최신순 정렬 (created_at 기준 내림차순)
        records.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        // 테이블 렌더링
        const tbody = document.getElementById('nonTargetTableBody');
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-inbox"></i><p>데이터가 없습니다.</p></td></tr>';
            return;
        }

        records.forEach(record => {
            // 법령부호 자동 계산
            const lawCode = record.law_code || getLawCode(record.law);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="checkbox-cell">
                    <input type="checkbox" class="row-checkbox" data-id="${record.id}" data-type="non_target" onchange="updateSelectionCount('non_target')">
                </td>
                <td>${record.spec_no || '-'}</td>
                <td>${lawCode}</td>
                <td>${record.law || '-'}</td>
                <td>${record.importer || '-'}</td>
                <td>${record.exporter || '-'}</td>
                <td>${record.non_target_reason || '-'}</td>
                <td>
                    <button class="action-btn btn-view" onclick="viewDetail('non_target', '${record.id}')">
                        <i class="fas fa-eye"></i> 보기
                    </button>
                    <button class="action-btn btn-edit" onclick="editRecord('non_target', '${record.id}')">
                        <i class="fas fa-edit"></i> 수정
                    </button>
                    ${isMasterUser() ? `<button class="action-btn btn-delete" onclick="deleteRecord('non_target', '${record.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });

    } catch (error) {
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        console.error('비대상 데이터 로드 오류:', error);
        const tbody = document.getElementById('nonTargetTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state" style="color: red;"><i class="fas fa-exclamation-triangle"></i><p>데이터를 불러올 수 없습니다.</p><p style="font-size: 12px;">테이블이 존재하지 않거나 네트워크 오류가 발생했습니다.</p></td></tr>';
        }
    }
}

// 검색 기능
function searchData(type) {
    // review_needed는 검색창 id가 다르므로(reviewNeededSearch) 전용 함수로 위임
    if (type === 'review_needed') {
        searchReviewNeeded();
        return;
    }

    const searchInput = document.getElementById(`${type}Search`);

    // null 체크
    if (!searchInput) {
        console.error(`검색 입력창을 찾을 수 없습니다: ${type}Search`);
        return;
    }

    const query = searchInput.value.trim();

    switch(type) {
        case 'chemical':
            loadChemicalData(query);
            break;
        case 'msds':
            loadMsdsData(query);
            break;
        case 'radio':
            loadRadioData(query);
            break;
        case 'electrical':
            loadElectricalData(query);
            break;
        case 'medical':
            loadMedicalData(query);
            break;
        case 'non_target':
            loadNonTargetData(query);
            break;
        case 'review_needed':
            searchReviewNeeded();
            break;
    }
}

// 엔터키로 검색
document.addEventListener('DOMContentLoaded', () => {
    ['chemical', 'msds', 'radio', 'electrical', 'medical', 'non_target'].forEach(type => {
        const searchInput = document.getElementById(`${type}Search`);
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    searchData(type);
                }
            });
        }
    });
});

// 데이터 상세보기
async function viewDetail(type, recordId) {
    const requestId = ++currentDetailRequestId;
    currentDetailRecord = null;
    setDetailDeleteActionEnabled(false);

    try {
        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };

        const response = await fetch('tables/' + tableMap[type] + '/' + recordId);
        if (requestId !== currentDetailRequestId) return;

        if (!response.ok) {
            clearCurrentDetailState();
            if (response.status === 409 || response.status === 401) return;

            const message = {
                403: '이 데이터에 접근 권한이 없습니다.',
                404: '요청한 데이터를 찾을 수 없습니다.',
                503: '일시적인 오류입니다. 잠시 후 다시 시도해주세요.'
            }[response.status] || '상세 정보를 불러오는 중 오류가 발생했습니다.';
            const detailContent = document.getElementById('detailContent');
            detailContent.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>' + message + '</p></div>';
            document.getElementById('detailModalTitle').textContent = getTypeLabel(type) + ' 상세정보';
            document.getElementById('detailModal').classList.add('show');
            return;
        }

        const record = await response.json();
        if (requestId !== currentDetailRequestId) return;
        if (!record || record.success === false) {
            clearCurrentDetailState();
            return;
        }

        currentDetailRecord = { type, id: recordId };

        // 상세정보 표시
        const detailContent = document.getElementById('detailContent');
        detailContent.innerHTML = '<div class="detail-grid">' +
            Object.keys(record)
                .filter(key => !key.startsWith('gs_') && key !== 'id')
                .map(key => {
                    // 날짜 필드는 포맷팅
                    let value = record[key] || '-';
                    if (isDateField(key)) {
                        value = formatDate(value);
                    }
                    return `
                        <div class="detail-item">
                            <label>${getFieldLabel(key)}</label>
                            <value>${value}</value>
                        </div>
                    `;
                }).join('') +
            '</div>';

        document.getElementById('detailModalTitle').textContent = `${getTypeLabel(type)} 상세정보`;
        document.getElementById('detailModal').classList.add('show');
        setDetailDeleteActionEnabled(true);

    } catch (error) {
        if (requestId !== currentDetailRequestId) return;
        clearCurrentDetailState();
        console.error('상세보기 오류:', error);
        alert('상세정보를 불러오는 중 오류가 발생했습니다.');
    }
}

// 필드 라벨 가져오기
function getFieldLabel(key) {
    const labels = {
        'spec_no': '규격정제',
        'no': 'No',
        'receipt_date': '접수일자',
        'receipt_number': '접수번호',
        'status': '상태',
        'company': '상호',
        'manager': '담당자',
        'user': '사용자',
        'product_name': '제품명',
        'model_spec': '모델·규격',
        'import_country': '수입국',
        'annual_import_qty': '연간수입예정량',
        'hsk_no': 'HSK No',
        'division': '구분',
        'usage': '사용여부',
        'agent': '대리인',
        'save_date': '저장일자',
        'department': '소속',
        'importer': '수입자/화주',
        'internal_mgmt_no': '내부관리 No',
        'substance': '물질 (CAS No)',
        'specific_gravity': '비중 (함량%)',
        'existing_new': '기존/신규',
        'law': '법령',
        'consignee': '화주',
        'model_name': '모델명',
        'note': '비고',
        'manufacturer': '제조사',
        'manufacturing_country': '제조국',
        'certification_no': '인증번호',
        'certification_date': '인증일자',
        'item_name': '품목명',
        'item_name_eng': '품목영문명',
        'transmission_mgmt_no': '전송관리번호',
        'quantity': '수량',
        'amount_usd': '금액(USD)',
        'created_by': '작성자',
        'created_at': '생성일시',
        'updated_at': '수정일시'
    };

    return labels[key] || key;
}

// 타입 라벨 가져오기
function getTypeLabel(type) {
    const labels = {
        'chemical': '화학물질확인',
        'msds': 'MSDS',
        'radio': '전파법',
        'electrical': '전안법',
        'medical': '의료기기/원안법 등',
        'non_target': '비대상',
        'review_needed': '확인 필요 List'
    };
    return labels[type] || type;
}

// 상세보기 모달 닫기
function closeDetailModal() {
    currentDetailRequestId += 1;
    document.getElementById('detailModal').classList.remove('show');
    currentDetailRecord = null;
    setDetailDeleteActionEnabled(false);
}

// 레코드 삭제
async function deleteRecord(type, recordId) {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    try {
        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };

        const response = await fetch(`tables/${tableMap[type]}/${recordId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            alert('삭제되었습니다.');
            // 데이터 새로고침
            switch(type) {
                case 'chemical': loadChemicalData(); break;
                case 'msds': loadMsdsData(); break;
                case 'radio': loadRadioData(); break;
                case 'electrical': loadElectricalData(); break;
                case 'medical': loadMedicalData(); break;
                case 'non_target': loadNonTargetData(); break;
                case 'review_needed': loadReviewNeededData(); break;
            }
            loadDashboard();
        } else {
            alert('삭제 중 오류가 발생했습니다.');
        }
    } catch (error) {
        console.error('삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// 현재 상세보기 레코드 삭제
function deleteCurrentRecord() {
    const record = currentDetailRecord;
    if (!record) return;

    closeDetailModal();
    deleteRecord(record.type, record.id);
}

// 대시보드 카드 클릭 시 해당 섹션으로 이동
function navigateToDashboardSection(sectionId) {
    const sectionMap = {
        chemicalSection: 'chemical',
        msdsSection: 'msds',
        radioSection: 'radio',
        electricalSection: 'electrical',
        medicalSection: 'medical',
        nonTargetSection: 'non_target',
        review_neededSection: 'review_needed'
    };
    const section = sectionMap[sectionId];
    if (!section) return;

    const menuItem = document.querySelector('.menu-item[data-section="' + section + '"]');
    return menuItem ? menuItem.click() : undefined;
}

// 입력 모달 표시
function showInputModal(type) {
    currentDataType = type;
    document.getElementById('modalTitle').textContent = `${getTypeLabel(type)} 데이터 추가`;

    // 수동 입력 폼 생성
    generateManualForm(type);

    // AI 프롬프트 생성 (관리자만)
    generateAIPrompt(type);

    const inputModal = document.getElementById('inputModal');
    inputModal.style.display = '';
    inputModal.classList.add('show');
}

// 입력 모달 닫기
function closeInputModal() {
    const inputModal = document.getElementById('inputModal');
    inputModal.classList.remove('show');
    inputModal.style.display = 'none';
    document.getElementById('tableInput').value = '';
    document.getElementById('manualInputForm').innerHTML = '';
    currentDataType = '';
}

// AI 프롬프트 생성
function generateAIPrompt(type) {
    const aiPromptBox = document.getElementById('aiPromptBox');
    const aiPromptContent = document.getElementById('aiPromptContent');

    // 관리자가 아니면 숨김
    if (!isMasterUser()) {
        aiPromptBox.style.display = 'none';
        return;
    }

    aiPromptBox.style.display = 'block';

    const prompts = {
        'chemical': `아래 원본 데이터를 화학물질확인 입력 형식으로 정리해줘. 첫 줄은 반드시 헤더(규격정제	접수일자	접수번호	상태	상호	제품명	모델·규격	수입국	HSK No)를 포함하고, 탭으로 구분된 표 형식으로 출력해줘. 규격정제는 모델·규격에서 추출하고, 날짜는 YYYY-MM-DD 형식으로 변환해줘.`,

        'msds': `아래 원본 데이터를 MSDS 입력 형식으로 정리해줘. 첫 줄은 반드시 헤더(수입자	규격정제	내부관리 No	물질	비중	기존/신규(Cas)	유해	비고)를 포함하고, 탭으로 구분된 표 형식으로 출력해줘. 물질명은 CAS 번호를 포함하고, 비중은 숫자만 추출해줘.`,

        'radio': `아래 원본 데이터를 전파법 입력 형식으로 정리해줘. 첫 줄은 반드시 헤더(규격정제	화주	모델명	비고	제조사	제조국	인증번호	인증일자	품목명)를 포함하고, 탭으로 구분된 표 형식으로 출력해줘. 인증일자는 YYYY-MM-DD 형식으로 변환해줘.`,

        'electrical': `아래 원본 데이터를 전안법 입력 형식으로 정리해줘. 첫 줄은 반드시 헤더(규격정제	인증기관	화주	모델명	비고	제조사	제조국	인증번호	인증일자	품목명)를 포함하고, 탭으로 구분된 표 형식으로 출력해줘. 인증일자는 YYYY-MM-DD 형식으로 변환하고, 비고에는 정격전압 정보를 포함해줘.`,

        'medical': `아래 원본 데이터를 의료기기/원안법 입력 형식으로 정리해줘. 첫 줄은 반드시 헤더(규격정제	법령부호	법령	수입자	수출자	확인 여부)를 포함하고, 탭으로 구분된 표 형식으로 출력해줘. 법령부호는 공백으로 두고(자동 계산됨), 법령명은 정확히 입력해줘.`,

        'non_target': `아래 원본 데이터를 비대상 입력 형식으로 정리해줘. 첫 줄은 반드시 헤더(규격정제	법령부호	법령	수입자	수출자	비대상 사유)를 포함하고, 탭으로 구분된 표 형식으로 출력해줘. 법령부호는 공백으로 두고(자동 계산됨), 비대상 사유를 명확히 작성해줘.`,

        'review_needed': `아래 원본 데이터를 확인 필요 List 입력 형식으로 정리해줘. 첫 줄은 반드시 헤더(규격정제	Description	단가	HS code	수입자상호	해외공급처	화학물질대상	화관법(확인명세)	화평법(MSDS)	의료기기/원안법	전파대상	전파법인증	전파비대상	전안법대상	전안법인증	전안비대상)를 포함하고, 탭으로 구분된 표 형식으로 출력해줘. 각 요건 대상/인증 열은 Y/N 또는 인증번호로 채워줘.`
    };

    aiPromptContent.textContent = prompts[type] || '프롬프트를 생성할 수 없습니다.';
}

// AI 프롬프트 복사
function copyAIPrompt() {
    const promptText = document.getElementById('aiPromptContent').textContent;

    navigator.clipboard.writeText(promptText).then(() => {
        const btn = document.querySelector('.btn-copy-prompt');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> 복사됨';
        btn.style.backgroundColor = '#dcfce7';

        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.backgroundColor = 'white';
        }, 2000);
    }).catch(err => {
        alert('복사 실패: ' + err);
    });
}

// 텍스트 파싱 및 저장
async function parseAndSaveData() {
    const text = document.getElementById('textInput').value.trim();

    if (!text) {
        alert('텍스트를 입력해주세요.');
        return;
    }

    try {
        // 자동 파싱
        const result = autoParse(text);

        if (result.records.length === 0) {
            alert('파싱된 데이터가 없습니다. 텍스트 형식을 확인해주세요.');
            return;
        }

        // 테이블 매핑
        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };

        const tableName = tableMap[result.type];

        // 데이터 저장
        for (const record of result.records) {
            await fetch(`tables/${tableName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record)
            });
        }

        alert(`${result.records.length}개의 데이터가 저장되었습니다.`);
        closeInputModal();

        // 데이터 새로고침
        switch(result.type) {
            case 'chemical': loadChemicalData(); break;
            case 'msds': loadMsdsData(); break;
            case 'radio': loadRadioData(); break;
            case 'electrical': loadElectricalData(); break;
            case 'medical': loadMedicalData(); break;
        }
        loadDashboard();

    } catch (error) {
        console.error('데이터 저장 오류:', error);
        alert('데이터 저장 중 오류가 발생했습니다.');
    }
}

// 탭 전환
document.addEventListener('DOMContentLoaded', () => {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;

            // 탭 버튼 활성화
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 탭 내용 표시
            document.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.remove('active');
            });

            // table 탭은 tableInputTab, manual 탭은 manualInputTab
            if (tabName === 'table') {
                document.getElementById('tableInputTab').classList.add('active');
            } else if (tabName === 'manual') {
                document.getElementById('manualInputTab').classList.add('active');
            }
        });
    });
});

// 메뉴 전환
document.addEventListener('DOMContentLoaded', () => {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', async () => {
            const section = item.dataset.section;
            const pending = window.__ainRequirementsPendingSectionSearch;
            const searchQuery = pending && pending.section === section ? pending.query : '';
            if (pending && pending.section === section) window.__ainRequirementsPendingSectionSearch = null;
            await activateRequirementsSection(section, searchQuery);
        });
    });
});
// 전체 데이터 삭제 (마스터 전용)
async function deleteAllData(type) {
    console.log('deleteAllData 호출됨:', type);

    if (!isMasterUser()) {
        alert('전체 삭제 권한이 없습니다. (마스터 계정만 가능)');
        return;
    }

    console.log('마스터 권한 확인 통과');

    const typeLabel = getTypeLabel(type);
    console.log('타입 레이블:', typeLabel);

    const confirmMsg = `⚠️ 경고: ${typeLabel}의 모든 데이터를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.\n\n계속하려면 "삭제확인"을 입력하세요.`;

    const userInput = prompt(confirmMsg);
    console.log('사용자 입력:', userInput);

    if (userInput !== '삭제확인') {
        if (userInput !== null) {
            alert('입력이 올바르지 않습니다. 삭제가 취소되었습니다.');
        }
        console.log('삭제 취소됨');
        return;
    }

    console.log('삭제 확인 완료, 처리 시작...');

    try {
        showLoading('전체 데이터 삭제 중...');

        // 모든 데이터 가져오기
        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };

        const tableName = tableMap[type];

        // 페이지네이션으로 모든 데이터 가져오기
        let data = [];
        let page = 1;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            const response = await fetch(`tables/${tableName}?page=${page}&limit=${limit}`);

            if (!response.ok) {
                throw new Error(`데이터 로드 실패: ${response.status}`);
            }

            const result = await response.json();

            // 응답 구조 확인
            let pageData;
            if (Array.isArray(result)) {
                pageData = result;
            } else if (result.data && Array.isArray(result.data)) {
                pageData = result.data;
            } else {
                throw new Error('데이터 형식이 올바르지 않습니다');
            }

            if (pageData.length === 0) {
                hasMore = false;
            } else {
                data = data.concat(pageData);
                page++;
                console.log(`전체 삭제 - ${data.length}개 데이터 로드됨...`);

                // 안전장치: 최대 20페이지(20,000개)까지
                if (page > 20) {
                    console.warn('최대 페이지 수 도달');
                    hasMore = false;
                }
            }
        }

        console.log('전체 삭제 - 총 로드된 데이터:', data.length);

        if (data.length === 0) {
            hideLoading();
            alert('삭제할 데이터가 없습니다.');
            return;
        }

        const totalCount = data.length;

        // 대용량 데이터 경고 (1000개 이상)
        if (totalCount > 1000) {
            const batchSize = 50;
            const estimatedMinutes = Math.ceil(totalCount / batchSize / 60);
            hideLoading();
            if (!confirm(`⚠️ ${totalCount}개의 대용량 데이터를 삭제합니다.\n\n예상 소요 시간: 약 ${estimatedMinutes}분\n\n계속하시겠습니까?`)) {
                return;
            }
        }

        console.log(`${totalCount}개의 데이터 삭제 시작...`);

        // 진행 상황 표시를 위한 모달 생성
        const progressDiv = document.createElement('div');
        progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:15px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:10000;text-align:center;min-width:400px;';
        progressDiv.innerHTML = `
            <h3 style="margin:0 0 20px 0;color:#d32f2f;">전체 데이터 삭제 중...</h3>
            <div style="background:#f0f0f0;height:30px;border-radius:15px;overflow:hidden;margin-bottom:15px;">
                <div id="deleteProgressBar" style="background:linear-gradient(90deg,#f44336,#d32f2f);height:100%;width:0%;transition:width 0.3s;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:14px;"></div>
            </div>
            <p id="deleteProgress" style="margin:10px 0;color:#666;font-size:16px;">0 / ${totalCount}</p>
            <p id="deleteSpeed" style="margin:5px 0;color:#999;font-size:14px;">준비 중...</p>
        `;
        document.body.appendChild(progressDiv);

        // 쓰기는 재시도하지 않는다. 응답 유실 시 동일 변경이 중복 적용될 수 있다.
        async function deleteOnce(url) {
            try {
                const response = await fetch(url, { method: 'DELETE' });
                return response.ok || response.status === 204
                    ? { success: true }
                    : { success: false, error: `HTTP ${response.status}` };
            } catch (error) {
                return { success: false, error: 'NETWORK_ERROR' };
            }
        }

        // 모든 레코드 배치 삭제
        let successCount = 0;
        let errorCount = 0;
        const batchSize = 20; // 배치 크기 줄임 (50 → 20)
        const startTime = Date.now();

        for (let i = 0; i < data.length; i += batchSize) {
            const batch = data.slice(i, i + batchSize);
            const batchPromises = batch.map(async (record, idx) => {
                const actualIndex = i + idx;
                const result = await deleteOnce(`tables/${tableName}/${record.id}`);
                return { ...result, index: actualIndex, id: record.id };
            });

            // Promise.allSettled로 일부 실패해도 계속 진행
            const results = await Promise.allSettled(batchPromises);

            // 결과 집계
            results.forEach((result, idx) => {
                if (result.status === 'fulfilled') {
                    if (result.value.success) {
                        successCount++;
                    } else {
                        errorCount++;
                        console.error(`삭제 실패 [${i + idx}]: ${result.value.error}`);
                    }
                } else {
                    errorCount++;
                    console.error(`삭제 실패 [${i + idx}]`);
                }
            });

            // 진행 상황 업데이트
            const processed = i + batch.length;
            const percentage = Math.round((processed / totalCount) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = processed / elapsed;
            const remaining = processed < totalCount ? (totalCount - processed) / speed : 0;

            const progressElement = document.getElementById('deleteProgress');
            const progressBarElement = document.getElementById('deleteProgressBar');
            const speedElement = document.getElementById('deleteSpeed');

            if (progressElement) {
                progressElement.textContent = `${processed} / ${totalCount} (${percentage}%)`;
            }
            if (progressBarElement) {
                progressBarElement.style.width = percentage + '%';
                progressBarElement.textContent = percentage + '%';
            }
            if (speedElement) {
                if (processed < totalCount) {
                    speedElement.textContent = `속도: ${speed.toFixed(1)}개/초 | 남은 시간: 약 ${Math.ceil(remaining)}초`;
                } else {
                    speedElement.textContent = `완료!`;
                }
            }

            // 다음 배치 전 대기 (서버 부하 방지)
            if (processed < totalCount) {
                await new Promise(resolve => setTimeout(resolve, 500)); // 200ms → 500ms
            }
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`삭제 완료: 성공 ${successCount}, 실패 ${errorCount} (소요 시간: ${totalTime}초)`);

        // progressDiv 강제 제거
        try {
            if (progressDiv) {
                if (progressDiv.parentElement) {
                    document.body.removeChild(progressDiv);
                }
                progressDiv.remove(); // 추가 안전장치
            }
        } catch (e) {
            console.error('모달 제거 오류:', e);
        }

        // 혹시 남아있을 수 있는 모든 진행 표시 모달 제거
        document.querySelectorAll('div').forEach(div => {
            if (div.innerHTML && div.innerHTML.includes('전체 데이터 삭제 중')) {
                div.remove();
            }
        });

        hideLoading(); // 로딩 화면도 제거

        alert(`전체 삭제 완료! (소요 시간: ${totalTime}초)\n\n✅ 삭제: ${successCount}개\n❌ 실패: ${errorCount}개`);

        // 데이터 새로고침
        switch(type) {
            case 'chemical': loadChemicalData(); break;
            case 'msds': loadMsdsData(); break;
            case 'radio': loadRadioData(); break;
            case 'electrical': loadElectricalData(); break;
            case 'medical': loadMedicalData(); break;
            case 'non_target': loadNonTargetData(); break;
            case 'review_needed': loadReviewNeededData(); break;
        }
        loadDashboard();

    } catch (error) {
        // 에러 발생 시 진행 표시 창 강제 제거
        try {
            // ID로 찾기
            const progressElement = document.getElementById('deleteProgress');
            if (progressElement && progressElement.parentElement && progressElement.parentElement.parentElement) {
                document.body.removeChild(progressElement.parentElement.parentElement);
            }

            // 혹시 남아있는 모든 모달 제거
            document.querySelectorAll('div').forEach(div => {
                if (div.innerHTML && div.innerHTML.includes('전체 데이터 삭제 중')) {
                    div.remove();
                }
            });
        } catch (e) {
            console.error('모달 제거 오류:', e);
        }

        hideLoading();
        console.error('전체 삭제 오류:', error);
        alert('전체 삭제 중 오류가 발생했습니다.\n오류: ' + error.message);
    }
}

// TSV 파싱 함수 (탭 또는 공백 구분 - Excel/수동입력 모두 지원)
function parseTSVLine(line) {
    // 탭이 있으면 탭으로, 없으면 공백(2개 이상)으로 분리
    // Excel 복사: 탭 구분 / 수동입력: 공백 구분
    let values;
    if (line.includes('\t')) {
        // 탭이 있는 경우: 탭으로 분리 (Excel 복사)
        values = line.split('\t');
    } else {
        // 탭이 없는 경우: 연속된 공백(2개 이상)으로 분리 (수동입력)
        values = line.split(/\s{2,}/);
    }
    // trim()은 각 값의 앞뒤 공백만 제거, 빈 문자열은 유지
    return values.map(value => (value || '').trim());
}

function parseTSVTable(text, dataType = null) {
    console.log('\n=== parseTSVTable 시작 ===');
    console.log('입력 텍스트 길이:', text.length);

    // trim()은 전체 텍스트의 앞뒤만 제거, 각 줄은 유지
    const lines = text.split('\n').map(line => line.replace(/\r$/, '')); // 윈도우 줄바꿈(\r\n) 처리

    console.log('전체 줄 수:', lines.length);

    // 빈 줄 필터링
    const nonEmptyLines = lines.filter(line => line.trim().length > 0);

    console.log('비어있지 않은 줄 수:', nonEmptyLines.length);

    if (nonEmptyLines.length < 1) {
        console.log('데이터가 없습니다.');
        return { headers: [], records: [] };
    }

    // 첫 줄 구분자 확인
    const hasTab = nonEmptyLines[0].includes('\t');
    const tabCount = (nonEmptyLines[0].match(/\t/g) || []).length;
    const spaceCount = (nonEmptyLines[0].match(/\s{2,}/g) || []).length;
    console.log('구분자 감지:', hasTab ? `탭 ${tabCount}개` : `연속공백 ${spaceCount}개`);

    // 첫 줄을 파싱
    const firstLine = parseTSVLine(nonEmptyLines[0]);

    // 헤더 감지: 한국어 필드명이 포함되어 있으면 헤더로 간주
    const commonHeaders = ['규격정제', '접수일자', '접수번호', '상태', '상호', '수입자', '물질', '화주', '모델명', '인증번호', '법령', '수출자', 'Description'];
    // 빈 셀을 제외하고 헤더 감지
    const hasHeader = firstLine.some(cell => cell && commonHeaders.includes(cell));

    console.log('헤더 감지 결과:', hasHeader);

    let headers;
    let dataStartIndex;

    if (hasHeader) {
        // 헤더가 있는 경우
        headers = firstLine;
        dataStartIndex = 1;
    } else {
        // 헤더가 없는 경우 - 데이터 타입별 기본 헤더 사용
        headers = getDefaultHeadersForType(dataType);
        dataStartIndex = 0;
    }

    if (nonEmptyLines.length < dataStartIndex + 1) {
        return { headers: [], records: [] };
    }

    const records = [];

    // 데이터 파싱
    for (let i = dataStartIndex; i < nonEmptyLines.length; i++) {
        const line = nonEmptyLines[i];
        // 완전히 빈 줄만 스킵 (공백/탭만 있는 줄은 처리)
        if (!line || line.trim() === '') continue;

        const values = parseTSVLine(line);

        if (values.length < headers.length) {
            console.warn(`행 ${i + 1}: 값 개수(${values.length})가 헤더 개수(${headers.length})보다 적음 - 빈 문자열로 채움`);
            // 부족한 열은 빈 문자열로 채움
            while (values.length < headers.length) {
                values.push('');
            }
        }

        const record = {};
        headers.forEach((header, index) => {
            record[header] = values[index] || '';
        });
        records.push(record);

    }

    console.log(`총 ${records.length}개 레코드 파싱 완료`);
    return { headers, records };
}

// 데이터 타입별 기본 헤더 정의
function getDefaultHeadersForType(dataType) {
    const defaultHeaders = {
        'chemical': ['규격정제', '접수일자', '접수번호', '상태', '상호'],
        'msds': ['수입자', '규격정제', '물질', '비중', '기존/신규', '유해', '비고'],
        'radio': ['규격정제', '화주', '모델명', '비고', '제조사', '제조국', '인증번호', '인증일자', '품목명', '파생모델명'],
        'electrical': ['규격정제', '인증기관', '화주', '모델명', '비고', '제조사', '제조국', '인증번호', '인증일자', '품목명', '파생모델명'],
        'medical': ['규격정제', '법령', '수입자', '수출자', '확인여부'],
        'non_target': ['규격정제', '법령', '수입자', '수출자', '비대상사유'],
        'review_needed': ['규격정제', 'Description', '수입자상호', '해외공급처', '비고']
    };

    return defaultHeaders[dataType] || ['규격정제'];
}

// 중복 체크 캐시
let duplicateCheckCache = {};

// 기존 데이터 로드 (대량 업로드용)
async function loadExistingDataForDuplicateCheck(tableName, type) {
    try {
        console.log('중복 체크용 기존 데이터 로드 시작...');

        // 페이지네이션으로 모든 데이터 가져오기
        let existingData = [];
        let page = 1;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            const response = await fetch(`tables/${tableName}?page=${page}&limit=${limit}`);

            if (!response.ok) {
                console.warn('기존 데이터 로드 실패, 중복 체크 스킵:', response.status);
                return existingData.length > 0 ? existingData : [];
            }

            const result = await response.json();

            // 응답 구조 확인
            let pageData;
            if (Array.isArray(result)) {
                pageData = result;
            } else if (result.data && Array.isArray(result.data)) {
                pageData = result.data;
            } else {
                console.warn('예상치 못한 응답 구조, 중복 체크 스킵');
                return existingData.length > 0 ? existingData : [];
            }

            if (pageData.length === 0) {
                hasMore = false;
            } else {
                existingData = existingData.concat(pageData);
                page++;

                // 안전장치: 최대 10페이지(10,000개)까지 (중복 체크용이므로 충분)
                if (page > 10) {
                    console.warn('중복 체크: 최대 페이지 수 도달 (10,000개)');
                    hasMore = false;
                }
            }
        }

        console.log(`기존 데이터 ${existingData.length}개 로드 완료`);
        return existingData;
    } catch (error) {
        console.error('기존 데이터 로드 오류:', error);
        return [];
    }
}

// 중복 체크 함수 (캐시 사용)
function checkDuplicateWithCache(data, type, existingDataCache) {
    try {
        // 캐시가 없으면 중복 없다고 간주
        if (!existingDataCache || existingDataCache.length === 0) {
            return false;
        }

        // 주요 필드로 중복 체크
        for (const existing of existingDataCache) {
            let isDuplicate = false;

            if (type === 'chemical') {
                // 규격정제 + 접수번호 + 제품명이 모두 같으면 중복
                isDuplicate = existing.spec_no === data.spec_no &&
                             existing.receipt_number === data.receipt_number &&
                             existing.product_name === data.product_name;
            } else if (type === 'msds') {
                // 수입자 + 규격정제 + 물질이 모두 같으면 중복
                isDuplicate = existing.importer === data.importer &&
                             existing.spec_no === data.spec_no &&
                             existing.substance === data.substance;
            } else if (type === 'radio') {
                // 규격정제 + 인증번호 + 모델명이 모두 같으면 중복
                isDuplicate = existing.spec_no === data.spec_no &&
                             existing.certification_no === data.certification_no &&
                             existing.model_name === data.model_name;
            } else if (type === 'electrical') {
                // 규격정제 + 인증번호 + 모델명이 모두 같으면 중복
                isDuplicate = existing.spec_no === data.spec_no &&
                             existing.certification_no === data.certification_no &&
                             existing.model_name === data.model_name;
            } else if (type === 'medical') {
                // 규격정제 + 전송관리번호 + 모델명이 모두 같으면 중복
                isDuplicate = existing.spec_no === data.spec_no &&
                             existing.transmission_mgmt_no === data.transmission_mgmt_no &&
                             existing.model_name === data.model_name;
            } else if (type === 'non_target') {
                // 규격정제 + 법령 + 수입자가 모두 같으면 중복
                isDuplicate = existing.spec_no === data.spec_no &&
                             existing.law === data.law &&
                             existing.importer === data.importer;
            } else if (type === 'review_needed') {
                // 규격정제 + 수입자상호 + Description이 모두 같으면 중복
                isDuplicate = existing.spec_no === data.spec_no &&
                             existing.importer === data.importer &&
                             existing.description === data.description;
            }

            if (isDuplicate) {
                return true; // 중복 발견
            }
        }

        return false; // 중복 없음
    } catch (error) {
        console.error('중복 체크 오류:', error);
        return false; // 오류 시 중복 없다고 간주
    }
}

// 단일 레코드 중복 체크 (수동 입력용)
async function checkDuplicate(tableName, data, type) {
    try {
        const response = await fetch(`tables/${tableName}?limit=1000`);

        if (!response.ok) {
            console.warn('중복 체크 실패, 계속 진행:', response.status);
            return false;
        }

        const result = await response.json();

        let existingData;
        if (Array.isArray(result)) {
            existingData = result;
        } else if (result.data && Array.isArray(result.data)) {
            existingData = result.data;
        } else {
            console.warn('중복 체크 - 예상치 못한 응답 구조, 계속 진행');
            return false;
        }

        return checkDuplicateWithCache(data, type, existingData);
    } catch (error) {
        console.error('중복 체크 오류:', error);
        return false;
    }
}

// 표 데이터 저장
async function saveTableData() {
    const textarea = document.getElementById('tableInput');
    const text = textarea.value.trim();

    if (!text) {
        alert('데이터를 입력해주세요.');
        return;
    }

    try {
        const { headers, records } = parseTSVTable(text, currentDataType);

        if (records.length === 0) {
            alert('유효한 데이터가 없습니다.');
            return;
        }

        // 현재 데이터 타입에 맞게 매핑
        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };

        const tableName = tableMap[currentDataType];
        if (!tableName) {
            alert('데이터 타입을 선택해주세요.');
            return;
        }

        // 헤더 매핑
        const mappedRecords = records.map(record => mapHeadersToFields(record, currentDataType));

        // 대용량 데이터 경고 (1000개 이상)
        if (mappedRecords.length > 1000) {
            const batchSize = 50;
            const estimatedMinutes = Math.ceil(mappedRecords.length / batchSize / 60);
            if (!confirm(`${mappedRecords.length}개의 대용량 데이터를 저장하시겠습니까?\n\n예상 소요 시간: 약 ${estimatedMinutes}분\n\n계속하시겠습니까?`)) {
                return;
            }
        } else {
            if (!confirm(`${mappedRecords.length}개의 데이터를 저장하시겠습니까?`)) {
                return;
            }
        }

        // 진행 상황 표시를 위한 모달 생성
        const progressDiv = document.createElement('div');
        progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:15px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:10000;text-align:center;min-width:400px;';
        progressDiv.innerHTML = `
            <h3 style="margin:0 0 20px 0;color:#333;">표 데이터 저장 중...</h3>
            <div style="background:#f0f0f0;height:30px;border-radius:15px;overflow:hidden;margin-bottom:15px;">
                <div id="tableUploadProgressBar" style="background:linear-gradient(90deg,#4CAF50,#45a049);height:100%;width:0%;transition:width 0.3s;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:14px;"></div>
            </div>
            <p id="tableUploadProgress" style="margin:10px 0;color:#666;font-size:16px;">0 / ${mappedRecords.length}</p>
            <p id="tableUploadSpeed" style="margin:5px 0;color:#999;font-size:14px;">준비 중...</p>
        `;
        document.body.appendChild(progressDiv);

        // 저장
        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;
        const batchSize = 10; // 50 → 10 (서버 부하 감소)
        const startTime = Date.now();

        // 기존 데이터 한 번만 로드 (중복 체크용)
        const existingDataCache = await loadExistingDataForDuplicateCheck(tableName, currentDataType);

        // 중복 제거된 레코드만 필터링
        const nonDuplicateRecords = [];
        for (let i = 0; i < mappedRecords.length; i++) {
            const data = mappedRecords[i];
            const isDuplicate = checkDuplicateWithCache(data, currentDataType, existingDataCache);

            if (isDuplicate) {
                skipCount++;
                console.log(`중복 스킵 [${i + 1}/${mappedRecords.length}]`);
            } else {
                nonDuplicateRecords.push(data);
            }
        }

        console.log(`중복 제거 완료: ${nonDuplicateRecords.length}개 저장 예정 (중복: ${skipCount}개)`);

        if (nonDuplicateRecords.length === 0) {
            document.body.removeChild(progressDiv);
            alert(`모든 데이터가 중복입니다.\n중복: ${skipCount}개`);
            return;
        }

        // 쓰기는 재시도하지 않는다. 응답 유실 시 동일 변경이 중복 적용될 수 있다.
        async function saveOnce(url, data) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                return response.ok
                    ? { success: true }
                    : { success: false, error: `HTTP ${response.status}` };
            } catch (error) {
                return { success: false, error: 'NETWORK_ERROR' };
            }
        }

        // 배치 처리로 저장 (한 번에 50개씩)
        for (let i = 0; i < nonDuplicateRecords.length; i += batchSize) {
            const batch = nonDuplicateRecords.slice(i, i + batchSize);
            const batchPromises = batch.map(async (data, idx) => {
                const actualIndex = i + idx;
                const result = await saveOnce(`tables/${tableName}`, data);

                if (!result.success) {
                    console.error(`저장 실패 [${actualIndex}]:`, result.error);
                }

                return { ...result, index: actualIndex };
            });

            // Promise.allSettled로 일부 실패해도 계속 진행
            const results = await Promise.allSettled(batchPromises);

            // 결과 집계
            results.forEach((result, idx) => {
                if (result.status === 'fulfilled') {
                    if (result.value.success) {
                        successCount++;
                    } else {
                        errorCount++;
                    }
                } else {
                    errorCount++;
                    console.error(`배치 처리 실패 [${i + idx}]`);
                }
            });

            // 진행 상황 업데이트
            const processed = i + batch.length;
            const percentage = Math.round((processed / nonDuplicateRecords.length) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = processed / elapsed;
            const remaining = processed < nonDuplicateRecords.length ? (nonDuplicateRecords.length - processed) / speed : 0;

            const progressElement = document.getElementById('tableUploadProgress');
            const progressBarElement = document.getElementById('tableUploadProgressBar');
            const speedElement = document.getElementById('tableUploadSpeed');

            if (progressElement) {
                progressElement.textContent = `${processed} / ${nonDuplicateRecords.length} (${percentage}%)`;
            }
            if (progressBarElement) {
                progressBarElement.style.width = percentage + '%';
                progressBarElement.textContent = percentage + '%';
            }
            if (speedElement) {
                if (processed < nonDuplicateRecords.length) {
                    speedElement.textContent = `속도: ${speed.toFixed(1)}개/초 | 남은 시간: 약 ${Math.ceil(remaining)}초`;
                } else {
                    speedElement.textContent = `완료!`;
                }
            }

            // 다음 배치 전 대기 (서버 부하 방지)
            if (processed < nonDuplicateRecords.length) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 200ms → 1000ms
            }
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`저장 완료: 성공 ${successCount}, 실패 ${errorCount}, 중복 ${skipCount} (소요 시간: ${totalTime}초)`);

        // progressDiv가 아직 DOM에 존재하는지 확인 후 제거
        if (progressDiv && progressDiv.parentElement) {
            document.body.removeChild(progressDiv);
        }

        let message = `저장 완료! (소요 시간: ${totalTime}초)\n\n✅ 성공: ${successCount}개`;
        if (errorCount > 0) {
            message += `\n❌ 실패: ${errorCount}개`;
        }
        if (skipCount > 0) {
            message += `\n⏭️  중복: ${skipCount}개`;
        }
        alert(message);
        closeInputModal();

        // 데이터 새로고침
        switch(currentDataType) {
            case 'chemical': loadChemicalData(); break;
            case 'msds': loadMsdsData(); break;
            case 'radio': loadRadioData(); break;
            case 'electrical': loadElectricalData(); break;
            case 'medical': loadMedicalData(); break;
            case 'non_target': loadNonTargetData(); break;
            case 'review_needed': loadReviewNeededData(); break;
        }
        loadDashboard();

    } catch (error) {
        console.error('표 데이터 저장 오류:', error);
        // 에러 발생 시 진행 표시 창 제거
        const progressElement = document.getElementById('tableUploadProgress');
        if (progressElement && progressElement.parentElement && progressElement.parentElement.parentElement) {
            document.body.removeChild(progressElement.parentElement.parentElement);
        }
        alert('데이터 저장 중 오류가 발생했습니다.\n오류: ' + error.message);
    }
}

// 헤더를 필드명으로 매핑
function mapHeadersToFields(record, type) {
    const data = {};

    if (type === 'chemical') {
        data.spec_no = String(record['규격정제'] || '');
        data.no = record['No'] || '';
        data.receipt_date = record['접수일자'] || '';
        data.receipt_number = record['접수번호'] || '';
        data.status = record['상태'] || '';
        data.company = record['상호'] || '';
        data.manager = record['담당자'] || '';
        data.user = record['사용자'] || '';
        data.product_name = record['제품명'] || '';
        data.model_spec = record['모델ㆍ규격'] || record['모델·규격'] || '';
        data.import_country = record['수입국'] || '';
        data.annual_import_qty = record['연간수입예정량'] || '';
        data.hsk_no = record['HSK No'] || '';
        data.division = record['구분'] || '';
        data.usage = record['사용여부'] || '';
        data.agent = record['대리인'] || '';
        data.save_date = record['저장일자'] || '';
        data.department = record['소속'] || '';
        data.existing_registered = record['기존(등록)'] || '';
        data.existing_exempted = record['기존(면제)'] || '';
        data.new_registered = record['신규(등록)'] || '';
        data.new_exempted = record['신규(면제)'] || '';
        data.toxic_substance = record['유독물질'] || '';
        data.permitted_substance = record['허가물질'] || '';
        data.restricted_substance = record['제한물질'] || '';
        data.prohibited_substance = record['금지물질'] || '';
        data.accident_prep_substance = record['사고대비물질'] || '';
        data.importer = record['상호'] || (currentUser ? currentUser.company_name : '');

    } else if (type === 'msds') {
        data.importer = record['수입자'] || (currentUser ? currentUser.company_name : '');
        data.spec_no = String(record['규격정제'] || '');
        data.internal_mgmt_no = record['내부관리 No'] || '';
        data.substance = record['물질'] || '';
        data.specific_gravity = record['비중'] || '';
        data.existing_new = record['기존/신규(Cas)'] || record['기존/신규'] || '';
        data.hazardous = record['유해'] || '';
        data.note = record['비고'] || '';
        data.mixture_type = record['혼합/단일'] || '';

    } else if (type === 'radio') {
        data.spec_no = String(record['규격정제'] || '');
        data.consignee = record['화주'] || (currentUser ? currentUser.company_name : '');
        data.model_name = record['모델명'] || '';
        data.note = record['비고'] || '';
        data.manufacturer = record['제조사'] || '';
        data.manufacturing_country = record['제조국'] || '';
        data.certification_no = record['인증번호'] || '';
        data.certification_date = record['인증일자'] || '';
        data.item_name = record['품목명'] || '';
        data.derived_model_name = record['파생모델명'] || '';

    } else if (type === 'electrical') {
        data.spec_no = String(record['규격정제'] || '');
        data.certification_agency = record['인증기관'] || '';
        data.consignee = record['화주'] || (currentUser ? currentUser.company_name : '');
        data.model_name = record['모델명'] || '';
        data.note = record['비고'] || '';
        data.manufacturer = record['제조사'] || '';
        data.manufacturing_country = record['제조국'] || '';
        data.certification_no = record['인증번호'] || '';
        data.certification_date = record['인증일자'] || '';
        data.item_name = record['품목명'] || '';
        data.derived_model_name = record['파생모델명'] || '';

    } else if (type === 'medical') {
        data.spec_no = String(record['규격정제'] || '');
        data.law = record['법령'] || '';
        data.law_code = record['법령부호'] || getLawCode(record['법령'] || '');
        data.importer = record['수입자'] || (currentUser ? currentUser.company_name : '');
        data.exporter = record['수출자'] || '';
        data.confirmation_status = record['확인 여부'] || '';

    } else if (type === 'non_target') {
        data.spec_no = String(record['규격정제'] || '');
        data.law = record['법령'] || '';
        data.law_code = record['법령부호'] || getLawCode(record['법령'] || '');
        data.importer = record['수입자'] || (currentUser ? currentUser.company_name : '');
        data.exporter = record['수출자'] || '';
        data.non_target_reason = record['비대상 사유'] || '';

    } else if (type === 'review_needed') {
        data.spec_no = String(record['규격정제'] || '');
        data.description = record['Description'] || '';
        data.unit_price = record['단가'] || '';
        data.hs_code = record['HS code'] || '';
        data.importer = record['수입자상호'] || (currentUser ? currentUser.company_name : '');
        data.exporter = record['해외공급처'] || '';
        data.chemical_target = record['화학물질대상'] || '';
        data.chemical_confirm = record['화관법(확인명세)'] || '';
        data.msds_register = record['화평법(MSDS)'] || '';
        data.medical_nuclear = record['의료기기/원안법'] || '';
        data.radio_target = record['전파대상'] || '';
        data.radio_cert = record['전파법인증'] || '';
        data.radio_non_target = record['전파비대상'] || '';
        data.electrical_target = record['전안법대상'] || '';
        data.electrical_cert = record['전안법인증'] || '';
        data.electrical_non_target = record['전안비대상'] || '';
        data.note = record['비고'] || '';
        data.action_note = record['조치사항'] || '';

    }

    data.created_by = currentUser ? currentUser.username : '';
    return data;
}

// 수동 입력 폼 생성
function generateManualForm(type) {
    const form = document.getElementById('manualInputForm');
    form.innerHTML = '';

    let fields = [];

    if (type === 'chemical') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text', required: true },
            { name: 'receipt_date', label: '접수일자', type: 'date' },
            { name: 'receipt_number', label: '접수번호', type: 'text' },
            { name: 'status', label: '상태', type: 'text' },
            { name: 'company', label: '상호', type: 'text' },
            { name: 'manager', label: '담당자', type: 'text' },
            { name: 'user', label: '사용자', type: 'text' },
            { name: 'product_name', label: '제품명', type: 'text', required: true },
            { name: 'model_spec', label: '모델·규격', type: 'text' },
            { name: 'import_country', label: '수입국', type: 'text' },
            { name: 'annual_import_qty', label: '연간수입예정량', type: 'text' },
            { name: 'hsk_no', label: 'HSK No', type: 'text' },
            { name: 'division', label: '구분', type: 'text' },
            { name: 'usage', label: '사용여부', type: 'text' }
        ];
    } else if (type === 'msds') {
        fields = [
            { name: 'importer', label: '수입자', type: 'text', required: true },
            { name: 'spec_no', label: '규격정제', type: 'text', required: true },
            { name: 'internal_mgmt_no', label: '내부관리 No', type: 'text' },
            { name: 'substance', label: '물질', type: 'text', required: true },
            { name: 'specific_gravity', label: '비중', type: 'text' },
            { name: 'existing_new', label: '기존/신규(Cas)', type: 'select', options: ['', '기존', '신규'] },
            { name: 'hazardous', label: '유해', type: 'text' },
            { name: 'note', label: '비고', type: 'text' },
            { name: 'mixture_type', label: '혼합/단일 (저장 후 자동 분류)', type: 'text', readonly: true, placeholder: '자동 계산됨' }
        ];
    } else if (type === 'radio') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text', required: true },
            { name: 'consignee', label: '화주', type: 'text', required: true },
            { name: 'model_name', label: '모델명', type: 'text', required: true },
            { name: 'note', label: '비고', type: 'text' },
            { name: 'manufacturer', label: '제조사', type: 'text' },
            { name: 'manufacturing_country', label: '제조국', type: 'text' },
            { name: 'certification_no', label: '인증번호', type: 'text' },
            { name: 'certification_date', label: '인증일자', type: 'date' },
            { name: 'item_name', label: '품목명', type: 'text' },
            { name: 'derived_model_name', label: '파생모델명', type: 'text' }
        ];
    } else if (type === 'electrical') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text', required: true },
            { name: 'certification_agency', label: '인증기관', type: 'text' },
            { name: 'consignee', label: '화주', type: 'text', required: true },
            { name: 'model_name', label: '모델명', type: 'text', required: true },
            { name: 'note', label: '비고', type: 'text' },
            { name: 'manufacturer', label: '제조사', type: 'text' },
            { name: 'manufacturing_country', label: '제조국', type: 'text' },
            { name: 'certification_no', label: '인증번호', type: 'text' },
            { name: 'certification_date', label: '인증일자', type: 'date' },
            { name: 'item_name', label: '품목명', type: 'text' },
            { name: 'derived_model_name', label: '파생모델명', type: 'text' }
        ];
    } else if (type === 'medical') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text', required: true },
            { name: 'law_code', label: '법령부호 (자동 계산)', type: 'text', readonly: true, placeholder: '법령 입력 후 자동 계산됨' },
            { name: 'law', label: '법령', type: 'text', required: true },
            { name: 'importer', label: '수입자', type: 'text', required: true },
            { name: 'exporter', label: '수출자', type: 'text' },
            { name: 'confirmation_status', label: '확인 여부', type: 'text' }
        ];
    } else if (type === 'non_target') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text', required: true },
            { name: 'law_code', label: '법령부호 (자동 계산)', type: 'text', readonly: true, placeholder: '법령 입력 후 자동 계산됨' },
            { name: 'law', label: '법령', type: 'text', required: true },
            { name: 'importer', label: '수입자', type: 'text', required: true },
            { name: 'exporter', label: '수출자', type: 'text' },
            { name: 'non_target_reason', label: '비대상 사유', type: 'textarea', required: true }
        ];
    } else if (type === 'review_needed') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text', required: true },
            { name: 'description', label: 'Description', type: 'textarea', required: true },
            { name: 'unit_price', label: '단가', type: 'text' },
            { name: 'hs_code', label: 'HS code', type: 'text' },
            { name: 'importer', label: '수입자상호', type: 'text', required: true },
            { name: 'exporter', label: '해외공급처', type: 'text' },
            { name: 'chemical_target', label: '화학물질대상', type: 'select', options: ['', 'Y', 'N'] },
            { name: 'chemical_confirm', label: '화관법(확인명세)', type: 'text' },
            { name: 'msds_register', label: '화평법(MSDS)', type: 'select', options: ['', '기존', '신규'] },
            { name: 'medical_nuclear', label: '의료기기/원안법', type: 'text' },
            { name: 'radio_target', label: '전파대상', type: 'text' },
            { name: 'radio_cert', label: '전파법인증', type: 'text' },
            { name: 'radio_non_target', label: '전파비대상', type: 'text' },
            { name: 'electrical_target', label: '전안법대상', type: 'text' },
            { name: 'electrical_cert', label: '전안법인증', type: 'text' },
            { name: 'electrical_non_target', label: '전안비대상', type: 'text' },
            { name: 'note', label: '비고', type: 'textarea' },
            { name: 'action_note', label: '조치사항', type: 'textarea' }
        ];
    }

    fields.forEach(field => {
        const div = document.createElement('div');
        div.className = 'form-field';

        let input;
        if (field.type === 'select') {
            input = document.createElement('select');
            field.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                input.appendChild(option);
            });
        } else if (field.type === 'textarea') {
            input = document.createElement('textarea');
        } else {
            input = document.createElement('input');
            input.type = field.type;
        }

        input.id = field.name;
        input.name = field.name;
        if (field.required) input.required = true;
        if (field.value) input.value = field.value;
        if (field.readonly) input.readOnly = true;
        if (field.placeholder) input.placeholder = field.placeholder;

        // hidden 필드는 label 없이 추가
        if (field.type === 'hidden') {
            form.appendChild(input);
        } else {
            const label = document.createElement('label');
            label.textContent = field.label + (field.required ? ' *' : '');
            label.setAttribute('for', field.name);

            div.appendChild(label);
            div.appendChild(input);
            form.appendChild(div);
        }
    });

    // 비대상/의료기기 법령 입력 시 법령부호 자동 계산
    if (type === 'non_target' || type === 'medical') {
        const lawInput = form.querySelector('[name="law"]');
        const lawCodeInput = form.querySelector('[name="law_code"]');

        if (lawInput && lawCodeInput) {
            lawInput.addEventListener('input', () => {
                const lawCode = getLawCode(lawInput.value);
                lawCodeInput.value = lawCode;
            });
        }
    }
}

// 수동 입력 데이터 저장
async function saveManualData() {
    const form = document.getElementById('manualInputForm');
    const formData = new FormData(form);

    // FormData를 객체로 변환
    const data = {};
    for (let [key, value] of formData.entries()) {
        // spec_no는 반드시 문자열로 변환 (20001.210 같은 값이 20001.21로 변환되는 것 방지)
        if (key === 'spec_no') {
            data[key] = String(value);
        } else {
            data[key] = value;
        }
    }

    // 필수 필드 체크
    const requiredFields = Array.from(form.querySelectorAll('[required]'));
    for (let field of requiredFields) {
        if (!data[field.name]) {
            const labelEl = field.previousElementSibling;
            const labelText = labelEl ? labelEl.textContent.replace(' *', '') : field.name;
            alert(`${labelText}를 입력해주세요.`);
            return;
        }
    }

    // 저장 버튼 로딩 상태 (중복 클릭 방지 + 진행 표시)
    const saveBtn = document.getElementById('saveManualBtn');
    if (saveBtn) {
        if (saveBtn.disabled) return; // 이미 저장 중이면 중복 실행 방지
        saveBtn.disabled = true;
        saveBtn.dataset.originalHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중... (잠시만 기다려주세요)';
    }

    // 작성자 추가
    data.created_by = currentUser ? currentUser.username : '';

    // 수입자/화주 자동 설정
    if (currentDataType === 'chemical' && !data.importer) {
        data.importer = currentUser ? currentUser.company_name : '';
    }
    if (currentDataType === 'msds' && !data.importer) {
        data.importer = currentUser ? currentUser.company_name : '';
    }
    if (currentDataType === 'radio' && !data.consignee) {
        data.consignee = currentUser ? currentUser.company_name : '';
    }
    if (currentDataType === 'non_target') {
        // 법령부호 자동 계산
        if (!data.law_code) {
            data.law_code = getLawCode(data.law);
        }
        // 수입자 자동 설정
        if (!data.importer) {
            data.importer = currentUser ? currentUser.company_name : '';
        }
    }
    if (currentDataType === 'medical') {
        // 법령부호 자동 계산
        if (!data.law_code) {
            data.law_code = getLawCode(data.law);
        }
        // 수입자 자동 설정
        if (!data.importer) {
            data.importer = currentUser ? currentUser.company_name : '';
        }
    }

    try {
        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };

        // 중복 체크
        const isDuplicate = await checkDuplicate(tableMap[currentDataType], data, currentDataType);

        if (isDuplicate) {
            alert('중복된 데이터입니다. 이미 동일한 정보가 존재합니다.');
            return;
        }

        const response = await fetch(`tables/${tableMap[currentDataType]}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            alert('저장되었습니다.');
            closeInputModal();

            // 데이터 새로고침
            switch(currentDataType) {
                case 'chemical': loadChemicalData(); break;
                case 'msds': loadMsdsData(); break;
                case 'radio': loadRadioData(); break;
                case 'electrical': loadElectricalData(); break;
                case 'medical': loadMedicalData(); break;
                case 'non_target': loadNonTargetData(); break;
                case 'review_needed': loadReviewNeededData(); break;
            }
            loadDashboard();
        } else {
            alert('저장 중 오류가 발생했습니다.');
        }
    } catch (error) {
        console.error('저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    } finally {
        // 저장 버튼 상태 복구
        const saveBtn = document.getElementById('saveManualBtn');
        if (saveBtn) {
            saveBtn.disabled = false;
            if (saveBtn.dataset.originalHtml) {
                saveBtn.innerHTML = saveBtn.dataset.originalHtml;
            } else {
                saveBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
            }
        }
    }
}

// ========== CSV 업로드 및 다운로드 기능 ==========

// CSV 업로드 트리거
function uploadCSV(type) {
    currentDataType = type;
    const fileInput = document.getElementById('csvFileInput');
    fileInput.value = ''; // 초기화
    fileInput.onchange = handleCSVUpload;
    fileInput.click();
}

// CSV 파일 업로드 처리 (개선된 배치 처리 버전)
async function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
        alert('CSV 파일만 업로드 가능합니다.');
        return;
    }

    // 파일 크기 확인 (10MB 이상이면 경고)
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    if (file.size > 10 * 1024 * 1024) {
        if (!confirm(`파일 크기가 ${fileSizeMB}MB로 큽니다.\n업로드에 시간이 걸릴 수 있습니다.\n계속하시겠습니까?`)) {
            return;
        }
    }

    try {
        const text = await file.text();
        const { headers, records } = parseTSVTable(text);

        if (records.length === 0) {
            alert('유효한 데이터가 없습니다.');
            return;
        }

        // 대용량 파일 경고 (1000개 이상)
        let batchSize = 50; // 기본 배치 크기
        if (records.length > 1000) {
            if (!confirm(`${records.length}개의 데이터를 업로드하시겠습니까?\n\n대용량 파일은 배치 처리로 업로드됩니다.\n(예상 소요 시간: 약 ${Math.ceil(records.length / batchSize / 2)}분)`)) {
                return;
            }
        } else {
            if (!confirm(`${records.length}개의 데이터를 업로드하시겠습니까?`)) {
                return;
            }
        }

        // 진행 상황 표시 (개선된 UI)
        const progressDiv = document.createElement('div');
        progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:15px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:10000;text-align:center;min-width:400px;';
        progressDiv.innerHTML = `
            <h3 style="margin:0 0 20px 0;color:#333;">데이터 업로드 중...</h3>
            <div style="background:#f0f0f0;height:30px;border-radius:15px;overflow:hidden;margin-bottom:15px;">
                <div id="uploadProgressBar" style="background:linear-gradient(90deg,#4CAF50,#45a049);height:100%;width:0%;transition:width 0.3s;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:14px;"></div>
            </div>
            <p id="uploadProgress" style="margin:10px 0;color:#666;font-size:16px;">0 / ${records.length}</p>
            <p id="uploadSpeed" style="margin:5px 0;color:#999;font-size:14px;">준비 중...</p>
        `;
        document.body.appendChild(progressDiv);

        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };

        const tableName = tableMap[currentDataType];
        const mappedRecords = records.map(record => mapHeadersToFields(record, currentDataType));

        let successCount = 0;
        let errorCount = 0;
        const startTime = Date.now();

        // 배치 처리로 업로드 (한 번에 여러 건씩)
        for (let i = 0; i < mappedRecords.length; i += batchSize) {
            const batch = mappedRecords.slice(i, i + batchSize);
            const batchPromises = batch.map(async (record, idx) => {
                const actualIndex = i + idx;
                try {
                    const response = await fetch(`tables/${tableName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(record)
                    });

                    if (response.ok) {
                        return { success: true, index: actualIndex };
                    } else {
                        console.error(`레코드 ${actualIndex} 업로드 실패:`, response.status);
                        return { success: false, index: actualIndex };
                    }
                } catch (error) {
                    console.error(`레코드 ${actualIndex} 업로드 오류:`, error);
                    return { success: false, index: actualIndex };
                }
            });

            // 배치 완료 대기
            const results = await Promise.all(batchPromises);

            // 결과 집계
            results.forEach(result => {
                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                }
            });

            // 진행 상황 업데이트
            const processed = i + batch.length;
            const percentage = Math.round((processed / mappedRecords.length) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = processed / elapsed;
            const remaining = processed < mappedRecords.length ? (mappedRecords.length - processed) / speed : 0;

            const progressElement = document.getElementById('uploadProgress');
            const progressBarElement = document.getElementById('uploadProgressBar');
            const speedElement = document.getElementById('uploadSpeed');

            if (progressElement) {
                progressElement.textContent = `${processed} / ${mappedRecords.length} (${percentage}%)`;
            }
            if (progressBarElement) {
                progressBarElement.style.width = percentage + '%';
                progressBarElement.textContent = percentage + '%';
            }
            if (speedElement) {
                if (processed < mappedRecords.length) {
                    speedElement.textContent = `속도: ${speed.toFixed(1)}개/초 | 남은 시간: 약 ${Math.ceil(remaining)}초`;
                } else {
                    speedElement.textContent = `완료!`;
                }
            }

            // 다음 배치 전 짧은 대기 (서버 부하 방지)
            if (processed < mappedRecords.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        // progressDiv가 아직 DOM에 존재하는지 확인 후 제거
        if (progressDiv && progressDiv.parentElement) {
            document.body.removeChild(progressDiv);
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        alert(`업로드 완료! (소요 시간: ${totalTime}초)\n\n✅ 성공: ${successCount}개\n❌ 실패: ${errorCount}개`);

        // 데이터 새로고침
        switch(currentDataType) {
            case 'chemical': loadChemicalData(); break;
            case 'msds': loadMsdsData(); break;
            case 'radio': loadRadioData(); break;
            case 'medical': loadMedicalData(); break;
            case 'review_needed': loadReviewNeededData(); break;
        }
        loadDashboard();

    } catch (error) {
        console.error('CSV 업로드 오류:', error);
        // 에러 발생 시 진행 표시 창 제거
        const progressElement = document.getElementById('uploadProgress');
        if (progressElement && progressElement.parentElement && progressElement.parentElement.parentElement) {
            // uploadProgress의 부모의 부모가 progressDiv
            document.body.removeChild(progressElement.parentElement.parentElement);
        }
        alert('CSV 파일 읽기 중 오류가 발생했습니다.\n오류: ' + error.message);
    }
}

// CSV 다운로드
async function downloadCSV(type) {
    if (!isMasterUser()) {
        alert('마스터 계정만 다운로드할 수 있습니다.');
        return;
    }

    try {
        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };

        const response = await fetch(`tables/${tableMap[type]}?limit=1000`);
        if (!response.ok) {
            throw new Error(`데이터 로드 실패: ${response.status}`);
        }

        const result = await response.json();

        // 응답 구조 확인
        let records;
        if (Array.isArray(result)) {
            records = result;
        } else if (result.data && Array.isArray(result.data)) {
            records = result.data;
        } else {
            throw new Error('데이터 형식이 올바르지 않습니다');
        }

        if (records.length === 0) {
            alert('다운로드할 데이터가 없습니다.');
            return;
        }

        const csvContent = convertToCSV(records, type);
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        const typeLabels = {
            'chemical': '화학물질확인',
            'msds': 'MSDS',
            'radio': '전파법',
            'electrical': '전안법',
            'medical': '의료기기'
        };

        const today = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `${typeLabels[type]}_${today}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        alert('CSV 파일이 다운로드되었습니다.');

    } catch (error) {
        console.error('CSV 다운로드 오류:', error);
        alert('CSV 다운로드 중 오류가 발생했습니다.');
    }
}

// 데이터를 CSV 형식으로 변환
function convertToCSV(records, type) {
    if (records.length === 0) return '';

    let headers = [];
    let fields = [];

    if (type === 'chemical') {
        headers = ['규격정제', 'No', '접수일자', '접수번호', '상태', '상호', '담당자', '사용자', '제품명', '모델ㆍ규격', '수입국', '연간수입예정량', 'HSK No', '구분', '사용여부', '대리인', '저장일자', '소속', '등록(등록)', '등록(면제)', '기존(등록)', '기존(면제)', '신규(등록)', '신규(면제)', '유독물질', '허가물질', '제한물질', '금지물질', '사고대비물질'];
        fields = ['spec_no', 'no', 'receipt_date', 'receipt_number', 'status', 'company', 'manager', 'user', 'product_name', 'model_spec', 'import_country', 'annual_import_qty', 'hsk_no', 'division', 'usage', 'agent', 'save_date', 'department', 'existing_registered', 'existing_exempted', 'existing_registered', 'existing_exempted', 'new_registered', 'new_exempted', 'toxic_substance', 'permitted_substance', 'restricted_substance', 'prohibited_substance', 'accident_prep_substance'];
    } else if (type === 'msds') {
        headers = ['수입자', '규격정제', '내부관리 No', '물질', '비중', '기존/신규(Cas)', '유해', '비고', '혼합/단일'];
        fields = ['importer', 'spec_no', 'internal_mgmt_no', 'substance', 'specific_gravity', 'existing_new', 'hazardous', 'note', 'mixture_type'];
    } else if (type === 'radio') {
        headers = ['규격정제', '화주', '모델명', '비고', '제조사', '제조국', '인증번호', '인증일자', '품목명'];
        fields = ['spec_no', 'consignee', 'model_name', 'note', 'manufacturer', 'manufacturing_country', 'certification_no', 'certification_date', 'item_name'];
    } else if (type === 'electrical') {
        headers = ['규격정제', '인증기관', '화주', '모델명', '비고', '제조사', '제조국', '인증번호', '인증일자', '품목명'];
        fields = ['spec_no', 'certification_agency', 'consignee', 'model_name', 'note', 'manufacturer', 'manufacturing_country', 'certification_no', 'certification_date', 'item_name'];
    } else if (type === 'medical') {
        headers = ['규격정제', '전송관리번호', '작성관리번호', '문서상태', '세관접수', '발급번호', '발급일자', '연도', '품목코드', '품목식별부호', 'HS코드', '품목영문명', '모델명', '수량', '수량단위', '단가', '금액', '금액단위', '환산금액(USD)', '환산금액(KRW)', 'INVOICE NO', 'B/L NO', '신구품', '신구품(코드)', '허가번호', '제조원 상호1', '제조원 상호2', '제조원 상호3', '제조원 국가코드', '제조자 상호1', '제조자 상호2', '제조자 상호3', '제조자 국가코드', '시험용 용도구분', '시험용 등 확인번호'];
        fields = ['spec_no', 'transmission_mgmt_no', 'writing_mgmt_no', 'doc_status', 'customs_receipt', 'issue_no', 'issue_date', 'year', 'item_code', 'item_id_code', 'hs_code', 'item_name_eng', 'model_name', 'quantity', 'quantity_unit', 'unit_price', 'amount', 'amount_unit', 'amount_usd', 'amount_krw', 'invoice_no', 'bl_no', 'new_used', 'new_used_code', 'permit_no', 'manufacturer_name1', 'manufacturer_name2', 'manufacturer_name3', 'manufacturer_country_code', 'maker_name1', 'maker_name2', 'maker_name3', 'maker_country_code', 'test_purpose_division', 'test_confirmation_no'];
    }

    // 헤더 행
    let csv = headers.join(',') + '\n';

    // 데이터 행
    for (const record of records) {
        const row = fields.map(field => {
            let value = record[field] || '';
            // CSV 이스케이프 처리
            if (typeof value === 'string') {
                value = value.replace(/"/g, '""'); // 따옴표 이스케이프
                if (value.includes(',') || value.includes('\n') || value.includes('"')) {
                    value = `"${value}"`; // 쉼표나 줄바꿈이 있으면 따옴표로 감싸기
                }
            }
            return value;
        });
        csv += row.join(',') + '\n';
    }

    return csv;
}

// ========== 데이터 수정 기능 ==========

let currentEditRecord = null;

// 레코드 수정 모달 열기
async function editRecord(type, recordId) {
    const viewRequest = beginRequirementsViewRequest('modal:edit');
    currentEditRecord = null;
    const editModal = document.getElementById('editModal');
    const editFormContainer = document.getElementById('editFormContainer');
    if (editModal) {
        editModal.classList.remove('show');
        editModal.style.display = 'none';
    }
    if (editFormContainer) editFormContainer.innerHTML = '';

    try {
        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };

        const response = await fetch(`tables/${tableMap[type]}/${recordId}`);
        if (!isCurrentRequirementsViewRequest(viewRequest) || response.status === 409) return;
        if (!response.ok) {
            alert('데이터를 불러올 수 없습니다.');
            return;
        }

        const record = await response.json();
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        currentEditRecord = { type, recordId, data: record, viewRequest };
        currentDataType = type;

        editFormContainer.innerHTML = generateEditForm(type, record);
        const typeLabels = {
            'chemical': '화학물질확인',
            'msds': 'MSDS',
            'radio': '전파법',
            'electrical': '전안법',
            'medical': '의료기기/원안법 등',
            'non_target': '비대상',
            'review_needed': '확인 필요 List'
        };
        document.getElementById('editModalTitle').textContent = `${typeLabels[type] || type} 수정`;
        editModal.style.display = '';
        editModal.classList.add('show');
    } catch (error) {
        if (!isCurrentRequirementsViewRequest(viewRequest)) return;
        console.error('레코드 불러오기 오류');
        alert('데이터를 불러오는 중 오류가 발생했습니다.');
    }
}

// 수정 폼 생성
function generateEditForm(type, record) {
    let fields = [];

    if (type === 'chemical') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text' },
            { name: 'receipt_date', label: '접수일자', type: 'date' },
            { name: 'receipt_number', label: '접수번호', type: 'text' },
            { name: 'status', label: '상태', type: 'text' },
            { name: 'company', label: '상호', type: 'text' },
            { name: 'manager', label: '담당자', type: 'text' },
            { name: 'user', label: '사용자', type: 'text' },
            { name: 'product_name', label: '제품명', type: 'text' },
            { name: 'model_spec', label: '모델·규격', type: 'text' },
            { name: 'import_country', label: '수입국', type: 'text' },
            { name: 'annual_import_qty', label: '연간수입예정량', type: 'text' },
            { name: 'hsk_no', label: 'HSK No', type: 'text' },
            { name: 'division', label: '구분', type: 'text' },
            { name: 'usage', label: '사용여부', type: 'text' },
            { name: 'agent', label: '대리인', type: 'text' },
            { name: 'save_date', label: '저장일자', type: 'date' },
            { name: 'department', label: '소속', type: 'text' }
        ];
    } else if (type === 'msds') {
        fields = [
            { name: 'importer', label: '수입자', type: 'text' },
            { name: 'spec_no', label: '규격정제', type: 'text' },
            { name: 'internal_mgmt_no', label: '내부관리 No', type: 'text' },
            { name: 'substance', label: '물질', type: 'text' },
            { name: 'specific_gravity', label: '비중', type: 'text' },
            { name: 'existing_new', label: '기존/신규(Cas)', type: 'text' },
            { name: 'hazardous', label: '유해', type: 'text' },
            { name: 'note', label: '비고', type: 'text' },
            { name: 'mixture_type', label: '혼합/단일 (저장 후 자동 재분류)', type: 'text', readonly: true }
        ];
    } else if (type === 'radio') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text' },
            { name: 'consignee', label: '화주', type: 'text' },
            { name: 'model_name', label: '모델명', type: 'text' },
            { name: 'note', label: '비고', type: 'text' },
            { name: 'manufacturer', label: '제조사', type: 'text' },
            { name: 'manufacturing_country', label: '제조국', type: 'text' },
            { name: 'certification_no', label: '인증번호', type: 'text' },
            { name: 'certification_date', label: '인증일자', type: 'date' },
            { name: 'item_name', label: '품목명', type: 'text' }
        ];
    } else if (type === 'electrical') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text' },
            { name: 'certification_agency', label: '인증기관', type: 'text' },
            { name: 'consignee', label: '화주', type: 'text' },
            { name: 'model_name', label: '모델명', type: 'text' },
            { name: 'note', label: '비고', type: 'text' },
            { name: 'manufacturer', label: '제조사', type: 'text' },
            { name: 'manufacturing_country', label: '제조국', type: 'text' },
            { name: 'certification_no', label: '인증번호', type: 'text' },
            { name: 'certification_date', label: '인증일자', type: 'date' },
            { name: 'item_name', label: '품목명', type: 'text' }
        ];
    } else if (type === 'medical') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text' },
            { name: 'law_code', label: '법령부호', type: 'text' },
            { name: 'law', label: '법령', type: 'text' },
            { name: 'importer', label: '수입자', type: 'text' },
            { name: 'exporter', label: '수출자', type: 'text' },
            { name: 'confirmation_status', label: '확인 여부', type: 'text' }
        ];
    } else if (type === 'non_target') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text' },
            { name: 'law_code', label: '법령부호', type: 'text' },
            { name: 'law', label: '법령', type: 'text' },
            { name: 'importer', label: '수입자', type: 'text' },
            { name: 'exporter', label: '수출자', type: 'text' },
            { name: 'non_target_reason', label: '비대상 사유', type: 'text' }
        ];
    } else if (type === 'review_needed') {
        fields = [
            { name: 'spec_no', label: '규격정제', type: 'text' },
            { name: 'description', label: 'Description', type: 'text' },
            { name: 'unit_price', label: '단가', type: 'text' },
            { name: 'hs_code', label: 'HS code', type: 'text' },
            { name: 'importer', label: '수입자상호', type: 'text' },
            { name: 'exporter', label: '해외공급처', type: 'text' },
            { name: 'chemical_target', label: '화학물질대상', type: 'text' },
            { name: 'chemical_confirm', label: '화관법(확인명세)', type: 'text' },
            { name: 'msds_register', label: '화평법(MSDS)', type: 'text' },
            { name: 'medical_nuclear', label: '의료기기/원안법', type: 'text' },
            { name: 'radio_target', label: '전파대상', type: 'text' },
            { name: 'radio_cert', label: '전파법인증', type: 'text' },
            { name: 'radio_non_target', label: '전파비대상', type: 'text' },
            { name: 'electrical_target', label: '전안법대상', type: 'text' },
            { name: 'electrical_cert', label: '전안법인증', type: 'text' },
            { name: 'electrical_non_target', label: '전안비대상', type: 'text' },
            { name: 'note', label: '비고', type: 'text' },
            { name: 'action_note', label: '조치사항', type: 'text' }
        ];
    }

    let html = '<div class="form-grid">';
    fields.forEach(field => {
        let value = record[field.name] || '';

        // 날짜 필드는 YYYY-MM-DD 형식으로 포맷팅
        if (field.type === 'date' && value) {
            value = formatDate(value);
        }

        const readonlyAttr = field.readonly ? 'readonly' : '';
        html += `
            <div class="form-group">
                <label for="edit_${field.name}">${field.label}</label>
                <input type="${field.type}" id="edit_${field.name}" name="${field.name}" value="${value}" ${readonlyAttr}>
            </div>
        `;
    });
    html += '</div>';

    return html;
}

// 수정 모달 닫기
function closeEditModal() {
    beginRequirementsViewRequest('modal:edit');
    const editModal = document.getElementById('editModal');
    editModal.classList.remove('show');
    editModal.style.display = 'none';
    const editFormContainer = document.getElementById('editFormContainer');
    if (editFormContainer) editFormContainer.innerHTML = '';
    const modalContent = document.getElementById('modalContent');
    if (modalContent) modalContent.innerHTML = '';
    currentEditRecord = null;
}

// 수정된 데이터 저장
async function saveEditedData() {
    const editTarget = currentEditRecord;
    if (!editTarget || !isCurrentRequirementsViewRequest(editTarget.viewRequest)) {
        alert('수정할 데이터가 없습니다.');
        return;
    }

    const formContainer = document.getElementById('editFormContainer');
    const inputs = formContainer.querySelectorAll('input, select, textarea');
    const updatedData = { ...editTarget.data };

    inputs.forEach(input => {
        const fieldName = input.name;
        let value = input.value.trim();
        if (fieldName === 'spec_no') value = String(value);
        else if (input.type === 'number' && value) value = parseFloat(value);
        updatedData[fieldName] = value;
    });

    try {
        const tableMap = {
            'chemical': 'chemical_confirmation',
            'msds': 'msds',
            'radio': 'radio_law',
            'electrical': 'electrical_law',
            'medical': 'medical_device',
            'non_target': 'non_target',
            'review_needed': 'review_needed'
        };
        const tableName = tableMap[editTarget.type];
        const cleanedData = { ...updatedData };
        delete cleanedData.id;
        delete cleanedData.gs_project_id;
        delete cleanedData.gs_table_name;
        delete cleanedData.created_at;
        delete cleanedData.updated_at;

        if (!isMasterUser()) {
            const result = await submitEditRequest(
                tableName,
                editTarget.recordId,
                editTarget.data,
                cleanedData
            );
            if (!isCurrentRequirementsViewRequest(editTarget.viewRequest) || currentEditRecord !== editTarget) return;
            if (result.success) closeEditModal();
            return;
        }

        const response = await fetch(`tables/${tableName}/${editTarget.recordId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanedData)
        });
        if (!isCurrentRequirementsViewRequest(editTarget.viewRequest) || currentEditRecord !== editTarget) return;
        console.log('응답 상태:', response.status, response.statusText);

        if (response.ok) {
            await response.json();
            if (!isCurrentRequirementsViewRequest(editTarget.viewRequest) || currentEditRecord !== editTarget) return;
            const recordType = editTarget.type;
            alert('수정되었습니다.');
            closeEditModal();
            switch(recordType) {
                case 'chemical': await loadChemicalData(); break;
                case 'msds': await loadMsdsData(); break;
                case 'radio': await loadRadioData(); break;
                case 'electrical': await loadElectricalData(); break;
                case 'medical': await loadMedicalData(); break;
                case 'non_target': await loadNonTargetData(); break;
                case 'review_needed': await loadReviewNeededData(); break;
            }
            await loadDashboard();
        } else {
            alert(`수정 중 오류가 발생했습니다.\n상태 코드: ${response.status}`);
        }
    } catch (error) {
        if (!isCurrentRequirementsViewRequest(editTarget.viewRequest) || currentEditRecord !== editTarget) return;
        console.error('수정 오류');
        alert('수정 중 오류가 발생했습니다.');
    }
}
