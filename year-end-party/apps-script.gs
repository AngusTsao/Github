/**
 * 尾牙報到系統 — Google 試算表資料庫
 *
 * 用法（詳細步驟見 year-end-party/SETUP.md）：
 * 1. 建立一個新的 Google 試算表 →「擴充功能」→「Apps Script」
 * 2. 把這整個檔案貼上並儲存，回到試算表重新整理，上方會出現「尾牙報到」選單
 * 3.「尾牙報到」→「建立分頁」，再「設定工作人員密碼」（報到台登入用，密碼存在 Google，不會出現在程式碼裡）
 * 4.「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *    執行身分：我；誰可以存取：所有人 → 部署，複製網址
 * 5. 把網址貼到 year-end-party/config.js 的 sheetApi
 *
 * 分頁「名單」：從 Excel 整份貼上（員工編號、姓名、部門、桌號、葷素、抽獎編號、報到代碼…），名單有變動時可以整份重貼。
 * 分頁「報到紀錄」：每次報到／取消報到新增一列，誰在哪一台、用什麼方式報到都查得到。
 * Email 欄就算貼上來也不會傳到網頁上。
 */

const SERVICE = "year-end-party";
const VERSION = 1;
const LIST = "名單";
const LOG = "報到紀錄";
const LIST_COLUMNS = { id: "員工編號", name: "姓名", dept: "部門", table: "桌號", meal: "葷素", lottery: "抽獎編號", token: "報到代碼" };
const LIST_HEADER = ["員工編號", "姓名", "部門", "桌號", "葷素", "抽獎編號", "Email", "報到代碼", "寄送狀態"];
const LOG_HEADER = ["時間", "員工編號", "姓名", "部門", "動作", "方式", "報到台", "備註"];
const DAY = 24 * 60 * 60 * 1000;

function onOpen() {
  SpreadsheetApp.getUi().createMenu("尾牙報到")
    .addItem("建立分頁", "setupSheets")
    .addItem("設定工作人員密碼", "setPassword")
    .addItem("檢查名單", "checkList")
    .addSeparator()
    .addItem("清除所有報到紀錄（測試完、正式開始前用）", "clearLog")
    .addToUi();
}

function doGet(e) {
  try { return handleGet_(e); } catch (err) { return json_({ ok: false, error: "server_error", message: String(err) }); }
}
function doPost(e) {
  try { return handlePost_(e); } catch (err) { return json_({ ok: false, error: "server_error", message: String(err) }); }
}

function handleGet_(e) {
  const token = normToken_(e.parameter.t);
  if (!token) {
    // 連線測試：回報版本與試算表名稱
    return json_({ ok: true, service: SERVICE, version: VERSION, sheetName: SpreadsheetApp.getActiveSpreadsheet().getName() });
  }
  // 員工個人 QR Code 頁：憑報到代碼只回傳本人的座位資訊
  const emp = readList_().find(x => x.token === token);
  if (!emp) return json_({ ok: true, found: false });
  const c = readStatus_()[emp.id];
  return json_({ ok: true, found: true, employee: publicInfo_(emp), checkedIn: c ? c.time : "" });
}

function handlePost_(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad_request" }); }
  const pw = PropertiesService.getScriptProperties().getProperty("STAFF_PASSWORD");
  if (!pw) return json_({ ok: false, error: "no_password" });
  if (String(body.pw || "") !== pw) return json_({ ok: false, error: "unauthorized" });
  const station = String(body.station || "").trim().slice(0, 20);

  switch (body.action) {
    case "login":
      return json_({ ok: true });
    case "list":
      return json_({ ok: true, employees: readList_(), checkins: readStatus_(), serverTime: Date.now() });
    case "checkin":
      return withLock_(() => checkin_(body, station));
    case "undo":
      return withLock_(() => undo_(body, station));
  }
  return json_({ ok: false, error: "bad_request" });
}

// 同一時間只處理一筆報到，避免多台同時掃到同一人時重複寫入
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const out = fn();
    SpreadsheetApp.flush();
    return json_(out);
  } finally {
    lock.releaseLock();
  }
}

function checkin_(body, station) {
  const list = readList_();
  const token = normToken_(body.token), id = String(body.id || "").trim();
  const emp = token ? list.find(x => x.token === token) : list.find(x => x.id === id);
  if (!emp) return { ok: true, result: "notfound" };

  const first = readStatus_()[emp.id];
  if (first) return { ok: true, result: "dup", employee: emp, first };

  // 離線時先記在報到台上，恢復連線後補上傳：用當時的時間
  const at = Number(body.at) || 0;
  const offline = at > 0 && at <= Date.now() + 60000 && Date.now() - at < DAY;
  const when = offline ? new Date(at) : new Date();
  const method = body.method === "人工" ? "人工" : "QR";
  appendLog_([when, emp.id, emp.name, emp.dept, "報到", method, station, offline ? "離線補登" : ""]);
  return { ok: true, result: "ok", employee: emp, first: { time: formatTime_(when), method, station } };
}

function undo_(body, station) {
  const id = String(body.id || "").trim();
  if (!readStatus_()[id]) return { ok: true, result: "notchecked" };
  const emp = readList_().find(x => x.id === id) || { name: "", dept: "" };
  appendLog_([new Date(), id, emp.name, emp.dept, "取消", "", station, "取消報到"]);
  return { ok: true, result: "undone" };
}

