# Common Denial Reason Codes (CARC) and How to Fight Them

CARC = Claim Adjustment Reason Code. These appear on your 835 remittance files and tell you why a claim was denied or reduced.

## Top Denial Codes

### CO-16 — Claim/service lacks information
The most common fixable denial. The payer needs something you didn't send — NPI, diagnosis pointer, place of service. **Action**: review the RARC for specifics, correct, and resubmit. Usually winnable.

### CO-18 — Duplicate claim/service
The payer believes this was already processed. **Action**: check if the original was actually paid. If yes, write off. If no, appeal with proof the services were distinct (different dates, modifiers 59/XS/XP).

### CO-29 — Timely filing expired
The claim arrived after the payer's filing deadline. **Action**: only appealable with proof of timely submission (clearinghouse 999 acknowledgment). Without proof, this is a contractual write-off — you cannot bill the patient.

### CO-50 — Non-covered service
The payer's policy excludes this service. **Action**: check the patient's benefits before the visit (eligibility verification). For Medicare, check if a signed ABN is on file — if yes, the patient can be billed.

### CO-96 — Non-covered charges
Similar to CO-50 but applied at the charge level. **Action**: verify against the payer's medical policy. Appeal with medical necessity documentation if the service was appropriate.

### CO-97 — Included in another service (bundling)
The payer bundled this into a primary procedure. **Action**: check NCCI edits. If the services were truly separate and significant, appeal with modifier 25/59 documentation.

### CO-109 — Claim not covered by this payer
Wrong payer billed. **Action**: verify eligibility — the patient may have changed plans. Bill the correct payer.

### CO-197 — Precertification/authorization absent
No prior auth on file. **Action**: check if auth was obtained but not linked to the claim. If never obtained, some payers allow retro-auth within a window — call provider services immediately.

### CO-226 — Information requested from patient
The payer is waiting on the patient (accident details, other insurance info). **Action**: contact the patient promptly. These stall indefinitely without patient cooperation.

## RARC Codes (Remittance Advice Remark Codes)

RARC codes add detail to the CARC. Common ones:
- **N130** — consult your contracts (often paired with CO-96/97)
- **N386** — missing/incomplete/invalid documentation
- **MA120** — missing/incomplete/invalid CLIA certification number
- **M77** — missing/incomplete/invalid place of service

## Reading an 835 File

The 835 (Electronic Remittance Advice) is the payer's response to your 837 claim file. Key segments:
- **CLP** — claim-level payment info (claim ID, status, total charges, amount paid)
- **CAS** — adjustment details (group CO/PR/OA, reason code, amount)
- **NM1** — patient/provider identification
- **DTM** — dates (service, received, paid)

ClaimPaid RCM parses CAS segments automatically on 835 import and links denial reasons to your appeals.
