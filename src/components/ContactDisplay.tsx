import { formatContactDisplay } from "@shared/contactFormat";

interface ContactDisplayProps {
  contactName?: string;
  contactPhone?: string;
  prefix?: string;
}

export default function ContactDisplay({
  contactName,
  contactPhone,
  prefix,
}: ContactDisplayProps) {
  const text = formatContactDisplay(contactName, contactPhone);
  if (prefix) return <>{prefix}{text}</>;
  return <>{text}</>;
}
