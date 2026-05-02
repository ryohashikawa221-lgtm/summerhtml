function outputRoster(silent) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const courses = getCourses();
  const enrollSheet = ss.getSheetByName(S_ENROLL);

  const rosterMap = {};
  if (enrollSheet && enrollSheet.getLastRow() > 1) {
    const enrollData = enrollSheet.getDataRange().getValues();
    for (let i = 1; i < enrollData.length; i++) {
      const coursesText = String(enrollData[i][6]||'');
      const parent = String(enrollData[i][2]||'');
      const email  = String(enrollData[i][3]||'');
      const studentsInfo = String(enrollData[i][5]||'');

      coursesText.split('\n').forEach(line => {
        const m = line.match(/[・•]\s*(.+?)（(\d+)T/);
        if (!m) return;
        const courseName = m[1].trim();
        const term = m[2];
        const courseInfo = courses.find(c => c['講座名'] === courseName && String(c['ターム']) === term);
        if (!courseInfo) return;
        const key = term + '|' + courseInfo['時間帯'] + '|' + courseName;
        if (!rosterMap[key]) rosterMap[key] = [];
        rosterMap[key].push({ student: studentsInfo, parent, email });
      });
    }
  }

  let outSheet = ss.getSheetByName(S_ROSTER);
  if (outSheet) ss.deleteSheet(outSheet);
  outSheet = ss.insertSheet(S_ROSTER);

  const TIMES = ['9:00〜10:30','10:30〜12:00','12:30〜14:00','14:00〜15:30','15:30〜17:00'];
  const TERMS = [...new Set(courses.map(c => Number(c['ターム'])))].filter(Boolean).sort((a,b)=>a-b);

  let outRow = 1;
  outSheet.getRange(outRow, 1).setValue('講座別名簿');
  outSheet.getRange(outRow, 1, 1, 5).merge().setBackground('#1b2a4a').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  outRow += 2;

  TERMS.forEach(term => {
    const termCourses = courses.filter(c => Number(c['ターム']) === term);
    if (!termCourses.length) return;
    const termDate = termCourses[0]['日程']||'';
    outSheet.getRange(outRow, 1).setValue('▼ ' + term + '期（' + termDate + '）');
    outSheet.getRange(outRow, 1, 1, 5).merge().setBackground('#243860').setFontColor('#fff')
      .setFontWeight('bold').setFontSize(11);
    outRow++;

    TIMES.forEach(time => {
      const slotCourses = termCourses.filter(c => c['時間帯'] === time);
      if (!slotCourses.length) return;
      outSheet.getRange(outRow, 1).setValue('  ' + time);
      outSheet.getRange(outRow, 1, 1, 5).merge().setBackground('#c9a84c').setFontColor('#1b2a4a')
        .setFontWeight('bold').setFontSize(10);
      outRow++;

      const seenCourses = new Set();
      slotCourses.forEach(c => {
        const key = term + '|' + time + '|' + c['講座名'];
        if (seenCourses.has(key)) return;
        seenCourses.add(key);
        const students = rosterMap[key] || [];
        const maxS = c['定員'] || 12;
        outSheet.getRange(outRow, 1).setValue('    ' + c['担当先生'] + '：' + c['講座名'] + '（' + students.length + '/' + maxS + '名）');
        outSheet.getRange(outRow, 1, 1, 5).merge()
          .setBackground(students.length >= maxS ? '#fee2e2' : '#f0fdf4')
          .setFontWeight('bold').setFontSize(10);
        outRow++;

        if (students.length > 0) {
          outSheet.getRange(outRow, 1, 1, 4).setValues([['No.','生徒情報','保護者名','メール']]);
          outSheet.getRange(outRow, 1, 1, 4).setBackground('#f0ebe0').setFontWeight('bold').setFontSize(9);
          outRow++;
          students.forEach((s, idx) => {
            outSheet.getRange(outRow, 1, 1, 4).setValues([[idx+1, s.student, s.parent, s.email]]);
            if (idx % 2 === 1) outSheet.getRange(outRow, 1, 1, 4).setBackground('#faf8f3');
            outSheet.getRange(outRow, 1, 1, 4).setFontSize(9);
            outRow++;
          });
        } else {
          outSheet.getRange(outRow, 1).setValue('    （申込なし）');
          outSheet.getRange(outRow, 1, 1, 5).merge().setFontColor('#999').setFontSize(9);
          outRow++;
        }
      });
      outRow++;
    });
    outRow++;
  });

  outSheet.setColumnWidth(1, 40);
  outSheet.setColumnWidth(2, 200);
  outSheet.setColumnWidth(3, 120);
  outSheet.setColumnWidth(4, 200);
  outSheet.setColumnWidth(5, 80);
  ss.setActiveSheet(outSheet);
  if (!silent) SpreadsheetApp.getUi().alert('✅ 講座別名簿を出力しました！');
}

