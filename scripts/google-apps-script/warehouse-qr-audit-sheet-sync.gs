// Install in the same bound project as DB.gs and Masma Works.gs so all three writers share one lock.
function writeAtelierQrAuditSheet(sheet, entry) {
  const first = 3;
  const limit = ATELIER_WAREHOUSE_SNAPSHOT_LAST_ROW;
  const height = sheet.getMaxRows() - first + 1;
  const manage = [2, 3, 4, 5, 6, 7, 8, 19, 27];
  const norm = value => String(value ?? '').trim();
  const placeOf = value => norm(value).replace(/\/\/$/, '').trim().toUpperCase();
  const qrOf = value => norm(value).toUpperCase();
  const countOf = value => /^-?[\d,]+$/.test(norm(value)) ? norm(value).replace(/,/g, '') : norm(value);
  const expectedPlace = placeOf(entry.place);
  const idMap = rows => new Map(rows.map(row => [row.id, row]));
  const before = idMap(entry.before);
  const after = idMap(entry.after);
  const desiredQrs = new Set(entry.after.map(row => qrOf(row.qr)));
  if (before.size !== entry.before.length || after.size !== entry.after.length ||
      desiredQrs.size !== entry.after.length || desiredQrs.has('')) throw new Error('DUPLICATE_PLAN');

  function read() {
    const display = sheet.getRange(first, 1, height, 27).getDisplayValues();
    const relevant = new Map();
    display.forEach((cells, index) => {
      const row = { sheetRow: first + index, id: norm(cells[26]),
        qr: norm(cells[18]), values: cells.slice(1, 8).map(norm) };
      const atPlace = expectedPlace && placeOf(row.values[2]) === expectedPlace;
      if (!atPlace && !before.has(row.id) && !after.has(row.id)) {
        if (desiredQrs.has(qrOf(row.qr))) throw new Error('QR_AT_ANOTHER_ROW');
        return;
      }
      if (!row.id || relevant.has(row.id)) throw new Error('AA_MISSING_OR_DUPLICATE');
      if (row.sheetRow > limit) throw new Error('OUTSIDE_SNAPSHOT_RANGE');
      relevant.set(row.id, row);
    });
    return { display, relevant };
  }

  function matches(actual, expected, includeNote) {
    if (!actual || ((includeNote || actual.qr) && qrOf(actual.qr) !== qrOf(expected.qr))) return false;
    return expected.values.every((value, index) => {
      if (!includeNote && index === 6) return true;
      return index === 4 || index === 5
        ? countOf(actual.values[index]) === countOf(value) : norm(actual.values[index]) === norm(value);
    });
  }

  function verified(relevant) {
    if (relevant.size !== after.size || [...after].some(([id, row]) => !matches(relevant.get(id), row, true))) return null;
    return [...relevant.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(row => ({ id: row.id, qr: row.qr.toUpperCase(),
        values: row.values.map((value, index) => index === 4 || index === 5 ? countOf(value) : value) }));
  }

  const { display, relevant } = read();
  const alreadyWritten = verified(relevant);
  if (alreadyWritten) return alreadyWritten;

  if (relevant.size !== before.size || [...before].some(([id, row]) => !matches(relevant.get(id), row, false))) {
    throw new Error('SHEET_STOCK_CHANGED');
  }
  const fresh = entry.after.filter(row => !relevant.has(row.id));
  const empty = fresh.length ? findWarehousePlacementEmptyRows(sheet, first, display.slice(0, limit - first + 1), fresh.length) : [];
  if (empty.length !== fresh.length) throw new Error('NO_EMPTY_ROW');

  const requests = [];
  const cell = (row, col, fields, value) =>
    requests.push(warehousePlacementCell(sheet.getSheetId(), row, col, fields, value));

  function ensureWritable(row) {
    const formulas = sheet.getRange(row, 1, 1, 27).getFormulas()[0];
    if (manage.some(col => formulas[col - 1])) throw new Error('FORMULA_CELL');
  }

  for (const [id, row] of relevant) {
    if (after.has(id)) continue;
    ensureWritable(row.sheetRow);
    const hasWpsSnapshot = sheet.getRange(row.sheetRow, 28, 1, 7).getDisplayValues()[0].some(norm);
    for (const col of manage) {
      if (col === 27) cell(row.sheetRow, col, 'userEnteredValue,note', hasWpsSnapshot ? { note: PLACEMENT_REMOVED_NOTE + id } : {});
      else cell(row.sheetRow, col, 'userEnteredValue', {});
    }
  }

  for (const row of entry.after) {
    const target = relevant.get(row.id)?.sheetRow ?? empty.shift();
    ensureWritable(target);
    const values = [...row.values, row.qr, row.id];
    for (let i = 0; i < manage.length; i++) {
      const value = norm(values[i]);
      const numeric = (i === 4 || i === 5) && /^\d+$/.test(value);
      cell(target, manage[i], 'userEnteredValue', value ? { userEnteredValue: numeric
        ? { numberValue: Number(value) } : { stringValue: value } } : {});
    }
  }

  warehousePlacementSheetApi(sheet, ':batchUpdate', 'post', { requests });
  SpreadsheetApp.flush();
  const result = verified(read().relevant);
  if (!result) throw new Error('SHEET_VALUES_UNVERIFIED');
  return result;
}

function syncAtelierWarehouseQrAuditSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { synced: 0, pending: true };
  try {
    const { entries } = _atelierStockConditionCall('list-qr-audit-exports');
    if (!entries.length) return { synced: 0, pending: false };
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty('ATELIER_STOCK_CONDITION_SPREADSHEET_ID');
    const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActive();
    const sheet = spreadsheet?.getSheetByName('창고입력');
    if (!sheet) throw new Error('창고입력 시트를 찾지 못했습니다.');
    let synced = 0;
    for (const entry of entries) {
      try {
        const rows = writeAtelierQrAuditSheet(sheet, entry);
        _atelierStockConditionCall('confirm-qr-audit-export', { id: entry.id, rows });
        synced++;
      } catch (error) {
        console.warn('QR 실사 시트 반영 대기: ' + entry.id + ' ' + error.message);
      }
    }
    return { synced, pending: synced < entries.length };
  } finally {
    lock.releaseLock();
  }
}

function installAtelierWarehouseQrAuditSheet() {
  const handler = 'syncAtelierWarehouseQrAuditSheet';
  const spreadsheet = SpreadsheetApp.getActive();
  if (!spreadsheet?.getSheetByName('창고입력')) throw new Error('창고입력 시트를 찾지 못했습니다.');
  PropertiesService.getScriptProperties().setProperty('ATELIER_STOCK_CONDITION_SPREADSHEET_ID', spreadsheet.getId());
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === handler)) {
    ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  }
}
