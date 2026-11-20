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
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const qrRows = sheet.getRange(3, 19, sheet.getMaxRows() - 2, 1)
      .createTextFinder(boxQr).matchEntireCell(true).matchCase(false).findAll();
    if (qrRows.length) {
      const row = qrRows[0].getRow();
      const same = sheet.getRange(row, 2, 1, 7).getValues()[0].every((v, i) => String(v) === String(rowValues[i]));
      if (qrRows.length !== 1 || !same || !sheet.getRange(row, 27).getValue()) {
        throw new Error('이미 등록된 박스 QR의 재고를 확인해 주세요.');
      }
      return { row, aaStatus: 'preserved' };
    }
    const [row] = _atelierFindVacantStockRows(sheet, 1);
    if (!row) throw new Error('3행부터 입력할 수 있는 빈 행을 찾지 못했습니다.');
    const aa = 'inb_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    if (sheet.getRange(3, 27, sheet.getMaxRows() - 2, 1).createTextFinder(aa)
      .matchEntireCell(true).matchCase(true).findAll().length) throw new Error('AA 발급 충돌로 다시 저장해야 합니다.');
    const sheetId = sheet.getSheetId();
    const columns = [2, 3, 4, 5, 6, 7, 8, 19, 27];
    const requests = [...rowValues, boxQr, aa].map((value, i) =>
      warehousePlacementCell(sheetId, row, columns[i], 'userEnteredValue', {
        userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value },
      }));
    _atelierCheckVacantStockRows(sheet, [row]);
    warehousePlacementSheetApi(sheet, ':batchUpdate', 'post', { requests });
    return { row, aaStatus: 'issued' };
  } finally {
    lock.releaseLock();
  }
}
