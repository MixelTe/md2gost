@echo off
set "OUT=styles.xml"

tar -xf gost_example.docx --to-stdout word/styles.xml > %OUT%

powershell -NoProfile -Command "(Get-Content '%OUT%' -Raw) -replace '(?=</?w:)', \"`r`n\" | Set-Content '%OUT%'"

