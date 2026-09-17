import { redirect } from "next/navigation";
import { getWarehouse, lockedFor } from "@/lib/auth";
import { PIN_LENGTH } from "@/lib/config";
import Keypad from "./keypad";

export default async function LoginPage() {
  if (await getWarehouse()) redirect("/");

  // Nothing on this page reveals who uses the app or how many warehouses exist.
  return <Keypad pinLength={PIN_LENGTH} lockedMinutes={await lockedFor()} />;
}
