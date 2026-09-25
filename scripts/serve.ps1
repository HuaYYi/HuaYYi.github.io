# ============================================================
# serve.ps1 - Zero-dependency local preview server (PowerShell)
# Used as fallback when Node.js is not installed.
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

# Resolve project root (parent of scripts/ directory)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDir '..')).Path
$port = 4321

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.webp' = 'image/webp'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.ttf'  = 'font/ttf'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Self-Static-Blog Local Preview Server" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Root: $root"
Write-Host ""
Write-Host "  Frontend : http://localhost:$port/" -ForegroundColor Green
Write-Host "  Admin    : http://localhost:$port/admin/" -ForegroundColor Green
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        try {
            $urlPath = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
            if ([string]::IsNullOrEmpty($urlPath)) { $urlPath = 'index.html' }

            $filePath = [IO.Path]::GetFullPath((Join-Path $root $urlPath))

            # Prevent directory traversal
            if (-not $filePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
                $ctx.Response.StatusCode = 403
                $bytes = [Text.Encoding]::UTF8.GetBytes('403 Forbidden')
                $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $ctx.Response.Close()
                continue
            }

            if (Test-Path $filePath -PathType Container) {
                $filePath = Join-Path $filePath 'index.html'
            }

            if (Test-Path $filePath -PathType Leaf) {
                $ext = [IO.Path]::GetExtension($filePath).ToLower()
                $ctx.Response.ContentType = $mime[$ext]
                if (-not $ctx.Response.ContentType) { $ctx.Response.ContentType = 'application/octet-stream' }
                $bytes = [IO.File]::ReadAllBytes($filePath)
                $ctx.Response.ContentLength64 = $bytes.Length
                $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $ctx.Response.StatusCode = 404
                $msg = "404 Not Found: $urlPath"
                $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
                $ctx.Response.ContentType = 'text/plain; charset=utf-8'
                $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            $ctx.Response.Close()
        } catch {
            try {
                $ctx.Response.StatusCode = 500
                $bytes = [Text.Encoding]::UTF8.GetBytes("500 " + $_.Exception.Message)
                $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $ctx.Response.Close()
            } catch {}
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Host ""
    Write-Host "Server stopped." -ForegroundColor Yellow
}
