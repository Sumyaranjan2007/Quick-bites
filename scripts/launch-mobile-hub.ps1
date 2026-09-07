# Quick Bite - Launch Mobile Testing & Download Hub
# Starts the HTTP file server on port 8080 to serve the Release APK and testing portal

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "     QUICK BITE MOBILE DOWNLOAD & TESTING HUB       " -ForegroundColor Yellow
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting Hub server on Port 8080..." -ForegroundColor Green
node scripts/serve-download-hub.js