// ============================================================
// 申込サマリー出力
// ============================================================
function outputSummary(silent) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const enrollSheet = ss.getSheetByName(S_ENROLL);
  const courses = getCourses();
  const counts = getCourseCounts();

  let outSheet = ss.getSheetByName(S_SUMMARY);
  if (outSheet) ss.deleteSheet(outSheet);
  outSheet = ss.insertSheet(S_SUMMARY);

  const now = new Date().toLocaleString('ja-JP');
  let outRow = 1;
  outSheet.getRange(outRow,1).setValue('申込サマリー　出力：' + now);
  outSheet.getRange(outRow,1,1,6).merge().setBackground('#1b2a4a').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(13);
  outRow++;

  let totalEnroll = 0, totalAmount = 0;
  if (enrollSheet && enrollSheet.getLastRow() > 1) {
    const data = enrollSheet.getDataRange().getValues();
    totalEnroll = data.length - 1;
    for (let i = 1; i < data.length; i++) {
      totalAmount += parseFloat(String(data[i][7]||'').replace('$','').replace(',',''))||0;
    }
  }

  outSheet.getRange(outRow,1,1,6).setValues([['申込件数: ' + totalEnroll + '件', '申込総額: $' + totalAmount.toFixed(0), '', '', '', '']]);
  outSheet.getRange(outRow,1,1,6).setBackground('#c9a84c').setFontColor('#1b2a4a').setFontWeight('bold').setFontSize(11);
  outRow += 2;

  const TIMES = ['9:00〜10:30','10:30〜12:00','12:30〜14:00','14:00〜15:30','15:30〜17:00'];
  const TERMS = [...new Set(courses.map(c => Number(c['ターム'])))].filter(Boolean).sort((a,b)=>a-b);

  TERMS.forEach(term => {
    const termCourses = courses.filter(c => Number(c['ターム']) === term);
    if (!termCourses.length) return;
    const termDate = termCourses[0]['日程']||'';
    outSheet.getRange(outRow,1).setValue(term + '期（' + termDate + '）');
    outSheet.getRange(outRow,1,1,6).merge().setBackground('#243860').setFontColor('#fff').setFontWeight('bold');
    outRow++;
    outSheet.getRange(outRow,1,1,6).setValues([['時間帯','先生','講座名','対象','定員','申込数']]);
    outSheet.getRange(outRow,1,1,6).setBackground('#f0ebe0').setFontWeight('bold').setFontSize(9);
    outRow++;

    TIMES.forEach(time => {
      const slotCourses = termCourses.filter(c => c['時間帯'] === time);
      const seen = new Set();
      slotCourses.forEach(c => {
        const key = c['講座名'] + '|' + term + '|' + time;
        if (seen.has(key)) return;
        seen.add(key);
        const cnt = counts[c['講座ID']] || 0;
        const maxS = c['定員'] || 12;
        outSheet.getRange(outRow,1,1,6).setValues([[time, c['担当先生'], c['講座名'], c['対象学年'], maxS, cnt]]);
        const bg = cnt >= maxS ? '#fee2e2' : cnt >= maxS*0.7 ? '#fff7ed' : '#fff';
        outSheet.getRange(outRow,1,1,6).setBackground(bg).setFontSize(9);
        outRow++;
      });
    });
    outRow++;
  });

  outSheet.setColumnWidth(1, 100);
  outSheet.setColumnWidth(2, 100);
  outSheet.setColumnWidth(3, 200);
  outSheet.setColumnWidth(4, 80);
  outSheet.setColumnWidth(5, 50);
  outSheet.setColumnWidth(6, 50);
  ss.setActiveSheet(outSheet);
  if (!silent) SpreadsheetApp.getUi().alert('✅ 申込サマリーを出力しました！');
}

