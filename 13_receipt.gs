// 申込一覧シートの列インデックス（1-indexed）。ヘッダから動的取得。
function _getEnrollColumnMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { map[String(h)] = i + 1; });
  return { headers: headers, map: map };
}

// 「支払日」「領収書発行日」列がなければ追加
function _ensurePaymentColumns(sheet) {
  const { headers, map } = _getEnrollColumnMap(sheet);
  let lastCol = sheet.getLastColumn();
  let paidCol = map['支払日'] || 0;
  let receiptCol = map['領収書発行日'] || 0;
  if (!paidCol) {
    lastCol += 1;
    paidCol = lastCol;
    sheet.getRange(1, paidCol).setValue('支払日')
      .setBackground('#1b2a4a').setFontColor('#fff').setFontWeight('bold');
  }
  if (!receiptCol) {
    lastCol += 1;
    receiptCol = lastCol;
    sheet.getRange(1, receiptCol).setValue('領収書発行日')
      .setBackground('#1b2a4a').setFontColor('#fff').setFontWeight('bold');
  }
  return { paidCol: paidCol, receiptCol: receiptCol };
}

// 単一行の領収書発行
function sendReceiptForSelectedRow() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getName() !== S_ENROLL) {
    ui.alert('「' + S_ENROLL + '」シートで対象の行をクリックしてから実行してください');
    return;
  }
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('対象の申込行をクリックしてから実行してください');
    return;
  }
  _processReceiptRows(sheet, [row], ui);
}

// 複数選択行の領収書発行（範囲選択時に対応）
function sendReceiptForMultipleRows() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getName() !== S_ENROLL) {
    ui.alert('「' + S_ENROLL + '」シートで対象の行を選択してから実行してください');
    return;
  }
  const range = sheet.getActiveRange();
  const startRow = range.getRow();
  const numRows = range.getNumRows();
  const rows = [];
  for (let i = 0; i < numRows; i++) {
    const r = startRow + i;
    if (r >= 2) rows.push(r);
  }
  if (rows.length === 0) {
    ui.alert('対象の申込行を選択してください');
    return;
  }
  _processReceiptRows(sheet, rows, ui);
}

// 領収書発行の共通処理
function _processReceiptRows(sheet, rows, ui) {
  const { headers, map } = _getEnrollColumnMap(sheet);
  const colId = map['申込ID'];
  const colParent = map['保護者名'];
  const colEmail = map['メール'];
  const colStudents = map['生徒情報'];
  const colCourses = map['講座詳細'];
  const colTotal = map['合計金額'];

  if (!colParent || !colEmail || !colTotal) {
    ui.alert('申込一覧シートのヘッダ（保護者名/メール/合計金額）が見つかりません。');
    return;
  }

  const { paidCol, receiptCol } = _ensurePaymentColumns(sheet);

  // 確認ダイアログ
  const previews = rows.map(row => {
    const data = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    return '行' + row + ': ' + (data[colParent - 1] || '?') + ' / ' + (data[colTotal - 1] || '?');
  }).join('\n');
  const confirmation = ui.alert(
    '領収書発行確認',
    rows.length + ' 件の申込に領収書を発行・送信します。\n\n' + previews + '\n\nよろしいですか？',
    ui.ButtonSet.YES_NO
  );
  if (confirmation !== ui.Button.YES) return;

  let success = 0, fail = 0;
  const errors = [];
  rows.forEach(row => {
    try {
      const data = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
      const enroll = {
        id: colId ? data[colId - 1] : '',
        parent_name: data[colParent - 1] || '',
        email: data[colEmail - 1] || '',
        students_info: colStudents ? data[colStudents - 1] : '',
        courses_text: colCourses ? data[colCourses - 1] : '',
        total: data[colTotal - 1] || ''
      };

      if (!enroll.email || !enroll.parent_name) {
        throw new Error('保護者名またはメールアドレスが空');
      }

      sendReceiptEmail(enroll);

      // 記録
      const today = new Date().toLocaleDateString('ja-JP');
      sheet.getRange(row, paidCol).setValue(today);
      sheet.getRange(row, receiptCol).setValue(today);

      success++;
      Utilities.sleep(800); // メール送信制限対策
    } catch (e) {
      fail++;
      errors.push('行' + row + ': ' + (e && e.message));
    }
  });

  let msg = '✅ ' + success + ' 件の領収書を発行・送信しました';
  if (fail > 0) {
    msg += '\n\n❌ ' + fail + ' 件失敗:\n' + errors.join('\n');
  }
  ui.alert(msg);
}

