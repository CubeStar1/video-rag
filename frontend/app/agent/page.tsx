import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AgentPage() {
  redirect("/projects?create=1");
}
