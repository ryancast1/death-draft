import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "10th Annual Celebrity Death Draft",
    short_name: "Death Draft",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  };
}
