// 확인 필요 리스트 관리

let currentReviewFilter = 'all';
let allReviewData = [];

// 확인 필요 데이터 로드
async function loadReviewNeededData(searchQuery = '') {
    try {
        const response = await fetch('tables/review_needed?limit=1000');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

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
                String(item.description || '').toLowerCase().includes(query) ||
                String(item.importer || '').toLowerCase().includes(query) ||
                String(item.exporter || '').toLowerCase().includes(query)
            );
        }

        // 최신순 정렬 (created_at 기준 내림차순)
        records.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        allReviewData = records;
        renderReviewNeededTable(records);

    } catch (error) {
        console.error('확인 필요 데이터 로드 오류:', error);
        const tbody = document.getElementById('reviewNeededTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="20" class="empty-state" style="color: red;"><i class="fas fa-exclamation-triangle"></i><p>데이터를 불러올 수 없습니다.</p><p style="font-size: 12px;">테이블이 존재하지 않거나 네트워크 오류가 발생했습니다.</p></td></tr>';
        }
    }
}

// 필터링 적용
function filterReviewNeeded(filterType) {
    currentReviewFilter = filterType;

    // 버튼 활성화 상태 변경
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.closest('.btn-filter').classList.add('active');

    // 검색 필터 초기화
    const searchInput = document.getElementById('reviewNeededSearch');
    if (searchInput) {
        searchInput.value = '';
    }

    let filteredData = [...allReviewData];

    if (filterType === 'chemical_confirm') {
        // 화관법 검토 필요: 화학물질대상이 "Y"이고, 화관법(확인명세)와 의료기기/원안법이 모두 공란
        filteredData = filteredData.filter(item =>
            item.chemical_target === 'Y' &&
            !item.chemical_confirm &&
            !item.medical_nuclear
        );
    } else if (filterType === 'msds') {
        // 화평법 검토 필요: 화학물질대상이 "Y"이고, 화관법(확인명세)가 공백, 화평법(MSDS)가 공백이거나 "신규"
        filteredData = filteredData.filter(item =>
            item.chemical_target === 'Y' &&
            !item.chemical_confirm &&
            (!item.msds_register || item.msds_register === '신규')
        );
    } else if (filterType === 'radio') {
        // 전파법 검토 필요: 전파대상이 공백이 아니고, 전파법인증이 공백, 전파비대상도 공백
        filteredData = filteredData.filter(item =>
            item.radio_target &&
            !item.radio_cert &&
            !item.radio_non_target
        );
    } else if (filterType === 'electrical') {
        // 전안법 검토 필요: 전안법대상이 공백이 아니고, 전안법인증이 공백, 전안비대상도 공백
        filteredData = filteredData.filter(item =>
            item.electrical_target &&
            !item.electrical_cert &&
            !item.electrical_non_target
        );
    }

    renderReviewNeededTable(filteredData);
}

