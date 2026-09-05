# Quick Bite Platform -- Database Architecture Specification (DATABASE_SPEC)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Data Architecture Team  

---

## 1. Dual-Database Architecture Overview

Quick Bite uses a hybrid database strategy designed to maximize performance, reliability, and free-tier efficiency:
1. **Primary Relational Store (Supabase PostgreSQL 15 + PostGIS):** Handles structured, relational entities requiring strict ACID consistency, financial immutability, relational foreign keys, and spatial geospatial queries (restaurants, addresses, orders, payments, payouts).
2. **Document Store (MongoDB Atlas M0):** Handles highly dynamic, hierarchical data structures requiring schema flexibility (multi-level menu categories, dish customization option trees, reviews, and audit logs).

---

## 2. PostgreSQL Relational Schema (Complete DDL)

```sql
-- Enable PostGIS & UUID extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'restaurant_owner', 'rider', 'super_admin')),
    is_gold BOOLEAN NOT NULL DEFAULT FALSE,
    gold_expires_at TIMESTAMP WITH TIME ZONE,
    preferred_language VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'kn')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: restaurants
CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(180) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address_line TEXT NOT NULL,
    city VARCHAR(50) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    coordinates GEOMETRY(Point, 4326) NOT NULL,
    fssai_license_number VARCHAR(14) NOT NULL,
    gstin VARCHAR(15),
    is_pure_veg BOOLEAN NOT NULL DEFAULT FALSE,
    packaging_fee DECIMAL(10, 2) NOT NULL DEFAULT 20.00,
    status VARCHAR(25) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
    rating_average DECIMAL(3, 2) NOT NULL DEFAULT 4.00,
    rating_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_restaurants_coords ON restaurants USING GIST (coordinates);
CREATE INDEX idx_restaurants_status ON restaurants (status);
CREATE INDEX idx_restaurants_owner ON restaurants (owner_id);

-- Table: addresses
CREATE TABLE addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(20) NOT NULL DEFAULT 'Home' CHECK (label IN ('Home', 'Work', 'Other')),
    address_line TEXT NOT NULL,
    landmark VARCHAR(100),
    coordinates GEOMETRY(Point, 4326) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_addresses_user ON addresses (user_id);
CREATE INDEX idx_addresses_coords ON addresses USING GIST (coordinates);

-- Table: orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key UUID UNIQUE NOT NULL,
    order_number VARCHAR(20) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES users(id),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    delivery_address_id UUID NOT NULL REFERENCES addresses(id),
    status VARCHAR(25) NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (status IN ('PAYMENT_PENDING', 'ORDER_PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('RAZORPAY_SANDBOX', 'CASH_ON_DELIVERY')),
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    items_total DECIMAL(10, 2) NOT NULL,
    gst_amount DECIMAL(10, 2) NOT NULL,
    packaging_fee DECIMAL(10, 2) NOT NULL,
    delivery_fee DECIMAL(10, 2) NOT NULL,
    platform_fee DECIMAL(10, 2) NOT NULL DEFAULT 5.00,
    coupon_discount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(10, 2) NOT NULL,
    restaurant_net_payout DECIMAL(10, 2) NOT NULL,
    preparation_minutes INTEGER,
    delivery_otp VARCHAR(4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_restaurant ON orders (restaurant_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_created ON orders (created_at DESC);

-- Table: order_items
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    mongo_dish_id VARCHAR(50) NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    customization_details JSONB,
    total_price DECIMAL(10, 2) NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

-- Table: restaurant_payouts
CREATE TABLE restaurant_payouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    settlement_period_start DATE NOT NULL,
    settlement_period_end DATE NOT NULL,
    gross_order_value DECIMAL(12, 2) NOT NULL,
    commission_deducted DECIMAL(12, 2) NOT NULL,
    tds_deducted DECIMAL(12, 2) NOT NULL,
    net_payable DECIMAL(12, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED')),
    bank_utr_number VARCHAR(50),
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_payouts_restaurant ON restaurant_payouts (restaurant_id);
```

---

## 3. MongoDB Document Schemas

### Menu Catalog Collection (`menus`)
```json
{
  "_id": "66da10f2b3e4a50012345678",
  "restaurantId": "d3b07384-d113-4632-9c1d-111111111111",
  "categories": [
    {
      "id": "cat_main_course",
      "name": "Main Course",
      "sortOrder": 1,
      "items": [
        {
          "id": "dish_pbm_01",
          "name": "Paneer Butter Masala",
          "description": "Cottage cheese simmered in a rich tomato, butter, and cashew gravy.",
          "price": 280.00,
          "isVeg": true,
          "isAvailable": true,
          "imageUrl": "https://assets.quickbite.app/dishes/pbm.webp",
          "optionGroups": [
            {
              "id": "grp_portion",
              "title": "Portion Size",
              "isRequired": true,
              "minSelections": 1,
              "maxSelections": 1,
              "options": [
                { "id": "opt_half", "name": "Half (Serves 1)", "priceDelta": 0.00 },
                { "id": "opt_full", "name": "Full (Serves 2-3)", "priceDelta": 120.00 }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```
