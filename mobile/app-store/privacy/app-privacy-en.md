# App Privacy & Age Rating declarations (App Store Connect) / English

Suggested answers for App Store Connect "App Privacy" (privacy nutrition labels) and
"Age Rating".

> **Important: the iOS build integrates Unity Ads and shows ads (rewarded video + banner).**
> Unlike the Android first release (declared "no ads"), iOS must declare **contains ads**
> and the corresponding data collection / tracking correctly.
> (Evidence: `SKAdNetworkItems` in `mobile/ios/.../Info.plist`; frontend
> `lib/nativeRewardedAd.ts` / `lib/nativeBannerAd.ts`; `isNativeApp()` branches in Map.tsx.)

---

## 0. Context (how the app is built)

- A Capacitor wrapper that displays the production site (https://chizunurie.unitygamebox.com) in a WebView.
- The site uses **Google Sign-In (optional), GPS (Visit paint), Google Analytics**.
- The native layer shows **Unity Ads (rewarded video / banner)**.
- Playable as a guest; if the user never signs in, no email/name is collected.

---

## 1. App Privacy (data types collected)

App Store Connect asks: data type → purpose → linked to user? → used for tracking?

| Data type | Collected | Purpose | Linked to user | Tracking | Notes |
|---|---|---|---|---|---|
| **Precise location** | Yes | App functionality | Yes (when signed in) | No | Visit paint; permission-gated |
| **Email address** | Yes | App functionality / Account | Yes | No | Only on Google Sign-In |
| **Name (display name)** | Yes | App functionality / Account | Yes | No | Only on Google Sign-In |
| **User ID** | Yes | App functionality / Analytics | Yes | No | Account identity |
| **Usage data (interactions, progress)** | Yes | App functionality / Analytics | Yes | No | Painting, points, levels |
| **Diagnostics (crash, performance, logs)** | Yes | Analytics / Fraud prevention | Maybe | No | Action audit logs |
| **Device ID / identifiers** | Yes | Analytics / **Third-party ads** | Maybe | **Maybe** | GA, Unity Ads |
| **Advertising data (ad interactions)** | Yes | **Third-party ads** | Maybe | **Maybe** | Unity Ads |
| **Coarse location (from ads)** | Maybe | Third-party ads | No | Maybe | If Unity infers from IP |

> **On Tracking (App Tracking Transparency)**
> - In **SKAdNetwork-only mode**, Unity Ads does not use the IDFA and no ATT prompt is
>   required; you can then declare Tracking = **No** (recommended; smoother review).
> - If you enable IDFA (personalized ads), add `NSUserTrackingUsageDescription` to
>   `Info.plist`, present the ATT prompt, and declare "Used for tracking" = **Yes**.
>   **`NSUserTrackingUsageDescription` is currently absent**, so if you do not show ATT
>   (no IDFA), no change is needed.
> - Keep the declaration consistent with Unity Dashboard "Data Privacy" (COPPA / consent).

### Third-party SDKs / sharing
- **Unity Ads (Unity Technologies)**: ad delivery; may handle device identifiers,
  ad interactions, and coarse location.
- **Google Analytics (Google)**: usage and identifiers (analytics).
- **Google Sign-In (Google)**: authentication (email, name).

### Security
- Encryption in transit (HTTPS): **Yes**.
- Data deletion: **Yes** — in-app `/delete-account` calls `authClient.deleteUser()`;
  also accepted by email. Declare the in-app account-deletion path.

---

## 2. Age Rating questionnaire

- Violence / sexual content / mature themes / gambling: **all "None"**
- **Ads**: Yes (shows third-party ads) → answer the relevant item correctly
- User-generated content / unrestricted web: no open chat/social. WebView is the
  first-party site (only limited OAuth navigation is allowed).
- Expected rating: **4+** (showing ads does not by itself raise the age band; answer
  the questionnaire accurately).

---

## 3. Target audience / Kids Category

- **Do not enroll in the Kids Category** (location, third-party ads, analytics).
- Primarily intended for ages 13+. Not directed at children.

---

## 4. Location usage (App Review notes; matches Info.plist)

- `NSLocationWhenInUseUsageDescription`: uses your location to paint the places you walk.
- `NSLocationAlwaysAndWhenInUseUsageDescription`: uses background location to keep
  painting walked places with the screen off (`UIBackgroundModes=location`).
- **Background location rationale**: while GPS tracking, keep painting ~125m sub-cells
  in the background / with the screen off (`@capgo/background-geolocation`). State this
  in the review notes.
- The app is fully playable without location (manual drag / neighbor painting).

---

## 5. Fill in before submitting

| Item | Status / action |
|---|---|
| Operator name / Copyright | `[operator name]` (match listing/*) |
| Privacy policy URL | https://chizunurie.unitygamebox.com/privacy (confirm it is live) |
| Unity Ads tracking policy | Decide SKAdNetwork-only vs IDFA(ATT); match declaration & Info.plist |
| ATT string | If using IDFA, add `NSUserTrackingUsageDescription` |
| Data deletion | Declare in-app `/delete-account` for the account-deletion requirement |
