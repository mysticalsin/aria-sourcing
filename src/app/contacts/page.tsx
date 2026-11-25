import type { Metadata } from "next";
import { ContactChat } from "@/components/contacts/contact-chat";

export const metadata: Metadata = {
  title: "Contacts",
};

export default function ContactsPage() {
  return <ContactChat />;
}