// 領収書メール送信（HTML本文）
function sendReceiptEmail(enroll) {
  const subject = '【領収書 / Receipt】サマースクール - ' + enroll.parent_name + ' 様';
  const html = _buildReceiptEmailHtml(enroll);
  const text = enroll.parent_name + ' 様\n\n受講料のご入金を確認いたしました。誠にありがとうございました。\n以下の通り、領収書を発行いたします。\n\n金額：' + enroll.total + '\n但し：2026年度サマースクール受講料として\n\n--\n' + SCHOOL_NAME + '\nTEL: 248-349-5234';

  const r = _safeSendEmail(enroll.email, subject, text, {
    name: SCHOOL_NAME,
    htmlBody: html
  });
  if (!r.ok) throw new Error(r.message || '領収書メール送信に失敗');
}

// 領収書HTMLメール本文生成
function _buildReceiptEmailHtml(enroll) {
  const navy = '#1b2a4a';
  const gold = '#c9a84c';
  const today = new Date().toLocaleDateString('ja-JP');
  const receiptNo = 'R26-' + Date.now().toString().slice(-8);

  return '' +
'<div style="font-family:\'Hiragino Kaku Gothic Pro\',\'Yu Gothic\',sans-serif;max-width:640px;margin:0 auto;color:#333;line-height:1.7">' +
  '<div style="background:' + navy + ';color:#fff;padding:20px 24px;border-bottom:4px solid ' + gold + '">' +
    '<div style="font-size:18px;font-weight:700;letter-spacing:.05em">駿台ミシガン国際学院</div>' +
    '<div style="font-size:12px;opacity:.85;margin-top:2px">2026 Summer School / 領収書 Receipt</div>' +
  '</div>' +
  '<div style="padding:20px 24px;background:#fff">' +
    '<p style="margin:0 0 14px">' + _esc(enroll.parent_name) + ' 様</p>' +
    '<p style="margin:0 0 14px">受講料のご入金を確認いたしました。誠にありがとうございました。<br>下記の通り、正式に領収いたします。</p>' +
    '<div style="background:#faf8f3;border-left:3px solid ' + gold + ';padding:10px 14px;margin:14px 0">' +
      '<div style="font-size:11px;color:#888">発行日 / Date</div>' +
      '<div style="font-size:13px;color:' + navy + ';font-weight:700">' + _esc(today) + '</div>' +
      '<div style="font-size:11px;color:#888;margin-top:6px">領収書No</div>' +
      '<div style="font-size:13px;color:' + navy + ';font-weight:700;font-family:Georgia,serif">' + _esc(receiptNo) + '</div>' +
    '</div>' +
    '<div style="border:2px solid ' + navy + ';padding:18px 22px;margin:14px 0;background:#fff7e0">' +
      '<div style="font-size:11px;color:#666;letter-spacing:.1em;margin-bottom:6px">領収金額 / Amount Received</div>' +
      '<div style="font-size:30px;font-family:Georgia,serif;color:' + gold + ';font-weight:700;text-align:center">' + _esc(enroll.total) + '</div>' +
      '<div style="font-size:11px;color:#444;text-align:center;margin-top:8px;border-top:1px solid #ccc;padding-top:8px">但し: 2026年度サマースクール受講料として / Summer School 2026 Tuition Fee</div>' +
    '</div>' +
    (enroll.students_info ?
      '<div style="margin:14px 0 6px;font-size:13px;color:' + navy + ';font-weight:700;border-bottom:1px solid ' + navy + ';padding-bottom:4px">受講生徒 / Students</div>' +
      '<div style="font-size:12px;line-height:1.8">' + _esc(enroll.students_info) + '</div>'
    : '') +
    '<div style="margin:18px 0 6px;font-size:13px;color:' + navy + ';font-weight:700;border-bottom:1px solid ' + navy + ';padding-bottom:4px">受講内容 / Details</div>' +
    '<div style="font-size:11px;line-height:1.7;white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:10px 12px;border-radius:3px">' + _nl2br(enroll.courses_text || '') + '</div>' +
    '<div style="margin:24px 0 8px;padding:10px 14px;background:#f5f5f5;border-radius:3px;font-size:11px;color:#555;line-height:1.7">' +
      '本書面をもちまして正式な領収書とさせていただきます。<br>' +
      'お問い合わせは下記までご連絡ください。' +
    '</div>' +
  '</div>' +
  '<div style="background:' + navy + ';color:#fff;padding:14px 24px;font-size:11px;line-height:1.8">' +
    '<div style="font-weight:700;font-size:13px;margin-bottom:4px">' + _esc(SCHOOL_NAME) + '</div>' +
    'TEL: 248-349-5234 / Email: ' + _esc(ZELLE_RECIPIENT_EMAIL) +
  '</div>' +
'</div>';
}

// ============================================================
// 講座別名簿出力
// ============================================================
