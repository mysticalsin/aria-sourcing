import { VoiceScreeningHandoff } from "@/components/interviewer/handoff-panel";
import { PageHeader } from "@/components/app/page-header";
import { interviewerHandoffEnabled } from "@/lib/interviewer-flag";

export default function InterviewerPage() {
  const enabled = interviewerHandoffEnabled();
  return (
    <>
      <PageHeader
        eyebrow="Engage"
        title="Voice screening"
        description="Advisory hand-off to the voice interviewer. A person still decides any stage change."
      />
      <VoiceScreeningHandoff enabled={enabled} context="interviewer" />
    </>
  );
}
