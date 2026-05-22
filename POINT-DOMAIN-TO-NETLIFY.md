# Point wendypix.com at the Netlify site

**Goal:** Make `wendypix.com` (and `www.wendypix.com`) show the new Netlify site, with no "netlify" branding anywhere visible to visitors. Wendy's Pixieset gallery stops showing up at this URL. Booking, admin, and the photo editor keep working exactly as they do today.

**Time:** ~30 minutes of clicking, plus 15 minutes to a few hours of DNS propagation.

**What we know about her current setup** (verified via DNS lookup):
- Domain registered and DNS-managed at **GoDaddy** (nameservers: `ns31/ns32.domaincontrol.com`)
- Website currently at `52.205.95.21` — almost certainly **Pixieset** (AWS-hosted)
- Email at **Microsoft 365** (MX → `wendypix-com.mail.protection.outlook.com`)

**What stays the same after this:**
- Wendy's email at `@wendypix.com` — we keep all Microsoft 365 DNS records untouched.
- Her Pixieset gallery — still live at `wendypix.pixieset.com` (or wherever the Pixieset URL is), just no longer at `wendypix.com`.
- The Netlify site itself — same repo, auto-deploys, admin panel, everything.

---

## Before you start

Have these tabs open:

1. **Netlify** — dashboard for the wendypix site.
2. **GoDaddy** — sign in, then go to **My Products** → **All Products and Services** → find `wendypix.com` → click **DNS** (or **Manage DNS**). This is the DNS Management screen for the domain.
3. **A note** where you can paste things between steps.

---

## Step 1 — Add the custom domain in Netlify (5 min)

1. Netlify dashboard → click into the **wendypix** site.
2. Left sidebar → **Domain management** (or "Domains").
3. Section: **Custom domains** (or "Production domains") → click **Add a domain**.
4. Enter `wendypix.com` (no `https://`, no trailing slash). Click **Verify**.
5. Netlify checks ownership and confirms you can add it. Confirm.
6. Repeat for `www.wendypix.com` — Netlify usually offers it automatically; accept.

Both `wendypix.com` and `www.wendypix.com` should now appear in the list. Status will say **"Awaiting external DNS"** or **"Check DNS configuration"** — expected, we'll fix it in Step 2.

7. Click the **Options** / three-dots menu next to `wendypix.com` → **Check DNS configuration** (or **Set up DNS** / **DNS instructions**). Netlify shows the exact records to add at GoDaddy. **Keep this tab open** — you'll copy values from it.

The records will look something like:

```
For wendypix.com (apex / root):
  Type: A     Name: @     Value: 75.2.60.5

For www.wendypix.com:
  Type: CNAME Name: www   Value: wendypix.netlify.app
```

**Use whatever values Netlify shows you** — they may have updated their load-balancer IP since this guide was written.

---

## Step 2 — Update DNS at GoDaddy (10 min)

This is the only step that affects the public internet. Be precise about what you touch.

1. GoDaddy → DNS Management for `wendypix.com`.
2. **First — take a full screenshot of the DNS records page.** This is your rollback safety net.
3. **Identify what NOT to touch:**
   - **Every MX record** — these are Microsoft 365's mail routing. Leave all of them alone. There's typically one MX with priority 0 pointing at `wendypix-com.mail.protection.outlook.com`.
   - **Every TXT record** — these include SPF (`v=spf1 include:spf.protection.outlook.com ...`), DKIM (`selector1._domainkey...`, `selector2._domainkey...`), DMARC (`_dmarc`), and possibly Microsoft 365 verification (`MS=ms...`). All of these keep her email signed and trusted. Don't touch any of them.
   - **Every SRV record** — Microsoft 365 uses a couple (`_sip._tls`, `_sipfederationtls._tcp`) for Teams/Skype. Leave alone.
   - **The NS records** — GoDaddy's nameservers. Leave alone.
4. **Records to change** (these are the only two that should differ):

   **a) The apex A record (root domain):**
   - Find the **A** record with Name `@` and current Value `52.205.95.21`. This is the Pixieset pointer.
   - Click **Edit** (pencil icon).
   - Change Value from `52.205.95.21` to `75.2.60.5` (or whatever Netlify showed you).
   - TTL: `600` or `1 hour` is fine.
   - Save.

   **b) The www CNAME record:**
   - Find any **A** or **CNAME** record with Name `www`. It probably currently points to either Pixieset or to `@`.
   - Click **Edit**.
   - Change Type to **CNAME**.
   - Set Value to `wendypix.netlify.app` (or whatever Netlify showed).
   - TTL: `600` or `1 hour`.
   - Save.

   If there's no `www` record at all, click **Add** → choose **CNAME** → Name `www`, Value `wendypix.netlify.app`, Save.

5. Save / Confirm all changes.

GoDaddy sometimes shows a "Save" or "Apply" banner at the top — click that if it's there.

---

## Step 3 — Wait for DNS to propagate (15 min to a few hours)

DNS changes take time to spread across the internet. To watch progress:

