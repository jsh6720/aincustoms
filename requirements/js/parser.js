// 텍스트 파싱 함수들

// 규격정제 자동 추출 함수
function extractSpecNo(modelSpec) {
    if (!modelSpec) return '';
    
    // 쉼표나 공백으로 구분된 첫 번째 Part No 추출
    // 예: "241-005-0087, 99.5% 13L 5pack" => "241-005-0087"
    // 예: "OC035_00.02.063_Gasoline E10" => "OC035_00.02.063_Gasoline E10"
    
    const patterns = [
        /^([A-Z0-9\-_]+)/i,  // 영숫자, 하이픈, 언더스코어로 시작
        /([0-9]{3}-[0-9]{3}-[0-9]{4})/,  // xxx-xxx-xxxx 패턴
    ];
    
    for (const pattern of patterns) {
        const match = modelSpec.match(pattern);
        if (match) {
            return match[1] || match[0];
        }
    }
    
    // 쉼표 전까지 추출
    const commaIndex = modelSpec.indexOf(',');
    if (commaIndex > 0) {
        return modelSpec.substring(0, commaIndex).trim();
    }
    
    // 첫 공백 전까지 추출
    const spaceIndex = modelSpec.indexOf(' ');
    if (spaceIndex > 0) {
        return modelSpec.substring(0, spaceIndex).trim();
    }
    
    return modelSpec.trim();
}

// 화학물질확인서 파싱
function parseChemicalConfirmation(text) {
    const records = [];
    
    try {
        // 줄 단위로 분리
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        
        // 데이터 줄 찾기 (숫자로 시작하는 줄들)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // xxx-xxx-xxxx 패턴으로 시작하는 줄 찾기
            if (/^\d{3}-\d{3}-\d{4}/.test(line)) {
                const parts = line.split(/\s+/);
                
                if (parts.length >= 10) {
                    const record = {
                        spec_no: parts[0],
                        no: parts[1] || '',
                        receipt_date: parts[2] || '',
                        receipt_number: parts[3] || '',
                        status: parts[4] || '',
                        company: parts[5] || '',
                        manager: parts[6] || '',
                        user: parts[7] || '',
                        product_name: '',
                        model_spec: '',
                        import_country: '',
                        annual_import_qty: '',
                        hsk_no: '',
                        division: '',
                        usage: '',
                        agent: '',
                        save_date: '',
                        department: '',
                        importer: currentUser ? currentUser.company_name : '',
                        created_by: currentUser ? currentUser.username : ''
                    };
                    
                    // 제품명과 모델 찾기
                    let idx = 8;
                    let productName = [];
                    while (idx < parts.length && !parts[idx].match(/^\d{4}\.\d{2}\.\d{2}/) && parts[idx] !== 'United') {
                        productName.push(parts[idx]);
                        idx++;
                    }
                    record.product_name = productName.join(' ');
                    
                    // 나머지 필드 매핑
                    if (idx < parts.length) {
                        // 다음 줄에서 모델·규격, 수입국 등 찾기
                        const nextLine = lines[i + 1];
                        if (nextLine) {
                            const nextParts = nextLine.split(/\s+/);
                            record.model_spec = nextParts[0] || '';
                            record.spec_no = extractSpecNo(record.model_spec);
                            record.import_country = nextParts.find(p => p === 'United' || p === 'China' || p === 'Japan') || '';
                            
                            // HSK No 찾기
                            const hskMatch = nextLine.match(/(\d{4}\.\d{2}-\d{4})/);
                            if (hskMatch) record.hsk_no = hskMatch[1];
                        }
                    }
                    
                    records.push(record);
                }
            }
            
            // 접수번호 패턴으로 데이터 찾기 (C로 시작하는 패턴)
            if (/C\d{4}-\d{6}/.test(line)) {
                const receiptMatch = line.match(/C\d{4}-\d{6}/);
                const dateMatch = line.match(/\d{4}-\d{2}-\d{2}/g);
                const companyMatch = line.match(/(영인[가-힣]+\(주\)|[가-힣]+\(주\))/);
                
                if (receiptMatch) {
                    // 제품명 찾기
                    const productMatch = line.match(/③\s*제품명[^\d]*([^\d]+)/);
                    const productName = productMatch ? productMatch[1].trim() : '';
                    
                    // 모델·규격 찾기
                    const modelMatch = line.match(/⑨\s*모델\s*규격\s+([^\s]+)/);
                    const modelSpec = modelMatch ? modelMatch[1] : '';
                    
                    const record = {
                        spec_no: extractSpecNo(modelSpec),
                        receipt_number: receiptMatch[0],
                        receipt_date: dateMatch && dateMatch[0] ? dateMatch[0] : '',
                        product_name: productName,
                        model_spec: modelSpec,
                        company: companyMatch ? companyMatch[1] : '',
                        status: '처리중',
                        importer: currentUser ? currentUser.company_name : '',
                        created_by: currentUser ? currentUser.username : ''
                    };
                    
                    records.push(record);
                }
            }
        }
    } catch (error) {
        console.error('화학물질확인서 파싱 오류:', error);
    }
    
    return records;
}

