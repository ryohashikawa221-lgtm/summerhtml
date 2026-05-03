/**
 * lib_Drive.gs (goudou_enshu_app)
 * Drive 操作の薄いラッパ。G-2 答案アップロード / G-3 採点済移動 で使用。
 *
 * 来歴: 2026-05-03 新規作成 (hoshuko_app には Drive 抽象なし)。
 *
 * 提供 API:
 *   - getFolderById(id)
 *   - findOrCreateChild(parent, name)
 *   - saveBlobToFolder(blob, folderId, fileName)
 *   - moveFile(fileId, toFolderId)
 *   - renameFile(fileId, newName)
 *   - supersedeFile(fileId, suffix)        // 再アップロード時の旧ファイル退避
 *   - imagesToPdf(blobs, fileName)         // 画像複数 → 1 PDF (DocumentApp 経由)
 *   - getSubjectFolderId(category, grade, subject) // m_先生 から ID 引き
 *   - ensureSubjectFolders()               // m_先生 全行のフォルダを ensure
 */

const Drive = (function () {

  function getFolderById(id) {
    if (!id) throw new Error('folderId is required');
    return DriveApp.getFolderById(id);
  }

  function getFileById(id) {
    if (!id) throw new Error('fileId is required');
    return DriveApp.getFileById(id);
  }

  function findOrCreateChild(parent, name) {
    var it = parent.getFoldersByName(name);
    if (it.hasNext()) return it.next();
    return parent.createFolder(name);
  }

  /**
   * Blob を指定フォルダに保存。同名ファイルがあれば上書きはせず、まず supersede する設計。
   * (再アップロードの一次ハンドリングは API 層で行う)
   * @param {Blob} blob
   * @param {string} folderId
   * @param {string} fileName
   * @return {GoogleAppsScript.Drive.File}
   */
  function saveBlobToFolder(blob, folderId, fileName) {
    var folder = getFolderById(folderId);
    var named = blob.setName(fileName);
    return folder.createFile(named);
  }

  /**
   * ファイルを別フォルダに移動 (元の親から外す)。
   * Drive は 1 ファイル N 親が可能だが、ここでは「1 親」運用を強制する
   * (採点済への移動 = 提出済から外して採点済に追加)。
   */
  function moveFile(fileId, toFolderId) {
    var file = getFileById(fileId);
    var toFolder = getFolderById(toFolderId);
    var parents = file.getParents();
    while (parents.hasNext()) {
      var p = parents.next();
      if (p.getId() !== toFolderId) {
        p.removeFile(file);
      }
    }
    var alreadyIn = false;
    var checkParents = file.getParents();
    while (checkParents.hasNext()) {
      if (checkParents.next().getId() === toFolderId) { alreadyIn = true; break; }
    }
    if (!alreadyIn) toFolder.addFile(file);
    return file;
  }

  function renameFile(fileId, newName) {
    var file = getFileById(fileId);
    file.setName(newName);
    return file;
  }

  /**
   * 旧ファイルを supersede (リネームして識別、所定の親に残す)。
   * @param {string} fileId 旧ファイル ID
   * @param {string} suffix 例: '_superseded_20260517_103045'
   */
  function supersedeFile(fileId, suffix) {
    var file = getFileById(fileId);
    var oldName = file.getName();
    file.setName(oldName + (suffix || '_superseded'));
    return file;
  }

  /**
   * 画像 Blob 配列 → 1 PDF Blob に結合。
   *
   * 実装方針:
   *   GAS の DocumentApp で一時 Doc を作成 → 各画像を appendImage → PDF export
   *   → 一時 Doc は trash 移動 (削除)。
   *
   * 制約:
   *   - GAS 実行 6 分制限。画像 N=5 程度想定なら 30 秒以内で完了する見込み。
   *   - 画像が極端に大きい場合 (> 25MB/枚) は Doc が落ちることがある。呼び出し側で
   *     事前にリサイズしてから渡すことが望ましい (UI 側で canvas 縮小)。
   *
   * @param {Blob[]} imageBlobs
   * @param {string} pdfName 拡張子なしの PDF ファイル名 (.pdf は自動付与)
   * @return {Blob} application/pdf の Blob
   */
  function imagesToPdf(imageBlobs, pdfName) {
    if (!imageBlobs || imageBlobs.length === 0) {
      throw new Error('画像 Blob が空です');
    }
    var docName = '_tmp_pdf_merge_' + Utilities.getUuid();
    var doc = DocumentApp.create(docName);
    var body = doc.getBody();
    body.setMarginTop(20).setMarginBottom(20).setMarginLeft(20).setMarginRight(20);
    // 既定の空 paragraph を消すと append 順序が安定する
    try { body.clear(); } catch (e) {}

    for (var i = 0; i < imageBlobs.length; i++) {
      var blob = imageBlobs[i];
      try {
        var img = body.appendImage(blob);
        // ページ幅にフィット (US Letter 612pt - margins ≒ 572pt 想定)
        var maxWidth = 572;
        if (img.getWidth() > maxWidth) {
          var ratio = maxWidth / img.getWidth();
          img.setWidth(maxWidth);
          img.setHeight(img.getHeight() * ratio);
        }
      } catch (e) {
        Logger.log('imagesToPdf: appendImage 失敗 idx=' + i + ' err=' + e.message);
        body.appendParagraph('[画像 ' + (i + 1) + ' を埋め込めませんでした: ' + e.message + ']');
      }
      if (i < imageBlobs.length - 1) {
        body.appendPageBreak();
      }
    }
    doc.saveAndClose();

    var docFile = DriveApp.getFileById(doc.getId());
    var pdfBlob = docFile.getAs('application/pdf').setName((pdfName || 'merged') + '.pdf');
    docFile.setTrashed(true);  // 一時 Doc を削除 (PDF Blob はもう手元にある)
    return pdfBlob;
  }

  /**
   * m_先生 から (category, 学年, 教科) のフォルダ ID を取得。
   * @param {string} category '提出済' | '採点済'
   * @param {string} grade '中3' | '小6'
   * @param {string} subject '国語' | '数学' | '算数' | '英語'
   * @return {string|null} フォルダ ID
   */
  function getSubjectFolderId(category, grade, subject) {
    var rec = SheetDB.findOne('m_先生', { 学年: grade, 教科: subject });
    if (!rec) return null;
    return (category === '提出済') ? rec.提出済フォルダID : rec.採点済フォルダID;
  }

  /**
   * m_先生 全行に対して 提出済 / 採点済 の Drive フォルダを ensure し、
   * フォルダ ID を m_先生 シートに書き戻す。
   * 初期セットアップ + フォルダ消失時の自己修復で使う。
   * @return {Array} 結果レポート
   */
  function ensureSubjectFolders() {
    var teachers = SheetDB.find('m_先生');
    var report = [];
    var submittedRoot = Settings.ensureCategoryRootFolder('提出済');
    var gradedRoot = Settings.ensureCategoryRootFolder('採点済');

    teachers.forEach(function (t) {
      var subFolderName = t.学年 + '_' + t.教科 + '_' + (t.先生 || '');
      // 提出済
      var submittedFolder = findOrCreateChild(submittedRoot, subFolderName);
      // 採点済
      var gradedFolder = findOrCreateChild(gradedRoot, subFolderName);

      var update = {};
      var changed = false;
      if (t.提出済フォルダID !== submittedFolder.getId()) {
        update.提出済フォルダID = submittedFolder.getId();
        changed = true;
      }
      if (t.採点済フォルダID !== gradedFolder.getId()) {
        update.採点済フォルダID = gradedFolder.getId();
        changed = true;
      }
      if (changed) {
        SheetDB.update('m_先生', t.id, update);
        report.push('UPDATED m_先生 id=' + t.id + ' (' + subFolderName + ')');
      } else {
        report.push('OK m_先生 id=' + t.id + ' (' + subFolderName + ')');
      }
    });
    return report;
  }

  /**
   * Web 共有 URL (preview) を取得
   */
  function getViewUrl(fileId) {
    var file = getFileById(fileId);
    return 'https://drive.google.com/file/d/' + file.getId() + '/view';
  }

  return {
    getFolderById: getFolderById,
    getFileById: getFileById,
    findOrCreateChild: findOrCreateChild,
    saveBlobToFolder: saveBlobToFolder,
    moveFile: moveFile,
    renameFile: renameFile,
    supersedeFile: supersedeFile,
    imagesToPdf: imagesToPdf,
    getSubjectFolderId: getSubjectFolderId,
    ensureSubjectFolders: ensureSubjectFolders,
    getViewUrl: getViewUrl
  };
})();
