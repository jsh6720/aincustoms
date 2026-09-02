// 전파법 적합성평가 면제확인 관리
//
// 면제확인은 해당 수입 건에만 효력이 있는 건별 승인이다. 인증(적합등록·적합인증)과
// 달리 다음 수입 건에 그대로 쓸 수 없으므로 요건보유 목록과 섞지 않고 따로 관리한다.
// 이행보고 수행여부(report_done)는 담당자가 O/X 로 수기 관리한다.
//
// 이 파일의 함수는 IIFE 안에 가둔다. 예전에 여기서 formatDate 를 전역으로 선언해
// date-formatter.js 의 동명 함수를 덮어썼고, 그 함수를 쓰던 전파법·전안법·화관법
// 화면이 한꺼번에 깨진 적이 있다. 화면에서 호출하는 것만 window 에 붙인다.

(function () {

let allExemptionData = [];
let exemptionReportFilter = 'all';

async function loadRadioExemptionData(searchQuery = '') {
    const tbody = document.getElementById('radioExemptionTableBody');
    // 검색어를 빠르게 두 번 넣으면 먼저 보낸 응답이 나중에 도착해 화면을 덮어쓴다.
    // 다른 목록 로더와 같은 장치로 늦게 온 응답을 버린다.
    const viewRequest = typeof beginRequirementsViewRequest === 'function'
        ? beginRequirementsViewRequest('list:radio_exemption') : null;
    const stale = () => viewRequest !== null
        && typeof isCurrentRequirementsViewRequest === 'function'
        && !isCurrentRequirementsViewRequest(viewRequest);
    try {
        const response = await fetch('tables/radio_exemption?limit=2000');
        if (stale() || response.status === 409) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (stale()) return;
        let records = data.data || [];

        // 권한 필터링 — 마스터가 아니면 자기 회사 건만
        if (typeof isMasterUser === 'function' && !isMasterUser()) {
            records = records.filter(item => canAccessData(item.consignee));
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            records = records.filter(item =>
                String(item.approval_no || '').toLowerCase().includes(q) ||
                String(item.consignee || '').toLowerCase().includes(q) ||
                String(item.spec_no || '').toLowerCase().includes(q) ||
                String(item.model_spec || '').toLowerCase().includes(q) ||
                String(item.product_name || '').toLowerCase().includes(q) ||
                String(item.decl_no || '').toLowerCase().includes(q)
            );
        }

        // 승인일 최신순
        records.sort((a, b) => String(b.approval_date || '').localeCompare(String(a.approval_date || '')));

        allExemptionData = records;
        renderRadioExemptionTable(applyExemptionReportFilter(records));
    } catch (error) {
        if (stale()) return;
        console.error('면제 데이터 로드 오류:', error);
        if (typeof clearTablePager === 'function') clearTablePager('radio_exemption');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="11" class="empty-state" style="color:red;">' +
                '<i class="fas fa-exclamation-triangle"></i><p>데이터를 불러올 수 없습니다.</p>' +
                '<p style="font-size:12px;">AIN_Radio_Exemption 시트가 있는지 확인하세요.</p></td></tr>';
        }
    }
}

function applyExemptionReportFilter(records) {
    if (exemptionReportFilter === 'all') return records;
    return records.filter(r => String(r.report_done || '').trim().toUpperCase() === exemptionReportFilter);
}

function filterExemptionByReport(value) {
    exemptionReportFilter = value;
    renderRadioExemptionTable(applyExemptionReportFilter(allExemptionData));
}

// 면제기한은 면제승인일로부터 2년이다. 시트에 기한이 비어 있으면 승인일로 계산한다.
const EXEMPTION_VALID_YEARS = 2;

function exemptionDueDate(item) {
    const raw = String((item && item.expiry) || '').trim();
    if (raw) {
        const d = new Date(raw.replace(/\./g, '-'));
        if (!isNaN(d.getTime())) return d;
    }
    const approved = String((item && item.approval_date) || '').trim();
    if (!approved) return null;
    const a = new Date(approved.replace(/\./g, '-'));
    if (isNaN(a.getTime())) return null;
    a.setFullYear(a.getFullYear() + EXEMPTION_VALID_YEARS);
    return a;
}

function toISODate(d) {
    if (!d) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 남은 기간에 따른 강조 — 7일 이내(또는 경과) 빨강, 30일 이내 주황
function exemptionExpiryState(due) {
    if (!due) return '';
    const days = Math.ceil((due - new Date()) / 86400000);
    if (days <= 7) return 'expired';
    if (days <= 30) return 'soon';
    return '';
}

function renderRadioExemptionTable(records) {
    const tbody = document.getElementById('radioExemptionTableBody');
    if (!tbody) return;

    if (!records.length) {
        if (typeof clearTablePager === 'function') clearTablePager('radio_exemption');
        tbody.innerHTML = '<tr><td colspan="11" class="empty-state">' +
            '<i class="fas fa-inbox"></i><p>표시할 면제 내역이 없습니다.</p></td></tr>';
        return;
    }

    // onclick 안의 작은따옴표 문자열에도 값이 들어가므로 ' 와 ` 까지 막는다.
    // 시트 값은 담당자·CSV 업로드로 들어오는 신뢰할 수 없는 입력이다.
    const esc = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;');

    renderPagedRows('radio_exemption', tbody, records, item => {
        const done = String(item.report_done || '').trim().toUpperCase();
        const badge = done === 'O'
            ? '<span class="report-badge done">O</span>'
            : (done === 'X'
                ? '<span class="report-badge todo">X</span>'
                : '<span class="report-badge none">미기재</span>');

        const due = exemptionDueDate(item);
        const dueText = String(item.expiry || '').trim() || toISODate(due);
        const derived = !String(item.expiry || '').trim() && due ? ' <span class="derived">(승인일+2년)</span>' : '';
        const state = exemptionExpiryState(due);
        const expiryCell = dueText
            ? (state ? `<span class="expiry ${state}">${esc(dueText)}</span>${derived}`
                     : `${esc(dueText)}${derived}`)
            : '-';

        const amount = item.amount
            ? `${Number(item.amount).toLocaleString()} ${esc(item.currency || '')}`
            : '-';

        return `
            <td class="mono">${esc(item.approval_no)}</td>
            <td>${esc(item.consignee)}</td>
            <td title="${esc(item.product_name)}">${esc(String(item.product_name || '').slice(0, 40))}</td>
            <td class="mono">${esc(item.spec_no || item.model_spec)}</td>
            <td>${esc(item.quantity)} ${esc(item.unit || '')}</td>
            <td>${amount}</td>
            <td>${esc(item.approval_date || '-')}</td>
            <td>${expiryCell}</td>
            <td>${badge}</td>
            <td class="mono">${esc(item.decl_no || '-')}</td>
            <td>
                <button class="btn-icon" title="이행보고 O/X 전환"
                        onclick="toggleExemptionReport('${esc(item.id)}')">
                    <i class="fas fa-toggle-on"></i>
                </button>
                ${typeof isMasterUser === 'function' && isMasterUser()
                    ? `<button class="btn-icon" title="수정" onclick="editRecord('radio_exemption', '${esc(item.id)}')"><i class="fas fa-edit"></i></button>`
                    : ''}
            </td>
        `;
    });
}

// 이행보고 여부를 O → X → 미기재 순으로 돌린다
async function toggleExemptionReport(id) {
    const item = allExemptionData.find(r => String(r.id) === String(id));
    if (!item) return;

    const cur = String(item.report_done || '').trim().toUpperCase();
    const next = cur === 'O' ? 'X' : (cur === 'X' ? '' : 'O');

    try {
        const response = await fetch(`tables/radio_exemption/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_done: next })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        item.report_done = next;
        renderRadioExemptionTable(applyExemptionReportFilter(allExemptionData));
    } catch (error) {
        console.error('이행보고 상태 변경 오류:', error);
        alert('이행보고 상태를 저장하지 못했습니다.');
    }
}

    // 화면(onclick)과 app.js 에서 호출하는 진입점만 노출한다
    window.loadRadioExemptionData = loadRadioExemptionData;
    window.filterExemptionByReport = filterExemptionByReport;
    window.toggleExemptionReport = toggleExemptionReport;

    console.log('✅ 전파 면제 관리 모듈 로드');
})();
