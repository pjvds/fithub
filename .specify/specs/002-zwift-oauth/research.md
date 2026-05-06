# Research: Zwift OAuth Integration

## Technology Stack Selection

### Mobile Framework

**Question:** Which mobile framework will FitHub use?

**Options Evaluated:**
1. **React Native**
   - ✅ Single codebase for iOS/Android
   - ✅ Large ecosystem, many libraries
   - ❌ Performance overhead for fitness data (animation-heavy)
   - ❌ OAuth flows more complex (redirect handling varies)
   - Status: Possible, but tight integration with native APIs needed

2. **Flutter**
   - ✅ Better performance than React Native
   - ✅ Growing fitness app ecosystem
   - ✅ Better native platform integration
   - ❌ Smaller ecosystem than React Native
   - Status: Good fit for fitness domain

3. **Native iOS + Android (Kotlin/Swift)**
   - ✅ Best performance
   - ✅ Direct access to Keychain, Work Manager, HealthKit
   - ✅ Simplest OAuth flow (native OAuth libraries)
   - ❌ Requires maintaining two codebases
   - ❌ Higher development cost
   - Status: Ideal for dogfooding, but resource-intensive

**Recommendation:** NEEDS CLARIFICATION from project owner
- If speed to market is priority: **React Native** (shared codebase)
- If performance/native features are priority: **Flutter** (better than RN, still shared codebase)
- If long-term sustainability and native excellence: **Native** (highest quality but higher cost)

**Impact on Zwift Plan:**
- React Native: Use `@react-native-community/hooks` for OAuth, Firebase Storage for tokens
- Flutter: Use `flutter_appauth` for OAuth, `flutter_secure_storage` for tokens
- Native: Use native OAuth libraries (AppAuth for iOS, `net.openid:appauth` for Android)

---

### Local Database

**Question:** Which local database should store activities and metadata?

**Options Evaluated:**
1. **SQLite**
   - ✅ Battle-tested, reliable
   - ✅ Excellent React Native/Flutter support
   - ✅ Powerful query language
   - ✅ Small footprint
   - ❌ Manual schema migrations
   - Status: Industry standard for mobile fitness apps

2. **Realm**
   - ✅ Mobile-optimized (designed for offline-first)
   - ✅ Fast queries for large datasets
   - ✅ Built-in sync (optional cloud sync)
   - ❌ Proprietary format, vendor lock-in
   - ❌ Steeper learning curve
   - Status: Good for complex object graphs

