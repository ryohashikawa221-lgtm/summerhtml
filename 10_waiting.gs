function addWaitingEntry(data) {
  try {
    if (!_rateLimitOk('waiting_run', 200)) {
      return { status: 'error', message: '本日の受付上限に達しました。' };
    }
    if (!data || !data.parent_name || !data.email || !data.course_id) {
      return { status: 'error', message: '必須項目が不足しています' };
    }
    if (!_validString(data.parent_name, 200)) return { status: 'error', message: '保護者名が長すぎます' };
    if (!_validEmail(data.email))             return { status: 'error', message: 'メールアドレスの形式が不正です' };
    if (!_validString(data.student_name, 200)) return { status: 'error', message: '生徒名が長すぎます' };
    if (!_validString(data.course_id, 100))    return { status: 'error', message: '講座IDが不正です' };
    if (!_validString(data.course_label, 200)) return { status: 'error', message: '講座名が長すぎます' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(S_WAITING);
    if (!sheet) {
      sheet = ss.insertSheet(S_WAITING);
      sheet.appendRow(['申込ID','登録日時','講座ID','講座名','生徒名','学年','保護者名','メール','電話','備考','ステータス']);
      sheet.getRange(1,1,1,11).setBackground('#1b2a4a').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    const waitId = 'W' + new Date().getTime() + '-' + Utilities.getUuid().slice(0, 4);
    sheet.appendRow([
      waitId,
      new Date().toLocaleString('ja-JP'),
      data.course_id,
      data.course_label || '',
      data.student_name || '',
      data.student_grade || '',
      data.parent_name,
      data.email,
      data.phone || '',
      data.note || '',
      '待機'
    ]);

    // 学校への通知メール
    const subject = '【ウェイティング登録】' + data.course_label + ' - ' + data.parent_name + ' 様';
    const body =
      'ウェイティングリストに登録がありました。\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '講座: ' + data.course_label + ' (' + data.course_id + ')\n' +
      '生徒: ' + data.student_name + ' (' + data.student_grade + ')\n' +
      '保護者: ' + data.parent_name + '\n' +
      'メール: ' + data.email + '\n' +
      '電話: ' + (data.phone || '未入力') + '\n' +
      '備考: ' + (data.note || 'なし') + '\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      'キャンセル発生時は手動で連絡してください。\n' + SCHOOL_NAME;
    _safeSendEmail(SCHOOL_EMAIL, subject, body, { replyTo: data.email, name: SCHOOL_NAME });

    // 保護者への自動返信
    _safeSendEmail(data.email,
      '【ウェイティング受付】サマースクール - ' + data.parent_name + ' 様',
      data.parent_name + ' 様\n\n' +
      'ウェイティングリストへのご登録ありがとうございます。\n' +
      '下記の講座にてキャンセルが発生した際、学校から個別にご連絡いたします。\n\n' +
      '■ 登録内容\n' +
      '講座: ' + data.course_label + '\n' +
      '生徒: ' + data.student_name + ' (' + data.student_grade + ')\n\n' +
      'ご連絡をお待ちください。\n\n' + SCHOOL_NAME + '\nTEL: 248-349-5234',
      { name: SCHOOL_NAME });

    return { status: 'ok', wait_id: waitId };
  } catch (err) {
    console.error(err);
    return { status: 'error', message: 'サーバーエラーが発生しました' };
  }
}

// ============================================================
// F: 未払いリスト取得（管理画面用）
// ============================================================
