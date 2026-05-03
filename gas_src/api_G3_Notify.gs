/**
 * api_G3_Notify.gs (goudou_enshu_app)
 * G-3 採点結果一斉配信メール (HANDOFF §4 G-3 仕様準拠)。
 *
 * 来歴: 2026-05-03 新規作成。
 *
 * フロー:
 *   1. アップロード締切後、g3_populateGrading() で tx_答案 から tx_採点 を populate
 *      (受験番号 × 教科 ごとに 1 行)
 *   2. 先生が tx_採点 シートを直接開いて 点数 列に入力
 *   3. onEdit トリガー (onEditGrading) が発火:
 *      - 答案ファイルを 採点済 フォルダに移動
 *      - 採点済フラグ = 1, 採点日時 / 採点者 記録
 *   4. 全教科の採点完了を管理者ダッシュボードで確認 (g3_getProgress)
 *   5. 管理者が「結果配信」ボタンクリック → g3_distributeResults
 *      - kill switch (Settings.bulk_mail_send_enabled) を必ず確認
 *      - 順位を再計算 (g3_computeRankings)
 *      - 受験者ごとに 統一テンプレ メールを保護者 + 本人へ送信
 *      - 配信済フラグ = 1
 *
 * 管理者は g3_previewResultMail(受験番号) で本送信前にプレビュー可能。
 */

// ============================================================
// 1. tx_採点 を tx_答案 から populate (アップロード締切後の運用)
// ============================================================

/**
 * tx_答案 の active 行ごとに tx_採点 行を ensure。
 * 既存行があれば 答案ファイルID を最新に更新するだけ。
 * @return {object} {created: N, updated: N, skipped: N}
 */
function g3_populateGrading() {
  return Lock.withLock(function () {
    var uploads = SheetDB.find('tx_答案', { ステータス: 'active' });
    var maxScores = {
      '国語': Number(Settings.get('max_score_kokugo', 100)),
      '数学': Number(Settings.get('max_score_sugaku', 100)),
      '算数': Number(Settings.get('max_score_sansu', 100)),
      '英語': Number(Settings.get('max_score_eigo', 100))
    };
    var created = 0, updated = 0;
    uploads.forEach(function (u) {
      var existing = SheetDB.findOne('tx_採点', { 受験番号: u.受験番号, 教科: u.教科 });
      if (existing) {
        if (existing.答案ファイルID !== u.ファイルID) {
          SheetDB.update('tx_採点', existing.id, {
            答案ファイルID: u.ファイルID,
            // 既に採点済の場合は弾く判断は呼び出し側に任せる (運用上は populate を採点前にしか走らせない)
            備考: (existing.備考 || '') + ' [ファイル更新 ' + Util.nowIso() + ']'
          });
          updated++;
        }
      } else {
        SheetDB.insert('tx_採点', {
          校舎: u.校舎,
          受験番号: u.受験番号,
          氏名: u.氏名,
          学年: u.学年,
          教科: u.教科,
          答案ファイルID: u.ファイルID,
          満点: maxScores[u.教科] || 100,
          採点済フラグ: 0,
          配信済フラグ: 0
        });
        created++;
      }
    });
    return { created: created, updated: updated };
  });
}

// ============================================================
// 2. onEdit トリガー (採点入力 → 採点済フォルダへ自動移動)
// ============================================================

/**
 * インストール型トリガー (setupTriggers から登録される想定)。
 * tx_採点 シートの 点数 列が編集されたら以下を実行:
 *   - 答案ファイルを 採点済 フォルダに移動
 *   - 採点済フラグ / 採点日時 / 採点者 / 採点済ファイルID をシートに反映
 *
 * @param {object} e onEdit event
 */
