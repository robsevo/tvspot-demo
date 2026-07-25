/** Channel abbreviation and colors */

/** Domain mappings for service logos (DuckDuckGo favicons) */
const SERVICE_DOMAINS: Record<string, string> = {
  "Netflix": "netflix.com",
  "Disney+": "disneyplus.com",
  "HBO Max": "max.com",
  "Max": "max.com",
  "Prime Video": "primevideo.com",
  "Paramount+": "paramountplus.com",
  "Apple TV+": "apple.com",
  "Hulu": "hulu.com",
  "Crave": "crave.ca",
  "Peacock": "peacocktv.com",
  "Tubi": "tubi.com",
  "Pluto TV": "pluto.tv",
  "Starz": "starz.com",
  "Showtime": "showtime.com",
  "MGM+": "mgm.com",
  "DAZN": "dazn.com",
  "Crunchyroll": "crunchyroll.com",
  "Discovery+": "discoveryplus.com",
  "Kanopy": "kanopy.com",
  "Shudder": "shudder.com",
};

/** Domain mappings for channel logos */
const CHANNEL_DOMAINS: Record<string, string> = {
  "ESPN": "espn.com",
  "ESPN 2": "espn.com",
  "ESPN+": "espn.com",
  "CNN": "cnn.com",
  "CNN International": "cnn.com",
  "FOX News": "foxnews.com",
  "Fox Sports 1": "foxsports.com",
  "Fox Sports 2": "foxsports.com",
  "MSNBC": "msnbc.com",
  "NBA TV": "nba.com",
  "NFL Network": "nfl.com",
  "NHL Network": "nhl.com",
  "MLB Network": "mlb.com",
  "HGTV": "hgtv.com",
  "Food Network": "foodnetwork.com",
  "TLC": "tlc.com",
  "Discovery Channel": "discovery.com",
  "National Geographic": "nationalgeographic.com",
  "History Channel": "history.com",
  "Travel Channel": "travelchannel.com",
  "AMC": "amc.com",
  "TNT": "tntdrama.com",
  "TBS": "tbs.com",
  "USA Network": "usanetwork.com",
  "FX": "fxnetworks.com",
  "Comedy Central": "comedycentral.com",
  "MTV": "mtv.com",
  "VH1": "vh1.com",
  "BET": "bet.com",
  "Cartoon Network": "cartoonnetwork.com",
  "Nickelodeon": "nick.com",
  "Disney Channel": "disneynow.com",
  "PBS": "pbs.org",
  "ABC": "abc.com",
  "CBS": "cbs.com",
  "NBC": "nbc.com",
  "The CW": "cwtv.com",
  "BBC America": "bbcamerica.com",
  "BBC World News": "bbc.com",
  "Bloomberg": "bloomberg.com",
  "CNBC": "cnbc.com",
  "E!": "eonline.com",
  "Freeform": "freeform.com",
  "Hallmark Channel": "hallmarkchannel.com",
  "Lifetime": "mylifetime.com",
  " Paramount Network": "paramountnetwork.com",
  "Paramount Network": "paramountnetwork.com",
  "Syfy": "syfy.com",
  "Bravo": "bravotv.com",
  "A&E": "aetv.com",
  "Animal Planet": "animalplanet.com",
  "Paramount+": "paramountplus.com",
  "Peacock": "peacocktv.com",
  "Tubi": "tubi.com",
  "Pluto TV": "pluto.tv",
  "C-SPAN": "c-span.org",
  "Oxygen": "oxygen.com",
  "BBC": "bbc.com",
  // ── added 2026-06-27: news / sports / Quebec FR / true-crime / kids ──
  "HLN": "hln.com",
  "BNN Bloomberg": "bnnbloomberg.ca",
  "CBC": "cbc.ca",
  "CBC News Network": "cbc.ca",
  "CTV": "ctv.ca",
  "CTV News": "ctvnews.ca",
  "CTV News Network": "ctvnews.ca",
  "CTV 2": "ctv.ca",
  "Global": "globaltv.com",
  "Global News": "globalnews.ca",
  "Citytv": "citytv.com",
  "CP24": "cp24.com",
  "TVA": "tva.ca",
  "TVA Sports": "tvasports.ca",
  "TVA Sports 2": "tvasports.ca",
  "Noovo": "noovo.ca",
  "RDI": "ici.radio-canada.ca",
  "ICI RDI": "ici.radio-canada.ca",
  "ICI Tele": "ici.radio-canada.ca",
  "LCN": "tvanouvelles.ca",
  "TV5": "tv5.ca",
  "RDS": "rds.ca",
  "RDS 2": "rds.ca",
  "TSN": "tsn.ca",
  "Sportsnet": "sportsnet.ca",
  "DAZN 1": "dazn.com", "DAZN 2": "dazn.com", "DAZN 3": "dazn.com",
  "DAZN 4": "dazn.com", "DAZN 5": "dazn.com",
  "NFL RedZone": "nfl.com",
  "beIN Sports": "beinsports.com",
  "beIN Sports 1": "beinsports.com", "beIN Sports 2": "beinsports.com",
  "beIN Sports 3": "beinsports.com", "beIN Sports 4": "beinsports.com",
  "beIN Sports 5": "beinsports.com",
  "Court TV": "courttv.com",
  "ID": "investigationdiscovery.com",
  "Cinemax": "cinemax.com",
  "Starz": "starz.com",
  "Showtime": "sho.com",
  "FXX": "fxnetworks.com",
  "Teletoon": "teletoon.com",
  // ── League + US sports networks (added 2026-07-05) ──
  // NBA TV + ESPN+ already mapped above.
  "ESPNU": "espn.com",
  "ESPNews": "espn.com",
  "CBS Sports Golazo": "cbssports.com",
  "beIN Sports Xtra": "beinsports.com",
  "Champions League": "uefa.com",
  "MLS": "mlssoccer.com",
  "Serie A": "legaseriea.com",
  "LaLiga TV": "laliga.com",
  "Peacock Premier League": "premierleague.com",
  "Sky Sport Bundesliga": "bundesliga.com",
  // ── Adds 2026-07-25. TBS / CNBC / Paramount Network were already mapped above. ──
  "Nat Geo Wild": "nationalgeographic.com",
  // Regional sports networks. MSG/MSG Plus share one brand domain; the Bally and
  // NBC Sports regionals likewise resolve off their parent brand, which is the
  // best a favicon lookup can do for an RSN (they have no per-region logo asset).
  "MSG": "msg.com",
  "MSG Plus": "msg.com",
  "NBC Sports Boston": "nbcsports.com",
  "NBC Sports Chicago": "nbcsports.com",
  "AT&T SportsNet Pittsburgh": "sportsnetpittsburgh.com",
  "Bally Sports North": "ballysports.com",
  "Bally Sports Detroit": "ballysports.com",
  "Sky Sports Premier League": "skysports.com",
};

