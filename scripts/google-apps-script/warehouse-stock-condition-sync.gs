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

// Include auxiliary cells, WPS snapshots and the Finder move log (AL:AS).
// Only an explicitly identified retry may use its own AA value or AA claim note.
function _atelierVacantStockRowsInRange(sheet, start, height, reservedId = '', reservedNote = '') {
  const width = sheet.getMaxColumns();
  if (width < 27) throw new Error('AA_COLUMN_MISSING');
  const range = sheet.getRange(start, 1, height, width);
  const values = range.getValues();
  const candidates = [];
  for (let i = 0; i < height; i++) {
    if (values[i].every((value, col) => value === (col === 26 ? reservedId : ''))) candidates.push(i);
  }
  if (!candidates.length) return [];
  const formulas = range.getFormulas();
  const notes = range.getNotes();
  return candidates.filter(i => formulas[i].every((formula, col) => !formula || col === 23) &&
    notes[i].every((note, col) => note === (col === 26 ? reservedNote : ''))).map(i => start + i);
}

// The cache is scoped to one script-lock acquisition, and only provides
// candidates. Callers read them again just before writing.
function _atelierFindVacantStockRows(sheet, count, cache = {}) {
  const end = Math.min(sheet.getMaxRows(), ATELIER_WAREHOUSE_SNAPSHOT_LAST_ROW);
  if (!cache.free) { cache.free = []; cache.next = 3; }
  while (cache.free.length < count && cache.next <= end) {
    const height = Math.min(512, end - cache.next + 1);
    cache.free.push(..._atelierVacantStockRowsInRange(sheet, cache.next, height));
    cache.next += height;
  }
  return cache.free.splice(0, count);
}

function _atelierCheckVacantStockRows(sheet, rows) {
  // Rows from the allocator are already ordered. Adjacent writes can share
  // the same values/formulas/notes read even when there are holes in the block.
  for (let i = 0; i < rows.length;) {
    const start = rows[i];
    let end = i + 1;
    while (end < rows.length && rows[end] < start + 512) end++;
    const free = new Set(_atelierVacantStockRowsInRange(sheet, start, rows[end - 1] - start + 1));
    for (; i < end; i++) if (!free.has(rows[i])) throw new Error('ROW_OCCUPIED');
  }
}

