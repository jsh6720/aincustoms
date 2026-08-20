// 중복 데이터 체크 및 제거 기능
// Version: 1.0

// 중복 체크 기준
const DUPLICATE_CRITERIA = {
    'chemical': ['spec_no', 'receipt_number', 'product_name'],
    'msds': ['importer', 'spec_no', 'substance'],
    'radio': ['spec_no', 'certification_no', 'model_name'],
    'electrical': ['spec_no', 'certification_no', 'model_name'],
    'medical': ['spec_no', 'law', 'importer'],
    'non_target': ['spec_no', 'law', 'importer'],
    'review_needed': ['spec_no', 'importer', 'description']
};

// 섹션명 매핑
const SECTION_NAMES = {
    'chemical': '화학물질확인',
    'msds': 'MSDS',
    'radio': '전파법',
    'electrical': '전안법',
    'medical': '의료기기/원안법 등',
    'non_target': '비대상',
    'review_needed': '확인 필요 List'
};

const TABLE_MAP = {
    'chemical': 'chemical_confirmation',
    'msds': 'msds',
    'radio': 'radio_law',
    'electrical': 'electrical_law',
    'medical': 'medical_device',
    'non_target': 'non_target',
    'review_needed': 'review_needed'
};

// 재시도 로직이 있는 삭제 함수
async function deleteWithRetry(url, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, { method: 'DELETE' });
            
            if (response.ok || response.status === 204) {
                return true;
            }
            
            // 5xx 에러는 재시도
            if (response.status >= 500 && attempt < maxRetries) {
                console.log(`삭제 재시도 ${attempt}/${maxRetries}:`, url);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            
            return false;
        } catch (error) {
            if (attempt < maxRetries) {
                console.log(`삭제 재시도 ${attempt}/${maxRetries} (네트워크 오류):`, url);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            throw error;
        }
    }
    return false;
}

