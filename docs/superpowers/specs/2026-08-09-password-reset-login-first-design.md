# Password Reset and Login-First Authentication Design

Date: 2026-08-09  
Status: Approved design, awaiting implementation plan

## Objective

Make login the primary entry for unauthenticated users and add a complete, secure email-based password-reset flow. New registrations require a unique email address. Existing users remain valid with a nullable email, but cannot request self-service recovery until an operator adds an email directly to their account record.

## User experience

### Login-first entry

- Every unauthenticated landing-page call to action leads to `/login`, not `/signup`.
- The login form keeps `Tạo tài khoản` as the secondary path.
- `Quên mật khẩu?` appears on its own line directly below `Tạo tài khoản`.
- Protected routes continue redirecting anonymous users to `/login?returnTo=...`.
- Authenticated users visiting login, signup, forgot-password, or reset-password routes are redirected to `/dashboard`.

### Registration

- `/signup` adds a required `Email` field with `type="email"` and `autocomplete="email"`.
- Email is trimmed and normalized to lowercase before storage.
- Username remains the login identifier; email is used only for password recovery.
- New registrations require a unique email. Existing database users receive `email = null` during migration and keep working normally.
- Successful registration retains the existing behavior: establish a session and open `/dashboard`.

### Forgot password

- `/forgot-password` contains one email field and a `Gửi liên kết đặt lại` action.
- Submission always produces the same success message: if an eligible account exists, reset instructions have been sent. The response must not disclose whether an email is registered, disabled, or missing.
- The success state links back to `/login` and permits a later resend.
- SMTP or backend failures do not expose account existence. The server logs a bounded operational error without logging the email, raw token, reset URL, password, or SMTP credentials.

### Reset password

- The email link opens `/reset-password?token=<opaque-token>`.
- The page requires a new password and password confirmation, using the existing 8–100 character rule.
- Missing, malformed, expired, already-used, or unknown tokens produce the same persistent Vietnamese error and a link to request another reset.
- A successful reset clears any frontend session cookie, shows confirmation, and provides a primary `Đăng nhập` link.

## Security architecture

### Reset token

- Generate 32 cryptographically random bytes and encode them as base64url.
- Send the raw token only in the email URL.
- Store only `SHA-256(rawToken)` as a lowercase hex digest.
- Tokens expire 30 minutes after issuance and can be consumed once.
- Issuing a new token invalidates all prior unused reset tokens for that user.
- Reset-token comparison uses the fixed-length digest, never a raw-token database lookup.

### Enumeration and abuse controls

- `POST /api/auth/forgot-password` always returns HTTP 202 with the same response body for valid, unknown, disabled, or legacy accounts without email.
- Add a dedicated IP limit of 5 forgot-password requests per 15 minutes.
- Enforce a 60-second per-account resend cooldown without changing the public response.
- Existing global request limits remain in place.
- Reset requests have a dedicated IP limit of 10 attempts per 15 minutes.
- Email content contains no password and no account metadata beyond the recovery instructions.

### Atomic password update

- Validate the token and hash the new password before entering the database transaction.
- In one transaction, atomically claim the unexpired unused token, update the password hash, increment the user's session version, and invalidate every reset token for that user.
- Concurrent attempts using the same token yield one success and one generic invalid-token response.

### Session revocation

- Add `sessionVersion Int @default(0)` to `User`.
- New JWTs carry `sessionVersion`.
- Session verification compares the claim with the current database value, alongside the existing disabled-account and username checks.
- For rollout compatibility, a legacy JWT without the claim is interpreted as version `0`. It remains valid for an unchanged account and becomes invalid after that account resets its password.
- Password reset increments `sessionVersion`, immediately invalidating all older JWTs for that user.

## Data model

Add nullable email and session version to `User`:

```prisma
model User {
  email          String? @unique
  sessionVersion Int     @default(0)
  resetTokens    PasswordResetToken[]
}
```

Add the reset-token model:

```prisma
model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, createdAt])
  @@index([expiresAt])
}
```

The migration is additive. It does not backfill an invented email address and does not make the database column non-null, preserving existing users.

## Backend interfaces

### Registration

`POST /api/auth/register`

```json
{
  "username": "string",
  "email": "user@example.gov.vn",
  "password": "string"
}
```

The response keeps the current user/session shape and does not return email. Duplicate username and duplicate email return localized conflict errors at the frontend proxy boundary.

### Request reset

`POST /api/auth/forgot-password`

```json
{ "email": "user@example.gov.vn" }
```

Response for every syntactically valid email:

```json
{
  "success": true,
  "message": "Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi."
}
```

