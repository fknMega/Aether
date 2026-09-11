import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { text } from "./context";

export function imageTools() {
  const reverseImage = tool(
    "reverse_image_urls",
    "Build ready-to-open reverse-image-search URLs for a publicly reachable image URL, across Yandex (strongest for faces), Google Lens, TinEye (exact-copy provenance & earliest appearance), and Bing Visual Search. Run the image through all four — they index different corpora. Then open each with http_probe/WebFetch or the browser. Every match is a new lead: a username, platform, real name, or co-appearing person to add to the graph.",
    { imageUrl: z.string().min(1).describe("A publicly reachable https URL to the image (not a local file path).") },
    async ({ imageUrl }) => {
      const enc = encodeURIComponent(imageUrl.trim());
      return text(JSON.stringify({
        imageUrl,
        yandex: `https://yandex.com/images/search?rpt=imageview&url=${enc}`,
        googleLens: `https://lens.google.com/uploadbyurl?url=${enc}`,
        tineye: `https://tineye.com/search?url=${enc}`,
        bing: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${enc}`,
        note: "Yandex first on any human face. For a LOCAL image there is no URL to hand off — drive the engine's upload surface with a headless browser via Bash instead.",
      }));
    },
  );
  return [reverseImage];
}
