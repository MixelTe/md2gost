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

    Dim r As Range
    Dim contPara As Paragraph

    ' Вставляем пустой абзац ПЕРЕД кодом
    Set r = p.Range
    r.Collapse wdCollapseStart
    r.InsertParagraphBefore

    ' Работаем строго с новым абзацем
    Set contPara = p.Previous
    contPara.Range.InsertParagraphAfter

    ' Заполняем текст
    contPara.Range.text = "Продолжение листинга " & listingNumber

    ' Назначаем стиль
    On Error Resume Next
    contPara.Style = "Листинг_Продолжение"
    If Err.Number <> 0 Then
        contPara.Style = "Листинг_Подпись"
        Err.Clear
    End If
    On Error GoTo 0

    ' ГАРАНТИЯ разделения с кодом
    ' contPara.Range.InsertParagraphAfter

End Sub