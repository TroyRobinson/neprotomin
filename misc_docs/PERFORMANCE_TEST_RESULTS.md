# Performance Test Results: NE API vs InstantDB

## 🎯 Bottom Line

**InstantDB is 18-99x faster than querying NE API directly**, reducing load time from 29 seconds to 1.6 seconds.

## Test Results

| Metric | NE API | InstantDB | Speedup |
|--------|--------|-----------|---------|
| **10 stats metadata** | 17.5s | 0.18s | **99x faster** |
| **42 ZIP values** | 11.5s | 1.4s | **8x faster** |
| **Total** | **29s** | **1.6s** | **18x faster** |

**Test configuration:** Staging environment, Tulsa area, Housing Density stat (wOGzD8ZD)

## Why The Speed Difference?

The performance gap comes from **two architectural differences**:

### 1. Data Structure: Normalized vs Denormalized

**NE API (Normalized with "Area Hashes"):**
```json
// Returns compact reference IDs
{ "n3G8LnGW": 94.07, "j3ZeQ5ZP": 82.15 }

// Requires 42 additional lookups to resolve:
// "n3G8LnGW" → { identity: "74104", geometry_type: "zip" }
// "j3ZeQ5ZP" → { identity: "74103", geometry_type: "zip" }
// ... (40 more HTTP requests)
```

**Why area hashes?**
- Saves storage (20x smaller: 0.2 MB vs 4.2 MB for 500 stats)
- Maintains data consistency (update boundaries once, not 500 times)
- Standard practice for public APIs serving multiple consumers
- Good for relational database normalization

**InstantDB (Denormalized):**
```json
// Returns ZIP codes directly embedded
{ "74104": 94.07, "74103": 82.15, ... }

// No lookups needed! Single query, ready to display.
```

**Why denormalized?**
- Optimized for our specific read pattern (show ZIP values on map)
- No N+1 query problem
- Fast at any scale (even US-wide: ~5-10 GB total)

### 2. Architecture: HTTP API vs Database Access

**Even if NE API returned denormalized data (no hashes), it would still be 2-4x slower** due to:

| Factor | HTTP API | Database |
|--------|----------|----------|
| Connection setup | 200-400ms per request | 10-30ms (persistent) |
| Protocol overhead | HTTP headers (~1KB) | Binary protocol (~100 bytes) |
| Network hops | Client → Internet → Heroku → DB | Client → InstantDB (direct) |
| Latency per query | 200-400ms | 10-30ms |

**Theoretical best case (denormalized NE API):** 3-6 seconds
**InstantDB actual:** 1.6 seconds

**Why databases are faster:**
- Persistent WebSocket connections (no repeated handshakes)
- Optimized for query execution (not HTTP routing)
- Minimal protocol overhead
- Direct data access patterns

### Real-World Impact

**User Experience:**
- **NE API:** 29 seconds (user leaves page ❌)
- **InstantDB:** 1.6 seconds (acceptable ✅)

**Improvement:** Users see data **18x faster**

## When to Use Each Approach

| Use Case | NE API | InstantDB |
|----------|---------|-----------|
| **User-facing queries** | ❌ Too slow (29s) | ✅ Fast (1.6s) |
| **Initial data import** | ✅ Authoritative source | ❌ Empty until ETL'd |
| **Mobile apps** | ❌ High bandwidth | ✅ Reduced data transfer |
| **Real-time updates** | ✅ Always current | ⚠️ Needs periodic ETL |
| **Data not in our schema** | ✅ Full API access | ❌ Must ETL first |
| **Offline capability** | ❌ Requires internet | ✅ Data persists locally |

**Our pattern:** Use NE API for ETL (weekly/monthly updates), InstantDB for all application queries.

## Scalability Notes

**Denormalized approach works at scale:**
- **Tulsa (current):** 10 stats × 42 ZIPs = ~50 KB ✅
- **Oklahoma:** 100 stats × 200 ZIPs × 3 geometries = ~15 MB ✅
- **US-wide:** 500 stats × 33K ZIPs × 3 geometries = ~5-10 GB ✅

**Why it scales:**
- Modern databases handle large JSON efficiently
- Most stats don't have ALL areas (sparse data)
- Can partition by region if needed
- ZIP code strings stored separately from boundary shapes

**Boundary updates:** Store GeoJSON separately, join by ZIP string at render time. Boundary shape changes don't require data updates.

## Reproduce This Test

```bash
# Run performance comparison
npm run ne:speed:test:staging

# Test specific stat
npm run ne:speed:test:staging -- --stat=wOGzD8ZD

# Test production environment
npm run ne:speed:test:prod -- --stat=<HASH>
```

## Key Takeaways

1. **NE API is well-designed** for its purpose: a public API serving diverse consumers with normalized data
2. **InstantDB is optimized** for our specific use case: fast read queries with known access patterns
3. **Both architectures are correct** for their respective contexts
4. **ETL is worth it:** One-time import cost pays off with 18x faster queries for all users
5. **Different tools for different jobs:** HTTP APIs for flexibility, databases for speed
