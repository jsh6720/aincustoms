// 파일 업로드 및 다운로드 핸들러

// CSV 파싱 함수 (파일 업로드 전용 - 쉼표 구분자, 따옴표 처리)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // 이스케이프된 따옴표 ("")
                current += '"';
                i++; // 다음 따옴표 건너뛰기
            } else {
                // 따옴표 시작 또는 끝
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // 따옴표 밖의 쉼표 = 구분자
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    // 마지막 필드 추가
    result.push(current.trim());
    
    return result;
}

function parseCSVTable(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return { headers: [], records: [] };
    
    // 첫 줄은 헤더
    const headers = parseCSVLine(lines[0]);
    const records = [];
    
    // 나머지는 데이터
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = parseCSVLine(line);
        if (values.length < headers.length) continue;
        
        const record = {};
        headers.forEach((header, index) => {
            record[header] = values[index] || '';
        });
        records.push(record);
    }
    
    return { headers, records };
}

// CSV 파일 읽기
function readCSVFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const result = parseCSVTable(text);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('파일 읽기 실패'));
        reader.readAsText(file, 'UTF-8');
    });
}

// Excel 파일 읽기 (SheetJS 라이브러리 사용)
async function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                // raw: true 옵션으로 숫자를 문자열로 유지
                const workbook = XLSX.read(data, { type: 'array', raw: true });
                
                // 첫 번째 시트 읽기
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // CSV로 변환 (raw: true로 원본 형식 유지)
                const csv = XLSX.utils.sheet_to_csv(worksheet, { raw: true });
                const result = parseCSVTable(csv);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('파일 읽기 실패'));
        reader.readAsArrayBuffer(file);
    });
}

// 파일 업로드 처리
async function handleFileUpload(file, dataType) {
    try {
        console.log('handleFileUpload 시작:', file.name);
        const fileExtension = file.name.split('.').pop().toLowerCase();
        console.log('파일 확장자:', fileExtension);
        let result;
        
        if (fileExtension === 'csv') {
            console.log('CSV 파일 읽기 시작...');
            result = await readCSVFile(file);
        } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            console.log('Excel 파일 읽기 시작...');
            result = await readExcelFile(file);
        } else {
            throw new Error('지원하지 않는 파일 형식입니다. (.csv, .xlsx, .xls만 지원)');
        }
        
        console.log('파일 파싱 결과:', result);
        
        if (!result || result.records.length === 0) {
            throw new Error('파일에서 데이터를 찾을 수 없습니다.');
        }
        
        console.log('handleFileUpload 완료, 레코드 수:', result.records.length);
        return result;
    } catch (error) {
        console.error('파일 업로드 오류 상세:', error);
        throw error;
    }
}

// CSV 다운로드
function downloadCSV(data, filename, headers) {
    try {
        // BOM 추가 (Excel에서 한글 깨짐 방지)
        const BOM = '\uFEFF';
        
        // 헤더 행 생성
        let csv = headers.join(',') + '\n';
        
        // 데이터 행 생성
        data.forEach(row => {
            const values = headers.map(header => {
                const value = row[getFieldNameFromLabel(header)] || '';
                // 쉼표나 줄바꿈이 있으면 따옴표로 감싸기
                if (value.toString().includes(',') || value.toString().includes('\n') || value.toString().includes('"')) {
                    return `"${value.toString().replace(/"/g, '""')}"`;
                }
                return value;
            });
            csv += values.join(',') + '\n';
        });
        
        // Blob 생성 및 다운로드
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        return true;
    } catch (error) {
        console.error('CSV 다운로드 오류:', error);
        throw error;
    }
}