/* ---------- 讀寫試算表 ---------- */

function readList_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LIST);
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getDataRange().getDisplayValues();
  const head = rows[0].map(h => String(h).trim());
  const idx = {};
  Object.keys(LIST_COLUMNS).forEach(k => { idx[k] = head.indexOf(LIST_COLUMNS[k]); });
  if (idx.id < 0 || idx.name < 0) throw new Error("「名單」第 1 列找不到「員工編號」或「姓名」");
  return rows.slice(1).map(r => {
    const o = {};
    Object.keys(idx).forEach(k => { o[k] = idx[k] < 0 ? "" : String(r[idx[k]]).trim(); });
    o.token = normToken_(o.token);
    return o;
  }).filter(o => o.id);
}

// 依報到紀錄算出目前誰已報到：「取消」會抵銷前一次「報到」
function readStatus_() {
  const sh = logSheet_(), n = sh.getLastRow() - 1, status = {};
  if (n < 1) return status;
  sh.getRange(2, 1, n, 7).getDisplayValues().forEach(r => {
    const id = String(r[1]).trim();
    if (!id) return;
    if (r[4] === "報到") status[id] = { time: r[0], method: r[5], station: r[6] };
    else if (r[4] === "取消") delete status[id];
  });
  return status;
}

function appendLog_(row) {
  const sh = logSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length)
    .setNumberFormats([["yyyy/mm/dd hh:mm:ss"].concat(row.slice(1).map(() => "@"))])
    .setValues([row]);
}

function logSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LOG);
  if (!sh) {
    sh = ss.insertSheet(LOG);
    sh.appendRow(LOG_HEADER);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, LOG_HEADER.length).setFontWeight("bold");
    sh.setColumnWidth(1, 160);
  }
  return sh;
}

function publicInfo_(emp) {
  return { id: emp.id, name: emp.name, dept: emp.dept, table: emp.table, meal: emp.meal, lottery: emp.lottery };
}

function normToken_(v) {
  return String(v || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
}

function formatTime_(d) {
  return Utilities.formatDate(d, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "yyyy/MM/dd HH:mm:ss");
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 選單功能 ---------- */

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LIST);
  if (!sh) {
    sh = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(LIST) : ss.insertSheet(LIST);
    sh.getRange(1, 1, 1, LIST_HEADER.length).setValues([LIST_HEADER]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  // 全部設成純文字，員工編號、抽獎編號開頭的 0 才不會不見
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat("@");
  logSheet_();
  SpreadsheetApp.getUi().alert("已建立「名單」與「報到紀錄」分頁。\n\n請在 Excel 選取整份名單（含標題列）複製，到「名單」分頁的 A1 按 Ctrl+Shift+V（只貼上值）。");
}

function setPassword() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("設定工作人員密碼", "報到台登入時輸入（至少 4 個字）：", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const pw = r.getResponseText().trim();
  if (pw.length < 4) { ui.alert("密碼至少要 4 個字，沒有變更。"); return; }
  PropertiesService.getScriptProperties().setProperty("STAFF_PASSWORD", pw);
  ui.alert("已設定。已經登入的報到台需要用新密碼重新登入。");
}

function checkList() {
  const ui = SpreadsheetApp.getUi();
  let list;
  try { list = readList_(); } catch (err) { ui.alert(String(err.message || err)); return; }
  const count = (arr, key) => {
    const seen = {}, dup = [];
    arr.forEach(x => { if (!x[key]) return; if (seen[x[key]]) dup.push(x[key]); seen[x[key]] = true; });
    return dup;
  };
  const dupId = count(list, "id"), dupToken = count(list, "token");
  const noToken = list.filter(x => !x.token).map(x => x.id + " " + x.name);
  const checked = Object.keys(readStatus_()).length;
  const lines = ["名單共 " + list.length + " 人，目前已報到 " + checked + " 人。"];
  if (!PropertiesService.getScriptProperties().getProperty("STAFF_PASSWORD")) lines.push("⚠️ 還沒設定工作人員密碼（選單「設定工作人員密碼」）。");
  if (dupId.length) lines.push("⚠️ 員工編號重複：" + dupId.join("、"));
  if (dupToken.length) lines.push("⚠️ 報到代碼重複：" + dupToken.join("、"));
  if (noToken.length) lines.push("⚠️ 沒有報到代碼（請在 Excel 執行 A1_GenerateCodes 後重貼）：" + noToken.slice(0, 20).join("、") + (noToken.length > 20 ? " 等 " + noToken.length + " 人" : ""));
  if (lines.length === 1) lines.push("✅ 沒有發現問題。");
  ui.alert(lines.join("\n\n"));
}

function clearLog() {
  const ui = SpreadsheetApp.getUi();
  const sh = logSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) { ui.alert("目前沒有任何報到紀錄。"); return; }
  if (ui.alert("確定要清除全部 " + n + " 筆報到紀錄嗎？", "清除後無法復原，通常只在測試完、活動正式開始前使用。", ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  sh.getRange(2, 1, n, sh.getMaxColumns()).clearContent();
  ui.alert("已清除。各報到台約 20 秒內會自動更新。");
}
