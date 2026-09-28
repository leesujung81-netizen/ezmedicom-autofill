// ==UserScript==
// @name         이지메디컴 결재상신 - 견적비교 자동입력
// @namespace    ezmedicom-autofill
// @version      1.1
// @description  결재상신 상세 화면에서 수의시담 견적 데이터를 조회하여 품의내용(견적비교)에 자동으로 채워줍니다.
// @author       leesujung
// @match        *://b2b.mdvan.net/*
// @run-at       document-idle
// @grant        GM_info
// @downloadURL  https://raw.githubusercontent.com/leesujung81-netizen/ezmedicom-autofill/main/ezmedicom-autofill.user.js
// @updateURL    https://raw.githubusercontent.com/leesujung81-netizen/ezmedicom-autofill/main/ezmedicom-autofill.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 품의내용 필드: 신버전(contenteditable div #reqRemark2) 또는 구버전(textarea #reqRemark) 둘 다 지원
  function getRemarkTarget() {
    const div = document.getElementById('reqRemark2');
    if (div) return { type: 'html', el: div };
    const ta = document.getElementById('reqRemark');
    if (ta && ta.tagName === 'TEXTAREA') return { type: 'text', el: ta };
    return null;
  }

  function init() {
    const target = getRemarkTarget();
    const rfqIds = extractRfqDocIds();
    if (!window.__ezAutofillLogged) {
      window.__ezAutofillLogged = true;
      console.log('[ezmedicom-autofill] reqRemark2 found:', !!document.getElementById('reqRemark2'));
      console.log('[ezmedicom-autofill] reqRemark(textarea) found:', document.getElementById('reqRemark') ? document.getElementById('reqRemark').tagName : null);
      console.log('[ezmedicom-autofill] rfqDocIds found:', rfqIds);
      console.log('[ezmedicom-autofill] target:', target);
    }
    if (!target) return;
    if (rfqIds.length === 0) return; // 수의시담 데이터가 있는 화면에서만 표시
    if (document.getElementById('btn_autoFillQuote')) return; // 중복 삽입 방지

    const btn = document.createElement('button');
    btn.id = 'btn_autoFillQuote';
    btn.type = 'button';
    btn.textContent = '견적비교 자동입력';
    btn.style.cssText = 'margin:4px 0;padding:4px 10px;font-weight:bold;color:#fff;background:#1a6ba8;border:1px solid #145887;border-radius:3px;cursor:pointer;';
    btn.addEventListener('click', onAutoFillClick);

    // 품의내용 필드 바로 위에 버튼 삽입
    target.el.parentElement.insertBefore(btn, target.el);
  }

  function extractRfqDocIds() {
    const links = document.querySelectorAll('a[href*="Rfq_OnClick"]');
    const ids = new Set();
    links.forEach((a) => {
      const m = a.getAttribute('href').match(/Rfq_OnClick\('([^']+)'\)/);
      if (m) ids.add(m[1]);
    });
    return Array.from(ids);
  }

  function formatWon(numStr) {
    const n = parseInt(numStr, 10) || 0;
    return '￦ ' + n.toLocaleString('ko-KR'); // ￦ 12,345
  }

  async function fetchQuotes(rfqDocId) {
    const params = new URLSearchParams({ rfqDocId, searchRfqGb: 'E' });
    const res = await fetch('/ezstart.ws?PID=rfq0307AIB', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: params.toString(),
    });
    if (!res.ok) throw new Error('견적 조회 실패 (HTTP ' + res.status + ')');
    const json = await res.json();
    return json.Data || [];
  }

  function buildQuoteHtml(quotes) {
    const sorted = quotes.slice().sort((a, b) => parseInt(a.quCost, 10) - parseInt(b.quCost, 10));
    let html = '<div>1) 견적비교</div>';
    sorted.forEach((q) => {
      html += '<div>&nbsp; &nbsp; - ' + escapeHtml(q.supplierName) + ' : ' + formatWon(q.quCost) + '</div>';
    });
    return html;
  }

  function buildQuoteText(quotes) {
    const sorted = quotes.slice().sort((a, b) => parseInt(a.quCost, 10) - parseInt(b.quCost, 10));
    let lines = ['1) 견적비교'];
    sorted.forEach((q) => {
      lines.push('    - ' + q.supplierName + ' : ' + formatWon(q.quCost));
    });
    return lines.join('\n');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  const ITEM9_MARKER = '가격조사기준';

  // "9. 가격조사기준 ..." 줄(해당 줄을 감싸는 </div> 또는 다음 <br> 직후) 바로 뒤에 삽입
  function insertAfterItem9Html(html, insertion) {
    const idx = html.indexOf(ITEM9_MARKER);
    if (idx === -1) return null;
    const rest = html.slice(idx);
    const divEnd = rest.indexOf('</div>');
    const brMatch = /<br\s*\/?>/i.exec(rest);
    const brEnd = brMatch ? brMatch.index + brMatch[0].length : -1;
    let cut;
    if (divEnd === -1 && brEnd === -1) cut = html.length;
    else if (divEnd === -1) cut = idx + brEnd;
    else if (brEnd === -1) cut = idx + divEnd + '</div>'.length;
    else cut = idx + Math.min(divEnd + '</div>'.length, brEnd);
    return html.slice(0, cut) + insertion + html.slice(cut);
  }

  function insertAfterItem9Text(text, insertion) {
    const lines = text.split('\n');
    const idx = lines.findIndex((l) => l.indexOf(ITEM9_MARKER) !== -1);
    if (idx === -1) return null;
    lines.splice(idx + 1, 0, insertion);
    return lines.join('\n');
  }

  async function onAutoFillClick() {
    const rfqDocIds = extractRfqDocIds();
    if (rfqDocIds.length === 0) {
      alert('수의시담 견적요청번호를 찾을 수 없습니다.');
      return;
    }

    const target = getRemarkTarget();
    if (!target) {
      alert('품의내용 입력 영역을 찾을 수 없습니다.');
      return;
    }

    const currentText = target.type === 'html' ? target.el.innerHTML : target.el.value;
    if (currentText.indexOf('견적비교') !== -1) {
      if (!confirm('이미 "견적비교" 항목이 있습니다. 새로 추가하시겠습니까?')) return;
    }

    try {
      let allQuotes = [];
      for (const id of rfqDocIds) {
        const quotes = await fetchQuotes(id);
        allQuotes = allQuotes.concat(quotes);
      }
      if (allQuotes.length === 0) {
        alert('조회된 견적 데이터가 없습니다.');
        return;
      }

      if (target.type === 'html') {
        const updated = insertAfterItem9Html(target.el.innerHTML, buildQuoteHtml(allQuotes));
        if (updated === null) {
          alert('"9. 가격조사기준" 항목을 먼저 작성해주세요. 그 아래에 견적비교 내용이 들어갑니다.');
          return;
        }
        target.el.innerHTML = updated;
        // 화면 저장 로직이 참조하는 숨은 필드도 함께 동기화
        const hidden = document.getElementById('reqRemark');
        if (hidden && hidden.tagName !== 'TEXTAREA') hidden.value = target.el.innerHTML;
      } else {
        const updated = insertAfterItem9Text(target.el.value, buildQuoteText(allQuotes));
        if (updated === null) {
          alert('"9. 가격조사기준" 항목을 먼저 작성해주세요. 그 아래에 견적비교 내용이 들어갑니다.');
          return;
        }
        target.el.value = updated;
      }
    } catch (e) {
      alert('견적비교 자동입력 중 오류가 발생했습니다: ' + e.message);
    }
  }

  init();
  // 화면이 iframe 재로딩/탭 전환 등으로 늦게 그려지는 경우 대비
  const observer = new MutationObserver(init);
  observer.observe(document.body, { childList: true, subtree: true });
})();
