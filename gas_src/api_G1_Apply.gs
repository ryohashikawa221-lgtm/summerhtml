/**
 * api_G1_Apply.gs (goudou_enshu_app)
 * G-1 申込フォーム + 確認メール自動送信 API。
 *
 * 来歴: 2026-05-03 新規作成 (HANDOFF §4 G-1 仕様準拠)。
 *
 * フロー:
 *   1. 保護者が申込フォーム (?role=apply) で 校舎・受験番号・氏名・学年・受験教科・保護者メール を入力
 *   2. g1_submitApplication(payload) が呼ばれて以下を実行:
 *      - 必須項目バリデーション (受験番号は校舎担当者が事前発番済、保護者には別途通知)
 *      - 受験番号のフォーマット + 校舎一致チェック
 *      - 学年 × 教科 の妥当性チェック
 *      - メール形式チェック
 *      - 受験生マスタ存在確認 + 氏名/メール照合
 *      - tx_申込 に行追加 (status='確認メール送信済')
 *      - 確認メール送信 (G-2 アップロード URL 入り)
 *   3. 完了画面表示 (申込番号と確認メール送信先を表示)
 */

/**
 * G-1 申込送信のメイン API。
 * @param {object} payload {campus, studentId, grade, name, nameKana, parentEmail, studentEmail, subjects, note}
 */
