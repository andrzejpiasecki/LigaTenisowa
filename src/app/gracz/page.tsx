import { redirect } from "next/navigation";
import { currentPlayer } from "@/lib/player-auth";
import { PlayerPortal } from "@/components/player-portal";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ mecz?: string }> }) {
  const player = await currentPlayer();
  const { mecz } = await searchParams;
  if (!player) redirect(`/gracz/logowanie${mecz ? `?mecz=${encodeURIComponent(mecz)}` : ""}`);
  return <PlayerPortal highlightedMatch={mecz} />;
}
