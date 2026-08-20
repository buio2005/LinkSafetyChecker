export default {
  async fetch(request, env) {

    const headers = {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers })
    }

    const { searchParams } = new URL(request.url)
    let target = searchParams.get("url")

    if (!target) {
      return new Response(JSON.stringify({
        error: "Inserisci un dominio"
      }), { headers })
    }

    let result = {}

    try {

      let urlToCheck = target
      if (!urlToCheck.startsWith("http")) {
        urlToCheck = "https://" + urlToCheck
      }

      const startTime = Date.now()
      const response = await fetch(urlToCheck, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 LinkChecker/1.0"
        }
      })
      const responseTime = Date.now() - startTime

      const h = Object.fromEntries(response.headers)
      const finalUrl = response.url

      result.domain = target
      result.status = response.status
      result.https = finalUrl.startsWith("https")
      result.responseTime = responseTime
      result.redirected = finalUrl !== urlToCheck
      result.finalUrl = finalUrl

      // Basic HTML parsing (regex is limited but enough for title/meta)
      let title = "Non rilevato"
      let description = "Non rilevata"
      let favicon = `https://www.google.com/s2/favicons?domain=${target}&sz=64`

      if (response.headers.get("content-type")?.includes("text/html")) {
        const text = await response.text()
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i)
        if (titleMatch) title = titleMatch[1].trim()

        const descMatch = text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                         text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
        if (descMatch) description = descMatch[1].trim()
      }

      result.meta = {
        title,
        description,
        favicon
      }

      // --- CDN Detection (PHASE 1: Headers hint) ---
      let headerCdn = null
      let server = h["server"] ? h["server"].toLowerCase() : "n/a"
      
      // Cloudflare Worker Proxy Fix: 
      // Cloudflare Workers often overwrite the 'Server' header to 'cloudflare' during fetch.
      // We also check for 'x-powered-by' or other clues if server is 'cloudflare'
      if (server === "cloudflare") {
        if (h["x-powered-by"]) server = h["x-powered-by"].toLowerCase()
        else if (h["x-turbo-charged-by"]) server = "litespeed"
      }
      result.server = server

      const hasCfRay = !!h["cf-ray"]
      const hasCfCache = !!h["cf-cache-status"]
      const isCfServer = server.includes("cloudflare")

      if (hasCfRay && (hasCfCache || isCfServer)) {
        headerCdn = "Cloudflare"
      } else if (server.includes("akamai")) {
        headerCdn = "Akamai"
      } else if (h["x-served-by"]?.toLowerCase().includes("fastly")) {
        headerCdn = "Fastly"
      } else if (h["x-amz-cf-id"]) {
        headerCdn = "Amazon CloudFront"
      } else if (h["via"]?.toLowerCase().includes("vegur")) {
        headerCdn = "Heroku"
      }

      // SECURITY HEADERS (Expanded)
      result.security_headers = {
        hsts: !!h["strict-transport-security"],
        csp: !!h["content-security-policy"],
        xframe: !!h["x-frame-options"],
        xcontent: !!h["x-content-type-options"],
        referrer: !!h["referrer-policy"]
      }

      // SSL Check (Simplified to avoid inconsistent third-party data)
      let ssl_info = { valid: result.https, provider: "n/a" }
      try {
        // We only try a quick lookup for issuer to avoid "n/a" if possible
        const ct_res = await fetch(`https://api.certspotter.com/v1/issuances?domain=${target}&include_subdomains=false&limit=1`)
        const ct_data = await ct_res.json()
        if (ct_data && ct_data.length > 0) {
          ssl_info.provider = ct_data[0].issuer?.common_name || "n/a"
        }
      } catch (e) {
        // Silent fallback
      }
      result.ssl = ssl_info

      // DNS + IP
      let ip_info = {}

      try {
        const dns = await fetch("https://dns.google/resolve?name=" + target)
        const dns_data = await dns.json()

        if (dns_data.Answer) {

          const ip = dns_data.Answer[0].data
          ip_info.ip = ip

          const iplookup = await fetch("http://ip-api.com/json/" + ip)
          const ipdata = await iplookup.json()

          ip_info.country = ipdata.country || "n/a"
          ip_info.org = ipdata.org || "n/a"
          ip_info.as = ipdata.as || "n/a"
          ip_info.isp = ipdata.isp || "n/a"

          let hosting = ipdata.org || "Non rilevato"

          if (hosting.toLowerCase().includes("cloudflare")) {
            hosting = "Hosting nascosto da Cloudflare"
          }

          ip_info.hosting = hosting
        }

      } catch (e) {
        ip_info = {}
      }

      result.ip_info = ip_info

// CDN detection SERIA basata su ASN
let finalCdn = "No CDN rilevata"

