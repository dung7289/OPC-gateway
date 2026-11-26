param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("list_processes", "open", "attach")]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$DllPath,

    [string]$ProjectPath = "",
    [string]$OutputDir = "",
    [int]$ProcessIndex = 0
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Emit-JsonResult {
    param([hashtable]$Payload)
    $json = $Payload | ConvertTo-Json -Depth 12 -Compress
    Write-Output "###TIA_JSON_START###"
    Write-Output $json
    Write-Output "###TIA_JSON_END###"
}

function Sanitize-FileName {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) { return "item" }
    $clean = $Name -replace '[\\/:*?"<>|]', '_'
    return $clean.Trim()
}

if (-not (Test-Path -LiteralPath $DllPath)) {
    Emit-JsonResult @{
        ok = $false
        error_code = "DLL_NOT_FOUND"
        error = "Không tìm thấy TIA Openness DLL tại: $DllPath"
    }
    exit 0
}

$script:OpennessDllDir = Split-Path -Parent $DllPath
$resolveHandler = [System.ResolveEventHandler]{
    param($sender, $eventArgs)
    try {
        $asmName = (New-Object System.Reflection.AssemblyName($eventArgs.Name)).Name
        $cand = Join-Path $script:OpennessDllDir ($asmName + ".dll")
        if (Test-Path -LiteralPath $cand) {
            return [System.Reflection.Assembly]::LoadFrom($cand)
        }
    } catch {}
    return $null
}
[System.AppDomain]::CurrentDomain.add_AssemblyResolve($resolveHandler)

try {
    $null = [System.Reflection.Assembly]::LoadFrom($DllPath)
    $step7Dll = Join-Path $script:OpennessDllDir "Siemens.Engineering.Step7.dll"
    if (Test-Path -LiteralPath $step7Dll) {
        $null = [System.Reflection.Assembly]::LoadFrom($step7Dll)
    }
} catch {
    Emit-JsonResult @{
        ok = $false
        error_code = "DLL_LOAD_ERROR"
        error = "Không nạp được Openness DLL ($DllPath): $($_.Exception.Message)"
    }
    exit 0
}

if ($Mode -eq "list_processes") {
    try {
        $procs = [Siemens.Engineering.TiaPortal]::GetProcesses()
        $list = New-Object System.Collections.Generic.List[object]
        $idx = 0
        foreach ($p in $procs) {
            try {
                $exePath = if ($p.Path) { $p.Path.FullName } else { "" }
                $projPath = if ($p.ProjectPath) { $p.ProjectPath.FullName } else { "" }
                $verMatch = [regex]::Match($exePath, 'Portal\s+(V[\d\.]+)')
                $verLabel = if ($verMatch.Success) { $verMatch.Groups[1].Value } else { "" }
                $list.Add(@{
                    index = $idx
                    process_id = [int]$p.Id
                    project_path = $projPath
                    mode = "$($p.Mode)"
                    version = $verLabel
                    exe_path = $exePath
                })
            } finally {
                try { $p.Dispose() } catch {}
            }
            $idx++
        }
        Emit-JsonResult @{
            ok = $true
            processes = $list.ToArray()
        }
    } catch {
        Emit-JsonResult @{
            ok = $false
            error_code = "LIST_PROCESSES_ERROR"
            error = $_.Exception.Message
        }
    }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    Emit-JsonResult @{
        ok = $false
        error_code = "INVALID_ARGS"
        error = "Thiếu OutputDir."
    }
    exit 0
}

$null = New-Item -ItemType Directory -Path $OutputDir -Force

$tia = $null
$project = $null
$attachedProc = $null
$warnings = New-Object System.Collections.Generic.List[string]
$script:ExportCounter = 0

