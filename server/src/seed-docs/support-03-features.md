# ClaimPaid Features Guide

## Claims and scrubbing

Enter claims manually or import them with the CSV template (Claims → Import). Every claim runs through a **15-rule claim scrubber** before it reaches your worklist. The Smart Worklist prioritizes claims by follow-up urgency.

## Denials and appeals

The denial pipeline tracks denied claims end to end. ClaimPaid drafts appeal letters for you to review, send, and follow up on. The Payer Playbook and Daily Briefing summarize what needs attention.

## Timely filing

ClaimPaid tracks timely-filing deadlines per payer: Aetna 120 days, Cigna 180 days, UHC 90 days, Anthem 180 days, Medicare 365 days, NY Medicaid 90 days, Humana 180 days. At-risk claims are flagged before deadlines pass.

## AI-assisted coding

The coding assistant suggests CPT and ICD-10 codes from clinical notes using a 370-code library. It is **human-in-the-loop**: unverified codes are hard-blocked and a person must confirm the final code before it is used. Suggestions are never applied automatically.

## Eligibility (270/271)

Real-time eligibility checks are available in Settings → Eligibility. ClaimPaid supports a demo mode to try the workflow plus custom REST vendors. Checks only go live once **your own vendor account credentials** are connected on your end.

## 837P transmission

ClaimPaid generates real 837P files (005010X222A1) with a built-in structural validator and 999/277CA acknowledgment handling. Send via manual download, SFTP, or a REST adapter to your clearinghouse from Claims → Transmission.

## EHR integration

ClaimPaid connects to **athenahealth** via OAuth2: go to Settings → EHR and follow the steps (about two minutes), and visit data flows in automatically. **Epic is not supported** — we would rather say so plainly than waste your time.

## Team, roles, and access

Invite teammates from Team settings. Roles are owner, biller, and viewer. Seat counts are limited by your plan (Starter 3, Pro 15, AI Only 5, Enterprise unlimited).

## API and settings

Developer API keys can be generated in Settings → API (shown once, revocable). Settings also covers organization details, notifications, and customization. Google sign-in is available on the login page.