if (ip_info.as) {

  const asn = ip_info.as.toLowerCase()

  if (asn.includes("13335") || asn.includes("cloudflare")) {
    finalCdn = "Cloudflare"
  }
  else if (asn.includes("16509") || asn.includes("amazon")) {
    finalCdn = "Amazon CloudFront"
  }
  else if (asn.includes("20940") || asn.includes("akamai")) {
    finalCdn = "Akamai"
  }
  else if (asn.includes("54113") || asn.includes("32934") || asn.includes("fastly")) {
    finalCdn = "Fastly"
  }

}

// Se l'ASN non ha dato risultati, usiamo l'headerCdn ma con estrema cautela per Cloudflare
if (finalCdn === "No CDN rilevata" && headerCdn) {
    // Se l'header dice Cloudflare ma l'hosting è chiaramente un altro, ignoriamo l'header
    if (headerCdn === "Cloudflare") {
        const hst = ip_info.hosting?.toLowerCase() || ""
        if (hst !== "" && !hst.includes("cloudflare") && !hst.includes("hidden")) {
            // Se l'hosting è visibile e non è Cloudflare, l'header Cloudflare è un falso positivo (probabilmente un proxy intermedio)
            finalCdn = "No CDN rilevata"
        } else {
            finalCdn = "Cloudflare"
        }
    } else {
        finalCdn = headerCdn
    }
}

