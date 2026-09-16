/***** =========================================================
 *  Atelier 창고입력 시트 완성본
 *  - 기존 Firebase 검색 동기화는 그대로 둔다
 *  - 마지막 행까지 Firebase가 모두 성공하면 사이트 DB를 한 번에 교체한다
 *  - 비밀값은 코드에 쓰지 말고 스크립트 속성에 넣는다
 *
 *  스크립트 속성
 *  - FIRESTORE_API_KEY
 *  - WPS_DOCUMENT_SECRET          (기존 Firebase secretPass)
 *  - ATELIER_WAREHOUSE_SYNC_URL   (https://<project>.supabase.co/functions/v1/warehouse-sheet-sync)
 *  - ATELIER_WAREHOUSE_SYNC_SECRET
 *  - ATELIER_WAREHOUSE_SYNC_INDEPENDENT  (true면 Firebase 성공과 무관하게 사이트 DB 동기화)
 * ========================================================== */

/***** =========================================================
 *  A) AA(docId) 자동 생성 모듈 (충돌 방지 IIFE)
 *     - assignDocIdToAA_v2(), onOpen_DocIdMenu_v2(), onEdit_AssignDocId_v2()
 *     - 정책: B~H에 값이 있으면 AA(docId) 생성/유지, B~H가 비어도 기존 AA는 유지(삭제하지 않음)
 * ========================================================== */
(function (global) {
  'use strict';

  const SHEET_NAME = '창고입력';
  const ROW_START  = 3;
  const COL_B      = 2;
  const COL_H      = 8;
  const COL_AA     = 27;

  const _norm = (typeof global.norm === 'function')
    ? global.norm
    : (v => String(v ?? '').trim());

  const _ensureCellExists = (typeof global.ensureCellExists === 'function')
    ? global.ensureCellExists
    : function (sh, row, col) {
        if (sh.getMaxRows()    < row) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows());
        if (sh.getMaxColumns() < col) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
      };

  const _readRange = (typeof global.readRange === 'function')
    ? global.readRange
    : function (sh, r, c, nr, nc) {
        if (nr <= 0 || nc <= 0) return [];
        return sh.getRange(r, c, nr, nc).getValues();
      };

  const _writeRange = (typeof global.writeRange === 'function')
    ? global.writeRange
    : function (sh, r, c, values) {
        if (!values || !values.length) return;
        sh.getRange(r, c, values.length, values[0].length).setValues(values);
      };

  function _newSuffix() {
    return Utilities.getUuid().replace(/-/g, '').slice(0, 16).toLowerCase();
  }
  function _makeDocId() { return `inb_${_newSuffix()}`; }

  function assignDocIdToAA_core() {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sh) throw new Error(`시트를 찾을 수 없습니다: ${SHEET_NAME}`);

    const lastRow = sh.getRange(sh.getMaxRows(), COL_B)
                      .getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
    const endRow = Math.max(ROW_START, lastRow);
    _ensureCellExists(sh, endRow, COL_AA);

    const numRows = Math.max(0, endRow - ROW_START + 1);
    if (numRows === 0) return;

    const dataBH = _readRange(sh, ROW_START, COL_B, numRows, COL_H - COL_B + 1);
    const curAA  = _readRange(sh, ROW_START, COL_AA, numRows, 1);

    const existing = new Set(curAA.map(r => _norm(r[0])).filter(Boolean));
    const outAA = new Array(numRows);
    let changed = false;

    for (let i = 0; i < numRows; i++) {
      const hasAny  = dataBH[i].some(v => _norm(v));
      const current = _norm(curAA[i][0]);

      if (hasAny) {
        if (current) {
          outAA[i] = [current];
        } else {
          let id;
          do { id = _makeDocId(); } while (existing.has(id));
          existing.add(id);
          outAA[i] = [id];
          changed = true;
        }
      } else {
        outAA[i] = [current || ''];
      }
    }

    if (changed) {
      _writeRange(sh, ROW_START, COL_AA, outAA);
      sh.getRange(ROW_START, COL_AA, numRows, 1).setNumberFormat('@');
    }
  }

  function buildMenu_core() {
    SpreadsheetApp.getUi()
      .createMenu('문서ID_v2')
      .addItem('AA열 docId 생성/정리', 'assignDocIdToAA_v2')
      .addToUi();
  }

  function onEdit_core(e) {
    try {
      const sh = e.range.getSheet();
      if (sh.getName() !== SHEET_NAME) return;

      const r = e.range.getRow();
      const c = e.range.getColumn();
      if (r < ROW_START) return;
      if (!((c >= COL_B && c <= COL_H) || c === COL_AA)) return;

      const rowVals = sh.getRange(r, COL_B, 1, COL_H - COL_B + 1).getValues()[0];
      const hasAny  = rowVals.some(v => _norm(v));
      const curAA   = _norm(sh.getRange(r, COL_AA).getValue());

      if (hasAny) {
        if (!curAA) {
          const id = _makeDocId();
          sh.getRange(r, COL_AA).setNumberFormat('@').setValue(id);
        }
      }
    } catch (_) {}
  }

  global.__docid_mod = {
    assignDocIdToAA_core,
    buildMenu_core,
    onEdit_core
  };

})(typeof globalThis !== 'undefined' ? globalThis
   : (typeof window !== 'undefined' ? window : this));

