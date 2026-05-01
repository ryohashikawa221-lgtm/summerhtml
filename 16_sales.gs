// ============================================================
// 売上一覧シート出力（申込一覧から動的生成）
// 上部: 集計サマリ（申込件数/総額/入金済/未入金/月別/支払方法別）
// 下部: 申込ごとの明細（合計金額・支払日・支払方法・領収書発行日・ステータス）
// silent=true でアラート抑止（onChangeトリガーから呼ぶ）
// ============================================================
function outputSalesReport(silent) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const enrollSheet = ss.getSheetByName(S_ENROLL);
  if (!enrollSheet || enrollSheet.getLastRow() < 2) {
    if (!silent) SpreadsheetApp.getUi().alert('申込データがありません');
    return;
  }

  const data = enrollSheet.getDataRange().getValues();
  const headers = data[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h)] = i; });

  const cTs       = idx['申込日時'];
  const cAppNum   = idx['申込番号'];
  const cParent   = idx['保護者名'];
  const cEmail    = idx['メール'];
  const cStudents = idx['生徒情報'];
  const cTotal    = idx['合計金額'];
  const cPaid     = idx['支払日'];
  const cReceipt  = idx['領収書発行日'];
  const cMethod   = idx['支払方法']; // 任意（無い環境もある）

  const rows = [];
  let totalAmount = 0, paidAmount = 0, unpaidAmount = 0;
  let paidCount = 0, unpaidCount = 0;
  const monthly = {};
  const methods = {};

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if ((!r[cParent] && !r[cEmail])) continue;

    const totalRaw = String(r[cTotal] != null ? r[cTotal] : '');
    const total = parseFloat(totalRaw.replace(/[$,\s]/g, '')) || 0;

    const paidRaw = cPaid !== undefined ? r[cPaid] : '';
    const paidStr = paidRaw instanceof Date
      ? paidRaw.toLocaleDateString('ja-JP')
      : (paidRaw ? String(paidRaw) : '');
    const isPaid = !!paidStr;

    const tsRaw = cTs !== undefined ? r[cTs] : '';
    const tsDate = tsRaw instanceof Date ? tsRaw : (tsRaw ? new Date(tsRaw) : null);
    const tsStr = tsDate && isFinite(tsDate.getTime())
      ? Utilities.formatDate(tsDate, Session.getScriptTimeZone() || 'America/Detroit', 'yyyy/MM/dd')
      : '';

    const receiptRaw = cReceipt !== undefined ? r[cReceipt] : '';
    const receiptStr = receiptRaw instanceof Date
      ? receiptRaw.toLocaleDateString('ja-JP')
      : (receiptRaw ? String(receiptRaw) : '');

    const method = cMethod !== undefined ? String(r[cMethod] || '') : '';

    rows.push({
      ts: tsStr,
      appNum: String(r[cAppNum] || ''),
      parent: String(r[cParent] || ''),
      students: String(r[cStudents] || ''),
      total: total,
      paidDate: paidStr,
      method: method,
      receiptDate: receiptStr,
      status: isPaid ? '✅ 入金済み' : '⏳ 未入金'
    });

    totalAmount += total;
    if (isPaid) {
      paidAmount += total;
      paidCount++;
      // 支払月別（支払日ベース）
      const pDate = paidRaw instanceof Date ? paidRaw : (paidRaw ? new Date(paidRaw) : null);
      if (pDate && isFinite(pDate.getTime())) {
        const ym = Utilities.formatDate(pDate, Session.getScriptTimeZone() || 'America/Detroit', 'yyyy-MM');
        monthly[ym] = (monthly[ym] || 0) + total;
      }
      const mKey = method || '不明';
      methods[mKey] = (methods[mKey] || 0) + total;
    } else {
      unpaidAmount += total;
      unpaidCount++;
    }
  }

  // 出力シート（既存があれば削除して再生成）
  let out = ss.getSheetByName(S_SALES);
  if (out) ss.deleteSheet(out);
  out = ss.insertSheet(S_SALES);

  const COLS = 9; // 列数
  let row = 1;

  // タイトル
  out.getRange(row, 1).setValue('💰 売上一覧（出力: ' + new Date().toLocaleString('ja-JP') + '）');
  out.getRange(row, 1, 1, COLS).merge()
    .setBackground('#1b2a4a').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(13);
  row++;

  // サマリ1行目
  out.getRange(row, 1, 1, COLS).setValues([[
    '申込件数: ' + rows.length + '件',
    '', '',
    '申込総額: $' + totalAmount.toFixed(0),
    '', '', '', '', ''
  ]]);
  out.getRange(row, 1, 1, 3).merge();
  out.getRange(row, 4, 1, 6).merge();
  out.getRange(row, 1, 1, COLS).setBackground('#c9a84c').setFontColor('#1b2a4a').setFontWeight('bold');
  row++;

  // サマリ2行目（入金済 / 未入金）
  out.getRange(row, 1, 1, COLS).setValues([[
    '✅ 入金済み: ' + paidCount + '件 / $' + paidAmount.toFixed(0),
    '', '', '',
    '⏳ 未入金: ' + unpaidCount + '件 / $' + unpaidAmount.toFixed(0),
    '', '', '', ''
  ]]);
  out.getRange(row, 1, 1, 4).merge();
  out.getRange(row, 5, 1, 5).merge();
  out.getRange(row, 1, 1, COLS).setBackground('#fff7e0').setFontWeight('bold');
  row += 2;

  // 月別売上
  if (Object.keys(monthly).length > 0) {
    out.getRange(row, 1).setValue('📅 月別売上（支払日ベース・入金済のみ）');
    out.getRange(row, 1, 1, COLS).merge()
      .setBackground('#243860').setFontColor('#fff').setFontWeight('bold');
    row++;
    Object.keys(monthly).sort().forEach(ym => {
      out.getRange(row, 1).setValue('  ' + ym + ' : $' + monthly[ym].toFixed(0));
      out.getRange(row, 1, 1, COLS).merge();
      row++;
    });
    row++;
  }

  // 支払方法別
  if (Object.keys(methods).length > 0) {
    out.getRange(row, 1).setValue('💳 支払方法別（入金済のみ）');
    out.getRange(row, 1, 1, COLS).merge()
      .setBackground('#243860').setFontColor('#fff').setFontWeight('bold');
    row++;
    Object.keys(methods).sort().forEach(m => {
      out.getRange(row, 1).setValue('  ' + (m || '不明') + ' : $' + methods[m].toFixed(0));
      out.getRange(row, 1, 1, COLS).merge();
      row++;
    });
    row++;
  }

  // 明細ヘッダ
  out.getRange(row, 1, 1, COLS).setValues([[
    '申込日', '申込番号', '保護者名', '生徒名', '合計金額', '支払日', '支払方法', '領収書発行日', 'ステータス'
  ]]);
  out.getRange(row, 1, 1, COLS)
    .setBackground('#1b2a4a').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(10);
  out.setFrozenRows(row);
  row++;

  // 明細行（申込日新しい順にソート）
  rows.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  rows.forEach(r => {
    out.getRange(row, 1, 1, COLS).setValues([[
      r.ts, r.appNum, r.parent, r.students,
      '$' + r.total.toFixed(0),
      r.paidDate, r.method, r.receiptDate, r.status
    ]]);
    if (r.status.indexOf('未入金') >= 0) {
      out.getRange(row, 1, 1, COLS).setBackground('#fff7ed');
    } else {
      out.getRange(row, 1, 1, COLS).setBackground('#f0fdf4');
    }
    out.getRange(row, 1, 1, COLS).setFontSize(10);
    row++;
  });

  // 列幅
  const widths = [85, 130, 110, 200, 75, 85, 85, 100, 85];
  widths.forEach((w, i) => out.setColumnWidth(i + 1, w));

  ss.setActiveSheet(out);
  if (!silent) SpreadsheetApp.getUi().alert('✅ 売上一覧を出力しました');
}
