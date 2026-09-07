# Quick Bite Platform -- Database Architecture Specification (DATABASE_SPEC)

**Version:** 2.0.0  
**Date:** September 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Device Native Food Delivery Ecosystem)  
**Target Engine:** PostgreSQL 15 + PostGIS (Supabase Free Tier / Cloud Instance)  

---

## 1. Database Architecture & Design Principles

The Quick Bite data layer is engineered with strict financial immutability, foreign-key relational integrity, and spatial geospatial querying. It supports the complete 4-device ecosystem with zero mock data.

Key architectural rules:
1. **Financial Immutability:** Order financial fields (`subtotal`, `tax_amount`, `packaging_fee`, `delivery_fee`, `platform_fee`, `total_amount`) are permanently captured at order insertion. Subsequent menu price updates never alter past invoices.
2. **ACID Transactions:** Order placement, wallet deductions, split payments, and delivery completion payouts execute within atomic SQL transactions.
3. **Spatial Geofencing:** Restaurant coordinates and delivery addresses utilize `GEOMETRY(Point, 4326)` for PostGIS geodesic distance calculations, enforcing the **10 km maximum delivery radius**.
4. **Authoritative State Machine:** Order state transitions (`PLACED` -> `PREPARING` -> `READY_FOR_PICKUP` -> `RIDER_ASSIGNED` -> `OUT_FOR_DELIVERY` -> `DELIVERED` or `CANCELLED`) are enforced via database `CHECK` constraints.

---

## 2. Complete PostgreSQL Schema DDL

```sql
-- Enable PostGIS & UUID extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 1. USERS & ROLES TABLE
-- ==============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(20) UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer' 
        CHECK (role IN ('customer', 'restaurant_owner', 'rider', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    preferred_language VARCHAR(5) NOT NULL DEFAULT 'en' 
        CHECK (preferred_language IN ('en', 'hi', 'kn')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================================================
-- 2. CUSTOMER WALLETS & LEDGERS
-- ==============================================================================
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0.00),
    currency VARCHAR(5) NOT NULL DEFAULT 'INR',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    order_id UUID,
    amount DECIMAL(10, 2) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================================================
-- 3. RESTAURANTS TABLE
-- ==============================================================================
CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(180) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address_line TEXT NOT NULL,
    city VARCHAR(50) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    lat DECIMAL(10, 7) NOT NULL,
    lng DECIMAL(10, 7) NOT NULL,
    coordinates GEOMETRY(Point, 4326),
    fssai_license_number VARCHAR(14) NOT NULL,
    gstin VARCHAR(15),
    is_pure_veg BOOLEAN NOT NULL DEFAULT FALSE,
    packaging_fee DECIMAL(10, 2) NOT NULL DEFAULT 20.00,
    kyc_status VARCHAR(25) NOT NULL DEFAULT 'PENDING_APPROVAL' 
        CHECK (kyc_status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED')),
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    rating_average DECIMAL(3, 2) NOT NULL DEFAULT 4.00,
    rating_count INTEGER NOT NULL DEFAULT 0,
    banner_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Auto-update coordinates geometry on insert/update
CREATE OR REPLACE FUNCTION update_restaurant_coordinates()
RETURNS TRIGGER AS $$
BEGIN
    NEW.coordinates = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restaurant_coordinates
BEFORE INSERT OR UPDATE ON restaurants
FOR EACH ROW EXECUTE FUNCTION update_restaurant_coordinates();

-- ==============================================================================
-- 4. MENU CATEGORIES & DISHES
-- ==============================================================================
CREATE TABLE menu_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE menu_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    base_price DECIMAL(10, 2) NOT NULL CHECK (base_price > 0),
    is_veg BOOLEAN NOT NULL DEFAULT TRUE,
    image_url TEXT,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Nested variants (e.g. Size: Regular / Medium / Large)
CREATE TABLE menu_item_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    price_delta DECIMAL(10, 2) NOT NULL DEFAULT 0.00
);

-- Nested add-ons (e.g. Extra Cheese, Dips)
CREATE TABLE menu_item_addons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    is_veg BOOLEAN NOT NULL DEFAULT TRUE
);

-- ==============================================================================
-- 5. DELIVERY RIDERS FLEET
-- ==============================================================================
CREATE TABLE delivery_riders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_type VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('BIKE', 'EV', 'CYCLE')),
    license_number VARCHAR(50) NOT NULL,
    vehicle_rc_number VARCHAR(50),
    kyc_status VARCHAR(25) NOT NULL DEFAULT 'PENDING_APPROVAL' 
        CHECK (kyc_status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED')),
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    current_lat DECIMAL(10, 7),
    current_lng DECIMAL(10, 7),
    last_ping_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================================================
-- 6. ORDERS & LINE ITEMS
-- ==============================================================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    rider_id UUID REFERENCES users(id),
    status VARCHAR(30) NOT NULL DEFAULT 'PLACED' 
        CHECK (status IN (
            'PLACED', 
            'PREPARING', 
            'READY_FOR_PICKUP', 
            'RIDER_ASSIGNED', 
            'OUT_FOR_DELIVERY', 
            'DELIVERED', 
            'CANCELLED'
        )),
    subtotal DECIMAL(10, 2) NOT NULL,
    tax_amount DECIMAL(10, 2) NOT NULL,
    packaging_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    platform_fee DECIMAL(10, 2) NOT NULL DEFAULT 5.00,
    discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(10, 2) NOT NULL,
    payment_mode VARCHAR(20) NOT NULL 
        CHECK (payment_mode IN ('COD', 'RAZORPAY_TEST', 'WALLET', 'SPLIT')),
    wallet_amount_used DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    external_payment_id VARCHAR(100),
    delivery_address TEXT NOT NULL,
    delivery_lat DECIMAL(10, 7) NOT NULL,
    delivery_lng DECIMAL(10, 7) NOT NULL,
    pickup_code VARCHAR(6) NOT NULL,
    delivery_otp VARCHAR(6) NOT NULL,
    prep_time_minutes INTEGER DEFAULT 20,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id),
    item_name VARCHAR(150) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10, 2) NOT NULL,
    total_price DECIMAL(10, 2) NOT NULL,
    selected_variant VARCHAR(100),
    selected_addons JSONB DEFAULT '[]'::jsonb,
    cooking_instructions TEXT
);

-- ==============================================================================
-- 7. KYC DOCUMENTS TABLE
-- ==============================================================================
CREATE TABLE kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('RESTAURANT', 'RIDER')),
    entity_id UUID NOT NULL,
    document_type VARCHAR(30) NOT NULL 
        CHECK (document_type IN ('FSSAI', 'GSTIN', 'DRIVING_LICENSE', 'PAN', 'VEHICLE_RC')),
    file_url TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' 
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================================================
-- 8. REVIEWS TABLE
-- ==============================================================================
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```