function assignDocIdToAA_v2() { return __docid_mod.assignDocIdToAA_core(); }
function onOpen_DocIdMenu_v2() { return __docid_mod.buildMenu_core(); }
function onEdit_AssignDocId_v2(e) { return __docid_mod.onEdit_core(e); }

if (typeof onOpen === 'undefined') {
  function onOpen() {
    try { onOpen_DocIdMenu_v2(); } catch(_) {}
    try { onOpen_wpsRunnerMenu(); } catch(_) {}
  }
}

/***** =========================================================
 *  B) 스냅샷 함수: B~H → AB~AH, X → AI  (3행~3000행)
 * ========================================================== */
function snapshotBtoH_toABtoAH() {
  const sh = SpreadsheetApp.getActive().getSheetByName('창고입력');
  if (!sh) throw new Error('시트를 찾을 수 없습니다: 창고입력');

  const startRow = 3;
  const endRow = 3000;
  const numRows = endRow - startRow + 1;
  if (numRows <= 0) return;

  const valuesBH = sh.getRange(startRow, 2, numRows, 7).getValues();
  sh.getRange(startRow, 28, numRows, 7).setValues(valuesBH);

  const valuesX = sh.getRange(startRow, 24, numRows, 1).getValues();
  sh.getRange(startRow, 35, numRows, 1).setValues(valuesX);
}

/***** =========================================================
 *  C) warehouses_product_search 업서트 러너(커서 저장형)
 * ========================================================== */
const WPS_PROJECT_ID = 'masmarulez-md';
const WPS_API_KEY = () => {
  const k = PropertiesService.getScriptProperties().getProperty('FIRESTORE_API_KEY');
  if (!k) throw new Error('FIRESTORE_API_KEY가 없습니다. 스크립트 속성에 추가하세요.');
  return k;
};
const WPS_DOCUMENT_SECRET = () => {
  const k = PropertiesService.getScriptProperties().getProperty('WPS_DOCUMENT_SECRET');
  if (!k) throw new Error('WPS_DOCUMENT_SECRET가 없습니다. 스크립트 속성에 기존 Firebase 암호를 넣으세요.');
  return k;
};
const WPS_BASE = 'https://firestore.googleapis.com/v1';
const WPS_COLLECTION = 'warehouses_product_search';

if (typeof WPS_SHEET === 'undefined') var WPS_SHEET = '창고입력';
if (typeof ROW_START === 'undefined') var ROW_START = 3;
if (typeof ROW_END   === 'undefined') var ROW_END   = 3000;
if (typeof CONCURRENCY === 'undefined') var CONCURRENCY = 10;