// 테이블 렌더링
function renderReviewNeededTable(records) {
    const tbody = document.getElementById('reviewNeededTableBody');
    tbody.innerHTML = '';

    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="20" class="empty-state"><i class="fas fa-inbox"></i><p>데이터가 없습니다.</p></td></tr>';
        return;
    }

    records.forEach(record => {
        const row = document.createElement('tr');

        // 화평법(MSDS) 열 처리
        let msdsDisplay = record.msds_register || '';
        if (currentReviewFilter === 'msds') {
            if (!record.msds_register) {
                msdsDisplay = '<span class="review-badge msds-needed">MSDS 필요</span>';
            } else if (record.msds_register === '신규') {
                msdsDisplay = '<span class="review-badge new-registration">신규신고 필요</span>';
            }
        }

        row.innerHTML = `
            <td class="checkbox-cell">
                <input type="checkbox" class="row-checkbox" data-id="${record.id}" data-type="review_needed" onchange="updateSelectionCount('review_needed')">
            </td>
            <td>${record.spec_no || '-'}</td>
            <td>${record.description || '-'}</td>
            <td>${record.unit_price || '-'}</td>
            <td>${record.hs_code || '-'}</td>
            <td>${record.importer || '-'}</td>
            <td>${record.exporter || '-'}</td>
            <td>${record.chemical_target || ''}</td>
            <td>${record.chemical_confirm || ''}</td>
            <td>${msdsDisplay}</td>
            <td>${record.medical_nuclear || ''}</td>
            <td>${record.radio_target || ''}</td>
            <td>${record.radio_cert || ''}</td>
            <td>${record.radio_non_target || ''}</td>
            <td>${record.electrical_target || ''}</td>
            <td>${record.electrical_cert || ''}</td>
            <td>${record.electrical_non_target || ''}</td>
            <td style="max-width: 200px; white-space: normal; word-break: break-word;">${record.note || '-'}</td>
            <td style="max-width: 200px; white-space: normal; word-break: break-word;">${record.action_note || '-'}</td>
            <td style="white-space: nowrap;">
                <button class="btn-icon" onclick="editActionNote('review_needed', '${record.id}')" title="조치사항 수정">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-icon" onclick="viewDetail('review_needed', '${record.id}')" title="상세보기">
                    <i class="fas fa-eye"></i>
                </button>
                ${isMasterUser() ? `<button class="btn-icon btn-danger" onclick="deleteRecord('review_needed', '${record.id}')" title="삭제"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        `;
        tbody.appendChild(row);
    });
}

// 검색
function searchReviewNeeded() {
    const searchInput = document.getElementById('reviewNeededSearch');
    if (!searchInput) {
        console.error('확인필요 검색창을 찾을 수 없습니다: reviewNeededSearch');
        return;
    }
    const searchQuery = searchInput.value.trim();

    // 검색 시 필터는 '전체' 기준으로 검색 (필터 버튼 active 상태도 전체로 초기화)
    currentReviewFilter = 'all';
    const filterButtons = document.querySelectorAll('.btn-filter');
    filterButtons.forEach(btn => btn.classList.remove('active'));
    if (filterButtons.length > 0) filterButtons[0].classList.add('active'); // 첫 번째 = 전체

    loadReviewNeededData(searchQuery);
}

// 엔터키 검색
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('reviewNeededSearch');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchReviewNeeded();
            }
        });
    }
});

// 조치사항 수정
async function editActionNote(type, recordId) {
    try {
        const response = await fetch(`tables/review_needed/${recordId}`);
        if (!response.ok) {
            alert('데이터를 불러올 수 없습니다.');
            return;
        }

        const record = await response.json();

        // 프롬프트로 조치사항 입력
        const currentNote = record.action_note || '';
        const newNote = prompt('조치사항을 입력하세요:', currentNote);

        // 취소 또는 변경 없음
        if (newNote === null || newNote === currentNote) {
            return;
        }

        // 데이터 업데이트
        const updateResponse = await fetch(`tables/review_needed/${recordId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action_note: newNote })
        });

        if (updateResponse.ok) {
            alert('조치사항이 저장되었습니다.');
            // 데이터 새로고침
            loadReviewNeededData();
        } else {
            alert('저장 중 오류가 발생했습니다.');
        }

    } catch (error) {
        console.error('조치사항 수정 오류:', error);
        alert('조치사항 수정 중 오류가 발생했습니다.');
    }
}

// 확인 필요 다운로드 (필터 적용)
function downloadReviewNeededFiltered() {
    let dataToDownload = [...allReviewData];

    if (currentReviewFilter === 'chemical_confirm') {
        dataToDownload = dataToDownload.filter(item =>
            item.chemical_target === 'Y' &&
            !item.chemical_confirm &&
            !item.medical_nuclear
        );
    } else if (currentReviewFilter === 'msds') {
        dataToDownload = dataToDownload.filter(item =>
            item.chemical_target === 'Y' &&
            !item.chemical_confirm &&
            (!item.msds_register || item.msds_register === '신규')
        );
    } else if (currentReviewFilter === 'radio') {
        dataToDownload = dataToDownload.filter(item =>
            item.radio_target &&
            !item.radio_cert &&
            !item.radio_non_target
        );
    } else if (currentReviewFilter === 'electrical') {
        dataToDownload = dataToDownload.filter(item =>
            item.electrical_target &&
            !item.electrical_cert &&
            !item.electrical_non_target
        );
    }

    const headers = [
        '규격정제', 'Description', '단가', 'HS code', '수입자상호', '해외공급처',
        '화학물질대상', '화관법(확인명세)', '화평법(MSDS)', '의료기기/원안법',
        '전파대상', '전파법인증', '전파비대상', '전안법대상', '전안법인증', '전안비대상', '비고', '조치사항'
    ];

    const filterLabels = {
        'all': '전체',
        'chemical_confirm': '화관법검토필요',
        'msds': '화평법검토필요',
        'radio': '전파법검토필요',
        'electrical': '전안법검토필요'
    };

    const today = new Date().toISOString().split('T')[0];
    const filename = `확인필요_${filterLabels[currentReviewFilter]}_${today}.xlsx`;

    downloadExcel(dataToDownload, filename, headers);
}