// Excel 다운로드
function downloadExcel(data, filename, headers) {
    try {
        console.log('Excel 다운로드 시작:', { filename, headers, dataCount: data.length });
        
        // 헤더와 데이터를 2차원 배열로 변환
        const wsData = [headers];
        
        data.forEach((row, index) => {
            const rowData = headers.map(header => {
                const fieldName = getFieldNameFromLabel(header);
                const value = row[fieldName];
                if (index === 0) {
                    console.log(`헤더 "${header}" -> 필드 "${fieldName}" -> 값:`, value);
                }
                return value !== undefined && value !== null ? value : '';
            });
            wsData.push(rowData);
        });
        
        console.log('데이터 변환 완료, 워크북 생성 중...');
        
        // 워크북 생성
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        
        // 규격정제 열을 텍스트 형식으로 설정 (20001.210이 20001.21로 변환되는 것 방지)
        const specNoColIndex = headers.indexOf('규격정제');
        if (specNoColIndex >= 0) {
            const range = XLSX.utils.decode_range(ws['!ref']);
            for (let row = range.s.r + 1; row <= range.e.r; row++) {
                const cellAddress = XLSX.utils.encode_cell({ r: row, c: specNoColIndex });
                if (ws[cellAddress]) {
                    ws[cellAddress].z = '@'; // 텍스트 형식
                    ws[cellAddress].t = 's'; // 문자열 타입
                }
            }
        }
        
        // 컬럼 너비 자동 조정
        const colWidths = headers.map(header => ({
            wch: Math.max(header.length, 15)
        }));
        ws['!cols'] = colWidths;
        
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        
        console.log('워크북 생성 완료, 파일 다운로드 중...');
        
        // 파일 다운로드
        XLSX.writeFile(wb, filename);
        
        console.log('Excel 다운로드 완료!');
        
        return true;
    } catch (error) {
        console.error('Excel 다운로드 오류 상세:', error);
        console.error('오류 스택:', error.stack);
        throw error;
    }
}

// 라벨에서 필드명 가져오기 (역매핑)
function getFieldNameFromLabel(label) {
    const fieldMap = {
        // 화학물질확인
        '규격정제': 'spec_no',
        'No': 'no',
        '접수일자': 'receipt_date',
        '접수번호': 'receipt_number',
        '상태': 'status',
        '상호': 'company',
        '담당자': 'manager',
        '사용자': 'user',
        '제품명': 'product_name',
        '모델·규격': 'model_spec',
        '모델ㆍ규격': 'model_spec',
        '수입국': 'import_country',
        '연간수입예정량': 'annual_import_qty',
        'HSK No': 'hsk_no',
        '구분': 'division',
        '사용여부': 'usage',
        '대리인': 'agent',
        '저장일자': 'save_date',
        '소속': 'department',
        '등록(등록)': 'registered_registered',
        '등록(면제)': 'registered_exempted',
        '기존(등록)': 'existing_registered',
        '기존(면제)': 'existing_exempted',
        '신규(등록)': 'new_registered',
        '신규(면제)': 'new_exempted',
        '유독물질': 'toxic_substance',
        '허가물질': 'permitted_substance',
        '제한물질': 'restricted_substance',
        '금지물질': 'prohibited_substance',
        '사고대비물질': 'accident_prep_substance',
        
        // MSDS
        '수입자': 'importer',
        '내부관리 No': 'internal_mgmt_no',
        '물질': 'substance',
        '비중': 'specific_gravity',
        '기존/신규': 'existing_new',
        '기존/신규(Cas)': 'existing_new',
        '유해': 'hazardous',
        '혼합/단일': 'mixture_type',
        
        // 전파법/전안법
        '법령': 'law',
        '인증기관': 'certification_agency',
        '화주': 'consignee',
        '모델명': 'model_name',
        '비고': 'note',
        '제조사': 'manufacturer',
        '제조국': 'manufacturing_country',
        '인증번호': 'certification_no',
        '인증일자': 'certification_date',
        '품목명': 'item_name',
        
        // 의료기기
        '수출자': 'exporter',
        '확인 여부': 'confirmation_status',
        
        // 비대상
        '법령부호': 'law_code',
        '비대상 사유': 'non_target_reason',
        
        // 확인 필요
        'Description': 'description',
        '단가': 'unit_price',
        'HS code': 'hs_code',
        '수입자상호': 'importer',
        '해외공급처': 'exporter',
        '화학물질대상': 'chemical_target',
        '화관법(확인명세)': 'chemical_confirm',
        '화평법(MSDS)': 'msds_register',
        '의료기기/원안법': 'medical_nuclear',
        '전파대상': 'radio_target',
        '전파법인증': 'radio_cert',
        '전파비대상': 'radio_non_target',
        '전안법대상': 'electrical_target',
        '전안법인증': 'electrical_cert',
        '전안비대상': 'electrical_non_target',
        '비고': 'note',
        '조치사항': 'action_note'
    };
    
    return fieldMap[label] || label;
}

