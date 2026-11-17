// Install in the same bound project as DB.gs and Masma Works.gs so all three writers share one lock.
const ATELIER_PENDING_REMOVAL_NOTE = 'Atelier 시트 삭제 확인 대기: ';

function writeAtelierQrAuditSheet(sheet, entry, recordRepair) {
  const first = 3;
  const limit = ATELIER_WAREHOUSE_SNAPSHOT_LAST_ROW;
  const height = sheet.getMaxRows() - first + 1;
  const manage = [2, 3, 4, 5, 6, 7, 8, 19, 27];
  const fields = ['M번호', '품명', '자리', '입고일', '박스당 수량', '박스 수', '메모', '박스 QR'];
  const norm = value => String(value ?? '').trim();
  const placeOf = value => norm(value).replace(/\/\/$/, '').trim().toUpperCase();
  const qrOf = value => norm(value).toUpperCase();
  const countOf = value => /^-?[\d,]+$/.test(norm(value)) ? norm(value).replace(/,/g, '') : norm(value);
  const expectedPlace = placeOf(entry.place);
  const idMap = rows => new Map(rows.map(row => [row.id, row]));
  const before = idMap(entry.before);
  const after = idMap(entry.after);
  const stockWork = entry.kind === 'stock';
  const versioned = Array.isArray(entry.ids);
  const plannedIds = new Set(entry.ids || [...before.keys(), ...after.keys()]);
  const picking = new Set(entry.picking || []);
  const afterQrs = entry.after.map(row => qrOf(row.qr));
  const desiredQrs = new Set((stockWork ? entry.before.concat(entry.after) : entry.after)
    .map(row => qrOf(row.qr)).filter(Boolean));
  const identified = afterQrs.filter(Boolean);
  if (before.size !== entry.before.length || after.size !== entry.after.length ||
      new Set(identified).size !== identified.length ||
      (!stockWork && identified.length !== entry.after.length)) throw new Error('DUPLICATE_PLAN');

  function fail(code, differences = []) {
    const error = new Error(code);
    error.differences = differences;
    throw error;
  }

  function diff(id, field, expected, actual, target) {
    const limit = value => value == null ? null : norm(value).slice(0, 120);
    return { id: limit(id), field, expected: limit(expected), actual: limit(actual), target: limit(target) };
  }

  function read() {
    if (stockWork) {
      const ids = sheet.getRange(first, 27, height, 1).getDisplayValues();
      const qrs = desiredQrs.size ? sheet.getRange(first, 19, height, 1).getDisplayValues() : null;
      const places = picking.size ? sheet.getRange(first, 4, height, 1).getDisplayValues() : null;
      const relevant = new Map();
      for (let index = 0; index < ids.length; index++) {
        const id = norm(ids[index][0]);
        const qr = norm(qrs?.[index]?.[0]);
        const sheetRow = first + index;
        if (!plannedIds.has(id)) {
          if (desiredQrs.has(qrOf(qr))) fail('QR_AT_ANOTHER_ROW', [diff(id, '박스 QR', null, qr)]);
          const place = norm(places?.[index]?.[0]);
          if (picking.has(placeOf(place))) {
            const [boxes, note] = sheet.getRange(sheetRow, 7, 1, 2).getDisplayValues()[0];
            if (countOf(boxes) !== '0' || /^개봉 잔량 [1-9]/.test(norm(note))) fail('PICKING_OCCUPIED', [
              diff(id || `시트 ${sheetRow}행`, '자리', '다른 재고 없음', place),
            ]);
          }
          continue;
        }
        if (relevant.has(id)) fail('AA_MISSING_OR_DUPLICATE', [
          diff(id, 'AA', '한 행', `${relevant.get(id).sheetRow}행, ${sheetRow}행`),
        ]);
        if (sheetRow > limit) fail('OUTSIDE_SNAPSHOT_RANGE', [diff(id, '행 번호', `${limit} 이하`, sheetRow)]);
        const values = sheet.getRange(sheetRow, 2, 1, 7).getDisplayValues()[0].map(norm);
        const actualQr = qrs ? qr : norm(sheet.getRange(sheetRow, 19).getDisplayValues()[0][0]);
        relevant.set(id, { sheetRow, id, qr: actualQr, values });
      }
      const cleared = new Map();
      const missingDeleted = new Set(versioned ? [...before.keys()].filter(id => !after.has(id) && !relevant.has(id)) : []);
      if (missingDeleted.size) {
        const notes = sheet.getRange(first, 27, Math.min(height, limit - first + 1), 1).getNotes();
        notes.forEach(([note], index) => {
          const id = note.startsWith(ATELIER_PENDING_REMOVAL_NOTE) ? note.slice(ATELIER_PENDING_REMOVAL_NOTE.length) : '';
          if (!missingDeleted.has(id)) return;
          const sheetRow = first + index;
          const cells = sheet.getRange(sheetRow, 1, 1, 27).getDisplayValues()[0];
          if (!manage.every(col => !norm(cells[col - 1])) || cleared.has(id)) fail('REMOVAL_UNVERIFIED', [
            diff(id, '재고 입력값', '빈 셀', `시트 ${sheetRow}행 확인 필요`),
          ]);
          cleared.set(id, sheetRow);
        });
      }
      return { relevant, cleared };
    }
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

  function matchesValue(actual, expected, index, beforeWrite) {
    if (index === 6 && beforeWrite && !stockWork) return true;
    if (index === 6 && stockWork && (beforeWrite || expected.preserveNote) &&
        norm(actual) === norm(expected.rawNote)) return true;
    const value = expected.values[index];
    return index === 4 || index === 5 ? countOf(actual) === countOf(value) : norm(actual) === norm(value);
  }

  function matches(actual, expected, includeNote) {
    if (!actual || ((includeNote || stockWork || actual.qr) && qrOf(actual.qr) !== qrOf(expected.qr))) return false;
    return expected.values.every((_, index) => matchesValue(actual.values[index], expected, index, !includeNote));
  }

  function verified({ relevant, cleared }) {
    if (relevant.size !== after.size || [...after].some(([id, row]) => !matches(relevant.get(id), row, true))) return null;
    if (versioned && [...before.keys()].some(id => !after.has(id) && !cleared.has(id))) return null;
    const rows = [...relevant.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(row => ({ id: row.id, qr: row.qr.toUpperCase(),
        values: row.values.map((value, index) => index === 4 || index === 5 ? countOf(value) : value) }));
    return versioned ? { rows, absent: [...plannedIds].filter(id => !relevant.has(id)), cleared } : rows;
  }

  function rowDifferences(relevant, expected, target, beforeWrite) {
    const changes = [];
    for (const id of new Set([...relevant.keys(), ...expected.keys()])) {
      const actual = relevant.get(id);
      const wanted = expected.get(id);
      const next = target.get(id);
      if (!actual || !wanted) {
        changes.push(diff(id, 'AA', wanted ? '존재' : '없음', actual ? `${actual.sheetRow}행` : '없음', next ? '존재' : '없음'));
        continue;
      }
      if (qrOf(actual.qr) !== qrOf(wanted.qr)) changes.push(diff(id, '박스 QR', wanted.qr, actual.qr, next?.qr));
      for (const [index, value] of wanted.values.entries()) {
        if (!matchesValue(actual.values[index], wanted, index, beforeWrite)) {
          changes.push(diff(id, fields[index], value, actual.values[index], next?.values[index]));
        }
      }
    }
    return changes.slice(0, 16);
  }

  function sameStockIdentity(actual, expected) {
    if (!actual || !expected) return false;
    const qr = qrOf(expected.qr);
    if (qr || actual.qr) return Boolean(qr) && qrOf(actual.qr) === qr;
    const [number, name] = expected.values.map(norm);
    return Boolean(number || name) && actual.values[0] === number && actual.values[1] === name;
  }

  const snapshot = read();
  const { display, relevant } = snapshot;
  const alreadyWritten = verified(snapshot);
  if (alreadyWritten) return alreadyWritten;

  const baseline = new Map(relevant);
  if (versioned) {
    // An older manual-receive writer could reserve AA and stop before filling B:H.
    for (const [id, row] of baseline) {
      if (!before.has(id) && after.has(id) && /^at_manual_[0-9a-f]{32}$/.test(id) &&
          !row.qr && row.values.every(value => !value)) baseline.delete(id);
    }
  }
  let repair = null;
  if (baseline.size !== before.size || [...before].some(([id, row]) => !matches(baseline.get(id), row, false))) {
    const differences = rowDifferences(baseline, before, after, true);
    const sameRows = baseline.size === before.size && [...before].every(([id, row]) => {
      const current = baseline.get(id);
      return sameStockIdentity(current, row) || sameStockIdentity(current, after.get(id));
    });
    if (!versioned || !stockWork || !recordRepair || !sameRows) fail('SHEET_STOCK_CHANGED', differences);
    repair = differences;
  }
  const fresh = entry.after.filter(row => !relevant.has(row.id));
  let empty = [];
  if (fresh.length) {
    const writableHeight = Math.min(height, limit - first + 1);
    const candidates = stockWork ? sheet.getRange(first, 1, writableHeight, 27).getDisplayValues() : display.slice(0, writableHeight);
    empty = findWarehousePlacementEmptyRows(sheet, first, candidates, fresh.length);
  }
  if (empty.length !== fresh.length) throw new Error('NO_EMPTY_ROW');

  const requests = [];
  const writes = [];
  const cell = (row, col, fields, value) =>
    requests.push(warehousePlacementCell(sheet.getSheetId(), row, col, fields, value));

  function ensureWritable(row, id) {
    const formulas = sheet.getRange(row, 1, 1, 27).getFormulas()[0];
    const index = manage.findIndex(col => formulas[col - 1]);
    if (index >= 0) fail('FORMULA_CELL', [diff(id, fields[index] || 'AA', '입력 셀', '수식')]);
  }

  function checkPhysicalRow(row, current, id) {
    if (!versioned) return;
    const cells = sheet.getRange(row, 1, 1, 27).getDisplayValues()[0];
    const beforeValues = current ? [...current.values, current.qr, current.id] : manage.map(() => '');
    const differences = manage.flatMap((col, index) => norm(cells[col - 1]) === beforeValues[index]
      ? [] : [diff(id, fields[index] || 'AA', beforeValues[index], cells[col - 1])]);
    if (differences.length) fail('SHEET_STOCK_CHANGED', differences);
  }

  for (const [id, row] of relevant) {
    if (after.has(id)) continue;
    checkPhysicalRow(row.sheetRow, row, id);
    ensureWritable(row.sheetRow, id);
    if (repair) writes.push({ target: row.sheetRow, current: row, id });
    const hasWpsSnapshot = sheet.getRange(row.sheetRow, 28, 1, 7).getDisplayValues()[0].some(norm);
    for (const col of manage) {
      if (col === 27) cell(row.sheetRow, col, 'userEnteredValue,note',
        versioned ? { note: ATELIER_PENDING_REMOVAL_NOTE + id }
          : hasWpsSnapshot ? { note: PLACEMENT_REMOVED_NOTE + id } : {});
      else cell(row.sheetRow, col, 'userEnteredValue', {});
    }
  }

  for (const row of entry.after) {
    const target = relevant.get(row.id)?.sheetRow ?? empty.shift();
    const current = relevant.get(row.id);
    checkPhysicalRow(target, current, row.id);
    if (!stockWork || !current) ensureWritable(target, row.id);
    if (repair) writes.push({ target, current, id: row.id });
    const formulas = stockWork && current ? sheet.getRange(target, 1, 1, 27).getFormulas()[0] : [];
    const values = [...row.values, row.qr, row.id];
    for (let i = 0; i < manage.length; i++) {
      if (stockWork && current) {
        if (i === 8 || (i === 7 && qrOf(current.qr) === qrOf(row.qr)) ||
            (i < 7 && matchesValue(current.values[i], row, i, false))) continue;
        if (formulas[manage[i] - 1]) fail('FORMULA_CELL', [
          diff(row.id, fields[i], '입력 셀', '수식', values[i]),
        ]);
      }
      const value = norm(values[i]);
      const numeric = (i === 4 || i === 5) && /^\d+$/.test(value);
      cell(target, manage[i], 'userEnteredValue', value ? { userEnteredValue: numeric
        ? { numberValue: Number(value) } : { stringValue: value } } : {});
    }
  }

  if (requests.length) {
    if (repair) {
      recordRepair(repair);
      // Verify the exact cells again after the network call that records the repair.
      read(); // Recheck duplicate IDs, QR ownership and other stock occupying picking slots.
      for (const { target, current, id } of writes) {
        checkPhysicalRow(target, current, id);
        ensureWritable(target, id);
      }
    }
    warehousePlacementSheetApi(sheet, ':batchUpdate', 'post', { requests });
    SpreadsheetApp.flush();
  }
  const observed = read();
  const result = verified(observed);
  if (!result) fail('SHEET_VALUES_UNVERIFIED', rowDifferences(observed.relevant, after, after, false));
  return result;
}

function _releaseAtelierStockSheetRemovals(sheet, completed) {
  if (!completed.length) return;
  const first = 3;
  const last = Math.min(sheet.getMaxRows(), ATELIER_WAREHOUSE_SNAPSHOT_LAST_ROW);
  const markers = new Map();
  sheet.getRange(first, 27, last - first + 1, 1).getNotes().forEach(([note], index) => {
    if (note.startsWith(ATELIER_PENDING_REMOVAL_NOTE)) {
      markers.set(note.slice(ATELIER_PENDING_REMOVAL_NOTE.length), first + index);
    }
  });
  for (const entry of completed) {
    try {
      for (const id of entry.ids) {
        const row = markers.get(id);
        if (!row) continue;
        const aa = sheet.getRange(row, 27);
        if (aa.getNote() !== ATELIER_PENDING_REMOVAL_NOTE + id) continue;
        if (aa.getDisplayValues()[0][0]) throw new Error('AA 변경됨');
        // The stable proof remains until the server confirms. The existing WPS pass can now remove its snapshot.
        if (sheet.getRange(row, 28, 1, 7).getDisplayValues()[0].some(value => String(value).trim())) {
          aa.setNote(PLACEMENT_REMOVED_NOTE + id);
        } else {
          aa.clearNote();
        }
      }
      SpreadsheetApp.flush();
      _atelierStockConditionCall('cleanup-stock-sheet-job', { id: entry.id });
    } catch (_) {
      console.warn('창고입력 AA 삭제 표지 정리 대기: ' + entry.id);
    }
  }
}

function _syncAtelierStockSheetJobs(sheet) {
  const { jobs, cleanup = [] } = _atelierStockConditionCall('claim-stock-sheet-jobs');
  let synced = 0;
  for (const entry of jobs) {
    try {
      const { rows, absent, cleared } = writeAtelierQrAuditSheet(sheet, entry, differences => {
        try {
          _atelierStockConditionCall('record-stock-sheet-repair', { id: entry.id, lease: entry.lease, differences });
        } catch (_) {
          const error = new Error('SHEET_REPAIR_HISTORY_UNAVAILABLE');
          error.differences = differences;
          throw error;
        }
      });
      _atelierStockConditionCall('finish-stock-sheet-job', { id: entry.id, lease: entry.lease, rows, absent });
      synced++;
      if (cleared.size) cleanup.push({ id: entry.id, ids: [...cleared.keys()] });
    } catch (error) {
      const reason = /^[A-Z_]{1,60}$/.test(error.message) ? error.message : 'SYNC_REQUEST_FAILED';
      try {
        _atelierStockConditionCall('fail-stock-sheet-job', {
          id: entry.id, lease: entry.lease, reason, differences: error.differences || [],
        });
      } catch (_) {
        console.warn('창고입력 반영 오류 기록 대기: ' + entry.id);
      }
      console.warn('창고입력 반영 대기: ' + entry.id + ' ' + reason);
    }
  }
  _releaseAtelierStockSheetRemovals(sheet, cleanup);
  return { synced, pending: synced < jobs.length };
}

function syncAtelierWarehouseQrAuditSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { synced: 0, pending: true };
  try {
    const props = PropertiesService.getScriptProperties();
    const useVersioned = props.getProperty('ATELIER_STOCK_SHEET_WRITEBACK_V2') === 'true';
    const { entries } = _atelierStockConditionCall('list-qr-audit-exports');
    if (!entries.length && !useVersioned) return { synced: 0, pending: false };
    const spreadsheetId = props.getProperty('ATELIER_STOCK_CONDITION_SPREADSHEET_ID');
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
    let versioned = { synced: 0, pending: false };
    if (useVersioned) {
      try {
        versioned = _syncAtelierStockSheetJobs(sheet);
      } catch (error) {
        versioned.pending = true;
        console.warn('창고입력 연속 저장 반영 목록을 읽지 못했습니다.');
      }
    }
    return { synced: synced + versioned.synced, pending: synced < entries.length || versioned.pending };
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

function enableAtelierStockSheetWritebackV2() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('ATELIER_STOCK_SHEET_WRITEBACK_V2') === 'true') return;
  const check = _atelierStockConditionCall('claim-stock-sheet-jobs');
  if (check.enabled !== false || !Array.isArray(check.jobs) || check.jobs.length) {
    throw new Error('연속 반영을 활성화하기 전의 서버 연결을 확인해주세요.');
  }
  properties.setProperty('ATELIER_STOCK_SHEET_WRITEBACK_V2', 'true');
  console.info('창고입력 연속 반영 서버 연결 확인 · DB 활성화 대기');
}
