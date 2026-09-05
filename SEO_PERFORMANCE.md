# Quick Bite Platform -- SEO & Web Performance Specification (SEO_PERFORMANCE)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Performance & Growth Engineering Team  

---

## 1. Core Web Vitals Targets

For web-based interfaces (Restaurant Partner Portal, Admin Dashboard, and Public Restaurant Discovery landing pages):

| Web Vital Metric | Target Ceiling | Optimization Strategy |
|------------------|----------------|-----------------------|
| **Largest Contentful Paint (LCP)** | < 2.2 seconds | Preload hero banner images; CDN edge caching via Cloudflare; server-side rendering for public restaurant profiles. |
| **First Input Delay (FID)** | < 80 milliseconds | Minimal main-thread JavaScript execution; code-splitting with dynamic `React.lazy()`. |
| **Cumulative Layout Shift (CLS)** | < 0.05 | Explicit `width` and `height` on all dish images; skeleton loaders matching exact rendered dimensions. |
| **Time to First Byte (TTFB)** | < 200 milliseconds | Cloudflare edge caching of static HTML and asset chunks. |

---

## 2. Performance Budgets

- **Total Initial JavaScript Bundle:** < 180 KB (gzipped).
- **Total Initial CSS:** < 35 KB (gzipped) using CSS custom properties.
- **Image Size Limit:** All dish images compressed via WebP format; maximum 120 KB per image.
- **Font Assets:** Inter and JetBrains Mono subsetted to Latin, Devanagari, and Kannada glyphs only; total font payload < 65 KB.

---

## 3. SEO Meta Tags & Open Graph Schema

Every public restaurant profile page renders the following dynamic metadata:

```html
<!-- Dynamic SEO Meta Tags -->
<title>Bangalore Biryani House | Order Online | Quick Bite</title>
<meta name="description" content="Order authentic Dum Biryani, Kebabs, and Mughlai curries from Bangalore Biryani House on Quick Bite. Fast 30-min delivery, live tracking, and zero hidden fees.">
<meta name="keywords" content="biryani, food delivery, Bangalore Biryani House, Quick Bite, online food">
<link rel="canonical" href="https://quickbite.app/restaurant/bangalore-biryani-house">

<!-- Open Graph Social Tags -->
<meta property="og:type" content="restaurant.restaurant">
<meta property="og:title" content="Bangalore Biryani House - 4.8 Rating on Quick Bite">
<meta property="og:description" content="Delicious food delivered fast with real-time tracking. Order now on Quick Bite.">
<meta property="og:image" content="https://assets.quickbite.app/restaurants/bbh-banner.webp">
<meta property="og:url" content="https://quickbite.app/restaurant/bangalore-biryani-house">
<meta property="og:site_name" content="Quick Bite">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Bangalore Biryani House on Quick Bite">
<meta name="twitter:description" content="Order fresh, hot food with live tracking and transparent bills.">
<meta name="twitter:image" content="https://assets.quickbite.app/restaurants/bbh-banner.webp">
```

---

## 4. Structured Data (JSON-LD Schema)

Public restaurant pages inject schema.org structured data to enable rich Google Search snippets:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "Bangalore Biryani House",
  "image": "https://assets.quickbite.app/restaurants/bbh-banner.webp",
  "servesCuisine": ["Biryani", "North Indian", "Mughlai"],
  "priceRange": "$$",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "100 Feet Road, Indiranagar",
    "addressLocality": "Bengaluru",
    "postalCode": "560038",
    "addressCountry": "IN"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 12.9716,
    "longitude": 77.6412
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "reviewCount": "412"
  },
  "potentialAction": {
    "@type": "OrderAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "https://quickbite.app/restaurant/bangalore-biryani-house",
      "actionPlatform": [
        "http://schema.org/DesktopWebPlatform",
        "http://schema.org/IOSPlatform",
        "http://schema.org/AndroidPlatform"
      ]
    },
    "deliveryMethod": "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
  }
}
</script>
```
