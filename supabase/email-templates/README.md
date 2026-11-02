# G&R sign-in emails (push 34c · English only)

Paste each file into **Supabase → Authentication → Email Templates** (Ronnie does this by hand; nothing here changes Supabase).
For each template: set the **Subject** below, switch the body to the HTML/source view, paste the whole file, Save.

| Supabase template      | File                  | Subject                                  | When it's sent |
|------------------------|-----------------------|------------------------------------------|----------------|
| Confirm signup         | `confirm-signup.html` | `Your G&R code: {{ .Token }}`            | First sign-in by email (new account) |
| Magic Link             | `magic-link.html`     | `Your G&R sign-in code: {{ .Token }}`    | "Forgot your code?" and Ronnie's "Send reset link" |
| Change Email Address   | `change-email.html`   | `Confirm your new email for G&R`         | Email changed in the check-up / Profile |

Variables used (Supabase Go templates): `{{ .Token }}` (the 6-digit code), `{{ .ConfirmationURL }}` (button link), `{{ .NewEmail }}` (change email only).

Style: logo `https://gr-staff-portal.vercel.app/logo-full.png`, cream background `#F6F2EC`, white card, serif heading (Fraunces where the mail app has it, else Georgia), green button `#2E7D5B`.
Email-safe: tables + inline styles only, no external CSS, no scripts.

Invited staff (push 34, `/go/<token>` links) never get any of these emails: the invite link signs them in directly.

Optional, later: custom SMTP (Supabase → Authentication → SMTP, sender "G&R à votre service"). Supabase's built-in sender only allows a few emails per hour.
