# Quick Bite Platform -- Non-Technical Presentation Guide (TEAMMATE_GUIDE)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Target Audience:** Non-Technical Founders, Team Members & Demo Presenters  

---

## 1. What Is Quick Bite?

**One-Sentence Pitch:**  
Quick Bite is a high-speed, transparent food delivery platform built for India that connects hungry diners with top local kitchens while eliminating unfair aggregator commissions and hidden fees.

---

## 2. The Problem We Solve (Real-World Analogy)

Imagine going to a local restaurant where a meal costs Rs 200. When you order through incumbent food apps, the restaurant owner is charged a 30% commission (Rs 60), leaving them with only Rs 140. To survive, the restaurant raises the menu price on the app to Rs 260. On top of that, the app charges you a Rs 35 delivery fee, Rs 25 packaging fee, and a Rs 5 platform fee. Your Rs 200 meal now costs Rs 325!

**Quick Bite changes this:** We operate with an ultra-efficient 15% partner commission and 100% transparent pricing—no inflated item markups, no surprise fees, and clear bill breakdowns.

---

## 3. How It Works

### The Simple Explanation (For Everyone)
1. **Diner Orders:** Rahul selects his favorite Butter Chicken on his phone and checks out in under 30 seconds.
2. **Kitchen Accepts:** The cloud kitchen tablet immediately chimes. The chef taps "Accept (20 Mins)".
3. **Food Prepared & Picked Up:** The food is packaged fresh. A nearby delivery partner picks it up.
4. **Delivered with OTP:** The rider arrives at Rahul's door. Rahul shares a 4-digit code to confirm delivery.

### The Technical Explanation (For Judges & Tech Leads)
Quick Bite is an event-driven modular monolith built with TypeScript, Node.js, and React Native. Client requests are authenticated via Supabase JWTs and rate-limited via Upstash Redis token buckets. Real-time updates flow over Socket.io WebSockets with heartbeat ping-pong intervals. Spatial searches are executed via PostGIS and typo-tolerant full-text searches resolve in under 50ms via Meilisearch.

---

## 4. Feature Comparison: Incumbent Apps vs Quick Bite

| Feature Area | Incumbent Food Delivery Apps | Quick Bite Platform |
|--------------|------------------------------|---------------------|
| **Restaurant Commission** | 22% - 33% per order | Flat 15% transparent fee |
| **Pricing Transparency** | Hidden packaging & surge markups | Itemized line-by-line cost breakdown |
| **Search Experience** | Sponsored ads crowd out local eateries | Pure relevance & distance-based results |
| **Language Inclusivity** | Primarily English with partial Hindi | Full English, Hindi, and Kannada support |
| **Infrastructure Cost** | Massive enterprise server overhead | Optimized to run 100% on free cloud tiers |

---

## 5. Demo Mode Strategy

If you are presenting Quick Bite to an investor, hackathon judge, or teammate:
- **No Credit Card Required:** Uses Razorpay Sandbox mode. You can type any test card or UPI VPA like `success@razorpay` and it instantly succeeds.
- **Instant Restaurant Generator:** Go to the Admin Portal, click "Generate Test Restaurant", and in 3 seconds a live restaurant with 15 menu dishes is ready to order from.
- **Works Offline / Mocked:** The system provides built-in demo fixtures so you never face embarrassing network demo failures.

---

## 6. Judge Q&A: 12 Anticipated Questions & Answers

1. **Q: How can you run a food delivery platform on free cloud tiers?**  
   *A:* By leveraging serverless and generous developer tiers: Supabase gives us 50,000 active users and 500MB SQL; Upstash gives 10,000 Redis commands/day; Cloudflare R2 has zero egress fees; Meilisearch handles 100,000 documents for free.
2. **Q: Why a modular monolith instead of microservices?**  
   *A:* Microservices introduce massive operational overhead, network latency, and deployment complexity. A modular monolith gives us strict domain boundaries with zero network latency between services.
3. **Q: How do you prevent double-charging on network dropouts?**  
   *A:* Every order request requires a client-generated UUID idempotency key stored in Redis. Duplicate requests with the same key are safely rejected.
4. **Q: How does the kitchen terminal handle lost connections?**  
   *A:* Socket.io automatically reconnects using exponential backoff. When reconnected, the terminal synchronizes its state with the database.
5. **Q: How do you handle FSSAI and regulatory compliance?**  
   *A:* All restaurants must provide a 14-digit FSSAI license and GSTIN during onboarding. Admin review and approval is mandatory before any restaurant goes live.
6. **Q: What is the benefit of using both PostgreSQL and MongoDB?**  
   *A:* PostgreSQL handles transactional consistency, user accounts, and spatial PostGIS coordinates. MongoDB handles deeply nested, variable food menus and addon customization trees.
7. **Q: How do you handle high concurrency during flash lunch hours?**  
   *A:* Upstash Redis caches popular restaurant menus and active orders, absorbing 90% of read traffic away from the primary database.
8. **Q: How do you support regional languages?**  
   *A:* We use `react-i18next` with dedicated locale dictionaries for English, Hindi, and Kannada, enabling instant runtime language switching.
9. **Q: What happens if a customer cancels an order?**  
   *A:* Cancellations are permitted within 60 seconds if the kitchen has not begun cooking. Once status is PREPARING, cancellations require admin review.
10. **Q: Why use Expo for the mobile app?**  
    *A:* Expo SDK 52 allows single-codebase development for both Android and iOS with native performance, simplified OTA updates, and rapid testing.
11. **Q: How do you protect user privacy?**  
    *A:* We strictly adhere to India's DPDP Act 2023. User data is encrypted, access is logged, and users can request data export or deletion.
12. **Q: What is your path to monetization post-funding?**  
    *A:* Our unit economics rely on a 15% restaurant commission, Rs 5 customer platform fee, Quick Bite Gold memberships, and dining-out reservations.

---

## 7. 3-Minute Pitch Script

- **[0:00 - 0:25] The Hook:**  
  "Every single day in India, millions of people order food online. But behind that convenience lies a broken system: restaurant owners lose over 30% of every sale to platform commissions, and diners are hit with confusing surge fees and hidden markups. We built Quick Bite to fix that."
- **[0:25 - 0:55] The Solution:**  
  "Quick Bite is a multi-portal food delivery ecosystem engineered for speed, transparency, and regional accessibility. We provide a lightning-fast mobile app for diners, an intuitive live audio terminal for kitchen operators, and a unified admin control tower."
- **[0:55 - 1:40] Live Product Walkthrough:**  
  "Watch this: Rahul opens Quick Bite, switches to Kannada, filters for pure vegetarian food, and searches 'Paneer Butter Masala'. Thanks to Meilisearch, results appear in under 50 milliseconds. He adds extra naan, selects his address, and pays using UPI. Instantly, the restaurant terminal chimes. The chef taps 'Accept - 20 Mins', and Rahul's phone updates in real time over WebSockets."
- **[1:40 - 2:20] Architecture & Efficiency:**  
  "Under the hood, Quick Bite is architected with extreme efficiency. Using a modular TypeScript monolith, PostGIS spatial queries, and Cloudflare edge routing, our entire platform currently operates on 100% free-tier cloud infrastructure while supporting up to 50,000 monthly active users."
- **[2:20 - 3:00] The Vision & Close:**  
  "Quick Bite proves that you don't need millions in venture capital to build a production-grade, multi-portal delivery platform. With transparent 15% commissions and genuine multi-language support, we are making food delivery fair and fast for everyone. Thank you."
