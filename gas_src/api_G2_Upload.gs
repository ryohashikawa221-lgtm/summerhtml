/**
 * api_G2_Upload.gs (goudou_enshu_app)
 * G-2 答案アップロード API (★ 5/17 当日心臓部 ★)
 *
 * 来歴: 2026-05-03 新規作成 (HANDOFF §4 G-2 仕様準拠)。
 *
 * フロー (HANDOFF §4 シーケンス):
 *   1. 保護者が確認メール内 URL から G-2 画面に到達 (?role=upload&id=MI-001)
 *   2. Code.doGet → _renderUploadPage → bootstrap で受験生情報を渡す
 *   3. 保護者が教科を選び PDF or 画像 1+ をアップロード
 *   4. このファイル: g2_uploadAnswer(payload) が呼ばれて以下を実行:
 *      - 受験番号バリデーション (校舎照合 + 受験生マスタ存在確認)
 *      - 教科バリデーション (学年 × 教科 妥当性 + 受験教科リスト所属)
 *      - ファイル種別判定 (pdf 単独 / image 1+)
 *      - 画像複数なら Drive.imagesToPdf で PDF 結合 (Settings で OFF 可)
 *      - ファイル名強制リネーム: {校舎}_{学年}_{受験番号}_{氏名}_{教科}.pdf
 *      - m_先生 から教科別 提出済フォルダ ID を引き、保存
 *      - 同一受験番号 × 教科 の既存 active 行があれば supersede
 *      - tx_答案 に新規 active 行を挿入
 *
 * セキュリティ: doGet がパブリック実行を許す前提なので、studentId だけで認証は通る。
 *               悪意ある第三者が他人の受験番号を知っていればアップロードできるが、
 *               採点は事務局チェックを通すため事故は影響限定的。
 *               必要なら確認メールにワンタイムトークンを足す改修可。
 */

/**
 * G-2 答案アップロードのメイン API。
 * @param {object} payload {studentId, subject, files: [{name, mimeType, base64}]}
 * @return {object} {ok: true, fileId, fileUrl, fileName, supersededFileId?} | {ok: false, error}
 */
