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
  "True Crime Network": "truecrimenetwork.com",
  "ID": "investigationdiscovery.com",
  "Cinemax": "cinemax.com",
  "Starz": "starz.com",
  "Showtime": "sho.com",
  "FXX": "fxnetworks.com",
  "Teletoon": "teletoon.com",
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
/** Resolve a logo domain for a channel name, tolerating numbers/regions/prefixes
 *  ("TSN1", "Sportsnet East", "24/7 Family Guy") via normalized brand matching. */
function domainFor(name: string): string | undefined {
  const exact = SERVICE_DOMAINS[name] || CHANNEL_DOMAINS[name];
  if (exact) return exact;
  // Normalize: drop "24/7 " prefix, lowercase, strip trailing digits + region
  // words, collapse spaces — then match the longest brand key it starts with.
  const n = name
    .toLowerCase()
    .replace(/^24\/7\s+/, "")
    .replace(/\b(hd|fhd|sd|4k|uhd|east|west|ontario|pacific|network|channel|info|one|tv)\b/g, "")
    .replace(/\s*\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
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
export function getLogoCandidates(name: string): string[] {
  const out: string[] = [];
  const showUrl = getShowLogoUrl(name);
  if (showUrl) out.push(showUrl);
  const slug = SIMPLEICONS_SLUGS[name];
  if (slug) out.push(`https://cdn.simpleicons.org/${slug}/white`);
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
    "ESPN": "from-violet-800 to-black",
    "ESPN 2": "from-violet-700 to-black",
    "CNN": "from-violet-800 to-gray-900",
    "FOX News": "from-blue-700 to-blue-900",
    "Fox Sports 1": "from-green-700 to-green-900",
    "MSNBC": "from-blue-600 to-blue-800",
    "NBA TV": "from-violet-800 to-blue-800",
    "NFL Network": "from-gray-800 to-black",
    "NHL Network": "from-gray-700 to-black",
    "MLB Network": "from-blue-700 to-violet-700",
    "HGTV": "from-emerald-600 to-emerald-800",
    "Food Network": "from-orange-500 to-orange-700",
    "Discovery Channel": "from-yellow-600 to-yellow-800",
    "National Geographic": "from-yellow-500 to-black",
    "History Channel": "from-amber-600 to-amber-800",
    "AMC": "from-gray-700 to-black",
    "TNT": "from-purple-600 to-purple-800",
    "TBS": "from-yellow-500 to-yellow-700",
    "USA Network": "from-blue-500 to-blue-700",
    "FX": "from-gray-600 to-black",
    "Comedy Central": "from-yellow-400 to-yellow-600",
    "MTV": "from-white to-gray-300",
    "VH1": "from-purple-500 to-purple-700",
    "BET": "from-green-600 to-green-800",
    "Cartoon Network": "from-blue-500 to-orange-500",
    "Nickelodeon": "from-orange-400 to-orange-600",
    "Disney Channel": "from-blue-500 to-cyan-500",
    "PBS": "from-blue-600 to-blue-800",
    "ABC": "from-gray-600 to-black",
    "CBS": "from-blue-600 to-blue-800",
    "NBC": "from-purple-600 to-purple-800",
    "BBC America": "from-violet-800 to-violet-950",
    "CNBC": "from-orange-500 to-orange-700",
  };
  return map[name] || "from-brand/70 to-brand/30";
}

/** Service brand colors */
export function getServiceColor(service: string): string {
  const map: Record<string, string> = {
    "Netflix": "#5B21B6",
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
    "TNT": "#5B21B6",
    "USA": "#003DA5",
    "Warner Bros": "#00A4E4",
    "Sony": "#000000",
    "Universal": "#000000",
    "Paramount": "#0064FF",
    "MGM": "#F5A623",
    "Lionsgate": "#00A650",
    "A24": "#000000",
    "Criterion": "#000000",
    "Arrow": "#5B21B6",
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
    "ESPN": "#5B21B6",
    "ESPN+": "#5B21B6",
    "NFL": "#013369",
    "NBA": "#1D428A",
    "MLB": "#002D72",
    "NHL": "#003057",
    "UFC": "#5B21B6",
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
    "Redbox": "#5B21B6",
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
    "Netflix Canada": "#5B21B6",
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
  if (/\b(tsn|sportsnet|espn|fs1|fs2|fox sports|nfl|nba|nhl|mlb|dazn|bein|nesn|fanduel|cbs sports|rds|tva sports|redzone|golf|ufc|wwe|sport)/.test(n))
    return "Sports";
  if (/\b(cnn|fox news|msnbc|hln|bloomberg|bnn|cbc news|ctv news|cp24|global news|news)/.test(n))
    return "News";
  if (/\b(hbo|cinemax|starz|showtime|mgm|paramount\+|amc|tmn|movie|cinema|fxm)/.test(n))
    return "Movies";
  if (/\b(cartoon|adult swim|teletoon|boomerang|nick|disney|pbs kids|24\/7|pokemon|family guy|simpsons|rick and morty|american dad|south park|futurama|kids)/.test(n))
    return "Kids";
  if (/\b(mtv|much|vevo|cmt|stingray|music choice|bet)/.test(n))
    return "Music";
  if (/\b(discovery|history|national geographic|nat geo|science|tlc|food network|hgtv|animal|nature|curiosity|nasa)/.test(n))
    return "Lifestyle";
  return "Entertainment";
}