/**
 * Simple Icons slugs for brands that have a crisp monochrome SVG there
 * (verified available). Rendered white so they sit cleanly on the colored
 * provider cards. Brands not listed fall back to a higher-res favicon below.
 */
const SIMPLEICONS_SLUGS: Record<string, string> = {
  "Netflix": "netflix",
  "HBO Max": "hbo",
  "Max": "hbo",
  "Apple TV+": "appletv",
  "Paramount+": "paramountplus",
  "Crunchyroll": "crunchyroll",
};

/**
 * Crisp transparent wordmark logos for streaming brands SimpleIcons has REMOVED
 * (disneyplus/primevideo/hulu/peacock/crave all 404 there now). Rendered WHITE
 * on the colored provider cards (ServicePicker applies a brightness-0/invert
 * filter) so they sit cleanly alongside the Netflix/Paramount+ SimpleIcons marks
 * instead of falling through to tiny mismatched color favicons. Direct Wikimedia
 * upload URLs (like SHOW_LOGO_URLS); if one breaks, getLogoCandidates falls
 * through to the favicon cleanly.
 */
const SERVICE_WORDMARK_LOGOS: Record<string, string> = {
  "Disney+": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Disney%2B_logo.svg/960px-Disney%2B_logo.svg.png",
  "Prime Video": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Amazon_Prime_Video_logo.svg/960px-Amazon_Prime_Video_logo.svg.png",
  "Hulu": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Hulu_logo_%282018%29.svg/960px-Hulu_logo_%282018%29.svg.png",
  "Peacock": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/NBCUniversal_Peacock_Logo_%282020%E2%80%932026%29.svg/960px-NBCUniversal_Peacock_Logo_%282020%E2%80%932026%29.svg.png",
  "Crave": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Crave_2018_logo.svg/960px-Crave_2018_logo.svg.png",
};

