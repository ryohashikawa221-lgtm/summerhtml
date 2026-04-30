// ============================================================
// _safeSendEmail（Phase U-3-A 1-2: Gmail送信クォータ対策）
// 全てのメール送信で使う共通関数。クォータチェック + try-catch + 申込一覧へのステータス記録
// ============================================================
let _quotaAlertSentToday = false; // 同日内のアラート重複送信防止

function _safeSendEmail(to, subject, body, options) {
  options = options || {};
  // クォータ確認
  let remaining = 100;
  try { remaining = MailApp.getRemainingDailyQuota(); } catch (e) {}

  // 残りが10以下になったら学校宛にアラート（最後の1通を使う価値あり）
  if (remaining < 10) {
    if (!_quotaAlertSentToday) {
      _quotaAlertSentToday = true;
      try {
        // 直接 GmailApp で送る（_safeSendEmail を再帰的に呼ばない）
        GmailApp.sendEmail(SCHOOL_EMAIL,
          '【⚠️ Gmailクォータ警告】サマースクール申込システム',
          '本日のメール送信クォータが残り ' + remaining + ' 件になりました。\n' +
          '一部の通知メールが送信されない可能性があります。\n\n' +
          '申込一覧シートの「メール送信ステータス」列で「未送信(クォータ)」をご確認ください。\n' +
          'メニュー「📧 未送信メール再送」で翌日以降に再送できます。\n\n' +
          SCHOOL_NAME,
          { name: SCHOOL_NAME }
        );
      } catch (e) {}
    }
    return { ok: false, reason: 'quota', message: '送信クォータ不足（残り ' + remaining + '）' };
  }

  // 送信実行
  try {
    GmailApp.sendEmail(to, subject, body, options);
    return { ok: true };
  } catch (e) {
    console.error('_safeSendEmail failed:', e && e.message);
    return { ok: false, reason: 'error', message: String(e && e.message) };
  }
}

// 申込一覧シートに「メール送信ステータス」列を確保し、指定行のステータスを記録
function _recordEmailStatus(sheet, row, status) {
  try {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let col = headers.indexOf('メール送信ステータス') + 1;
    if (col === 0) {
      col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue('メール送信ステータス')
        .setBackground('#1b2a4a').setFontColor('#fff').setFontWeight('bold');
    }
    if (row >= 2) sheet.getRange(row, col).setValue(status);
  } catch (e) {
    console.error('_recordEmailStatus error:', e && e.message);
  }
}

// ============================================================
// 未送信メール再送（メニューから手動実行）
// ============================================================
function resendFailedEmails() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(S_ENROLL);
  if (!sheet) {
    ui.alert('「' + S_ENROLL + '」シートが見つかりません');
    return;
  }
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    ui.alert('再送対象がありません');
    return;
  }
  const headers = data[0];
  const colStatus = headers.indexOf('メール送信ステータス');
  const colParent = headers.indexOf('保護者名');
  const colEmail = headers.indexOf('メール');
  const colTotal = headers.indexOf('合計金額');
  const colStudents = headers.indexOf('生徒情報');
  const colCourses = headers.indexOf('講座詳細');
  const colNote = headers.indexOf('備考');
  if (colStatus < 0) {
    ui.alert('「メール送信ステータス」列が見つかりません。\n申込が一度でも実施されると自動で追加されます。');
    return;
  }
  const targets = [];
  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][colStatus] || '');
    if (status.indexOf('未送信') === 0) targets.push(i + 1); // 1-indexed
  }
  if (targets.length === 0) {
    ui.alert('再送対象（未送信）の行はありません');
    return;
  }
  if (ui.alert('再送確認', targets.length + ' 件の未送信メールを再送します。よろしいですか?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  // クォータ確認
  let remaining = 100;
  try { remaining = MailApp.getRemainingDailyQuota(); } catch (e) {}
  if (remaining < targets.length + 5) {
    if (ui.alert('クォータ警告', '本日の送信可能件数: ' + remaining + ' 件\n対象: ' + targets.length + ' 件\n\n途中で止まる可能性があります。続行しますか？', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  }

  let success = 0, fail = 0;
  _quotaAlertSentToday = false;
  targets.forEach(row => {
    const r = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    const enrollData = {
      parent_name: colParent >= 0 ? r[colParent] : '',
      reply_to: colEmail >= 0 ? r[colEmail] : '',
      students_info: colStudents >= 0 ? r[colStudents] : '',
      courses: colCourses >= 0 ? r[colCourses] : '',
      total: colTotal >= 0 ? r[colTotal] : '',
      note: colNote >= 0 ? r[colNote] : ''
    };
    if (!enrollData.reply_to) {
      _recordEmailStatus(sheet, row, '未送信(エラー): メールアドレス空');
      fail++;
      return;
    }
    try {
      // 簡易的な再送メール（保護者宛のみ）
      const subject = '【申込受付】サマースクール - ' + enrollData.parent_name + ' 様';
      const body = enrollData.parent_name + ' 様\n\n申込内容を再送いたします。\n\n' +
        '■ 生徒情報\n' + enrollData.students_info + '\n\n' +
        '■ 選択講座\n' + enrollData.courses + '\n\n' +
        '■ 合計金額：' + enrollData.total + '\n\n' +
        SCHOOL_NAME + '\nTEL: 248-349-5234';
      const r2 = _safeSendEmail(enrollData.reply_to, subject, body, { name: SCHOOL_NAME });
      if (r2.ok) {
        _recordEmailStatus(sheet, row, '送信済み(再送 ' + new Date().toLocaleString('ja-JP') + ')');
        success++;
      } else {
        _recordEmailStatus(sheet, row, '未送信(' + r2.reason + '): ' + (r2.message || ''));
        fail++;
      }
      Utilities.sleep(800);
    } catch (e) {
      _recordEmailStatus(sheet, row, '未送信(エラー): ' + (e && e.message));
      fail++;
    }
  });
  SpreadsheetApp.flush();
  ui.alert('再送完了', '✅ 成功: ' + success + ' 件\n❌ 失敗: ' + fail + ' 件', ui.ButtonSet.OK);
}

