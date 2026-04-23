Sub AutoTableContinuation()
    On Error GoTo ErrorHandler

    Dim i As Long, r As Long
    Dim tbl As Table, secondTbl As Table
    Dim tableNumber As String
    Dim prevPara As Paragraph, sepPara As Paragraph
    Dim currentPage As Long, previousPage As Long
    Dim headerRng As Range

	UpdateAllFields

    i = 1
    Do While i <= ActiveDocument.Tables.Count
        Set tbl = ActiveDocument.Tables(i)

        ' Find the caption (paragraph immediately before the table)
        Set prevPara = tbl.Range.Paragraphs(1).Previous
        If Not prevPara Is Nothing And (prevPara.Style = "Таблица_Подпись" Or prevPara.Style = "Таблица_Продолжение") Then
            tableNumber = ExtractTableNumber(prevPara.Range.Text)
        Else
            tableNumber = "?"
        End If

        If tableNumber <> "?" Then

            previousPage = tbl.Rows(1).Range.Information(wdActiveEndPageNumber)

            For r = 2 To tbl.Rows.Count
                currentPage = tbl.Rows(r).Range.Information(wdActiveEndPageNumber)

                If currentPage > previousPage Then
                    ' PAGE BREAK DETECTED: Split the table
                    tbl.Split r

                    ' The second half is now a completely new table
                    Set secondTbl = ActiveDocument.Tables(i + 1)

                    ' --- FIX 1: STOP TEXT FROM GOING INSIDE THE CELL ---
                    ' Target the exact paragraph mark Word inserts between the split tables
                    Set sepPara = secondTbl.Range.Characters.First.Previous.Paragraphs(1)

                    ' Insert the continuation text into that safe paragraph
                    sepPara.Range.InsertBefore "Продолжение таблицы " & tableNumber

                    ' Apply style safely
                    On Error Resume Next
                    sepPara.Style = "Таблица_Продолжение"
                    If Err.Number <> 0 Then
                        sepPara.Style = "Таблица_Подпись"
                        Err.Clear
                    End If
                    On Error GoTo 0

                    sepPara.PageBreakBefore = True
                    sepPara.KeepWithNext = True

                    ' --- FIX 2: COPY THE HEADER ROW ---
                    ' Copy the first row of the top table
                    tbl.Rows(1).Range.Copy

                    ' Paste it at the very beginning of the bottom table
                    Set headerRng = secondTbl.Range
                    headerRng.Collapse wdCollapseStart
                    headerRng.Paste

                    ' Exit the row loop. The second half will be checked on the next DO iteration.
                    Exit For
                End If

                previousPage = currentPage
            Next r
        End If

        i = i + 1
    Loop

	UpdateAllFields

    ' MsgBox "Готово!", vbInformation
    Exit Sub

ErrorHandler:
    LogError "Error #" & Err.Number & ": " & Err.Description
End Sub

Function ExtractTableNumber(text As String) As String
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")

    re.Pattern = "Таблиц[аы]\s+([\d\.]+)"
    re.IgnoreCase = True

    If re.Test(text) Then
        ExtractTableNumber = re.Execute(text)(0).SubMatches(0)
    Else
        ExtractTableNumber = "?"
    End If
End Function