function _writeAtelierStockCondition(sheet, entry, vacancyCache) {
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

  if (entry.before && Object.prototype.hasOwnProperty.call(entry.before, 'receivedOn')) {
    if (!row) throw new Error('AA_NOT_FOUND');
    const current = sheet.getRange(row, 2, 1, 18).getDisplayValues()[0];
    const formulas = sheet.getRange(row, 2, 1, 7).getFormulas()[0];
    const fields = ['number', 'productName', 'place', 'receivedOn', 'units', 'boxes', 'note'];
    const equal = (field, a, b) => (field === 'units' || field === 'boxes')
      ? norm(a).replace(/,/g, '') === norm(b).replace(/,/g, '') : norm(a) === norm(b);
    if (norm(current[17]).toUpperCase() !== norm(entry.before.boxQr).toUpperCase() ||
        norm(values.boxQr).toUpperCase() !== norm(entry.before.boxQr).toUpperCase()) throw new Error('QR_CHANGED');
    const opened = Number(entry.before.openedUnits);
    const prefix = opened > 0 ? `개봉 잔량 ${opened}개` : '';
    const hasOpenedPrefix = prefix && (norm(current[6]) === prefix || norm(current[6]).startsWith(prefix + ' · '));
    const note = (value) => hasOpenedPrefix ? [prefix, norm(value)].filter(Boolean).join(' · ') : value;
    const valueFor = (source, field) => field === 'note' ? note(source.note) : source[field];
    const changed = [];
    fields.forEach((field, i) => {
      if (equal(field, current[i], valueFor(values, field))) return;
      if (!equal(field, current[i], valueFor(entry.before, field)) || formulas[i]) throw new Error('ROW_CHANGED');
      changed.push(i);
    });
    for (const i of changed) {
      const field = fields[i];
      const value = norm(valueFor(values, field));
      const numeric = (field === 'units' || field === 'boxes') && value !== '';
      const cell = sheet.getRange(row, i + 2);
      if (field === 'place') cell.setNumberFormat('@');
      cell.setValue(numeric ? Number(value) : field === 'receivedOn' && value ? "'" + value : literal(value));
    }
    if (changed.length) SpreadsheetApp.flush();
    const observed = sheet.getRange(row, 2, 1, 7).getDisplayValues()[0];
    if (!fields.every((field, i) => equal(field, observed[i], valueFor(values, field)))) throw new Error('ROW_VALUES_UNVERIFIED');
  } else if (entry.before) {
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
      [row] = _atelierFindVacantStockRows(sheet, 1, vacancyCache);
      if (!row) {
        const maxRows = sheet.getMaxRows();
        if (maxRows >= limit) throw new Error('OUTSIDE_SNAPSHOT_RANGE');
        row = Math.max(first, maxRows + 1);
        sheet.insertRowsAfter(maxRows, row - maxRows);
        if (vacancyCache) vacancyCache.next = row + 1;
      }
      _atelierCheckVacantStockRows(sheet, [row]);
      // Claim AA before writing any row data so a retry uses this same row.
      sheet.getRange(row, 27).setValue(entry.rowId);
      SpreadsheetApp.flush();
    }
    const range = sheet.getRange(row, 2, 1, 7);
    const cells = range.getDisplayValues()[0];
    const expected = [values.number, values.productName, values.place, values.receivedOn,
      values.units, values.boxes, values.note];
    const equals = (value, i) => (i === 4 || i === 5)
      ? norm(value) !== '' && Number(String(value).replace(/,/g, '')) === Number(expected[i])
      : norm(value) === norm(expected[i]);
    if (cells.every((value) => !norm(value)) && range.getFormulas()[0].every((value) => !value)) {
      if (!_atelierVacantStockRowsInRange(sheet, row, 1, entry.rowId).length) throw new Error('ROW_OCCUPIED');
      sheet.getRange(row, 4).setNumberFormat('@');
      range.setValues([[literal(expected[0]), literal(expected[1]), literal(expected[2]),
        "'" + expected[3], Number(expected[4]), Number(expected[5]), literal(expected[6])]]);
      SpreadsheetApp.flush();
    } else if (/^at_manual_[0-9a-f]{32}$/.test(entry.rowId) && cells.every((value, i) => i === 2 || equals(value, i))) {
      // Recover only a cell Sheets coerced to a date on a previous attempt to write this exact AA row.
      const placeCell = sheet.getRange(row, 4);
      const shownDate = /^(?:19|20)(\d{2})-(\d{1,2})-(\d{1,2})$/.exec(norm(cells[2]));
      const intendedPlace = /^(\d{1,2})-(\d{1,2})-(\d{1,2})$/.exec(norm(expected[2]));
      if (shownDate && intendedPlace && typeof placeCell.getValue()?.getTime === 'function' &&
          !placeCell.getFormula() && shownDate.slice(1).every((value, i) => Number(value) === Number(intendedPlace[i + 1]))) {
        placeCell.setNumberFormat('@').setValue(expected[2]);
        SpreadsheetApp.flush();
      }
    }
    const observed = range.getDisplayValues()[0];
    if (!observed.every(equals)) throw new Error('NEW_ROW_CHANGED');
  }

  const observed = sheet.getRange(row, 2, 1, 26).getDisplayValues()[0];
  if (norm(observed[25]) !== entry.rowId || !samePair(observed, values)) throw new Error('UNVERIFIED');
  return {
    request_id: entry.requestId, row_id: norm(observed[25]),
    number: norm(observed[0]), product_name: norm(observed[1]),
    observed_values: {
      number: norm(observed[0]), productName: norm(observed[1]), place: norm(observed[2]),
      receivedOn: norm(observed[3]), units: norm(observed[4]), boxes: norm(observed[5]),
      note: norm(observed[6]), boxQr: norm(observed[17]),
    },
  };
}

function syncAtelierStockConditions() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { confirmed: 0, pending: true };
  try {
    const { entries } = _atelierStockConditionCall('list-stock-conditions');
    if (!entries.length) return { confirmed: 0, pending: false };
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty('ATELIER_STOCK_CONDITION_SPREADSHEET_ID');
    const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActive();
    const sheet = spreadsheet?.getSheetByName('창고입력');
    if (!sheet) throw new Error('창고입력 시트를 찾지 못했습니다.');
    const confirmations = [];
    let vacancyCache = {};
    for (const entry of entries) {
      try {
        confirmations.push(_writeAtelierStockCondition(sheet, entry, vacancyCache));
      } catch (error) {
        vacancyCache = {};
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
