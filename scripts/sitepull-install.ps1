#requires -Version 5.1

<#
.SYNOPSIS
Downloads, verifies, and launches the Sitepull Windows x64 installer.

.PARAMETER Version
Installs a specific release such as 0.4.1 or v0.4.1. Omit it for the latest stable release.

.PARAMETER DryRun
Prints the release selection and installation method without network access or filesystem changes.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string] $Version,

    [Parameter()]
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repository = 'isaiahneal/sitepull'
$InstallerAssetName = 'SitepullSetup.exe'
$ChecksumAssetName = 'SHA256SUMS.txt'
$ApiHeaders = @{
    Accept                 = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'           = 'Sitepull-Windows-Installer'
}

function Resolve-RequestedTag {
    param([AllowNull()][string] $RequestedVersion)

    if ([string]::IsNullOrWhiteSpace($RequestedVersion)) {
        return $null
    }

    $normalized = $RequestedVersion.Trim()
    if ($normalized.StartsWith('v', [System.StringComparison]::OrdinalIgnoreCase)) {
        $normalized = $normalized.Substring(1)
    }
    if ($normalized -notmatch '^\d+\.\d+\.\d+$') {
        throw "Invalid -Version '$RequestedVersion'. Use a release version such as 0.4.1 or v0.4.1."
    }
    return "v$normalized"
}

function Test-WindowsHost {
    if ($env:OS -eq 'Windows_NT') {
        return $true
    }
    try {
        return [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
            [System.Runtime.InteropServices.OSPlatform]::Windows
        )
    }
    catch {
        return $false
    }
}