// 중복 체크 다이얼로그 표시
function showDuplicateCheckDialog() {
    if (!isMasterUser()) {
        alert('관리자만 중복 체크 기능을 사용할 수 있습니다.');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
                <h2><i class="fas fa-copy"></i> 중복 데이터 체크 및 제거</h2>
                <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <div style="margin-bottom: 20px; padding: 15px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
                    <strong><i class="fas fa-exclamation-triangle"></i> 주의사항:</strong>
                    <ul style="margin: 10px 0 0 20px; font-size: 14px;">
                        <li>중복 데이터 중 <strong>가장 오래된 데이터 1개만 남기고</strong> 나머지는 삭제됩니다.</li>
                        <li>삭제된 데이터는 복구할 수 없으니 신중하게 진행해주세요.</li>
                        <li>중복 체크 기준:
                            <ul style="margin-top: 5px;">
                                <li>화학물질확인: 규격정제 + 접수번호 + 제품명</li>
                                <li>MSDS: 수입자 + 규격정제 + 물질명</li>
                                <li>전파법: 규격정제 + 인증번호 + 모델명</li>
                                <li>전안법: 규격정제 + 인증번호 + 모델명</li>
                                <li>의료기기: 규격정제 + 법령 + 수입자</li>
                                <li>비대상: 규격정제 + 법령 + 수입자</li>
                                <li>확인필요: 규격정제 + 수입자상호 + Description</li>
                            </ul>
                        </li>
                    </ul>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <h3 style="margin-bottom: 10px;">체크할 섹션 선택:</h3>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                        <label style="display: flex; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 5px; cursor: pointer;">
                            <input type="checkbox" id="check_chemical" checked style="margin-right: 10px; width: 18px; height: 18px;">
                            <span>화학물질확인</span>
                        </label>
                        <label style="display: flex; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 5px; cursor: pointer;">
                            <input type="checkbox" id="check_msds" checked style="margin-right: 10px; width: 18px; height: 18px;">
                            <span>MSDS</span>
                        </label>
                        <label style="display: flex; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 5px; cursor: pointer;">
                            <input type="checkbox" id="check_radio" checked style="margin-right: 10px; width: 18px; height: 18px;">
                            <span>전파법</span>
                        </label>
                        <label style="display: flex; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 5px; cursor: pointer;">
                            <input type="checkbox" id="check_electrical" checked style="margin-right: 10px; width: 18px; height: 18px;">
                            <span>전안법</span>
                        </label>
                        <label style="display: flex; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 5px; cursor: pointer;">
                            <input type="checkbox" id="check_medical" checked style="margin-right: 10px; width: 18px; height: 18px;">
                            <span>의료기기/원안법 등</span>
                        </label>
                        <label style="display: flex; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 5px; cursor: pointer;">
                            <input type="checkbox" id="check_non_target" checked style="margin-right: 10px; width: 18px; height: 18px;">
                            <span>비대상</span>
                        </label>
                        <label style="display: flex; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 5px; cursor: pointer;">
                            <input type="checkbox" id="check_review_needed" checked style="margin-right: 10px; width: 18px; height: 18px;">
                            <span>확인 필요 List</span>
                        </label>
                    </div>
                </div>
                
                <div id="duplicateCheckResult" style="margin-top: 20px;"></div>
                
                <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">취소</button>
                    <button class="btn-primary" onclick="startDuplicateCheck()">
                        <i class="fas fa-search"></i> 중복 체크 시작
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// 중복 체크 시작
async function startDuplicateCheck() {
    const selectedSections = [];
    
    ['chemical', 'msds', 'radio', 'electrical', 'medical', 'non_target', 'review_needed'].forEach(section => {
        if (document.getElementById(`check_${section}`)?.checked) {
            selectedSections.push(section);
        }
    });
    
    if (selectedSections.length === 0) {
        alert('최소 1개 이상의 섹션을 선택해주세요.');
        return;
    }
    
    const resultDiv = document.getElementById('duplicateCheckResult');
    resultDiv.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px;">중복 데이터 검색 중...</p></div>';
    
    const duplicateResults = {};
    
    for (const section of selectedSections) {
        const tableName = TABLE_MAP[section];
        const result = await findDuplicates(tableName, section);
        if (result.duplicateGroups.length > 0) {
            duplicateResults[section] = result;
        }
    }
    
    displayDuplicateResults(duplicateResults);
}

// 중복 데이터 찾기
async function findDuplicates(tableName, sectionType) {
    try {
        // 페이지네이션으로 모든 데이터 가져오기
        let allRecords = [];
        let page = 1;
        const limit = 1000; // 한 번에 1000개씩
        let hasMore = true;
        
        while (hasMore) {
            const response = await fetch(`tables/${tableName}?page=${page}&limit=${limit}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            const records = data.data || [];
            
            if (records.length === 0) {
                hasMore = false;
            } else {
                allRecords = allRecords.concat(records);
                page++;
                
                // 안전장치: 최대 20페이지(20,000개)까지만
                if (page > 20) {
                    console.warn(`${SECTION_NAMES[sectionType]}: 최대 페이지 수 도달`);
                    hasMore = false;
                }
            }
        }
        
        console.log(`${SECTION_NAMES[sectionType]}: 총 ${allRecords.length}개 데이터 검사 중...`);
        
        // 중복 그룹 찾기
        const criteria = DUPLICATE_CRITERIA[sectionType];
        const duplicateMap = new Map();
        
        allRecords.forEach(record => {
            // 중복 키 생성
            const key = criteria.map(field => String(record[field] || '')).join('||');
            
            if (!duplicateMap.has(key)) {
                duplicateMap.set(key, []);
            }
            duplicateMap.get(key).push(record);
        });
        
        // 2개 이상인 그룹만 필터링
        const duplicateGroups = [];
        duplicateMap.forEach((group, key) => {
            if (group.length > 1) {
                // created_at 또는 id로 정렬 (오래된 것부터)
                group.sort((a, b) => {
                    const timeA = a.created_at || 0;
                    const timeB = b.created_at || 0;
                    return timeA - timeB;
                });
                
                duplicateGroups.push({
                    key: key,
                    count: group.length,
                    records: group,
                    keepRecord: group[0], // 가장 오래된 레코드 유지
                    deleteRecords: group.slice(1) // 나머지 삭제
                });
            }
        });
        
        console.log(`${SECTION_NAMES[sectionType]}: ${duplicateGroups.length}개 중복 그룹 발견`);
        
        return {
            totalRecords: allRecords.length,
            duplicateGroups: duplicateGroups,
            totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.deleteRecords.length, 0)
        };
        
    } catch (error) {
        console.error(`${SECTION_NAMES[sectionType]} 중복 체크 오류:`, error);
        return {
            totalRecords: 0,
            duplicateGroups: [],
            totalDuplicates: 0,
            error: error.message
        };
    }
}

// 중복 결과 표시
function displayDuplicateResults(results) {
    const resultDiv = document.getElementById('duplicateCheckResult');
    
    if (Object.keys(results).length === 0) {
        resultDiv.innerHTML = `
            <div style="padding: 20px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; text-align: center;">
                <i class="fas fa-check-circle" style="font-size: 48px; color: #28a745; margin-bottom: 10px;"></i>
                <h3 style="color: #155724; margin: 10px 0;">중복 데이터가 없습니다!</h3>
                <p style="color: #155724;">선택한 모든 섹션에서 중복 데이터가 발견되지 않았습니다.</p>
            </div>
        `;
        return;
    }
    
    let html = '<div style="background: #fff; border-radius: 8px; padding: 20px;">';
    html += '<h3 style="margin-bottom: 15px; color: #dc3545;"><i class="fas fa-exclamation-circle"></i> 중복 데이터 발견!</h3>';
    
    let totalDuplicates = 0;
    
    Object.entries(results).forEach(([section, result]) => {
        totalDuplicates += result.totalDuplicates;
        
        html += `
            <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; border-left: 4px solid #dc3545;">
                <h4 style="margin: 0 0 10px 0; color: #dc3545;">
                    ${SECTION_NAMES[section]}
                </h4>
                <div style="font-size: 14px; color: #666;">
                    <div>📊 총 데이터: <strong>${result.totalRecords}개</strong></div>
                    <div>🔍 중복 그룹: <strong>${result.duplicateGroups.length}개</strong></div>
                    <div>🗑️ 삭제 예정: <strong style="color: #dc3545;">${result.totalDuplicates}개</strong></div>
                </div>
            </div>
        `;
    });
    
    html += `
        <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 5px; border: 1px solid #ffc107;">
            <strong>총 삭제 예정:</strong> <span style="font-size: 20px; color: #dc3545;">${totalDuplicates}개</span>
        </div>
        
        <div style="margin-top: 20px; text-align: right;">
            <button class="btn-danger" onclick="confirmAndRemoveDuplicates(${JSON.stringify(results).replace(/"/g, '&quot;')})">
                <i class="fas fa-trash-alt"></i> 중복 데이터 삭제
            </button>
        </div>
    `;
    
    html += '</div>';
    
    resultDiv.innerHTML = html;
}

// 중복 제거 확인 및 실행
async function confirmAndRemoveDuplicates(results) {
    const totalDuplicates = Object.values(results).reduce((sum, r) => sum + r.totalDuplicates, 0);
    
    const confirmation = prompt(
        `⚠️ 경고: ${totalDuplicates}개의 중복 데이터를 삭제합니다.\n\n` +
        `이 작업은 되돌릴 수 없습니다!\n\n` +
        `계속하려면 "삭제확인"을 입력하세요:`
    );
    
    if (confirmation !== '삭제확인') {
        alert('취소되었습니다.');
        return;
    }
    
    // 진행 상황 표시
    const resultDiv = document.getElementById('duplicateCheckResult');
    resultDiv.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <i class="fas fa-spinner fa-spin fa-2x" style="color: #dc3545;"></i>
            <h3 style="margin-top: 15px; color: #dc3545;">중복 데이터 삭제 중...</h3>
            <p id="deleteProgress" style="margin-top: 10px; font-size: 16px;">준비 중...</p>
        </div>
    `;
    
    let totalDeleted = 0;
    let totalFailed = 0;
    const deleteResults = {};
    
    for (const [section, result] of Object.entries(results)) {
        const tableName = TABLE_MAP[section];
        const progressText = document.getElementById('deleteProgress');
        
        if (progressText) {
            progressText.textContent = `${SECTION_NAMES[section]} 처리 중... (${totalDeleted}개 삭제됨)`;
        }
        
        let sectionDeleted = 0;
        let sectionFailed = 0;
        
        // 각 중복 그룹의 삭제 대상 레코드들 처리 (배치 단위)
        const allDeleteRecords = [];
        for (const group of result.duplicateGroups) {
            allDeleteRecords.push(...group.deleteRecords);
        }
        
        // 배치 처리 (10개씩)
        const batchSize = 10;
        for (let i = 0; i < allDeleteRecords.length; i += batchSize) {
            const batch = allDeleteRecords.slice(i, i + batchSize);
            
            const batchResults = await Promise.allSettled(
                batch.map(record => 
                    deleteWithRetry(`tables/${tableName}/${record.id}`, 3)
                )
            );
            
            batchResults.forEach((result, idx) => {
                if (result.status === 'fulfilled' && result.value === true) {
                    sectionDeleted++;
                    totalDeleted++;
                } else {
                    sectionFailed++;
                    totalFailed++;
                    console.error(`삭제 실패 (${section}):`, batch[idx].id, result.reason);
                }
            });
            
            // 진행 상황 업데이트
            if (progressText) {
                progressText.textContent = `${SECTION_NAMES[section]} 처리 중... (${totalDeleted}/${totalDuplicates}개 삭제됨)`;
            }
            
            // 다음 배치 전 짧은 대기
            if (i + batchSize < allDeleteRecords.length) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        
        deleteResults[section] = {
            deleted: sectionDeleted,
            failed: sectionFailed
        };
    }
    
    // 완료 메시지
    let summaryHtml = `
        <div style="padding: 20px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px;">
            <h3 style="color: #155724; margin-bottom: 15px;">
                <i class="fas fa-check-circle"></i> 중복 제거 완료!
            </h3>
            <div style="font-size: 16px; color: #155724; margin-bottom: 15px;">
                <div>✅ 삭제 성공: <strong>${totalDeleted}개</strong></div>
                ${totalFailed > 0 ? `<div style="color: #dc3545;">❌ 삭제 실패: <strong>${totalFailed}개</strong></div>` : ''}
            </div>
            
            <details style="margin-top: 15px;">
                <summary style="cursor: pointer; color: #155724; font-weight: bold;">섹션별 상세 결과</summary>
                <div style="margin-top: 10px; padding: 10px; background: white; border-radius: 5px;">
    `;
    
    Object.entries(deleteResults).forEach(([section, counts]) => {
        summaryHtml += `
            <div style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border-radius: 4px;">
                <strong>${SECTION_NAMES[section]}:</strong> 
                ${counts.deleted}개 삭제${counts.failed > 0 ? `, ${counts.failed}개 실패` : ''}
            </div>
        `;
    });
    
    summaryHtml += `
                </div>
            </details>
            
            <div style="margin-top: 20px; text-align: center;">
                <button class="btn-primary" onclick="location.reload()">
                    <i class="fas fa-sync"></i> 페이지 새로고침
                </button>
            </div>
        </div>
    `;
    
    resultDiv.innerHTML = summaryHtml;
}