function onEditGrading(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== 'tx_採点') return;
    var row = e.range.getRow();
    if (row < 2) return;

    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var pointCol = header.indexOf('点数') + 1;
    if (e.range.getColumn() !== pointCol) return;

    var newValue = e.value;
    if (newValue === undefined || newValue === '' || newValue === null) return;
    var score = Number(newValue);
    if (isNaN(score)) return;

    // 行データを読む
    var rowValues = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    var rec = {};
    header.forEach(function (h, i) { rec[h] = rowValues[i]; });

    var fileId = rec.答案ファイルID;
    var grade = rec.学年;
    var subject = rec.教科;
    if (!fileId || !grade || !subject) return;

    // 採点済フォルダに移動
    var gradedFolderId = Drive.getSubjectFolderId('採点済', grade, subject);
    if (!gradedFolderId) {
      Logger.log('[G-3 onEdit] 採点済フォルダ未設定: ' + grade + ' ' + subject);
      return;
    }
    try {
      Drive.moveFile(fileId, gradedFolderId);
    } catch (err) {
      Logger.log('[G-3 onEdit] moveFile failed: ' + err.message);
      return;
    }

    // tx_採点 を更新
    var user;
    try { user = Session.getActiveUser().getEmail() || 'unknown'; } catch (ex) { user = 'unknown'; }
    var idCol = header.indexOf('id') + 1;
    var rowId = sh.getRange(row, idCol).getValue();
    SheetDB.update('tx_採点', rowId, {
      採点済ファイルID: fileId,
      採点済フラグ: 1,
      採点日時: Util.nowIso(),
      採点者: user
    });

    // tx_答案 側の 採点済フラグ + 合計点 も同期
    var upload = SheetDB.findOne('tx_答案', { 受験番号: rec.受験番号, 教科: subject, ステータス: 'active' });
    if (upload) {
      SheetDB.update('tx_答案', upload.id, {
        採点済フラグ: 1,
        合計点: score
      });
    }
  } catch (err) {
    Logger.log('[G-3 onEdit] ERROR: ' + err.stack);
  }
}

/**
 * インストール型トリガーをセットアップ (一度だけ実行)。
 */
function setupTriggers() {
  // 既存トリガー (onEditGrading) を全削除して重複登録防止
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditGrading') {
      ScriptApp.deleteTrigger(t);
    }
  });
  var props = PropertiesService.getScriptProperties();
  var env = (props.getProperty('APP_ENV') || 'dev').toLowerCase();
  var key = env === 'prod' ? 'prod_spreadsheet_id' : 'dev_spreadsheet_id';
  var ssId = props.getProperty(key);
  if (!ssId) throw new Error('Script Property "' + key + '" 未設定');
  ScriptApp.newTrigger('onEditGrading')
    .forSpreadsheet(SpreadsheetApp.openById(ssId))
    .onEdit()
    .create();
  return { ok: true, message: 'onEditGrading trigger installed for ' + ssId };
}

// ============================================================
// 3. 順位計算
// ============================================================

/**
 * tx_採点 から 順位 (教科別 + 学年内) を再計算してシートに書き戻す。
 * - 教科別順位 (subject内): 採点済みのもののみ対象、同点は同順位
 * - (合計順位は別関数 _computeTotalRanking で算出、 G-3 配信時のメール組立に使用)
 */
function g3_computeRankings() {
  var rows = SheetDB.find('tx_採点');
  // 教科別 grade × subject ごとに並べる
  var groups = {};
  rows.forEach(function (r) {
    if (!r.採点済フラグ || r.点数 === '' || r.点数 === null || r.点数 === undefined) return;
    var key = r.学年 + '|' + r.教科;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ id: r.id, score: Number(r.点数) });
  });
  var updates = [];
  Object.keys(groups).forEach(function (k) {
    var sorted = groups[k].slice().sort(function (a, b) { return b.score - a.score; });
    var lastScore = null;
    var lastRank = 0;
    sorted.forEach(function (entry, i) {
      var rank;
      if (entry.score === lastScore) {
        rank = lastRank;
      } else {
        rank = i + 1;
        lastScore = entry.score;
        lastRank = rank;
      }
      updates.push({ id: entry.id, partial: { 順位: rank } });
    });
  });
  if (updates.length) SheetDB.bulkUpdate('tx_採点', updates);
  return { updated: updates.length };
}

/**
 * 学年ごとの 合計順位 を返す (in-memory、シートには書き戻さない)。
 * @return {Object} {学年: [{受験番号, total, rank, count}]}
 */
