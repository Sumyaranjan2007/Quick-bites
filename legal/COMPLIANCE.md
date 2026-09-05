# Quick Bite Platform -- Regulatory Compliance Manifesto (COMPLIANCE)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Regulatory Context:** Republic of India Food Safety, Taxation & Digital Commerce  

---

## 1. Food Safety & Standards Authority of India (FSSAI) Compliance

Under the Food Safety and Standards (Licensing and Registration of Food Businesses) Regulations, food delivery e-commerce aggregators must ensure:
1. **Mandatory License Display:** Every restaurant partner listing on Quick Bite must display their verified 14-digit FSSAI license number and hygiene rating badge directly on the restaurant detail page.
2. **Zero Unregistered Onboarding:** The onboarding pipeline strictly blocks restaurant activation until an administrative reviewer validates the authenticity of the uploaded FSSAI registration certificate.
3. **Quarterly Audit Cycle:** The platform automatically flags licenses approaching expiration (30 days prior) and suspends merchant listings whose licenses have lapsed.

---

## 2. Goods and Services Tax (GST) Architecture

Compliant with Section 9(5) of the Central Goods and Services Tax (CGST) Act, 2017:
1. **Restaurant Food Supplies:** E-commerce operators are liable to pay GST on restaurant services supplied through their platforms. Quick Bite computes and collects 5% GST (without Input Tax Credit) on all prepared food sales and remits it directly to the government.
2. **Platform & Delivery Fees:** Platform convenience fees (Rs 5.00) and delivery charges are taxed at the standard service GST rate of 18% (9% CGST + 9% SGST).
3. **TDS Deductions:** In accordance with Section 51 of the CGST Act, 1% Tax Deducted at Source (TDS) is deducted from net restaurant payouts and deposited under the merchant's GSTIN.

---

## 3. Consumer Protection (E-Commerce) Rules, 2020

Quick Bite complies fully with the Ministry of Consumer Affairs guidelines:
1. **No Dark Patterns:** No pre-ticked checkboxes for optional tips, insurance, or donations. All optional add-ons require explicit consumer opt-in.
2. **Transparent Fee Breakdown:** No hidden fees added at the final payment step. The cart screen displays the identical total as the payment checkout modal.
3. **Grievance Redressal Mechanism:** A dedicated in-app dispute reporting tool with a maximum ticket acknowledgment window of 48 hours and resolution window of 14 days.

---

## 4. Telecom Regulatory Authority of India (TRAI) DLT Standards

For transactional SMS and OTP delivery across Indian telecom operators (Jio, Airtel, Vi):
1. **Distributed Ledger Technology (DLT) Registration:** Quick Bite entity registered on the national DLT portal with verified Principal Entity (PE) ID.
2. **Template Whitelisting:** All transactional OTP and order update SMS templates pre-registered and approved:
   - Template: *"Your Quick Bite verification code is {#var#}. Valid for 5 minutes. Do not share this code with anyone."*
3. **Sender ID:** 6-character registered alphanumeric sender header: `QKBITE`.
