// 목록 페이지네이션
//
// 시트가 커지면서(MSDS 12,000행, 화관법 6,000행) 전체를 한 번에 DOM 으로 그리면
// 화면이 수 초간 멈춘다. 데이터는 그대로 받되 화면에는 한 페이지분만 그린다.
//
// 이 파일의 함수는 IIFE 안에 가둔다. 전역 이름이 다른 모듈과 겹치면
// 엉뚱한 화면이 깨진다(과거 formatDate 충돌 사례).

(function () {
    const PAGE_SIZE = 20;

    // section -> { records, buildRow, tbody, page }
    const state = {};

    function totalPages(section) {
        const st = state[section];
        if (!st || !st.records.length) return 1;
        return Math.ceil(st.records.length / PAGE_SIZE);
    }

    // 표 바로 아래에 페이지 조작줄을 두되, 없으면 만든다
    function pagerElement(section, tbody) {
        const id = `${section}Pager`;
        let el = document.getElementById(id);
        if (el) return el;

        const table = tbody.closest('table');
        const host = (table && table.parentElement) || tbody.parentElement;
        if (!host) return null;

        el = document.createElement('div');
        el.id = id;
        el.className = 'table-pager';
        host.insertAdjacentElement('afterend', el);
        return el;
    }

    function pageWindow(page, last) {
        // 현재 페이지 주변만 보여 준다 (양옆 2개)
        const from = Math.max(1, Math.min(page - 2, last - 4));
        const to = Math.min(last, Math.max(page + 2, 5));
        const out = [];
        for (let i = Math.max(1, from); i <= to; i += 1) out.push(i);
        return out;
    }

    function drawPager(section) {
        const st = state[section];
        if (!st) return;
        const el = pagerElement(section, st.tbody);
        if (!el) return;

        const last = totalPages(section);
        const total = st.records.length;

        if (total <= PAGE_SIZE) {
            el.innerHTML = total
                ? `<span class="pager-info">전체 ${total.toLocaleString()}건</span>`
                : '';
            return;
        }

        const from = (st.page - 1) * PAGE_SIZE + 1;
        const to = Math.min(st.page * PAGE_SIZE, total);
        const btn = (label, target, opts = {}) => {
            const cls = ['pager-btn'];
            if (opts.active) cls.push('active');
            const dis = opts.disabled ? ' disabled' : '';
            return `<button class="${cls.join(' ')}"${dis} onclick="goToTablePage('${section}', ${target})">${label}</button>`;
        };

        // 체크박스가 있는 화면은 '전체 선택'이 현재 페이지 20건만 고른다.
        // 500건을 지우려다 20건만 지우는 일이 없도록 표에 그 사실을 적는다.
        const hasCheckbox = !!st.tbody.querySelector('.row-checkbox');
        const scopeNote = hasCheckbox
            ? ' <span class="pager-warn">· 전체 선택은 현재 페이지만</span>' : '';

        el.innerHTML =
            `<span class="pager-info">전체 ${total.toLocaleString()}건 중 ${from.toLocaleString()}–${to.toLocaleString()}${scopeNote}</span>` +
            '<span class="pager-buttons">' +
            btn('«', 1, { disabled: st.page === 1 }) +
            btn('‹', st.page - 1, { disabled: st.page === 1 }) +
            pageWindow(st.page, last).map(p => btn(p, p, { active: p === st.page })).join('') +
            btn('›', st.page + 1, { disabled: st.page === last }) +
            btn('»', last, { disabled: st.page === last }) +
            '</span>';
    }

    function drawRows(section) {
        const st = state[section];
        if (!st) return;
        const start = (st.page - 1) * PAGE_SIZE;
        const slice = st.records.slice(start, start + PAGE_SIZE);

        // 조각으로 모아 한 번에 붙인다 (행마다 appendChild 하면 리플로가 반복된다)
        const frag = document.createDocumentFragment();
        slice.forEach(record => {
            const row = document.createElement('tr');
            row.innerHTML = st.buildRow(record);
            frag.appendChild(row);
        });
        st.tbody.innerHTML = '';
        st.tbody.appendChild(frag);
    }

    // 같은 목록인지 판별하는 지문. 건수만 보면 필터를 바꿨는데 결과 수가 우연히
    // 같을 때 이전 페이지 번호를 물려받아, 사용자가 1페이지를 못 보고 중간부터 본다.
    // 첫·끝 레코드의 id 까지 섞어 데이터셋이 바뀌면 1페이지로 돌아가게 한다.
    function signatureOf(records) {
        const list = records || [];
        if (!list.length) return '0';
        const idOf = (r) => String((r && (r.id ?? r.spec_no)) ?? '');
        return `${list.length}|${idOf(list[0])}|${idOf(list[list.length - 1])}`;
    }

    // 목록 렌더링 진입점. buildRow 는 record 를 받아 <td>...</td> 문자열을 돌려준다.
    function renderPagedRows(section, tbody, records, buildRow) {
        if (!tbody) return;
        const prev = state[section];
        const sig = signatureOf(records);
        const keepPage = prev && prev.signature === sig ? prev.page : 1;
        state[section] = {
            records: records || [],
            buildRow,
            tbody,
            page: keepPage,
            signature: sig
        };
        const last = totalPages(section);
        if (state[section].page > last) state[section].page = last;
        drawRows(section);
        drawPager(section);
    }

    function goToTablePage(section, page) {
        const st = state[section];
        if (!st) return;
        const last = totalPages(section);
        const target = Math.min(Math.max(1, page), last);
        if (target === st.page) return;
        st.page = target;
        drawRows(section);
        drawPager(section);
        // 페이지를 넘기면 tbody 가 새로 그려져 체크가 전부 풀린다.
        // 선택 개수 배지와 '선택 삭제' 버튼도 같이 되돌려야 옛 값이 남지 않는다.
        if (typeof updateSelectionCount === 'function') {
            try { updateSelectionCount(section); } catch (e) { /* 체크박스 없는 화면 */ }
        }
        const table = st.tbody.closest('table');
        if (table) table.scrollIntoView({ block: 'nearest' });
    }

    function clearPager(section) {
        const el = document.getElementById(`${section}Pager`);
        if (el) el.innerHTML = '';
        delete state[section];
    }

    window.renderPagedRows = renderPagedRows;
    window.goToTablePage = goToTablePage;
    window.clearTablePager = clearPager;

    console.log('✅ 목록 페이지네이션 모듈 로드 (페이지당 ' + PAGE_SIZE + '건)');
})();
