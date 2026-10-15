/**
 * 假如你是一隻流浪貓 — Google 試算表資料庫
 *
 * 用法（詳細步驟見 google-sheet/SETUP.md）：
 * 1. 打開「流浪貓測驗統計」試算表 →「擴充功能」→「Apps Script」
 * 2. 把這整個檔案貼上並儲存
 * 3.「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *    執行身分：我；誰可以存取：所有人 → 部署，複製網址
 * 4. 把網址貼到根目錄 config.js 的 sheetApi
 *
 * 每位玩家玩完會新增一列。網頁讀到的只有加總後的統計（不含暱稱或任何單筆資料）。
 */

const SERVICE = "stray-cat";
const VERSION = 2;
const HEADER = ["時間", "年齡區間", "地區", "結果", "最終體力", "最終飽足",
  "第1關", "第2關", "第3關", "第4關", "第5關", "第6關", "第7關", "第8關", "第9關", "暱稱"];
const AGES = ["12 歲以下", "13～17 歲", "18～24 歲", "25～34 歲", "35～44 歲", "45～54 歲", "55～64 歲", "65 歲以上"];
const REGIONS = ["臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "臺中市",
  "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣",
  "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣", "其他／海外"];
const TYPES = ["街頭冒險家", "巷弄智者", "撒嬌外交官", "屋頂獨行俠"];
const CHOICES = [2, 3, 3, 3, 2, 2, 3, 2, 2]; // 每一關的選項數
const LETTERS = ["A", "B", "C"];

function doGet(e) {
  try { return json_(stats_()); } catch (err) { return json_({ ok: false, error: "server_error", message: String(err) }); }
}

function doPost(e) {
  try { return handlePost_(e); } catch (err) { return json_({ ok: false, error: "server_error", message: String(err) }); }
}

function handlePost_(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad_request" }); }
  const row = clean_(d);
  if (!row) return json_({ ok: false, error: "bad_request" });

  // 同一筆資料重送（網路不穩時）只記一次
  const id = typeof d.id === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(d.id) ? d.id : "";
  const cache = CacheService.getScriptCache();
  if (id && cache.get("seen_" + id)) return json_({ ok: true, duplicate: true });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_().appendRow(row);
  } finally {
    lock.releaseLock();
  }
  if (id) cache.put("seen_" + id, "1", 21600);
  cache.remove("stats");
  return json_({ ok: true });
}

/* 只接受已知的值，其他一律拒絕，避免奇怪的資料（或公式）寫進試算表 */
function clean_(d) {
  if (!d || typeof d !== "object") return null;
  if (AGES.indexOf(d.age) < 0 || REGIONS.indexOf(d.region) < 0 || TYPES.indexOf(d.type) < 0) return null;
  if (!Array.isArray(d.picks) || d.picks.length !== CHOICES.length) return null;
  const picks = d.picks.map((k, q) => Number.isInteger(k) && k >= 0 && k < CHOICES[q] ? LETTERS[k] : null);
  if (picks.indexOf(null) >= 0) return null;
  const stat = v => Number.isInteger(v) && v >= 0 && v <= 100 ? v : null;
  const hp = stat(d.hp), food = stat(d.food);
  if (hp === null || food === null) return null;
  // 暱稱：去掉控制字元、最多 12 個字；開頭是 = + - @ 時加上 ' 避免被當成公式
  let nick = typeof d.nick === "string" ? d.nick.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 12) : "";
  if (/^[=+\-@]/.test(nick)) nick = "'" + nick;
  const time = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm");
  return [time, d.age, d.region, d.type, hp, food].concat(picks, [nick]);
}

/* 加總統計：網頁只會拿到這些數字 */
function stats_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("stats");
  if (hit) return JSON.parse(hit);

  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, HEADER.length).getValues() : [];
  const out = {
    ok: true, service: SERVICE, version: VERSION, sheetName: sh.getParent().getName(),
    total: 0, avgHp: 0, types: {}, ages: {}, regions: {},
    picks: CHOICES.map(c => new Array(c).fill(0))
  };
  let hpSum = 0;
  rows.forEach(r => {
    if (TYPES.indexOf(r[3]) < 0) return;
    out.total++;
    hpSum += Number(r[4]) || 0;
    out.types[r[3]] = (out.types[r[3]] || 0) + 1;
    out.ages[r[1]] = (out.ages[r[1]] || 0) + 1;
    out.regions[r[2]] = (out.regions[r[2]] || 0) + 1;
    for (let q = 0; q < CHOICES.length; q++) {
      const k = LETTERS.indexOf(r[6 + q]);
      if (k >= 0 && k < CHOICES[q]) out.picks[q][k]++;
    }
  });
  out.avgHp = out.total ? Math.round(hpSum / out.total) : 0;
  cache.put("stats", JSON.stringify(out), 30);
  return out;
}

/* 找第一欄標題是「時間」的分頁；沒有就建立一個 plays 分頁。
   若 Apps Script 不是從試算表打開的，就自動建立一份「流浪貓測驗統計」試算表。 */
function sheet_() {
  const ss = spreadsheet_();
  const found = ss.getSheets().filter(s => s.getLastRow() > 0 && s.getRange(1, 1).getValue() === HEADER[0])[0];
  if (found) {
    // 舊版沒有「暱稱」欄：補上標題（加在最右邊，原有資料不用搬動）
    const last = found.getRange(1, HEADER.length);
    if (last.getValue() !== HEADER[HEADER.length - 1]) last.setValue(HEADER[HEADER.length - 1]);
    return found;
  }
  const blank = ss.getSheets().filter(s => s.getLastRow() === 0)[0];
  const sh = blank || ss.insertSheet("plays");
  sh.appendRow(HEADER);
  sh.setFrozenRows(1);
  return sh;
}

function spreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("SHEET_ID");
  if (id) { try { return SpreadsheetApp.openById(id); } catch (err) {} }
  const ss = SpreadsheetApp.create("流浪貓測驗統計");
  props.setProperty("SHEET_ID", ss.getId());
  return ss;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
