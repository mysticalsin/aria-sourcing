import { VoiceScreeningHandoff } from "@/components/interviewer/handoff-panel";
import { interviewerHandoffEnabled } from "@/lib/interviewer-flag";

export default function CandidatesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <VoiceScreeningHandoff enabled={interviewerHandoffEnabled()} context="candidate" />
      {children}
    </>
  );
}
