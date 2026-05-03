/**
 * lib_Mail.gs
 * MailApp.sendEmail ラッパ。
 *
 * 来歴: hoshuko_app より移植 (2026-05-03)。GmailApp ではなく MailApp を使う方針
 *       (Workspace 非依存) を引き継ぎ。kill switch (D-049) を G-3 一斉配信用に
 *       そのまま流用 (Settings.bulk_mail_send_enabled で守る)。
 */

const Mailer = (function () {

  function send(opts) {
    if (!opts || !opts.to || !opts.subject) throw new Error('to / subject 必須');

    // ============================================================
    // 一斉送信 kill switch (D-049、hoshuko_app からの教訓)
    //   bulk=true のメールは Settings.bulk_mail_send_enabled が明示的に true
    //   でないと throw して送信拒否。
    //   個別 1 件メール (申込確認 / 採点完了通知 等) は bulk フラグなしで通常動作。
    // ============================================================
    if (opts.bulk === true) {
      var enabled;
      try {
        enabled = Settings.get('bulk_mail_send_enabled', false);
      } catch (e) {
        enabled = false;
      }
      var ok = (enabled === true || enabled === 'true' || Number(enabled) === 1 || enabled === 'TRUE');
      if (!ok) {
        throw new Error('[KILL SWITCH] 一斉送信は無効化されています。' +
          'Settings.bulk_mail_send_enabled を true にしてください (Ryo の明示 GO 後のみ)。' +
          ' 送信拒否: to=' + opts.to + ' subject=' + opts.subject);
      }
      Logger.log('[Mailer] bulk=true 一斉送信、kill switch 通過: to=' + opts.to);
    }

    var quotaRemaining = MailApp.getRemainingDailyQuota();
    if (quotaRemaining <= 0) throw new Error('Mail 送信枠を使い切りました。明日再度お試しください。');

    var body = opts.plainBody || _stripHtml(opts.htmlBody || '');
    var sendOptions = {
      to: opts.to,
      subject: opts.subject,
      body: body,
      name: opts.name || Settings.get('school_name', '駿台USA合同演習会')
    };
    if (opts.cc) sendOptions.cc = opts.cc;
    if (opts.htmlBody) sendOptions.htmlBody = opts.htmlBody;
    if (opts.attachments && opts.attachments.length) sendOptions.attachments = opts.attachments;
    if (opts.replyTo) sendOptions.replyTo = opts.replyTo;

    MailApp.sendEmail(sendOptions);
    return true;
  }

  function notifyAdmin(subject, body) {
    var to = Settings.get('admin_notify_email', '');
    if (!to) {
      try { to = Session.getActiveUser().getEmail(); } catch (e) { to = ''; }
    }
    if (!to) return false;
    return send({ to: to, subject: '[合同演習会] ' + subject, htmlBody: body });
  }

  function _stripHtml(html) {
    return String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  return {
    send: send,
    notifyAdmin: notifyAdmin
  };
})();
