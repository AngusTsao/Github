'==============================================================
' 尾牙報到系統：產生報到代碼、用 Outlook 寄送報到信（Excel 巨集）
'
' 用法（詳細步驟見 year-end-party/SETUP.md）：
' 1. 名單放在工作表「名單」，第 1 列是標題：
'    員工編號｜姓名｜部門｜桌號｜葷素｜抽獎編號｜Email
' 2. 先修改下面「活動資訊」的內容
' 3. 按 Alt+F8 依序執行：
'    A1_GenerateCodes  產生報到代碼（只補空白的，已經有的不會改）
'    A2_SendTestMail   寄一封測試信給自己（用第一位員工的資料）
'    A3_SendAllMails   寄送報到信（只寄「寄送狀態」空白的人，寄完會寫上時間）
'
' 需要電腦上的「傳統版 Outlook」（新版 Outlook 不支援巨集寄信）。
' QR Code 圖片由 api.qrserver.com 產生（只會送出報到代碼，不含姓名等資料）。
'==============================================================
Option Explicit

' ===== 活動資訊：請改成你們的 =====
Private Const EVENT_NAME As String = "年度尾牙"
Private Const EVENT_TIME As String = "2027 年 1 月 22 日（五）17:30 開始報到，18:00 開席"
Private Const EVENT_PLACE As String = "○○飯店 3 樓宴會廳（台北市○○路 100 號）"
Private Const MAIL_SUBJECT As String = "【尾牙報到通知】您的專屬報到 QR Code"
Private Const CONTACT As String = "福委會 王小姐（分機 1234）"
' 員工個人 QR Code 頁（信裡的圖片沒顯示時，點這個連結開啟）
Private Const TICKET_URL As String = "https://angustsao.github.io/Github/year-end-party/ticket.html?t="
' 每封信之間等幾秒（公司郵件伺服器通常限制每分鐘 30 封）
Private Const SEND_DELAY_SEC As Double = 2.5

Private Const SHEET_NAME As String = "名單"
Private Const CODE_FIRST As String = "ABCDFGHJKLMNPQRSTUVWXYZ"
Private Const CODE_CHARS As String = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
Private Const CODE_LEN As Long = 10
Private Const PR_ATTACH_CONTENT_ID As String = "http://schemas.microsoft.com/mapi/proptag/0x3712001F"

'---------- 1. 產生報到代碼 ----------
Public Sub A1_GenerateCodes()
    Dim ws As Worksheet, cId As Long, cCode As Long, lastRow As Long, r As Long
    Dim used As Object, ids As Object, k As String, id As String, dupIds As String, made As Long

    Set ws = ListSheet(): If ws Is Nothing Then Exit Sub
    cId = FindCol(ws, "員工編號")
    If cId = 0 Or FindCol(ws, "姓名") = 0 Then
        MsgBox "「" & SHEET_NAME & "」第 1 列找不到「員工編號」或「姓名」。", vbExclamation
        Exit Sub
    End If
    cCode = FindCol(ws, "報到代碼", True)
    FindCol ws, "寄送狀態", True
    lastRow = LastDataRow(ws, cId)

    Set used = CreateObject("Scripting.Dictionary")
    Set ids = CreateObject("Scripting.Dictionary")
    For r = 2 To lastRow
        k = UCase$(Trim$(TextOf(ws.Cells(r, cCode))))
        If k <> "" Then used(k) = True
        id = Trim$(TextOf(ws.Cells(r, cId)))
        If id <> "" Then
            If ids.Exists(id) Then dupIds = dupIds & id & " " Else ids(id) = True
        End If
    Next
    If dupIds <> "" Then
        MsgBox "員工編號重複，請先修正：" & vbCrLf & dupIds, vbExclamation
        Exit Sub
    End If

    Randomize
    ws.Columns(cCode).NumberFormat = "@"
    For r = 2 To lastRow
        If Trim$(TextOf(ws.Cells(r, cId))) <> "" And Trim$(TextOf(ws.Cells(r, cCode))) = "" Then
            Do
                k = NewCode()
            Loop While used.Exists(k)
            used(k) = True
            ws.Cells(r, cCode).Value = k
            made = made + 1
        End If
    Next
    MsgBox "完成！新產生 " & made & " 組報到代碼，共 " & ids.Count & " 人。" & vbCrLf & vbCrLf & _
           "下一步：把整份名單複製貼到 Google 試算表的「名單」分頁。", vbInformation
