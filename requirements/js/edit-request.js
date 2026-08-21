// 수정 요청 관리

// 수정 요청 제출
async function submitEditRequest(tableName, recordId, originalData, newData) {
    try {
        const { username, role, company_name } = currentUser;

        // master는 직접 수정
        if (role === 'master') {
            return await updateRecordDirectly(tableName, recordId, newData);
        }

        // 일반 사용자는 수정 요청 생성
        const requestData = {
            table_name: tableName,
            record_id: recordId,
            requester_username: username,
            requester_company: company_name,
            original_data: JSON.stringify(originalData),
            requested_data: JSON.stringify(newData),
            status: 'pending',
            request_date: new Date().getTime()
        };

        console.log('[Edit Request] 수정 요청 생성:', requestData);

        const result = await GoogleSheetsAPI.addData('edit_requests', requestData, username);

        if (result.success) {
            alert('수정 요청이 제출되었습니다. 관리자 승인 후 반영됩니다.');
            return { success: true };
        } else {
            throw new Error(result.error || '수정 요청 제출 실패');
        }

    } catch (error) {
        console.error('[Edit Request] 요청 실패:', error);
        alert('수정 요청 제출 중 오류가 발생했습니다: ' + error.message);
        return { success: false, error: error.message };
    }
}

// 관리자: 직접 수정
async function updateRecordDirectly(tableName, recordId, newData) {
    try {
        const { username, role, company_name } = currentUser;

        const response = await fetch(`tables/${tableName}/${recordId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newData)
        });

        if (response.ok) {
            alert('수정되었습니다.');
            return { success: true };
        } else {
            throw new Error('수정 실패');
        }

    } catch (error) {
        console.error('[Edit] 직접 수정 실패:', error);
        alert('수정 중 오류가 발생했습니다: ' + error.message);
        return { success: false, error: error.message };
    }
}

// 수정 요청 목록 로드
async function loadEditRequests() {
    try {
        const tbody = document.getElementById('editRequestsTableBody');

        // 섹션이 없으면 종료 (다른 페이지에서 호출된 경우)
        if (!tbody) {
            console.log('[Edit Requests] 수정 요청 관리 섹션이 없습니다.');
            return;
        }

        if (!isMasterUser()) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 40px; color: #999;">
                        <i class="fas fa-lock" style="font-size: 48px; margin-bottom: 10px; display: block;"></i>
                        관리자만 접근 가능합니다.
                    </td>
                </tr>
            `;
            return;
        }

        const { username, role, company_name } = currentUser;

        const response = await fetch(`tables/edit_requests?limit=1000`);
        if (!response.ok) {
            throw new Error('수정 요청 목록 로드 실패');
        }

        const result = await response.json();
        const requests = result.data || [];

        console.log('[Edit Requests] 로드:', requests.length + '건');

        // pending 상태만 필터링
        const pendingRequests = requests.filter(req => req.status === 'pending');

        displayEditRequests(pendingRequests);

    } catch (error) {
        console.error('[Edit Requests] 로드 오류:', error);
        document.getElementById('editRequestsTableBody').innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: #ef4444;">
                    오류: ${error.message}
                </td>
            </tr>
        `;
    }
}

// 수정 요청 표시
function displayEditRequests(requests) {
    const tbody = document.getElementById('editRequestsTableBody');

    // tbody가 없으면 종료 (다른 페이지에서 호출된 경우)
    if (!tbody) {
        console.log('[Edit Requests] editRequestsTableBody를 찾을 수 없습니다.');
        return;
    }

    if (requests.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: #999;">
                    <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 10px; display: block;"></i>
                    대기 중인 수정 요청이 없습니다.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = requests.map(req => {
        const requestDate = new Date(req.request_date || req.created_at);
        const originalData = JSON.parse(req.original_data || '{}');
        const requestedData = JSON.parse(req.requested_data || '{}');

        // 변경된 필드 찾기
        const changedFields = [];
        for (const key in requestedData) {
            if (requestedData[key] !== originalData[key] &&
                key !== 'id' && key !== 'created_at' && key !== 'updated_at') {
                changedFields.push(key);
            }
        }

        return `
            <tr>
                <td>${requestDate.toLocaleString('ko-KR')}</td>
                <td><span class="badge badge-info">${getTableKoreanName(req.table_name)}</span></td>
                <td>${req.requester_username || 'N/A'}</td>
                <td>${req.requester_company || 'N/A'}</td>
                <td>
                    <button class="action-btn btn-view" onclick="viewEditRequestDetails('${req.id}')">
                        <i class="fas fa-eye"></i> 상세보기
                    </button>
                </td>
                <td>${changedFields.length}개 필드</td>
                <td>
                    <button class="action-btn btn-success" onclick="approveEditRequest('${req.id}')">
                        <i class="fas fa-check"></i> 승인
                    </button>
                    <button class="action-btn btn-danger" onclick="rejectEditRequest('${req.id}')">
                        <i class="fas fa-times"></i> 거부
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// 테이블 한글 이름
function getTableKoreanName(tableName) {
    const names = {
        'chemical_confirmation': '화학물질확인',
        'msds': 'MSDS',
        'radio_law': '전파법',
        'electrical_law': '전안법',
        'medical_device': '의료기기',
        'non_target': '비대상',
        'review_needed': '확인필요'
    };
    return names[tableName] || tableName;
}

// 수정 요청 상세보기
async function viewEditRequestDetails(requestId) {
    try {
        const response = await fetch(`tables/edit_requests/${requestId}`);
        if (!response.ok) {
            throw new Error('수정 요청 조회 실패');
        }

        const request = await response.json();
        const originalData = JSON.parse(request.original_data || '{}');
        const requestedData = JSON.parse(request.requested_data || '{}');

        // 변경사항 비교
        let changesHTML = '<table style="width: 100%; border-collapse: collapse;">';
        changesHTML += '<tr style="background: #f8f9fa;"><th style="padding: 10px; border: 1px solid #ddd;">필드</th><th style="padding: 10px; border: 1px solid #ddd;">변경 전</th><th style="padding: 10px; border: 1px solid #ddd;">변경 후</th></tr>';

        for (const key in requestedData) {
            if (requestedData[key] !== originalData[key] &&
                key !== 'id' && key !== 'created_at' && key !== 'updated_at') {
                changesHTML += `
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd;"><strong>${key}</strong></td>
                        <td style="padding: 10px; border: 1px solid #ddd; background: #fee;">${originalData[key] || '(없음)'}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; background: #efe;">${requestedData[key] || '(없음)'}</td>
                    </tr>
                `;
            }
        }
        changesHTML += '</table>';

        const modalContent = `
            <h3 style="margin-bottom: 20px;">수정 요청 상세</h3>
            <p><strong>요청자:</strong> ${request.requester_username} (${request.requester_company})</p>
            <p><strong>테이블:</strong> ${getTableKoreanName(request.table_name)}</p>
            <p><strong>요청일시:</strong> ${new Date(request.request_date || request.created_at).toLocaleString('ko-KR')}</p>
            <hr style="margin: 20px 0;">
            <h4 style="margin-bottom: 10px;">변경 내용</h4>
            ${changesHTML}
        `;

        document.getElementById('modalContent').innerHTML = modalContent;
        document.getElementById('editModal').style.display = 'block';

    } catch (error) {
        console.error('[Edit Request] 상세보기 오류:', error);
        alert('수정 요청 조회 중 오류가 발생했습니다: ' + error.message);
    }
}

// 수정 요청 승인
async function approveEditRequest(requestId) {
    if (!confirm('이 수정 요청을 승인하시겠습니까?')) {
        return;
    }

    try {
        const { username } = currentUser;

        // 수정 요청 조회
        const response = await fetch(`tables/edit_requests/${requestId}`);
        if (!response.ok) {
            throw new Error('수정 요청 조회 실패');
        }

        const request = await response.json();
        const requestedData = JSON.parse(request.requested_data || '{}');

        // 실제 데이터 수정
        const updateResponse = await fetch(`tables/${request.table_name}/${request.record_id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestedData)
        });

        if (!updateResponse.ok) {
            throw new Error('데이터 수정 실패');
        }

        // 요청 상태를 'approved'로 변경
        await GoogleSheetsAPI.updateData('edit_requests', requestId, {
            status: 'approved',
            approved_by: username,
            approved_date: new Date().getTime()
        }, username, 'master', '관리자');

        alert('수정 요청이 승인되었습니다.');
        loadEditRequests();

    } catch (error) {
        console.error('[Edit Request] 승인 오류:', error);
        alert('수정 요청 승인 중 오류가 발생했습니다: ' + error.message);
    }
}

// 수정 요청 거부
async function rejectEditRequest(requestId) {
    const reason = prompt('거부 사유를 입력하세요:');
    if (!reason) {
        return;
    }

    try {
        const { username } = currentUser;

        // 요청 상태를 'rejected'로 변경
        await GoogleSheetsAPI.updateData('edit_requests', requestId, {
            status: 'rejected',
            rejected_by: username,
            rejected_date: new Date().getTime(),
            rejection_reason: reason
        }, username, 'master', '관리자');

        alert('수정 요청이 거부되었습니다.');
        loadEditRequests();

    } catch (error) {
        console.error('[Edit Request] 거부 오류:', error);
        alert('수정 요청 거부 중 오류가 발생했습니다: ' + error.message);
    }
}
