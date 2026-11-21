param (
    [Parameter(Mandatory = $true)][string]$InputDoc,
    [Parameter(Mandatory = $true)][string]$VbaDir,
    [switch]$Visible,
    [switch]$WithoutContinuationStyles
)

$ErrorActionPreference = 'Stop'
$wordCheck = $null
$checkDoc = $null
$scratchPath = Join-Path (Split-Path ([System.IO.Path]::GetFullPath($InputDoc))) ('word-check-' + [guid]::NewGuid().ToString('N') + '.docx')

. (Join-Path $PSScriptRoot 'word-package.ps1')

function Assert-That([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-Snapshot {
    $snapshotCheck = [string]$wordCheck.Run('InspectContinuations', [string]$originalHeader)
    if ($snapshotCheck.StartsWith("ERROR`t")) { throw $snapshotCheck.Substring(6) }
    $partsCheck = $snapshotCheck -split "`t", 5
    Assert-That ($partsCheck.Count -eq 5) 'Invalid Word snapshot'
    $markersCheck = @([regex]::Matches($checkDoc.Content.Text, '[A-Z][A-Z0-9]*_(ROW|LINE)_[0-9]{3}') | ForEach-Object { $_.Value })
    return @{
        Markers = ($markersCheck -join '|')
        Pages = $partsCheck[0]
        TableCount = $partsCheck[1]
        ParagraphCount = $partsCheck[2]
        Continuations = $partsCheck[3]
        TableHeaders = $partsCheck[4]
    }
}
try {
    Write-Output 'WORD_STAGE starting'
    $wordCheck = New-Object -ComObject Word.Application
    $wordCheck.Visible = [bool]$Visible
    $wordCheck.DisplayAlerts = 0
    Write-Output 'WORD_STAGE opening DOCX through VBA'
    $checkDoc = Open-WordPackage $wordCheck ([System.IO.Path]::GetFullPath($InputDoc))
    [void]$checkDoc.GetType().InvokeMember('SaveAs', [System.Reflection.BindingFlags]::InvokeMethod, $null, $checkDoc, @([string]$scratchPath, [int]16))
    if (-not $WithoutContinuationStyles) {
        foreach ($stylePairCheck in @(@('Listing_Cont', 'Listing_Caption'), @('Table_Cont', 'Table_Caption'))) {
            try { $baseStyleCheck = $checkDoc.Styles.Item([string]$stylePairCheck[1]) } catch { continue }
            if ($null -eq $baseStyleCheck) { continue }
            $continuationStyleCheck = $checkDoc.Styles.Add([string]$stylePairCheck[0], 1)
            $continuationStyleCheck.BaseStyle = [string]$stylePairCheck[1]
        }
    }
    Write-Output 'WORD_STAGE importing'
    # Load source only into this temporary document, never into a DOTM/Normal template.
    foreach ($sourceName in @('Common.vba', 'AutoContinuation.bas')) {
        $projectCheck = $checkDoc.GetType().InvokeMember('VBProject', [System.Reflection.BindingFlags]::GetProperty, $null, $checkDoc, $null)
        $moduleCheck = $projectCheck.VBComponents.Add(1)
        $moduleCheck.CodeModule.AddFromString([System.IO.File]::ReadAllText((Join-Path $VbaDir $sourceName)))
    }
    $inspectorCheck = $projectCheck.VBComponents.Add(1)
    $inspectorCheck.CodeModule.AddFromString([System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'InspectContinuations.bas')))
    $beforeMarkers = @([regex]::Matches($checkDoc.Content.Text, '[A-Z][A-Z0-9]*_(ROW|LINE)_[0-9]{3}') | ForEach-Object { $_.Value }) -join '|'
    $originalHeader = if ($checkDoc.Tables.Count -gt 0) { $checkDoc.Tables.Item(1).Rows.Item(1).Range.Text } else { '' }
    $logPathCheck = Join-Path (Split-Path $InputDoc) '.md2gost_out/error.txt'

    Write-Output 'WORD_STAGE first run'
    $wordCheck.Run('AutoContinuation') | Out-Null
    Write-Output 'WORD_STAGE first snapshot'
    Assert-That (-not (Test-Path -LiteralPath $logPathCheck)) 'Macro wrote an error log'
    $firstCheck = Get-Snapshot
    Assert-That ($firstCheck.Markers -ceq $beforeMarkers) 'Rows or code lines were lost, duplicated, or reordered'
    Assert-That ($firstCheck.Continuations.Length -gt 0) 'Fixture did not exercise continuation insertion'

    Write-Output 'WORD_STAGE second run'
    $wordCheck.Run('AutoContinuation') | Out-Null
    Write-Output 'WORD_STAGE second snapshot'
    Assert-That (-not (Test-Path -LiteralPath $logPathCheck)) 'Repeated macro run wrote an error log'
    $secondCheck = Get-Snapshot
    foreach ($keyCheck in @('Markers', 'Continuations', 'TableHeaders', 'TableCount', 'Pages', 'ParagraphCount')) {
        Assert-That ($firstCheck[$keyCheck] -ceq $secondCheck[$keyCheck]) "Repeated run changed $keyCheck"
    }
    Write-Output ('WORD_OK pages={0} tables={1} continuations={2}' -f $secondCheck.Pages, $secondCheck.TableCount, ($secondCheck.Continuations -split '\|').Count)
} catch {
    Write-Output $_.ScriptStackTrace
    throw
} finally {
    if ($null -ne $checkDoc) { $checkDoc.Close(0) }
    if ($null -ne $wordCheck) {
        $wordCheck.Quit(0)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wordCheck)
    }
    if (Test-Path -LiteralPath $scratchPath) { Remove-Item -LiteralPath $scratchPath }
}
