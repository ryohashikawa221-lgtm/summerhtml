// ============================================================
// 申込データ検証
// ============================================================
function _validateEnrollment(d) {
  if (!d || typeof d !== 'object') return 'データ形式が不正です';
  if (!d.parent_name || !String(d.parent_name).trim()) return '保護者名は必須です';
  if (!_validString(d.parent_name, 200))   return '保護者名が長すぎます';
  if (!_validEmail(d.reply_to))            return 'メールアドレスの形式が不正です';
  if (!_validString(d.reply_to, 200))      return 'メールアドレスが長すぎます';
  if (!_validString(d.phone, 100))         return '電話番号が長すぎます';
  if (!_validString(d.students_info, 2000)) return '生徒情報が長すぎます';
  if (!_validString(d.courses, 20000))     return '講座詳細が長すぎます';
  if (!_validString(d.note, 5000))         return '備考が長すぎます';
  if (!_validString(d.total, 200))         return '合計金額の形式が不正です';
  if (!_validString(d.submit_date, 100))   return '申込日の形式が不正です';
  return null;
}

function _validateRequest(d) {
  if (!d || typeof d !== 'object') return 'データ形式が不正です';
  if (!d.parent_name || !String(d.parent_name).trim()) return '保護者名は必須です';
  if (!_validString(d.parent_name, 200)) return '保護者名が長すぎます';
  if (!_validEmail(d.reply_to))          return 'メールアドレスの形式が不正です';
  if (!_validString(d.reply_to, 200))    return 'メールアドレスが長すぎます';
  if (!_validString(d.courses, 20000))   return 'リクエスト内容が長すぎます';
  return null;
}

// ============================================================
// 申込をスプレッドシートに保存
// ============================================================
function saveEnrollment(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_ENROLL);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ENROLL);
    sheet.appendRow(['申込ID','申込日時','保護者名','メール','電話','生徒情報','講座詳細','合計金額','備考','申込番号']);
    sheet.getRange(1,1,1,10).setBackground('#1b2a4a').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  // 二重申込検知（Phase U-3-A 1-1）
  const dupResult = _detectDuplicate(sheet, d);
  if (dupResult.isDuplicate) {
    d._duplicateWarning = dupResult.warning;
  }
  const enrollId = 'E' + new Date().getTime() + '-' + Utilities.getUuid().slice(0, 4);
  // 申込番号 (Phase U-3-B マイページ照会用)
  d._appNumber = _generateAppNumber(sheet);
  // 「申込番号」列が無ければ自動追加
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let appNumCol = headers.indexOf('申込番号') + 1;
  if (appNumCol === 0) {
    appNumCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, appNumCol).setValue('申込番号')
      .setBackground('#1b2a4a').setFontColor('#fff').setFontWeight('bold');
  }
  // 「送信」列 (領収書送信フラグ) が col A に存在する場合は先頭に false を追加
  // (migrateAddReceiptCheckboxColumn 実行後の構造に対応)
  const baseRow = [
    enrollId,
    new Date().toLocaleString('ja-JP'),
    d.parent_name, d.reply_to, d.phone || '',
    d.students_info, d.courses, d.total, d.note || ''
  ];
  const hasSendCol = headers.indexOf('送信') === 0;
  if (hasSendCol) {
    sheet.appendRow([false].concat(baseRow));
  } else {
    sheet.appendRow(baseRow);
  }
  const newRow = sheet.getLastRow();
  sheet.getRange(newRow, appNumCol).setValue(d._appNumber);
  // 送信列をチェックボックス化 (新規行にも DataValidation 適用)
  if (hasSendCol) {
    var sendRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sheet.getRange(newRow, 1).setDataValidation(sendRule);
  }
  // SpreadsheetApp.flush() で書き込み確定（Phase U-3-A 1-3 (C)）
  SpreadsheetApp.flush();
  if (d.course_counts) updateCourseCounts(d.course_counts);
}


// ============================================================
// 二重申込検知・申込番号採番
// ============================================================
function _detectDuplicate(sheet, d) {
  try {
    if (!d || !d.reply_to || sheet.getLastRow() < 2) return { isDuplicate: false };
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colTs = headers.indexOf('申込日時');
    const colEmail = headers.indexOf('メール');
    const colStudents = headers.indexOf('生徒情報');
    if (colTs < 0 || colEmail < 0) return { isDuplicate: false };

    // 入力された生徒名から、生徒の名前文字列を抽出（"山田 太郎（小3）" 形式）
    const newStudents = String(d.students_info || '').split('、')
      .map(s => s.replace(/（[^）]*）/g, '').trim())
      .filter(Boolean);

    const now = Date.now();
    const tenMinAgo = now - 10 * 60 * 1000;

    for (let i = data.length - 1; i >= 1; i--) {
      const r = data[i];
      const tsRaw = r[colTs];
      const tsMs = tsRaw instanceof Date ? tsRaw.getTime() : Date.parse(String(tsRaw));
      if (!isFinite(tsMs)) continue;
      // 古いデータは早期break（最新→過去なので安全）
      if (tsMs < tenMinAgo) break;
      // メール一致チェック
      const rowEmail = String(r[colEmail] || '').trim().toLowerCase();
      if (rowEmail !== String(d.reply_to).trim().toLowerCase()) continue;
      // 生徒名重複チェック
      if (colStudents >= 0) {
        const rowStudents = String(r[colStudents] || '').split('、')
          .map(s => s.replace(/（[^）]*）/g, '').trim())
          .filter(Boolean);
        const overlap = newStudents.filter(n => rowStudents.includes(n));
        if (overlap.length === 0) continue;
      }
      // 重複検知
      const tsStr = tsRaw instanceof Date ? tsRaw.toLocaleString('ja-JP') : String(tsRaw);
      return {
        isDuplicate: true,
        warning: '⚠️ 重複申込の可能性あり — 既存申込: 行' + (i + 1) + ' (' + tsStr + ')'
      };
    }
    return { isDuplicate: false };
  } catch (e) {
    console.error('_detectDuplicate error:', e && e.message);
    return { isDuplicate: false };
  }
}

// ============================================================
// 申込番号採番（Phase U-3-B で利用するため、ここでベース実装のみ）
// フォーマット: SS26-NNNN-XXX (連番4桁 + ランダム3文字)
// ============================================================
function _generateAppNumber(sheet) {
  const seq = sheet.getLastRow(); // ヘッダ行を含むため、行2 = 0001 になるよう調整
  const seqStr = String(seq).padStart(4, '0');
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 0/O/1/I/L除外
  let rnd = '';
  for (let i = 0; i < 3; i++) rnd += chars[Math.floor(Math.random() * chars.length)];
  return 'SS26-' + seqStr + '-' + rnd;
}
