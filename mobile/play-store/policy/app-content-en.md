# App content (Play Console "App content" answers) / English

Draft answers for "Policy and programs → App content" in Play Console.
**The app is a WebView wrapper of the production site (chizunurie.gamebox777.org)**.
The site's Google Analytics, Google Sign-In and GPS apply, but the **initial release
shows no ads in the app** (the rewarded-ad button is hidden via `isNativeApp()`, there
is no banner unit, and the ad script gpt.js is never loaded in the app).

---

## 1. Privacy policy

- URL: the hosted URL of `privacy-policy/` (e.g. https://chizunurie.gamebox777.org/privacy)

---

## 2. Ads

- **Does your app contain ads? → No**
  - The initial release shows no ads in the app.
  - The rewarded video ad button is hidden in the native app (`!isNativeApp()`).
    The ad SDK (GPT `gpt.js`) is lazy-loaded only on button tap, so it never loads
    in the app. No banner ad (AdSense `<ins>`) is placed either.
  - Note: the **browser (web) version does have ads**, but Play's ads declaration is
    about the *app*. If ads are later added to the app, update this to "Yes".

---

## 3. Data safety

> The "Data collected/shared" form. Based on the site's behavior inside the WebView.
> Adjust to your actual SDK config (GA/AdSense on/off, IP anonymization, etc.).

### Data types collected / shared

| Data type | Collected | Shared | Purpose | Optional/Required |
|---|---|---|---|---|
| **Location (approx./precise)** | Yes | No | App functionality (Visit paint) | Optional (permission) |
| **Personal info: Email** | Yes (Google sign-in) | No | Account management | Optional (guest OK) |
| **Personal info: Name** | Yes (Google display name) | No | Account management | Optional |
| **App activity: In-app actions** | Yes | No | Functionality, analytics | Required |
| **App activity: Other (game progress)** | Yes | No | Functionality | Required |
| **App info & performance: Diagnostics/logs** | Yes | No | Analytics, fraud prevention | Required |
| **Device or other IDs (cookies)** | Yes | No | Analytics (Google Analytics) | Required |

> No ads, so no advertising-ID collection/sharing. GA still loads in the app, so
> declare it as collection for "Analytics" (drop this row if you disable GA too).

### Sharing recipients / purposes
- **Analytics**: Google Analytics. Usage, identifiers (no sharing for ad purposes).

### Security questions
- **Encrypted in transit (HTTPS): Yes** (production is https).
- **Provides a way to request data deletion: Yes** (via contact email; ideally also
  provide a Play "data deletion request URL").
- Part of Families program: No (see "Target audience").

---

## 4. Content rating (IARC questionnaire)

- App type: **Game**
- Violence / sexual content / controlled substances / gambling: **all "None"**
- User interaction / UGC: only display names appear in rankings; no free chat/social features.
- Location sharing: no feature to directly share live location between users (painted tiles are aggregated).
- Expected result: likely **all ages / everyone**. Answer the questionnaire accurately.

---

## 5. Target audience and content

- **Target age group**: 13+ recommended (includes location, analytics; no in-app ads).
  - **Not** primarily child-directed. Do not join the Families program.
- Declare the app is not intentionally targeting children.

---

## 6. Data safety notes (operational)

- Guests can play, so email/name are not collected from users who don't sign in.
- Access counting uses a hash of the IP; raw IPs are not retained long-term (`site_visits.visitor`).
- Location is read only during "Visit paint". No continuous background tracking.

---

## 7. Other declarations

- **News app**: No
- **COVID-19 / public health app**: No
- **Government app**: No
- **Financial products**: None
- **Export/encryption self-classification**: standard HTTPS only; confirm the applicable category.