function g2_uploadAnswer(payload) {
  var startMs = new Date().getTime();
  try {
    if (!payload) throw new Error('payload が空です');
    var studentId = String(payload.studentId || '').trim();
    var subject = String(payload.subject || '').trim();
    var files = payload.files || [];
    if (!studentId) throw new Error('受験番号が指定されていません');
    if (!subject) throw new Error('教科が選択されていません');
    if (!files.length) throw new Error('ファイルが指定されていません');

    // ----- 1. 受験生マスタ照合 -----
    var campus = Schema.campusOfStudentId(studentId);
    if (!campus) throw new Error('受験番号の形式が不正です: ' + studentId);
    var sheetName = Schema.studentSheetName(campus);
    var student = SheetDB.findOne(sheetName, { 受験番号: studentId });
    if (!student) throw new Error('受験番号 ' + studentId + ' は登録されていません');

    var grade = String(student.学年 || '').trim();
    var name = String(student.氏名 || '').trim();
    if (!grade || !name) throw new Error('受験生マスタの 学年/氏名 が空です: ' + studentId);

    // ----- 2. 教科バリデーション -----
    var allowedSubjects = String(student.受験教科 || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (allowedSubjects.indexOf(subject) === -1) {
      throw new Error(name + ' さんの受験教科ではありません: ' + subject +
        ' (受験予定: ' + allowedSubjects.join(', ') + ')');
    }
    var v = Schema.validateSubjects(grade, [subject]);
    if (!v.valid) {
      throw new Error('学年 ' + grade + ' で受験できない教科: ' + v.invalid.join(', '));
    }

    // ----- 3. m_先生 から提出先フォルダ取得 -----
    var folderId = Drive.getSubjectFolderId('提出済', grade, subject);
    if (!folderId) {
      throw new Error('提出先フォルダが未設定です: ' + grade + ' ' + subject +
        ' (管理者: ensureFolders() を実行してください)');
    }

    // ----- 4. ファイル変換: PDF 単独 or 画像 → 結合 PDF -----
    var blob = _buildSubmissionBlob(files);
    var fileType = blob._goudouFileType;  // 'pdf' | 'image_merged' | 'image'

    // ----- 5. ファイル名強制 -----
    // {校舎}_{学年}_{受験番号}_{氏名}_{教科}.pdf
    var baseName = [campus, grade, studentId, name, subject].join('_');
    var ext = '.pdf';
    if (fileType === 'image') ext = _imageExtFromMime(blob.getContentType()) || '.jpg';
    var fileName = baseName + ext;
    blob.setName(fileName);

    // ----- 6. supersede (同一受験番号 × 教科 の既存 active 行があれば) -----
    var supersededFileId = null;
    var existing = SheetDB.find('tx_答案', { 受験番号: studentId, 教科: subject, ステータス: 'active' });
    if (existing.length > 0) {
      var oldRow = existing[0];
      try {
        Drive.supersedeFile(oldRow.ファイルID,
          '_superseded_' + Utilities.formatDate(new Date(), Util.getTz(), 'yyyyMMdd_HHmmss'));
      } catch (e) {
        Logger.log('supersede file failed (continuing): ' + e.message);
      }
      SheetDB.update('tx_答案', oldRow.id, {
        ステータス: 'superseded',
        備考: (oldRow.備考 || '') + ' [' + Util.nowIso() + ' に再アップロードで supersede]'
      });
      supersededFileId = oldRow.ファイルID;
    }

    // ----- 7. Drive 保存 -----
    var savedFile = Drive.saveBlobToFolder(blob, folderId, fileName);
    var fileId = savedFile.getId();
    var fileUrl = Drive.getViewUrl(fileId);

    // ----- 8. tx_答案 に行追加 -----
    var uploadId = Util.uuid();
    var rowId = SheetDB.insert('tx_答案', {
      アップロードID: uploadId,
      校舎: campus,
      受験番号: studentId,
      氏名: name,
      学年: grade,
      教科: subject,
      ファイルID: fileId,
      ファイル名: fileName,
      ファイル種別: fileType,
      アップロード日時: Util.nowIso(),
      ステータス: 'active',
      採点済フラグ: 0,
      合計点: '',
      備考: supersededFileId ? '再アップロード (旧 fileId=' + supersededFileId + ')' : ''
    });

    var elapsedMs = new Date().getTime() - startMs;
    Logger.log('[G-2] uploaded ' + studentId + ' ' + subject + ' (' + fileType + ', ' +
      Math.round(blob.getBytes().length / 1024) + 'KB) in ' + elapsedMs + 'ms');

    return {
      ok: true,
      uploadId: uploadId,
      txId: rowId,
      fileId: fileId,
      fileUrl: fileUrl,
      fileName: fileName,
      fileType: fileType,
      supersededFileId: supersededFileId,
      message: subject + ' の答案を受け取りました。',
      elapsedMs: elapsedMs
    };
  } catch (err) {
    Logger.log('[G-2] ERROR: ' + (err && err.stack ? err.stack : err.message));
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

/**
 * 送信されたファイル群を 1 つの提出 Blob にまとめる。
 * - PDF が混じっている / PDF 単独 → 1 個目の PDF をそのまま使う (複数 PDF はサポート外)
 * - 画像複数 → Drive.imagesToPdf で結合 (Settings.enable_image_to_pdf が true のときのみ)
 * - 画像 1 枚 → そのまま (拡張子は元 mime に従う)
 *
 * @param {Array<{name, mimeType, base64}>} files
 * @return {Blob} 追加プロパティ _goudouFileType を持つ Blob
 */
function _buildSubmissionBlob(files) {
  var blobs = files.map(function (f) {
    if (!f.base64) throw new Error('ファイル ' + f.name + ' の base64 データがありません');
    var bytes = Utilities.base64Decode(f.base64);
    var mime = f.mimeType || _guessMime(f.name);
    return Utilities.newBlob(bytes, mime, f.name);
  });

  var pdfBlobs = blobs.filter(function (b) { return b.getContentType() === 'application/pdf'; });
  var imgBlobs = blobs.filter(function (b) { return /^image\//.test(b.getContentType()); });
  var unknownBlobs = blobs.filter(function (b) {
    var t = b.getContentType();
    return t !== 'application/pdf' && !/^image\//.test(t);
  });

  if (unknownBlobs.length > 0) {
    throw new Error('未対応の形式が含まれています: ' +
      unknownBlobs.map(function (b) { return b.getName(); }).join(', ') +
      ' (PDF または画像のみ受付)');
  }

  if (pdfBlobs.length === 1 && imgBlobs.length === 0) {
    pdfBlobs[0]._goudouFileType = 'pdf';
    return pdfBlobs[0];
  }
  if (pdfBlobs.length > 1) {
    throw new Error('複数 PDF の同時アップロードは未対応です。1 教科 1 PDF にまとめてアップロードしてください。');
  }
  if (pdfBlobs.length === 1 && imgBlobs.length > 0) {
    throw new Error('PDF と画像の混在アップロードは未対応です。どちらか一方にまとめてください。');
  }
  // 画像のみ
  if (imgBlobs.length === 1) {
    imgBlobs[0]._goudouFileType = 'image';
    return imgBlobs[0];
  }
  // 画像複数 → 結合
  var enableMerge = Settings.get('enable_image_to_pdf', 'true');
  if (enableMerge !== true && enableMerge !== 'true' && enableMerge !== 'TRUE' && Number(enableMerge) !== 1) {
    throw new Error('画像複数枚の PDF 結合機能が無効化されています。スマホでスキャンする場合は ' +
      'Adobe Scan / CamScanner 等で 1 つの PDF にまとめてからアップロードしてください。');
  }
  var merged = Drive.imagesToPdf(imgBlobs, 'merged_' + Utilities.getUuid());
  merged._goudouFileType = 'image_merged';
  return merged;
}

function _guessMime(fileName) {
  var ext = String(fileName || '').toLowerCase().split('.').pop();
  var map = {
    'pdf': 'application/pdf',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'heic': 'image/heic',
    'webp': 'image/webp',
    'gif': 'image/gif'
  };
  return map[ext] || 'application/octet-stream';
}

function _imageExtFromMime(mime) {
  return ({
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/heic': '.heic',
    'image/webp': '.webp',
    'image/gif': '.gif'
  })[mime] || '';
}

/**
 * クライアントから「現在の提出状況」を問い合わせる API
 * (再訪時に「国語: 提出済 / 数学: 未提出 / 英語: 未提出」を表示するため)
 */
function g2_getSubmissionStatus(studentId) {
  try {
    if (!studentId) throw new Error('studentId is required');
    var rows = SheetDB.find('tx_答案', { 受験番号: studentId, ステータス: 'active' });
    var bySubject = {};
    rows.forEach(function (r) {
      bySubject[r.教科] = {
        uploadedAt: r.アップロード日時,
        fileName: r.ファイル名,
        fileType: r.ファイル種別
      };
    });
    return { ok: true, submissions: bySubject };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
