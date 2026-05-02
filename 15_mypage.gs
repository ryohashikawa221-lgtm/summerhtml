// ============================================================
// 15_mypage.gs - 保護者マイページ API（Phase U-3-B）
// マイページ照会・領収書再送・変更リクエスト送信
// レート制限: 同一IPまたは申込番号から5回失敗で15分ロック
// ============================================================

// ============================================================
// マイページ照会
// 申込番号 + メールアドレスの2要素で認証
// ============================================================
function getMyApplication(applicationId, email) {
  try {
    // 入力検証
    if (!applicationId || !email) {
      return { status: 'error', message: '申込番号とメールアドレスを入力してください' };
    }
    if (!_validString(applicationId, 50) || !_validString(email, 200)) {
      return { status: 'error', message: '入力形式が不正です' };
    }

    // レート制限チェック（IPベースが理想だがGASでは取得困難なので、申込番号ベース）
    const lockKey = 'mypage_lock_' + String(applicationId).replace(/[^A-Za-z0-9-]/g, '');
    const props = PropertiesService.getScriptProperties();
    const failData = props.getProperty(lockKey);
    if (failData) {
      const parsed = JSON.parse(failData);
      if (parsed.until && parsed.until > Date.now()) {
        const remainMin = Math.ceil((parsed.until - Date.now()) / 60000);
        return { status: 'error', message: 'ログイン試行回数が上限を超えました。' + remainMin + '分後に再度お試しください。' };
      }
    }

    // 申込検索
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(S_ENROLL);
    if (!sheet || sheet.getLastRow() < 2) {
      return { status: 'error', message: '該当する申込が見つかりません' };
    }
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colAppNum = headers.indexOf('申込番号');
    const colEmail = headers.indexOf('メール');
    if (colAppNum < 0) {
      return { status: 'error', message: 'マイページ機能は新規申込からご利用可能です（旧申込にはお問合せください）' };
    }
    const colId = headers.indexOf('申込ID');
    const colTs = headers.indexOf('申込日時');
    const colParent = headers.indexOf('保護者名');
    const colPhone = headers.indexOf('電話');
    const colStudents = headers.indexOf('生徒情報');
    const colCourses = headers.indexOf('講座詳細');
    const colTotal = headers.indexOf('合計金額');
    const colNote = headers.indexOf('備考');
    const colPaid = headers.indexOf('支払日');
    const colReceiptIssued = headers.indexOf('領収書発行日');

    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      const rowAppNum = String(data[i][colAppNum] || '').trim();
      const rowEmail = String(data[i][colEmail] || '').trim().toLowerCase();
      if (rowAppNum === String(applicationId).trim() &&
          rowEmail === String(email).trim().toLowerCase()) {
        foundRow = i;
        break;
      }
    }

    if (foundRow < 0) {
      // 失敗カウント増加
      _recordMyPageFailure(lockKey);
      return { status: 'error', message: '該当する申込が見つかりません。申込番号とメールアドレスをご確認ください。' };
    }

    // 成功 → 失敗カウントクリア
    props.deleteProperty(lockKey);

    const r = data[foundRow];
    const tsRaw = r[colTs];
    const tsStr = tsRaw instanceof Date ? tsRaw.toLocaleString('ja-JP') : String(tsRaw);
    const paidRaw = colPaid >= 0 ? r[colPaid] : '';
    const paidStr = paidRaw instanceof Date ? paidRaw.toLocaleDateString('ja-JP') : String(paidRaw || '');
    const receiptRaw = colReceiptIssued >= 0 ? r[colReceiptIssued] : '';
    const receiptStr = receiptRaw instanceof Date ? receiptRaw.toLocaleDateString('ja-JP') : String(receiptRaw || '');

    // ウェイティング登録状況も取得
    const waitings = _getWaitingForEmail(email);

    return {
      status: 'ok',
      data: {
        application_id: r[colAppNum],
        enroll_id: colId >= 0 ? r[colId] : '',
        submit_date: tsStr,
        parent_name: r[colParent],
        email: r[colEmail],
        phone: colPhone >= 0 ? r[colPhone] : '',
        students_info: colStudents >= 0 ? r[colStudents] : '',
        courses_text: colCourses >= 0 ? r[colCourses] : '',
        total: colTotal >= 0 ? r[colTotal] : '',
        note: colNote >= 0 ? r[colNote] : '',
        paid_date: paidStr,
        receipt_issued_date: receiptStr,
        is_paid: !!paidStr,
        waitings: waitings,
        zelle_email: ZELLE_RECIPIENT_EMAIL,
        zelle_name: ZELLE_RECIPIENT_NAME,
        check_payable_to: CHECK_PAYABLE_TO,
        check_mail_to: CHECK_MAIL_TO
      }
    };
  } catch (err) {
    console.error('getMyApplication error:', err && err.message);
    return { status: 'error', message: 'システムエラーが発生しました' };
  }
}

// レート制限：失敗カウント記録
function _recordMyPageFailure(lockKey) {
  try {
    const props = PropertiesService.getScriptProperties();
    const existing = props.getProperty(lockKey);
    let parsed = existing ? JSON.parse(existing) : { count: 0, until: 0 };
    parsed.count = (parsed.count || 0) + 1;
    if (parsed.count >= 5) {
      parsed.until = Date.now() + 15 * 60 * 1000; // 15分ロック
      parsed.count = 0; // リセット
    }
    props.setProperty(lockKey, JSON.stringify(parsed));
  } catch (e) {
    // 失敗は無視
  }
}