// MSDS 파싱
function parseMSDS(text) {
    const records = [];
    
    try {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        
        let currentImporter = '';
        let currentSpecNo = '';
        let currentInternalNo = '';
        
        for (const line of lines) {
            const parts = line.split(/\s+/);
            
            // 수입자 찾기
            if (line.includes('영인') || line.match(/\([주주]\)/)) {
                currentImporter = parts[0];
            }
            
            // 규격정제와 내부관리번호 찾기
            if (parts.length >= 3 && /^[A-Z0-9\-]+$/i.test(parts[0])) {
                currentSpecNo = parts[0];
                currentInternalNo = parts[1];
            }
            
            // CAS 번호가 있는 줄 파싱
            if (line.match(/\d{2,7}-\d{2}-\d/)) {
                const casMatch = line.match(/(\d{2,7}-\d{2}-\d)/);
                
                if (casMatch && parts.length >= 2) {
                    const record = {
                        importer: currentImporter || (currentUser ? currentUser.company_name : ''),
                        spec_no: currentSpecNo,
                        internal_mgmt_no: currentInternalNo,
                        substance: casMatch[1],
                        specific_gravity: parts[parts.length - 1] || '',
                        existing_new: parts.includes('기존') ? '기존' : (parts.includes('신규') ? '신규' : ''),
                        created_by: currentUser ? currentUser.username : ''
                    };
                    
                    records.push(record);
                }
            }
        }
    } catch (error) {
        console.error('MSDS 파싱 오류:', error);
    }
    
    return records;
}

