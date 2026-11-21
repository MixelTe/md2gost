Option Explicit

Private Const STYLE_CODE As String = "Listing_Code"
Private Const STYLE_LISTING_CAPTION As String = "Listing_Caption"
Private Const STYLE_LISTING_CONT As String = "Listing_Cont"
Private Const STYLE_TABLE_CAPTION As String = "Table_Caption"
Private Const STYLE_TABLE_CONT As String = "Table_Cont"

Sub AutoContinuation()
    On Error GoTo ErrorHandler

    Dim doc As Document
    Dim listingCaption As Paragraph, tbl As Table
    Dim remaining As Range
    Dim pos As Long, nextPos As Long
    Dim listingPos As Long, tablePos As Long
    Set doc = ActiveDocument

    UpdateAllFields

    ' Ask Word for the next caption/table instead of visiting body paragraphs.
    ' Rebuild both candidates after every edit, since their positions can move.
    pos = doc.Content.Start
    Do While pos < doc.Content.End - 1
        Set listingCaption = FindNextListingCaption(doc, pos)
        listingPos = doc.Content.End
        If Not listingCaption Is Nothing Then listingPos = listingCaption.Range.Start

        Set tbl = Nothing
        tablePos = doc.Content.End
        Set remaining = doc.Range(pos, doc.Content.End)
        If remaining.Tables.Count > 0 Then
            Set tbl = remaining.Tables(1)
            tablePos = tbl.Range.Start
        End If

        If listingPos < tablePos Then
            nextPos = ProcessListing(doc, listingCaption)
        ElseIf Not tbl Is Nothing Then
            ProcessTable doc, tbl
            ' After a split, visit the separator and the new table next.
            nextPos = tbl.Range.End
        Else
            Exit Do
        End If

        If nextPos <= pos Then
            Err.Raise vbObjectError + 1, "AutoContinuation", "Document traversal did not advance"
        End If
        pos = nextPos
    Loop
    Exit Sub

ErrorHandler:
    LogError "AutoContinuation: Error #" & Err.Number & ": " & Err.Description
End Sub

Private Function FindNextListingCaption(doc As Document, startPos As Long) As Paragraph
    Dim caption As Paragraph, continuation As Paragraph
    Set caption = FindNextStyledParagraph(doc, startPos, STYLE_LISTING_CAPTION)
    Set continuation = FindNextStyledParagraph(doc, startPos, STYLE_LISTING_CONT)

    If caption Is Nothing Then
        Set FindNextListingCaption = continuation
    ElseIf continuation Is Nothing Then
        Set FindNextListingCaption = caption
    ElseIf caption.Range.Start <= continuation.Range.Start Then
        Set FindNextListingCaption = caption
    Else
        Set FindNextListingCaption = continuation
    End If
End Function

Private Function FindNextStyledParagraph(doc As Document, startPos As Long, styleName As String) As Paragraph
    Dim requiredStyle As Style
    Dim search As Range, p As Paragraph

    ' Continuation styles may be absent; insertion then uses the caption style.
    On Error Resume Next
    Set requiredStyle = doc.Styles(styleName)
    On Error GoTo 0
    If requiredStyle Is Nothing Then Exit Function

    Do While startPos < doc.Content.End - 1
        Set search = doc.Range(startPos, doc.Content.End)
        With search.Find
            .ClearFormatting
            .Text = ""
            .Style = requiredStyle
            .Format = True
            .Forward = True
            .Wrap = wdFindStop
            .MatchWildcards = False
            .MatchWholeWord = False
            .MatchCase = False
            .MatchSoundsLike = False
            .MatchAllWordForms = False
            If Not .Execute Then Exit Function
        End With

        Set p = search.Paragraphs(1)
        If Not p.Range.Information(wdWithInTable) Then
            Set FindNextStyledParagraph = p
            Exit Function
        End If
        ' Captions inside cells are not separate elements of the main story.
        startPos = p.Range.Tables(1).Range.End
    Loop
End Function

Private Function ListingContinuationCaption() As String
    ' "Продолжение листинга" (safe when imported into the VBA editor).
    ListingContinuationCaption = ChrW(1055) & ChrW(1088) & ChrW(1086) & ChrW(1076) & ChrW(1086) & ChrW(1083) & _
        ChrW(1078) & ChrW(1077) & ChrW(1085) & ChrW(1080) & ChrW(1077) & ChrW(32) & _
        ChrW(1083) & ChrW(1080) & ChrW(1089) & ChrW(1090) & ChrW(1080) & ChrW(1085) & ChrW(1075) & ChrW(1072)
End Function

