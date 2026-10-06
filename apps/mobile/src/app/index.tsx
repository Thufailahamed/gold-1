import { Redirect } from "expo-router";
import { useSession } from "@/lib/session";

/** Entry: route to the app or the sign-in screen once the session is known. */
export default function Index() {
  const { status } = useSession();
  if (status === "loading") return null;
  return <Redirect href={status === "signedOut" ? "/login" : "/home"} />;
}
