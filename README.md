# NotebookLM PDF → PPTX 轉換器

上傳 NotebookLM 簡報 PDF，自動分離文字與圖層，下載可編輯的 PowerPoint 檔案。

## 功能

- **上傳 PDF**：支援 NotebookLM 生成的簡報 PDF（最大 50 MB）
- **文字及圖層分離**：
  - **圖層**：對每一頁去除文字後渲染為背景圖片（保留視覺設計）
  - **文字層**：提取文字區塊（含位置、字型、大小、顏色、粗斜體），以可編輯文字框疊加
- **下載 PPTX**：產出 `.pptx` 檔案，可在 PowerPoint / Keynote / Google Slides 中編輯

## 快速開始

```bash
# 安裝相依套件
pip install -r requirements.txt

# 啟動伺服器
python app.py
```

開啟瀏覽器前往 http://127.0.0.1:5000，選取 PDF 後按「轉換並下載 PPTX」即可。

## 技術堆疊

| 套件 | 用途 |
|------|------|
| [Flask](https://flask.palletsprojects.com/) | Web 伺服器 |
| [PyMuPDF](https://pymupdf.readthedocs.io/) | PDF 解析、圖層渲染與文字萃取 |
| [python-pptx](https://python-pptx.readthedocs.io/) | PPTX 生成 |