if (typeof COL === 'undefined') {
  var COL = {
    B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    X: 24,
    AA: 27,
    AB: 28, AC: 29, AD: 30, AE: 31, AF: 32, AG: 33, AH: 34,
    AI: 35
  };
}
if (typeof _norm === 'undefined') {
  var _norm = function (v) { return String(v ?? '').trim(); };
}
if (typeof _readRange === 'undefined') {
  var _readRange = function (sh, r, c, nr, nc) {
    return (nr<=0 || nc<=0) ? [] : sh.getRange(r, c, nr, nc).getValues();
  };
}
if (typeof _writeRange === 'undefined') {
  var _writeRange = function (sh, r, c, values) {
    if (values && values.length) sh.getRange(r, c, values.length, values[0].length).setValues(values);
  };
}
if (typeof _lastRowByColumn === 'undefined') {
  var _lastRowByColumn = function (sh, colIdx) {
    try {
      return sh.getRange(sh.getMaxRows(), colIdx)
               .getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
    } catch (e) {
      return ROW_START - 1;
    }
  };
}
if (typeof _nowIso === 'undefined') {
  var _nowIso = function () { return new Date().toISOString(); };
}

const WPS_CURSOR_KEY   = 'WPS_UPSERT_CURSOR';
const WPS_SOFT_MS      = 3.5 * 60 * 1000;
const WPS_FLUSH_EVERY  = 20;
const ATELIER_SYNC_FAIL_KEY = 'ATELIER_WAREHOUSE_SYNC_LAST_ERROR';
const ATELIER_SYNC_INDEPENDENT_KEY = 'ATELIER_WAREHOUSE_SYNC_INDEPENDENT';

function atelierWarehouseSyncIndependent() {
  const value = String(
    PropertiesService.getScriptProperties().getProperty(ATELIER_SYNC_INDEPENDENT_KEY) || ''
  ).trim().toLowerCase();
  return value === 'true' || value === '1';
}

function enableAtelierWarehouseSyncIndependent() {
  PropertiesService.getScriptProperties().setProperty(ATELIER_SYNC_INDEPENDENT_KEY, 'true');
  SpreadsheetApp.getActive().toast('사이트 단독 동기화를 켰습니다. Firebase 실패와 무관하게 시트 원본을 사이트 DB에 보냅니다.');
}

function disableAtelierWarehouseSyncIndependent() {
  PropertiesService.getScriptProperties().setProperty(ATELIER_SYNC_INDEPENDENT_KEY, 'false');
  SpreadsheetApp.getActive().toast('사이트 단독 동기화를 껐습니다. Firebase가 전 행 성공한 뒤에만 사이트 DB를 갱신합니다.');
}

function shouldSyncAtelierWarehouseSnapshot(finishedAll, firebaseFailures) {
  if (!finishedAll) return false;
  if (atelierWarehouseSyncIndependent()) return true;
  return firebaseFailures === 0;
}

