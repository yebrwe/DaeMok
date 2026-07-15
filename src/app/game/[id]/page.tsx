import { redirect } from 'next/navigation';

export default async function LegacyGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/rooms/${encodeURIComponent(id)}`);
}