function g1_submitApplication(payload) {
  try {
    if (!payload) throw new Error('payload が空です');
    var campus = String(payload.campus || '').trim().toUpperCase();
    var studentId = String(payload.studentId || '').trim();
    var grade = String(payload.grade || '').trim();
    var name = String(payload.name || '').trim();
    var nameKana = String(payload.nameKana || '').trim();
    var parentEmail = String(payload.parentEmail || '').trim();
    var studentEmail = String(payload.studentEmail || '').trim();
    var subjects = (payload.subjects || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
    var note = String(payload.note || '').trim();

    // ----- バリデーション -----
    if (Schema.CAMPUSES.indexOf(campus) === -1) {
      throw new Error('校舎コードが不正です: ' + campus + ' (期待: ' + Schema.CAMPUSES.join('/') + ')');
    }
    if (!studentId) throw new Error('受験番号を入力してください');
    var idCampus = Schema.campusOfStudentId(studentId);
    if (!idCampus) throw new Error('受験番号の形式が不正です: ' + studentId + ' (例: ' + campus + '-001)');
    if (idCampus !== campus) {
      throw new Error('受験番号 ' + studentId + ' は校舎 ' + campus + ' のものではありません');
    }
    if (!grade) throw new Error('学年を選択してください');
    if (!Schema.SUBJECTS_BY_GRADE[grade]) {
      throw new Error('学年が不正です: ' + grade + ' (期待: ' + Object.keys(Schema.SUBJECTS_BY_GRADE).join('/') + ')');
    }
    if (!name) throw new Error('氏名を入力してください');
    if (!parentEmail) throw new Error('保護者メールを入力してください');
    if (!_isEmail(parentEmail)) throw new Error('保護者メール形式が不正です: ' + parentEmail);
    if (studentEmail && !_isEmail(studentEmail)) {
      throw new Error('本人メール形式が不正です: ' + studentEmail);
    }
    if (subjects.length === 0) throw new Error('受験教科を 1 つ以上選択してください');
    var v = Schema.validateSubjects(grade, subjects);
    if (!v.valid) {
      throw new Error('学年 ' + grade + ' で受験できない教科: ' + v.invalid.join(', '));
    }

    // ----- 受験生マスタ照合 -----
    var sheetName = Schema.studentSheetName(campus);
    var master = SheetDB.findOne(sheetName, { 受験番号: studentId });
    if (!master) {
      throw new Error('受験番号 ' + studentId + ' は校舎 ' + campus +
        ' に登録されていません。校舎担当者にご確認ください。');
    }
    // 氏名一致を確認 (簡易、全角空白除去)
    var masterName = String(master.氏名 || '').replace(/\s+/g, '');
    var inputName = name.replace(/\s+/g, '');
    if (masterName && masterName !== inputName) {
      throw new Error('氏名が登録情報と異なります。校舎担当者にご確認ください。');
    }

    // ----- tx_申込 に追加 -----
    var now = Util.nowIso();
    var appId = SheetDB.insert('tx_申込', {
      申込日時: now,
      校舎: campus,
      受験番号: studentId,
      学年: grade,
      氏名: name,
      氏名カナ: nameKana,
      保護者メール: parentEmail,
      本人メール: studentEmail,
      受験教科: subjects.join(','),
      ステータス: '受付',
      確認メール送信日時: '',
      備考: note
    });

    // ----- 確認メール送信 -----
    var mailResult = _sendConfirmationMail({
      campus: campus,
      studentId: studentId,
      grade: grade,
      name: name,
      parentEmail: parentEmail,
      studentEmail: studentEmail,
      subjects: subjects
    });

    if (mailResult.sent) {
      SheetDB.update('tx_申込', appId, {
        ステータス: '確認メール送信済',
        確認メール送信日時: Util.nowIso()
      });
    }

    return {
      ok: true,
      applicationId: appId,
      mailSent: mailResult.sent,
      mailError: mailResult.error || null,
      message: '申込を受け付けました。' +
        (mailResult.sent
          ? ' 確認メールを ' + parentEmail + ' に送信しました。'
          : ' (確認メール送信に失敗: ' + mailResult.error + ')')
    };
  } catch (err) {
    Logger.log('[G-1] ERROR: ' + (err && err.stack ? err.stack : err.message));
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

function _isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * 確認メール送信 (G-2 アップロード URL 入り)
 */
function _sendConfirmationMail(ctx) {
  try {
    var uploadUrlBase = Settings.getWebAppUrl('upload');
    if (!uploadUrlBase) {
      // WebApp URL 未設定時は plain URL のみ案内 (運用初期の救済)
      uploadUrlBase = '(管理者: m_設定 の upload_web_app_url を設定してください)';
    }
    var uploadUrl = uploadUrlBase.indexOf('http') === 0
      ? uploadUrlBase + '&id=' + encodeURIComponent(ctx.studentId)
      : uploadUrlBase;

    var eventDate = Settings.get('event_date', '2026-05-17');
    var schoolName = Settings.get('school_name', '駿台USA合同演習会');

    var subject = '【' + schoolName + '】お申込ありがとうございます (' + ctx.studentId + ')';

    var plain = [
      ctx.name + ' 様 / 保護者様',
      '',
      'このたびは ' + schoolName + ' へお申込いただきありがとうございます。',
      '以下の内容で受け付けました。',
      '',
      '━━━━━━━━━━━━━━━━━━━━━',
      '■ 申込内容',
      '━━━━━━━━━━━━━━━━━━━━━',
      '校舎       : ' + ctx.campus,
      '受験番号   : ' + ctx.studentId,
      '学年       : ' + ctx.grade,
      '氏名       : ' + ctx.name,
      '受験教科   : ' + ctx.subjects.join(', '),
      '開催日     : ' + eventDate,
      '',
      '━━━━━━━━━━━━━━━━━━━━━',
      '■ 答案アップロードについて',
      '━━━━━━━━━━━━━━━━━━━━━',
      '当日の答案は以下の URL からアップロードしてください。',
      '教科ごとに 1 回ずつアップロードしていただく必要があります。',
      '',
      uploadUrl,
      '',
      '※ PDF または画像 (写真複数枚も OK) でアップロードできます。',
      '※ スマートフォンでスキャンする場合は Adobe Scan / CamScanner などをご利用ください。',
      '',
      '━━━━━━━━━━━━━━━━━━━━━',
      'ご不明な点は事務局までお問い合わせください。',
      '',
      schoolName
    ].join('\n');

    var html = _buildConfirmationHtml(ctx, uploadUrl, eventDate, schoolName);

    Mailer.send({
      to: ctx.parentEmail,
      subject: subject,
      htmlBody: html,
      plainBody: plain
    });
    return { sent: true };
  } catch (e) {
    Logger.log('[G-1] mail send failed: ' + e.message);
    return { sent: false, error: e.message };
  }
}

function _buildConfirmationHtml(ctx, uploadUrl, eventDate, schoolName) {
  var esc = Util.escapeHtml;
  var subjectsHtml = ctx.subjects.map(function (s) {
    return '<li>' + esc(s) + '</li>';
  }).join('');
  var safeUrl = esc(uploadUrl);
  return [
    '<div style="font-family:-apple-system,Segoe UI,Hiragino Sans,Noto Sans JP,sans-serif;max-width:600px;margin:auto;color:#1a1a1a;line-height:1.7">',
    '<div style="background:#1b2a4a;color:#fff;padding:18px 20px;border-bottom:3px solid #c9a84c">',
    '<div style="font-size:11px;letter-spacing:0.25em;color:#e8c96a">SUNDAI USA</div>',
    '<div style="font-size:18px;font-weight:700;margin-top:4px">' + esc(schoolName) + ' お申込確認</div>',
    '</div>',
    '<div style="padding:20px;background:#fff">',
    '<p>' + esc(ctx.name) + ' 様 / 保護者様</p>',
    '<p>このたびはお申込いただきありがとうございます。以下の内容で受け付けました。</p>',
    '<table style="border-collapse:collapse;width:100%;margin:14px 0">',
    '<tr><td style="padding:6px;border:1px solid #ddd;background:#f5f5f5;width:120px">校舎</td><td style="padding:6px;border:1px solid #ddd">' + esc(ctx.campus) + '</td></tr>',
    '<tr><td style="padding:6px;border:1px solid #ddd;background:#f5f5f5">受験番号</td><td style="padding:6px;border:1px solid #ddd"><strong>' + esc(ctx.studentId) + '</strong></td></tr>',
    '<tr><td style="padding:6px;border:1px solid #ddd;background:#f5f5f5">学年</td><td style="padding:6px;border:1px solid #ddd">' + esc(ctx.grade) + '</td></tr>',
    '<tr><td style="padding:6px;border:1px solid #ddd;background:#f5f5f5">氏名</td><td style="padding:6px;border:1px solid #ddd">' + esc(ctx.name) + '</td></tr>',
    '<tr><td style="padding:6px;border:1px solid #ddd;background:#f5f5f5">受験教科</td><td style="padding:6px;border:1px solid #ddd"><ul style="margin:0;padding-left:18px">' + subjectsHtml + '</ul></td></tr>',
    '<tr><td style="padding:6px;border:1px solid #ddd;background:#f5f5f5">開催日</td><td style="padding:6px;border:1px solid #ddd">' + esc(eventDate) + '</td></tr>',
    '</table>',
    '<h3 style="color:#1b2a4a;border-left:4px solid #c9a84c;padding-left:10px;margin:24px 0 10px">答案アップロードについて</h3>',
    '<p>当日の答案は以下のリンクからアップロードしてください。教科ごとに 1 回ずつアップロードする必要があります。</p>',
    '<p style="text-align:center;margin:20px 0">',
    '<a href="' + safeUrl + '" style="display:inline-block;background:#1b2a4a;color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:700">答案をアップロードする</a>',
    '</p>',
    '<p style="font-size:12px;color:#666">URL: <a href="' + safeUrl + '">' + safeUrl + '</a></p>',
    '<p style="font-size:12px;color:#666">※ PDF または画像 (写真複数枚 OK) を選択できます。スマホでスキャンする場合は Adobe Scan / CamScanner をご利用ください。</p>',
    '<hr style="border:0;border-top:1px solid #ddd;margin:24px 0">',
    '<p style="font-size:12px;color:#888">ご不明な点は事務局までお問い合わせください。<br>' + esc(schoolName) + '</p>',
    '</div>',
    '</div>'
  ].join('');
}
