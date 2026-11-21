import { VoiceScreeningHandoff } from "@/components/interviewer/handoff-panel";
import { interviewerHandoffEnabled } from "@/lib/interviewer-flag";
import { CalendarScreen } from "./screen";

export default function CalendarPage() {
  return (
    <>
      <VoiceScreeningHandoff enabled={interviewerHandoffEnabled()} context="calendar" />
      <CalendarScreen />
    </>
  );
}