// 데이터 타입별 헤더 정의
function getHeadersByType(type) {
    const headers = {
        'chemical': [
            '규격정제', 'No', '접수일자', '접수번호', '상태', '상호', '담당자', '사용자', '제품명', '모델ㆍ규격', '수입국', '연간수입예정량', 'HSK No', '구분', '사용여부', '대리인', '저장일자', '소속', '등록(등록)', '등록(면제)', '기존(등록)', '기존(면제)', '신규(등록)', '신규(면제)', '유독물질', '허가물질', '제한물질', '금지물질', '사고대비물질'
        ],
        'msds': [
            '수입자', '규격정제', '내부관리 No', '물질', '비중', '기존/신규(Cas)', '유해', '비고', '혼합/단일'
        ],
        'radio': [
            '규격정제', '화주', '모델명', '비고', '제조사', '제조국', 
            '인증번호', '인증일자', '품목명'
        ],
        'electrical': [
            '규격정제', '인증기관', '화주', '모델명', '비고', '제조사', '제조국', 
            '인증번호', '인증일자', '품목명'
        ],
        'medical': [
            '규격정제', '법령부호', '법령', '수입자', '수출자', '확인 여부'
        ],
        'non_target': [
            '규격정제', '법령부호', '법령', '수입자', '수출자', '비대상 사유'
        ],
        'review_needed': [
            '규격정제', 'Description', '단가', 'HS code', '수입자상호', '해외공급처',
            '화학물질대상', '화관법(확인명세)', '화평법(MSDS)', '의료기기/원안법',
            '전파대상', '전파법인증', '전파비대상', '전안법대상', '전안법인증', '전안비대상', '비고', '조치사항'
        ]
    };
    
    return headers[type] || [];
}

// 데이터 타입별 라벨
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

// 데이터 타입별 파일명 생성
function getFilenameByType(type, extension) {
    const names = {
        'chemical': '화학물질확인',
        'msds': 'MSDS',
        'radio': '전파법',
        'electrical': '전안법',
        'medical': '의료기기_원안법_등',
        'non_target': '비대상',
        'review_needed': '확인필요'
    };
    
    const today = new Date().toISOString().split('T')[0];
    return `${names[type] || 'data'}_${today}.${extension}`;
}

