// ========== 선택 삭제 기능 ==========

// 전체 선택/해제
function toggleSelectAll(type) {
    const selectAllCheckbox = document.getElementById(`${type}SelectAll`);
    const checkboxes = document.querySelectorAll(`.row-checkbox[data-type="${type}"]`);
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });
    
    updateSelectionCount(type);
}

// 선택 개수 업데이트
function updateSelectionCount(type) {
    const checkboxes = document.querySelectorAll(`.row-checkbox[data-type="${type}"]:checked`);
    const count = checkboxes.length;
    
    const deleteButton = document.getElementById(`${type}DeleteSelected`);
    const countElement = document.getElementById(`${type}SelectionCount`);
    
    if (countElement) {
        countElement.textContent = count;
    }
    
    if (deleteButton) {
        if (count > 0) {
            deleteButton.classList.add('show');
        } else {
            deleteButton.classList.remove('show');
        }
    }
    
    // 전체 선택 체크박스 상태 업데이트
    const selectAllCheckbox = document.getElementById(`${type}SelectAll`);
    const allCheckboxes = document.querySelectorAll(`.row-checkbox[data-type="${type}"]`);
    
    if (selectAllCheckbox && allCheckboxes.length > 0) {
        selectAllCheckbox.checked = (count === allCheckboxes.length);
        selectAllCheckbox.indeterminate = (count > 0 && count < allCheckboxes.length);
    }
}

// 선택된 행 삭제
async function deleteSelectedRows(type) {
    const checkboxes = document.querySelectorAll(`.row-checkbox[data-type="${type}"]:checked`);
    
    if (checkboxes.length === 0) {
        alert('삭제할 항목을 선택해주세요.');
        return;
    }
    
    if (!confirm(`선택한 ${checkboxes.length}개의 항목을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }
    
    try {
        // 선택된 ID 수집
        const selectedIds = Array.from(checkboxes).map(cb => cb.getAttribute('data-id'));
        
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
        const totalCount = selectedIds.length;
        
        // 대용량 데이터 경고 (100개 이상)
        if (totalCount > 100) {
            const batchSize = 50;
            const estimatedSeconds = Math.ceil(totalCount / batchSize * 0.5);
            if (!confirm(`⚠️ ${totalCount}개의 항목을 삭제합니다.\n\n예상 소요 시간: 약 ${estimatedSeconds}초\n\n계속하시겠습니까?`)) {
                return;
            }
        }
        
        // 진행 상황 표시를 위한 모달 생성
        const progressDiv = document.createElement('div');
        progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:15px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:10000;text-align:center;min-width:400px;';
        progressDiv.innerHTML = `
            <h3 style="margin:0 0 20px 0;color:#d32f2f;">선택 항목 삭제 중...</h3>
            <div style="background:#f0f0f0;height:30px;border-radius:15px;overflow:hidden;margin-bottom:15px;">
                <div id="selectionDeleteProgressBar" style="background:linear-gradient(90deg,#f44336,#d32f2f);height:100%;width:0%;transition:width 0.3s;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:14px;"></div>
            </div>
            <p id="selectionDeleteProgress" style="margin:10px 0;color:#666;font-size:16px;">0 / ${totalCount}</p>
            <p id="selectionDeleteSpeed" style="margin:5px 0;color:#999;font-size:14px;">준비 중...</p>
        `;
        document.body.appendChild(progressDiv);
        
        // 재시도 함수
        async function deleteWithRetry(url, maxRetries = 3) {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const response = await fetch(url, { method: 'DELETE' });
                    
                    if (response.ok || response.status === 204) {
                        return { success: true };
                    }
                    
                    // 5xx 에러는 재시도
                    if (response.status >= 500 && attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                        continue;
                    }
                    
                    return { success: false, error: `HTTP ${response.status}` };
                } catch (error) {
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                        continue;
                    }
                    return { success: false, error: error.message };
                }
            }
            return { success: false, error: 'Max retries reached' };
        }
        
        // 배치 삭제
        let successCount = 0;
        let errorCount = 0;
        const batchSize = 20; // 배치 크기 줄임 (50 → 20)
        const startTime = Date.now();
        
        for (let i = 0; i < selectedIds.length; i += batchSize) {
            const batch = selectedIds.slice(i, i + batchSize);
            const batchPromises = batch.map(async (id, idx) => {
                const actualIndex = i + idx;
                const result = await deleteWithRetry(`tables/${tableName}/${id}`, 3);
                return { ...result, index: actualIndex, id: id };
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
                        console.error(`삭제 실패 [${i + idx}]:`, result.value.error, batch[idx]);
                    }
                } else {
                    errorCount++;
                    console.error(`삭제 실패 [${i + idx}]:`, result.reason, batch[idx]);
                }
            });
            
            // 진행 상황 업데이트
            const processed = i + batch.length;
            const percentage = Math.round((processed / totalCount) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = processed / elapsed;
            const remaining = processed < totalCount ? (totalCount - processed) / speed : 0;
            
            const progressElement = document.getElementById('selectionDeleteProgress');
            const progressBarElement = document.getElementById('selectionDeleteProgressBar');
            const speedElement = document.getElementById('selectionDeleteSpeed');
            
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
            if (div.innerHTML && div.innerHTML.includes('선택 항목 삭제 중')) {
                div.remove();
            }
        });
        
        let message = `선택 삭제 완료! (소요 시간: ${totalTime}초)\n\n✅ 삭제: ${successCount}개`;
        if (errorCount > 0) {
            message += `\n❌ 실패: ${errorCount}개`;
        }
        alert(message);
        
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
            const progressElement = document.getElementById('selectionDeleteProgress');
            if (progressElement && progressElement.parentElement && progressElement.parentElement.parentElement) {
                document.body.removeChild(progressElement.parentElement.parentElement);
            }
            
            // 혹시 남아있는 모든 모달 제거
            document.querySelectorAll('div').forEach(div => {
                if (div.innerHTML && div.innerHTML.includes('선택 항목 삭제 중')) {
                    div.remove();
                }
            });
        } catch (e) {
            console.error('모달 제거 오류:', e);
        }
        
        console.error('선택 삭제 오류:', error);
        alert('선택 삭제 중 오류가 발생했습니다.\n오류: ' + error.message);
    }
}
