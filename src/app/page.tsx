import App from "./App";
import { demoSnapshot, DEMO_STORE_NAME } from "@/lib/demo";
import { buildBriefing } from "@/lib/briefing/build";

/**
 * The public demo: the real engine running on a made-up shop.
 * Nothing on this page is hardcoded text — rules.ts decides what to say.
 */
export const revalidate = 3600;

export default function Page() {
  const snapshot = demoSnapshot();
  const { briefing, alsoNoticed } = buildBriefing(snapshot);
  return <App mode="demo" storeName={DEMO_STORE_NAME} snapshot={snapshot} briefing={briefing} alsoNoticed={alsoNoticed} />;
}
