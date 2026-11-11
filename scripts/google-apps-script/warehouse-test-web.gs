// Use an editor-only Apps Script test deployment (/dev).
function doPost(e) {
  if (e?.parameter?.atelierAction !== 'warehouse-test-row') {
    return HtmlService.createHtmlOutput('지원하지 않는 요청입니다.');
  }
  const labels = {
    styleNo: '상품번호', productName: '상품명', location: '자리번호',
    receivedOn: '입고일', unitsPerBox: '박스당 수량', boxes: '남은 박스 수',
    note: '메모', boxQr: '박스 QR 고유번호',
  };
  const input = {};
  for (const name of Object.keys(labels)) {
    const value = String(e.parameter[name] ?? '');
    if (value.length > 500) return HtmlService.createHtmlOutput('입력값이 너무 깁니다.');
    input[name] = value;
  }
  const escape = value => value.replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
  const rows = Object.keys(labels).map(name =>
    '<dt>' + labels[name] + '</dt><dd>' + escape(input[name]) + '</dd>',
  ).join('');
  return HtmlService.createHtmlOutput(`
    <style>
      body { font: 15px system-ui, sans-serif; margin: 2rem auto; padding: 0 1rem; max-width: 32rem; color: #202124; }
      dl { display: grid; grid-template-columns: 9rem 1fr; gap: .6rem; }
      dd { margin: 0; overflow-wrap: anywhere; }
      button { padding: .6rem 1rem; }
    </style>
    <h1>창고입력 저장 확인</h1>
    <dl>${rows}</dl>
    <button id="save" data-input="${escape(JSON.stringify(input))}">구글 시트에 한 건 저장</button>
    <p id="result" role="status"></p>
    <script>
      const button = document.getElementById('save');
      const result = document.getElementById('result');
      button.addEventListener('click', () => {
        button.disabled = true;
        result.textContent = '저장 중…';
        google.script.run.withSuccessHandler(saved => {
          result.textContent = '창고입력 ' + saved.row + '행에 저장했습니다.' +
            (saved.issued ? ' AA 발급 완료.' : ' AA 발급을 확인해 주세요.');
        }).withFailureHandler(error => {
          result.textContent = error.message;
        }).saveAtelierWarehouseTestRow(JSON.parse(button.dataset.input));
      });
    </script>
  `).setTitle('창고입력 저장 확인');
}