End Sub

'---------- 2. 寄測試信 ----------
Public Sub A2_SendTestMail()
    Dim ws As Worksheet, cols As Object, r As Long, lastRow As Long, ol As Object, toAddr As String, msg As String

    Set ws = ListSheet(): If ws Is Nothing Then Exit Sub
    Set cols = MailCols(ws): If cols Is Nothing Then Exit Sub
    Set ol = GetOutlook(): If ol Is Nothing Then Exit Sub

    lastRow = LastDataRow(ws, cols("員工編號"))
    For r = 2 To lastRow
        If Trim$(TextOf(ws.Cells(r, cols("報到代碼")))) <> "" Then Exit For
    Next
    If r > lastRow Then
        MsgBox "還沒有報到代碼，請先執行 A1_GenerateCodes。", vbExclamation
        Exit Sub
    End If

    toAddr = InputBox("測試信要寄到哪個信箱？" & vbCrLf & "（會用「" & TextOf(ws.Cells(r, cols("姓名"))) & "」的資料當範例）", "寄送測試信", MyAddress(ol))
    If Trim$(toAddr) = "" Then Exit Sub

    msg = SendOne(ol, ws, r, cols, Trim$(toAddr), "[測試] ")
    If msg = "" Then
        MsgBox "測試信已寄出，請到信箱確認：" & vbCrLf & "1. QR Code 圖片有顯示" & vbCrLf & "2. 點信裡的連結可以開啟 QR Code 頁", vbInformation
    Else
        MsgBox "寄送失敗：" & msg, vbExclamation
    End If
End Sub

'---------- 3. 寄送全部報到信 ----------
Public Sub A3_SendAllMails()
    Dim ws As Worksheet, cols As Object, ol As Object, lastRow As Long, r As Long
    Dim todo As Collection, noCode As Long, noMail As Long, i As Long, sent As Long, failed As Long, msg As String

    Set ws = ListSheet(): If ws Is Nothing Then Exit Sub
    Set cols = MailCols(ws): If cols Is Nothing Then Exit Sub

    Set todo = New Collection
    lastRow = LastDataRow(ws, cols("員工編號"))
    For r = 2 To lastRow
        If Trim$(TextOf(ws.Cells(r, cols("員工編號")))) <> "" And Left$(TextOf(ws.Cells(r, cols("寄送狀態"))), 3) <> "已寄送" Then
            If Trim$(TextOf(ws.Cells(r, cols("報到代碼")))) = "" Then
                noCode = noCode + 1
            ElseIf InStr(TextOf(ws.Cells(r, cols("Email"))), "@") = 0 Then
                noMail = noMail + 1
            Else
                todo.Add r
            End If
        End If
    Next

    If noCode > 0 Then
        MsgBox noCode & " 人還沒有報到代碼，請先執行 A1_GenerateCodes（並重新貼到 Google 試算表）。", vbExclamation
        Exit Sub
    End If
    If todo.Count = 0 Then
        MsgBox "沒有需要寄送的人（「寄送狀態」是「已寄送」的不會重寄）。" & IIf(noMail > 0, vbCrLf & noMail & " 人沒有 Email。", ""), vbInformation
        Exit Sub
    End If
    If MsgBox("即將寄出 " & todo.Count & " 封報到信，約需 " & Application.WorksheetFunction.RoundUp(todo.Count * (SEND_DELAY_SEC + 1.5) / 60, 0) & " 分鐘。" & _
              IIf(noMail > 0, vbCrLf & "（" & noMail & " 人沒有 Email，會略過）", "") & vbCrLf & vbCrLf & _
              "寄送期間請不要操作 Excel。確定開始？", vbOKCancel + vbQuestion, "寄送報到信") <> vbOK Then Exit Sub

    Set ol = GetOutlook(): If ol Is Nothing Then Exit Sub
    For i = 1 To todo.Count
        r = todo(i)
        Application.StatusBar = "寄送報到信 " & i & " / " & todo.Count & "：" & TextOf(ws.Cells(r, cols("姓名")))
        msg = SendOne(ol, ws, r, cols, Trim$(TextOf(ws.Cells(r, cols("Email")))), "")
        With ws.Cells(r, cols("寄送狀態"))
            If msg = "" Then
                .Value = "已寄送 " & Format$(Now, "yyyy/mm/dd hh:nn")
                .Font.Color = RGB(31, 122, 69)
                sent = sent + 1
            Else
                .Value = "失敗：" & msg
                .Font.Color = RGB(179, 38, 30)
                failed = failed + 1
            End If
        End With
        DoEvents
        If i < todo.Count Then Pause SEND_DELAY_SEC
    Next
    Application.StatusBar = False
    ThisWorkbook.Save

    MsgBox "寄送完成：成功 " & sent & " 封" & IIf(failed > 0, "，失敗 " & failed & " 封（看「寄送狀態」欄的原因，修正後再執行一次就只會寄失敗的人）", "") & "。" & vbCrLf & vbCrLf & _
           "可以到 Outlook「寄件備份」確認。", IIf(failed > 0, vbExclamation, vbInformation)
