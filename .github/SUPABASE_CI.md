# Supabase CI Secrets

The nightly `security_scheduled_summary` workflow requires two repository secrets:

- `SUPABASE_ACCESS_TOKEN`: a Supabase personal access token (or automation token) with access to the target project.
- `SUPABASE_PROJECT_REF`: your Supabase project ref (the short project ID used in dashboard URLs).

## Where to find these in Supabase

- **Project ref**: Supabase Dashboard → select your project → **Settings** → **General** → **Reference ID**.
- **Access token**: Supabase Dashboard → avatar menu → **Access Tokens** (create a token for CI/automation use).

## Set secrets in GitHub

In GitHub, add both secrets under **Repository Settings → Secrets and variables → Actions**, or use:

```bash
gh secret set SUPABASE_ACCESS_TOKEN -b"<your_supabase_access_token>"
gh secret set SUPABASE_PROJECT_REF -b"<your_project_ref>"
```