// 전파법/전안법 파싱
function parseRadioLaw(text) {
    const records = [];
    
    try {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        
        let currentModelName = '';
        let currentCertNo = '';
        let currentManufacturer = '';
        let currentCountry = '';
        let derivedModels = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // 모델명 찾기
            if (line.includes('모델명') || line.match(/^[A-Z0-9\-]+$/i)) {
                const modelMatch = line.match(/모델명\s+([A-Z0-9\-]+)/i);
                if (modelMatch) {
                    currentModelName = modelMatch[1];
                } else if (/^[A-Z0-9\-]+$/i.test(line) && line.length > 3) {
                    currentModelName = line;
                }
            }
            
            // 파생모델명 찾기
            if (line.includes('파생모델명')) {
                const nextLine = lines[i + 1];
                if (nextLine) {
                    derivedModels = nextLine.split(/\s+/).filter(m => m && m.length > 2);
                }
            }
            
            // 인증번호 찾기
            if (line.match(/R-[A-Z]-[A-Z0-9\-]+/i)) {
                const certMatch = line.match(/(R-[A-Z]-[A-Z0-9\-]+)/i);
                if (certMatch) currentCertNo = certMatch[1];
            }
            
            // 제조사 찾기
            if (line.includes('제조자') || line.includes('제조원')) {
                const nextLine = lines[i + 1];
                if (nextLine) {
                    currentManufacturer = nextLine.split(/\s+/)[0] || '';
                }
            }
            
            // 제조국가 찾기
            if (line.includes('제조국가') || line.includes('이탈리아') || line.includes('중국') || line.includes('미국')) {
                const countries = ['이탈리아', '중국', '미국', '일본', '독일', '영국'];
                for (const country of countries) {
                    if (line.includes(country)) {
                        currentCountry = country;
                        break;
                    }
                }
            }
            
            // 인증일자 찾기
            const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
            const certDate = dateMatch ? dateMatch[1] : '';
            
            // 레코드 생성
            if (currentModelName && currentCertNo) {
                // 기본 모델
                const baseRecord = {
                    spec_no: currentModelName,
                    law: '전파법',
                    consignee: currentUser ? currentUser.company_name : '',
                    model_name: currentModelName,
                    manufacturer: currentManufacturer,
                    manufacturing_country: currentCountry,
                    certification_no: currentCertNo,
                    certification_date: certDate,
                    item_name: currentModelName,
                    created_by: currentUser ? currentUser.username : ''
                };
                records.push(baseRecord);
                
                // 파생 모델들도 개별 레코드로 추가
                for (const derivedModel of derivedModels) {
                    const derivedRecord = {
                        ...baseRecord,
                        spec_no: derivedModel,
                        model_name: derivedModel,
                        item_name: derivedModel,
                        note: `파생모델 (기본: ${currentModelName})`
                    };
                    records.push(derivedRecord);
                }
                
                // 초기화
                currentModelName = '';
                currentCertNo = '';
                derivedModels = [];
            }
        }
    } catch (error) {
        console.error('전파법/전안법 파싱 오류:', error);
    }
    
    return records;
}

// 의료기기 파싱
function parseMedicalDevice(text) {
    const records = [];
    
    try {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        
        for (const line of lines) {
            const parts = line.split(/\t/); // 탭으로 구분된 경우
            
            if (parts.length > 10) {
                const record = {
                    spec_no: extractSpecNo(parts[7] || ''), // 품목영문명에서 추출
                    transmission_mgmt_no: parts[0] || '',
                    writing_mgmt_no: parts[1] || '',
                    doc_status: parts[2] || '',
                    customs_receipt: parts[3] || '',
                    issue_no: parts[4] || '',
                    issue_date: parts[5] || '',
                    year: parts[6] || '',
                    item_code: parts[7] || '',
                    hs_code: parts[9] || '',
                    item_name_eng: parts[10] || '',
                    model_name: parts[11] || '',
                    quantity: parts[12] || '',
                    quantity_unit: parts[13] || '',
                    unit_price: parts[14] || '',
                    amount: parts[15] || '',
                    amount_unit: parts[16] || '',
                    amount_usd: parts[17] || '',
                    amount_krw: parts[18] || '',
                    invoice_no: parts[19] || '',
                    manufacturer_name1: parts[24] || '',
                    manufacturer_country_code: parts[27] || '',
                    created_by: currentUser ? currentUser.username : ''
                };
                
                records.push(record);
            }
        }
    } catch (error) {
        console.error('의료기기 파싱 오류:', error);
    }
    
    return records;
}

// 자동 파싱 - 텍스트 타입 감지
function autoParse(text) {
    let type = 'unknown';
    let records = [];
    
    // 화학물질확인서 감지
    if (text.includes('화학물질 확인명세서') || text.includes('화학물질관리법') || /C\d{4}-\d{6}/.test(text)) {
        type = 'chemical';
        records = parseChemicalConfirmation(text);
    }
    // MSDS 감지
    else if (text.match(/\d{2,7}-\d{2}-\d/) && (text.includes('기존') || text.includes('신규'))) {
        type = 'msds';
        records = parseMSDS(text);
    }
    // 전파법 감지
    else if (text.includes('전파법') || text.includes('인증번호') || text.match(/R-[A-Z]-/)) {
        type = 'radio';
        records = parseRadioLaw(text);
    }
    // 의료기기 감지
    else if (text.includes('표준통관예정보고') || text.includes('전송관리번호')) {
        type = 'medical';
        records = parseMedicalDevice(text);
    }
    
    return { type, records };
}