/** Google's favicon service — 128px, follows redirects, works for any domain. */
function googleFavicon(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

// Base-brand domains for channel families that appear with numbers/regions/
// prefixes (TSN1, Sportsnet East, 24/7 Family Guy, …) so they resolve a logo
// instead of falling through to text initials.
const BRAND_DOMAINS: Record<string, string> = {
  tsn: "tsn.ca", sportsnet: "sportsnet.ca", espn: "espn.com", "fox sports": "foxsports.com",
  fs1: "foxsports.com", fs2: "foxsports.com", nesn: "nesn.com", fanduel: "fanduel.com",
  "cbs sports": "cbssports.com", rds: "rds.ca", "tva sports": "tvasports.ca",
  discovery: "discovery.com", "investigation discovery": "investigationdiscovery.com",
  "discovery science": "science.discovery.com", history: "history.com", reelz: "reelz.com",
  mtv: "mtv.com", "w network": "wnetwork.com", showcase: "showcase.ca", slice: "slice.ca",
  "canal d": "canald.com", "canal vie": "canalvie.com", tlc: "tlc.com",
  "national geographic": "nationalgeographic.com", "food network": "foodnetwork.com",
  hgtv: "hgtv.com", amc: "amc.com", tnt: "tntdrama.com", tbs: "tbs.com", fx: "fxnetworks.com",
  "comedy central": "cc.com", nickelodeon: "nick.com", "cartoon network": "cartoonnetwork.com",
  // 24/7 single-show channels → the show's home network/site
  pokemon: "pokemon.com", "family guy": "fox.com", "american dad": "tbs.com",
  "rick and morty": "adultswim.com", "south park": "southpark.cc.com",
  "bob's burgers": "fox.com", futurama: "hulu.com", "the simpsons": "fox.com",
  "king of the hill": "fox.com", simpsons: "fox.com",
  hbo: "hbo.com", "fox news": "foxnews.com", "adult swim": "adultswim.com",
  boomerang: "boomerang.com", starz: "starz.com", cinemax: "cinemax.com",
  showtime: "sho.com", fxx: "fxnetworks.com", teletoon: "teletoon.com",
  bravo: "bravotv.com", syfy: "syfy.com", "a&e": "aetv.com",
  // League + US sports families (numbered/regional variants → base brand).
  // "cbs sports" already mapped above.
  "bein sports": "beinsports.com", bein: "beinsports.com",
  "cbs sports golazo": "cbssports.com",
  mls: "mlssoccer.com", "champions league": "uefa.com", "serie a": "legaseriea.com",
  laliga: "laliga.com", "la liga": "laliga.com", bundesliga: "bundesliga.com",
  "premier league": "premierleague.com", peacock: "peacocktv.com",
  espnu: "espn.com", espnews: "espn.com", nba: "nba.com",
};

/** Known logo URLs (Wikipedia thumbnails) for 24/7 single-show channels
 *  so they display the actual show logo, not a generic network favicon.
 *  If a URL is wrong, the <img> onError handler falls through cleanly. */
const SHOW_LOGO_URLS: Record<string, string> = {
  "family guy": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Family_Guy_Logo.svg/960px-Family_Guy_Logo.svg.png",
  "american dad": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/American_dad_logo.svg/960px-American_dad_logo.svg.png",
  "rick and morty": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Rick_and_Morty.svg/960px-Rick_and_Morty.svg.png",
  "south park": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/South_Park_logo.svg/960px-South_Park_logo.svg.png",
  "bob's burgers": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Bob%27s_Burgers_logo.svg/960px-Bob%27s_Burgers_logo.svg.png",
  futurama: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Futurama_1999_logo.svg/960px-Futurama_1999_logo.svg.png",
  "the simpsons": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/The_Simpsons_yellow_logo.svg/960px-The_Simpsons_yellow_logo.svg.png",
  simpsons: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/The_Simpsons_yellow_logo.svg/960px-The_Simpsons_yellow_logo.svg.png",
  "king of the hill": "https://upload.wikimedia.org/wikipedia/en/thumb/5/51/King_of_the_Hill_%28logo%29.svg/960px-King_of_the_Hill_%28logo%29.svg.png",
};

/** Resolve a show-specific logo URL for a channel name. */
function getShowLogoUrl(name: string): string | null {
  const n = name.toLowerCase().replace(/^24\/7\s+/, "").trim();
  return SHOW_LOGO_URLS[n] ?? null;
}

/** Distinct logo images for channels that would otherwise COLLIDE on a shared
 *  brand favicon. The whole ESPN family maps to espn.com, so ESPN / ESPN2 /
 *  ESPNU / ESPNews / ESPN+ rendered the identical round mark and looked like
 *  duplicates in the grid. These give each a distinct wordmark (verified
 *  Wikimedia thumbnails, 2026-07-05); a broken URL falls through to the favicon
 *  via the <img> onError chain. ESPNU has no Wikimedia file — it keeps the
 *  round espn.com favicon, still distinct from the wordmarks here. */
const CHANNEL_LOGO_URLS: Record<string, string> = {
  "ESPN": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/250px-ESPN_wordmark.svg.png",
  "ESPN2": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/ESPN2_logo.svg/250px-ESPN2_logo.svg.png",
  "ESPN 2": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/ESPN2_logo.svg/250px-ESPN2_logo.svg.png",
  "ESPNU": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/ESPN_U_logo.svg/250px-ESPN_U_logo.svg.png",
  "ESPNews": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/ESPNews.svg/250px-ESPNews.svg.png",
  "ESPN+": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/ESPN_Plus.svg/250px-ESPN_Plus.svg.png",
};
/** Resolve a logo domain for a channel name, tolerating numbers/regions/prefixes
 *  ("TSN1", "Sportsnet East", "24/7 Family Guy") via normalized brand matching. */
/** Normalize a channel name to a brand key: drop "24/7 " prefix, lowercase, strip
 *  trailing digits + region/qualifier words, collapse spaces. "TSN1" → "tsn",
 *  "CTV 2" → "ctv", "Sportsnet 360" → "sportsnet". Shared by domain + logo lookup. */
function normalizeBrand(name: string): string {
  return name
    .toLowerCase()
    .replace(/^24\/7\s+/, "")
    .replace(/\b(hd|fhd|sd|4k|uhd|east|west|ontario|pacific|network|channel|info|one|tv)\b/g, "")
    .replace(/\s*\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Curated, verified logo URLs for channels whose favicon is wrong/low-quality
 *  (e.g. CTV rendered a generic blue "C"). Keyed by normalized brand so it covers
 *  numbered variants (TSN1-5, CTV 2, …). Wikimedia-hosted; tried BEFORE the favicon. */
const CHANNEL_LOGO_OVERRIDES: Record<string, string> = {
  "a&e": "https://commons.wikimedia.org/wiki/Special:FilePath/A%26E%20Network%20logo.svg?width=320",
  "adult swim": "https://commons.wikimedia.org/wiki/Special:FilePath/Adult%20Swim%202003%20logo.svg?width=320",
  "amc": "https://commons.wikimedia.org/wiki/Special:FilePath/AMC%20logo%202019.svg?width=320",
  "bein sports": "https://commons.wikimedia.org/wiki/Special:FilePath/BeIN%20Sports%20logo%20(horizontal%20version).svg?width=320",
  "bnn bloomberg": "https://commons.wikimedia.org/wiki/Special:FilePath/BNN%20Bloomberg.svg?width=320",
  "boomerang": "https://commons.wikimedia.org/wiki/Special:FilePath/Boomerang%202014%20logo.svg?width=320",
  "canal d": "https://commons.wikimedia.org/wiki/Special:FilePath/Canal%20D%20Logo.svg?width=320",
  "canal vie": "https://commons.wikimedia.org/wiki/Special:FilePath/Canal%20Vie%202016%20logo.png?width=320",
  "cartoon": "https://commons.wikimedia.org/wiki/Special:FilePath/Cartoon%20Network%202010%20logo.svg?width=320",
  "cbc": "https://commons.wikimedia.org/wiki/Special:FilePath/CBC%20Logo%201992-Present.svg?width=320",
  "cbs sports": "https://commons.wikimedia.org/wiki/Special:FilePath/CBS%20Sports%20logo.svg?width=320",
  "citytv": "https://commons.wikimedia.org/wiki/Special:FilePath/Citytv%20logo.svg?width=320",
  "cnn": "https://commons.wikimedia.org/wiki/Special:FilePath/CNN.svg?width=320",
  "comedy central": "https://commons.wikimedia.org/wiki/Special:FilePath/Comedy%20Central%202018.svg?width=320",
  "ctv": "https://commons.wikimedia.org/wiki/Special:FilePath/CTV%20logo%202018.svg?width=320",
  "dazn": "https://commons.wikimedia.org/wiki/Special:FilePath/DAZN%20Logo%20Boxed.svg?width=320",
  "discovery": "https://commons.wikimedia.org/wiki/Special:FilePath/2019%20Discovery%20logo.svg?width=320",
  "discovery science": "https://commons.wikimedia.org/wiki/Special:FilePath/Discovery%20Science%20-%20Logo%202012.svg?width=320",
  "espn": "https://commons.wikimedia.org/wiki/Special:FilePath/ESPN%20wordmark.svg?width=320",
  "food": "https://commons.wikimedia.org/wiki/Special:FilePath/Food%20Network%20logo.svg?width=320",
  "fox news": "https://commons.wikimedia.org/wiki/Special:FilePath/Fox%20News%20Channel%20logo.svg?width=320",
  "fs": "https://commons.wikimedia.org/wiki/Special:FilePath/Fox%20Sports%201%20logo.svg?width=320",
  "fx": "https://commons.wikimedia.org/wiki/Special:FilePath/FX%20International%20logo.svg?width=320",
  "fxx": "https://commons.wikimedia.org/wiki/Special:FilePath/FXX%20Logo.svg?width=320",
  "global": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Global_Television_Network_2019_logo.svg/330px-Global_Television_Network_2019_logo.svg.png",
  "hbo": "https://commons.wikimedia.org/wiki/Special:FilePath/HBO%20logo.svg?width=320",
  "hgtv": "https://commons.wikimedia.org/wiki/Special:FilePath/HGTV%20US%20Logo%202015.svg?width=320",
  "history": "https://commons.wikimedia.org/wiki/Special:FilePath/History%20Logo.svg?width=320",
  "hln": "https://commons.wikimedia.org/wiki/Special:FilePath/HLN%202017%20new%20logo.png?width=320",
  "msnbc": "https://commons.wikimedia.org/wiki/Special:FilePath/MSNBC%202015%20logo.svg?width=320",
  "national geographic": "https://commons.wikimedia.org/wiki/Special:FilePath/Natgeologo.svg?width=320",
  "nfl redzone": "https://commons.wikimedia.org/wiki/Special:FilePath/NFL%20RedZone%20Logo%20(2012).png?width=320",
  "noovo": "https://commons.wikimedia.org/wiki/Special:FilePath/Noovo%20logo.svg?width=320",
  "paramount+": "https://commons.wikimedia.org/wiki/Special:FilePath/Paramount%20Plus.svg?width=320",
  "rdi": "https://commons.wikimedia.org/wiki/Special:FilePath/ICI%20RDI%20logo.svg?width=320",
  "showtime": "https://commons.wikimedia.org/wiki/Special:FilePath/Showtime.svg?width=320",
  "slice": "https://commons.wikimedia.org/wiki/Special:FilePath/Slice%20logo%20(2017).svg?width=320",
  "sportsnet": "https://commons.wikimedia.org/wiki/Special:FilePath/Logo%20Sportsnet%202011.svg?width=320",
  "starz": "https://commons.wikimedia.org/wiki/Special:FilePath/Starz%202016.svg?width=320",
  "tlc": "https://commons.wikimedia.org/wiki/Special:FilePath/TLC%20Logo.svg?width=320",
  "tnt": "https://commons.wikimedia.org/wiki/Special:FilePath/TNT%20Logo%202016.svg?width=320",
  "true crime": "https://commons.wikimedia.org/wiki/Special:FilePath/True%20Crime%20Network%20logo.svg?width=320",
  "tsn": "https://commons.wikimedia.org/wiki/Special:FilePath/TSN%20Logo.svg?width=320",
  "tva sports": "https://commons.wikimedia.org/wiki/Special:FilePath/TVA%20Sports%20Logo.svg?width=320",
};

function channelLogoOverride(name: string): string | undefined {
  const n = normalizeBrand(name);
  if (CHANNEL_LOGO_OVERRIDES[n]) return CHANNEL_LOGO_OVERRIDES[n];
  const keys = Object.keys(CHANNEL_LOGO_OVERRIDES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (n === k || n.startsWith(k + " ") || name.toLowerCase().startsWith(k)) return CHANNEL_LOGO_OVERRIDES[k];
  }
  return undefined;
}

function domainFor(name: string): string | undefined {
  const exact = SERVICE_DOMAINS[name] || CHANNEL_DOMAINS[name];
  if (exact) return exact;
  // Normalize, then match the longest brand key it starts with.
  const n = normalizeBrand(name);
  if (BRAND_DOMAINS[n]) return BRAND_DOMAINS[n];
  // Prefix match against brand keys (so "sportsnet 360" → "sportsnet").
  const keys = Object.keys(BRAND_DOMAINS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (n === k || n.startsWith(k + " ") || name.toLowerCase().startsWith(k)) return BRAND_DOMAINS[k];
  }
  return undefined;
}

/**
 * Ordered list of logo URLs to try for a service/channel name, best first.
 * Consumers (LogoImage) cascade through these on <img> error before falling
 * back to text initials. A backend-provided logo_url, when present, should be
 * tried before these.
 */
export function getLogoCandidates(name: string, opts?: { skipChannelOverride?: boolean }): string[] {
  const out: string[] = [];
  // Curated correct logo first (fixes wrong favicons, e.g. CTV); a broken URL
  // safely falls through to the next candidate via the <img> onError chain.
  // Skipped for VOD SERVICE cards — those want the clean white brand marks
  // (SimpleIcons/wordmarks), not a colored live-channel logo (e.g. Paramount+).
  // Exact full-name logo FIRST — most specific, so it beats channelLogoOverride's
  // loose prefix match. Without this ordering, CHANNEL_LOGO_OVERRIDES["espn"]
  // (a startsWith match) forced the ESPN wordmark onto ESPN2/ESPNU/ESPNews/ESPN+
  // — the "they look like dups" the user hit. Each ESPN sibling now shows its
  // own mark. Gated by skipChannelOverride like the other channel logos.
  const directUrl = opts?.skipChannelOverride ? undefined : CHANNEL_LOGO_URLS[name];
  if (directUrl) out.push(directUrl);
  const override = opts?.skipChannelOverride ? undefined : channelLogoOverride(name);
  if (override) out.push(override);
  const showUrl = getShowLogoUrl(name);
  if (showUrl) out.push(showUrl);
  const slug = SIMPLEICONS_SLUGS[name];
  if (slug) out.push(`https://cdn.simpleicons.org/${slug}/white`);
  const wordmark = SERVICE_WORDMARK_LOGOS[name];
  if (wordmark) out.push(wordmark);
  const domain = domainFor(name);
  if (domain) out.push(googleFavicon(domain));
  return out;
}

export function getServiceLogoUrl(name: string): string | null {
  return getLogoCandidates(name)[0] || null;
}

export function getChannelLogoUrl(name: string): string | null {
  const domain = CHANNEL_DOMAINS[name];
  return domain ? googleFavicon(domain) : null;
}

export function getLogoUrl(name: string): string | null {
  return getLogoCandidates(name)[0] || null;
}

export function getChannelAbbr(name: string): string {
  const map: Record<string, string> = {
    "ESPN": "ESPN",
    "ESPN 2": "ES2",
    "ESPN+": "ES+",
    "CNN": "CNN",
    "CNN International": "CNNi",
    "FOX News": "FOX",
    "Fox Sports 1": "FS1",
    "Fox Sports 2": "FS2",
    "MSNBC": "MSN",
    "Game Show Network": "GSN",
    "MSG Plus": "MSG+",
    "NBC Sports Boston": "NBCB",
    "NBC Sports Chicago": "NBCC",
    "AT&T SportsNet Pittsburgh": "ATTP",
    "Bally Sports North": "BSN",
    "Bally Sports Detroit": "BSD",
    "Sky Sports Premier League": "SKY",
    "Nat Geo Wild": "WILD",
    "NBA TV": "NBA",
    "NFL Network": "NFL",
    "NHL Network": "NHL",
    "MLB Network": "MLB",
    "HGTV": "HGTV",
    "Food Network": "FOOD",
    "TLC": "TLC",
    "Discovery Channel": "DISC",
    "National Geographic": "NAT",
    "History Channel": "HIST",
    "Travel Channel": "TRVL",
    "AMC": "AMC",
    "TNT": "TNT",
    "TBS": "TBS",
    "USA Network": "USA",
    "FX": "FX",
    "Comedy Central": "CC",
    "MTV": "MTV",
    "VH1": "VH1",
    "BET": "BET",
    "Cartoon Network": "CN",
    "Nickelodeon": "NICK",
    "Disney Channel": "DIS",
    "PBS": "PBS",
    "ABC": "ABC",
    "CBS": "CBS",
    "NBC": "NBC",
    "FOX": "FOX",
    "The CW": "CW",
    "BBC America": "BBCA",
    "BBC World News": "BBCW",
    "Bloomberg": "BLM",
    "CNBC": "CNBC",
    "C-SPAN": "CSPN",
    "E!": "E!",
    "Freeform": "FREE",
    "Hallmark Channel": "HALL",
    "Lifetime": "LIFE",
    " Oxygen": "OXY",
    "Paramount Network": "PAR",
    "Syfy": "SYFY",
    "Bravo": "BRAV",
    "A&E": "A&E",
    "Animal Planet": "ANML",
    "Discovery+": "D+",
    "Paramount+": "P+",
    "Peacock": "PCOK",
    "Tubi": "TUBI",
    "Pluto TV": "PLTO",
  };
  return map[name] || name.split(" ").map(w => w[0]).join("").slice(0, 4).toUpperCase();
}

export function getChannelColors(name: string): string {
  const map: Record<string, string> = {
    "ESPN": "from-blue-800 to-black",
    "ESPN 2": "from-blue-700 to-black",
    "CNN": "from-blue-800 to-gray-900",
    "FOX News": "from-blue-700 to-blue-900",
    "Fox Sports 1": "from-green-700 to-green-900",
    "MSNBC": "from-blue-600 to-blue-800",
    "NBA TV": "from-blue-700 to-blue-900",
    "NFL Network": "from-gray-800 to-black",
    "NHL Network": "from-gray-700 to-black",
    "MLB Network": "from-blue-700 to-blue-900",
    "HGTV": "from-emerald-600 to-emerald-800",
    "Food Network": "from-orange-500 to-orange-700",
    "Discovery Channel": "from-yellow-600 to-yellow-800",
    "National Geographic": "from-yellow-500 to-black",
    "History Channel": "from-amber-600 to-amber-800",
    "AMC": "from-gray-700 to-black",
    "TNT": "from-blue-600 to-blue-800",
    "TBS": "from-yellow-500 to-yellow-700",
    "USA Network": "from-blue-500 to-blue-700",
    "FX": "from-gray-600 to-black",
    "Comedy Central": "from-yellow-400 to-yellow-600",
    "MTV": "from-white to-gray-300",
    "VH1": "from-sky-500 to-blue-700",
    "BET": "from-green-600 to-green-800",
    "Cartoon Network": "from-blue-500 to-orange-500",
    "Nickelodeon": "from-orange-400 to-orange-600",
    "Disney Channel": "from-blue-500 to-cyan-500",
    "PBS": "from-blue-600 to-blue-800",
    "ABC": "from-gray-600 to-black",
    "CBS": "from-blue-600 to-blue-800",
    "NBC": "from-blue-600 to-blue-800",
    "BBC America": "from-blue-800 to-blue-950",
    "CNBC": "from-orange-500 to-orange-700",
  };
  return map[name] || "from-brand/70 to-brand/30";
}

/** Service brand colors */
export function getServiceColor(service: string): string {
  const map: Record<string, string> = {
    "Netflix": "#2563eb",
    "Disney+": "#113CCF",
    "HBO Max": "#5822B4",
    "Max": "#5822B4",
    "Prime Video": "#00A8E1",
    "Amazon Prime": "#00A8E1",
    "Paramount+": "#0064FF",
    "Apple TV+": "#555555",
    "Hulu": "#1CE783",
    "Crave": "#D42027",
    "Peacock": "#FCC23B",
    "Tubi": "#B222D7",
    "Pluto TV": "#FF6700",
    "Starz": "#000000",
    "Showtime": "#B71C1C",
    "MGM+": "#D4A84B",
    "Kanopy": "#005A9C",
    "Crackle": "#EC1C24",
    "The Roku Channel": "#6F2DA8",
    "PBS": "#005A9C",
    "BBC iPlayer": "#FF3B3F",
    "Channel 4": "#EE2328",
    "ITVX": "#F76935",
    "Stan": "#006B3F",
    "ABC iview": "#00509E",
    "SBS on Demand": "#E53E30",
    "Hotstar": "#FF5722",
    "Viu": "#FF0000",
    "iQIYI": "#00BE38",
    "YouTube": "#FF0000",
    "Vimeo": "#1AB7EA",
    "Disney": "#113CCF",
    "HBO": "#5822B4",
    "CBC Gem": "#E31837",
    "Nickelodeon": "#F6A800",
    "Cartoon Network": "#00AFF0",
    "Fox": "#003DA5",
    "BBC": "#FF3B3F",
    "AMC": "#E8E8E8",
    "Adult Swim": "#000000",
    "BET": "#00A94F",
    "Comedy Central": "#FFB800",
    "MTV": "#00ADEF",
    "Spike": "#FF7800",
    "Syfy": "#00D4FF",
    "TBS": "#FFD700",
    "TNT": "#2563eb",
    "USA": "#003DA5",
    "Warner Bros": "#00A4E4",
    "Sony": "#000000",
    "Universal": "#000000",
    "Paramount": "#0064FF",
    "MGM": "#F5A623",
    "Lionsgate": "#00A650",
    "A24": "#000000",
    "Criterion": "#000000",
    "Arrow": "#2563eb",
    "Shudder": "#0A0A0A",
    "Sundance Now": "#00A94F",
    "BritBox": "#FF0000",
    "Acorn TV": "#005A9C",
    "PBS Kids": "#005A9C",
    "PBS Documentaries": "#005A9C",
    "PBS Living": "#005A9C",
    "PBS Masterpiece": "#005A9C",
    "CuriosityStream": "#FF6600",
    "Magellan TV": "#001F3F",
    "Nebula": "#000000",
    "Wondrium": "#003B5C",
    "Classical TV": "#000000",
    "Allblk": "#000000",
    "Urban Movie Channel": "#000000",
    "Kweli TV": "#000000",
    "Brown Sugar": "#000000",
    "Here TV": "#000000",
    "Dekkoo": "#000000",
    "Revry": "#000000",
    "OUTtv": "#000000",
    "Plex": "#FFE000",
    "Jellyfin": "#000000",
    "Emby": "#52B54B",
    "Kodi": "#FF6600",
    "Plex Media Server": "#FFE000",
    "Universal Pictures": "#000000",
    "Warner Bros Pictures": "#00A4E4",
    "Sony Pictures": "#000000",
    "20th Century Studios": "#0000FF",
    "Disney+ Hotstar": "#113CCF",
    "ESPN": "#2563eb",
    "ESPN+": "#2563eb",
    "NFL": "#013369",
    "NBA": "#1D428A",
    "MLB": "#002D72",
    "NHL": "#003057",
    "UFC": "#2563eb",
    "WWE": "#000000",
    "AEW": "#000000",
    "Impact Wrestling": "#000000",
    "ROH": "#000000",
    "New Japan Pro Wrestling": "#000000",
    "Stardom": "#000000",
    "MLW": "#000000",
    "NWA": "#000000",
    "GCW": "#000000",
    "CZW": "#000000",
    "PWG": "#000000",
    "Evolve": "#000000",
    "WWN": "#000000",
    "Flosports": "#000000",
    "DAZN": "#000000",
    "FITE": "#000000",
    "Triller": "#000000",
    "Twitch": "#9146FF",
    "Vudu": "#00B5E2",
    "Movies Anywhere": "#000000",
    "Fandango": "#000000",
    "Fandor": "#000000",
    "Mubi": "#000000",
    "Max Go": "#5822B4",
    "Disney Now": "#113CCF",
    "Nick": "#F6A800",
    "Boomerang": "#00AFF0",
    "PBS KIDS": "#005A9C",
    "Pluto TV Kids": "#FF6700",
    "Pluto TV Movies": "#FF6700",
    "Pluto TV Sports": "#FF6700",
    "Pluto TV News": "#FF6700",
    "Pluto TV Entertainment": "#FF6700",
    "Pluto TV Latino": "#FF6700",
    "Pluto TV Anime": "#FF6700",
    "Pluto TV Documentaries": "#FF6700",
    "Pluto TV Reality": "#FF6700",
    "Pluto TV Music": "#FF6700",
    "Pluto TV Comedy": "#FF6700",
    "Pluto TV Drama": "#FF6700",
    "Pluto TV Thriller": "#FF6700",
    "Pluto TV Action": "#FF6700",
    "Pluto TV Sci-Fi": "#FF6700",
    "Pluto TV Horror": "#FF6700",
    "Pluto TV Romance": "#FF6700",
    "Pluto TV Western": "#FF6700",
    "Pluto TV Classic": "#FF6700",
    "Pluto TV Crime": "#FF6700",
    "Pluto TV Mystery": "#FF6700",
    "Pluto TV Family": "#FF6700",
    "Pluto TV Reality & True Crime": "#FF6700",
    "Pluto TV Soaps": "#FF6700",
    "Pluto TV Game Shows": "#FF6700",
    "Pluto TV Talk": "#FF6700",
    "Pluto TV Variety": "#FF6700",
    "Pluto TV Special Interest": "#FF6700",
    "Pluto TV Faith & Spirituality": "#FF6700",
    "Samsung TV Plus": "#000000",
    "LG Channels": "#000000",
    "Vizio WatchFree+": "#000000",
    "Xumo": "#000000",
    "Redbox": "#2563eb",
    "Kanopy Kids": "#005A9C",
    "Hoopla": "#000000",
    "Libby": "#000000",
    "OverDrive": "#000000",
    "Axis 360": "#000000",
    "Bibliotheca": "#000000",
    "Cloud Library": "#000000",
    "IndieFlix": "#000000",
    "Shout! Factory TV": "#000000",
    "Midnight Pulp": "#000000",
    "AsianCrush": "#000000",
    "RetroCrush": "#000000",
    "DramaFever": "#000000",
    "Viki": "#000000",
    "Kocowa": "#000000",
    "OnDemandKorea": "#000000",
    "Crunchyroll": "#F47521",
    "Funimation": "#000000",
    "Hidive": "#000000",
    "Anime Lab": "#000000",
    "Anime Digital Network": "#000000",
    "ADN": "#000000",
    "Wakanim": "#000000",
    "Anime on Demand": "#000000",
    "Peppermint": "#000000",
    "FilmBox": "#000000",
    "FilmBox Arthouse": "#000000",
    "FilmBox Premium": "#000000",
    "FilmBox Family": "#000000",
    "FilmBox Action": "#000000",
    "FilmBox Comedy": "#000000",
    "FilmBox Documentary": "#000000",
    "FilmBox Horror": "#000000",
    "FilmBox Extra": "#000000",
    "FilmBox Stars": "#000000",
    "FilmBox Plus": "#000000",
    "FilmBox Music": "#000000",
    "FilmBox Kids": "#000000",
    "36 North": "#000000",
    "Cineverse": "#000000",
    "Dove Channel": "#000000",
    "TBN": "#000000",
    "TBN Inspire": "#000000",
    "TBN Salsa": "#000000",
    "TBN Enlace": "#000000",
    "TBN Positively": "#000000",
    "TBN Latino": "#000000",
    "TBN UK": "#000000",
    "TBN Africa": "#000000",
    "TBN Asia": "#000000",
    "TBN Australia": "#000000",
    "TBN New Zealand": "#000000",
    "TBN Canada": "#000000",
    "TBN Europe": "#000000",
    "TBN Russia": "#000000",
    "TBN China": "#000000",
    "TBN India": "#000000",
    "TBN Japan": "#000000",
    "TBN Korea": "#000000",
    "TBN Middle East": "#000000",
    "TBN South Africa": "#000000",
    "TBN Brazil": "#000000",
    "TBN Mexico": "#000000",
    "TBN Argentina": "#000000",
    "TBN Colombia": "#000000",
    "TBN Chile": "#000000",
    "TBN Peru": "#000000",
    "TBN Venezuela": "#000000",
    "TBN Ecuador": "#000000",
    "TBN Bolivia": "#000000",
    "TBN Paraguay": "#000000",
    "TBN Uruguay": "#000000",
    "TBN Guyana": "#000000",
    "TBN Suriname": "#000000",
    "TBN French Guiana": "#000000",
    "TBN Falkland Islands": "#000000",
    "TBN South Georgia": "#000000",
    "TBN South Sandwich Islands": "#000000",
    "TBN Antarctica": "#000000",
    "three": "#000000",
    "three +": "#000000",
    "Netflix Canada": "#2563eb",
    "Amazon Prime Video": "#00A8E1",
    "Paramount+ Canada": "#0064FF",
    "Apple TV+ Canada": "#555555",
    "HBO Max Canada": "#5822B4",
    "Disney+ Canada": "#113CCF",
  };
  return map[service] || "#555555";
}

export function getServiceInitials(service: string): string {
  return service.split(" ").map(w => w[0]).slice(0, 2).join("");
}

/**
 * Classify a Live channel into a UI category by NAME. The backend reports
 * `category: "live"` for every channel (useless for tabs), so we derive the
 * real type here for sorting + the category filter pills.
 */
export function getChannelType(name: string): string {
  const n = (name || "").toLowerCase();
  // NOTE: leading \b only (no trailing \b) — a trailing boundary fails on
  // brand+number names like "TSN1"/"FS1" ("n"→"1" is not a word boundary), which
  // wrongly dumped all of TSN into Entertainment. Leading-boundary matches the
  // brand at a word start and tolerates trailing digits/suffixes.
  if (/\b(tsn|sportsnet|espn|fs1|fs2|fox sports|nfl|nba|nhl|mlb|dazn|bein|nesn|fanduel|cbs sports|golazo|rds|tva sports|redzone|golf|ufc|wwe|sport|serie a|premier league|laliga|la liga|bundesliga|champions league|\bmls\b)/.test(n))
    return "Sports";
  if (/\b(cnn|fox news|msnbc|hln|bloomberg|bnn|cbc news|ctv news|cp24|global news|news)/.test(n))
    return "News";
  if (/\b(hbo|cinemax|starz|showtime|mgm|paramount\+|amc|tmn|movie|cinema|fxm)/.test(n))
    return "Movies";
  if (/\b(cartoon|adult swim|teletoon|boomerang|nick|disney|pbs kids|24\/7|pokemon|family guy|simpsons|rick and morty|american dad|south park|futurama|kids)/.test(n))
    return "Kids";
  // "bet" removed from Music: it swallowed flagship BET (general entertainment).
  if (/\b(mtv|much|vevo|cmt|stingray|music choice)/.test(n))
    return "Music";
  if (/\b(discovery|history|national geographic|nat geo|science|tlc|food network|hgtv|animal|nature|curiosity|nasa|travel channel|lifetime)/.test(n))
    return "Lifestyle";
  return "Entertainment";
}