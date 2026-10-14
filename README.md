# 假如你是一隻流浪貓 🐾

一個像心理測驗的線上小遊戲：玩家扮演一隻流浪貓，在街頭度過 90 天，
透過選擇認識流浪貓會遇到的危險、街頭生活為什麼辛苦，以及「餵食到底好不好」。

## 怎麼玩

這是一個 App（PWA）：放到網站上（例如 GitHub Pages）後，用手機打開網址就能玩，
也可以「安裝到主畫面」，之後像一般 App 一樣全螢幕開啟，沒有網路也能玩。

- Android／Chrome：首頁會出現「📲 安裝到手機主畫面」按鈕
- iPhone／Safari：點「分享」→「加入主畫面」
- 玩到一半關掉，下次打開可以從上次的關卡繼續

本機測試：在資料夾裡執行 `python3 -m http.server`，再打開 http://localhost:8000
（直接雙擊 `index.html` 也能玩，但不會啟用安裝與離線功能）。

## 流程

1. 輸入 **暱稱、年齡區間、居住地區**
2. 9 個情境關卡：身世（棄養）、找食物、過馬路、愛心餵食、發情繁殖／TNR、地盤打架、颱風夜、遇到陌生人、被認養的機會
3. 每個選擇都會影響「體力」與「飽足」，並附上一張知識卡
4. 結局：依選擇得出貓咪性格（街頭冒險家／巷弄智者／撒嬌外交官／屋頂獨行俠），
   並整理餵食觀念、依年齡給出行動建議，以及所在地區的求助方式

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 遊戲本體（畫面、關卡內容、程式） |
| `manifest.webmanifest` | App 名稱、圖示、全螢幕設定 |
| `sw.js` | 離線快取 |
| `.github/workflows/pages.yml` | 自動部署到 GitHub Pages |
| `icons/` | App 圖示（貓咪左耳剪角＝已結紮的 TNR 記號） |

## 修改內容

所有關卡文字都在 `index.html` 裡的 `SCENES` 陣列，結局類型在 `TYPES`，
依年齡的建議在 `ageTips()`，可以直接編輯。

## 上線（GitHub Pages）

網址：https://angustsao.github.io/Github/

- 第一次設定：到 repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**
- 之後每次推送到 `main`，`.github/workflows/pages.yml` 都會自動部署，
  並自動更新離線快取版本，已安裝的玩家下次開啟就會拿到新內容

---

# 巷口的貓：守護者測驗（`cat-quiz/`）

網址：https://angustsao.github.io/Github/cat-quiz/

結合心理測驗與知識問答的展場互動遊戲。每局從題庫隨機抽 10 題（3 題心理測驗＋7 題知識題），
最後得出「貓咪守護者類型」，並填寫支持與承諾、產生承諾卡。

- 開始前填寫暱稱、年齡區間、居住地區
- 答對自動進入下一題；答錯才顯示正確答案與解說，按「繼續」
- 複選題有醒目的「複選題」標示
- 展場模式：閒置 90 秒提醒、再 15 秒自動回首頁

題目都在 `cat-quiz/index.html` 的 `STEPS` 陣列，守護者類型在 `TYPES`，承諾選項在 `PLEDGES`。

> 留言牆、統計分析與 CSV 匯出需要共享資料庫，只在 claude.ai 版本中提供；
> GitHub Pages 版本是純網頁，這些功能會自動隱藏，遊戲本身完整可玩。


---

# 你是哪種街貓？擺攤心理測驗（`street-cat-quiz/`）

網址：https://angustsao.github.io/Github/street-cat-quiz/

貓掌守護聯盟擺攤用的心理測驗：先填年齡、綽號、居住地區，回答 9 題後得出 6 種街貓之一，
並帶出不餵食、TNVA/R、剪耳、不棄養等觀念。統計可同步到 Google 試算表（最多 1000 筆），
設定方式見 `street-cat-quiz/README.md`。