result.cdn = finalCdn

      // IP reputation
      let ip_reputation = "unknown"

      try {
        if (ip_info.ip) {

          const abuse = await fetch(
            "https://api.abuseipdb.com/api/v2/check?ipAddress=" + ip_info.ip,
            {
              headers: {
                "Key": env.ABUSEIPDB_KEY,
                "Accept": "application/json"
              }
            }
          )

          const abuse_data = await abuse.json()
          let score = abuse_data?.data?.abuseConfidenceScore

          if (score > 70) ip_reputation = "alta (rischio elevato)"
          else if (score > 30) ip_reputation = "media"
          else ip_reputation = "bassa"
        }

      } catch (e) {
        ip_reputation = "non disponibile"
      }

      result.ip_reputation = ip_reputation

      if (result.cdn !== "No CDN rilevata") {
        result.ip_reputation_note = "IP condiviso (CDN), dato meno significativo per la sicurezza del singolo sito."
      }

      // Google Safe Browsing
      let safe_browsing = "clean"

      try {

        const google = await fetch(
          `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${env.GOOGLE_SAFEBROWSING_KEY}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              client: {
                clientId: "tivustream-checker",
                clientVersion: "1.0"
              },
              threatInfo: {
                threatTypes: [
                  "MALWARE",
                  "SOCIAL_ENGINEERING",
                  "UNWANTED_SOFTWARE"
                ],
                platformTypes: ["ANY_PLATFORM"],
                threatEntryTypes: ["URL"],
                threatEntries: [
                  { url: urlToCheck }
                ]
              }
            })
          }
        )

        const google_data = await google.json()

        if (google_data.matches) {
          safe_browsing = "malicious"
        }

      } catch (e) {
        safe_browsing = "unknown"
      }

      result.safe_browsing = safe_browsing

// 🔥 DOMAIN INFO (RDAP avanzato multi-source)

let domain_created = null
let domain_updated = null
let age_days = null

async function getDomainInfo(domain){

  const sources = [
    "https://rdap.org/domain/",
    "https://rdap.verisign.com/com/v1/domain/"
  ]

  for (let base of sources) {

    try {

      const res = await fetch(base + domain)
      const data = await res.json()

      // 1️⃣ EVENTI STANDARD
      if (data.events && data.events.length > 0) {

        data.events.forEach(ev => {

          let action = ev.eventAction?.toLowerCase()

          if (
            (action.includes("registration") || action.includes("created")) &&
            !domain_created
          ) {
            domain_created = ev.eventDate
          }

          if (action.includes("last changed") || action.includes("updated")) {
            domain_updated = ev.eventDate
          }

        })

      }

      // 2️⃣ FALLBACK SU ALTRI CAMPI (molto importante)
      if (!domain_created) {
        if (data.registrationDate) {
          domain_created = data.registrationDate
        }
        else if (data.creationDate) {
          domain_created = data.creationDate
        }
      }

      // se abbiamo trovato almeno la creazione → basta
      if (domain_created) break

    } catch(e){
      continue
    }

  }

}

await getDomainInfo(target)

// 🌐 FALLBACK SE RDAP NON RESTITUISCE NULLA
if (!domain_created) {

  try {

    const alt = await fetch("https://api.whois.vu/?q=" + target)
    const alt_data = await alt.json()

    // prova vari formati possibili
    if (alt_data.created) {
      domain_created = alt_data.created
    } else if (alt_data.creation_date) {
      domain_created = alt_data.creation_date
    }

  } catch(e) {}

}

// calcolo età
if (domain_created) {

  // FIX timestamp UNIX (secondi → millisecondi)
  if (!isNaN(domain_created)) {
    domain_created = Number(domain_created)
    if (domain_created < 10000000000) {
      domain_created = domain_created * 1000
    }
  }

  let createdDate = new Date(domain_created)
  let now = new Date()
  age_days = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24))
}

result.domain_created = domain_created
result.domain_updated = domain_updated
result.domain_age_days = age_days
result.domain_age = age_days ? age_days + " giorni" : "non disponibile"


// DOMAIN RISK (corretto e coerente con RDAP)
let domain_risk = "unknown"

if (age_days !== null && age_days !== undefined) {

  if (age_days < 30) {
    domain_risk = "high"
  } else if (age_days < 180) {
    domain_risk = "medium"
  } else {
    domain_risk = "low"
  }

}

// override sicurezza
if (result.safe_browsing === "malicious") {
  domain_risk = "high"
}

result.domain_risk = domain_risk

      // TRUST SCORE
      let score = 100

// HTTPS (fondamentale)
if (!result.https) score -= 40

// Security headers (più peso)
if (!result.security_headers.hsts) score -= 10
if (!result.security_headers.csp) score -= 10
if (!result.security_headers.xframe) score -= 5
if (!result.security_headers.xcontent) score -= 5
if (!result.security_headers.referrer) score -= 5

// Età dominio
if (age_days && age_days < 30) score -= 30
else if (age_days && age_days < 180) score -= 15

// Reputazione IP
if (result.ip_reputation === "alta (rischio elevato)") score -= 50
else if (result.ip_reputation === "media") score -= 25

// Google Safe Browsing (critico)
if (result.safe_browsing === "malicious") score -= 80

// Bonus sicurezza minima
if (result.https && result.safe_browsing === "clean") {
  score += 5
}

// Clamp
if (score > 100) score = 100
if (score < 0) score = 0

      result.trust_score = score

      // 🔍 TRUST SCORE BREAKDOWN
let breakdown = []

if (result.https) {
  breakdown.push("✔ HTTPS attivo (+5)")
} else {
  breakdown.push("❌ HTTPS non attivo (-40)")
}

if (!result.security_headers.hsts) {
  breakdown.push("❌ HSTS non configurato (-10)")
} else {
  breakdown.push("✔ HSTS attivo")
}

if (!result.security_headers.csp) {
  breakdown.push("❌ CSP non configurato (-10)")
} else {
  breakdown.push("✔ CSP attivo")
}

if (!result.security_headers.xframe) {
  breakdown.push("❌ X-Frame non configurato (-5)")
} else {
  breakdown.push("✔ X-Frame attivo")
}

if (!result.security_headers.xcontent) {
  breakdown.push("❌ X-Content-Type-Options mancante (-5)")
} else {
  breakdown.push("✔ X-Content-Type-Options attivo")
}

if (!result.security_headers.referrer) {
  breakdown.push("❌ Referrer-Policy mancante (-5)")
} else {
  breakdown.push("✔ Referrer-Policy attivo")
}

if (result.ip_reputation === "alta (rischio elevato)") {
  breakdown.push("❌ IP segnalato (-50)")
} else if (result.ip_reputation === "media") {
  breakdown.push("⚠ IP sospetto (-25)")
} else {
  breakdown.push("✔ IP pulito")
}

if (result.safe_browsing === "malicious") {
  breakdown.push("❌ Segnalato da Google (-80)")
} else {
  breakdown.push("✔ Nessuna segnalazione Google")
}

if (age_days && age_days < 30) {
  breakdown.push("❌ Dominio molto recente (-30)")
} else if (age_days && age_days < 180) {
  breakdown.push("⚠ Dominio recente (-15)")
} else {
  breakdown.push("✔ Dominio consolidato")
}

result.trust_breakdown = breakdown

      if (score >= 80) result.trust_level = "high"
      else if (score >= 50) result.trust_level = "medium"
      else result.trust_level = "low"
    
// 🧠 VERDETTO FINALE

let verdict = "unknown"
let verdict_text = ""

if (score >= 80) {
  verdict = "safe"
  verdict_text = "✔ Sito generalmente sicuro"
}
else if (score >= 50) {

  // caso tipico: sito ok ma header mancanti
  if (
    result.https &&
    result.safe_browsing === "clean" &&
    result.ip_reputation !== "alta (rischio elevato)"
  ) {
    verdict = "safe"
    verdict_text = "✔ Sito sicuro con configurazione base (alcune protezioni avanzate non attive)"
  } else {
    verdict = "medium"
    verdict_text = "⚠ Attenzione: alcune configurazioni mancanti"
  }

}
else {
  verdict = "danger"
  verdict_text = "❌ Possibili rischi rilevati"
}

// override forti (priorità alta)
if (domain_risk === "high") {
  verdict = "danger"
  verdict_text = "❌ Dominio molto recente: possibile rischio"
}

if (result.safe_browsing === "malicious") {
  verdict = "danger"
  verdict_text = "❌ Segnalato come pericoloso da Google"
}

result.verdict = verdict
result.verdict_text = verdict_text


    } catch (error) {

      result.error = "Sito non raggiungibile"

    }

    return new Response(JSON.stringify(result, null, 2), { headers })

  }
}