function _computeTotalRanking() {
  var rows = SheetDB.find('tx_採点', { 採点済フラグ: 1 });
  var byStudent = {};
  rows.forEach(function (r) {
    if (r.点数 === '' || r.点数 === null) return;
    var k = r.学年 + '|' + r.受験番号;
    if (!byStudent[k]) byStudent[k] = { 受験番号: r.受験番号, 学年: r.学年, total: 0, count: 0 };
    byStudent[k].total += Number(r.点数);
    byStudent[k].count += 1;
  });
  var byGrade = {};
  Object.keys(byStudent).forEach(function (k) {
    var s = byStudent[k];
    if (!byGrade[s.学年]) byGrade[s.学年] = [];
    byGrade[s.学年].push(s);
  });
  Object.keys(byGrade).forEach(function (grade) {
    var arr = byGrade[grade].sort(function (a, b) { return b.total - a.total; });
    var lastTotal = null, lastRank = 0;
    arr.forEach(function (e, i) {
      if (e.total === lastTotal) e.rank = lastRank;
      else { e.rank = i + 1; lastTotal = e.total; lastRank = e.rank; }
      e.count = arr.length;
    });
  });
  return byGrade;
}

// ============================================================
// 4. 進捗ダッシュボード
// ============================================================

/**
 * 採点進捗を返す (受験者数 / 採点済セル数 / 配信済セル数 など)
 */
function g3_getProgress() {
  var grading = SheetDB.find('tx_採点');
  var total = grading.length;
  var graded = grading.filter(function (r) { return r.採点済フラグ; }).length;
  var distributed = grading.filter(function (r) { return r.配信済フラグ; }).length;

  // 学年 × 教科 × 校舎 のクロス集計
  var byCell = {};
  grading.forEach(function (r) {
    var key = r.学年 + ' / ' + r.教科;
    if (!byCell[key]) byCell[key] = { total: 0, graded: 0 };
    byCell[key].total++;
    if (r.採点済フラグ) byCell[key].graded++;
  });

  // 受験者ごとの完了状況
  var byStudent = {};
  grading.forEach(function (r) {
    var k = r.受験番号;
    if (!byStudent[k]) byStudent[k] = {
      受験番号: r.受験番号, 氏名: r.氏名, 学年: r.学年, 校舎: r.校舎,
      total: 0, graded: 0, distributed: 0
    };
    byStudent[k].total++;
    if (r.採点済フラグ) byStudent[k].graded++;
    if (r.配信済フラグ) byStudent[k].distributed++;
  });

  return {
    ok: true,
    total: total,
    graded: graded,
    distributed: distributed,
    pct_graded: total ? Math.round(graded / total * 100) : 0,
    byCell: byCell,
    students: Object.keys(byStudent).map(function (k) { return byStudent[k]; }),
    bulkMailEnabled: Settings.isBulkMailEnabled()
  };
}

/**
 * kill switch を ON/OFF (admin only)
 */
function g3_setBulkMailEnabled(enabled) {
  Settings.setBulkMailEnabled(enabled === true || enabled === 'true');
  return { ok: true, enabled: Settings.isBulkMailEnabled() };
}

// ============================================================
// 5. 結果配信
// ============================================================

/**
 * 1 受験者ぶんのメール本文プレビューを生成 (本送信せず)。
 * @param {string} studentId 例: 'MI-001'
 */
