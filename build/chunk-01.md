# Chunk 01: Project Scaffolding & Monorepo Configuration

**Goal:** Initialize the root Turborepo monorepo structure, pin dependencies, configure shared TypeScript configs, linting rules, `.env.example`, and Docker Compose.  
**Estimated Time:** 45 minutes  
**Dependencies:** Chunk 00  
**Unlocks:** Chunk 02 (Core Backend) & Chunk 06 (Frontend Shell)  

---

## 1. Files to Create in this Chunk

### `package.json` (Root Monorepo)
```json
{
  "name": "quick-bites-monorepo",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "diagnostics": "node scripts/diagnostics.js"
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.6.2",
    "prettier": "^3.3.3",
    "eslint": "^9.10.0"
  },
  "packageManager": "npm@10.8.2"
}
```

### `turbo.json`
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "typecheck": {},
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

### `.env.example`
```ini
# Environment Mode
NODE_ENV=development
PORT=5000
DEMO_MODE=true

# Supabase Credentials (Free Tier)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Upstash Redis (Free Tier)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token

# MongoDB Atlas (Free Tier)
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/quickbites?retryWrites=true&w=majority

# Meilisearch Cloud (Free Tier)
MEILISEARCH_HOST=https://your-search.meilisearch.io
MEILISEARCH_API_KEY=your-meilisearch-key

# Cloudflare R2 Bucket (Zero Egress)
R2_ACCOUNT_ID=your-r2-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=quickbites-assets
R2_PUBLIC_URL=https://assets.quickbite.app

# Razorpay Sandbox (Free Simulated Payments)
RAZORPAY_KEY_ID=rzp_test_samplekey123
RAZORPAY_KEY_SECRET=sample_secret_key_456
RAZORPAY_WEBHOOK_SECRET=sample_webhook_secret_789

# Resend Email (Free Tier: 3,000 emails/mo)
RESEND_API_KEY=re_sample_key_123

# Firebase Cloud Messaging
FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json
```

### `.gitignore`
```gitignore
node_modules/
dist/
build/
.turbo/
.cache/
.env
.env.local
*.log
.DS_Store
coverage/
```

---

## 2. Verification Commands

```bash
# Verify monorepo package manifests
node -e "const pkg = require('./package.json'); console.log('Workspaces:', pkg.workspaces);"
```

---

## 3. Rollback Instructions
Delete `package.json`, `turbo.json`, `.env.example`, `.gitignore`.
