function openAtelierWarehouseTestForm() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font: 14px system-ui, sans-serif; padding: 12px; color: #202124; }
      label { display: block; margin-bottom: 12px; }
      input { display: block; box-sizing: border-box; width: 100%; padding: 7px; margin-top: 4px; }
      button { padding: 8px 12px; }
      [role=status] { overflow-wrap: anywhere; }
    </style>
    <form id="entry">
      <label>상품번호 (B)<input name="styleNo" required></label>
      <label>상품명 (C)<input name="productName" required></label>
      <label>자리번호 (D)<input name="location" required></label>
      <label>입고일 (E)<input name="receivedOn" type="date" required></label>
      <label>박스당 수량 (F)<input name="unitsPerBox" type="number" min="1" step="1" required></label>
      <label>남은 박스 수 (G)<input name="boxes" type="number" min="0" step="1" required></label>
      <label>메모 (H)<input name="note"></label>
      <label>박스 QR 고유번호 (S)<input name="boxQr" required></label>
      <button type="submit">테스트 한 건 저장</button>
      <p id="result" role="status"></p>
    </form>
    <script>
      const form = document.getElementById('entry');
      const result = document.getElementById('result');
      form.addEventListener('submit', event => {
        event.preventDefault();
        const button = form.querySelector('button');
        button.disabled = true;
        result.textContent = '저장 중…';
        google.script.run
          .withSuccessHandler(saved => {
            result.textContent = '창고입력 ' + saved.row + '행에 저장했습니다.' +
              (saved.issued ? ' AA 발급 완료.' : ' AA 발급을 확인해 주세요.');
          })
          .withFailureHandler(error => {
            result.textContent = error.message;
            button.disabled = false;
          })
          .saveAtelierWarehouseTestRow(Object.fromEntries(new FormData(form)));
      });
    </script>
  `).setTitle('창고 테스트 입력');
  SpreadsheetApp.getUi().showSidebar(html);
}

function saveAtelierWarehouseTestRow(input) {
  function field(key, required = true) {
    const value = String(input[key] ?? '').trim();
    if ((required && !value) || value.startsWith('=')) {
      throw new Error('필수 항목을 입력하고, =로 시작하는 값은 제외해 주세요.');
    }
    return value;
  }

  const receivedOn = field('receivedOn');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) throw new Error('입고일을 확인해 주세요.');
  const unitsPerBox = Number(field('unitsPerBox'));
  const boxes = Number(field('boxes'));
  if (!Number.isSafeInteger(unitsPerBox) || unitsPerBox < 1 || !Number.isSafeInteger(boxes) || boxes < 0) {
    throw new Error('수량과 박스 수는 정수로 입력해 주세요.');
  }
  const rowValues = [
    field('styleNo'), field('productName'), field('location'), receivedOn,
    unitsPerBox, boxes, field('note', false),
  ];
  const boxQr = field('boxQr');
  const sheet = SpreadsheetApp.getActive().getSheetByName('창고입력');
  if (!sheet || sheet.getMaxColumns() < 27 || sheet.getMaxRows() < 3) {
    throw new Error('창고입력 탭과 AA열을 확인해 주세요.');
  }
  if (typeof onEdit_AssignDocId_v2 !== 'function') throw new Error('기존 AA 발급 함수가 필요합니다.');

  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    const width = sheet.getMaxColumns();
    const lastRow = Math.min(sheet.getMaxRows(), Math.max(3, sheet.getLastRow() + 1));
    const candidates = sheet.getRange(3, 1, lastRow - 2, width);
    const formulas = candidates.getFormulas();
    const index = candidates.getValues().findIndex((values, i) =>
      values.every((value, col) => value === '' && formulas[i][col] === ''),
    );
    if (index < 0) throw new Error('3행부터 완전히 비어 있는 행을 찾지 못했습니다.');
    const row = index + 3;
    const target = sheet.getRange(row, 1, 1, width);
    if (!target.isBlank()) throw new Error('다른 작업이 해당 행을 사용 중입니다. 다시 저장해 주세요.');

    const dataRange = sheet.getRange(row, 2, 1, 7);
    const qrCell = sheet.getRange(row, 19);
    dataRange.setValues([rowValues]);
    qrCell.setValue(boxQr);
    onEdit_AssignDocId_v2({ range: sheet.getRange(row, 2) });
    SpreadsheetApp.flush();
    return { row, issued: Boolean(sheet.getRange(row, 27).getValue()) };
  } finally {
    lock.releaseLock();
  }
}