End Sub

'---------- 寄出一封 ----------
Private Function SendOne(ByVal ol As Object, ByVal ws As Worksheet, ByVal r As Long, ByVal cols As Object, ByVal toAddr As String, ByVal subjectPrefix As String) As String
    Dim code As String, qrPath As String, m As Object, att As Object
    On Error GoTo Fail

    code = UCase$(Trim$(TextOf(ws.Cells(r, cols("報到代碼")))))
    qrPath = Environ$("TEMP") & "\尾牙報到QRCode_" & code & ".png"
    If Not DownloadQR(code, qrPath) Then
        SendOne = "QR Code 圖片下載失敗（請確認網路可連到 api.qrserver.com）"
        Exit Function
    End If

    Set m = ol.CreateItem(0)
    m.To = toAddr
    m.Subject = subjectPrefix & MAIL_SUBJECT
    Set att = m.Attachments.Add(qrPath, 1)
    att.PropertyAccessor.SetProperty PR_ATTACH_CONTENT_ID, "yepqr"
    m.HTMLBody = BuildHtml(CellText(ws, r, cols, "姓名"), CellText(ws, r, cols, "部門"), CellText(ws, r, cols, "員工編號"), _
                           CellText(ws, r, cols, "桌號"), CellText(ws, r, cols, "葷素"), CellText(ws, r, cols, "抽獎編號"), code)
    m.Send
    On Error Resume Next
    Kill qrPath
    Exit Function
Fail:
    SendOne = Err.Description
End Function

