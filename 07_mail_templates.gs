const ZELLE_RECIPIENT_EMAIL = 'michi-info@sundai-kaigai.jp';
const ZELLE_RECIPIENT_NAME  = 'Sundai USA, Inc. Novi, MI';
const CHECK_PAYABLE_TO      = 'Sundai USA, Inc.';
const CHECK_MAIL_TO         = '24277 Novi Rd, Novi, MI 48375';
// Zelle QR画像URL。空文字の場合はプレースホルダ（テキストのみ）を表示。
// 後日 Drive 直リンク等を入れると自動で QR画像入りに切り替わる。
const ZELLE_QR_IMAGE_URL    = '';

// ============================================================
// HTMLエスケープ
// ============================================================
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// 改行を <br> に
function _nl2br(s) {
  return _esc(s).replace(/\n/g, '<br>');
}

// ============================================================
// メール送信（申込） - Phase U-2: HTML化 + Zelle案内 + 領収書PDF添付
// ============================================================
function sendEnrollmentEmail(d) {
  const subject = '【サマースクール申込】' + d.parent_name + ' 様 - ' + d.submit_date;

  // 学校（管理者）向け: テキスト+HTML 両方送る
  const adminTextBody =
(d._duplicateWarning ? d._duplicateWarning + '\n（自動マージはしていません。両申込の内容を学校で確認してください）\n\n' : '') +
'サマースクール 受講申込が届きました。\n' +
'━━━━━━━━━━━━━━━━━━━━━━\n' +
'お名前：' + d.parent_name + '\n' +
'メール：' + d.reply_to + '\n' +
'電話：' + (d.phone || '未入力') + '\n' +
'申込日：' + d.submit_date + '\n' +
(d._appNumber ? '申込番号：' + d._appNumber + '\n' : '') +
'\n■ 生徒情報\n' + d.students_info + '\n\n' +
'■ 選択講座\n' + d.courses + '\n\n' +
'■ 合計金額：' + d.total + '\n' +
'■ 備考：' + (d.note || 'なし') + '\n' +
(d.emergency_tel ? '■ 緊急連絡先：' + d.emergency_tel + ' (' + (d.emergency_rel || '続柄未記入') + ')\n' : '') +
'━━━━━━━━━━━━━━━━━━━━━━\n' +
SCHOOL_NAME + '  TEL: 248-349-5234';
  _safeSendEmail(SCHOOL_EMAIL, (d._duplicateWarning ? '【⚠重複の可能性】' : '') + subject, adminTextBody,
    { replyTo: d.reply_to, name: SCHOOL_NAME });

  // 保護者向け: HTMLメール + 領収書PDF添付 + Zelle案内
  const parentSubject = '【申込受付完了】サマースクール - ' + d.parent_name + ' 様';
  const appNum = d._appNumber || '';
  const parentText =
d.parent_name + ' 様\n\nお申し込みありがとうございます。\n内容確認後、改めてご連絡いたします。\n\n' +
(appNum ? '━━━━━━━━━━━━━━━━━━━━━━\n■ 申込番号: ' + appNum + '\n  この番号は申込内容の照会・領収書再送等で使用します。\n  大切に保管してください。\n━━━━━━━━━━━━━━━━━━━━━━\n\n' : '') +
d.courses + '\n\n合計金額：' + d.total + '\n\n' +
'■ お支払いについて\n' +
'  Zelle 受取アドレス: ' + ZELLE_RECIPIENT_EMAIL + '\n' +
'  受取口座名: ' + ZELLE_RECIPIENT_NAME + '\n' +
'  お支払金額: ' + d.total + '\n' +
'  ※ U.S. Bank をご利用の場合は別途ご相談ください。\n\n' +
'■ 申込内容の控え（請求書）について\n' +
'  申込画面の「印刷 / PDF保存」ボタンから請求書として保存・印刷できます。\n' +
'  お支払い確認後、改めて領収書をメールにてお送りいたします。\n\n' +
SCHOOL_NAME + '\nTEL: 248-349-5234';

  const parentHtml = _buildEnrollmentEmailHtml(d);

  // 申込画面そのものが請求書フォーマットになっているため、保護者は申込画面の
  // 「🖨 印刷 / PDF保存」ボタンから自分で控えを取得できる設計（PDF添付しない）
  // Phase U-3-A 1-2: _safeSendEmail でクォータ対策 + ステータス記録
  const parentResult = _safeSendEmail(d.reply_to, parentSubject, parentText, {
    name: SCHOOL_NAME,
    htmlBody: parentHtml
  });

  // 申込一覧シートにステータス記録（最新行=この申込）
  try {
    const ss2 = SpreadsheetApp.getActiveSpreadsheet();
    const sheet2 = ss2.getSheetByName(S_ENROLL);
    if (sheet2 && sheet2.getLastRow() >= 2) {
      const targetRow = sheet2.getLastRow(); // saveEnrollment で append した直後
      const status = parentResult.ok
        ? '送信済み(' + new Date().toLocaleString('ja-JP') + ')'
        : '未送信(' + parentResult.reason + '): ' + (parentResult.message || '');
      _recordEmailStatus(sheet2, targetRow, status);
    }
  } catch (e) {
    console.error('Status record failed:', e && e.message);
  }
}

