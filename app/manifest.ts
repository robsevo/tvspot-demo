import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TVSpot",
    short_name: "TVSpot",
    description: "Live TV, movies, and series streaming",
    start_url: "/",
    display: "standalone",
    background_color: "#141414",
    theme_color: "#5B21B6",
    icons: [
      // Real PNGs — iOS ignores SVG home-screen icons and Android maskable-SVG
      // is unreliable, which is why the saved-to-home-screen logo was blank.
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    categories: ["entertainment", "video"],
  };
}
