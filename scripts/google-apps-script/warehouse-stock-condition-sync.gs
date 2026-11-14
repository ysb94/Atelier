// Apps Script DB.gs companion. The project shares its script lock with Finder.
function _atelierStockConditionCall(action, confirmed) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('ATELIER_WAREHOUSE_SYNC_URL');
  const secret = props.getProperty('ATELIER_WAREHOUSE_SYNC_SECRET');
  if (!url || !secret) throw new Error('아틀리에 창고 동기화 설정을 확인해주세요.');
  const payload = JSON.stringify({ action, brandSlug: 'masmarulez', confirmed });
  const timestamp = String(Date.now());
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload,
    muteHttpExceptions: true,
    headers: {
      'x-atelier-timestamp': timestamp,
      'x-atelier-signature': _atelierHmacHex(secret, timestamp + '.' + payload),
    },
  });
  const result = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200 || !result.ok) {
    throw new Error(result.error || '아틀리에 상태 반영 요청에 실패했습니다.');
  }
  return result;
}

function _writeAtelierStockCondition(sheet, entry) {
  const first = 3;
  const limit = ATELIER_WAREHOUSE_SNAPSHOT_LAST_ROW;
  const last = Math.min(Math.max(first, sheet.getLastRow()), sheet.getMaxRows());
  const ids = sheet.getRange(first, 27, last - first + 1, 1)
    .createTextFinder(entry.rowId).matchEntireCell(true).matchCase(true).findAll();
  if (ids.length > 1) throw new Error('AA_DUPLICATE');
  let row = ids[0]?.getRow();
  const values = entry.values;
  const norm = (value) => String(value ?? '').trim();
  const samePair = (cells, expected) =>
    norm(cells[0]) === expected.number && norm(cells[1]) === expected.productName;
  const literal = (value) => /^[=']/.test(String(value ?? '')) ? "'" + value : value;
  if (row && row > limit) throw new Error('OUTSIDE_SNAPSHOT_RANGE');

  if (entry.before) {
    if (!row) throw new Error('AA_NOT_FOUND');
    const current = sheet.getRange(row, 2, 1, 18).getDisplayValues()[0];
    const place = (value) => norm(value).replace(/\/\/$/, '').trim();
    if (place(current[2]) !== place(entry.before.place) ||
        (norm(current[17]) && norm(current[17]) !== entry.before.boxQr)) throw new Error('ROW_CHANGED');
    if (!samePair(current, values)) {
      const pair = sheet.getRange(row, 2, 1, 2);
      if (!samePair(current, entry.before) || pair.getFormulas()[0].some(Boolean)) {
        throw new Error('B_C_CHANGED');
      }
      pair.setValues([[literal(values.number), literal(values.productName)]]);
      SpreadsheetApp.flush();
    }
  } else {
    if (!row) {
      // Append after the last warehouse input, including rows carrying an AA alone.
      row = Math.max(first, _atelierWarehouseLastInputRow(sheet) + 1);
      if (row > limit) throw new Error('OUTSIDE_SNAPSHOT_RANGE');
      if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows());
      const range = sheet.getRange(row, 2, 1, 26);
      const writes = [0, 1, 2, 3, 4, 5, 6, 25];
      const display = range.getDisplayValues()[0];
      const formulas = range.getFormulas()[0];
      if (writes.some((i) => norm(display[i]) || formulas[i]) ||
          sheet.getRange(row, 27).getNote()) throw new Error('ROW_OCCUPIED');
      // Claim AA before writing any row data so a retry uses this same row.
      sheet.getRange(row, 27).setValue(entry.rowId);
      SpreadsheetApp.flush();
    }
    const range = sheet.getRange(row, 2, 1, 7);
    const cells = range.getDisplayValues()[0];
    const expected = [values.number, values.productName, values.place, values.receivedOn,
      values.units, values.boxes, values.note];
    if (cells.every((value) => !norm(value)) && range.getFormulas()[0].every((value) => !value)) {
      range.setValues([[literal(expected[0]), literal(expected[1]), literal(expected[2]),
        "'" + expected[3], Number(expected[4]), Number(expected[5]), literal(expected[6])]]);
      SpreadsheetApp.flush();
    }
    const observed = range.getDisplayValues()[0];
    if (!observed.every((value, i) => (i === 4 || i === 5)
      ? norm(value) !== '' && Number(String(value).replace(/,/g, '')) === Number(expected[i])
      : norm(value) === norm(expected[i]))) throw new Error('NEW_ROW_CHANGED');
  }

  const observed = sheet.getRange(row, 2, 1, 26).getDisplayValues()[0];
  if (norm(observed[25]) !== entry.rowId || !samePair(observed, values)) throw new Error('UNVERIFIED');
  return { request_id: entry.requestId, row_id: norm(observed[25]), number: norm(observed[0]), product_name: norm(observed[1]) };
}

function syncAtelierStockConditions() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { confirmed: 0, pending: true };
  try {
    const { entries } = _atelierStockConditionCall('list-stock-conditions');
    if (!entries.length) return { confirmed: 0, pending: false };
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty('ATELIER_STOCK_CONDITION_SPREADSHEET_ID');
    const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActive();
    const sheet = spreadsheet?.getSheetByName('창고입력');
    if (!sheet) throw new Error('창고입력 시트를 찾지 못했습니다.');
    const confirmations = [];
    for (const entry of entries) {
      try {
        confirmations.push(_writeAtelierStockCondition(sheet, entry));
      } catch (error) {
        console.warn('창고 재고 상태 반영 대기: ' + entry.rowId + ' ' + error.message);
      }
    }
    const result = confirmations.length
      ? _atelierStockConditionCall('confirm-stock-conditions', confirmations) : { confirmed: 0 };
    return { confirmed: result.confirmed, pending: result.confirmed < entries.length };
  } finally {
    lock.releaseLock();
  }
}

function installAtelierStockConditionSync() {
  const handler = 'syncAtelierStockConditions';
  const spreadsheet = SpreadsheetApp.getActive();
  if (!spreadsheet?.getSheetByName('창고입력')) throw new Error('창고입력 시트를 찾지 못했습니다.');
  PropertiesService.getScriptProperties().setProperty('ATELIER_STOCK_CONDITION_SPREADSHEET_ID', spreadsheet.getId());
  if (!ScriptApp.getProjectTriggers().some((trigger) => trigger.getHandlerFunction() === handler)) {
    ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  }
}