Private Function BuildHtml(ByVal empName As String, ByVal dept As String, ByVal empId As String, ByVal tableNo As String, ByVal meal As String, ByVal lottery As String, ByVal code As String) As String
    Const FF As String = "font-family:'Microsoft JhengHei','PingFang TC',Arial,sans-serif;"
    Dim h As String, link As String, mealHtml As String
    link = TICKET_URL & code
    If InStr(meal, "素") > 0 Then
        mealHtml = "<b style=""color:#2E7D32;"">" & Esc(meal) & "</b>"
    Else
        mealHtml = Esc(IIf(meal = "", "-", meal))
    End If

    h = "<html><body style=""margin:0;padding:0;background:#F7F2EA;"">"
    h = h & "<table width=""100%"" cellpadding=""0"" cellspacing=""0"" style=""background:#F7F2EA;""><tr><td align=""center"" style=""padding:24px 12px;"">"
    h = h & "<table width=""560"" cellpadding=""0"" cellspacing=""0"" style=""background:#FFFFFF;border:1px solid #E4DAD0;" & FF & """>"
    ' 頁首
    h = h & "<tr><td style=""background:#A8261B;padding:22px 28px;color:#FFFFFF;" & FF & """>"
    h = h & "<div style=""font-size:13px;color:#F3D27A;letter-spacing:3px;"">報到通知</div>"
    h = h & "<div style=""font-size:26px;font-weight:bold;margin-top:4px;"">" & Esc(EVENT_NAME) & "</div></td></tr>"
    ' 內文
    h = h & "<tr><td style=""padding:24px 28px 8px;font-size:16px;line-height:1.8;color:#241B16;" & FF & """>"
    h = h & "<p style=""margin:0 0 12px;"">" & Esc(empName) & " 您好：</p>"
    h = h & "<p style=""margin:0 0 12px;"">誠摯邀請您參加" & Esc(EVENT_NAME) & "！報到時請出示下方您的專屬 QR Code，工作人員掃描後即完成報到。</p>"
    h = h & "<p style=""margin:0;""><b>時間：</b>" & Esc(EVENT_TIME) & "<br><b>地點：</b>" & Esc(EVENT_PLACE) & "</p>"
    h = h & "</td></tr>"
    ' QR Code
    h = h & "<tr><td align=""center"" style=""padding:16px 28px 4px;"">"
    h = h & "<img src=""cid:yepqr"" width=""220"" height=""220"" alt=""報到 QR Code"" style=""display:block;border:0;"">"
    h = h & "<div style=""font-size:13px;color:#6E625A;letter-spacing:2px;margin-top:6px;font-family:Consolas,monospace;"">" & Esc(code) & "</div>"
    h = h & "</td></tr>"
    ' 座位資訊
    h = h & "<tr><td style=""padding:12px 28px;"">"
    h = h & "<table width=""100%"" cellpadding=""8"" cellspacing=""0"" style=""border:1px solid #E4DAD0;font-size:15px;color:#241B16;" & FF & """>"
    h = h & InfoRow("員工編號", Esc(empId)) & InfoRow("部門", Esc(IIf(dept = "", "-", dept)))
    h = h & InfoRow("桌號", "<b style=""font-size:20px;"">" & Esc(IIf(tableNo = "", "-", tableNo)) & "</b>")
    h = h & InfoRow("餐點", mealHtml) & InfoRow("抽獎編號", "<b>" & Esc(IIf(lottery = "", "-", lottery)) & "</b>")
    h = h & "</table></td></tr>"
    ' 提醒
    h = h & "<tr><td style=""padding:8px 28px 24px;font-size:14px;line-height:1.8;color:#6E625A;" & FF & """>"
    h = h & "&#8226; 建議先把 QR Code 截圖存在手機，現場沒有網路也能使用。<br>"
    h = h & "&#8226; 看不到圖片嗎？<a href=""" & link & """ style=""color:#A8261B;"">點這裡開啟您的 QR Code</a>。<br>"
    h = h & "&#8226; QR Code 無法掃描時，向工作人員報上員工編號或姓名即可報到。<br>"
    h = h & "&#8226; 此 QR Code 為個人專屬，請勿轉寄他人。"
    If CONTACT <> "" Then h = h & "<br>&#8226; 如有問題請洽：" & Esc(CONTACT)
    h = h & "</td></tr></table></td></tr></table></body></html>"
    BuildHtml = h
End Function

Private Function InfoRow(ByVal label As String, ByVal valueHtml As String) As String
    InfoRow = "<tr><td width=""30%"" style=""background:#F7F2EA;color:#6E625A;border-bottom:1px solid #E4DAD0;"">" & label & _
              "</td><td style=""border-bottom:1px solid #E4DAD0;"">" & valueHtml & "</td></tr>"
End Function

'---------- 小工具 ----------
Private Function ListSheet() As Worksheet
    On Error Resume Next
    Set ListSheet = ThisWorkbook.Worksheets(SHEET_NAME)
    On Error GoTo 0
    If ListSheet Is Nothing Then MsgBox "找不到工作表「" & SHEET_NAME & "」，請把名單所在的工作表改名為「" & SHEET_NAME & "」。", vbExclamation
End Function

' 依第 1 列的標題找欄位；create = True 時找不到就在最後新增一欄
Private Function FindCol(ByVal ws As Worksheet, ByVal title As String, Optional ByVal create As Boolean = False) As Long
    Dim lastCol As Long, c As Long
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    For c = 1 To lastCol
        If StrComp(Trim$(CStr(ws.Cells(1, c).Value)), title, vbTextCompare) = 0 Then
            FindCol = c
            Exit Function
        End If
    Next
    If create Then
        FindCol = lastCol + 1
        ws.Cells(1, FindCol).Value = title
        ws.Cells(1, FindCol).Font.Bold = True
    End If
End Function

Private Function MailCols(ByVal ws As Worksheet) As Object
    Dim names As Variant, i As Long, c As Long, missing As String, d As Object
    Set d = CreateObject("Scripting.Dictionary")
    names = Array("員工編號", "姓名", "部門", "桌號", "葷素", "抽獎編號", "Email", "報到代碼")
    For i = LBound(names) To UBound(names)
        c = FindCol(ws, CStr(names(i)))
        If c = 0 And names(i) = "Email" Then c = FindCol(ws, "E-mail")
        If c = 0 And names(i) = "Email" Then c = FindCol(ws, "電子郵件")
        If c = 0 And (names(i) = "員工編號" Or names(i) = "姓名" Or names(i) = "Email" Or names(i) = "報到代碼") Then missing = missing & "「" & names(i) & "」"
        d(names(i)) = c
    Next
    If missing <> "" Then
        MsgBox "「" & SHEET_NAME & "」第 1 列找不到欄位：" & missing & IIf(InStr(missing, "報到代碼") > 0, vbCrLf & "（報到代碼請先執行 A1_GenerateCodes）", ""), vbExclamation
        Exit Function
    End If
    d("寄送狀態") = FindCol(ws, "寄送狀態", True)
    Set MailCols = d
End Function

Private Function CellText(ByVal ws As Worksheet, ByVal r As Long, ByVal cols As Object, ByVal title As String) As String
    If cols(title) > 0 Then CellText = Trim$(TextOf(ws.Cells(r, cols(title))))
End Function

' 儲存格顯示的文字（保留 001 這種格式）；欄寬太窄顯示成 ### 時改用實際值
Private Function TextOf(ByVal c As Range) As String
    TextOf = Trim$(c.Text)
    If TextOf <> "" And Replace(TextOf, "#", "") = "" Then TextOf = Trim$(CStr(c.Value))
End Function

Private Function LastDataRow(ByVal ws As Worksheet, ByVal c As Long) As Long
    LastDataRow = ws.Cells(ws.Rows.Count, c).End(xlUp).Row
End Function

Private Function NewCode() As String
    Dim i As Long, s As String
    ' 第一個字固定用英文字母（不含 E），貼到試算表時才不會被當成數字
    s = Mid$(CODE_FIRST, Int(Rnd() * Len(CODE_FIRST)) + 1, 1)
    For i = 2 To CODE_LEN
        s = s & Mid$(CODE_CHARS, Int(Rnd() * Len(CODE_CHARS)) + 1, 1)
    Next
    NewCode = s
End Function

Private Function DownloadQR(ByVal code As String, ByVal path As String) As Boolean
    Dim http As Object, st As Object
    On Error GoTo Fail
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", "https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=16&ecc=M&format=png&data=" & code, False
    http.send
    If http.Status <> 200 Then Exit Function
    Set st = CreateObject("ADODB.Stream")
    st.Type = 1
    st.Open
    st.Write http.responseBody
    st.SaveToFile path, 2
    st.Close
    DownloadQR = True
    Exit Function
Fail:
    DownloadQR = False
End Function

Private Function GetOutlook() As Object
    On Error Resume Next
    Set GetOutlook = GetObject(, "Outlook.Application")
    If GetOutlook Is Nothing Then Set GetOutlook = CreateObject("Outlook.Application")
    On Error GoTo 0
    If GetOutlook Is Nothing Then MsgBox "無法啟動 Outlook。請確認電腦上有安裝「傳統版 Outlook」並已登入公司信箱。", vbExclamation
End Function

Private Function MyAddress(ByVal ol As Object) As String
    On Error Resume Next
    MyAddress = ol.Session.CurrentUser.AddressEntry.GetExchangeUser.PrimarySmtpAddress
    If MyAddress = "" Then MyAddress = ol.Session.CurrentUser.Address
End Function

Private Function Esc(ByVal s As String) As String
    Esc = Replace(Replace(Replace(Replace(s, "&", "&amp;"), "<", "&lt;"), ">", "&gt;"), """", "&quot;")
End Function

Private Sub Pause(ByVal sec As Double)
    Dim t As Double
    t = Timer
    Do While Timer < t + sec And Timer >= t
        DoEvents
    Loop
End Sub