function _buildPatchWithDeletes(collection, docId, setObj, deleteKeys){
  const fields = {};
  const mask = [];

  Object.keys(setObj || {}).forEach(k=>{
    const v=setObj[k];
    if (v===undefined || v===null) return;
    if (Array.isArray(v)){
      const arr = v.filter(x=>_norm(x)).map(x=>({stringValue:String(x)}));
      fields[k]  = { arrayValue:{ values:arr } };
      mask.push(k);
    } else {
      const sv=_norm(v);
      if(!sv) return;
      fields[k] = { stringValue: sv };
      mask.push(k);
    }
  });

  (deleteKeys||[]).forEach(k=>{ if(!mask.includes(k)) mask.push(k); });

  if (!mask.length) return null;
  const qs = mask.map(f=>`updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${WPS_BASE}/projects/${WPS_PROJECT_ID}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}?key=${WPS_API_KEY()}&${qs}`;
  return {
    url,
    options: {
      method: 'patch',
      contentType: 'application/json',
      payload: JSON.stringify({ fields }),
      muteHttpExceptions: true
    }
  };
}

function _wpsLoadCursor(){
  const v = PropertiesService.getScriptProperties().getProperty(WPS_CURSOR_KEY);
  const n = parseInt(v || ROW_START, 10);
  return Number.isFinite(n) ? n : ROW_START;
}
function _wpsSaveCursor(row){
  PropertiesService.getScriptProperties().setProperty(WPS_CURSOR_KEY, String(row));
}
function resetWpsCursor(){
  PropertiesService.getScriptProperties().setProperty(WPS_CURSOR_KEY, String(ROW_START));
  SpreadsheetApp.getActive().toast(`커서를 ${ROW_START}행으로 초기화했습니다.`);
}

function _writeH1Stamp(sh){
  const tz = 'Asia/Seoul';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd-HH-mm-ss');
  sh.getRange(1, COL.H).setNumberFormat('@').setValue(stamp);
}

function _atelierHmacHex(secret, message) {
  // 본문에 한글이 있으므로 Google 기본 문자셋에 맡기지 않고
  // Edge Function과 같은 UTF-8 바이트로 서명한다.
  const raw = Utilities.computeHmacSha256Signature(
    message,
    secret,
    Utilities.Charset.UTF_8
  );
  return raw.map(function (b) {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function _collectAtelierWarehouseRows(sh) {
  assignDocIdToAA_v2();
  const lastRow = Math.max(_lastRowByColumn(sh, COL.B), ROW_START - 1);
  const endRow = Math.min(Math.max(lastRow, ROW_START - 1), ROW_END);
  const numRows = Math.max(0, endRow - ROW_START + 1);
  if (numRows === 0) return [];
  const curBH = _readRange(sh, ROW_START, COL.B, numRows, 7);
  const docIds = _readRange(sh, ROW_START, COL.AA, numRows, 1);
  const rows = [];
  for (let i = 0; i < numRows; i++) {
    const b = _norm(curBH[i][0]);
    const c = _norm(curBH[i][1]);
    const d = _norm(curBH[i][2]);
    const e = _norm(curBH[i][3]);
    const f = _norm(curBH[i][4]);
    const g = _norm(curBH[i][5]);
    const h = _norm(curBH[i][6]);
    const aa = _norm(docIds[i][0]);
    if (!(b || c || d || e || f || g || h)) continue;
    rows.push({
      externalRowId: aa,
      sourceStyleNo: b,
      sourceProductName: c,
      locationRaw: d,
      receivedOnRaw: e,
      unitsPerBoxRaw: f,
      remainingBoxesRaw: g,
      note: h,
      sourceRowNumber: ROW_START + i,
    });
  }
  return rows;
}

function syncAtelierWarehouseSnapshot_(options) {
  const validateOnly = !!(options && options.validateOnly);
  const props = PropertiesService.getScriptProperties();
  const url = _norm(props.getProperty('ATELIER_WAREHOUSE_SYNC_URL'));
  const secret = _norm(props.getProperty('ATELIER_WAREHOUSE_SYNC_SECRET'));
  if (!url || !secret) {
    throw new Error('ATELIER_WAREHOUSE_SYNC_URL / ATELIER_WAREHOUSE_SYNC_SECRET를 스크립트 속성에 넣으세요.');
  }
  const sh = SpreadsheetApp.getActive().getSheetByName(WPS_SHEET);
  if (!sh) throw new Error(`시트를 찾을 수 없습니다: ${WPS_SHEET}`);
  const rows = _collectAtelierWarehouseRows(sh);
  if (!rows.length) throw new Error('사이트에 보낼 창고 행이 없습니다.');

  const body = JSON.stringify({
    validateOnly: validateOnly,
    brandSlug: 'masmarulez',
    sourceFileName: '창고입력 시트 동기화',
    rows: rows,
  });
  const timestamp = String(Date.now());
  const signature = _atelierHmacHex(secret, timestamp + '.' + body);
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: body,
    muteHttpExceptions: true,
    headers: {
      'x-atelier-timestamp': timestamp,
      'x-atelier-signature': signature,
    },
  });
  const code = response.getResponseCode();
  let parsed = {};
  try { parsed = JSON.parse(response.getContentText() || '{}'); } catch (_) {}
  if (code < 200 || code >= 300 || !parsed.ok) {
    const message = parsed.error || ('사이트 동기화 실패 HTTP ' + code);
    props.setProperty(ATELIER_SYNC_FAIL_KEY, message);
    throw new Error(message);
  }
  props.deleteProperty(ATELIER_SYNC_FAIL_KEY);
  return parsed;
}

function retryAtelierWarehouseSync() {
  try {
    const result = syncAtelierWarehouseSnapshot_({ validateOnly: false });
    SpreadsheetApp.getActive().toast(
      '사이트 DB 전체 동기화 완료: ' + (result.total || 0) + '행'
    );
  } catch (error) {
    SpreadsheetApp.getActive().toast('사이트 동기화 실패: ' + error.message);
    throw error;
  }
}

function upsertWPS_WhenRowDiff_resume(){
  const sh = SpreadsheetApp.getActive().getSheetByName(WPS_SHEET);
  if (!sh) throw new Error(`시트를 찾을 수 없습니다: ${WPS_SHEET}`);

  const t0 = Date.now();
  const lastRow = Math.max(_lastRowByColumn(sh, COL.B), _lastRowByColumn(sh, COL.AB), ROW_START-1);
  const endRow  = Math.min(Math.max(lastRow, ROW_START-1), ROW_END);
  let startRow  = Math.max(ROW_START, _wpsLoadCursor());

  if (startRow > endRow){
    resetWpsCursor();
    SpreadsheetApp.getActive().toast('모든 행 처리 완료(커서 초기화)');
    _writeH1Stamp(sh);
    return;
  }

  const READ_CHUNK = 1000;
  let globalProcessed = 0;
  let firebaseFailures = 0;

  while (Date.now() - t0 < WPS_SOFT_MS && startRow <= endRow) {
    const readEnd = Math.min(endRow, startRow + READ_CHUNK - 1);
    const numRows = Math.max(0, readEnd - startRow + 1);
    if (numRows === 0) break;

    const curBH  = _readRange(sh, startRow, COL.B , numRows, 7);
    const snapAB = _readRange(sh, startRow, COL.AB, numRows, 7);
    const curX   = _readRange(sh, startRow, COL.X , numRows, 1);
    const xSnaps = _readRange(sh, startRow, COL.AI, numRows, 1);
    const docIds = _readRange(sh, startRow, COL.AA, numRows, 1);

    let jobs = [];
    let jobRowIdx = [];
    const willClearSnapshot = new Array(numRows).fill(false);
    const willSetSnapshotBH = new Array(numRows).fill(null);
    const willSetSnapshotX  = new Array(numRows).fill(null);
    const nowIso = _nowIso();

    function flushBatch(){
      if (!jobs.length) return;
      for (let s=0; s<jobs.length; s+=CONCURRENCY){
        const slice = jobs.slice(s, s+CONCURRENCY);
        try{
          const resps = UrlFetchApp.fetchAll(slice.map(j=>({ url:j.url, ...j.options })));
          resps.forEach((res, idx)=>{
            const code = res.getResponseCode();
            const localIdx = jobRowIdx[s+idx];
            const rowIdx = startRow + localIdx;
            if (code>=200 && code<300){
              if (willClearSnapshot[localIdx] === true){
                _writeRange(sh, rowIdx, COL.AB, [['','','','','','','']]);
                _writeRange(sh, rowIdx, COL.AI, [['']]);
              } else {
                if (Array.isArray(willSetSnapshotBH[localIdx])){
                  _writeRange(sh, rowIdx, COL.AB, [ willSetSnapshotBH[localIdx] ]);
                }
                if (willSetSnapshotX[localIdx] !== null){
                  _writeRange(sh, rowIdx, COL.AI, [[ willSetSnapshotX[localIdx] ]]);
                }
              }
            } else {
              firebaseFailures += 1;
            }
          });
        }catch(e){
          firebaseFailures += 1;
        }
      }
      jobs.length = 0;
      jobRowIdx.length = 0;
    }

    let processed = 0;

    for (let i=0; i<numRows; i++){
      if (Date.now() - t0 > WPS_SOFT_MS) break;

      const b=_norm(curBH[i][0]), c=_norm(curBH[i][1]), d=_norm(curBH[i][2]), e=_norm(curBH[i][3]),
            f=_norm(curBH[i][4]), g=_norm(curBH[i][5]), h=_norm(curBH[i][6]);
      const x    = _norm(curX[i][0]);
      const xSnap= _norm(xSnaps[i][0]);
      const aa   = _norm(docIds[i][0]);
      const ab=_norm(snapAB[i][0]), ac=_norm(snapAB[i][1]), ad=_norm(snapAB[i][2]), ae=_norm(snapAB[i][3]),
            af=_norm(snapAB[i][4]), ag=_norm(snapAB[i][5]), ah=_norm(snapAB[i][6]);

      const hasCurAny  = !!(b||c||d||e||f||g||h);
      const hasSnapAny = !!(ab||ac||ad||ae||af||ag||ah);
      const changed    = (b!==ab)||(c!==ac)||(d!==ad)||(e!==ae)||(f!==af)||(g!==ag)||(h!==ah);
      const changedX   = (x !== xSnap);

      if (!aa){ processed++; continue; }

      if (!hasCurAny && hasSnapAny){
        const req = _buildPatchWithDeletes(
          WPS_COLLECTION, aa, { secretPass: WPS_DOCUMENT_SECRET() },
          ['arrivalDate','boxCount','libraryNumber','productName','productRef','unitsPerBox','chinaCode','note','createdAt']
        );
        if (req){
          jobs.push(req);
          jobRowIdx.push(i);
          willClearSnapshot[i] = true;
        }
      }

      if (hasCurAny && (changed || changedX)){
        const setObj = {
          arrivalDate  : e,
          boxCount     : g,
          createdAt    : nowIso,
          libraryNumber: d,
          productName  : c,
          productRef   : x,
          unitsPerBox  : f,
          chinaCode    : b,
          note         : h,
          secretPass   : WPS_DOCUMENT_SECRET()
        };
        const delKeys = [];
        if (!b && ab) delKeys.push('chinaCode');
        if (!c && ac) delKeys.push('productName');
        if (!d && ad) delKeys.push('libraryNumber');
        if (!e && ae) delKeys.push('arrivalDate');
        if (!f && af) delKeys.push('unitsPerBox');
        if (!g && ag) delKeys.push('boxCount');
        if (!h && ah) delKeys.push('note');
        if (!x)       delKeys.push('productRef');

        const req = _buildPatchWithDeletes(WPS_COLLECTION, aa, setObj, delKeys);
        if (req){
          jobs.push(req);
          jobRowIdx.push(i);
          willSetSnapshotBH[i] = [b,c,d,e,f,g,h];
          willSetSnapshotX[i]  = x;
        }
      }

      if (jobs.length && jobs.length % WPS_FLUSH_EVERY === 0){
        flushBatch();
      }

      processed++;
    }

    if (jobs.length) flushBatch();

    startRow += processed;
    globalProcessed += processed;
    if (Date.now() - t0 > WPS_SOFT_MS) break;
  }

  const finishedAll = startRow > endRow;
  _wpsSaveCursor(finishedAll ? ROW_START : startRow);

  if (shouldSyncAtelierWarehouseSnapshot(finishedAll, firebaseFailures)) {
    try {
      const result = syncAtelierWarehouseSnapshot_({ validateOnly: false });
      const extra = firebaseFailures > 0
        ? ` · Firebase 실패 ${firebaseFailures}건은 무시하고 시트 원본을 보냄`
        : '';
      SpreadsheetApp.getActive().toast(
        '마지막까지 처리 완료 · 사이트 DB ' + (result.total || 0) + '행 동기화' + extra
      );
    } catch (error) {
      SpreadsheetApp.getActive().toast(
        (firebaseFailures === 0 ? 'Firebase는 완료. ' : '') +
        '사이트 동기화 실패: ' + error.message + ' → 메뉴에서 재시도'
      );
    }
  } else {
    const msg = finishedAll
      ? `마지막까지 처리했지만 Firebase 실패 ${firebaseFailures}건. 사이트는 동기화하지 않았습니다.`
      : `진행 저장: 다음 실행은 ${startRow}행부터 (이번 회차 처리 행수 ${globalProcessed})`;
    SpreadsheetApp.getActive().toast(msg);
  }
  _writeH1Stamp(sh);
}

function onOpen_wpsRunnerMenu(){
  SpreadsheetApp.getUi()
    .createMenu('WPS 러너')
    .addItem('진행저장 러너 실행', 'upsertWPS_WhenRowDiff_resume')
    .addItem('커서 초기화', 'resetWpsCursor')
    .addItem('사이트 DB 전체 동기화 재시도', 'retryAtelierWarehouseSync')
    .addItem('사이트 단독 동기화 켜기', 'enableAtelierWarehouseSyncIndependent')
    .addItem('사이트 단독 동기화 끄기', 'disableAtelierWarehouseSyncIndependent')
    .addToUi();
}
