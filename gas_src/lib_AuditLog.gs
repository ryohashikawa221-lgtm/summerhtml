/**
 * lib_AuditLog.gs
 * 変更ログを 'audit_log' シートに書き込む。
 * SheetDB が CRUD のたびに呼ぶ。差分のみ保存。
 *
 * 来歴: hoshuko_app より移植 (2026-05-03)、ターゲットシート名を
 *       '変更ログ' → 'audit_log' に変更 (HANDOFF 仕様)。
 */

const AuditLog = (function () {

  var TARGET_SHEET = 'audit_log';

  function log(action, sheetName, targetId, before, after) {
    try {
      var ss = _ss();
      var sh = ss.getSheetByName(TARGET_SHEET);
      if (!sh) return;
      var nextId = _nextId(sh);
      var ts = Utilities.formatDate(new Date(), _tz(), "yyyy-MM-dd'T'HH:mm:ssXXX");
      var user = (function () {
        try { return Session.getActiveUser().getEmail() || 'system'; } catch (e) { return 'system'; }
      })();
      var diff = _diff(before, after);
      sh.appendRow([
        nextId,
        ts,
        user,
        action,
        sheetName,
        String(targetId || ''),
        diff.before,
        diff.after,
        ''
      ]);
    } catch (e) {
      console.warn('AuditLog failed: ' + e.message);
    }
  }

  function _ss() {
    var env = (PropertiesService.getScriptProperties().getProperty('APP_ENV') || 'dev').toLowerCase();
    var key = env === 'prod' ? 'prod_spreadsheet_id' : 'dev_spreadsheet_id';
    var id = PropertiesService.getScriptProperties().getProperty(key);
    return SpreadsheetApp.openById(id);
  }

  function _tz() {
    return PropertiesService.getScriptProperties().getProperty('timezone') || 'America/Detroit';
  }

  function _nextId(sh) {
    var lastRow = sh.getLastRow();
    if (lastRow <= 1) return 1;
    var last = sh.getRange(lastRow, 1).getValue();
    var n = parseInt(last, 10);
    return isNaN(n) ? 1 : n + 1;
  }

  function _diff(before, after) {
    var b = {}, a = {};
    if (!before && !after) return { before: '', after: '' };
    if (!before) return { before: '', after: JSON.stringify(after) };
    if (!after) return { before: JSON.stringify(before), after: '' };
    Object.keys(after).forEach(function (k) {
      if (before[k] !== after[k]) {
        b[k] = before[k];
        a[k] = after[k];
      }
    });
    return { before: JSON.stringify(b), after: JSON.stringify(a) };
  }

  return {
    log: log
  };
})();