// 업체별 다운로드 다이얼로그 표시
function showCompanyDownloadDialog() {
    if (!isMasterUser()) {
        alert('업체별 다운로드는 관리자 계정만 가능합니다.');
        return;
    }

    // 모달 생성
    const modal = document.createElement('div');
    modal.className = 'modal show';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2><i class="fas fa-building"></i> 업체별 검토 필요 현황 다운로드</h2>
                <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 20px;">다운로드할 업체를 선택하세요:</p>
                <div id="companyListContainer" style="max-height: 400px; overflow-y: auto;">
                    <div style="text-align: center; padding: 20px;">
                        <i class="fas fa-spinner fa-spin"></i> 업체 목록 로딩 중...
                    </div>
                </div>
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">취소</button>
                    <button class="btn-primary" onclick="downloadSelectedCompanies()" style="margin-left: 10px;">
                        <i class="fas fa-download"></i> 선택 업체 다운로드
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 업체 목록 로드
    loadCompanyList();
}

// 업체 목록 로드
async function loadCompanyList() {
    try {
        const response = await fetch('tables/review_needed?limit=1000');
        const data = await response.json();
        const records = data.data || [];

        // 업체 목록 추출 (중복 제거)
        const companies = [...new Set(records.map(item => item.importer).filter(c => c))].sort();

        const container = document.getElementById('companyListContainer');

        if (companies.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #64748b;">데이터가 없습니다.</p>';
            return;
        }

        let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
        html += `
            <label style="padding: 10px; border: 2px solid #2563eb; border-radius: 8px; cursor: pointer; background: #eff6ff;">
                <input type="checkbox" id="selectAllCompanies" onchange="toggleAllCompanies(this.checked)" style="margin-right: 8px;">
                <strong>전체 선택 (${companies.length}개 업체)</strong>
            </label>
        `;

        companies.forEach(company => {
            html += `
                <label style="padding: 10px; border: 2px solid #e2e8f0; border-radius: 8px; cursor: pointer; transition: all 0.2s;"
                       onmouseover="this.style.borderColor='#2563eb'; this.style.background='#f8fafc';"
                       onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='white';">
                    <input type="checkbox" class="company-checkbox" value="${company}" style="margin-right: 8px;">
                    ${company}
                </label>
            `;
        });
        html += '</div>';

        container.innerHTML = html;

    } catch (error) {
        console.error('업체 목록 로드 오류:', error);
        const container = document.getElementById('companyListContainer');
        container.innerHTML = '<p style="text-align: center; color: #ef4444;">업체 목록을 불러오는 중 오류가 발생했습니다.</p>';
    }
}

// 전체 선택 토글
function toggleAllCompanies(checked) {
    document.querySelectorAll('.company-checkbox').forEach(cb => {
        cb.checked = checked;
    });
}

