# 校園教會網站

純靜態網站，不需要安裝任何東西。接資料只要改根目錄的 `config.js`，其他檔案都不用動。

目前顯示的是範例資料，表單也都是示範模式，不會真的送出。

## 接上資料的步驟

### 1. 建立資料表（Google 試算表或 Excel）

`data/` 資料夾有五個範例 CSV，欄位名稱要照用，可以直接匯入 Google 試算表，每個檔案放一個工作表。

| 檔案 | 用途 | 欄位 |
|---|---|---|
| `meetings.csv` | 聚會場次 | 地區、日期、時間、地點、地圖連結（可空白） |
| `stats.csv` | 異象數據 | 項目、數字、單位 |
| `schools.csv` | 參與校園 | 學校、類別 |
| `stories.csv` | 48 小時感動牆 | 學校、照片、時間、公開 |
| `prayers.csv` | 代禱牆 | 時間、姓名、夥伴、代禱、感恩、公開 |

- 日期可寫 `2026-11-13` 或 `2026/11/13`，時間可寫 `19:00` 或 `下午 7:00:00`。星期會自動算。
- 已經過去的聚會會自動消失，不用手動刪。
- 「公開」欄填「否」的那一列不會顯示在網站上。
- Google 表單的回覆表也可以直接用，「時間戳記」會被當成「時間」。

### 2. 把工作表發布成 CSV

Google 試算表：檔案 → 共用 → 發布到網路 → 選「單一工作表」→ 格式選「逗號分隔值 (.csv)」→ 發布，複製網址貼到 `config.js` 的 `dataSources`。

```js
dataSources: {
  meetings: "https://docs.google.com/spreadsheets/d/e/xxxx/pub?gid=0&single=true&output=csv",
  ...
}
```

資料是存在 Excel 檔（不是 Google 試算表）的話，另存成 CSV，覆蓋 `data/` 裡同名的檔案也可以，但每次更新都要重新上傳。

> **重要：發布的工作表，任何人都看得到。**
> 只發布上面五張表。新朋友名單、私密代禱、邀約集氣的回覆表**絕對不要發布**，就算「公開」欄填了「否」，只是網站不顯示，資料本身仍然看得到。

### 3. 接上 Google 表單

新朋友表單的網址和 entry 編號已經填好，把 `config.js` 裡 `newcomer` 的 `enabled` 改成 `true` 就會開始收資料。

其他三份（聚會回填、私密代禱、邀約集氣）請新建 Google 表單，填入 `action` 和 `fields`，再把 `enabled` 改成 `true`。

取得編號的方法：在 Google 表單按「取得預先填入的連結」，隨便填一填產生網址，網址裡的 `entry.123456` 就是欄位編號；`action` 是表單網址把結尾的 `viewform` 換成 `formResponse`。

### 4. 感動牆照片

在 `config.js` 的 `links.storyUpload` 填一份含「檔案上傳」題目的 Google 表單網址。上傳者需要登入 Google 帳號。

回覆表的「照片」欄會是雲端硬碟連結，網站會自動轉成圖片。存放照片的資料夾要設成「知道連結的任何人都可以檢視」，照片才看得到。

### 5. 增減地區

改 `config.js` 的 `regions`，名稱要和 meetings 表的「地區」一字不差。

## 本機預覽

CSV 需要透過網址讀取，不能直接雙擊 `index.html`。

```bash
python3 -m http.server 4173
```

然後打開 http://localhost:4173

## 檔案地圖

| 檔案 | 說明 |
|---|---|
| `config.js` | **唯一需要修改的檔案** |
| `data/` | 範例資料，也是欄位格式範本 |
| `assets/js/data.js` | 讀取與整理資料、送出表單 |
| `assets/js/app.js` | 畫面邏輯 |
| `assets/css/style.css` | 樣式 |
