# Troubleshooting Guide

## Uploads are slow or stuck
1. Check your connection at fast.com — uploads need at least 5 Mbps for large files.
2. Files over 1 GB upload faster in the desktop app than in the browser.
3. If an upload stalls at 99%, it is usually your antivirus scanning the file — pause real-time scanning for the Northwind folder or add an exclusion.
4. Browser uploads are limited to 2 GB per file; use the desktop app for larger files.

## Sync conflicts
When the same file is edited on two devices offline, Northwind keeps both versions and names the second one "conflicted copy". Open both, merge your changes, and delete the extra copy. Admins can see conflict history for 30 days.

## I forgot my password
Click "Forgot password" on the login page. Reset links expire after 1 hour and can only be used once. If you use Google SSO, reset your Google password instead — Northwind cannot reset SSO passwords.

## Shared links not working
Links expire if the owner set an expiry date. "Anyone with the link" links break if the file is moved to a different workspace. Password-protected links require the password on every access — there is no "remember me" for link passwords.

## Desktop app won't start (Windows)
Run the installer as administrator, then restart. If the tray icon is missing, check Task Manager for Northwind.exe and end the task before relaunching. Still stuck? Delete %APPDATA%/Northwind/Cache — your files are safe in the cloud.
