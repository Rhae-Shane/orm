---
changes:
  - id: supabase-contract-regenerated-from-the-reference-fixture
    summary: The Supabase extension contract is regenerated and now declares 43 check constraints, six native-enum defaults as member literals, and two more list columns that waive the derived element-not-null check, so its storage hash changes; re-sign databases that were signed against the previous Supabase contract.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/orm-extension-supabase"'
---

## `supabase-contract-regenerated-from-the-reference-fixture`

The `@prisma/orm-extension-supabase` contract is now exactly what `contract:generate` produces from the reference fixture, which it had drifted away from. The Supabase space's storage hash changes from `ede079259d126d9153bcb4fc4aa6781d870a255585524e1e95fae9e5af4eef89` to `43f09411473534105017fa715b8932facbdf79feab1bfc75da681beb87f22cbc`.

Four things changed in the contract.

**43 check constraints are now declared.** Every `CHECK` that real Supabase declares on an `auth` or `storage` table — for example `users_email_change_confirm_status_check` and `one_time_tokens_token_hash_check` — is now part of the contract. They already exist on every Supabase database, so `prisma db verify` passes without a schema change.

**Six native-enum column defaults are declared as member literals.** `auth.oauth_clients.client_type`, `auth.oauth_authorizations.response_type`, `auth.oauth_authorizations.status`, and the `type` column of `storage.buckets`, `storage.buckets_analytics` and `storage.buckets_vectors` previously carried the raw cast expression as their default, for example `{ "kind": "function", "expression": "'STANDARD'::storage.buckettype" }`. They now carry the enum member itself: `{ "kind": "literal", "value": "STANDARD" }`. This is the same live default read a more precise way, so the live databases need no change; if you read a column's declared default out of the contract, expect a literal rather than an expression.

**Two list columns waive the derived element-not-null check.** `auth.custom_oauth_providers.acceptable_client_ids` and `auth.custom_oauth_providers.scopes` now carry `"noCheck": ["elementNotNull"]`, matching the two `storage` list columns that already did. Real Supabase has no such constraint on these columns, so the contract no longer expects one.

**78 timestamp columns are spelled `Timestamptz` instead of `DateTime` in the PSL.** Same codec (`pg/timestamptz-temporal@1`) and same emitted column, so this is a text change only.

A contract that composes the Supabase space references it by id, so your own `contract.json` and `contract.d.ts` do not change. What changes is the signature: a database that was signed against the previous Supabase contract no longer matches the new hash, so run `prisma db sign` against it after upgrading. If you re-emit your own contract, do that first so the composed space is the new one.
