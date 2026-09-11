# TrackMyPet owner accounts — staging setup

This document is for a separate Supabase staging project. Do not run these steps
against the production project `ohoklhgivqjqtkqzrrhi`.

## Prepared in this branch

- `005_remove_obsolete_public_policies.sql` removes only obsolete permissive policies.
- `006_tag_owners.sql` creates the one-owner-per-TAG relationship.
- `/api/auth-config` exposes only the Supabase URL and publishable key while the feature is enabled.
- `/api/account` validates the Supabase access token on the Auth server, requires a confirmed email, lists owned TAGs and claims a TAG with code + PIN.
- Accounts are fail-closed unless `TRACKMYPET_ACCOUNTS_ENABLED=true`.

## External staging project required

1. Create a new Supabase project named `trackmypet-staging` in the same organization.
2. Use a new database password. Do not reuse the production database password.
3. In the staging SQL Editor, run migrations `001` through `006` in numeric order.
4. Create one disposable TAG for testing. Use code `000000`; do not copy a real PIN, phone number, photo or owner record.
5. Under Authentication > URL Configuration, set the Site URL to the exact Vercel Preview origin once it exists.
6. Add only the exact Preview callback URLs needed for registration and password recovery. Do not use a production URL or an unrestricted wildcard.
7. Keep email confirmation enabled.

## Vercel Preview variables

Add these variables to the Preview environment only:

```text
SUPABASE_URL=https://STAGING_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<staging service-role key>
SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
TRACKMYPET_ACCOUNTS_ENABLED=true
TRACKMYPET_PREVIEW_TEST_CODE=000000
TRACKMYPET_LOST_STATUS_ENABLED=true
TRACKMYPET_PROFILE_FIELDS_ENABLED=true
```

Never copy the production service-role key into Preview. Do not enable the
accounts flag in Production during staging work.

The next implementation step adds the account screens and owner-authorized
editing after the staging project reference and Preview URL are available.