// ============================================================
// メールアドレスから現在のウェイティング登録を取得
// ============================================================
function _getWaitingForEmail(email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(S_WAITING);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colEmail = headers.indexOf('メール');
    const colCourse = headers.indexOf('講座名');
    const colCourseId = headers.indexOf('講座ID');
    const colStatus = headers.indexOf('ステータス');
    const colTs = headers.indexOf('登録日時');
    const colStudent = headers.indexOf('生徒名');
    if (colEmail < 0) return [];
    const target = String(email).trim().toLowerCase();
    const result = [];
    for (let i = 1; i < data.length; i++) {
      const e = String(data[i][colEmail] || '').trim().toLowerCase();
      if (e !== target) continue;
      const status = colStatus >= 0 ? String(data[i][colStatus] || '') : '';
      // 待機中のみ
      if (status && status !== '待機') continue;
      const tsRaw = colTs >= 0 ? data[i][colTs] : '';
      const tsStr = tsRaw instanceof Date ? tsRaw.toLocaleDateString('ja-JP') : String(tsRaw);
      result.push({
        course_id: colCourseId >= 0 ? data[i][colCourseId] : '',
        course_label: colCourse >= 0 ? data[i][colCourse] : '',
        student: colStudent >= 0 ? data[i][colStudent] : '',
        registered_date: tsStr,
        status: status || '待機'
      });
    }
    return result;
  } catch (e) {
    return [];
  }
}

// ============================================================
// 領収書再送（保護者からのリクエスト）
// ============================================================
function resendReceipt(applicationId, email) {
  try {
    if (!applicationId || !email) {
      return { status: 'error', message: '申込番号とメールアドレスを入力してください' };
    }
    if (!_rateLimitOk('mypage_receipt', 100)) {
      return { status: 'error', message: '本日の領収書再送上限に達しました' };
    }
    // 認証確認
    const auth = getMyApplication(applicationId, email);
    if (auth.status !== 'ok') {
      return auth;
    }
    if (!auth.data.is_paid) {
      return { status: 'error', message: '入金確認前の申込のため、領収書はまだ発行されていません。お支払い後にご利用ください。' };
    }
    // 領収書を再送
    const enroll = {
      parent_name: auth.data.parent_name,
      email: auth.data.email,
      students_info: auth.data.students_info,
      courses_text: auth.data.courses_text,
      total: auth.data.total
    };
    sendReceiptEmail(enroll);
    return { status: 'ok', message: '領収書を再送しました。受信トレイをご確認ください。' };
  } catch (err) {
    console.error('resendReceipt error:', err && err.message);
    return { status: 'error', message: 'システムエラーが発生しました' };
  }
}

// ============================================================
// 変更・キャンセル希望の送信（保護者から学校へ）
// 自動キャンセルはせず、人間判断に委ねる
// ============================================================
function submitChangeRequest(applicationId, email, requestType, content) {
  try {
    if (!applicationId || !email || !requestType || !content) {
      return { status: 'error', message: '入力内容が不足しています' };
    }
    if (!_validString(content, 5000)) {
      return { status: 'error', message: 'リクエスト内容が長すぎます' };
    }
    if (!_rateLimitOk('mypage_change_req', 100)) {
      return { status: 'error', message: '本日の受付上限に達しました' };
    }
    // 認証
    const auth = getMyApplication(applicationId, email);
    if (auth.status !== 'ok') {
      return auth;
    }
    const d = auth.data;
    const subject = '【変更/キャンセル希望】' + d.parent_name + ' 様（申込番号: ' + d.application_id + '）';
    const body =
      '保護者マイページから変更・キャンセル希望が届きました。\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '申込番号: ' + d.application_id + '\n' +
      '保護者: ' + d.parent_name + '\n' +
      'メール: ' + d.email + '\n' +
      '電話: ' + (d.phone || '未入力') + '\n' +
      '生徒: ' + d.students_info + '\n\n' +
      '希望種別: ' + requestType + '\n\n' +
      '内容:\n' + content + '\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '※ 自動でキャンセル処理はされていません。学校で内容確認の上、対応してください。\n' +
      SCHOOL_NAME;
    _safeSendEmail(SCHOOL_EMAIL, subject, body, { replyTo: d.email, name: SCHOOL_NAME });
    // 保護者向け自動返信
    const replyBody =
      d.parent_name + ' 様\n\n' +
      '変更・キャンセル希望を受け付けました。\n' +
      '学校から2営業日以内にご返信いたします。しばらくお待ちください。\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '申込番号: ' + d.application_id + '\n' +
      '希望種別: ' + requestType + '\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      SCHOOL_NAME + '\nTEL: 248-349-5234';
    _safeSendEmail(d.email, '【受付完了】変更・キャンセル希望 - サマースクール', replyBody, { name: SCHOOL_NAME });
    return { status: 'ok', message: 'リクエストを受け付けました。学校から2営業日以内にご返信いたします。' };
  } catch (err) {
    console.error('submitChangeRequest error:', err && err.message);
    return { status: 'error', message: 'システムエラーが発生しました' };
  }
}