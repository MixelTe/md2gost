function Open-WordPackage($Word, [string]$Path) {
    # Open inside VBA: Word 2007 can hang on the COM optional/ref arguments.
    # Unlike Range.InsertXML, this preserves document defaults and all sectPr.
    $hostCheck = $Word.Documents.Add()
    try {
        $projectCheck = $hostCheck.GetType().InvokeMember('VBProject', [System.Reflection.BindingFlags]::GetProperty, $null, $hostCheck, $null)
        $moduleCheck = $projectCheck.VBComponents.Add(1)
        $moduleCheck.CodeModule.AddFromString(@'
Function OpenRawE2EPackage(ByVal file As String) As Object
    Set OpenRawE2EPackage = Documents.Open(FileName:=file, ConfirmConversions:=False, ReadOnly:=False, AddToRecentFiles:=False, Visible:=True)
End Function
'@)
        $openedCheck = $Word.Run('OpenRawE2EPackage', [string]$Path)
        $openedCheck.Activate()
        return ,$openedCheck
    } finally { $hostCheck.Close(0) }
}