// 파일 업로드 다이얼로그 표시
function showFileUploadDialog(dataType) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            console.log('파일 업로드 시작:', file.name, dataType);
            showLoading('파일 업로드 중...');
            
            console.log('파일 읽기 시작...');
            const result = await handleFileUpload(file, dataType);
            console.log('파일 읽기 완료');
            
            console.log('파일 파싱 결과:', result);
            
            if (!result.records || result.records.length === 0) {
                hideLoading();
                alert('파일에서 데이터를 찾을 수 없습니다.');
                return;
            }
            
            // app.js의 mapHeadersToFields 함수 사용
            const mappedRecords = result.records.map(record => mapHeadersToFields(record, dataType));
            
            console.log('매핑된 레코드:', mappedRecords);
            
            // 데이터 저장
            const tableMap = {
                'chemical': 'chemical_confirmation',
                'msds': 'msds',
                'radio': 'radio_law',
                'electrical': 'electrical_law',
                'medical': 'medical_device',
                'non_target': 'non_target',
                'review_needed': 'review_needed'
            };
            
            let successCount = 0;
            let errorCount = 0;
            let skipCount = 0;
            const totalCount = mappedRecords.length;
            
            console.log(`${totalCount}개의 데이터 업로드 시작...`);
            
            // 파일 크기에 따른 경고 (Excel/CSV 파일 업로드)
            if (totalCount > 1000) {
                const batchSize = 50;
                const estimatedMinutes = Math.ceil(totalCount / batchSize / 60);
                if (!confirm(`${totalCount}개의 대용량 데이터를 업로드합니다.\n\n예상 소요 시간: 약 ${estimatedMinutes}분\n\n계속하시겠습니까?`)) {
                    hideLoading();
                    return;
                }
            }
            
            // 기존 데이터 한 번만 로드 (중복 체크용)
            showLoading('중복 체크 준비 중...');
            const existingDataCache = await loadExistingDataForDuplicateCheck(tableMap[dataType], dataType);
            
            // 중복 제거된 레코드만 필터링
            const nonDuplicateRecords = [];
            for (let i = 0; i < mappedRecords.length; i++) {
                const data = mappedRecords[i];
                const isDuplicate = checkDuplicateWithCache(data, dataType, existingDataCache);
                
                if (isDuplicate) {
                    skipCount++;
                    console.log(`중복 스킵 [${i + 1}/${totalCount}]`);
                } else {
                    nonDuplicateRecords.push(data);
                }
            }
            
            console.log(`중복 제거 완료: ${nonDuplicateRecords.length}개 업로드 예정 (중복: ${skipCount}개)`);
            
            if (nonDuplicateRecords.length === 0) {
                hideLoading();
                alert(`모든 데이터가 중복입니다.\n중복: ${skipCount}개`);
                return;
            }
            
            // 배치 처리로 업로드 (한 번에 10개씩 - 서버 부하 감소)
            const batchSize = 10;
            const startTime = Date.now();
            
            // 재시도 함수
            async function saveWithRetry(url, data, maxRetries = 3) {
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        const response = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(data)
                        });
                        
                        if (response.ok) {
                            return { success: true };
                        }
                        
                        // 500 에러는 재시도
                        if (response.status >= 500 && attempt < maxRetries) {
                            const errorText = await response.text();
                            console.log(`재시도 ${attempt}/${maxRetries} (HTTP ${response.status}):`, errorText);
                            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                            continue;
                        }
                        
                        const errorText = await response.text();
                        return { success: false, error: `HTTP ${response.status}: ${errorText}`, data: data };
                    } catch (error) {
                        if (attempt < maxRetries) {
                            console.log(`재시도 ${attempt}/${maxRetries} (네트워크 오류):`, error.message);
                            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                            continue;
                        }
                        return { success: false, error: error.message, data: data };
                    }
                }
                return { success: false, error: 'Max retries reached', data: data };
            }
            
            for (let i = 0; i < nonDuplicateRecords.length; i += batchSize) {
                const batch = nonDuplicateRecords.slice(i, i + batchSize);
                const batchPromises = batch.map(async (record, idx) => {
                    const actualIndex = i + idx;
                    const result = await saveWithRetry(`tables/${tableMap[dataType]}`, record, 3);
                    
                    if (!result.success) {
                        console.error(`저장 실패 [${actualIndex}]:`, result.error);
                        console.error('실패한 데이터:', result.data);
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
                        console.error(`배치 처리 실패 [${i + idx}]:`, result.reason);
                    }
                });
                
                // 진행 상황 업데이트
                const processed = i + batch.length;
                const percentage = Math.round((processed / nonDuplicateRecords.length) * 100);
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = processed / elapsed;
                const remaining = (nonDuplicateRecords.length - processed) / speed;
                
                showLoading(`파일 업로드 중... ${processed}/${nonDuplicateRecords.length} (${percentage}%)\n속도: ${speed.toFixed(1)}개/초 | 남은 시간: 약 ${Math.ceil(remaining)}초`);
                
                // 다음 배치 전 대기 (서버 부하 방지)
                if (processed < nonDuplicateRecords.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 200ms → 1000ms
                }
            }
            
            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`업로드 완료: 성공 ${successCount}, 실패 ${errorCount}, 중복 ${skipCount} (소요 시간: ${totalTime}초)`);
            
            hideLoading();
            
            let message = `업로드 완료! (소요 시간: ${totalTime}초)\n\n✅ 성공: ${successCount}개\n❌ 실패: ${errorCount}개`;
            if (skipCount > 0) {
                message += `\n⏭️  중복: ${skipCount}개`;
            }
            alert(message);
            
            // 데이터 새로고침
            switch(dataType) {
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
            hideLoading();
            alert('파일 업로드 실패: ' + error.message);
        }
    };
    
    input.click();
}