try {
    if ($Mode -eq "attach") {
        $procs = [Siemens.Engineering.TiaPortal]::GetProcesses()
        if (-not $procs -or $ProcessIndex -lt 0 -or $ProcessIndex -ge $procs.Count) {
            throw "Không tìm thấy cửa sổ TIA Portal ở vị trí #$ProcessIndex."
        }
        for ($i = 0; $i -lt $procs.Count; $i++) {
            if ($i -eq $ProcessIndex) {
                $attachedProc = $procs[$i]
            } else {
                try { $procs[$i].Dispose() } catch {}
            }
        }
        $tia = $attachedProc.Attach()
        if (-not $tia -or $tia.Projects.Count -eq 0) {
            throw "Cửa sổ TIA Portal được chọn hiện chưa mở Project nào."
        }
        $project = $tia.Projects[0]
    } else {
        if ([string]::IsNullOrWhiteSpace($ProjectPath) -or -not (Test-Path -LiteralPath $ProjectPath)) {
            throw "Không tìm thấy file dự án TIA Portal: $ProjectPath"
        }
        $fileInfo = New-Object System.IO.FileInfo($ProjectPath)
        $tia = New-Object Siemens.Engineering.TiaPortal([Siemens.Engineering.TiaPortalMode]::WithoutUserInterface)
        try {
            $project = $tia.Projects.Open($fileInfo)
        } catch {
            $openErr = $_.Exception.Message
            if ($_.Exception.InnerException) {
                $openErr += " | " + $_.Exception.InnerException.Message
            }
            $upgradeMethod = $tia.Projects.GetType().GetMethod("OpenWithUpgrade", [type[]]@([System.IO.FileInfo]))
            if ($null -ne $upgradeMethod -and $openErr -match 'upgrade|version|OpenWithUpgrade|older') {
                $warnings.Add("Dự án được tự động nâng cấp tạm thời trong bản sao để đọc bằng TIA Openness.")
                $project = $tia.Projects.OpenWithUpgrade($fileInfo)
            } else {
                throw
            }
        }
    }

    # Resolve reflection helper for generic DeviceItem.GetService<SoftwareContainer>()
    $scType = [type]"Siemens.Engineering.HW.Features.SoftwareContainer"
    $devItemType = [type]"Siemens.Engineering.HW.DeviceItem"
    $mGetService = $devItemType.GetMethod("GetService").MakeGenericMethod([type[]]@($scType))

    $plcResults = New-Object System.Collections.Generic.List[object]
    $seenDevices = New-Object System.Collections.Generic.HashSet[string]

    function Walk-DeviceItems {
        param($Items, [string]$DevName, [ref]$Collected)
        if (-not $Items) { return }
        foreach ($item in $Items) {
            try {
                $sc = $mGetService.Invoke($item, $null)
                if ($null -ne $sc -and $null -ne $sc.Software) {
                    $swType = $sc.Software.GetType().FullName
                    if ($swType -like "*PlcSoftware*") {
                        $Collected.Value += @{
                            plc_name = if ($sc.Software.Name) { "$($sc.Software.Name)" } elseif ($DevName) { $DevName } else { "$($item.Name)" }
                            device_name = $DevName
                            software = $sc.Software
                        }
                    }
                }
            } catch {}
            try {
                if ($item.DeviceItems -and $item.DeviceItems.Count -gt 0) {
                    Walk-DeviceItems -Items $item.DeviceItems -DevName $DevName -Collected $Collected
                }
            } catch {}
        }
    }

    function Collect-Devices {
        param($Devices, [ref]$Collected)
        if (-not $Devices) { return }
        foreach ($dev in $Devices) {
            $dName = ""
            try { $dName = "$($dev.Name)" } catch {}
            try {
                if ($dev.DeviceItems) {
                    Walk-DeviceItems -Items $dev.DeviceItems -DevName $dName -Collected $Collected
                }
            } catch {}
        }
    }

    function Walk-DeviceGroups {
        param($Groups, [ref]$Collected)
        if (-not $Groups) { return }
        foreach ($grp in $Groups) {
            try {
                if ($grp.Devices) { Collect-Devices -Devices $grp.Devices -Collected $Collected }
            } catch {}
            try {
                if ($grp.Groups) { Walk-DeviceGroups -Groups $grp.Groups -Collected $Collected }
            } catch {}
        }
    }

    $foundPlcs = @()
    Collect-Devices -Devices $project.Devices -Collected ([ref]$foundPlcs)
    try {
        if ($project.UngroupedDevicesGroup -and $project.UngroupedDevicesGroup.Devices) {
            Collect-Devices -Devices $project.UngroupedDevicesGroup.Devices -Collected ([ref]$foundPlcs)
        }
    } catch {}
    try {
        if ($project.DeviceGroups) {
            Walk-DeviceGroups -Groups $project.DeviceGroups -Collected ([ref]$foundPlcs)
        }
    } catch {}

    function Export-UdtGroup {
        param($TypeGroup, [string]$OutBase, $RelList)
        if (-not $TypeGroup) { return }
        foreach ($tp in $TypeGroup.Types) {
            $fullName = $tp.GetType().FullName
            if ($fullName -notlike "*PlcStruct*") { continue }
            try {
                $script:ExportCounter++
                $safe = "{0:D4}_{1}.xml" -f $script:ExportCounter, (Sanitize-FileName $tp.Name)
                $xmlPath = Join-Path $OutBase $safe
                $tp.Export((New-Object System.IO.FileInfo($xmlPath)), [Siemens.Engineering.ExportOptions]::WithDefaults)
                $RelList.Add(@{
                    file = $xmlPath
                    name = "$($tp.Name)"
                })
            } catch {
                $warnings.Add("Không export được UDT '$($tp.Name)': $($_.Exception.Message)")
            }
        }
        foreach ($sub in $TypeGroup.Groups) {
            Export-UdtGroup -TypeGroup $sub -OutBase $OutBase -RelList $RelList
        }
    }

    function Export-TagTableGroup {
        param($TagGroup, [string[]]$FolderParts, [string]$OutBase, $OutList)
        if (-not $TagGroup) { return }
        foreach ($tt in $TagGroup.TagTables) {
            try {
                $script:ExportCounter++
                $safe = "{0:D4}_{1}.xml" -f $script:ExportCounter, (Sanitize-FileName $tt.Name)
                $xmlPath = Join-Path $OutBase $safe
                $tt.Export((New-Object System.IO.FileInfo($xmlPath)), [Siemens.Engineering.ExportOptions]::WithDefaults)
                $OutList.Add(@{
                    file = $xmlPath
                    name = "$($tt.Name)"
                    folder_parts = $FolderParts
                })
            } catch {
                $warnings.Add("Không export được Tag Table '$($tt.Name)': $($_.Exception.Message)")
            }
        }
        foreach ($sub in $TagGroup.Groups) {
            $nextFolders = @($FolderParts + @("$($sub.Name)"))
            Export-TagTableGroup -TagGroup $sub -FolderParts $nextFolders -OutBase $OutBase -OutList $OutList
        }
    }

    function Export-BlockGroup {
        param($BlkGroup, [string[]]$FolderParts, [string]$OutBase, $OutList)
        if (-not $BlkGroup) { return }
        foreach ($blk in $BlkGroup.Blocks) {
            $tName = $blk.GetType().FullName
            if ($tName -notlike "*GlobalDB*" -and $tName -notlike "*InstanceDB*") { continue }

            $isProtected = $false
            try { $isProtected = [bool]$blk.IsKnowHowProtected } catch {}
            if ($isProtected) {
                $warnings.Add("Bỏ qua '$($blk.Name)' (DB$($blk.Number)) vì đang bật Know-How Protection.")
                continue
            }

            try {
                $script:ExportCounter++
                $safe = "{0:D4}_{1}.xml" -f $script:ExportCounter, (Sanitize-FileName $blk.Name)
                $xmlPath = Join-Path $OutBase $safe
                $blk.Export((New-Object System.IO.FileInfo($xmlPath)), [Siemens.Engineering.ExportOptions]::WithDefaults)
                $OutList.Add(@{
                    file = $xmlPath
                    name = "$($blk.Name)"
                    number = [int]$blk.Number
                    kind = if ($tName -like "*InstanceDB*") { "InstanceDB" } else { "GlobalDB" }
                    memory_layout = "$($blk.MemoryLayout)"
                    folder_parts = $FolderParts
                })
            } catch {
                $warnings.Add("Không export được DB '$($blk.Name)': $($_.Exception.Message)")
            }
        }
        foreach ($sub in $BlkGroup.Groups) {
            $nextFolders = @($FolderParts + @("$($sub.Name)"))
            Export-BlockGroup -BlkGroup $sub -FolderParts $nextFolders -OutBase $OutBase -OutList $OutList
        }
    }

    $plcIdx = 0
    foreach ($entry in $foundPlcs) {
        $sw = $entry.software
        $plcKey = "$($entry.device_name)/$($entry.plc_name)"
        if (-not $seenDevices.Add($plcKey)) { continue }

        $plcDir = Join-Path $OutputDir ("plc_" + $plcIdx)
        $udtDir = Join-Path $plcDir "udts"
        $tagDir = Join-Path $plcDir "tags"
        $blkDir = Join-Path $plcDir "blocks"
        $null = New-Item -ItemType Directory -Path $udtDir, $tagDir, $blkDir -Force

        $udtFiles = New-Object System.Collections.Generic.List[object]
        $tagFiles = New-Object System.Collections.Generic.List[object]
        $blkFiles = New-Object System.Collections.Generic.List[object]

        if ($sw.TypeGroup) {
            Export-UdtGroup -TypeGroup $sw.TypeGroup -OutBase $udtDir -RelList $udtFiles
        }
        if ($sw.TagTableGroup) {
            Export-TagTableGroup -TagGroup $sw.TagTableGroup -FolderParts @() -OutBase $tagDir -OutList $tagFiles
        }
        if ($sw.BlockGroup) {
            Export-BlockGroup -BlkGroup $sw.BlockGroup -FolderParts @() -OutBase $blkDir -OutList $blkFiles
        }

        $plcResults.Add(@{
            plc_name = $entry.plc_name
            device_name = $entry.device_name
            udts = $udtFiles.ToArray()
            tag_tables = $tagFiles.ToArray()
            blocks = $blkFiles.ToArray()
        })
        $plcIdx++
    }

    $projVer = ""
    try { $projVer = "$($project.Version)" } catch {}

    $manifest = @{
        ok = $true
        project_name = "$($project.Name)"
        project_version = $projVer
        plcs = $plcResults.ToArray()
        warnings = $warnings.ToArray()
    }
    $manifest | ConvertTo-Json -Depth 12 | Out-File -FilePath (Join-Path $OutputDir "manifest.json") -Encoding utf8
    Emit-JsonResult $manifest
} catch {
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) {
        $msg += " | " + $_.Exception.InnerException.Message
    }
    $typeName = $_.Exception.GetType().FullName
    $errCode = "OPENNESS_ERROR"
    if ($typeName -match 'SecurityException' -or $msg -match 'Siemens TIA Openness|whitelist|EngineeringSecurityException|permission|privilege|denied') {
        $errCode = "OPENNESS_PERMISSION"
    }
    Emit-JsonResult @{
        ok = $false
        error_code = $errCode
        error = $msg
        warnings = $warnings.ToArray()
    }
} finally {
    if ($Mode -eq "open") {
        if ($null -ne $project) {
            try { $project.Close() } catch {}
        }
    }
    if ($null -ne $tia) {
        try { $tia.Dispose() } catch {}
    }
    if ($null -ne $attachedProc) {
        try { $attachedProc.Dispose() } catch {}
    }
}
