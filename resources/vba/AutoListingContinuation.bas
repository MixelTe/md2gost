Sub AutoListingContinuation()
    On Error GoTo ErrorHandler

    Dim doc As Document
    Set doc = ActiveDocument

    Dim i As Long
    Dim listingNumber As String
    Dim currentPage As Long
    Dim lastPage As Long
    Dim para As Paragraph
    Dim codeStart As Boolean

    codeStart = False
    listingNumber = ""

    UpdateAllFields

    For i = 1 To doc.Paragraphs.Count

        Set para = doc.Paragraphs(i)

        ' 1. Нашли подпись листинга
        If para.Style = "Листинг_Подпись" Then
            listingNumber = ExtractListingNumber(para.Range.text)
            codeStart = False
        End If

        ' 2. Начался код листинга
        If para.Style = "Листинг_Код" Then

            currentPage = para.Range.Information(wdActiveEndPageNumber)

            If Not codeStart Then
                lastPage = currentPage
                codeStart = True
            Else
                ' 3. Код перешёл на новую страницу
                If currentPage <> lastPage Then

                    ' Проверяем, нет ли уже "Продолжения"
                    If Not IsContinuationAlreadyInserted(para) Then
                        InsertContinuation para, listingNumber
                    End If

                    lastPage = currentPage
                End If
            End If

        Else
            codeStart = False
        End If

    Next i

    ' MsgBox "Готово", vbInformation
    Exit Sub
ErrorHandler:
    LogError "Error #" & Err.Number & ": " & Err.Description
End Sub

Function ExtractListingNumber(text As String) As String
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")

    re.Pattern = "Листинг\s+([\d\.]+)"
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
        IsContinuationAlreadyInserted = _
            InStr(prevPara.Range.text, "Продолжение листинга") > 0
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
        If prevPrev.Style = "Листинг_Подпись" Then

            ' Разрыв страницы перед подписью
            Set r = prevPrev.Range
            r.Collapse wdCollapseStart
            r.InsertBreak Type:=wdPageBreak

            Exit Sub
        End If
    End If

    ' --- СЛУЧАЙ 2 ---
    ' Код продолжается не сразу после подписи
    ' Разрыв страницы перед prev

    ' Set r = prev.Range
    ' r.Collapse wdCollapseStart
    ' r.MoveStart Unit:=wdCharacter, Count:=-1

    ' ' Теперь r выделяет только знак абзаца (перенос строки) перед листингом.
    ' ' Заменяем его на: Разрыв страницы + Текст продолжения + Новый перенос строки
    ' r.Text = Chr(12) & "Продолжение листинга " & listingNumber & vbCr


    ' Set r = prev.Range
    ' r.Collapse wdCollapseStart
    ' r.InsertBreak Type:=wdPageBreak

    ' ' Вставляем continuation после разрыва
    ' r.InsertBefore "Продолжение листинга " & listingNumber & vbCr

    ' Set contPara = prev.Previous

    ' ' Назначаем стиль
    ' On Error Resume Next
    ' contPara.Style = "Листинг_Продолжение"
    ' If Err.Number <> 0 Then
    '     contPara.Style = "Листинг_Подпись"
    '     Err.Clear
    ' End If
    ' On Error GoTo 0

    Set r = prev.Range
    r.Collapse wdCollapseStart

    ' 1. Вставляем текст продолжения с переносом строки ПЕРЕД листингом.
    ' Это создает новый независимый абзац.
    r.InsertBefore "Продолжение листинга " & listingNumber & vbCr

    ' 2. Теперь находим этот новый абзац (он стал предыдущим для prev)
    Set contPara = prev.Previous

    ' 3. Назначаем стиль (теперь он применится только к этому абзацу)
    On Error Resume Next
    contPara.Style = "Листинг_Продолжение"
    If Err.Number <> 0 Then
        contPara.Style = "Листинг_Подпись"
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
Sub CleanListingContinuations()

    Dim p As Paragraph
    Dim txt As String

    For Each p In ActiveDocument.Paragraphs
        txt = Trim(p.Range.Text)

        If txt Like "Продолжение листинга*" Then
            p.Range.Delete
        End If
    Next p

End Sub
