/**
 * 貓掌守護聯盟 街貓心理測驗：雲端統計
 *
 * 把這段程式貼到 Google 試算表的「擴充功能 → Apps Script」，
 * 再「部署 → 新增部署作業 → 網頁應用程式」（執行身分：我；存取權：所有人），
 * 把產生的網址貼到 index.html 的 CONFIG.cloudUrl。
 *
 * 試算表最多保留最新的 MAX_RECORDS 筆，超過會自動刪除最舊的資料。
 */

const SHEET_NAME = "測驗紀錄";
const MAX_RECORDS = 1000;
const HEADERS = ["時間", "年齡", "綽號", "居住地區", "結果代碼", "結果"];
const TYPES = {
  boss: "街頭老大貓",
  shy: "暗影忍者貓",
  sweet: "撒嬌黏人貓",
  guard: "社區巡守貓",
  mom: "堅強貓媽媽",
  explorer: "好奇冒險貓",
};

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function clean_(value, maxLen) {
  return String(value == null ? "" : value).replace(/[\r\n\t]/g, " ").trim().slice(0, maxLen);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 新增一筆測驗紀錄 */
function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "bad json" });
  }
  const type = clean_(data.type, 20);
  if (!TYPES[type]) return json_({ ok: false, error: "bad type" });

  const time = Number(data.time) > 0 ? new Date(Number(data.time)) : new Date();
  // 開頭是 = + - @ 的字會被試算表當成公式，前面加 ' 避免
  const safe = (v) => (/^[=+\-@]/.test(v) ? "'" + v : v);
  const row = [time, safe(clean_(data.age, 20)), safe(clean_(data.nick, 12)), safe(clean_(data.region, 20)), type, TYPES[type]];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    sheet.appendRow(row);
    const extra = sheet.getLastRow() - 1 - MAX_RECORDS;
    if (extra > 0) sheet.deleteRows(2, extra);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

/** 讀取所有紀錄（給攤位統計頁用） */
function doGet() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return json_({ ok: true, records: [] });
  const rows = sheet.getRange(2, 1, last - 1, 5).getValues();
  const records = rows.map((r) => ({
    time: r[0] instanceof Date ? r[0].getTime() : Number(r[0]) || 0,
    age: String(r[1]),
    nick: String(r[2]),
    region: String(r[3]),
    type: String(r[4]),
  }));
  return json_({ ok: true, records: records });
}