Private Function TableContinuationCaption() As String
    ' "Продолжение таблицы "
    TableContinuationCaption = ChrW(1055) & ChrW(1088) & ChrW(1086) & ChrW(1076) & ChrW(1086) & ChrW(1083) & _
        ChrW(1078) & ChrW(1077) & ChrW(1085) & ChrW(1080) & ChrW(1077) & ChrW(32) & _
        ChrW(1090) & ChrW(1072) & ChrW(1073) & ChrW(1083) & ChrW(1080) & ChrW(1094) & ChrW(1099) & ChrW(32)
End Function

Private Function ProcessListing(doc As Document, captionPara As Paragraph) As Long
    Dim nextPara As Paragraph
    Dim listingNumber As String
    Dim currentPage As Long, lastPage As Long
    Dim r As Range

    ProcessListing = captionPara.Range.End
    listingNumber = ExtractListingNumber(captionPara.Range.Text)
    If listingNumber = "" Then Exit Function

    Set nextPara = captionPara.Next
    lastPage = -1
    Do While Not nextPara Is Nothing
        If nextPara.Range.Information(wdWithInTable) Then Exit Do

        If IsListingContinuation(nextPara, listingNumber) Then
            ' Existing continuations belong to this listing too (repeat runs).
            lastPage = -1
        ElseIf nextPara.Style = STYLE_CODE Then
            ' Keep the Selection-based page query: Word can return stale page
            ' information for a code paragraph's Range after layout changes.
            DoEvents
            Set r = nextPara.Range.Duplicate
            r.Collapse wdCollapseStart
            r.Select
            currentPage = Selection.Information(wdActiveEndPageNumber)

            If currentPage <> lastPage And lastPage <> -1 Then
                If Not IsContinuationAlreadyInserted(nextPara) Then
                    InsertListingContinuation nextPara, listingNumber
                    doc.Repaginate
                    DoEvents
                    Set r = nextPara.Range.Duplicate
                    r.Collapse wdCollapseStart
                    r.Select
                    currentPage = Selection.Information(wdActiveEndPageNumber)
                End If
            End If
            lastPage = currentPage
        Else
            Exit Do
        End If

        ProcessListing = nextPara.Range.End
        Set nextPara = nextPara.Next
    Loop
End Function

Private Function IsListingContinuation(p As Paragraph, listingNumber As String) As Boolean
    If InStr(p.Range.Text, ListingContinuationCaption()) = 0 Then Exit Function
    IsListingContinuation = (ExtractListingNumber(p.Range.Text) = listingNumber)
End Function

Private Function IsContinuationAlreadyInserted(p As Paragraph) As Boolean
    Dim prevPara As Paragraph
    Set prevPara = p.Previous
    If prevPara Is Nothing Then Exit Function
    IsContinuationAlreadyInserted = (InStr(prevPara.Range.Text, ListingContinuationCaption()) > 0)
End Function

Private Sub InsertListingContinuation(p As Paragraph, listingNumber As String)
    Dim prev As Paragraph, prevPrev As Paragraph
    Dim r As Range, contPara As Paragraph

    Set prev = p.Previous
    If prev Is Nothing Then Exit Sub
    Set prevPrev = prev.Previous

    If Not prevPrev Is Nothing Then
        If prevPrev.Style = STYLE_LISTING_CAPTION And InStr(prevPrev.Range.Text, ListingContinuationCaption()) = 0 Then
            ' Preserve the Word workaround for a single code line after the title.
            Set r = prevPrev.Range
            r.Collapse wdCollapseStart
            r.InsertBreak Type:=wdPageBreak
            Exit Sub
        End If
    End If

    ' Deliberately move the preceding code paragraph along with the continuation.
    Set r = prev.Range
    r.Collapse wdCollapseStart
    r.InsertBefore ListingContinuationCaption() & " " & listingNumber & vbCr
    Set contPara = prev.Previous
    ApplyContinuationStyle contPara, STYLE_LISTING_CONT, STYLE_LISTING_CAPTION
    contPara.PageBreakBefore = True
    contPara.KeepWithNext = True
End Sub

