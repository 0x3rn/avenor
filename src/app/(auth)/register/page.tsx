import { permanentRedirect } from "next/navigation";

export default function RegisterRedirectPage() {
  permanentRedirect("/signup");
}