function g3_previewResultMail(studentId) {
  try {
    var rows = SheetDB.find('tx_採点', { 受験番号: studentId, 採点済フラグ: 1 });
    if (rows.length === 0) {
      throw new Error('採点済データがありません: ' + studentId);
    }
    var totals = _computeTotalRanking();
    var built = _buildResultMail(studentId, rows, totals);
    return { ok: true, subject: built.subject, html: built.html, plain: built.plain, to: built.to, cc: built.cc };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 採点済 + 未配信 の受験者を一括配信。
 * @param {object} opts {dryRun: bool, onlyStudentId: string?}
 * @return {object} {sent: N, failed: [...], skipped: N}
 */
function g3_distributeResults(opts) {
  opts = opts || {};
  if (!opts.dryRun) {
    if (!Settings.isBulkMailEnabled()) {
      throw new Error('[KILL SWITCH] bulk_mail_send_enabled が false です。' +
        'g3_setBulkMailEnabled(true) で ON にしてから実行してください (Ryo の明示 GO 後のみ)。');
    }
  }
  var totals = _computeTotalRanking();
  var rows = SheetDB.find('tx_採点', opts.onlyStudentId ? { 受験番号: opts.onlyStudentId } : {});
  var byStudent = {};
  rows.forEach(function (r) {
    if (!r.採点済フラグ) return;
    if (r.配信済フラグ && !opts.force) return;
    if (!byStudent[r.受験番号]) byStudent[r.受験番号] = [];
    byStudent[r.受験番号].push(r);
  });

  var sentCount = 0;
  var failedList = [];
  var skipped = 0;
  Object.keys(byStudent).forEach(function (sid) {
    var subjectRows = byStudent[sid];
    // 受験予定教科すべての採点が完了しているかチェック (部分配信防止)
    var campus = Schema.campusOfStudentId(sid);
    if (!campus) { skipped++; return; }
    var master;
    try { master = SheetDB.findOne(Schema.studentSheetName(campus), { 受験番号: sid }); }
    catch (e) { master = null; }
    if (master) {
      var expected = String(master.受験教科 || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var graded = subjectRows.map(function (r) { return r.教科; });
      var missing = expected.filter(function (s) { return graded.indexOf(s) === -1; });
      if (missing.length > 0) {
        skipped++;
        return;
      }
    }

    var built = _buildResultMail(sid, subjectRows, totals);
    if (opts.dryRun) {
      sentCount++;
      return;
    }
    try {
      Mailer.send({
        to: built.to,
        cc: built.cc || undefined,
        subject: built.subject,
        htmlBody: built.html,
        plainBody: built.plain,
        bulk: true
      });
      sentCount++;
      // 配信済フラグ + 配信日時 を反映
      var now = Util.nowIso();
      var updates = subjectRows.map(function (r) {
        return { id: r.id, partial: { 配信済フラグ: 1, 配信日時: now } };
      });
      SheetDB.bulkUpdate('tx_採点', updates);
    } catch (e) {
      failedList.push({ 受験番号: sid, error: e.message });
    }
  });

  return {
    ok: true,
    sent: sentCount,
    failed: failedList,
    skipped: skipped,
    dryRun: opts.dryRun || false
  };
}

/**
 * 1 受験者ぶんの メール本文を組み立てる
 */
function _buildResultMail(studentId, subjectRows, totalsByGrade) {
  var first = subjectRows[0];
  var grade = first.学年;
  var name = first.氏名;
  var campus = first.校舎;
  var schoolName = Settings.get('school_name', '駿台USA合同演習会');

  // 宛先 (受験生マスタから email を引く)
  var sheetName = Schema.studentSheetName(campus);
  var master = SheetDB.findOne(sheetName, { 受験番号: studentId });
  if (!master) throw new Error('受験生マスタに見つかりません: ' + studentId);
  var to = master.保護者メール;
  var cc = master.本人メール ? master.本人メール : '';

  // 教科別データ
  var subjects = subjectRows.slice().sort(function (a, b) {
    return String(a.教科).localeCompare(String(b.教科));
  });
  var totalScore = subjects.reduce(function (a, r) { return a + Number(r.点数 || 0); }, 0);
  var totalMaxScore = subjects.reduce(function (a, r) { return a + Number(r.満点 || 0); }, 0);

  // 学年内 受験者数 + 総合順位
  var gradeTotals = (totalsByGrade && totalsByGrade[grade]) || [];
  var myTotal = gradeTotals.find ? gradeTotals.find(function (e) { return e.受験番号 === studentId; })
    : (function () {
        for (var i = 0; i < gradeTotals.length; i++) if (gradeTotals[i].受験番号 === studentId) return gradeTotals[i];
        return null;
      })();
  var totalRank = myTotal ? myTotal.rank : null;
  var totalCount = myTotal ? myTotal.count : 0;

  // 所見ブロック (どこかの教科で 所見 があれば集約)
  var commentLines = [];
  subjects.forEach(function (r) {
    if (r.所見 && String(r.所見).trim()) {
      commentLines.push('【' + r.教科 + '】 ' + String(r.所見).trim());
    }
  });

  // 採点済答案リンク
  var pdfLinks = subjects.map(function (r) {
    var fid = r.採点済ファイルID || r.答案ファイルID;
    if (!fid) return null;
    return { 教科: r.教科, url: 'https://drive.google.com/file/d/' + fid + '/view' };
  }).filter(Boolean);

  var subject = '【' + schoolName + '】' + name + '様 結果のお知らせ (' + studentId + ')';

  // ----- plain text -----
  var pl = [];
  pl.push(name + ' 様 / 保護者様');
  pl.push('');
  pl.push('このたびは ' + schoolName + ' にご参加いただきありがとうございました。');
  pl.push('結果をお知らせいたします。');
  pl.push('');
  pl.push('━━━━━━━━━━━━━━━━━━━━━');
  pl.push('■ 教科別結果');
  pl.push('━━━━━━━━━━━━━━━━━━━━━');
  subjects.forEach(function (r) {
    var rank = r.順位 ? (r.順位 + ' 位 / ' + totalCount + ' 名中') : '';
    pl.push(r.教科 + ': ' + r.点数 + ' / ' + (r.満点 || 100) + ' 点' + (rank ? '   (' + rank + ')' : ''));
  });
  pl.push('');
  pl.push('合計: ' + totalScore + ' / ' + totalMaxScore + ' 点' +
    (totalRank ? '   (' + totalRank + ' 位 / ' + totalCount + ' 名中)' : ''));
  pl.push('');
  if (pdfLinks.length) {
    pl.push('━━━━━━━━━━━━━━━━━━━━━');
    pl.push('■ 採点済答案');
    pl.push('━━━━━━━━━━━━━━━━━━━━━');
    pdfLinks.forEach(function (l) {
      pl.push(l.教科 + ': ' + l.url);
    });
    pl.push('');
  }
  if (commentLines.length) {
    pl.push('━━━━━━━━━━━━━━━━━━━━━');
    pl.push('■ 担当講師より');
    pl.push('━━━━━━━━━━━━━━━━━━━━━');
    commentLines.forEach(function (l) { pl.push(l); });
    pl.push('');
  }
  var explanationUrl = Settings.get('explanation_zoom_url', '');
  var explanationPasscode = Settings.get('explanation_zoom_passcode', '');
  if (explanationUrl) {
    pl.push('━━━━━━━━━━━━━━━━━━━━━');
    pl.push('■ 解説 Zoom');
    pl.push('━━━━━━━━━━━━━━━━━━━━━');
    pl.push('URL: ' + explanationUrl);
    if (explanationPasscode) pl.push('パスコード: ' + explanationPasscode);
    pl.push('');
  }
  pl.push('引き続き学習に励んでください。');
  pl.push('');
  pl.push(schoolName);
  var plain = pl.join('\n');

  // ----- HTML -----
  var html = _buildResultMailHtml({
    name: name,
    studentId: studentId,
    grade: grade,
    schoolName: schoolName,
    subjects: subjects,
    totalScore: totalScore,
    totalMaxScore: totalMaxScore,
    totalRank: totalRank,
    totalCount: totalCount,
    pdfLinks: pdfLinks,
    commentLines: commentLines,
    explanationUrl: explanationUrl,
    explanationPasscode: explanationPasscode
  });

  return { to: to, cc: cc, subject: subject, plain: plain, html: html };
}

function _buildResultMailHtml(d) {
  var esc = Util.escapeHtml;
  var subjectsRows = d.subjects.map(function (r) {
    var rank = r.順位 ? esc(r.順位) + ' 位 / ' + esc(d.totalCount) + ' 名中' : '—';
    return '<tr>' +
      '<td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;width:90px">' + esc(r.教科) + '</td>' +
      '<td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;font-size:18px">' + esc(r.点数) + ' <span style="font-weight:400;font-size:13px;color:#666">/ ' + esc(r.満点 || 100) + '</span></td>' +
      '<td style="padding:8px;border:1px solid #ddd;color:#1b2a4a">' + rank + '</td>' +
      '</tr>';
  }).join('');
  var commentBlock = '';
  if (d.commentLines.length) {
    commentBlock =
      '<h3 style="color:#1b2a4a;border-left:4px solid #c9a84c;padding-left:10px;margin:24px 0 10px">担当講師より</h3>' +
      '<div style="background:#faf8f3;padding:12px 14px;border-radius:6px;font-size:14px">' +
      d.commentLines.map(function (l) { return '<div style="margin:6px 0">' + esc(l) + '</div>'; }).join('') +
      '</div>';
  }
  var pdfBlock = '';
  if (d.pdfLinks.length) {
    pdfBlock =
      '<h3 style="color:#1b2a4a;border-left:4px solid #c9a84c;padding-left:10px;margin:24px 0 10px">採点済答案</h3>' +
      '<ul style="padding-left:20px;font-size:14px">' +
      d.pdfLinks.map(function (l) {
        return '<li style="margin:4px 0"><strong>' + esc(l.教科) + ':</strong> <a href="' + esc(l.url) + '">' + esc(l.url) + '</a></li>';
      }).join('') +
      '</ul>';
  }
  var explanationBlock = '';
  if (d.explanationUrl) {
    explanationBlock =
      '<h3 style="color:#1b2a4a;border-left:4px solid #c9a84c;padding-left:10px;margin:24px 0 10px">解説 Zoom</h3>' +
      '<p style="font-size:14px"><a href="' + esc(d.explanationUrl) + '">' + esc(d.explanationUrl) + '</a>' +
      (d.explanationPasscode ? '<br>パスコード: <strong>' + esc(d.explanationPasscode) + '</strong>' : '') + '</p>';
  }
  return [
    '<div style="font-family:-apple-system,Segoe UI,Hiragino Sans,Noto Sans JP,sans-serif;max-width:640px;margin:auto;color:#1a1a1a;line-height:1.7">',
    '<div style="background:#1b2a4a;color:#fff;padding:18px 20px;border-bottom:3px solid #c9a84c">',
    '<div style="font-size:11px;letter-spacing:0.25em;color:#e8c96a">SUNDAI USA</div>',
    '<div style="font-size:18px;font-weight:700;margin-top:4px">' + esc(d.schoolName) + ' 結果のお知らせ</div>',
    '<div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:4px">' + esc(d.studentId) + ' / ' + esc(d.grade) + '</div>',
    '</div>',
    '<div style="padding:22px;background:#fff">',
    '<p>' + esc(d.name) + ' 様 / 保護者様</p>',
    '<p>このたびはご参加いただきありがとうございました。結果をお知らせいたします。</p>',
    '<h3 style="color:#1b2a4a;border-left:4px solid #c9a84c;padding-left:10px;margin:24px 0 10px">教科別結果</h3>',
    '<table style="border-collapse:collapse;width:100%;margin:0">',
    '<thead><tr><th style="padding:8px;border:1px solid #ddd;background:#1b2a4a;color:#fff;text-align:left">教科</th><th style="padding:8px;border:1px solid #ddd;background:#1b2a4a;color:#fff;text-align:right">点数</th><th style="padding:8px;border:1px solid #ddd;background:#1b2a4a;color:#fff;text-align:left">順位</th></tr></thead>',
    '<tbody>' + subjectsRows + '</tbody>',
    '<tfoot><tr><td style="padding:10px 8px;border:1px solid #ddd;background:#faf8f3;font-weight:700">合計</td>' +
    '<td style="padding:10px 8px;border:1px solid #ddd;background:#faf8f3;text-align:right;font-weight:700;font-size:20px;color:#1b2a4a">' + esc(d.totalScore) + ' <span style="font-weight:400;font-size:13px;color:#666">/ ' + esc(d.totalMaxScore) + '</span></td>' +
    '<td style="padding:10px 8px;border:1px solid #ddd;background:#faf8f3;font-weight:700;color:#1b2a4a">' + (d.totalRank ? esc(d.totalRank) + ' 位 / ' + esc(d.totalCount) + ' 名中' : '—') + '</td></tr></tfoot>',
    '</table>',
    pdfBlock,
    commentBlock,
    explanationBlock,
    '<hr style="border:0;border-top:1px solid #ddd;margin:28px 0">',
    '<p style="font-size:13px;color:#666">引き続き学習に励んでください。</p>',
    '<p style="font-size:13px;color:#888;margin-top:6px">' + esc(d.schoolName) + '</p>',
    '</div>',
    '</div>'
  ].join('');
}
