Option Explicit
Private Const STYLE_CODE As String = "Listing_Code"
Private Const STYLE_CAPTION As String = "Listing_Caption"
Private Const STYLE_CONT As String = "Listing_Cont"
Private CAPTION As String

Sub AutoListingContinuation()
    On Error GoTo ErrorHandler
    ' "Продолжение листинга"
    CAPTION = ChrW(1055) & ChrW(1088) & ChrW(1086) & ChrW(1076) & ChrW(1086) & ChrW(1083) & _
              ChrW(1078) & ChrW(1077) & ChrW(1085) & ChrW(1080) & ChrW(1077) & ChrW(32) & _
              ChrW(1083) & ChrW(1080) & ChrW(1089) & ChrW(1090) & ChrW(1080) & ChrW(1085) & _
              ChrW(1075) & ChrW(1072)

    Dim nextPara As Paragraph
    Dim listingNumber As String
    Dim currentPage As Long
    Dim lastPage As Long

    UpdateAllFields

    Dim rng As Range
    Set rng = ActiveDocument.Content
    With rng.Find
        .ClearFormatting
        .Style = STYLE_CAPTION
        .Text = ""
        .Forward = True
        .Wrap = wdFindStop

        Do While .Execute
            listingNumber = ExtractListingNumber(rng.Text)

            Set nextPara = rng.Paragraphs(1).Next
            lastPage = -1
            Do While Not nextPara Is Nothing
                If nextPara.Style <> STYLE_CODE Then Exit Do

                ' currentPage = nextPara.Range.Information(wdActiveEndPageNumber)
                DoEvents
                Dim r As Range
                Set r = nextPara.Range.Duplicate
                r.Collapse wdCollapseStart
                r.Select
                currentPage = Selection.Information(wdActiveEndPageNumber)

                If currentPage <> lastPage And lastPage <> -1 Then
                    If Not IsContinuationAlreadyInserted(nextPara) Then
                        InsertContinuation nextPara, listingNumber
                        ActiveDocument.Repaginate
                        DoEvents
                        Set r = nextPara.Range.Duplicate
                        r.Collapse wdCollapseStart
                        r.Select
                        currentPage = Selection.Information(wdActiveEndPageNumber)
                    End If
                End If

                lastPage = currentPage
                Set nextPara = nextPara.Next
            Loop

            rng.Collapse wdCollapseEnd
        Loop
    End With

    ' MsgBox "Готово", vbInformation
    Exit Sub
ErrorHandler:
    LogError "Error #" & Err.Number & ": " & Err.Description
End Sub

Function ExtractListingNumber(text As String) As String
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")

    re.Pattern = "Листинг\s+(.?[\d\.]+)"
    re.IgnoreCase = True

    If re.Test(text) Then
        ExtractListingNumber = re.Execute(text)(0).SubMatches(0)
    Else
        ExtractListingNumber = "?"
    End If
End Function
Function IsContinuationAlreadyInserted(p As Paragraph) As Boolean
    Dim prevPara As Paragraph
    On Error Resume Next
    Set prevPara = p.Previous
    On Error GoTo 0

    If prevPara Is Nothing Then
        IsContinuationAlreadyInserted = False
    Else
        IsContinuationAlreadyInserted = InStr(prevPara.Range.text, CAPTION) > 0
        ' IsContinuationAlreadyInserted = InStr(prevPara.Range.text, "Продолжение листинга") > 0
    End If
End Function
Sub InsertContinuation(p As Paragraph, listingNumber As String)
    Dim prev As Paragraph
    Dim prevPrev As Paragraph
    Dim r As Range
    Dim contPara As Paragraph

    On Error Resume Next
    Set prev = p.Previous
    If prev Is Nothing Then Exit Sub

    Set prevPrev = prev.Previous
    On Error GoTo 0

    ' --- СЛУЧАЙ 1 ---
    ' Предыдущий абзац — первый код после подписи
    If Not prevPrev Is Nothing Then
        If prevPrev.Style = STYLE_CAPTION Then

            ' Разрыв страницы перед подписью
            Set r = prevPrev.Range
            r.Collapse wdCollapseStart
            r.InsertBreak Type:=wdPageBreak

            Exit Sub
        End If
    End If

    Set r = prev.Range
    r.Collapse wdCollapseStart

    ' 1. Вставляем текст продолжения с переносом строки ПЕРЕД листингом.
    ' Это создает новый независимый абзац.
    ' r.InsertBefore "Продолжение листинга " & listingNumber & vbCr
    r.InsertBefore CAPTION & " " & listingNumber & vbCr

    ' 2. Теперь находим этот новый абзац (он стал предыдущим для prev)
    Set contPara = prev.Previous

    ' 3. Назначаем стиль (теперь он применится только к этому абзацу)
    On Error Resume Next
    contPara.Style = STYLE_CONT
    If Err.Number <> 0 Then
        contPara.Style = STYLE_CAPTION
        Err.Clear
    End If
    On Error GoTo 0

    ' 4. Вставляем разрыв страницы В НАЧАЛО этого нового абзаца.
    ' Так мы перенесем "Продолжение..." на новую страницу,
    ' оставив предыдущий текст со своим стилем на старой.
    Set r = contPara.Range
    r.Collapse wdCollapseStart
    contPara.PageBreakBefore = True

End Sub