// ============================================================
// 先生別時間割出力
// ============================================================
function outputTimetable(filter, silent) {
  // filter: { term?: number, teacher?: string } 指定時はそのターム/先生のみで出力
  // silent: true の場合は完了アラートを出さない（トリガーから呼ぶ時に使う）
  filter = filter || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const courses = getCourses();
  const enrollSheet = ss.getSheetByName(S_ENROLL);

  const studentMap = {};
  if (enrollSheet && enrollSheet.getLastRow() > 1) {
    const rows = enrollSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const courseText   = String(rows[i][6] || '');
      const studentsInfo = String(rows[i][5] || '');
      const names = studentsInfo.split('、')
        .map(s => s.replace(/（[^）]*）/g, '').trim())
        .filter(Boolean);

      courseText.split('\n').forEach(line => {
        const m = line.match(/[・•]\s*(.+?)（(\d+)T/);
        if (!m) return;
        const cname = m[1].trim();
        const term  = m[2];
        const info  = courses.find(c => c['講座名'] === cname && String(c['ターム']) === term);
        if (!info) return;
        const key = term + '|' + info['時間帯'] + '|' + cname;
        if (!studentMap[key]) studentMap[key] = [];
        names.forEach(n => { if (!studentMap[key].includes(n)) studentMap[key].push(n); });
      });
    }
  }

  // フィルタに応じて出力先シート名を切替
  const sheetName = filter.term && filter.teacher
      ? S_TIMETABLE + '_' + filter.term + '期_' + filter.teacher
    : filter.term
      ? S_TIMETABLE + '_' + filter.term + '期'
    : filter.teacher
      ? S_TIMETABLE + '_' + filter.teacher
    : S_TIMETABLE;

  let out = ss.getSheetByName(sheetName);
  if (out) ss.deleteSheet(out);
  out = ss.insertSheet(sheetName);

  const TIMES = ['9:00〜10:30','10:30〜12:00','12:30〜14:00','14:00〜15:30','15:30〜17:00'];
  const TEACHER_ORDER = ['坂本先生','嶋中先生','ゆい先生','宮嶋先生','八反田先生','橋川先生'];
  const teachersInData = [...new Set(courses.map(c => c['担当先生']).filter(Boolean))];
  let TEACHERS = [
    ...TEACHER_ORDER.filter(t => teachersInData.includes(t)),
    ...teachersInData.filter(t => !TEACHER_ORDER.includes(t))
  ];
  let TERMS = [...new Set(courses.map(c => Number(c['ターム'])))].filter(Boolean).sort((a,b)=>a-b);
  // フィルタ適用
  if (filter.term)    TERMS    = TERMS.filter(t => t === Number(filter.term));
  if (filter.teacher) TEACHERS = TEACHERS.filter(t => t === filter.teacher);
  if (TERMS.length === 0) {
    if (!silent) SpreadsheetApp.getUi().alert('指定されたターム ' + filter.term + ' は存在しません');
    return;
  }
  if (TEACHERS.length === 0) {
    if (!silent) SpreadsheetApp.getUi().alert('指定された先生 ' + filter.teacher + ' は存在しません');
    return;
  }
  const TC = 6;

  function getTermDates(term) {
    const c = courses.find(c => Number(c['ターム']) === term);
    if (!c || !c['日程']) return ['月','火','水','木','金'];
    const m = String(c['日程']).match(/(\d+)\/(\d+)〜(\d+)/);
    if (!m) return ['月','火','水','木','金'];
    const dates = [];
    for (let d = +m[2]; d <= +m[3]; d++) dates.push(m[1] + '/' + d);
    return dates;
  }

  function getSlotInfo(teacher, term, time) {
    const slots = courses.filter(c =>
      c['担当先生'] === teacher && Number(c['ターム']) === term && c['時間帯'] === time);
    if (!slots.length) return null;
    const uniqueNames = [...new Set(slots.map(c => c['講座名']))];
    const label = uniqueNames.join(' / ');
    let students = [];
    uniqueNames.forEach(cname => {
      const key = term + '|' + time + '|' + cname;
      if (studentMap[key]) students = students.concat(studentMap[key]);
    });
    students = [...new Set(students)];
    const maxS = slots[0]['定員'] || 12;
    return { label, students, maxS };
  }

  function getBg(count, maxS) {
    if (count >= maxS)        return '#fee2e2';
    if (count >= maxS * 0.7)  return '#fff7ed';
    return '#f0fdf4';
  }

  const NAV_BG   = '#1b2a4a';
  const GOLD_BG  = '#c9a84c';
  const TIME_BG  = '#f0ebe0';
  const EMPTY_BG = '#f5f5f5';

  let outRow = 1;
  TERMS.forEach(term => {
    const termCourses = courses.filter(c => Number(c['ターム']) === term);
    if (!termCourses.length) return;
    const termTeachers = TEACHERS.filter(t => termCourses.some(c => c['担当先生'] === t));
    if (!termTeachers.length) return;
    const dates    = getTermDates(term);
    const termDate = termCourses[0]['日程'] || '';
    const totalCols = 1 + termTeachers.length * TC;

    out.getRange(outRow, 1, 1, totalCols).merge()
      .setValue(term + '期（' + termDate + '）')
      .setBackground(NAV_BG).setFontColor('#fff').setFontWeight('bold').setFontSize(12)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    out.setRowHeight(outRow, 22);
    outRow++;

    out.getRange(outRow, 1).setValue('時間帯')
      .setBackground(NAV_BG).setFontColor('#fff').setFontWeight('bold')
      .setFontSize(9).setHorizontalAlignment('center');
    termTeachers.forEach((teacher, ti) => {
      const sc = 2 + ti * TC;
      out.getRange(outRow, sc, 1, TC).merge()
        .setValue(teacher)
        .setBackground(NAV_BG).setFontColor('#fff').setFontWeight('bold').setFontSize(11)
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
    });
    out.setRowHeight(outRow, 22);
    outRow++;

    out.getRange(outRow, 1).setValue('').setBackground(GOLD_BG);
    termTeachers.forEach((teacher, ti) => {
      const sc = 2 + ti * TC;
      out.getRange(outRow, sc).setValue(term + '期')
        .setBackground(GOLD_BG).setFontColor(NAV_BG).setFontWeight('bold').setFontSize(9)
        .setHorizontalAlignment('center');
      dates.forEach((d, di) => {
        out.getRange(outRow, sc + 1 + di).setValue(d)
          .setBackground(GOLD_BG).setFontColor(NAV_BG).setFontWeight('bold').setFontSize(9)
          .setHorizontalAlignment('center');
      });
    });
    out.setRowHeight(outRow, 18);
    outRow++;

    TIMES.forEach(time => {
      const slotInfos = termTeachers.map(t => getSlotInfo(t, term, time));
      const maxStudentCount = Math.max(0, ...slotInfos.map(s => s ? s.students.length : 0));
      const studentRows = Math.max(maxStudentCount, 1);
      const blockRows   = 1 + studentRows;

      out.getRange(outRow, 1, blockRows, 1).merge()
        .setValue(time.replace('〜', '\n〜\n'))
        .setBackground(TIME_BG).setFontColor(NAV_BG).setFontWeight('bold').setFontSize(9)
        .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

      termTeachers.forEach((teacher, ti) => {
        const sc   = 2 + ti * TC;
        const info = slotInfos[ti];

        if (!info) {
          out.getRange(outRow, sc, blockRows, TC).merge()
            .setBackground(EMPTY_BG);
        } else {
          const bg = info.students.length > 0 ? getBg(info.students.length, info.maxS) : '#ffffff';
          out.getRange(outRow, sc, 1, TC).merge()
            .setValue(info.label)
            .setBackground(bg).setFontColor(NAV_BG).setFontWeight('bold').setFontSize(10)
            .setHorizontalAlignment('left').setVerticalAlignment('middle').setWrap(true);

          for (let si = 0; si < studentRows; si++) {
            const sRow  = outRow + 1 + si;
            const sName = info.students[si] || '';
            out.getRange(sRow, sc).setValue(sName)
              .setBackground(bg).setFontSize(10).setVerticalAlignment('middle')
              .setWrap(false);
            dates.forEach((d, di) => {
              const cell = out.getRange(sRow, sc + 1 + di);
              if (sName) {
                cell.insertCheckboxes()
                  .setValue(true)
                  .setBackground('#e8f5e9')
                  .setHorizontalAlignment('center').setVerticalAlignment('middle')
                  .setFontSize(13);
              } else {
                cell.setBackground(bg);
              }
            });
          }
          if (info.students.length === 0) {
            out.getRange(outRow + 1, sc, 1, TC).setBackground('#fafafa');
          }
        }
      });

      out.setRowHeight(outRow, 22);
      for (let si = 0; si < studentRows; si++) {
        out.setRowHeight(outRow + 1 + si, 20);
      }
      outRow += blockRows;
    });

    out.getRange(outRow, 1, 1, 1 + termTeachers.length * TC)
      .setBackground('#cccccc');
    out.setRowHeight(outRow, 6);
    outRow++;
  });

  out.setColumnWidth(1, 65);
  const maxTC = TEACHERS.filter(t => courses.some(c => c['担当先生'] === t)).length;
  for (let ti = 0; ti < maxTC; ti++) {
    const sc = 2 + ti * TC;
    out.setColumnWidth(sc, 100);
    for (let d = 0; d < 5; d++) {
      out.setColumnWidth(sc + 1 + d, 55);
    }
  }
  out.setFrozenRows(3);
  ss.setActiveSheet(out);
  if (!silent) SpreadsheetApp.getUi().alert('✅ 先生別時間割を出力しました！');
}

// ============================================================
// 初期セットアップ
// ============================================================
function initialSetup() {
  DriveApp.getRootFolder();
  SpreadsheetApp.getActiveSpreadsheet();
  GmailApp.getAliases();

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASS')) {
    props.setProperty('ADMIN_PASS', ADMIN_PASS_FALLBACK);
    Logger.log('✅ ADMIN_PASS をスクリプトプロパティに設定しました');
  } else {
    Logger.log('✅ ADMIN_PASS は既にスクリプトプロパティに設定済みです');
  }
  Logger.log('✅ 初期セットアップ完了。');
}