- In incognito, visit `wendypix.com`. Keep refreshing every few minutes. (Your main browser may cache the old page for a while.)
- Check `https://dnschecker.org/#A/wendypix.com` — look at the world map. When most regions show `75.2.60.5`, you're good. Same for `https://dnschecker.org/#CNAME/www.wendypix.com` showing `wendypix.netlify.app`.
- In Netlify → Domain management → the status next to `wendypix.com` should flip from "Awaiting external DNS" → "DNS verification successful" / "Netlify DNS". Refresh the page periodically.

GoDaddy DNS propagation is usually 15–60 minutes for most users, occasionally up to a few hours. Don't proceed until Netlify shows the domain as verified.

---

## Step 4 — Enable HTTPS (2 min)

Once DNS is verified, Netlify can issue a free SSL certificate.

1. Netlify → Domain management → scroll to the **HTTPS** section.
2. Click **Verify DNS configuration** if not already verified.
3. Click **Provision certificate** (or **Renew Let's Encrypt certificate**). Netlify gets a Let's Encrypt cert in 30–60 sec.
4. Toggle on **Force HTTPS** so `http://` requests auto-redirect to `https://`.

Test: visit `https://wendypix.com` in incognito. Padlock icon should show, no browser warnings.

---

## Step 5 — Make wendypix.com the primary domain (1 min)

Critical step — this is what hides "netlify" from visitors.

1. Netlify → Domain management → custom domains list.
2. Find `wendypix.com` → click **Options** / three-dots → **Set as primary domain**.
3. Confirm.

From now on, anyone visiting `wendypix.netlify.app` gets auto-redirected to `wendypix.com`. The address bar, share links, and SEO all reflect `wendypix.com` only.

---

## Step 6 — Retire the Pixieset site (5 min, optional but recommended)

Once the new site is live at wendypix.com, anyone visiting that URL sees the Netlify site. But Pixieset is still live at its own URL (probably `wendypix.pixieset.com` or similar) and Wendy is probably still paying for it.

A few options:

**A) Just stop paying for Pixieset (most committal).** Once you've confirmed the Netlify site is fully working, log into Pixieset → Account → cancel subscription. Her Pixieset content will eventually be deleted by them.

**B) Downgrade Pixieset to free tier** — if you want to keep it as a backup or archive. Their free tier still hosts a smaller gallery.

**C) Just leave it.** Pixieset doesn't bother anyone if nobody links to it. The annual cost is the only downside.

Don't rush this. I'd let the new site run for **a couple of weeks** before canceling Pixieset, in case any bookmarks/links pointed at Pixieset URLs that you want to redirect later.

---

## Step 7 — Sanity checks (5 min)

Run through each:

- [ ] `https://wendypix.com` loads the new site, padlock present.
- [ ] `https://www.wendypix.com` also loads (redirects to the apex).
- [ ] `https://wendypix.netlify.app` redirects to `https://wendypix.com`.
- [ ] `wendypix.com/book` works — slot picker shows availability, can submit a test booking.
- [ ] `wendypix.com/admin` works — magic-link sign-in delivers, all four tabs (Packages, Bookings, Settings, Photos) load.
- [ ] **Wendy's email at `wendy@wendypix.com` (or whatever the address) still works**. Have her send a test message out, and you send one in. Both should arrive normally. **Do this within a few hours of the DNS change** — it's the single thing most likely to surface a problem, and it's better to catch it early.
- [ ] Stripe webhook still firing — check Stripe dashboard → Developers → Webhooks → Recent Deliveries for green status on the next real booking.

If email fails: restore the MX/TXT records from the screenshot you took in Step 2. Email usually recovers within 5–15 minutes once records are correct.

---

## What could go wrong

**"Wendy's email stopped working"** — You touched an MX or TXT record. Restore from the screenshot. The single most common cause: editing instead of deleting/re-adding, and accidentally also changing an MX record's value or TTL.

**"GoDaddy won't let me delete or change the old A record"** — Sometimes GoDaddy bundles records into "Forwarding" or "Parking" features. Check **Domain Settings** → **Forwarding** and make sure it's off. Also check that you're editing DNS, not the "Website" panel which is a separate (paid) GoDaddy product.

**"DNS not propagating after 24 hours"** — Check you didn't accidentally also change NS (nameserver) records. If you did, traffic isn't reading GoDaddy's DNS at all and nothing will update until you fix them.

**"HTTPS certificate won't provision"** — Propagation incomplete. Wait longer. Verify A record at `dnschecker.org`.

**"Old Pixieset still showing"** — Browser cache. Hard refresh (Cmd+Shift+R Mac, Ctrl+Shift+R Windows) or incognito. If still wrong after 24 hours, check the A record at GoDaddy is actually saved.

**"Hardcoded netlify.app URLs in the new site's content (emails, OG tags, etc.)"** — There may be a few spots in the codebase. After this migration, message me to do a sweep — I'll find any `wendypix.netlify.app` strings and replace with `wendypix.com`.

---

## When you're done

The site is publicly live at `wendypix.com`. Visitors see no "netlify" anywhere. Pixieset is invisible at this URL. GoDaddy's role is reduced to domain registration. Microsoft 365 email keeps working untouched. Everything else (booking, admin, photos, scheduled functions, Stripe, calendar sync) runs from Netlify, deployed automatically every time you push.
