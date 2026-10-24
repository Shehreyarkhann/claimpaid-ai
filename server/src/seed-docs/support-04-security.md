# ClaimPaid Security and Compliance

## How your data is protected

- **Encryption in transit:** all traffic uses TLS.
- **Encrypted backups:** every database backup is encrypted with age (X25519) the moment it is written, then decrypt-verified before the plaintext is deleted. A stolen backup file is useless without the key.
- **Access control:** role-based access (owner, biller, viewer). Optional per-user MFA, plus an org-wide MFA enforcement toggle in Settings → Security.
- **Login protection:** rate limiting on login attempts and a 15-minute account lockout after 5 failed logins. Passwords require at least 8 characters with uppercase, lowercase, digit, and symbol.
- **Audit logging:** sensitive actions — plan changes, data deletes, MFA resets, support actions — are written to a tamper-evident audit log.

## AI and privacy

ClaimPaid AI runs on ClaimPaid's own server using a local model. **Your notes and claims are never sent to a third-party AI API.**

## BAA

A Business Associate Agreement is available for every practice and can be reviewed and e-signed electronically inside the app (required before checkout).

## HIPAA

There is no such thing as HIPAA certification — no government body certifies products as "HIPAA compliant." ClaimPaid does not make that claim. What it does offer is the BAA, the safeguards listed above, and local-first AI processing.
