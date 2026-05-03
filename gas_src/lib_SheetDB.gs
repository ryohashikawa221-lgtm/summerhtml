/**
 * lib_SheetDB.gs
 * シートをテーブル抽象として隠蔽するデータアクセス層。
 *
 * - find/findOne/findById/insert/update/softDelete/bulkInsert を提供
 * - id 自動採番（連番、Lock 内で安全）
 * - created_at/updated_at 自動付与
 * - deleted_at ソフト削除（find はデフォルト除外）
 * - スキーマ整合性チェック ensureSchema()
 * - find 時に Schema 駆動で Date 列を文字列化（google.script.run の Date シリアライズ問題対策）
 *
 * 同一実行内ではシート読込結果をメモリキャッシュして I/O を節約する。
 *
 * 来歴: hoshuko_app より移植 (2026-05-03)。Phase 1 (Date シリアライズ) /
 *       Phase 9-X (PropertiesService closure cache + col resolution one-pass) の
 *       性能修正を引き継ぎ済み。
 */

const SheetDB = (function () {

  var _cache = {}; // sheetName -> { values: [[...]], header: [...], read_at: ms }
  var _ssCache = null;

  // Phase 9-X: 計測フラグ。SheetDB.setProfiling(true) で _readAll の各ステップ ms を Logger 出力。
  var _PROFILING = false;
  function setProfiling(on) { _PROFILING = (on === true); }

  function _ss() {
    if (_ssCache) return _ssCache;
    var env = (PropertiesService.getScriptProperties().getProperty('APP_ENV') || 'dev').toLowerCase();
    var key = env === 'prod' ? 'prod_spreadsheet_id' : 'dev_spreadsheet_id';
    var id = PropertiesService.getScriptProperties().getProperty(key);
    if (!id) throw new Error('Script Property "' + key + '" が未設定です。SETUP.md を確認してください。');
    _ssCache = SpreadsheetApp.openById(id);
    return _ssCache;
  }

  function _schemaByName(sheetName) {
    var k = Schema.keyByName(sheetName);
    if (!k) throw new Error('Schema 未定義: ' + sheetName);
    return Schema.SHEETS[k];
  }

  function _getSheet(sheetName) {
    var sh = _ss().getSheetByName(sheetName);
    if (!sh) throw new Error('シート未作成: ' + sheetName + '。initialSetup を実行してください。');
    return sh;
  }

  function _getDateColumnTypes(sheetName) {
    try {
      var schema = _schemaByName(sheetName);
      var map = {};
      schema.cols.forEach(function (col) {
        if (col.type === 'date' || col.type === 'datetime') {
          map[col.name] = col.type;
        }
      });
      return map;
    } catch (e) {
      return {};
    }
  }

  function _normalizeReadValue(value, colType) {
    if (!(value instanceof Date)) return value;
    if (colType === 'date') return Util.formatDate(value);
    if (colType === 'datetime') return Util.formatDateTime(value);
    return Utilities.formatDate(value, Util.getTz(), 'HH:mm');
  }

  function _readAll(sheetName) {
    if (_cache[sheetName]) {
      if (_PROFILING) Logger.log('  [_readAll ' + sheetName + '] in-memory cache HIT (0ms)');
      return _cache[sheetName];
    }

    var __t1 = _PROFILING ? new Date().getTime() : 0;
    var sh = _getSheet(sheetName);
    if (_PROFILING) Logger.log('  [_readAll ' + sheetName + '] _getSheet: ' + (new Date().getTime() - __t1) + 'ms');
    var __t2 = _PROFILING ? new Date().getTime() : 0;
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (_PROFILING) Logger.log('  [_readAll ' + sheetName + '] getLastRow/Col: ' + (new Date().getTime() - __t2) + 'ms (rows=' + lastRow + ', cols=' + lastCol + ')');
    if (lastRow < 1) {
      _cache[sheetName] = { sheet: sh, header: [], rows: [], values: [] };
      return _cache[sheetName];
    }
    var __t3 = _PROFILING ? new Date().getTime() : 0;
    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    if (_PROFILING) Logger.log('  [_readAll ' + sheetName + '] getValues: ' + (new Date().getTime() - __t3) + 'ms');
    var __t4 = _PROFILING ? new Date().getTime() : 0;
    var header = values[0].map(function (h) { return String(h).trim(); });
    if (_PROFILING) Logger.log('  [_readAll ' + sheetName + '] header parse: ' + (new Date().getTime() - __t4) + 'ms');

    var __tColResolve = _PROFILING ? new Date().getTime() : 0;

    var dateColTypes = _getDateColumnTypes(sheetName);
    var dateIdxList = [];
    for (var hj = 0; hj < header.length; hj++) {
      var t = dateColTypes[header[hj]];
      if (t === 'date' || t === 'datetime') {
        dateIdxList.push({ idx: hj, type: t, colName: header[hj] });
      }
    }
    var timeIdxList = [];
    if (values.length > 1) {
      var registered = {};
      dateIdxList.forEach(function (d) { registered[d.idx] = true; });
      for (var sj = 0; sj < header.length; sj++) {
        if (registered[sj]) continue;
        var sampleN = Math.min(values.length, 6);
        for (var sk = 1; sk < sampleN; sk++) {
          if (values[sk][sj] instanceof Date) {
            timeIdxList.push({ idx: sj, colName: header[sj] });
            break;
          }
        }
      }
    }
    var tz = Util.getTz();
    if (_PROFILING) Logger.log('  [_readAll ' + sheetName + '] col resolution + getTz: ' + (new Date().getTime() - __tColResolve) + 'ms (date_idx=' + dateIdxList.length + ', time_idx=' + timeIdxList.length + ')');

    var __tLoop = _PROFILING ? new Date().getTime() : 0;
    var __formatCount = 0;
    var __formatMs = 0;
    var rows = [];
    var headerLen = header.length;
    for (var i = 1; i < values.length; i++) {
      var rec = {};
      var row = values[i];
      for (var j = 0; j < headerLen; j++) {
        rec[header[j]] = row[j];
      }
      for (var di = 0; di < dateIdxList.length; di++) {
        var dInfo = dateIdxList[di];
        var dv = row[dInfo.idx];
        if (dv instanceof Date) {
          var __fT = _PROFILING ? new Date().getTime() : 0;
          rec[dInfo.colName] = (dInfo.type === 'date') ? Util.formatDate(dv) : Util.formatDateTime(dv);
          if (_PROFILING) { __formatCount++; __formatMs += new Date().getTime() - __fT; }
        }
      }
      for (var ti = 0; ti < timeIdxList.length; ti++) {
        var tInfo = timeIdxList[ti];
        var tv = row[tInfo.idx];
        if (tv instanceof Date) {
          var __fT2 = _PROFILING ? new Date().getTime() : 0;
          rec[tInfo.colName] = Utilities.formatDate(tv, tz, 'HH:mm');
          if (_PROFILING) { __formatCount++; __formatMs += new Date().getTime() - __fT2; }
        }
      }
      rec.__row = i + 1;
      rows.push(rec);
    }
    if (_PROFILING) Logger.log('  [_readAll ' + sheetName + '] row construction loop: ' + (new Date().getTime() - __tLoop) + 'ms (' + rows.length + ' rows, ' + __formatCount + ' format calls = ' + __formatMs + 'ms)');
    _cache[sheetName] = { sheet: sh, header: header, rows: rows, values: values };
    return _cache[sheetName];
  }

  function _invalidate(sheetName) {
    delete _cache[sheetName];
  }

  function flushCache() {
    _cache = {};
    _ssCache = null;
  }

  function _writeRowToSheet(sheetName, rowNumber, rec, header) {
    var sh = _getSheet(sheetName);
    var values = [header.map(function (col) {
      var v = rec[col];
      return (v === undefined || v === null) ? '' : v;
    })];
    sh.getRange(rowNumber, 1, 1, header.length).setValues(values);
  }

  function _appendRow(sheetName, rec, header) {
    var sh = _getSheet(sheetName);
    var values = header.map(function (col) {
      var v = rec[col];
      return (v === undefined || v === null) ? '' : v;
    });
    sh.appendRow(values);
    return sh.getLastRow();
  }

  function _nextId(sheetName) {
    var data = _readAll(sheetName);
    var maxId = 0;
    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      var n = parseInt(r.id, 10);
      if (!isNaN(n) && n > maxId) maxId = n;
    }
    return maxId + 1;
  }

  function find(sheetName, where, opts) {
    where = where || {};
    opts = opts || {};
    var __ft0 = _PROFILING ? new Date().getTime() : 0;
    if (_PROFILING) Logger.log('[find ' + sheetName + '] START');
    var schema = _schemaByName(sheetName);
    if (_PROFILING) Logger.log('  [find ' + sheetName + '] schema lookup: ' + (new Date().getTime() - __ft0) + 'ms');
    var __ft1 = _PROFILING ? new Date().getTime() : 0;
    var data = _readAll(sheetName);
    if (_PROFILING) Logger.log('  [find ' + sheetName + '] _readAll total: ' + (new Date().getTime() - __ft1) + 'ms');
    var __ft2 = _PROFILING ? new Date().getTime() : 0;
    var rows = data.rows.slice();
    if (_PROFILING) Logger.log('  [find ' + sheetName + '] rows.slice: ' + (new Date().getTime() - __ft2) + 'ms (' + rows.length + ' rows)');

    if (schema.softDelete && !opts.includeDeleted) {
      rows = rows.filter(function (r) { return !r.deleted_at; });
    }

    Object.keys(where).forEach(function (k) {
      if (k === '_where') {
        rows = rows.filter(where._where);
        return;
      }
      var v = where[k];
      if (Array.isArray(v)) {
        rows = rows.filter(function (r) { return v.indexOf(r[k]) !== -1; });
      } else {
        rows = rows.filter(function (r) {
          if (v === '' || v === null || v === undefined) {
            return r[k] === '' || r[k] === null || r[k] === undefined;
          }
          return String(r[k]) === String(v);
        });
      }
    });

    if (opts.sortBy) {
      var dir = (opts.sortDir === 'desc') ? -1 : 1;
      rows.sort(function (a, b) {
        var va = a[opts.sortBy];
        var vb = b[opts.sortBy];
        if (va == null) va = '';
        if (vb == null) vb = '';
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }

    if (opts.offset || opts.limit) {
      var off = opts.offset || 0;
      var lim = opts.limit || rows.length;
      rows = rows.slice(off, off + lim);
    }

    var __ftC = _PROFILING ? new Date().getTime() : 0;
    var cloned = rows.map(_clone);
    if (_PROFILING) Logger.log('  [find ' + sheetName + '] rows.map(_clone): ' + (new Date().getTime() - __ftC) + 'ms (' + cloned.length + ' rows)');
    if (_PROFILING) Logger.log('[find ' + sheetName + '] TOTAL: ' + (new Date().getTime() - __ft0) + 'ms');
    return cloned;
  }

  function findOne(sheetName, where, opts) {
    var rows = find(sheetName, where, Object.assign({ limit: 1 }, opts || {}));
    return rows[0] || null;
  }

  function findById(sheetName, id) {
    return findOne(sheetName, { id: id });
  }

  function count(sheetName, where, opts) {
    return find(sheetName, where, opts).length;
  }

  function insert(sheetName, payload) {
    return Lock.withLock(function () {
      var schema = _schemaByName(sheetName);
      var data = _readAll(sheetName);
      var header = data.header;
      var rec = Object.assign({}, payload);

      if (schema.hasId) {
        if (!rec.id) rec.id = _nextId(sheetName);
      }
      var now = Util.nowIso();
      if (schema.timestamps) {
        if (!rec.created_at) rec.created_at = now;
        if (!rec.updated_at) rec.updated_at = now;
      }

      schema.cols.forEach(function (col) {
        if (rec[col.name] !== undefined) {
          rec[col.name] = Util.normalizeValue(rec[col.name], col.type);
        }
      });

      _appendRow(sheetName, rec, header);
      _invalidate(sheetName);
      AuditLog.log('create', sheetName, rec.id || '', null, rec);
      return rec.id;
    });
  }

  function update(sheetName, id, partial) {
    return Lock.withLock(function () {
      var schema = _schemaByName(sheetName);
      var data = _readAll(sheetName);
      var header = data.header;
      var target = null;
      for (var i = 0; i < data.rows.length; i++) {
        if (String(data.rows[i].id) === String(id)) { target = data.rows[i]; break; }
      }
      if (!target) throw new Error(sheetName + ' id=' + id + ' が見つかりません');
      var before = _clone(target);

      var rec = Object.assign({}, target, partial);
      if (schema.timestamps) rec.updated_at = Util.nowIso();
      schema.cols.forEach(function (col) {
        if (rec[col.name] !== undefined) {
          rec[col.name] = Util.normalizeValue(rec[col.name], col.type);
        }
      });

      _writeRowToSheet(sheetName, target.__row, rec, header);
      _invalidate(sheetName);
      AuditLog.log('update', sheetName, id, before, rec);
      return id;
    });
  }

  function softDelete(sheetName, id) {
    return Lock.withLock(function () {
      var schema = _schemaByName(sheetName);
      if (!schema.softDelete) throw new Error(sheetName + ' は softDelete 非対応');
      return update(sheetName, id, { deleted_at: Util.nowIso() });
    });
  }

  function hardDelete(sheetName, id) {
    return Lock.withLock(function () {
      var data = _readAll(sheetName);
      var target = null;
      for (var i = 0; i < data.rows.length; i++) {
        if (String(data.rows[i].id) === String(id)) { target = data.rows[i]; break; }
      }
      if (!target) throw new Error(sheetName + ' id=' + id + ' が見つかりません');
      var sh = _getSheet(sheetName);
      sh.deleteRow(target.__row);
      _invalidate(sheetName);
      AuditLog.log('hardDelete', sheetName, id, target, null);
      return id;
    });
  }

  function bulkUpdate(sheetName, updates) {
    return Lock.withLock(function () {
      if (!updates || updates.length === 0) return [];
      var schema = _schemaByName(sheetName);
      var sh = _getSheet(sheetName);
      var lastRow = sh.getLastRow();
      var lastCol = sh.getLastColumn();
      if (lastRow <= 1) return [];
      var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
      var header = values[0].map(function (h) { return String(h).trim(); });
      var idCol = header.indexOf('id');
      var updCol = header.indexOf('updated_at');
      if (idCol < 0) throw new Error(sheetName + ': id 列が見つかりません');

      var patchById = {};
      updates.forEach(function (u) {
        if (u && u.id != null && u.partial) patchById[String(u.id)] = u.partial;
      });
      var colDefByName = {};
      schema.cols.forEach(function (c) { colDefByName[c.name] = c; });

      var now = Util.nowIso();
      var updated = [];
      for (var r = 1; r < values.length; r++) {
        var rowId = String(values[r][idCol]);
        var patch = patchById[rowId];
        if (!patch) continue;
        Object.keys(patch).forEach(function (col) {
          var ci = header.indexOf(col);
          if (ci < 0) return;
          var v = patch[col];
          var colDef = colDefByName[col];
          if (colDef) v = Util.normalizeValue(v, colDef.type);
          values[r][ci] = (v === undefined || v === null) ? '' : v;
        });
        if (updCol >= 0) values[r][updCol] = now;
        updated.push(rowId);
      }

      sh.getRange(1, 1, values.length, header.length).setValues(values);
      _invalidate(sheetName);
      return updated;
    });
  }

  function bulkSoftDelete(sheetName, ids) {
    return Lock.withLock(function () {
      if (!ids || ids.length === 0) return [];
      var schema = _schemaByName(sheetName);
      if (!schema.softDelete) throw new Error(sheetName + ' は softDelete 非対応');
      var sh = _getSheet(sheetName);
      var lastRow = sh.getLastRow();
      var lastCol = sh.getLastColumn();
      if (lastRow <= 1) return [];
      var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
      var header = values[0].map(function (h) { return String(h).trim(); });
      var idCol = header.indexOf('id');
      var delCol = header.indexOf('deleted_at');
      var updCol = header.indexOf('updated_at');
      if (idCol < 0) throw new Error(sheetName + ': id 列が見つかりません');
      if (delCol < 0) throw new Error(sheetName + ': deleted_at 列が見つかりません');
      var idSet = {};
      ids.forEach(function (i) { idSet[String(i)] = true; });
      var now = Util.nowIso();
      var deleted = [];
      for (var r = 1; r < values.length; r++) {
        if (idSet[String(values[r][idCol])]) {
          values[r][delCol] = now;
          if (updCol >= 0) values[r][updCol] = now;
          deleted.push(values[r][idCol]);
        }
      }
      sh.getRange(1, 1, values.length, header.length).setValues(values);
      _invalidate(sheetName);
      return deleted;
    });
  }

  function bulkHardDelete(sheetName, ids) {
    return Lock.withLock(function () {
      if (!ids || ids.length === 0) return 0;
      var data = _readAll(sheetName);
      var idSet = {};
      ids.forEach(function (i) { idSet[String(i)] = true; });
      var rowsToDelete = data.rows
        .filter(function (r) { return idSet[String(r.id)]; })
        .map(function (r) { return r.__row; })
        .sort(function (a, b) { return b - a; });
      if (rowsToDelete.length === 0) return 0;
      var sh = _getSheet(sheetName);
      var i = 0;
      while (i < rowsToDelete.length) {
        var end = rowsToDelete[i];
        var cnt = 1;
        while (i + cnt < rowsToDelete.length && rowsToDelete[i + cnt] === end - cnt) {
          cnt++;
        }
        var start = end - cnt + 1;
        sh.deleteRows(start, cnt);
        i += cnt;
      }
      _invalidate(sheetName);
      return rowsToDelete.length;
    });
  }

  function bulkInsert(sheetName, rows) {
    return Lock.withLock(function () {
      if (!rows || rows.length === 0) return [];
      var schema = _schemaByName(sheetName);
      var data = _readAll(sheetName);
      var header = data.header;
      var ids = [];
      var nextId = _nextId(sheetName);
      var now = Util.nowIso();
      var matrix = rows.map(function (payload) {
        var rec = Object.assign({}, payload);
        if (schema.hasId && !rec.id) rec.id = nextId++;
        if (schema.timestamps) {
          if (!rec.created_at) rec.created_at = now;
          if (!rec.updated_at) rec.updated_at = now;
        }
        schema.cols.forEach(function (col) {
          if (rec[col.name] !== undefined) {
            rec[col.name] = Util.normalizeValue(rec[col.name], col.type);
          }
        });
        ids.push(rec.id);
        return header.map(function (h) {
          var v = rec[h];
          return (v === undefined || v === null) ? '' : v;
        });
      });
      var sh = _getSheet(sheetName);
      var startRow = sh.getLastRow() + 1;
      sh.getRange(startRow, 1, matrix.length, header.length).setValues(matrix);
      _invalidate(sheetName);
      return ids;
    });
  }

  function ensureSchema() {
    return Lock.withLock(function () {
      var ss = _ss();
      var report = [];
      Schema.all().forEach(function (def) {
        var sh = ss.getSheetByName(def.name);
        if (!sh) {
          sh = ss.insertSheet(def.name);
          report.push('CREATED: ' + def.name);
        }
        var lastCol = Math.max(sh.getLastColumn(), 1);
        var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
        var expected = def.cols.map(function (c) { return c.name; });

        var same = (existing.length >= expected.length) &&
          expected.every(function (e, idx) { return existing[idx] === e; });
        if (!same) {
          if (sh.getLastRow() <= 1) {
            sh.clear();
            sh.getRange(1, 1, 1, expected.length).setValues([expected]);
            report.push('REWROTE HEADER: ' + def.name);
          } else {
            var missing = expected.filter(function (e) { return existing.indexOf(e) === -1; });
            if (missing.length) {
              sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
              report.push('APPENDED COLUMNS to ' + def.name + ': ' + missing.join(', '));
            }
          }
        }
        try { sh.setFrozenRows(1); } catch (e) {}
      });
      _cache = {};
      return report;
    });
  }

  function _clone(o) {
    var n = {};
    Object.keys(o).forEach(function (k) {
      if (k === '__row') return;
      n[k] = o[k];
    });
    return n;
  }

  function transaction(fn) {
    return Lock.withLock(function () {
      var result = fn();
      flushCache();
      return result;
    });
  }

  return {
    find: find,
    findOne: findOne,
    findById: findById,
    count: count,
    setProfiling: setProfiling,
    insert: insert,
    update: update,
    softDelete: softDelete,
    hardDelete: hardDelete,
    bulkInsert: bulkInsert,
    bulkUpdate: bulkUpdate,
    bulkSoftDelete: bulkSoftDelete,
    bulkHardDelete: bulkHardDelete,
    ensureSchema: ensureSchema,
    transaction: transaction,
    flushCache: flushCache,
    _readAll: _readAll
  };
})();
