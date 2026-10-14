/**
 * 巷口的貓：守護者測驗 — Google 試算表資料庫
 *
 * 用法（詳細步驟見 cat-quiz/SETUP.md）：
 * 1. 建立一個新的 Google 試算表 →「擴充功能」→「Apps Script」
 * 2. 把這整個檔案貼上，並把下面的 ADMIN_KEY 改成你自己的密碼
 * 3.「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *    執行身分：我；誰可以存取：所有人 → 部署，複製網址
 * 4. 把網址貼到 cat-quiz/config.js 的 sheetApi
 *
 * 試算表會自動建立兩個分頁：players（每位玩家一列）與 messages（留言牆）。
 */

// ⚠️ 請改成你自己的密碼。查看統計、刪除留言時要輸入。不要把真正的密碼上傳到 GitHub。
const ADMIN_KEY = "請改成你自己的密碼";

const COLUMNS = {
  players: ["id", "ts", "時間", "年齡", "居住地區", "守護者類型", "答對題數", "作答知識題數", "承諾項目", "有留言", "data"],
  messages: ["id", "ts", "時間", "暱稱", "居住地區", "守護者類型", "留言", "data"]
};
const TYPES = { T: "行動派・絕育推手", A: "溫柔的認養家", E: "生態守望者", S: "知識傳聲筒" };
const PLEDGES = ["我不棄養，也不讓家貓在外放養", "我會以領養代替購買", "我支持並協助 TNVR/A", "我不隨意餵食街頭的貓", "我會把今天學到的分享給一個人"];
const MESSAGES_SHOWN = 40;

function doGet(e) {
  const col = e.parameter.col;
  if (!COLUMNS[col]) return json_({ ok: true, service: "cat-quiz" });
  if (col === "players" && e.parameter.key !== ADMIN_KEY) return json_({ error: "unauthorized" });
  const docs = readAll_(col).sort((a, b) => b.data.ts - a.data.ts);
  if (col === "messages") {
    // 留言牆是公開的：只回傳最新幾則，而且不含年齡
    return json_({ docs: docs.slice(0, MESSAGES_SHOWN).map(d => ({ id: d.id, data: { words: d.data.words, nick: d.data.nick, region: d.data.region, type: d.data.type, ts: d.data.ts } })) });
  }
  return json_({ docs: docs.slice(0, 1000) });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad_request" }); }
  const col = body.col, id = String(body.id || "");
  if (!COLUMNS[col] || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return json_({ ok: false, error: "bad_request" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_(col);
    const row = findRow_(sh, id);
    if (body.action === "delete") {
      if (body.key !== ADMIN_KEY) return json_({ ok: false, error: "unauthorized" });
      if (row) sh.deleteRow(row);
      return json_({ ok: true });
    }
    let data = clean_(col, body.data);
    if (!data) return json_({ ok: false, error: "bad_request" });
    if (body.action === "update") {
      if (!row) return json_({ ok: false, error: "not_found" });
      const old = JSON.parse(sh.getRange(row, COLUMNS[col].length).getValue() || "{}");
      data = clean_(col, Object.assign(old, body.data));
    } else if (body.action !== "set") {
      return json_({ ok: false, error: "bad_request" });
    }
    const values = toRow_(col, id, data);
    if (row) sh.getRange(row, 1, 1, values.length).setValues([values]);
    else sh.appendRow(values);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/* 只保留已知欄位，並限制長度，避免奇怪的資料寫進試算表 */
function clean_(col, d) {
  if (!d || typeof d !== "object") return null;
  const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
  const num = v => typeof v === "number" && isFinite(v) ? v : 0;
  const ts = num(d.ts) || Date.now();
  if (col === "messages") {
    const words = str(d.words, 60).trim();
    if (!words) return null;
    return { words, nick: str(d.nick, 12), age: str(d.age, 12), region: str(d.region, 8), type: str(d.type, 1), ts };
  }
  const bits = o => {
    const out = {};
    if (o && typeof o === "object") Object.keys(o).slice(0, 40).forEach(k => { if (/^\d{1,3}$/.test(k)) out[k] = o[k] === 1 ? 1 : o[k] === 0 ? 0 : str(o[k], 1); });
    return out;
  };
  return {
    age: str(d.age, 12), region: str(d.region, 8), type: str(d.type, 1),
    correct: num(d.correct), total: num(d.total),
    answers: bits(d.answers), minds: bits(d.minds),
    pledges: Array.isArray(d.pledges) ? d.pledges.filter(k => Number.isInteger(k) && k >= 0 && k < PLEDGES.length).slice(0, PLEDGES.length) : [],
    message: !!d.message, ts
  };
}

function toRow_(col, id, d) {
  const time = Utilities.formatDate(new Date(d.ts), "Asia/Taipei", "yyyy-MM-dd HH:mm");
  const safe = v => typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v; // 防止被當成公式
  if (col === "players") {
    return [id, d.ts, time, d.age, d.region, TYPES[d.type] || "", d.correct, d.total,
      d.pledges.map(k => PLEDGES[k]).join("；"), d.message ? "是" : "否", JSON.stringify(d)].map(safe);
  }
  return [id, d.ts, time, d.nick, d.region, TYPES[d.type] || "", d.words, JSON.stringify(d)].map(safe);
}

function readAll_(col) {
  const sh = sheet_(col);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const width = COLUMNS[col].length;
  return sh.getRange(2, 1, n, width).getValues()
    .map(r => { try { return { id: String(r[0]), data: JSON.parse(r[width - 1]) }; } catch (e) { return null; } })
    .filter(d => d && d.data && typeof d.data.ts === "number");
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(COLUMNS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function findRow_(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  const hit = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
