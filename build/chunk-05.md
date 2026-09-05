# Chunk 05: Search & Catalog Indexing Engine (Meilisearch)

**Goal:** Configure Meilisearch Cloud client, build automated catalog synchronization scripts, and implement typo-tolerant search APIs with sub-50ms response times.  
**Estimated Time:** 45 minutes  
**Dependencies:** Chunk 03  
**Unlocks:** Chunk 07 (Discovery Feed)  

---

## 1. Indexing Configuration
- **Index Name:** `restaurants` & `dishes`
- **Searchable Attributes:** `name`, `cuisineTags`, `description`
- **Filterable Attributes:** `isVeg`, `rating`, `city`, `isAvailable`
- **Ranking Rules:** `["words", "typo", "proximity", "attribute", "sort", "exactness"]`

---

## 2. Verification Commands

```bash
# Test search index synchronization
npm --prefix apps/backend-api run search:sync
```

---

## 3. Rollback Instructions
Purge Meilisearch indexes and revert search module in backend.
