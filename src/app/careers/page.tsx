"use client";

import { CareersShell } from "@/components/careers/careers-shell";
import { Chatbox } from "@/components/careers/chatbox";

export default function CareersPage() {
  return (
    <CareersShell>
      <Chatbox />
    </CareersShell>
  );
}
