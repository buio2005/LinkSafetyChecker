# Link Safety Checker

A link and domain safety scanner. It returns a trust score alongside details on
HTTPS, security headers, IP reputation, Google Safe Browsing flags and domain age.

Live: **https://tivustream.com/check-tool/**

---

## Architecture

| Component | Runs on | Source |
|---|---|---|
| Analysis engine | Cloudflare Workers | `src/worker.js` |
| Web interface | TivuStream VPS, served under `/check-tool/` | `public/index.html` |

The interface calls the Worker over HTTP and renders its JSON response.

```
LinkSafetyChecker/
├── src/
│   └── worker.js       Cloudflare Worker: runs every check
├── public/
│   └── index.html      Tool page (deployed to the VPS)
├── wrangler.jsonc      Worker configuration
└── package.json
```

---

## Secrets

The Worker uses two API keys. **They are not in the source** and must never be:
they are stored as encrypted secrets on Cloudflare.

| Name | Service | Purpose |
|---|---|---|
| `ABUSEIPDB_KEY` | AbuseIPDB | IP address reputation |
| `GOOGLE_SAFEBROWSING_KEY` | Google Safe Browsing v4 | Malware and phishing flags |

To set them (once, and on every key rotation):

```bash
npx wrangler secret put ABUSEIPDB_KEY
npx wrangler secret put GOOGLE_SAFEBROWSING_KEY
```

The command prompts for the value interactively, so the key never appears in the
command line and never reaches the shell history.

For local development, create a `.dev.vars` file following `.dev.vars.example`.
It is git-ignored — **do not remove it from `.gitignore`**.

> Note: Safe Browsing v4 is free but restricted to non-commercial use.
> Google Web Risk is the paid alternative for commercial applications.

---

## Development

```bash
npm install            # first time only
npx wrangler dev       # local server with hot reload
npx wrangler deploy    # publish to Cloudflare
npx wrangler tail      # live logs from the deployed Worker
```

`public/index.html` is not published by wrangler — it is uploaded to the VPS
separately.

---

## Roadmap

Planned work, in priority order:

- [x] Move API keys to Cloudflare secrets
- [ ] Restrict CORS to tivustream.com, add rate limiting
- [ ] Serve the Worker from a custom domain route, disable `workers_dev`
- [ ] Normalise incoming URLs and analyse the full path, not just the domain
- [ ] Per-block error handling (today an unreachable site wipes out the whole analysis)
- [ ] Run external lookups in parallel, cache results at the edge
- [ ] Return language-neutral codes instead of localised strings, so the UI owns translation
- [ ] Split the score in two: actual risk vs technical hygiene
- [ ] Redirect chain, lexical domain analysis, extra sources (URLhaus, Cloudflare Radar)

---

## Licence

Not yet defined.
