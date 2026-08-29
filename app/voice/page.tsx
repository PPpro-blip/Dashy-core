"use client";

/**
 * DashyCore v7 — Voice (real route, feature under construction).
 * Voice will add hands-free spoken interaction. Placeholder until then —
 * no fake functionality.
 */

import { PlaceholderPage } from "@/components/PlaceholderPage";
import { MicIcon } from "@/components/icons";

export default function VoicePage() {
  return (
    <PlaceholderPage
      Icon={MicIcon}
      title="Voice"
      tagline="Talk to Dashy hands-free."
      description="Voice mode will let you speak to Dashy and hear answers read back — useful while coding, walking or when typing is inconvenient."
      points={[
        "Speech-to-text input in the composer",
        "Spoken responses with natural playback",
        "Works alongside your existing chats and memory",
      ]}
    />
  );
}
