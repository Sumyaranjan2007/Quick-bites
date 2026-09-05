# Quick Bite Platform -- Data Handling & Classification (DATA_HANDLING)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Information Security Team  

---

## 1. Data Classification Matrix

| Classification Tier | Data Types & Fields | Storage Location | Encryption at Rest | Encryption in Transit | Access Controls |
|---------------------|---------------------|------------------|--------------------|-----------------------|-----------------|
| **Tier 1: Public** | Restaurant names, addresses, menu items, dish descriptions, public reviews, star ratings | PostgreSQL / MongoDB / Meilisearch | Standard filesystem encryption | TLS 1.3 | Public Anonymous Access |
| **Tier 2: Internal** | Aggregate sales volume, anonymized order metrics, system performance logs | Redis / PostgreSQL | Standard filesystem encryption | TLS 1.3 | Authenticated Internal Roles |
| **Tier 3: Confidential** | Customer full names, phone numbers, delivery addresses, order history, GPS coordinates | PostgreSQL / Redis | AES-256 DB column encryption | TLS 1.3 | Authenticated Owner + Assigned Rider |
| **Tier 4: Restricted** | Merchant bank account numbers, IFSC codes, PAN details, FSSAI certificates, auth secret keys | PostgreSQL / Cloudflare R2 | AES-256 envelope encryption | TLS 1.3 | Super Admin RBAC + Audit Trail |

---

## 2. Key Management & Secrets Rotation

- All production API keys (Supabase Service Key, Razorpay Secret, Cloudflare R2 Secret, Resend Key) are stored exclusively in secure environment variables.
- Git repositories are protected by pre-commit scanning hooks (`gitleaks`) to prevent accidental credential commits.
- Cryptographic keys are scheduled for rotation every one hundred and eighty (180) days.

---

## 3. Incident & Data Breach Response Protocol

In the event of a suspected or confirmed personal data breach:
1. **Detection & Containment (Hour 0 - 2):** Immediately isolate affected server instances, revoke compromised access tokens, and activate backup connection pools.
2. **Assessment & Triage (Hour 2 - 6):** Determine the scope of compromised records, classification tier of leaked data, and root vulnerability.
3. **Regulatory Notification (Hour 6 - 24):** In compliance with CERT-In directions and the DPDP Act 2023, notify the Indian Computer Emergency Response Team (CERT-In) within six (6) hours of incident confirmation.
4. **User Communication (Hour 24 - 48):** Dispatch transparent email notifications to impacted users specifying: (a) Nature of the breach, (b) Data categories involved, (c) Remedial steps taken, and (d) Recommended user actions (e.g. session resets).