// 선택된 업체 다운로드
async function downloadSelectedCompanies() {
    const selectedCompanies = Array.from(document.querySelectorAll('.company-checkbox:checked'))
        .map(cb => cb.value);

    if (selectedCompanies.length === 0) {
        alert('다운로드할 업체를 선택해주세요.');
        return;
    }

    try {
        showLoading('데이터 준비 중...');

        // 전체 데이터 로드
        const response = await fetch('tables/review_needed?limit=1000');
        const data = await response.json();
        const allData = data.data || [];

        // 선택된 업체별로 파일 생성
        for (const company of selectedCompanies) {
            showLoading(`${company} 데이터 생성 중...`);
            await downloadCompanyReviewNeeded(company, allData);

            // 다음 다운로드 전 약간의 지연 (브라우저 부하 방지)
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        hideLoading();
        alert(`${selectedCompanies.length}개 업체의 검토 필요 현황이 다운로드되었습니다.`);

        // 모달 닫기
        document.querySelector('.modal.show').remove();

    } catch (error) {
        hideLoading();
        console.error('업체별 다운로드 오류:', error);
        alert('다운로드 중 오류가 발생했습니다.');
    }
}

// 업체별 검토 필요 현황 다운로드
async function downloadCompanyReviewNeeded(company, allData) {
    // 해당 업체 데이터만 필터링
    const companyData = allData.filter(item => item.importer === company);

    if (companyData.length === 0) {
        return;
    }

    // 4가지 검토 필요 항목별로 필터링
    const chemicalConfirmData = companyData.filter(item =>
        item.chemical_target === 'Y' &&
        !item.chemical_confirm &&
        !item.medical_nuclear
    );

    const msdsData = companyData.filter(item =>
        item.chemical_target === 'Y' &&
        !item.chemical_confirm &&
        (!item.msds_register || item.msds_register === '신규')
    );

    const radioData = companyData.filter(item =>
        item.radio_target &&
        !item.radio_cert &&
        !item.radio_non_target
    );

    const electricalData = companyData.filter(item =>
        item.electrical_target &&
        !item.electrical_cert &&
        !item.electrical_non_target
    );

    // Excel 워크북 생성
    const wb = XLSX.utils.book_new();

    const headers = [
        '규격정제', 'Description', '단가', 'HS code', '수입자상호', '해외공급처',
        '화학물질대상', '화관법(확인명세)', '화평법(MSDS)', '의료기기/원안법',
        '전파대상', '전파법인증', '전파비대상', '전안법대상', '전안법인증', '전안비대상', '비고', '조치사항'
    ];

    // 1. 화관법 검토 필요 시트
    if (chemicalConfirmData.length > 0) {
        const wsData = [headers];
        chemicalConfirmData.forEach(row => {
            wsData.push([
                row.spec_no || '', row.description || '', row.unit_price || '', row.hs_code || '',
                row.importer || '', row.exporter || '', row.chemical_target || '',
                row.chemical_confirm || '', row.msds_register || '', row.medical_nuclear || '',
                row.radio_target || '', row.radio_cert || '', row.radio_non_target || '',
                row.electrical_target || '', row.electrical_cert || '', row.electrical_non_target || '',
                row.note || '', row.action_note || ''
            ]);
        });
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [
            { wch: 20 }, { wch: 40 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 20 },
            { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 15 },
            { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 30 }, { wch: 30 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, '화관법 검토필요');
    }

    // 2. 화평법 검토 필요 시트
    if (msdsData.length > 0) {
        const wsData = [headers];
        msdsData.forEach(row => {
            wsData.push([
                row.spec_no || '', row.description || '', row.unit_price || '', row.hs_code || '',
                row.importer || '', row.exporter || '', row.chemical_target || '',
                row.chemical_confirm || '', row.msds_register || '', row.medical_nuclear || '',
                row.radio_target || '', row.radio_cert || '', row.radio_non_target || '',
                row.electrical_target || '', row.electrical_cert || '', row.electrical_non_target || '',
                row.note || '', row.action_note || ''
            ]);
        });
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [
            { wch: 20 }, { wch: 40 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 20 },
            { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 15 },
            { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 30 }, { wch: 30 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, '화평법 검토필요');
    }

    // 3. 전파법 검토 필요 시트
    if (radioData.length > 0) {
        const wsData = [headers];
        radioData.forEach(row => {
            wsData.push([
                row.spec_no || '', row.description || '', row.unit_price || '', row.hs_code || '',
                row.importer || '', row.exporter || '', row.chemical_target || '',
                row.chemical_confirm || '', row.msds_register || '', row.medical_nuclear || '',
                row.radio_target || '', row.radio_cert || '', row.radio_non_target || '',
                row.electrical_target || '', row.electrical_cert || '', row.electrical_non_target || '',
                row.note || '', row.action_note || ''
            ]);
        });
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [
            { wch: 20 }, { wch: 40 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 20 },
            { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 15 },
            { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 30 }, { wch: 30 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, '전파법 검토필요');
    }

    // 4. 전안법 검토 필요 시트
    if (electricalData.length > 0) {
        const wsData = [headers];
        electricalData.forEach(row => {
            wsData.push([
                row.spec_no || '', row.description || '', row.unit_price || '', row.hs_code || '',
                row.importer || '', row.exporter || '', row.chemical_target || '',
                row.chemical_confirm || '', row.msds_register || '', row.medical_nuclear || '',
                row.radio_target || '', row.radio_cert || '', row.radio_non_target || '',
                row.electrical_target || '', row.electrical_cert || '', row.electrical_non_target || '',
                row.note || '', row.action_note || ''
            ]);
        });
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [
            { wch: 20 }, { wch: 40 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 20 },
            { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 15 },
            { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 30 }, { wch: 30 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, '전안법 검토필요');
    }

    // 파일 다운로드
    const today = new Date().toISOString().split('T')[0];
    const filename = `검토필요_${company}_${today}.xlsx`;
    XLSX.writeFile(wb, filename);
}