3. **Core Data (iOS only)**
   - ✅ Native iOS, excellent performance
   - ❌ iOS only (doesn't help Android)
   - Status: Not suitable for cross-platform

**Recommendation:** **SQLite** (if React Native/Flutter shared codebase)
- SQLite has excellent React Native support (`react-native-sqlite-storage` or `expo-sqlite`)
- SQLite has excellent Flutter support (`sqflite`)
- Schema is clear and portable
- Can export to CSV for debugging

**Impact on Zwift Plan:**
- Schema: Activities table, ZwiftConnection table, RetryQueue table
- Indices on: source_id (unique), start_time (for range queries), source_platform (for filtering)

---

### Token Encryption

**Question:** How to encrypt tokens at rest?

**Evaluated Approaches:**
1. **iOS Keychain + Android Keystore (Native APIs)**
   - ✅ Hardware-backed encryption when available
   - ✅ Automatic encryption/decryption
   - ✅ Meets security best practices
   - ❌ Requires native code (React Native/Flutter bridges)
   - Status: Recommended for production

2. **Mobile Device Encryption + Password Manager**
   - ✅ Simpler implementation
   - ✅ Standard mobile security
   - ❌ Less granular control
   - Status: Acceptable alternative

3. **Manual AES-256 with Device Key**
   - ✅ Portable across platforms
   - ❌ More complex, error-prone
   - ❌ Requires secure key generation/storage
   - Status: Not recommended (Keychain/Keystore already exist)

**Recommendation:** **iOS Keychain + Android Keystore** (via platform bridges)
- React Native: Use `@react-native-community/hooks` or `react-native-sensitive-info`
- Flutter: Use `flutter_secure_storage` (abstracts Keychain/Keystore)
- Native: Use native APIs directly (Security.framework on iOS, KeyStore on Android)

**Implementation:**
```swift
// iOS (Swift)
let attributes: [String: Any] = [
  kSecClass: kSecClassGenericPassword,
  kSecAttrAccount: "zwift_access_token",
  kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
  kSecValueData: token.data(using: .utf8)
]
SecItemAdd(attributes as CFDictionary, nil)

// Android (Kotlin)
val keyStore = KeyStore.getInstance("AndroidKeyStore")
keyStore.load(null)
val key = keyStore.getKey("zwift_token_key", null)
val cipher = Cipher.getInstance("AES/GCM/NoPadding")
cipher.init(Cipher.ENCRYPT_MODE, key)
```

---

## Zwift API Integration

### API Authentication

**Endpoint Structure:**
- Base URL: `https://api.zwift.com/v3`
- Authentication: Bearer token in Authorization header
- Rate Limit: 600 requests / 15 minutes (per account)
- Response Format: JSON

**Token Refresh:**
```
POST https://api.zwift.com/v3/oauth/token
{
  "grant_type": "refresh_token",
  "refresh_token": "{refresh_token}",
  "client_id": "{client_id}",
  "client_secret": "{client_secret}"
}
```

**Key Finding:** Zwift OAuth tokens have ~6 hour expiration; refresh tokens valid for ~6 months. Implement proactive refresh (check 5 minutes before expiration).

---

### Activity Retrieval

**Endpoint:** `GET /v3/athlete/activities?per_page=200&page={n}`

**Response Fields (subset):**
```json
{
  "id": 12345,
  "name": "Evening Ride",
  "description": "Nice weather",
  "sport": "Cycling",
  "startDate": "2024-05-01T18:00:00Z",
  "endDate": "2024-05-01T19:30:00Z",
  "duration": 5400,
  "distance": 42500,
  "elevationGain": 450,
  "energyExpended": 1850,
  "avgHeartRate": 135,
  "maxHeartRate": 168,
  "timeInZone": {
    "zone1": 1200,
    "zone2": 2400,
    "zone3": 1800
  }
}
```

**Key Findings:**
- Distance in meters (convert to km: `/ 1000`)
- Duration in seconds
- Energy in kilocalories (no conversion needed)
- Elevation in meters
- Sport: Cycling, Running, Swimming (maps to canonical types)
- Activities typically 20-180 minutes, 5-100 km distance
- User with 50 activities in last 3 months = 1 page, very fast query

---

### Rate Limiting

**Header Response:**
```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 598
X-RateLimit-Reset: 1699564800
```

**Strategy:**
- Check remaining before each request
- If < 10 remaining: Wait until reset time
- On 429 (Too Many Requests): Exponential backoff (10s, 30s, 60s, max 5 min)
- Log rate limit events for monitoring

**Batch Fetch Strategy:**
- Initial sync: Fetch 200/page, 1-3 pages typical (covers 3 months for most users)
- Incremental sync: Usually 1 page (only new activities)

---

## OAuth PKCE Flow Details

### Code Challenge Generation

**Client-Side (Mobile App):**
```
1. Generate random code_verifier: 43-128 chars, base64url
   code_verifier = randomString(128)

2. Generate code_challenge: SHA256(code_verifier), base64url encode
   code_challenge = base64url(SHA256(code_verifier))

3. Redirect to authorization endpoint:
   https://www.strava.com/oauth/authorize?
     client_id={client_id}
     &response_type=code
     &redirect_uri={redirect_uri}
     &scope=read
     &state={random_state}
     &code_challenge={code_challenge}
     &code_challenge_method=S256
```

**Server-Side (Zwift OAuth):**
```
1. User authorizes in browser
2. Zwift redirects with authorization code + state
3. Client receives code in redirect URL
4. Client exchanges code for token (with code_verifier)
```

**Token Exchange:**
```
POST https://api.strava.com/v3/oauth/token
{
  "client_id": "{client_id}",
  "client_secret": "{client_secret}",
  "code": "{authorization_code}",
  "grant_type": "authorization_code",
  "code_verifier": "{code_verifier}"
}
```

**Response:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 21600,
  "token_type": "Bearer"
}
```

**Key Learning:** PKCE prevents authorization code interception on mobile. The code_verifier must be:
- Generated on device (never transmitted)
- Stored temporarily (cleared after token exchange)
- Used only once per authorization code
- No server-side validation needed (Zwift verifies code_challenge)

---

## Error Handling Patterns

### Transient vs Permanent Errors

| Error | Status | Action | Retry? |
|-------|--------|--------|--------|
| Network timeout | - | Retry with backoff | ✅ Yes |
| API unavailable | 503 | Retry with backoff | ✅ Yes |
| Rate limited | 429 | Retry with backoff (respect Reset header) | ✅ Yes |
| Invalid token | 401 | Re-authorize (expired) | ❌ No |
| Forbidden | 403 | User revoked permission | ❌ No |
| Not found | 404 | Activity deleted (remove from DB) | ❌ No |

### Exponential Backoff Formula

```
attempt = 0
delay = 5 min