Malformed requests return validation errors without a database lookup.

### Complete reset

`POST /api/auth/reset-password`

```json
{
  "token": "opaque base64url token",
  "password": "new password",
  "passwordConfirmation": "new password"
}
```

Success returns HTTP 200. Invalid or expired tokens return HTTP 400 with the same generic message.

## SMTP contract

Use `nodemailer` with these environment variables:

- `SMTP_HOST` — required when password reset is enabled.
- `SMTP_PORT` — positive integer, default `587`.
- `SMTP_SECURE` — `true` for implicit TLS, otherwise STARTTLS-capable transport.
- `SMTP_USER` and `SMTP_PASS` — optional only when the selected relay permits unauthenticated delivery; they must be supplied together.
- `SMTP_FROM` — validated sender mailbox shown to users.
- `PASSWORD_RESET_BASE_URL` — public frontend origin. HTTPS is required in production; localhost HTTP is allowed in development/test.
- `PASSWORD_RESET_TOKEN_TTL_MINUTES` — optional positive integer, default `30`.

Production startup requires valid SMTP reset configuration because the public recovery routes are enabled. Development and test may start without a relay so automated transports can be injected. Secrets are never returned by health endpoints or logs.

The email has Vietnamese plain-text and HTML variants, a single reset action, a 30-minute expiry statement, and advice to ignore the message if it was not requested.

## Frontend interfaces

- Extend `AuthForm` signup mode with email state, validation, and forwarding.
- Add `app/(auth)/forgot-password/page.tsx` and a focused forgot-password form component.
- Add `app/(auth)/reset-password/page.tsx` and a focused reset-password form component.
- Add same-origin, origin-checked proxy handlers at:
  - `app/api/session/forgot-password/route.ts`
  - `app/api/session/reset-password/route.ts`
- Both proxy routes forward only the required JSON fields, preserve request cancellation, bound backend error messages, and never expose backend URLs.
- Successful reset expires `docai_session` using the shared cookie options.
- Extend auth-route recognition to include both new public pages.
- Change unauthenticated landing links and their copy to lead with login.

## Failure behavior

- Forgot-password SMTP failure: invalidate the newly created token best-effort, log a redacted operational error, and still return the generic 202 response.
- Database failure before reset email issuance: return the generic 202 response and log a redacted error.
- Reset database failure: return a generic temporary-failure response without consuming a token unless the full transaction commits.
- Expired/used token: persistent inline error with `Yêu cầu liên kết mới`.
- Client/network failure: persistent inline error and retry action; never rely only on a toast.

## Testing and verification

### Backend

- Migration-integrity assertions for nullable unique email, session version, token uniqueness, indexes, and cascade deletion.
- Registration requires, normalizes, and uniquely stores email while preserving existing user compatibility.
- Forgot-password response is identical for existing, unknown, disabled, and email-null users.
- Raw token never reaches Prisma storage or logs.
- Token digest, 30-minute expiry, prior-token invalidation, cooldown, and SMTP payload are tested.
- SMTP failure invalidates the issued token without changing the public response.
- Reset succeeds once, rejects expired/used/unknown tokens, and handles concurrent consumption atomically.
- Password hash changes and old password stops authenticating.
- `sessionVersion` invalidates old JWTs; legacy version-zero tokens remain rollout-compatible until reset.
- Dedicated forgot/reset rate limits are asserted.

### Frontend

- Landing unauthenticated calls to action point to `/login`.
- Login shows `Tạo tài khoản`, then `Quên mật khẩu?` beneath it.
- Signup requires and forwards email with correct autocomplete.
- Forgot-password success is enumeration-safe and persistent.
- Reset validates matching passwords, handles missing/invalid tokens, clears the session cookie, and links to login.
- New proxy routes enforce same-origin mutations and redact backend failures consistently.
- Login, signup, forgot, and reset pages keep one main landmark, one level-one heading, keyboard access, 44px controls, Vietnamese labels, and Be Vietnam Pro.

### Final gate

- Backend targeted tests, full backend suite, TypeScript build, and migration integrity pass.
- Frontend targeted tests, full frontend suite, lint, typecheck, and production build pass.
- Authenticated and unauthenticated Chrome checks confirm route order, responsive layouts, focus, error states, and no console failures.
- A local SMTP capture service or mocked transport verifies email content without sending real external mail during automated tests.

## Non-goals

- No username recovery.
- No account-security page for adding email to existing users.
- No SMS, authenticator, security-question, or administrator-code recovery.
- No change from username-based login to email-based login.
- No fabricated email backfill for existing accounts.