Private Sub ProcessTable(doc As Document, tbl As Table)
    Dim r As Long, moved As Boolean
    Dim secondTbl As Table
    Dim tableNumber As String
    Dim prevPara As Paragraph, sepPara As Paragraph
    Dim currentPage As Long, previousPage As Long

    Set prevPara = tbl.Range.Paragraphs(1).Previous
    If prevPara Is Nothing Then Exit Sub
    If prevPara.Style <> STYLE_TABLE_CAPTION And prevPara.Style <> STYLE_TABLE_CONT Then Exit Sub
    tableNumber = ExtractTableNumber(prevPara.Range.Text)
    If tableNumber = "" Then Exit Sub

    previousPage = tbl.Rows(1).Range.Information(wdActiveEndPageNumber)
    currentPage = tbl.Rows(tbl.Rows.Count).Range.Information(wdActiveEndPageNumber)
    If previousPage = currentPage Then Exit Sub

    r = 2
    Do While r <= tbl.Rows.Count
        currentPage = tbl.Rows(r).Range.Information(wdActiveEndPageNumber)
        If currentPage > previousPage Then
            If r < 4 And Not moved Then
                prevPara.Range.ParagraphFormat.PageBreakBefore = True
                doc.Repaginate
                DoEvents
                previousPage = tbl.Rows(1).Range.Information(wdActiveEndPageNumber)
                r = 2
                moved = True
            Else
                ' Splitting before the first data row would reproduce the same
                ' oversized fragment forever, adding only a header each time.
                If r = 2 Then
                    Err.Raise vbObjectError + 2, "AutoContinuation", "Table header and first data row do not fit on one page"
                End If
                tbl.AllowAutoFit = False
                Set secondTbl = tbl.Split(r)

                ' Word inserts this paragraph OUTSIDE the cells. Do not insert
                ' through the second table's Range (the text can enter a cell).
                Set sepPara = secondTbl.Range.Characters.First.Previous.Paragraphs(1)
                sepPara.Range.InsertBefore TableContinuationCaption() & tableNumber
                ApplyContinuationStyle sepPara, STYLE_TABLE_CONT, STYLE_TABLE_CAPTION
                sepPara.PageBreakBefore = True
                sepPara.KeepWithNext = True

                ' Preserve the row-copy workaround; replacing this with Paste or
                ' assigning the whole table's FormattedText is unreliable in Word.
                secondTbl.Rows.Add BeforeRow:=secondTbl.Rows(1)
                secondTbl.Rows(1).Range.FormattedText = tbl.Rows(1).Range.FormattedText
                secondTbl.Rows(2).Delete

                doc.Repaginate
                DoEvents
                Exit Sub
            End If
        Else
            previousPage = currentPage
            r = r + 1
        End If
    Loop
End Sub

Private Sub ApplyContinuationStyle(p As Paragraph, styleName As String, fallbackStyle As String)
    On Error Resume Next
    p.Style = styleName
    If Err.Number <> 0 Then
        Err.Clear
        On Error GoTo 0
        p.Style = fallbackStyle
    End If
    On Error GoTo 0
End Sub

Function ExtractListingNumber(text As String) As String
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")

    Dim sListing As String
    sListing = ChrW(&H41B) & ChrW(&H438) & ChrW(&H441) & ChrW(&H442) & ChrW(&H438) & ChrW(&H43D) & ChrW(&H433)

    Dim whitespace As String
    whitespace = "[ " & vbTab & ChrW(160) & ChrW(&H202F) & "]+"
    ' Accept both the original caption and "Продолжение листинга <number>".
    re.Pattern = sListing & "[" & ChrW(&H430) & "]?" & whitespace & "(([A-Za-z" & ChrW(&H410) & "-" & ChrW(&H42F) & _
                 ChrW(&H401) & ChrW(&H430) & "-" & ChrW(&H44F) & ChrW(&H451) & _
                 "]\.)?[0-9]+(\.[0-9]+)*)([^A-Za-z0-9." & ChrW(&H410) & "-" & ChrW(&H44F) & "]|$)"
    re.IgnoreCase = True

    If re.Test(text) Then
        ExtractListingNumber = re.Execute(text)(0).SubMatches(0)
    Else
        ExtractListingNumber = ""
    End If
End Function

Function ExtractTableNumber(text As String) As String
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")

    Dim sTable As String
    sTable = ChrW(&H422) & ChrW(&H430) & ChrW(&H431) & ChrW(&H43B) & ChrW(&H438) & ChrW(&H446)

    Dim whitespace As String
    whitespace = "[ " & vbTab & ChrW(160) & ChrW(&H202F) & "]+"
    re.Pattern = sTable & "[" & ChrW(&H430) & ChrW(&H44B) & "]" & whitespace & "(([A-Za-z" & ChrW(&H410) & "-" & ChrW(&H42F) & _
                 ChrW(&H401) & ChrW(&H430) & "-" & ChrW(&H44F) & ChrW(&H451) & _
                 "]\.)?[0-9]+(\.[0-9]+)*)([^A-Za-z0-9." & ChrW(&H410) & "-" & ChrW(&H44F) & "]|$)"
    re.IgnoreCase = True

    If re.Test(text) Then
        ExtractTableNumber = re.Execute(text)(0).SubMatches(0)
    Else
        ExtractTableNumber = ""
    End If
End Function
