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
  const sheet = SpreadsheetApp.openById('1N4LsM3tf5-L-C5eOQxhrloOG46V3dEj-qOZylDs7Fqk').getSheetByName('창고입력');
  if (!sheet || sheet.getMaxColumns() < 27 || sheet.getMaxRows() < 3) {
    throw new Error('창고입력 탭과 AA열을 확인해 주세요.');
  }
  if (typeof onEdit_AssignDocId_v2 !== 'function') throw new Error('기존 AA 발급 함수가 필요합니다.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const width = sheet.getMaxColumns();
    const lastRow = Math.min(sheet.getMaxRows(), Math.max(3, sheet.getLastRow() + 1));
    const candidates = sheet.getRange(3, 1, lastRow - 2, width);
    const formulas = candidates.getFormulas();
    const ignoredColumns = new Set([1, 9, 25, 26, 27]);
    const isAvailable = (values, rowFormulas) => values.every((value, col) =>
      ignoredColumns.has(col + 1) || (value === '' && rowFormulas[col] === ''),
    );
    const index = candidates.getValues().findIndex((values, i) => isAvailable(values, formulas[i]));
    if (index < 0) throw new Error('3행부터 입력할 수 있는 빈 행을 찾지 못했습니다.');
    const row = index + 3;
    const target = sheet.getRange(row, 1, 1, width);
    if (!isAvailable(target.getValues()[0], target.getFormulas()[0])) {
      throw new Error('다른 작업이 해당 행을 사용 중입니다. 다시 저장해 주세요.');
    }

    const dataRange = sheet.getRange(row, 2, 1, 7);
    const qrCell = sheet.getRange(row, 19);
    const aaCell = sheet.getRange(row, 27);
    const existingId = aaCell.getValue();
    const existingFormula = aaCell.getFormula();
    dataRange.setValues([rowValues]);
    qrCell.setValue(boxQr);
    if (existingId === '' && !existingFormula) onEdit_AssignDocId_v2({ range: sheet.getRange(row, 2) });
    SpreadsheetApp.flush();
    const aaStatus = existingId !== '' || existingFormula ? 'preserved' : aaCell.getValue() ? 'issued' : 'missing';
    return { row, aaStatus };
  } finally {
    lock.releaseLock();
  }
}
