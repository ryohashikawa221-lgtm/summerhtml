// =====================================================================================
// 領収書送信フロー migration (2026-05-01 追加)
// 申込一覧 sheet の A 列に「送信」(領収書送信フラグ) チェックボックス列を追加。
// 領収書発行済み行をグレーアウトする条件付き書式も同時設定。
// 一度実行すれば OK (idempotent: 何度実行しても安全)。
// =====================================================================================
function migrateAddReceiptCheckboxColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ENROLL);
  if (!sh) throw new Error(SHEET_ENROLL + ' sheet が見つかりません。先に申込が 1 件入って sheet が作成されている必要があります。');

  var lastCol = Math.max(1, sh.getLastColumn());
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var existingIdx = headers.indexOf('送信');  // 0-based

  if (existingIdx === 0) {
    // 既に col 1 に「送信」あり → DataValidation 再適用のみ
    if (sh.getLastRow() > 1) {
      var rule0 = SpreadsheetApp.newDataValidation().requireCheckbox().build();
      sh.getRange(2, 1, sh.getLastRow() - 1, 1).setDataValidation(rule0);
    }
    _addReceiptIssuedConditionalFormat(sh);
    Logger.log('=== migrateAddReceiptCheckboxColumn 完了 (既存) ===');
    return { added: false, column: 1, rowCount: sh.getLastRow() - 1 };
  }

  // 別位置に「送信」列がある場合は削除
  if (existingIdx > 0) {
    sh.deleteColumn(existingIdx + 1);
  }

  // col 1 の前に新列を挿入
  sh.insertColumnBefore(1);
  sh.getRange(1, 1).setValue('送信')
    .setBackground('#1b2a4a').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center');
  sh.setColumnWidth(1, 60);

  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var n = lastRow - 1;
    var values = [];
    for (var i = 0; i < n; i++) values.push([false]);
    sh.getRange(2, 1, n, 1).setValues(values);
    var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sh.getRange(2, 1, n, 1).setDataValidation(rule);
  }

  _addReceiptIssuedConditionalFormat(sh);

  Logger.log('=== migrateAddReceiptCheckboxColumn 完了 ===');
  Logger.log('「送信」列を col 1 (A) に追加。' + (lastRow - 1) + ' 行を FALSE で初期化。条件付き書式適用。');
  return { added: true, column: 1, rowCount: lastRow - 1 };
}

// 領収書発行済み行をグレーアウトする条件付き書式を追加 (idempotent)
function _addReceiptIssuedConditionalFormat(sh) {
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var receiptCol = headers.indexOf('領収書発行日') + 1;
  if (receiptCol < 1) return;  // 列無しなら skip (送信時に作成される)

  var lastRow = Math.max(sh.getLastRow(), 200);
  var range = sh.getRange(2, 1, lastRow - 1, lastCol);

  // 列番号 → A1 表記
  var colLetter = '';
  var n = receiptCol;
  while (n > 0) { var r = (n - 1) % 26; colLetter = String.fromCharCode(65 + r) + colLetter; n = Math.floor((n - 1) / 26); }
  var marker = '__RECEIPT_ISSUED__';
  var formula = '=AND($' + colLetter + '2<>"", "' + marker + '"="' + marker + '")';

  // 既存 rule に同マーカーが含まれていれば置換、無ければ追加
  var rules = sh.getConditionalFormatRules();
  var newRules = rules.filter(function(rule) {
    var cond = rule.getBooleanCondition();
    if (!cond) return true;
    var values = cond.getCriteriaValues() || [];
    for (var i = 0; i < values.length; i++) {
      if (String(values[i]).indexOf(marker) >= 0) return false;
    }
    return true;
  });
  var newRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground('#f0f0f0')
    .setFontColor('#999999')
    .setRanges([range])
    .build();
  newRules.push(newRule);
  sh.setConditionalFormatRules(newRules);
}
