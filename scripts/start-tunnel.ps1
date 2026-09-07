# Quick Bite - Production Public Tunnel Launcher
# Exposes the local Backend API (Port 5000) to the public internet via Cloudflare Tunnel
# Works across any mobile carrier (4G/5G/Wi-Fi) globally for all 4 mobile apps.

$port = if ($env:PORT) { $env:PORT } else { "5000" }

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "     QUICK BITE CLOUD PRODUCTION TUNNEL LAUNCHER    " -ForegroundColor Yellow
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Target: http://127.0.0.1:$port (Backend API & WebSockets)" -ForegroundColor Green
Write-Host "Establishing secure public HTTPS/WSS tunnel on port $port..." -ForegroundColor Yellow

# Try running cloudflared tunnel
try {
    Write-Host "Starting Cloudflare Quick Tunnel..." -ForegroundColor Green
    npx -y untun@latest tunnel "http://localhost:$port"
} catch {
    Write-Host "Falling back to localtunnel..." -ForegroundColor Yellow
    npx -y localtunnel --port $port
}