// ============================================================
// 保護者向け確認メールのHTML本文生成（Phase U-2 / Feature C）
// ============================================================
function _buildEnrollmentEmailHtml(d) {
  const navy = '#1b2a4a';
  const gold = '#c9a84c';
  const cream = '#faf8f3';

  // Zelle QRブロック（画像URLが設定されていれば画像、無ければテキストプレースホルダ）
  let qrBlock;
  if (ZELLE_QR_IMAGE_URL) {
    qrBlock =
      '<div style="text-align:center;margin:14px 0">' +
        '<img src="' + _esc(ZELLE_QR_IMAGE_URL) + '" alt="Zelle QR" style="max-width:200px;border:1px solid #ddd;padding:6px;background:#fff">' +
        '<div style="font-size:11px;color:#666;margin-top:6px">スマホでQRをスキャン → Zelleアプリが起動</div>' +
      '</div>';
  } else {
    qrBlock =
      '<div style="text-align:center;margin:14px 0;padding:20px;border:2px dashed #c9a84c;border-radius:6px;background:#fff7e0">' +
        '<div style="font-size:13px;color:#1b2a4a;font-weight:700">Zelle QRコード</div>' +
        '<div style="font-size:11px;color:#888;margin-top:6px">下記受取アドレスを Zelle アプリで指定してください</div>' +
      '</div>';
  }

  return '' +
'<div style="font-family:\'Hiragino Kaku Gothic Pro\',\'Yu Gothic\',sans-serif;max-width:640px;margin:0 auto;color:#333;line-height:1.7">' +
  '<div style="background:' + navy + ';color:#fff;padding:20px 24px;border-bottom:4px solid ' + gold + '">' +
    '<div style="font-size:18px;font-weight:700;letter-spacing:.05em">駿台ミシガン国際学院</div>' +
    '<div style="font-size:12px;opacity:.85;margin-top:2px">2026 Summer School / 受講申込受付完了</div>' +
  '</div>' +
  '<div style="padding:20px 24px;background:#fff">' +
    '<p style="margin:0 0 14px">' + _esc(d.parent_name) + ' 様</p>' +
    '<p style="margin:0 0 14px">この度はサマースクールへのお申し込みをいただき、誠にありがとうございます。<br>下記の内容で承りました。お支払いをもって正式受付となります。</p>' +
    '<div style="background:' + cream + ';border-left:3px solid ' + gold + ';padding:10px 14px;margin:14px 0">' +
      '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
        '<div>' +
          '<div style="font-size:11px;color:#888">申込日</div>' +
          '<div style="font-size:13px;color:' + navy + ';font-weight:700">' + _esc(d.submit_date) + '</div>' +
        '</div>' +
        (d._appNumber ? '<div>' +
          '<div style="font-size:11px;color:#888">申込番号 / Application No.</div>' +
          '<div style="font-size:14px;color:' + navy + ';font-weight:700;font-family:Georgia,monospace">' + _esc(d._appNumber) + '</div>' +
          '<div style="font-size:10px;color:#888;margin-top:2px">マイページ照会・領収書再送等で使用します</div>' +
        '</div>' : '') +
      '</div>' +
    '</div>' +
    '<div style="margin:18px 0 6px;font-size:13px;color:' + navy + ';font-weight:700;border-bottom:2px solid ' + navy + ';padding-bottom:4px">■ 申込内容</div>' +
    '<div style="font-size:12px;line-height:1.9;white-space:pre-wrap;background:#fff;border:1px solid #eee;padding:12px;border-radius:3px">' + _nl2br(d.courses) + '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin:16px 0;padding:10px 14px;background:#fff7e0;border-radius:3px">' +
      '<div style="font-size:13px;color:' + navy + ';font-weight:700">合計金額</div>' +
      '<div style="font-size:22px;color:' + gold + ';font-weight:700;font-family:Georgia,serif">' + _esc(d.total) + '</div>' +
    '</div>' +
    '<div style="margin:24px 0 6px;font-size:14px;color:' + navy + ';font-weight:700;border-bottom:2px solid ' + gold + ';padding-bottom:4px">■ お支払いはこちらから / Payment</div>' +
    '<p style="margin:8px 0;font-size:12px">Zelle (ゼル) でのお振込みをお願いいたします。下記の情報をご利用ください。</p>' +
    qrBlock +
    '<table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:12px">' +
      '<tr><td style="padding:6px 8px;background:#f5f5f5;font-weight:600;width:38%;border:1px solid #eee">受取アドレス</td><td style="padding:6px 8px;border:1px solid #eee;font-family:monospace">' + _esc(ZELLE_RECIPIENT_EMAIL) + '</td></tr>' +
      '<tr><td style="padding:6px 8px;background:#f5f5f5;font-weight:600;border:1px solid #eee">受取口座名</td><td style="padding:6px 8px;border:1px solid #eee">' + _esc(ZELLE_RECIPIENT_NAME) + '</td></tr>' +
      '<tr><td style="padding:6px 8px;background:#f5f5f5;font-weight:600;border:1px solid #eee">お支払金額</td><td style="padding:6px 8px;border:1px solid #eee;font-weight:700">' + _esc(d.total) + '</td></tr>' +
    '</table>' +
    '<div style="margin:12px 0;padding:10px 12px;background:#fff3cd;border-left:3px solid #e65100;border-radius:3px;font-size:11px;color:#555;line-height:1.7">' +
      '<strong>U.S. Bank をご利用の方へ</strong><br>' +
      '一部のU.S. Bank の Zelle では金額制限や送金エラーが発生することがあります。エラー時は学校までご連絡ください。' +
    '</div>' +
    '<div style="margin:12px 0;padding:10px 12px;background:#f5f5f5;border-radius:3px;font-size:11px;color:#555;line-height:1.7">' +
      '<strong>Check（小切手）でお支払いの場合</strong><br>' +
      '宛名: ' + _esc(CHECK_PAYABLE_TO) + '<br>' +
      '送付先: ' + _esc(CHECK_MAIL_TO) +
    '</div>' +
    '<div style="margin:24px 0 6px;font-size:13px;color:' + navy + ';font-weight:700;border-bottom:2px solid ' + navy + ';padding-bottom:4px">■ 申込内容の控え（請求書）</div>' +
    '<p style="margin:8px 0;font-size:12px">申込画面の右上にある「印刷 / PDF保存」ボタンから、申込内容を請求書として PDF 保存・印刷していただけます。<br><strong>お支払い確認後、改めて領収書をメールにてお送りいたします。</strong></p>' +
  '</div>' +
  '<div style="background:' + navy + ';color:#fff;padding:14px 24px;font-size:11px;line-height:1.8">' +
    '<div style="font-weight:700;font-size:13px;margin-bottom:4px">' + _esc(SCHOOL_NAME) + '</div>' +
    'TEL: 248-349-5234 / Email: ' + _esc(ZELLE_RECIPIENT_EMAIL) +
  '</div>' +
'</div>';
}

// ============================================================
// 請求書PDFは生成しません。申込画面そのものが請求書フォーマットになっており、
// 保護者は画面の「🖨 印刷 / PDF保存」ボタンで自分で控えを取れる設計です。
// 領収書（入金確認後）は Phase U-6 で別途実装予定。
// ============================================================

// ============================================================
// メール送信（リクエスト）
// ============================================================
function sendRequestEmail(d) {
  _safeSendEmail(SCHOOL_EMAIL,
    '【講座リクエスト】' + d.parent_name + ' 様',
    'お名前：' + d.parent_name + '\nメール：' + d.reply_to + '\n\n' + d.courses,
    { replyTo: d.reply_to, name: SCHOOL_NAME });

  _safeSendEmail(d.reply_to,
    '【受付完了】講座リクエスト',
    d.parent_name + ' 様\n\nリクエストを受け付けました。\n\n' + SCHOOL_NAME,
    { name: SCHOOL_NAME });
}

// ============================================================
// レスポンスヘルパー
// ============================================================
