/**
 * api_G6_DocGen.gs (goudou_enshu_app)
 * G-6 案内ドキュメント自動生成。
 *
 * 来歴: 2026-05-03 新規作成 (HANDOFF §4 G-6 仕様準拠)。
 *
 * 設計:
 *   - Google Docs テンプレート (前々セッション成果物 .docx を Docs にインポート) に
 *     {{開催日}} / {{申込締切日}} / {{解説Zoom_URL}} / {{解説Zoom_パスコード}} などの
 *     プレースホルダを埋め込んでおく
 *   - m_設定 シートに各テンプレの doc id を保存
 *     (key: tpl_doc_id_東部_中学受験 / tpl_doc_id_東部_高校受験 / ... 計 6 つ)
 *   - g6_generateAll() で 6 ファイルを一括生成、PDF エクスポートして Drive に保存
 *
 * ※ 初年度はテンプレ未整備なら手動更新でも可 (HANDOFF 注記)。
 *    その場合は g6_listMissingTemplates() で未設定テンプレを確認できる。
 */

var G6_REGIONS = ['東部', '中部', '太平洋部'];
var G6_CATEGORIES = ['中学受験', '高校受験'];

function g6_listMissingTemplates() {
  var missing = [];
  G6_REGIONS.forEach(function (region) {
    G6_CATEGORIES.forEach(function (cat) {
      var key = 'tpl_doc_id_' + region + '_' + cat;
      var v = Settings.get(key, '');
      if (!v) missing.push(key);
    });
  });
  return missing;
}

/**
 * 1 つのテンプレ → 1 PDF を生成し Drive に保存。
 * @param {string} region '東部' | '中部' | '太平洋部'
 * @param {string} category '中学受験' | '高校受験'
 * @return {object} {ok, fileId, fileUrl, fileName}
 */
function g6_generateOne(region, category) {
  if (G6_REGIONS.indexOf(region) === -1) throw new Error('region 不正: ' + region);
  if (G6_CATEGORIES.indexOf(category) === -1) throw new Error('category 不正: ' + category);

  var settingKey = 'tpl_doc_id_' + region + '_' + category;
  var templateId = Settings.get(settingKey, '');
  if (!templateId) throw new Error('テンプレ doc id 未設定: m_設定.' + settingKey);

  var year = Settings.get('current_year', '2026');
  var fileName = year + '年度駿台USA合同演習会_' + region + '_' + category;

  // テンプレを複製
  var templateFile = DriveApp.getFileById(templateId);
  var rootFolder = Settings.ensureRootFolder();
  var docFolder = Drive.findOrCreateChild(rootFolder, '案内ドキュメント_' + year);

  var copy = templateFile.makeCopy(fileName, docFolder);
  var copyId = copy.getId();
  var doc = DocumentApp.openById(copyId);
  var body = doc.getBody();

  // プレースホルダ置換
  var replacements = _buildReplacements();
  Object.keys(replacements).forEach(function (placeholder) {
    body.replaceText(_escapeRegex(placeholder), replacements[placeholder] || '');
  });
  doc.saveAndClose();

  // PDF エクスポート
  var pdfBlob = DriveApp.getFileById(copyId).getAs('application/pdf').setName(fileName + '.pdf');
  var pdfFile = docFolder.createFile(pdfBlob);

  // 元の Doc コピーは残す (再編集用)。PDF と Doc 両方を返す。
  return {
    ok: true,
    region: region,
    category: category,
    docId: copyId,
    docUrl: 'https://docs.google.com/document/d/' + copyId + '/edit',
    pdfId: pdfFile.getId(),
    pdfUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view',
    fileName: fileName + '.pdf'
  };
}

function g6_generateAll() {
  var missing = g6_listMissingTemplates();
  if (missing.length === G6_REGIONS.length * G6_CATEGORIES.length) {
    return {
      ok: false,
      error: 'テンプレ doc id が 1 つも設定されていません。' +
        '初年度は手動運用に倒し、来年度までに以下のキーをすべて m_設定 に登録してください: ' + missing.join(', ')
    };
  }
  var results = [];
  var failed = [];
  G6_REGIONS.forEach(function (region) {
    G6_CATEGORIES.forEach(function (cat) {
      try {
        results.push(g6_generateOne(region, cat));
      } catch (e) {
        failed.push({ region: region, category: cat, error: e.message });
      }
    });
  });
  return { ok: true, generated: results.length, results: results, failed: failed };
}

function _buildReplacements() {
  return {
    '{{開催日}}': Settings.get('event_date', ''),
    '{{申込締切日}}': Settings.get('application_deadline', ''),
    '{{解説Zoom_URL}}': Settings.get('explanation_zoom_url', ''),
    '{{解説Zoom_パスコード}}': Settings.get('explanation_zoom_passcode', ''),
    '{{年度}}': Settings.get('current_year', '2026'),
    '{{学校名}}': Settings.get('school_name', '駿台USA合同演習会')
  };
}

function _escapeRegex(s) {
  // DocumentApp.replaceText は正規表現を受けるので、メタ文字をエスケープ
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
