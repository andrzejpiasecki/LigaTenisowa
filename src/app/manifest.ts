import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Liga Tenisowa", short_name: "Liga Tenisowa", description: "Mecze i dostępność graczy ligi tenisowej", start_url: "/gracz", scope: "/", display: "standalone", background_color: "#f8fafc", theme_color: "#166534", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }, { src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }] };
}
