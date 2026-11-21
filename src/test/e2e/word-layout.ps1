param (
    [Parameter(Mandatory=$true)][string]$InputDoc,
    [Parameter(Mandatory=$true)][string]$OutputDoc,
    [string]$MacroTemplate,
    [switch]$RenderPDF,
    [switch]$WithoutContinuationStyles,
    [string]$ExpectedError
)
$ErrorActionPreference = 'Stop'
$InputDoc = [System.IO.Path]::GetFullPath($InputDoc)
$OutputDoc = [System.IO.Path]::GetFullPath($OutputDoc)
. (Join-Path $PSScriptRoot 'helpers/word-package.ps1')
$vbaDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../resources/vba'))
$outDir = Split-Path ([System.IO.Path]::GetFullPath($OutputDoc))
$scratchPath = Join-Path $outDir ('native-' + [guid]::NewGuid().ToString('N') + '.docx')
$logPath = Join-Path $outDir '.md2gost_out/error.txt'
# Each fixture owns this output directory. Remove only generated files so stale
# errors cannot satisfy a negative test and Word 2007 cannot prompt to overwrite.
$generatedDir = Join-Path $outDir '.md2gost_out'
if (Test-Path -LiteralPath $generatedDir) {
    Get-ChildItem -LiteralPath $generatedDir -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
}
$word = $null
$doc = $null
function Assert-Layout($result) {
    if ([string]$result -like 'ERROR:*') { throw [string]$result }
}
try {
    $existing = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $owned = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.Id -notin $existing })
    if ($owned.Count -gt 0) { Write-Output ('[WordPID:' + $owned[0].Id + ']') }
    $doc = Open-WordPackage $word ([System.IO.Path]::GetFullPath($InputDoc))
    [void]$doc.GetType().InvokeMember('SaveAs',[System.Reflection.BindingFlags]::InvokeMethod,$null,$doc,@([string]$scratchPath,[int]16))
    Write-Output ('LAYOUT opened ' + $doc.PageSetup.PageWidth + 'x' + $doc.PageSetup.PageHeight + ' readonly=' + $doc.ReadOnly)
    if (-not $WithoutContinuationStyles) {
        foreach ($pair in @(@('Listing_Cont','Listing_Caption'),@('Table_Cont','Table_Caption'))) {
            try { $baseStyle = $doc.Styles.Item([string]$pair[1]) } catch { continue }
            if ($null -eq $baseStyle) { continue }
            $style = $doc.Styles.Add([string]$pair[0],1)
            $style.BaseStyle = [string]$pair[1]
        }
    }
    $project = $doc.GetType().InvokeMember('VBProject',[System.Reflection.BindingFlags]::GetProperty,$null,$doc,$null)
    foreach ($file in @('Common.vba','AutoContinuation.bas','RenderToPDF.bas')) {
        $module = $project.VBComponents.Add(1)
        $module.CodeModule.AddFromString([System.IO.File]::ReadAllText((Join-Path $vbaDir $file)))
    }
    $module = $project.VBComponents.Add(1)
    $module.CodeModule.AddFromString([System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'LayoutVerifier.bas')))
    Assert-Layout ($word.Run('CaptureLayoutBaseline'))
    Write-Output 'LAYOUT first run'
    $word.Run('AutoContinuation') | Out-Null
    if (Test-Path -LiteralPath $logPath) {
        $errorText = [System.IO.File]::ReadAllText($logPath)
        if ($ExpectedError -and $errorText -match $ExpectedError) {
            Write-Output ('EXPECTED_ERROR ' + $errorText.Trim())
            return
        }
        throw $errorText
    }
    if ($ExpectedError) { throw 'Expected macro error was not reported' }
    $first = [string]$word.Run('InspectLayout')
    Assert-Layout $first
    Write-Output 'LAYOUT second run'
    $word.Run('AutoContinuation') | Out-Null
    if (Test-Path -LiteralPath $logPath) { throw [System.IO.File]::ReadAllText($logPath) }
    $second = [string]$word.Run('InspectLayout')
    Assert-Layout $second
    if ($first -cne $second) { throw ('Repeated macro run changed layout: ' + $first + ' -> ' + $second) }
    if ($RenderPDF) {
        Write-Output 'LAYOUT export PDF'
        $word.Run('RenderSegmentsToPDF') | Out-Null
        if (Test-Path -LiteralPath $logPath) { throw [System.IO.File]::ReadAllText($logPath) }
    }
    [void]$doc.GetType().InvokeMember('SaveAs',[System.Reflection.BindingFlags]::InvokeMethod,$null,$doc,@([string]$OutputDoc,[int]16))
    [System.IO.File]::WriteAllText(($OutputDoc + '.layout.txt'), $second)
    Write-Output ('LAYOUT_OK ' + $second)
} catch {
    Write-Output $_.ScriptStackTrace
    throw
} finally {
    if ($null -ne $doc) { try { $doc.Close(0) } catch {} }
    if ($null -ne $word) { try { $word.Quit(0) } catch {} }
    if (Test-Path -LiteralPath $scratchPath) { Remove-Item -LiteralPath $scratchPath }
}
