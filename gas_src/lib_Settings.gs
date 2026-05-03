/**
 * lib_Settings.gs (goudou_enshu_app)
 * 'm_設定' シートの key-value アクセス & Drive ルートフォルダ管理 & kill switch。
 *
 * 来歴: hoshuko_app の Settings.gs を移植 (2026-05-03)。
 *   - シート名: '学校設定' → 'm_設定'
 *   - bootstrap デフォルト値を goudou_enshu_app 用に書き換え
 *   - normalizeWebAppUrl: role='upload' / 'apply' に変更
 *     (hoshuko の 'parent' / 'returnee' から goudou のフロー名に)
 *   - ensureDriveFolder: ルート名を '駿台USA合同演習会' に変更
 */

const Settings = (function () {

  var _cache = null;

  function _load() {
    if (_cache) return _cache;
    var rows;
    try {
      rows = SheetDB.find('m_設定');
    } catch (e) {
      rows = [];
    }
    _cache = {};
    rows.forEach(function (r) {
      _cache[r.key] = r.value;
    });
    return _cache;
  }

  function reset() { _cache = null; }

  function get(key, fallback) {
    var v = _load()[key];
    if (v === undefined || v === '') return fallback;
    return v;
  }

  function set(key, value, description) {
    var existing = SheetDB.findOne('m_設定', { key: key });
    if (existing) {
      SheetDB.update('m_設定', existing.id, {
        key: key,
        value: value,
        description: description || existing.description,
        updated_at: Util.nowIso()
      });
    } else {
      SheetDB.insert('m_設定', {
        key: key,
        value: value,
        description: description || '',
        updated_at: Util.nowIso()
      });
    }
    reset();
  }

  /**
   * 既定値を 'm_設定' シートに投入。既存値は上書きしない。
   */
  function bootstrap() {
    var defaults = {
      school_name: '駿台USA合同演習会',
      timezone: 'America/Detroit',
      current_year: '2026',
      event_date: '2026-05-17',
      application_deadline: '',
      currency: 'USD',
      root_drive_folder_id: '',
      submitted_root_folder_id: '',
      graded_root_folder_id: '',
      admin_notify_email: '',
      bulk_mail_send_enabled: 'false',
      upload_web_app_url: '',
      apply_web_app_url: '',
      // 教科満点 (G-3 配信メールで使用)。要件未確定なので暫定 100 点。
      max_score_kokugo: '100',
      max_score_sugaku: '100',
      max_score_sansu: '100',
      max_score_eigo: '100',
      // 画像 → PDF 結合機能の ON/OFF (HANDOFF G-2 シンプル化方針:
      // 1日以上かかるなら PDF のみに切る)
      enable_image_to_pdf: 'true',
      // 解説 Zoom (G-6 案内ドキュメントに差し込み)
      explanation_zoom_url: '',
      explanation_zoom_passcode: ''
    };
    Object.keys(defaults).forEach(function (k) {
      var existing = SheetDB.findOne('m_設定', { key: k });
      if (!existing) {
        SheetDB.insert('m_設定', {
          key: k,
          value: defaults[k],
          description: _description(k),
          updated_at: Util.nowIso()
        });
      }
    });
    reset();
  }

  function _description(k) {
    return ({
      school_name: '送信メールの送信者名表示等で使用',
      timezone: 'タイムゾーン (IANA)',
      current_year: '現在の年度',
      event_date: '演習会開催日 YYYY-MM-DD',
      application_deadline: '申込締切日 YYYY-MM-DD',
      currency: '通貨コード',
      root_drive_folder_id: 'goudou_enshu_app の Drive ルートフォルダ ID',
      submitted_root_folder_id: '答案_提出済 親フォルダ ID',
      graded_root_folder_id: '答案_採点済 親フォルダ ID',
      admin_notify_email: '管理者通知メール宛先 (Mailer.notifyAdmin で使用)',
      bulk_mail_send_enabled: 'G-3 一斉配信の kill switch (Ryo の明示 GO 後に true、終了後 false に戻す)',
      upload_web_app_url: 'G-2 答案アップロード画面の WebApp URL (?role=upload 強制付与)',
      apply_web_app_url: 'G-1 申込フォームの WebApp URL (?role=apply 強制付与)',
      max_score_kokugo: '国語 満点',
      max_score_sugaku: '数学 (中3) 満点',
      max_score_sansu: '算数 (小6) 満点',
      max_score_eigo: '英語 満点',
      enable_image_to_pdf: 'true=画像複数ファイルを GAS で PDF 結合、false=PDF のみ受付',
      explanation_zoom_url: '結果配信後の解説 Zoom URL (案内ドキュメントに差し込み)',
      explanation_zoom_passcode: '解説 Zoom パスコード'
    })[k] || '';
  }

  // ============================================================
  // Drive フォルダ ensure (goudou_enshu_app 用)
  //   ルート: '駿台USA合同演習会'
  //   その下に '答案_提出済' / '答案_採点済' を作り、各々の下に
  //   {学年}_{教科}_{先生} のサブフォルダを ensure する。
  // ============================================================

  /**
   * goudou_enshu_app のルート Drive フォルダを返す (なければ作る)
   */
  function ensureRootFolder() {
    var rootId = get('root_drive_folder_id', '');
    var root;
    if (rootId) {
      try { return DriveApp.getFolderById(rootId); }
      catch (e) { /* fallthrough to recreate */ }
    }
    root = _findOrCreateRootFolder('駿台USA合同演習会');
    set('root_drive_folder_id', root.getId(), 'goudou_enshu_app の Drive ルートフォルダ ID');
    return root;
  }

  /**
   * 答案_提出済 / 答案_採点済 親フォルダを ensure。
   * @param {string} type '提出済' | '採点済'
   */
  function ensureCategoryRootFolder(type) {
    if (type !== '提出済' && type !== '採点済') {
      throw new Error('type は "提出済" or "採点済" のみ。実際: ' + type);
    }
    var settingKey = (type === '提出済') ? 'submitted_root_folder_id' : 'graded_root_folder_id';
    var existingId = get(settingKey, '');
    if (existingId) {
      try { return DriveApp.getFolderById(existingId); }
      catch (e) { /* fallthrough */ }
    }
    var root = ensureRootFolder();
    var folder = _findOrCreateChild(root, '答案_' + type);
    set(settingKey, folder.getId(),
        type === '提出済' ? '答案_提出済 親フォルダ ID' : '答案_採点済 親フォルダ ID');
    return folder;
  }

  function _findOrCreateRootFolder(name) {
    var it = DriveApp.getFoldersByName(name);
    if (it.hasNext()) return it.next();
    return DriveApp.createFolder(name);
  }

  function _findOrCreateChild(parent, name) {
    var it = parent.getFoldersByName(name);
    if (it.hasNext()) return it.next();
    return parent.createFolder(name);
  }

  function listAll() {
    return SheetDB.find('m_設定');
  }

  // ============================================================
  // Web app URL の ?role 強制付与 (hoshuko 4/27 事故由来の防御)
  //   goudou_enshu_app では role='upload' / 'apply' を使う:
  //     upload = G-2 答案アップロード画面 (保護者向け)
  //     apply  = G-1 申込フォーム (保護者向け)
  //   (admin ダッシュボード等は別 URL でも、role 区別は当面不要)
  // ============================================================
  var ALLOWED_ROLES = ['upload', 'apply'];

  function normalizeWebAppUrl(role, url) {
    if (ALLOWED_ROLES.indexOf(role) === -1) {
      throw new Error('role は ' + ALLOWED_ROLES.join('/') + ' のみ。実際: ' + role);
    }
    if (!url) return '';
    var u = String(url);
    var roleMatch = u.match(/[?&]role=([a-z]+)/);
    if (roleMatch) {
      if (roleMatch[1] === role) return u;
      Logger.log('⚠ Settings.normalizeWebAppUrl: URL に異なる role=' + roleMatch[1] +
                 ' が含まれていたため "' + role + '" に置換: ' + u);
      return u.replace(/([?&])role=[a-z]+/, '$1role=' + role);
    }
    var sep = u.indexOf('?') >= 0 ? '&' : '?';
    return u + sep + 'role=' + role;
  }

  function setWebAppUrl(role, rawUrl) {
    if (!rawUrl) throw new Error('URL is required');
    var canonical = normalizeWebAppUrl(role, rawUrl);
    set(role + '_web_app_url', canonical,
        role + ' 用 Web app URL (?role=' + role + ' 強制付与済)');
    return canonical;
  }

  function getWebAppUrl(role) {
    if (ALLOWED_ROLES.indexOf(role) === -1) {
      throw new Error('role は ' + ALLOWED_ROLES.join('/') + ' のみ');
    }
    var raw = get(role + '_web_app_url', '');
    if (!raw) return '';
    return normalizeWebAppUrl(role, raw);
  }

  // ============================================================
  // 一斉送信 kill switch (D-049、G-3 結果配信用)
  // ============================================================
  function isBulkMailEnabled() {
    var v = get('bulk_mail_send_enabled', false);
    return v === true || v === 'true' || v === 'TRUE' || Number(v) === 1;
  }

  function setBulkMailEnabled(enabled) {
    set('bulk_mail_send_enabled', enabled === true ? 'true' : 'false',
        'G-3 一斉配信 kill switch、本送信時のみ true、終了後 false に戻すこと');
    return enabled === true;
  }

  return {
    get: get,
    set: set,
    bootstrap: bootstrap,
    reset: reset,
    listAll: listAll,
    ensureRootFolder: ensureRootFolder,
    ensureCategoryRootFolder: ensureCategoryRootFolder,
    normalizeWebAppUrl: normalizeWebAppUrl,
    setWebAppUrl: setWebAppUrl,
    getWebAppUrl: getWebAppUrl,
    isBulkMailEnabled: isBulkMailEnabled,
    setBulkMailEnabled: setBulkMailEnabled
  };
})();