// CSV/Excel 다운로드 다이얼로그
async function showDownloadDialog(dataType) {
    if (!isMasterUser()) {
        alert('다운로드 권한이 없습니다. (마스터 계정만 가능)');
        return;
    }
    
    // 확인 필요 리스트인 경우 필터 적용 다운로드 실행
    if (dataType === 'review_needed') {
        downloadReviewNeededFiltered();
        return;
    }
    
    const typeLabel = getTypeLabel(dataType);
    const format = confirm(`${typeLabel} 데이터를 다운로드합니다.\n\n확인: Excel (.xlsx)\n취소: CSV (.csv)`);
    
    try {
        showLoading('데이터 준비 중...');
        
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
        
        const response = await fetch(`tables/${tableMap[dataType]}?limit=1000`);
        if (!response.ok) {
            throw new Error(`데이터 로드 실패: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('API 응답:', result);
        
        // 응답 구조 확인
        let data;
        if (Array.isArray(result)) {
            data = result;
        } else if (result.data && Array.isArray(result.data)) {
            data = result.data;
        } else {
            console.error('예상치 못한 응답 구조:', result);
            throw new Error('데이터 형식이 올바르지 않습니다');
        }
        
        if (data.length === 0) {
            hideLoading();
            alert('다운로드할 데이터가 없습니다.');
            return;
        }
        
        const headers = getHeadersByType(dataType);
        
        if (format) {
            // Excel 다운로드
            const filename = getFilenameByType(dataType, 'xlsx');
            await downloadExcel(data, filename, headers);
        } else {
            // CSV 다운로드
            const filename = getFilenameByType(dataType, 'csv');
            await downloadCSV(data, filename, headers);
        }
        
        hideLoading();
        alert('다운로드가 완료되었습니다.');
        
    } catch (error) {
        hideLoading();
        console.error('다운로드 오류 상세:', error);
        alert(`다운로드 중 오류가 발생했습니다.\n\n오류 내용: ${error.message}`);
    }
}

// 로딩 표시
function showLoading(message = '처리 중...') {
    let loadingDiv = document.getElementById('loadingOverlay');
    
    if (!loadingDiv) {
        loadingDiv = document.createElement('div');
        loadingDiv.id = 'loadingOverlay';
        loadingDiv.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        `;
        
        loadingDiv.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 12px; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 16px;">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
                <div id="loadingMessage" style="font-size: 16px; color: #333;">${message}</div>
            </div>
        `;
        
        document.body.appendChild(loadingDiv);
    } else {
        document.getElementById('loadingMessage').textContent = message;
        loadingDiv.style.display = 'flex';
    }
}

// 로딩 숨기기
function hideLoading() {
    const loadingDiv = document.getElementById('loadingOverlay');
    if (loadingDiv) {
        loadingDiv.style.display = 'none';
    }
}