function Get-NativeArchitecture {
    try {
        return [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    }
    catch {
        $architecture = if ([string]::IsNullOrWhiteSpace($env:PROCESSOR_ARCHITEW6432)) {
            $env:PROCESSOR_ARCHITECTURE
        }
        else {
            $env:PROCESSOR_ARCHITEW6432
        }
        if ($architecture -eq 'AMD64') {
            return 'X64'
        }
        return [string] $architecture
    }
}

function Assert-SupportedHost {
    if (-not (Test-WindowsHost)) {
        throw 'SitepullSetup.exe can only be installed on Windows.'
    }

    $architecture = Get-NativeArchitecture
    if ($architecture -ne 'X64') {
        throw "SitepullSetup.exe requires Windows x64; detected '$architecture'."
    }
}

function Get-GitHubRelease {
    param([AllowNull()][string] $RequestedTag)

    $releaseUri = if ($null -eq $RequestedTag) {
        "https://api.github.com/repos/$Repository/releases/latest"
    }
    else {
        $encodedTag = [System.Uri]::EscapeDataString($RequestedTag)
        "https://api.github.com/repos/$Repository/releases/tags/$encodedTag"
    }

    try {
        $release = Invoke-RestMethod -Uri $releaseUri -Headers $ApiHeaders -Method Get
    }
    catch {
        $selection = if ($null -eq $RequestedTag) { 'the latest release' } else { $RequestedTag }
        throw "Could not resolve $selection from GitHub: $($_.Exception.Message)"
    }

    $resolvedTag = [string] $release.tag_name
    if ($resolvedTag -notmatch '^v\d+\.\d+\.\d+$') {
        throw "GitHub returned an invalid Sitepull release tag: '$resolvedTag'."
    }
    if ($null -ne $RequestedTag -and $resolvedTag -cne $RequestedTag) {
        throw "GitHub resolved '$RequestedTag' as unexpected tag '$resolvedTag'."
    }
    if ([bool] $release.draft) {
        throw "GitHub release '$resolvedTag' is still a draft."
    }

    return $release
}

function Get-RequiredReleaseAsset {
    param(
        [Parameter(Mandatory)] $Release,
        [Parameter(Mandatory)][string] $AssetName
    )

    $matches = @($Release.assets | Where-Object { [string] $_.name -ceq $AssetName })
    if ($matches.Count -ne 1) {
        throw "Release '$($Release.tag_name)' must contain exactly one '$AssetName' asset; found $($matches.Count)."
    }

    $asset = $matches[0]
    $downloadUri = [System.Uri] ([string] $asset.browser_download_url)
    $expectedPath = "/$Repository/releases/download/$($Release.tag_name)/$AssetName"
    if (
        -not $downloadUri.IsAbsoluteUri -or
        $downloadUri.Scheme -cne 'https' -or
        $downloadUri.Host -cne 'github.com' -or
        $downloadUri.AbsolutePath -cne $expectedPath
    ) {
        throw "Release '$($Release.tag_name)' returned an unexpected download URL for '$AssetName'."
    }

    return $asset
}

function Save-ReleaseAsset {
    param(
        [Parameter(Mandatory)] $Asset,
        [Parameter(Mandatory)][string] $Destination
    )

    try {
        $null = Invoke-WebRequest `
            -Uri ([string] $Asset.browser_download_url) `
            -Headers $ApiHeaders `
            -Method Get `
            -OutFile $Destination `
            -UseBasicParsing
    }
    catch {
        throw "Could not download '$($Asset.name)': $($_.Exception.Message)"
    }

    $download = Get-Item -LiteralPath $Destination
    if ($download.Length -le 0) {
        throw "Downloaded asset '$($Asset.name)' is empty."
    }
}

function Get-ExpectedInstallerHash {
    param(
        [Parameter(Mandatory)][string] $ChecksumPath,
        [Parameter(Mandatory)][string] $AssetName
    )

    $matchingHashes = @()
    foreach ($line in Get-Content -LiteralPath $ChecksumPath) {
        $entry = [System.Text.RegularExpressions.Regex]::Match(
            $line,
            '^(?<Hash>[0-9a-fA-F]{64})\s+\*?(?<Name>.+)$'
        )
        if (-not $entry.Success) {
            continue
        }

        $entryName = $entry.Groups['Name'].Value.Trim()
        if ($entryName.StartsWith('./', [System.StringComparison]::Ordinal)) {
            $entryName = $entryName.Substring(2)
        }
        if ($entryName -ceq $AssetName) {
            $matchingHashes += $entry.Groups['Hash'].Value.ToLowerInvariant()
        }
    }

    if ($matchingHashes.Count -ne 1) {
        $message = (
            "'$ChecksumAssetName' must contain exactly one SHA-256 entry for " +
            "'$AssetName'; found $($matchingHashes.Count)."
        )
        throw $message
    }
    return [string] $matchingHashes[0]
}

function Install-Sitepull {
    $requestedTag = Resolve-RequestedTag $Version

    if ($DryRun) {
        $selectedVersion = if ($null -eq $requestedTag) {
            'latest stable release (resolved during installation)'
        }
        else {
            $requestedTag
        }
        Write-Output 'Sitepull Windows x64 installer dry run'
        Write-Output "Version: $selectedVersion"
        Write-Output "Asset: $InstallerAssetName"
        Write-Output "Checksum: $ChecksumAssetName (SHA-256, exact-name match, fail closed)"
        Write-Output 'Method: GitHub Releases API -> verified download -> Start-Process -Wait'
        return
    }

    Assert-SupportedHost

    # Windows PowerShell 5.1 may otherwise negotiate a protocol GitHub rejects.
    [System.Net.ServicePointManager]::SecurityProtocol = (
        [System.Net.ServicePointManager]::SecurityProtocol -bor
        [System.Net.SecurityProtocolType]::Tls12
    )

    $release = Get-GitHubRelease $requestedTag
    $resolvedTag = [string] $release.tag_name
    $installerAsset = Get-RequiredReleaseAsset $release $InstallerAssetName
    $checksumAsset = Get-RequiredReleaseAsset $release $ChecksumAssetName

    Write-Output "Resolved Sitepull $resolvedTag for Windows x64."

    $temporaryDirectory = Join-Path `
        ([System.IO.Path]::GetTempPath()) `
        "sitepull-install-$([System.Guid]::NewGuid().ToString('N'))"
    $installerPath = Join-Path $temporaryDirectory $InstallerAssetName
    $checksumPath = Join-Path $temporaryDirectory $ChecksumAssetName

    try {
        New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
        Write-Output "Downloading $InstallerAssetName and $ChecksumAssetName..."
        Save-ReleaseAsset $installerAsset $installerPath
        Save-ReleaseAsset $checksumAsset $checksumPath

        $expectedHash = Get-ExpectedInstallerHash $checksumPath $InstallerAssetName
        $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if (-not [string]::Equals($actualHash, $expectedHash, [System.StringComparison]::Ordinal)) {
            throw "SHA-256 verification failed for '$InstallerAssetName'. Expected $expectedHash; received $actualHash."
        }

        Write-Output "Verified SHA-256: $actualHash"
        Write-Output 'Launching Sitepull installer and waiting for completion...'
        $installerProcess = Start-Process -FilePath $installerPath -PassThru -Wait
        if ($installerProcess.ExitCode -ne 0) {
            throw "Sitepull installer exited with code $($installerProcess.ExitCode)."
        }
        Write-Output "Sitepull $resolvedTag installation completed."
    }
    finally {
        if (Test-Path -LiteralPath $temporaryDirectory) {
            Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

try {
    Install-Sitepull
}
catch {
    Write-Error "Sitepull installation failed: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
}