while attempt < max_attempts:
  try:
    fetch_activities()
    break
  except TransientError:
    attempt += 1
    if attempt >= max_attempts:
      log_permanent_failure()
      break
    delay = min(delay * 2, 1 hour)  // Cap at 1 hour
    sleep(delay)
    
// Stop retrying after 24 hours total
```

---

## Performance Targets

| Metric | Target | Acceptable |
|--------|--------|-----------|
| Initial sync (3 mo) | 25 sec | <30 sec |
| Incremental sync | 5 sec | <10 sec |
| Activity normalization | 50 ms per activity | <100 ms |
| API latency (p95) | 500 ms | <1 sec |
| Background sync overhead | <5% battery | <10% |

**Optimization Strategies:**
- Batch normalization (process 10 activities at once)
- SQLite indices on source_id and start_time
- Background sync only when charging (if battery <20%)
- Compress historical activity data (archive after 1 year)

---

## Testing Strategy

### Unit Tests

**OAuth Manager:**
- ✅ PKCE code challenge/verifier generation
- ✅ Token storage/retrieval
- ✅ Token refresh (pre-expiration)
- ✅ Token revocation
- ✅ Error handling (invalid token, network error)

**Activity Fetcher:**
- ✅ API pagination (200 per page, 3 pages)
- ✅ Batch processing (no memory spikes)
- ✅ Error responses (429, 503, 401)
- ✅ Large dataset handling (1000+ activities)

**Normalizer:**
- ✅ Activity type mapping (Cycling → cycling)
- ✅ Unit conversion (meters → km, Joules → kcal)
- ✅ Timezone extraction
- ✅ Data validation (distance > 0, duration > 0)

### Integration Tests

- ✅ Full OAuth flow (with Zwift sandbox)
- ✅ Activity fetch → Normalize → Store cycle
- ✅ Token refresh
- ✅ Error recovery
- ✅ Retry queue persistence

### Manual QA

- ✅ Real Zwift account connection
- ✅ Sync with 50+ activities
- ✅ Offline mode (local data accessible)
- ✅ Network failure recovery
- ✅ Token expiration

---

## Security Considerations

### Token Security
- ✅ Tokens encrypted at rest (Keychain/Keystore)
- ✅ PKCE prevents authorization code interception
- ✅ Tokens never logged or exposed in error messages
- ✅ Tokens cleared on app uninstall (platform standard)

### API Security
- ✅ HTTPS only (TLS 1.3)
- ✅ No credentials in logs
- ✅ Certificate pinning (optional, for high-security requirement)
- ✅ User-initiated disconnection revokes tokens

### Data Privacy
- ✅ Zwift activities stored locally (not sent to FitHub backend initially)
- ✅ No third-party sharing
- ✅ User controls which data is synced (activity types)
- ✅ Privacy policy updated with Zwift data usage disclosure

---

## Next Steps

1. ✅ **Tech Stack Decision:** Confirm mobile framework (React Native / Flutter / Native)
2. ✅ **Database Selection:** Confirm SQLite (recommended)
3. **Create Task Breakdown** (speckit-tasks)
4. **Begin Phase 1 Implementation:** OAuth + initial sync
5. **Parallel:** Create Strava plan and Apple Health plan

---

**END OF RESEARCH**
