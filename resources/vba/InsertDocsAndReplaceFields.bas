Option Explicit

Sub InsertDocsAndReplaceFields()
    Dim doc As Document
    Set doc = ActiveDocument

    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "^!!\((.*?)\)\s*(\{.*\})$"
    re.Global = False

    Dim i As Long
    For i = doc.Paragraphs.Count To 1 Step -1
        Dim para As Paragraph
        Set para = doc.Paragraphs(i)

        Dim markerText As String
        markerText = Trim(Replace(para.Range.Text, vbCr, ""))

        If re.Test(markerText) Then
            Dim m As Object
            Set m = re.Execute(markerText)(0)

            Dim filePath As String
            Dim jsonText As String
            filePath = m.SubMatches(0)
            jsonText = m.SubMatches(1)

            ' Delete marker paragraph COMPLETELY
            Dim insertPos As Long
            insertPos = para.Range.Start
            para.Range.Delete

            ' Create a fresh, detached range
            Dim targetRange As Range
            Set targetRange = doc.Range(insertPos, insertPos)

            ' Open source document
            Dim srcDoc As Document
            Set srcDoc = Documents.Open( _
                FileName:=filePath, _
                ReadOnly:=True, _
                AddToRecentFiles:=False, _
                Visible:=False)

            ' === BIT-PERFECT INSERT ===
            targetRange.FormattedText = srcDoc.Content.FormattedText

            ' Track inserted range
            Dim insertedRange As Range
            Set insertedRange = doc.Range(targetRange.Start, targetRange.End)

            ' Replace placeholders
            Dim dict As Object
            Set dict = ParseJsonLike(jsonText)

            Dim key As Variant
            For Each key In dict.Keys
                ReplaceInRange insertedRange, "{{" & key & "}}", dict(key)
            Next key

            srcDoc.Close SaveChanges:=False
        End If
    Next i
End Sub
Sub ReplaceInRange(rng As Range, findText As String, replaceText As String)
    With rng.Find
        .ClearFormatting
        .Replacement.ClearFormatting
        .Text = findText
        .Replacement.Text = replaceText
        .Wrap = wdFindStop
        .Execute Replace:=wdReplaceAll
    End With
End Sub
Function ParseJsonLike(json As String) As Object
    Dim dict As Object
    Set dict = CreateObject("Scripting.Dictionary")

    json = Trim(json)
    json = Mid(json, 2, Len(json) - 2) ' remove { }

    Dim pairs() As String
    pairs = Split(json, ",")

    Dim i As Long
    For i = 0 To UBound(pairs)
        Dim kv() As String
        kv = Split(pairs(i), ":")

        Dim key As String
        Dim val As String

        key = Trim(kv(0))
        val = Trim(kv(1))

        key = Replace(key, """", "")
        val = Replace(val, """", "")

        dict(key) = val
    Next i

    Set ParseJsonLike = dict
End Function